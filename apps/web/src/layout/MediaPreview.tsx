import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { VideoMetadata } from '@h3/shared';
import { api, type AssetRecord } from '../api/client.ts';
import { useGraph } from '../store/graph.ts';
import { FrameWorkspace } from './FrameWorkspace.tsx';

export interface MediaPreviewProps {
  src: string;
  kind: 'image' | 'video';
  name?: string;
  assetId?: string;
  taskId?: string;
  nodeId?: string;
}
type Props = MediaPreviewProps;

/** Canvas thumbnails use intrinsic aspect ratios; the dialog offers unscaled pixel dimensions. */
export function MediaPreview(props: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<'view' | 'edit' | 'frames' | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const open = (next: 'view' | 'edit' | 'frames') => { video.current?.pause(); setMode(next); };
  useEffect(() => { setSize({ width: 0, height: 0 }); setMode(null); }, [props.src]);
  return <div className="media-preview nodrag nopan nowheel" onClick={(event) => event.stopPropagation()}>
    {props.kind === 'image' ? <img src={props.src} alt={props.name ?? '图片'} draggable={false}
      onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      onDoubleClick={() => setMode('view')} /> :
      <video ref={video} src={props.src} controls muted playsInline preload="metadata"
        onLoadedMetadata={(event) => setSize({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })} />}
    <div className="media-preview-actions">
      <span>{size.width > 0 ? `${size.width} × ${size.height}` : '读取尺寸…'}</span>
      <button type="button" className="btn btn-xs" onClick={() => open('view')}>原始尺寸</button>
      {props.kind === 'video' && (props.assetId || props.taskId || props.src.startsWith('/api/assets/')) &&
        <><button type="button" className="btn btn-xs" onClick={() => open('frames')}>逐帧分解</button>
          <button type="button" className="btn btn-xs" onClick={() => open('edit')}>按帧剪辑</button></>}
    </div>
    {mode === 'frames' ? <FrameWorkspace {...props} onClose={() => setMode(null)} /> :
      mode && <MediaDialog key={`${props.src}:${mode}`} {...props} initialMode={mode} size={size} onClose={() => setMode(null)} />}
  </div>;
}

export function MediaDialog({ initialMode, size, onClose, ...props }: Props & {
  initialMode: 'view' | 'edit'; size: { width: number; height: number }; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [fit, setFit] = useState(initialMode === 'edit');
  const [editing, setEditing] = useState(initialMode === 'edit');
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [assetId, setAssetId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [current, setCurrent] = useState(1);
  const [displayFrame, setDisplayFrame] = useState(1);
  const [frameReady, setFrameReady] = useState(false);
  const [frameError, setFrameError] = useState(false);
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(1);
  const [result, setResult] = useState<AssetRecord | null>(null);
  const [added, setAdded] = useState(false);
  const [decomposing, setDecomposing] = useState(false);
  const workflowId = useRef(useGraph.getState().activeWorkflowId);
  const exported = useRef<Awaited<ReturnType<typeof api.trimVideo>> | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    setError(''); setMetadata(null);
    void (async () => {
      try {
        let id = props.assetId || /^\/api\/assets\/([^/]+)\/content/.exec(props.src)?.[1];
        if (!id && props.taskId) id = (await api.saveArtifact(props.taskId)).asset.id;
        if (!id) throw new Error('视频尚未转存到本地，请先转存后重试。');
        const response = await api.videoMetadata(id);
        if (cancelled) return;
        setAssetId(id); setMetadata(response.metadata); setCurrent(1); setStart(1); setEnd(response.metadata.frameCount);
      } catch (cause) { if (!cancelled) setError((cause as Error).message); }
    })();
    return () => { cancelled = true; };
  }, [editing, props.assetId, props.src, props.taskId, retry]);

  useEffect(() => {
    if (current === displayFrame) return;
    const timer = setTimeout(() => { setFrameReady(false); setFrameError(false); setDisplayFrame(current); }, 120);
    return () => clearTimeout(timer);
  }, [current, displayFrame]);

  const max = metadata?.frameCount ?? 1;
  const valid = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 1 && end <= max && start <= end;
  const seek = (frame: number) => { if (Number.isFinite(frame)) setCurrent(Math.max(1, Math.min(max, Math.round(frame)))); };
  const exportClip = async () => {
    if (!valid || !metadata || busy) return;
    setBusy(true); setError(''); setResult(null); setAdded(false);
    try {
      const response = await api.trimVideo(assetId, { startFrame: start - 1, endFrame: end });
      exported.current = response;
      setResult(response.asset);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const addToCanvas = () => {
    const response = exported.current;
    const graph = useGraph.getState();
    if (!response || added) return;
    if (graph.activeWorkflowId !== workflowId.current || !graph.activeWorkflowId) {
      setError('工作流已切换，剪辑已保存在素材库，可通过下方链接下载。'); return;
    }
    const source = graph.nodes.find((node) => node.id === props.nodeId);
    graph.addNode('video', { x: (source?.position.x ?? 100) + 340, y: source?.position.y ?? 100 }, {
      url: response.dataUri, assetId: response.asset.id, name: response.asset.originalName,
      mime: response.asset.mime, bytes: response.asset.bytes, width: response.metadata.width,
      height: response.metadata.height, durationSec: response.metadata.durationSec,
    });
    setAdded(true);
  };
  const width = metadata?.width ?? size.width;
  const height = metadata?.height ?? size.height;
  const dimensions = { width: width || undefined, height: height || undefined };
  const clipDuration = metadata && valid ? (metadata.frameTimes[end] ?? metadata.durationSec) - metadata.frameTimes[start - 1]! : 0;

  if (decomposing) return <FrameWorkspace {...props} onClose={onClose} />;

  return createPortal(<dialog ref={dialog} className="media-dialog" aria-label={editing ? '按帧剪辑' : '原始尺寸预览'}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (!editing || !metadata || busy || /INPUT|TEXTAREA|BUTTON/.test((event.target as HTMLElement).tagName)) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); seek(current + (event.key === 'ArrowRight' ? 1 : -1));
      }
    }}>
    <header>
      <div><strong>{editing ? '按帧剪辑' : '原始尺寸预览'}</strong><p>{props.name || '生成结果'}{width > 0 && ` · ${width} × ${height}`}</p></div>
      <div className="media-dialog-buttons">
        <button type="button" className="btn btn-xs" onClick={() => setFit(!fit)}>{fit ? '原始尺寸 · 100%' : '适应窗口'}</button>
        {props.kind === 'video' && <button type="button" className="btn btn-xs" disabled={busy} onClick={() => {
          dialog.current?.querySelector('video')?.pause(); setDecomposing(true);
        }}>逐帧分解</button>}
        {!editing && props.kind === 'video' && <button type="button" className="btn btn-xs" onClick={() => { setEditing(true); setFit(true); }}>按帧剪辑</button>}
        <button type="button" className="btn" disabled={busy} onClick={onClose} aria-label="关闭预览">关闭</button>
      </div>
    </header>
    <div className="media-viewport" data-fit={fit} tabIndex={0} aria-label="媒体预览，方向键逐帧移动">
      {editing ? metadata && assetId ? <>
        <img key={`${assetId}:${displayFrame}`} src={api.videoFrameUrl(assetId, displayFrame - 1)}
          alt={`第 ${displayFrame} 帧`} style={{ ...dimensions, visibility: frameReady && displayFrame === current ? 'visible' : 'hidden' }}
          onLoad={() => { setFrameReady(true); setFrameError(false); }} onError={() => { setFrameReady(false); setFrameError(true); }} />
        {(!frameReady || displayFrame !== current) && <span className="frame-loading">{frameError ? '此帧读取失败，请切换一帧后重试' : '正在读取帧…'}</span>}
      </> : <span className="frame-loading">{error ? '暂时无法读取视频' : '正在读取真实帧信息…'}</span> :
        props.kind === 'image' ? <img src={props.src} alt={props.name ?? '图片原始尺寸'} style={dimensions} /> :
          <video src={props.src} controls playsInline style={dimensions} />}
    </div>
    {editing && metadata && <section className="frame-editor">
      <div className="frame-editor-meta"><span>{metadata.frameCount} 帧 · {metadata.fps.toFixed(3).replace(/\.?0+$/, '')} fps · {metadata.hasAudio ? '含音频' : '无音频'}</span>
        <span>帧编号从 1 开始，起止帧均保留</span></div>
      <input type="range" aria-label="逐帧时间轴" min={1} max={max} step={1} value={current} disabled={busy}
        onChange={(event) => seek(Number(event.target.value))} />
      <div className="frame-editor-controls">
        <button type="button" className="btn" disabled={busy || current <= 1} onClick={() => seek(current - 1)}>上一帧</button>
        <label>当前帧 <input type="number" className="field" aria-label="当前帧" min={1} max={max} step={1} value={current} disabled={busy}
          onChange={(event) => seek(Number(event.target.value))} /></label>
        <button type="button" className="btn" disabled={busy || current >= max} onClick={() => seek(current + 1)}>下一帧</button>
        <span>{metadata.frameTimes[current - 1]?.toFixed(3)} s</span>
      </div>
      <div className="frame-editor-controls">
        <label>起始帧 <input type="number" className="field" min={1} max={max} step={1} value={Number.isNaN(start) ? '' : start} disabled={busy}
          onChange={(event) => setStart(event.target.valueAsNumber)} /></label>
        <button type="button" className="btn btn-xs" disabled={busy} onClick={() => setStart(current)}>当前帧设为起点</button>
        <label>结束帧 <input type="number" className="field" min={1} max={max} step={1} value={Number.isNaN(end) ? '' : end} disabled={busy}
          onChange={(event) => setEnd(event.target.valueAsNumber)} /></label>
        <button type="button" className="btn btn-xs" disabled={busy} onClick={() => setEnd(current)}>当前帧设为终点</button>
        <button type="button" className="btn btn-xs" disabled={busy} onClick={() => { setStart(1); setEnd(max); }}>重置范围</button>
      </div>
      <div className="frame-editor-footer">
        <span>{valid ? `保留 ${end - start + 1} 帧 · ${clipDuration.toFixed(3)} 秒 · 原分辨率导出` : '请输入有效帧范围：1 ≤ 起始帧 ≤ 结束帧 ≤ 总帧数'}</span>
        <button type="button" className="btn btn-primary" disabled={busy || !valid} onClick={() => void exportClip()}>{busy ? '正在导出…' : '导出剪辑'}</button>
      </div>
      <p className="frame-editor-note">导出为新 MP4，保留原视频和对应音频；逐帧精确裁切会重新编码。</p>
    </section>}
    {error && <div className="media-dialog-error" role="alert">{error}
      {!metadata && <button type="button" className="btn btn-xs" onClick={() => setRetry(retry + 1)}>重试</button>}</div>}
    {result && <div className="media-dialog-result" role="status">
      <span>已保存：{result.originalName}</span>
      <a className="btn" href={api.assetContentUrl(result.id)} download={result.originalName}>下载剪辑</a>
      <button type="button" className="btn" disabled={added} onClick={addToCanvas}>{added ? '已添加到画布' : '添加到画布'}</button>
    </div>}
  </dialog>, document.body);
}
