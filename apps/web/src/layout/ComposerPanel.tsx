import { useEffect, useMemo, useRef, useState } from 'react';
import { MEDIA_LIMITS, RATIO_META, TEXT_MAX_CHARS, coerceRatio, formatCny, type H3Model } from '@h3/shared';
import { useComposer, makeComposerMedia, materializeToCanvas, planMaterialize } from '../store/composer.ts';
import { useGraph } from '../store/graph.ts';
import { useSettingsPanel } from '../store/settings-panel.ts';
import { useCanvasBridge } from '../canvas/canvas-bridge.ts';
import { resolveNodeSlots } from '../engine/resolve.ts';
import { estimateNode } from '../engine/estimate.ts';
import { isBusy, runNodes } from '../engine/run-controls.ts';
import { api } from '../api/client.ts';
import { fileToOutcome, formatBytes, willExceedBodyLimit } from '../lib/media.ts';
import { GenerationControls, type GenerationValues } from './GenerationControls.tsx';
import { Icon } from './Icon.tsx';

export function ComposerPanel() {
  const draft = useComposer();
  const { text, media, presetId, model, resolution, duration, ratio, sound, targetNodeId, setText, setParam } = draft;
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const selectedNodeId = useGraph((s) => s.selectedNodeId);
  const workflowId = useGraph((s) => s.activeWorkflowId);
  const running = useGraph((s) => s.run.running);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const uploadingRef = useRef(false);
  const submittingRef = useRef(false);
  const previousWorkflow = useRef(workflowId);
  const selectionKey = useRef('');
  const target = nodes.find((n) => n.id === targetNodeId && n.data.kind === 'videoGen');
  const existingSlots = target ? resolveNodeSlots(target.id, nodes, edges) : null;
  const textOnly = presetId === '全能参考' && media.length === 0 && !existingSlots?.media.length && !existingSlots?.frames.length;

  useEffect(() => {
    if (previousWorkflow.current !== workflowId) {
      useComposer.getState().setTarget(null, false);
      useComposer.getState().reset();
      selectionKey.current = '';
      setError(null);
      setNotice(null);
      previousWorkflow.current = workflowId;
    }
  }, [workflowId]);

  // Runtime polling must not overwrite edits to the draft parameters.
  useEffect(() => {
    if (targetNodeId && !nodes.some((n) => n.id === targetNodeId)) draft.setTarget(null, false);
    const selected = nodes.find((n) => n.id === selectedNodeId && n.data.kind === 'videoGen');
    if (!selected) { selectionKey.current = ''; return; }
    const key = `${selected.id}:${JSON.stringify(selected.data.params)}`;
    if (key === selectionKey.current) return;
    selectionKey.current = key;
    draft.setTarget(selected.id, false);
    draft.applyFromNode(selected);
  }, [nodes, selectedNodeId, targetNodeId]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node) && !(event.target as HTMLElement).closest('[data-generation-trigger]')) setSettingsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSettingsOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [settingsOpen]);

  const estimate = useMemo(() => {
    const slots = target ? resolveNodeSlots(target.id, nodes, edges) : {
      text: null, frames: [], media: [], upstreamNodeIds: [], upstreamVideoUrl: null,
      upstreamTaskId: null, upstreamTaskStatus: null, warnings: [],
    };
    return estimateNode({ id: '__draft__', type: 'videoGen', position: { x: 0, y: 0 },
      data: { kind: 'videoGen', label: '视频生成', params: { model, resolution, duration, ratio, presetId, sound } },
    }, { ...slots, media: [...slots.media, ...media.map((m) => ({ ref: {
      id: m.id, kind: m.kind, source: 'remote' as const, url: m.url, mime: m.mime ?? '',
      ...(m.durationSec !== undefined ? { durationSec: m.durationSec } : {}),
    } }))] });
  }, [target, nodes, edges, media, model, resolution, duration, ratio, presetId, sound]);
  const canSend = (text.trim().length > 0 || media.length > 0) && text.length <= TEXT_MAX_CHARS && !busy && !submitting && !running;

  const handleFiles = async (files: File[]) => {
    if (uploadingRef.current || submittingRef.current) return;
    uploadingRef.current = true;
    setBusy(true);
    setError(null);
    const projectId = useGraph.getState().activeProjectId;
    const originWorkflow = useGraph.getState().activeWorkflowId;
    try {
      for (const file of files) {
        const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : 'image';
        const limits = MEDIA_LIMITS[kind];
        if (!(limits.mimeTypes as readonly string[]).includes(file.type)) throw new Error(`不支持「${file.name}」的格式，请使用 JPG、PNG、WebP、HEIC、MP4、MOV、WAV 或 MP3。`);
        if (file.size > limits.maxBytes || willExceedBodyLimit(file.size)) throw new Error(`「${file.name}」过大，请先压缩或裁剪后再上传。`);
        const outcome = await fileToOutcome(file, kind);
        const uploaded = await api.uploadAsset({ file, kind, projectId });
        if (useGraph.getState().activeWorkflowId !== originWorkflow) return;
        draft.addMedia([makeComposerMedia({ kind, url: outcome.url, assetId: uploaded.asset.id,
          mime: outcome.mime, bytes: outcome.bytes, name: outcome.name, ...outcome.probe })]);
        if (outcome.warning) setNotice(outcome.warning);
      }
    } catch (cause) { setError((cause as Error).message); }
    finally { uploadingRef.current = false; setBusy(false); }
  };

  const submit = async () => {
    if (!canSend || submittingRef.current || uploadingRef.current || isBusy()) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSettingsOpen(false);
    setError(null);
    setNotice(null);
    try {
      const bridge = useCanvasBridge.getState();
      const anchor = bridge.rect && bridge.toFlowPosition ? bridge.toFlowPosition({
        x: bridge.rect.left + Math.max(40, (bridge.rect.width - 700) / 2), y: bridge.rect.top + 100,
      }) : { x: 80, y: 80 };
      if (!target && nodes.length > 0) {
        anchor.x = Math.max(anchor.x, ...nodes.map((node) => node.position.x + (node.measured?.width ?? 284))) + 120;
      }
      const sendDraft = textOnly ? { ...draft, presetId: '文生视频', ratio: coerceRatio('文生视频', ratio) } : draft;
      const targetId = materializeToCanvas(planMaterialize({ draft: sendDraft, targetNodeId: target?.id ?? null, anchor }));
      bridge.fitBoundsOf?.(targetId);
      draft.setTarget(targetId, true);
      draft.reset();
      const result = await runNodes([targetId]);
      if (result.summary || result.failed.length) setError(result.summary || result.failed[0]!.message);
      else setNotice(result.ok && result.createdTaskIds?.length ? '生成任务已完成，可在画布查看结果。' : '已保留到画布，可在节点上继续生成。');
    } catch (cause) { setError((cause as Error).message); }
    finally { submittingRef.current = false; setSubmitting(false); }
  };

  const change = ({ presetId: nextPreset, ...patch }: Partial<GenerationValues>) => {
    if (nextPreset) draft.setPreset(nextPreset);
    setParam(patch);
  };

  return (
    <div className="composer-positioner">
      {settingsOpen && <div ref={settingsRef} className="composer-settings" role="dialog" aria-label="生成参数">
        <div className="settings-heading"><span>生成参数</span><button type="button" className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="关闭生成参数"><Icon name="close" /></button></div>
        <GenerationControls value={draft} onChange={change} />
      </div>}
      <div ref={panelRef} className={`composer-panel ${expanded ? 'is-expanded' : ''} ${dragging ? 'is-dragging' : ''}`} aria-label="视频创作台"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFiles(Array.from(e.dataTransfer.files)); }}>
        <div className="composer-header">
          <span className="composer-eyebrow">{target ? '继续创作' : '视频创作'}</span>
          {target && <button type="button" className="target-chip" onClick={() => { draft.setTarget(null, false); useGraph.getState().setSelectedNode(null); }}>已关联 · {target.data.label} <Icon name="close" size={12} /></button>}
          <button type="button" className="guide-link" onClick={() => useSettingsPanel.getState().openGuide()}>H3 创作指南 ↗</button>
          <button type="button" className="icon-button" title={expanded ? '收起输入区' : '展开输入区'} aria-label={expanded ? '收起输入区' : '展开输入区'} onClick={() => setExpanded(!expanded)}><Icon name="expand" size={19} /></button>
        </div>
        <div className="composer-media">
          {media.map((item, index) => <div key={item.id} className="media-thumbnail" title={`${item.name ?? item.kind} · ${formatBytes(item.bytes)}`}>
            {item.kind === 'image' && <img src={item.url} alt={item.name ?? '参考图片'} />}
            {item.kind === 'video' && <video src={item.url} muted preload="metadata" />}
            {item.kind === 'audio' && <Icon name="wave" size={28} />}
            <span className="media-role">{presetId === '首尾帧' && item.kind === 'image' ? (index === 0 ? '首帧' : '尾帧') : `参考 ${index + 1}`}</span>
            <button type="button" className="media-remove" aria-label={`移除 ${item.name ?? '素材'}`} onClick={() => draft.removeMedia(item.id)}><Icon name="close" size={12} /></button>
          </div>)}
          <button type="button" className="media-add" onClick={() => fileRef.current?.click()} disabled={busy || submitting} title="添加参考图 / 视频 / 音频" aria-label="添加参考素材"><Icon name="plus" size={24} />{media.length === 0 && <span>{busy ? '上传中…' : '添加素材'}</span>}</button>
          {media.length === 0 && <div className="media-help">让画面从一个想法开始<span>{textOnly && text.trim() ? `仅文本将生成 ${coerceRatio('文生视频', ratio)} 视频；添加素材可启用参考` : '上传参考素材，或直接写下你的创意'}</span></div>}
        </div>
        <textarea className="composer-prompt" aria-label="视频提示词" placeholder="描述你想生成的画面、动作和镜头语言…"
          value={text} onChange={(e) => { setText(e.target.value); setError(null); }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} />
        <div className="composer-counter"><span>Ctrl + Enter 生成</span><span className={text.length > TEXT_MAX_CHARS ? 'text-rose-400' : ''}>T <i /> {text.length.toLocaleString()} / 7,000</span></div>
        <div className="composer-footer">
          <div className="composer-model"><Icon name="wave" /><select value={model} aria-label="模型" onChange={(e) => setParam({ model: e.target.value as H3Model })}><option value="MiniMax-H3">MiniMax H3</option><option value="MiniMax-H3-Max">MiniMax H3 Max</option></select></div>
          <span className="toolbar-divider" />
          <button type="button" className="parameter-summary" data-generation-trigger aria-expanded={settingsOpen} aria-label="设置生成参数" onClick={() => { useSettingsPanel.getState().close(); setSettingsOpen(!settingsOpen); }}>
            {presetId}<span>·</span>{RATIO_META[ratio]?.label}<span>·</span>{resolution}<span>·</span>{duration}s<Icon name="chevron" size={14} />
          </button>
          <span className="output-count" title="单次生成 1 个视频">× 1</span>
          <div className="composer-submit-group"><span className="composer-cost" title={estimate.breakdown.items.map((i) => `${i.label} ${formatCny(i.amount)}`).join(' · ')}><Icon name="spark" size={16} /><span><small>预估</small>{formatCny(estimate.breakdown.total)}</span></span>
            <button type="button" className="send-button" disabled={!canSend} onClick={() => void submit()} aria-label="生成视频" title="生成视频（Ctrl+Enter）">{busy || submitting ? <span className="loading-ring" /> : <Icon name="arrow" size={22} />}</button>
          </div>
        </div>
        {(error || notice || text.length > TEXT_MAX_CHARS) && <div className={`composer-message ${error || text.length > TEXT_MAX_CHARS ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error ?? (text.length > TEXT_MAX_CHARS ? '提示词超过 7,000 字符，请精简后生成。' : notice)}<button type="button" aria-label="关闭提示" onClick={() => { setError(null); setNotice(null); }}><Icon name="close" size={14} /></button></div>}
      </div>
      <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,audio/wav,audio/mpeg" className="hidden" onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) void handleFiles(files); }} />
    </div>
  );
}
