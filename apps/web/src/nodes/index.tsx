/**
 * 各类节点的画布渲染 —— 极简风格（对齐参考图）。
 *
 * 原则：
 *  - 卡片上只放「一眼要看的东西」：预览图 / 播放按钮 / 提示词；
 *  - 所有参数都通过点击节点弹出的设置面板调（见 layout/NodeSettingsPanel.tsx）；
 *  - 文件名作为标题显示在卡片顶部一行小字里。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import {
  CONTENT_ROLES,
  MEDIA_LIMITS,
  MODEL_CAPABILITIES,
  RATIO_META,
  coerceRatio,
  formatCny,
  presetById,
  rolesForCount,
  type ContentRole,
  type GenMethodId,
  type NodeKind,
} from '@h3/shared';
import { NodeShell } from '../canvas/NodeShell.tsx';
import { useGraph, type CanvasNode } from '../store/graph.ts';
import { resolveNodeSlots } from '../engine/resolve.ts';
import { estimateNode } from '../engine/estimate.ts';
import { runNodes } from '../engine/run-controls.ts';
import { NodeSettingsPanel } from '../layout/NodeSettingsPanel.tsx';
import { useSettingsPanel } from '../store/settings-panel.ts';
import { api } from '../api/client.ts';
import { classNames, fileToOutcome, formatBytes, probeMedia, willExceedBodyLimit } from '../lib/media.ts';
import { STATUS_LABEL, type NodeRuntime } from '../canvas/workflow-types.ts';

/* ───────────────────────  共享 hook  ─────────────────────── */

function useNodeRuntime(id: string) {
  return useGraph((s) => s.nodes.find((n) => n.id === id)?.data.runtime);
}

function useEstimate(nodeId: string) {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  return useMemo(() => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return null;
    return estimateNode(node, resolveNodeSlots(nodeId, nodes, edges));
  }, [nodeId, nodes, edges]);
}

/** 节点保存的「上次运行」信息 —— 刷新页面后靠它把任务结果贴回来。 */
function useLastRun(id: string) {
  const lastTaskId = useGraph((s) => {
    const value = s.nodes.find((n) => n.id === id)?.data.params.lastTaskId;
    return typeof value === 'string' ? value : '';
  });
  const tasks = useGraph((s) => s.tasks);
  const task = useMemo(
    () => (lastTaskId ? (tasks.find((t) => t.id === lastTaskId) ?? null) : null),
    [lastTaskId, tasks],
  );
  return { lastTaskId, task };
}

function RuntimeHint({ runtime }: { runtime: NodeRuntime | undefined }) {
  if (!runtime) return null;
  if (runtime.status === 'running' || runtime.status === 'queued') {
    return (
      <div className="px-3 pb-2 text-[10px] text-accent-300">
        {STATUS_LABEL[runtime.status]}
        <span className="shimmer ml-1 inline-block h-1 w-10 rounded-full align-middle" />
      </div>
    );
  }
  if (runtime.actualCost !== undefined) {
    return <div className="px-3 pb-2 text-[10px] text-emerald-300">实际 {formatCny(runtime.actualCost)}</div>;
  }
  return null;
}

/** 媒体节点的公共实现 */
function MediaNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const update = useGraph((s) => s.updateNodeParams);
  const projectId = useGraph((s) => s.activeProjectId);
  const runtime = useNodeRuntime(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [showUrl, setShowUrl] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const kind = data.kind as 'image' | 'video' | 'audio';
  const url = String(data.params.url ?? '');
  const name = String(data.params.name ?? '');
  const bytes = typeof data.params.bytes === 'number' ? data.params.bytes : undefined;
  const durationSec = typeof data.params.durationSec === 'number' ? data.params.durationSec : undefined;
  const displayUrl =
    typeof data.params.assetId === 'string' && data.params.assetId
      ? api.assetContentUrl(data.params.assetId)
      : url;

  const accept =
    kind === 'image' ? 'image/*' : kind === 'video' ? 'video/mp4,video/quicktime' : 'audio/wav,audio/mpeg,audio/mp3';
  const limitBytes =
    kind === 'image'
      ? MEDIA_LIMITS.image.maxBytes
      : kind === 'video'
        ? MEDIA_LIMITS.video.maxBytes
        : MEDIA_LIMITS.audio.maxBytes;

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const uploaded = await api.uploadAsset({ file, kind, projectId });
        const outcome = await fileToOutcome(file, kind);
        update(id, {
          url: outcome.url,
          bytes: outcome.bytes,
          mime: outcome.mime,
          name: outcome.name,
          assetId: uploaded.asset.id,
          ...(outcome.probe.width !== undefined ? { width: outcome.probe.width } : {}),
          ...(outcome.probe.height !== undefined ? { height: outcome.probe.height } : {}),
          ...(outcome.probe.durationSec !== undefined ? { durationSec: outcome.probe.durationSec } : {}),
        });
        if (outcome.warning) setError(outcome.warning);
      } catch (cause) {
        setError((cause as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [id, kind, projectId, update],
  );

  const handleRemoteUrl = useCallback(async () => {
    const value = urlDraft.trim();
    if (value.length === 0) return;
    if (!/^https?:\/\//i.test(value) && !value.startsWith('mm_file://')) {
      setError('只支持公网 URL 或 mm_file://{file_id}。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const probe = await probeMedia(value, kind);
      const registered = await api.registerRemoteAsset({
        url: value,
        kind,
        projectId,
        name: value.split('/').pop() ?? value,
      });
      update(id, {
        url: value,
        assetId: registered.asset.id,
        name: value.split('/').pop() ?? '',
        ...(probe.width !== undefined ? { width: probe.width } : {}),
        ...(probe.height !== undefined ? { height: probe.height } : {}),
        ...(probe.durationSec !== undefined ? { durationSec: probe.durationSec } : {}),
      });
      setUrlDraft('');
      setShowUrl(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, [id, kind, projectId, update, urlDraft]);

  const oversize = bytes !== undefined && bytes > limitBytes;

  return (
    <NodeShell id={id} type={data.kind} data={data} selected={selected} width={kind === 'audio' ? 240 : 260}>
      {url.length === 0 ? (
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (file) void handleFile(file);
          }}
          onClick={() => fileRef.current?.click()}
          className="flex h-[120px] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg bg-ink-850/60 text-[11px] text-mist-400 hover:bg-ink-800"
        >
          <span className="text-[18px] leading-none">＋</span>
          <span>{busy ? '处理中…' : '点击或拖入'}</span>
        </div>
      ) : (
        <>
          {kind === 'image' && (
            <img
              src={displayUrl}
              alt={name}
              className="h-[160px] w-full rounded-lg bg-ink-850 object-contain"
              draggable={false}
            />
          )}
          {kind === 'video' && (
            <div className="relative">
              <video
                src={displayUrl}
                className="h-[120px] w-full rounded-lg bg-black object-cover"
                muted
                playsInline
                preload="metadata"
              />
              <span className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-ink-950/70 text-[12px] text-mist-100">
                  ▶
                </span>
              </span>
            </div>
          )}
          {kind === 'audio' && (
            <div className="flex h-[52px] items-center gap-2 rounded-lg bg-ink-850 px-2">
              <span className="text-[14px] text-amber-300">♪</span>
              <audio src={displayUrl} controls className="h-7 w-full" />
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-mist-400">
            {bytes !== undefined && (
              <span className={classNames(oversize && 'text-rose-400')}>{formatBytes(bytes)}</span>
            )}
            {durationSec !== undefined && durationSec > 0 && <span>· {durationSec}s</span>}
            <button
              type="button"
              className="ml-auto text-mist-400 hover:text-mist-100"
              onClick={() => update(id, { url: '', assetId: undefined, bytes: undefined, durationSec: undefined })}
              title="清除素材"
            >
              ×
            </button>
          </div>
          {willExceedBodyLimit(bytes ?? 0) && (
            <p className="mt-0.5 text-[10px] leading-snug text-amber-300">较大，建议改用公网 URL</p>
          )}
        </>
      )}

      <div className="mt-1.5 flex items-center gap-1">
        <button type="button" className="text-[10px] text-mist-400 hover:text-mist-100" onClick={() => setShowUrl((v) => !v)}>
          {showUrl ? '收起' : '用 URL'}
        </button>
        <button
          type="button"
          className="ml-auto text-[10px] text-mist-400 hover:text-mist-100"
          onClick={() => fileRef.current?.click()}
        >
          替换
        </button>
      </div>

      {showUrl && (
        <div className="mt-1.5 flex items-center gap-1">
          <input
            className="field !py-0.5 !text-[10px]"
            placeholder="公网 URL / mm_file://"
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') void handleRemoteUrl();
            }}
          />
          <button type="button" className="btn btn-xs" onClick={() => void handleRemoteUrl()} disabled={busy}>
            确定
          </button>
        </div>
      )}

      {error && <p className="mt-1 text-[10px] leading-snug text-amber-300">{error}</p>}
      <RuntimeHint runtime={runtime} />

      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = '';
        }}
      />
    </NodeShell>
  );
}

export const ImageNode = memo((props: NodeProps<CanvasNode>) => <MediaNode {...props} />);
export const VideoNode = memo((props: NodeProps<CanvasNode>) => <MediaNode {...props} />);
export const AudioNode = memo((props: NodeProps<CanvasNode>) => <MediaNode {...props} />);

/* ───────────────────────  提示词  ─────────────────────── */

export const PromptNode = memo(function PromptNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const update = useGraph((s) => s.updateNodeParams);
  const runtime = useNodeRuntime(id);
  const text = String(data.params.text ?? '');

  return (
    <NodeShell id={id} type={data.kind} data={data} selected={selected} width={260} title="提示词">
      <textarea
        className="bare-field h-[92px] resize-none text-[12px] leading-relaxed"
        placeholder="描述你要生成的内容…"
        value={text}
        onChange={(event) => update(id, { text: event.target.value })}
        onKeyDown={(event) => event.stopPropagation()}
      />
      <div className="mt-1 flex items-center justify-between text-[10px] text-mist-400">
        <span className={classNames(text.length > 7000 && 'text-rose-400')}>{text.length} / 7000</span>
        {runtime?.outputText && <span className="text-violet-300">已增强</span>}
      </div>
      <RuntimeHint runtime={runtime} />
    </NodeShell>
  );
});

/* ───────────────────────  视频生成  ─────────────────────── */

export const VideoGenNode = memo(function VideoGenNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const runtime = useNodeRuntime(id);
  const estimate = useEstimate(id);
  const lastRun = useLastRun(id);
  const panel = useSettingsPanel();

  const methodId = (String(data.params.presetId ?? '') || '全能参考') as GenMethodId;
  const preset = presetById(methodId);
  const resolution = String(data.params.resolution ?? '768P');
  const duration = typeof data.params.duration === 'number' ? data.params.duration : 8;
  const ratio = String(data.params.ratio ?? 'adaptive');
  const sound = data.params.sound === '无声' ? '无声' : '有声';
  const isActive = panel.nodeId === id;

  /** 上游素材状态：告诉用户当前这张卡会吃什么 */
  const upstream = useMemo(() => {
    const slots = resolveNodeSlots(id, nodes, edges);
    const imageCount = slots.frames.length + slots.media.filter((m) => m.ref.kind === 'image').length;
    const hasText = Boolean(slots.text?.text.trim());
    return { imageCount, hasText };
  }, [edges, id, nodes]);

  const openPanel = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      useGraph.getState().setSelectedNode(id);
      const store = useSettingsPanel.getState();
      if (store.nodeId === id) store.close();
      else store.open(id);
    },
    [id],
  );

  return (
    <>
      <NodeShell
        id={id}
        type={data.kind}
        data={data}
        selected={selected}
        width={284}
        title="视频"
        active={isActive}
        onRun={() => void runNodes([id])}
      >
        <div
          onClick={openPanel}
          className={classNames(
            'cursor-pointer overflow-hidden rounded-lg bg-ink-850/70',
            isActive && 'ring-1 ring-mist-200/40',
          )}
          title="点击调整参数"
        >
          {runtime?.outputUrl ? (
            <video src={runtime.outputUrl} className="h-[156px] w-full bg-black object-contain" controls muted playsInline onClick={(event) => event.stopPropagation()} />
          ) : (
            <div className="grid h-[156px] w-full place-items-center">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-ink-800 text-[12px] text-mist-200">▶</span>
            </div>
          )}
        </div>

        {/* 生成方式 + 指南入口：与参考图一致的「尝试 MiniMax H3 / H3创作指南」一行 */}
        <div className="mt-2 flex items-center gap-1.5">
          <span className="truncate text-[11px] text-mist-300">尝试 {String(data.params.model ?? 'MiniMax-H3').replaceAll('-', ' ')}</span>
          <button
            type="button"
            className="ml-auto shrink-0 rounded-md border border-ink-600 px-1.5 py-0.5 text-[10px] text-mist-300 hover:bg-ink-800"
            onClick={(event) => {
              event.stopPropagation();
              panel.openGuide();
            }}
          >
            H3创作指南
          </button>
        </div>

        <div className="node-generation-actions mt-2 space-y-1 text-[11px] text-mist-300">
          <button type="button" className="flex w-full items-center gap-2 rounded-lg bg-ink-800 px-2.5 py-2 text-left" onClick={openPanel}>
            <span className="text-mist-500">✕</span>
            <span>{preset?.label ?? '全能参考'}</span>
          </button>
          <button type="button" className="flex w-full items-center gap-2 rounded-lg bg-ink-800 px-2.5 py-2 text-left" onClick={openPanel}>
            <span className="text-mist-500">▤</span>
            <span>
              {resolution} · {duration}s · {RATIO_META[ratio as keyof typeof RATIO_META]?.label ?? ratio} · {sound}
            </span>
          </button>
        </div>

        {(upstream.imageCount === 0 || !upstream.hasText) && (
          <p className="mt-1.5 text-[10px] leading-snug text-amber-300">
            {upstream.hasText ? '' : '缺提示词；'}
            {upstream.imageCount === 0 && preset && preset.roles.length > 0 ? `需要${preset.expectedImages}` : ''}
          </p>
        )}

        {estimate && estimate.breakdown.total > 0 && (
          <div className="mt-1.5 flex items-center gap-1 text-[10px] text-mist-400">
            <span>预估 {formatCny(estimate.breakdown.total)}</span>
            {runtime?.actualCost !== undefined && (
              <span className="text-emerald-300">· 实际 {formatCny(runtime.actualCost)}</span>
            )}
            {lastRun.task && <span className="ml-auto mono">#{lastRun.task.id.slice(-6)}</span>}
          </div>
        )}

        <RuntimeHint runtime={runtime} />
      </NodeShell>

      {isActive && <NodeSettingsPanel nodeId={id} />}
    </>
  );
});

/* ───────────────────────  Context-IR  ─────────────────────── */

export const ContextIRNode = memo(function ContextIRNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const update = useGraph((s) => s.updateNodeParams);
  const runtime = useNodeRuntime(id);
  const estimate = useEstimate(id);
  const lastRun = useLastRun(id);
  const [copied, setCopied] = useState(false);

  const response = lastRun.task?.response as { content?: { prompt?: string } } | undefined;
  const enhanced = runtime?.outputText ?? response?.content?.prompt;
  const duration = typeof data.params.duration === 'number' ? data.params.duration : 8;

  return (
    <NodeShell
      id={id}
      type={data.kind}
      data={data}
      selected={selected}
      width={248}
      title="Context-IR 增强"
      onRun={() => void runNodes([id])}
    >
      {enhanced ? (
        <div className="max-h-[110px] overflow-auto rounded-lg bg-ink-850/70 p-2 text-[10px] leading-snug text-mist-300">
          {enhanced.slice(0, 500)}
          {enhanced.length > 500 && '…'}
        </div>
      ) : (
        <div className="grid h-[84px] place-items-center rounded-lg bg-ink-850/60 text-[10px] text-mist-400">
          运行后产出增强提示词
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-mist-400">
        <select
          className="!border-0 !bg-transparent !p-0 !text-[10px] !text-mist-300 outline-none"
          value={duration}
          onChange={(event) => update(id, { duration: Number(event.target.value) })}
        >
          {Array.from({ length: 12 }, (_, i) => i + 4).map((value) => (
            <option key={value} value={value}>
              {value}s
            </option>
          ))}
        </select>
        {estimate && <span className="ml-auto">预估 {formatCny(estimate.breakdown.total)}</span>}
        {enhanced && (
          <button
            type="button"
            className="text-mist-400 hover:text-mist-100"
            onClick={() => {
              void navigator.clipboard.writeText(enhanced);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? '已复制' : '复制'}
          </button>
        )}
      </div>
      <RuntimeHint runtime={runtime} />
    </NodeShell>
  );
});

/* ───────────────────────  帧角色  ─────────────────────── */

export const FrameRoleNode = memo(function FrameRoleNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const update = useGraph((s) => s.updateNodeParams);
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const mode = data.params.mode === 'reference' ? 'reference' : 'first-last';

  const upstreamImages = useMemo(() => {
    return edges
      .filter((e) => e.target === id)
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is CanvasNode => Boolean(n) && n!.data.kind === 'image');
  }, [edges, id, nodes]);

  return (
    <NodeShell id={id} type={data.kind} data={data} selected={selected} width={216} title="帧角色">
      <div className="seg mb-2">
        <button
          type="button"
          className="seg-item !py-1 !text-[11px]"
          data-active={mode === 'first-last'}
          onClick={() => update(id, { mode: 'first-last' })}
        >
          首尾帧
        </button>
        <button
          type="button"
          className="seg-item !py-1 !text-[11px]"
          data-active={mode === 'reference'}
          onClick={() => update(id, { mode: 'reference' })}
        >
          参考图
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {upstreamImages.map((image, index) => {
          const role: ContentRole | null =
            mode === 'reference'
              ? 'reference_image'
              : index === 0
                ? 'first_frame'
                : index === upstreamImages.length - 1
                  ? 'last_frame'
                  : null;
          return (
            <span key={image.id} className="chip !py-0 !text-[10px]">
              {index + 1}. {role ?? '忽略'}
            </span>
          );
        })}
        {upstreamImages.length === 0 && <span className="text-[10px] text-mist-400">把图片连到本节点</span>}
      </div>
    </NodeShell>
  );
});

/* ───────────────────────  视频再生成  ─────────────────────── */

export const RegenerateNode = memo(function RegenerateNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const update = useGraph((s) => s.updateNodeParams);
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const runtime = useNodeRuntime(id);
  const tasks = useGraph((s) => s.tasks);

  const mode = data.params.mode === 'task' ? 'task' : 'video';
  const sourceTaskId = String(data.params.sourceTaskId ?? '');
  const slots = useMemo(() => resolveNodeSlots(id, nodes, edges), [edges, id, nodes]);
  const upstreamTask = useMemo(
    () => tasks.find((t) => t.id === slots.upstreamTaskId) ?? null,
    [slots.upstreamTaskId, tasks],
  );
  const eligible = slots.upstreamTaskStatus === 'succeeded';

  return (
    <NodeShell
      id={id}
      type={data.kind}
      data={data}
      selected={selected}
      width={244}
      title="视频再生成 2K"
      onRun={() => void runNodes([id])}
    >
      <div className="seg mb-2">
        <button
          type="button"
          className="seg-item !py-1 !text-[11px]"
          data-active={mode === 'video'}
          onClick={() => update(id, { mode: 'video' })}
        >
          按源视频
        </button>
        <button
          type="button"
          className="seg-item !py-1 !text-[11px]"
          data-active={mode === 'task'}
          onClick={() => update(id, { mode: 'task' })}
        >
          按任务 ID
        </button>
      </div>

      {mode === 'task' ? (
        <>
          <input
            className="field mono !py-1 !text-[10px]"
            placeholder="source_task_id"
            value={sourceTaskId}
            onChange={(event) => update(id, { sourceTaskId: event.target.value })}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <p className="mt-1 text-[10px] leading-snug text-amber-300">该模式需开通白名单</p>
        </>
      ) : slots.upstreamVideoUrl ? (
        <div className="rounded-lg bg-ink-850/70 p-2 text-[10px] text-mist-300">
          <div className="flex items-center justify-between">
            <span>源视频：上游产物</span>
            <span className={eligible ? 'text-emerald-300' : 'text-amber-300'}>
              {slots.upstreamTaskStatus ?? '未知'}
            </span>
          </div>
          {upstreamTask && (
            <div className="mt-0.5 text-mist-400">
              #{upstreamTask.id.slice(-6)} · {upstreamTask.resolution} · {upstreamTask.duration ?? '?'}s
            </div>
          )}
        </div>
      ) : (
        <input
          className="field !py-1 !text-[10px]"
          placeholder="或填 768P 源视频公网 URL"
          value={String(data.params.baseVideoUrl ?? '')}
          onChange={(event) => update(id, { baseVideoUrl: event.target.value })}
          onKeyDown={(event) => event.stopPropagation()}
        />
      )}

      {runtime?.outputUrl && (
        <video src={runtime.outputUrl} className="mt-1.5 w-full rounded-lg bg-black" controls muted playsInline />
      )}
      <RuntimeHint runtime={runtime} />
    </NodeShell>
  );
});

/* ───────────────────────  任务状态  ─────────────────────── */

export const TaskStatusNode = memo(function TaskStatusNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const update = useGraph((s) => s.updateNodeParams);
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const runtime = useNodeRuntime(id);
  const upsertTask = useGraph((s) => s.upsertTask);
  const tasks = useGraph((s) => s.tasks);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const follow = data.params.followUpstream !== false;
  const slots = useMemo(() => resolveNodeSlots(id, nodes, edges), [edges, id, nodes]);
  const effectiveTaskId = follow ? (runtime?.taskId ?? slots.upstreamTaskId ?? '') : String(data.params.taskId ?? '');
  const task = tasks.find((t) => t.id === effectiveTaskId) ?? null;
  const status = task?.status ?? runtime?.status ?? 'idle';

  useEffect(() => {
    if (follow && slots.upstreamTaskId && data.params.taskId !== slots.upstreamTaskId) {
      update(id, { taskId: slots.upstreamTaskId });
    }
  }, [data.params.taskId, follow, id, slots.upstreamTaskId, update]);

  const handleRefresh = async () => {
    if (!effectiveTaskId) return;
    setBusy(true);
    setActionError(null);
    try {
      const { task: refreshed } = await api.refreshTask(effectiveTaskId);
      if (refreshed) upsertTask(refreshed);
    } catch (cause) {
      setActionError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!effectiveTaskId) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.deleteTask(effectiveTaskId);
      if (task) upsertTask({ ...task, status: result.action === 'cancelled' ? 'cancelled' : task.status });
    } catch (cause) {
      setActionError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <NodeShell id={id} type={data.kind} data={data} selected={selected} width={228} title="任务状态">
      <label className="mb-1.5 flex items-center gap-1.5 text-[10px] text-mist-300">
        <input type="checkbox" checked={follow} onChange={(event) => update(id, { followUpstream: event.target.checked })} />
        跟随上游任务
      </label>

      {!follow && (
        <input
          className="field mono !py-1 !text-[10px]"
          placeholder="task_id"
          value={String(data.params.taskId ?? '')}
          onChange={(event) => update(id, { taskId: event.target.value })}
          onKeyDown={(event) => event.stopPropagation()}
        />
      )}

      {effectiveTaskId ? (
        <div className="rounded-lg bg-ink-850/70 p-2 text-[10px] text-mist-300">
          <div className="flex items-center justify-between">
            <span className="mono truncate">#{effectiveTaskId.slice(-8)}</span>
            <span>{STATUS_LABEL[status as NodeRuntime['status']] ?? status}</span>
          </div>
          {task?.usage && Object.keys(task.usage).length > 0 && (
            <div className="mt-0.5 text-mist-400">
              {task.usage.output_seconds !== undefined && <span>输出 {task.usage.output_seconds}s </span>}
              {task.usage.total_tokens !== undefined && <span>tokens {task.usage.total_tokens}</span>}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-mist-400">连接生成节点后自动获取任务</p>
      )}

      <div className="mt-1.5 flex items-center gap-1">
        <button type="button" className="btn btn-xs" onClick={() => void handleRefresh()} disabled={!effectiveTaskId || busy}>
          刷新
        </button>
        <button
          type="button"
          className="btn btn-xs"
          onClick={() => void handleDelete()}
          disabled={status !== 'queued' || busy}
          title="只有排队中的任务可取消"
        >
          取消
        </button>
        <button
          type="button"
          className="btn btn-xs btn-danger"
          onClick={() => void handleDelete()}
          disabled={(status !== 'succeeded' && status !== 'failed') || busy}
          title="只有成功或失败的任务可删除"
        >
          删除
        </button>
      </div>
      {actionError && <p className="mt-1 text-[10px] leading-snug text-rose-300">{actionError}</p>}
    </NodeShell>
  );
});

/* ───────────────────────  任务列表  ─────────────────────── */

export const TaskListNode = memo(function TaskListNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const update = useGraph((s) => s.updateNodeParams);
  const tasks = useGraph((s) => s.tasks);
  const setTasks = useGraph((s) => s.setTasks);
  const [busy, setBusy] = useState(false);

  const taskType = String(data.params.taskType ?? 'all');
  const filtered = useMemo(
    () => (taskType === 'all' ? tasks : tasks.filter((t) => t.taskType === taskType)),
    [taskType, tasks],
  );

  const load = useCallback(
    async (remote: boolean) => {
      setBusy(true);
      try {
        const result = await api.listTasks({ pageSize: 20, remote });
        setTasks(result.items);
      } catch {
        // 忽略，任务中心有统一提示
      } finally {
        setBusy(false);
      }
    },
    [setTasks],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <NodeShell id={id} type={data.kind} data={data} selected={selected} width={244} title="任务列表">
      <div className="mb-1.5 flex items-center gap-1">
        <select
          className="!border-0 !bg-transparent !p-0 !text-[10px] !text-mist-300 outline-none"
          value={taskType}
          onChange={(event) => update(id, { taskType: event.target.value })}
        >
          <option value="all">全部类型</option>
          <option value="generation">视频生成</option>
          <option value="h3_context_ir">Context-IR</option>
          <option value="regeneration">再生成</option>
        </select>
        <button type="button" className="ml-auto text-[10px] text-mist-400 hover:text-mist-100" onClick={() => void load(false)} disabled={busy}>
          本地
        </button>
        <button type="button" className="text-[10px] text-mist-400 hover:text-mist-100" onClick={() => void load(true)} disabled={busy}>
          远端
        </button>
      </div>

      <div className="max-h-[132px] space-y-0.5 overflow-auto">
        {filtered.length === 0 && <p className="text-[10px] text-mist-400">暂无任务</p>}
        {filtered.slice(0, 12).map((task) => (
          <div key={task.id} className="flex items-center gap-1.5 text-[10px]">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                background:
                  task.status === 'succeeded'
                    ? '#22c55e'
                    : task.status === 'failed'
                      ? '#f43f5e'
                      : task.status === 'running'
                        ? '#3b82f6'
                        : task.status === 'cancelled'
                          ? '#fb923c'
                          : '#60a5fa',
              }}
            />
            <span className="mono truncate text-mist-300">#{task.id.slice(-8)}</span>
            <span className="ml-auto shrink-0 text-mist-400">
              {task.resolution} {task.duration ? `${task.duration}s` : ''}
            </span>
          </div>
        ))}
      </div>
    </NodeShell>
  );
});

/* ───────────────────────  注册表  ─────────────────────── */

export const nodeTypes: Record<NodeKind, React.ComponentType<NodeProps<CanvasNode>>> = {
  prompt: PromptNode,
  image: ImageNode,
  video: VideoNode,
  audio: AudioNode,
  frameRole: FrameRoleNode,
  videoGen: VideoGenNode,
  contextIR: ContextIRNode,
  regenerate: RegenerateNode,
  taskStatus: TaskStatusNode,
  taskList: TaskListNode,
};

export { CONTENT_ROLES, MODEL_CAPABILITIES, coerceRatio, rolesForCount };
