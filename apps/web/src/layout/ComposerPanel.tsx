/**
 * 创作台 —— 对齐参考图 2 的那块大输入面板。
 *
 * 结构（自上而下）：
 *   素材缩略图条（选中态带描边）+ 虚线「+」添加
 *   提示词输入区（占满高度、无边框）
 *   右下角 字符计数
 *   底部一行：MiniMax H3 │ 全能参考 · 3:4 · 768P · 8s │ ×1 ｜ 有声 ｜ ✳ 费用 ｜ ↑ 发送
 *
 * 它本身不是画布节点：点发送时把草稿落地成画布节点并连线，画布始终是唯一事实来源。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RATIO_META,
  SOUND_DIRECTIVES,
  coerceRatio,
  formatCny,
  isRatioAllowed,
  presetById,
  type H3Model,
  type Ratio,
  type Resolution,
  type SoundMode,
} from '@h3/shared';
import {
  useComposer,
  composerMode,
  makeComposerMedia,
  materializeToCanvas,
  planMaterialize,
} from '../store/composer.ts';
import { useGraph } from '../store/graph.ts';
import { useSettingsPanel } from '../store/settings-panel.ts';
import { resolveNodeSlots } from '../engine/resolve.ts';
import { estimateNode } from '../engine/estimate.ts';
import { runNodes } from '../engine/run-controls.ts';
import { api, ApiRequestError } from '../api/client.ts';
import { classNames, fileToOutcome, formatBytes } from '../lib/media.ts';

const TEXT_LIMIT = 7000;

export function ComposerPanel() {
  const text = useComposer((s) => s.text);
  const setText = useComposer((s) => s.setText);
  const media = useComposer((s) => s.media);
  const addMedia = useComposer((s) => s.addMedia);
  const removeMedia = useComposer((s) => s.removeMedia);
  const presetId = useComposer((s) => s.presetId);
  const model = useComposer((s) => s.model);
  const resolution = useComposer((s) => s.resolution);
  const duration = useComposer((s) => s.duration);
  const ratio = useComposer((s) => s.ratio);
  const sound = useComposer((s) => s.sound);
  const setParam = useComposer((s) => s.setParam);
  const targetNodeId = useComposer((s) => s.targetNodeId);
  const setTarget = useComposer((s) => s.setTarget);
  const reset = useComposer((s) => s.reset);

  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const selectedNodeId = useGraph((s) => s.selectedNodeId);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* 画布选中生成节点时，创作台自动跟随并带出它的参数 */
  useEffect(() => {
    const selected = nodes.find((n) => n.id === selectedNodeId);
    if (!selected) return;
    if (
      selected.data.kind !== 'videoGen' &&
      selected.data.kind !== 'contextIR' &&
      selected.data.kind !== 'regenerate'
    ) {
      return;
    }
    setTarget(selected.id, false);
    if (selected.data.kind === 'videoGen') useComposer.getState().applyFromNode(selected);
  }, [nodes, selectedNodeId, setTarget]);

  const mode = composerMode(presetId, media);
  const preset = presetById(presetId);
  const targetNode = targetNodeId ? nodes.find((n) => n.id === targetNodeId) : null;

  /* 预估费用：有目标节点时按真实上游解析，否则按创作台参数粗算 */
  const estimate = useMemo(() => {
    if (targetNode && targetNode.data.kind === 'videoGen') {
      return estimateNode(targetNode, resolveNodeSlots(targetNode.id, nodes, edges));
    }
    return estimateNode(
      {
        id: '__draft__',
        type: 'videoGen',
        position: { x: 0, y: 0 },
        data: {
          kind: 'videoGen',
          label: '视频生成',
          params: { model, resolution, duration, ratio, aigcWatermark: false, presetId, sound },
        },
      },
      {
        text: text.trim() ? { text } : null,
        frames: [],
        media: media.map((m) => ({
          ref: {
            id: m.id,
            kind: m.kind,
            source: 'remote' as const,
            url: m.url,
            mime: m.mime ?? '',
            ...(m.durationSec !== undefined ? { durationSec: m.durationSec } : {}),
          },
        })),
        upstreamNodeIds: [],
        upstreamVideoUrl: null,
        upstreamTaskId: null,
        upstreamTaskStatus: null,
        warnings: [],
      },
    );
  }, [duration, edges, media, model, nodes, presetId, ratio, resolution, sound, targetNode, text]);

  const canSend = text.trim().length > 0 || media.length > 0;

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      setBusy(true);
      setError(null);
      try {
        const projectId = useGraph.getState().activeProjectId;
        const created = [];
        for (const file of Array.from(files)) {
          const kind: 'image' | 'video' | 'audio' = file.type.startsWith('video')
            ? 'video'
            : file.type.startsWith('audio')
              ? 'audio'
              : 'image';
          const uploaded = await api.uploadAsset({ file, kind, projectId });
          const outcome = await fileToOutcome(file, kind);
          created.push(
            makeComposerMedia({
              kind,
              url: outcome.url,
              assetId: uploaded.asset.id,
              mime: outcome.mime,
              bytes: outcome.bytes,
              name: outcome.name,
              ...(outcome.probe.width !== undefined ? { width: outcome.probe.width } : {}),
              ...(outcome.probe.height !== undefined ? { height: outcome.probe.height } : {}),
              ...(outcome.probe.durationSec !== undefined ? { durationSec: outcome.probe.durationSec } : {}),
            }),
          );
          if (outcome.warning) setNotice(outcome.warning);
        }
        addMedia(created);
      } catch (cause) {
        setError(cause instanceof ApiRequestError ? cause.message : (cause as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [addMedia],
  );

  const materialize = useCallback(
    (run: boolean) => {
      const plan = planMaterialize({
        draft: { text, media, presetId, model, resolution, duration, ratio, aigcWatermark: false, sound },
        targetNodeId,
        anchor: { x: 80, y: 80 },
      });
      const finalTargetId = materializeToCanvas(plan);
      setTarget(finalTargetId, true);
      reset();
      setNotice(run ? '已落地到画布并开始执行。' : '已落地到画布。');
      if (run) {
        void runNodes([finalTargetId]).then((result) => {
          if (result.summary) setError(result.summary);
          else if (result.failed.length > 0) setError(result.failed[0]!.message);
        });
      }
      setTimeout(() => setNotice(null), 3200);
    },
    [duration, media, model, presetId, ratio, reset, resolution, setTarget, sound, text, targetNodeId],
  );

  /* 比例只在当前生成方式允许时出现：图生视频只剩「自适应」 */
  const ratioOptions = (Object.keys(RATIO_META) as Ratio[]).filter((key) => isRatioAllowed(presetId, key));

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-16">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer.files.length > 0) void handleFiles(event.dataTransfer.files);
        }}
        className={classNames(
          'pointer-events-auto flex h-[324px] w-full max-w-[900px] flex-col rounded-2xl border bg-ink-900/95 p-3 shadow-2xl backdrop-blur',
          dragging ? 'border-accent-500' : 'border-ink-600',
        )}
      >
        {/* 素材缩略图条 */}
        <div className="flex shrink-0 items-start gap-2">
          {media.map((item) => (
            <div
              key={item.id}
              className="group relative h-[62px] w-[62px] shrink-0 overflow-hidden rounded-xl border border-mist-200/60 bg-ink-800"
              title={`${item.name ?? item.kind}${item.bytes ? ` · ${formatBytes(item.bytes)}` : ''}`}
            >
              {item.kind === 'image' && (
                <img src={item.url} alt={item.name ?? ''} className="h-full w-full object-cover" />
              )}
              {item.kind === 'video' && <video src={item.url} className="h-full w-full bg-black object-cover" muted />}
              {item.kind === 'audio' && (
                <span className="grid h-full w-full place-items-center text-[18px] text-amber-300">♪</span>
              )}
              <button
                type="button"
                className="absolute right-0 top-0 hidden h-4 w-4 place-items-center rounded-bl-md bg-black/75 text-[10px] text-mist-100 group-hover:grid"
                onClick={() => removeMedia(item.id)}
                title="移除"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="grid h-[62px] w-[62px] shrink-0 place-items-center rounded-xl border border-dashed border-ink-500 text-[22px] text-mist-400 transition-colors hover:border-mist-300 hover:text-mist-100"
            onClick={() => fileRef.current?.click()}
            title="添加参考图 / 视频 / 音频"
            disabled={busy}
          >
            ＋
          </button>
        </div>

        {/* 提示词 */}
        <textarea
          className="mt-3 min-h-0 flex-1 resize-none bg-transparent text-[14px] leading-relaxed text-mist-100 outline-none placeholder:text-mist-400"
          placeholder="描述你要生成的内容或探索H3创作指南 ↗"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              if (canSend) materialize(true);
            }
          }}
        />

        {/* 右下角字符计数 */}
        <div className="flex shrink-0 items-center justify-end gap-1 text-[11px] text-mist-400">
          <span className="text-mist-500">T</span>
          <span className={classNames(text.length > TEXT_LIMIT && 'text-rose-400')}>
            {text.length} / {TEXT_LIMIT}
          </span>
        </div>

        {/* 底部一行 */}
        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-ink-700/70 pt-2.5 text-[12px] text-mist-200">
          <select
            className="!border-0 !bg-transparent !p-0 !text-[12px] !text-mist-200 outline-none"
            value={model}
            onChange={(event) => setParam({ model: event.target.value as H3Model })}
            title="模型"
          >
            <option value="MiniMax-H3">MiniMax H3</option>
            <option value="MiniMax-H3-Max">MiniMax H3 Max</option>
          </select>

          <span className="text-mist-500">│</span>

          <button
            type="button"
            className="text-[12px] text-mist-200 hover:text-white"
            onClick={() => {
              if (targetNodeId) useSettingsPanel.getState().open(targetNodeId);
              else setNotice('先在画布上点一下视频节点，或直接发送以新建一个');
            }}
            title="生成方式：在节点上弹出完整设置面板"
          >
            {preset?.label ?? '全能参考'}
          </button>

          <span className="text-mist-500">·</span>

          <select
            className="!border-0 !bg-transparent !p-0 !text-[12px] !text-mist-200 outline-none disabled:opacity-50"
            value={ratio}
            disabled={ratioOptions.length <= 1}
            onChange={(event) => setParam({ ratio: coerceRatio(presetId, event.target.value as Ratio) })}
            title={ratioOptions.length <= 1 ? '图生视频的宽高比由输入图片决定，只能是「自适应」' : '宽高比'}
          >
            {ratioOptions.map((key) => (
              <option key={key} value={key}>
                {RATIO_META[key].label}
              </option>
            ))}
          </select>

          <span className="text-mist-500">·</span>

          <select
            className="!border-0 !bg-transparent !p-0 !text-[12px] !text-mist-200 outline-none"
            value={resolution}
            onChange={(event) => setParam({ resolution: event.target.value as Resolution })}
            title="清晰度"
          >
            <option value="768P">768P</option>
            <option value="2K" disabled={model === 'MiniMax-H3-Max'}>
              2K
            </option>
            <option value="480P" disabled={model === 'MiniMax-H3'}>
              480P
            </option>
          </select>

          <span className="text-mist-500">·</span>

          <select
            className="!border-0 !bg-transparent !p-0 !text-[12px] !text-mist-200 outline-none"
            value={duration}
            onChange={(event) => setParam({ duration: Number(event.target.value) })}
            title="时长"
          >
            {Array.from({ length: 12 }, (_, i) => i + 4).map((value) => (
              <option key={value} value={value} disabled={model === 'MiniMax-H3-Max' && value === 4}>
                {value}s
              </option>
            ))}
          </select>

          <span className="text-mist-500">│</span>

          <span className="text-mist-400">× {Math.max(1, media.length)}</span>

          <button
            type="button"
            className="ml-auto text-[12px] text-mist-300 hover:text-white"
            onClick={() => setParam({ sound: (sound === '有声' ? '无声' : '有声') as SoundMode })}
            title={SOUND_DIRECTIVES[sound].hint}
          >
            {sound}
          </button>

          <span
            className="flex items-center gap-1 text-[12px] text-mist-200"
            title={
              estimate.kind === 'none'
                ? '当前参数无需计费'
                : estimate.breakdown.items.map((i) => `${i.label} ${formatCny(i.amount)}`).join(' · ')
            }
          >
            <span className="text-mist-400">✳</span>
            {formatCny(estimate.breakdown.total)}
          </span>

          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-full border border-ink-600 text-[13px] text-mist-200 transition-colors hover:bg-ink-700 disabled:opacity-35"
            disabled={!canSend}
            onClick={() => materialize(true)}
            title="落地到画布并立即执行（Ctrl+Enter）"
          >
            ↑
          </button>
        </div>

        {(error || notice) && (
          <p
            className={classNames(
              'mt-1.5 shrink-0 rounded-md border p-1.5 text-[11px] leading-snug',
              error
                ? 'border-rose-500/40 bg-rose-500/5 text-rose-300'
                : 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300',
            )}
          >
            {error ?? notice}
          </p>
        )}

        {mode === 'r2va' && preset && preset.mode !== 'r2va' && (
          <p className="mt-1 shrink-0 text-[10px] text-amber-300">
            检测到参考视频 / 音频，会按多模态参考（r2va）发送。
          </p>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,video/mp4,video/quicktime,audio/wav,audio/mpeg"
        className="hidden"
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length > 0) void handleFiles(files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
