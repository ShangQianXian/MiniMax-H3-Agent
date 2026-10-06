import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FRAME_SHEET_COLUMNS, FRAME_SHEET_SIZE, type VideoMetadata } from '@h3/shared';
import { api } from '../api/client.ts';
import { useGraph } from '../store/graph.ts';
import type { MediaPreviewProps } from './MediaPreview.tsx';
import { SelectedFramePlayer } from './SelectedFramePlayer.tsx';

type ExportResult = Awaited<ReturnType<typeof api.exportVideoFrames>>;

/** All decoded frames are reachable in one scroll area; only visible rows enter the DOM. */
export function FrameWorkspace({ onClose, ...props }: MediaPreviewProps & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const gallery = useRef<HTMLDivElement>(null);
  const workflowId = useRef(useGraph.getState().activeWorkflowId);
  const anchor = useRef<number | null>(null);
  const exporting = useRef(false);
  const [assetId, setAssetId] = useState('');
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [current, setCurrent] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [added, setAdded] = useState(false);
  const [viewport, setViewport] = useState({ width: 1000, height: 384, top: 0 });
  const [sheets, setSheets] = useState<Record<number, 'ready' | 'error'>>({});
  const [sheetRetry, setSheetRetry] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [previewing, setPreviewing] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(''); setMetadata(null);
    void (async () => {
      try {
        let id = props.assetId || /^\/api\/assets\/([^/]+)\/content/.exec(props.src)?.[1];
        if (!id && props.taskId) id = (await api.saveArtifact(props.taskId)).asset.id;
        if (!id) throw new Error('视频尚未转存到本地，请先转存后重试。');
        const response = await api.videoMetadata(id);
        if (cancelled) return;
        setAssetId(id); setMetadata(response.metadata); setEnd(response.metadata.frameCount);
      } catch (cause) { if (!cancelled) setError((cause as Error).message); }
    })();
    return () => { cancelled = true; };
  }, [props.assetId, props.src, props.taskId, retry]);

  useEffect(() => {
    const element = gallery.current;
    if (!element) return;
    const measure = () => setViewport({ width: element.clientWidth || 1000,
      height: element.clientHeight || 384, top: element.scrollTop });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [metadata]);

  const thumbnailWidth = 160 * zoom / 100;
  const availableWidth = Math.max(1, viewport.width - 24);
  const columns = Math.max(1, Math.floor((availableWidth + 12) / (thumbnailWidth + 14)));
  const imageWidth = Math.max(1, Math.min(thumbnailWidth, (availableWidth - (columns - 1) * 12) / columns - 2));
  const imageHeight = Math.ceil(imageWidth * 9 / 16);
  const cardHeight = imageHeight + 28;
  const rowHeight = cardHeight + 12;
  const previousLayout = useRef({ columns, rowHeight });
  const count = metadata?.frameCount ?? 0;
  useLayoutEffect(() => {
    const previous = previousLayout.current;
    previousLayout.current = { columns, rowHeight };
    const element = gallery.current;
    if (!element || (previous.columns === columns && previous.rowHeight === rowHeight)) return;
    const topFrame = Math.min(count - 1, Math.floor(Math.max(0, viewport.top - 12) / previous.rowHeight) * previous.columns);
    element.scrollTop = Math.max(0, Math.floor(topFrame / columns) * rowHeight + 12);
    setViewport((old) => ({ ...old, top: element.scrollTop }));
  }, [columns, rowHeight, count, viewport.top]);
  const first = Math.floor(Math.max(0, viewport.top - 12) / rowHeight);
  const from = Math.max(0, first - 2) * columns;
  const to = Math.min(count, (first + Math.ceil(viewport.height / rowHeight) + 2) * columns);
  const visible = Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
  const pages = [...new Set(visible.map((frame) => Math.floor(frame / FRAME_SHEET_SIZE)))];
  const chosen = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);
  useEffect(() => {
    if (!chosen.length) { setPlaying(false); setPreviewing(false); }
  }, [chosen]);
  const validRange = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 1 && end <= count && start <= end;
  const setSheet = (page: number, state: 'ready' | 'error') => setSheets((old) => old[page] === state ? old : { ...old, [page]: state });
  const sheetUrl = (page: number) => `${api.videoFrameSheetUrl(assetId, page)}?retry=${sheetRetry}`;
  const reveal = (frame: number) => {
    const element = gallery.current;
    if (!element) return;
    const top = Math.floor(frame / columns) * rowHeight + 12;
    if (top < element.scrollTop || top + rowHeight > element.scrollTop + element.clientHeight) element.scrollTop = top;
    setViewport((old) => ({ ...old, top: element.scrollTop }));
  };
  const seek = (frame: number, scroll = false) => {
    if (!metadata || !Number.isFinite(frame)) return;
    setPlaying(false); setPreviewing(false);
    const next = Math.max(0, Math.min(count - 1, Math.round(frame)));
    setCurrent(next);
    if (video.current) { video.current.pause(); video.current.currentTime = metadata.frameTimes[next]!; }
    if (scroll) reveal(next);
  };
  const togglePlayback = () => {
    if (!chosen.length) return;
    video.current?.pause();
    setPreviewing(true); setPlaying((old) => !old);
  };
  const returnToSource = () => {
    setPlaying(false); setPreviewing(false);
    if (video.current && metadata) video.current.currentTime = metadata.frameTimes[current]!;
  };
  const selectFrame = (frame: number, range: boolean) => {
    // Capture the anchor before React evaluates the state updater.
    const previousAnchor = anchor.current;
    setSelected((old) => {
      const next = new Set(old);
      const value = !old.has(frame);
      const begin = range && previousAnchor !== null ? Math.min(previousAnchor, frame) : frame;
      const finish = range && previousAnchor !== null ? Math.max(previousAnchor, frame) : frame;
      for (let i = begin; i <= finish; i++) { if (value) next.add(i); else next.delete(i); }
      return next;
    });
    anchor.current = frame;
  };
  const exportFrames = async () => {
    if (!chosen.length || exporting.current) return;
    exporting.current = true; setBusy(true); setError(''); setResult(null); setAdded(false);
    try { setResult(await api.exportVideoFrames(assetId, { frames: chosen })); }
    catch (cause) { setError((cause as Error).message); }
    finally { exporting.current = false; setBusy(false); }
  };
  const addToCanvas = () => {
    const graph = useGraph.getState();
    if (!result || added) return;
    if (!graph.activeWorkflowId || graph.activeWorkflowId !== workflowId.current) {
      setError('工作流已切换，导出视频已保存在素材库，可下载后使用。'); return;
    }
    const source = graph.nodes.find((node) => node.id === props.nodeId);
    graph.addNode('video', { x: (source?.position.x ?? 100) + 340, y: source?.position.y ?? 100 }, {
      url: result.dataUri, assetId: result.asset.id, name: result.asset.originalName,
      mime: result.asset.mime, bytes: result.asset.bytes, width: result.metadata.width,
      height: result.metadata.height, durationSec: result.metadata.durationSec,
    });
    setAdded(true);
  };

  return createPortal(<dialog ref={dialog} className="media-dialog frame-workspace" aria-label="逐帧分解"
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}
    onKeyDown={(event) => event.stopPropagation()}>
    <header>
      <div><strong>逐帧分解</strong><p>{props.name || '生成结果'}{metadata && ` · ${metadata.width} × ${metadata.height} · ${count} 帧 · ${metadata.fps.toFixed(3).replace(/\.?0+$/, '')} fps`}</p></div>
      <button className="btn" disabled={busy} onClick={onClose}>返回视频</button>
    </header>
    <div className="frame-source-player">
      <video ref={video} hidden={previewing} src={assetId ? api.assetContentUrl(assetId) : props.src} controls playsInline preload="metadata" aria-label="原视频"
        onTimeUpdate={(event) => {
          if (!metadata || previewing) return;
          const time = event.currentTarget.currentTime;
          let low = 0; let high = count;
          while (low < high) { const middle = Math.floor((low + high) / 2); if (metadata.frameTimes[middle]! <= time + 0.00001) low = middle + 1; else high = middle; }
          setCurrent(Math.max(0, low - 1));
        }} />
      {previewing && metadata && chosen.length > 0 && <SelectedFramePlayer assetId={assetId} frames={chosen} fps={metadata.fps}
        playing={playing} onFrame={setCurrent} />}
    </div>
    {!metadata && !error && <div className="frame-workspace-loading" role="status">正在解码视频，读取每一帧…</div>}
    {metadata && <>
      <div className="frame-gallery-toolbar">
        <div className="frame-gallery-heading"><strong>全部帧 <span>{count}</span></strong>
          <div className="frame-gallery-preview-actions">
            <button className="btn btn-xs" disabled={!chosen.length} onClick={togglePlayback}>{playing ? '暂停预览' : '播放所选帧'}</button>
            {previewing && <button className="btn btn-xs" onClick={returnToSource}>返回原视频</button>}
            <span>{previewing ? `循环预览 · ${metadata.fps.toFixed(2).replace(/\.?0+$/, '')} fps · 无音频` : '单击定位 · 勾选保留 · 双击放大'}</span>
          </div>
          <div className="frame-thumbnail-zoom">
            <label htmlFor="frame-thumbnail-zoom">缩略图大小</label>
            <button className="btn btn-xs" aria-label="缩小帧图片" disabled={zoom <= 75} onClick={() => setZoom((n) => Math.max(75, n - 25))}>−</button>
            <input id="frame-thumbnail-zoom" type="range" min={75} max={200} step={25} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
            <button className="btn btn-xs" aria-label="放大帧图片" disabled={zoom >= 200} onClick={() => setZoom((n) => Math.min(200, n + 25))}>＋</button>
            <output htmlFor="frame-thumbnail-zoom">{zoom}%</output>
          </div>
        </div>
        <div className="frame-gallery-actions">
          <button className="btn btn-xs" disabled={busy} onClick={() => setSelected(new Set(Array.from({ length: count }, (_, i) => i)))}>全选</button>
          <button className="btn btn-xs" disabled={busy || !selected.size} onClick={() => { setSelected(new Set()); anchor.current = null; }}>清空选择</button>
          <button className="btn btn-xs" disabled={busy} onClick={() => setSelected(new Set(Array.from({ length: count }, (_, i) => i).filter((i) => !selected.has(i))))}>反选</button>
          <span className="frame-toolbar-divider" />
          <label>从 <input className="field" aria-label="选帧起点" type="number" min={1} max={count} value={Number.isNaN(start) ? '' : start} disabled={busy} onChange={(event) => setStart(event.target.valueAsNumber)} /></label>
          <label>至 <input className="field" aria-label="选帧终点" type="number" min={1} max={count} value={Number.isNaN(end) ? '' : end} disabled={busy} onChange={(event) => setEnd(event.target.valueAsNumber)} /></label>
          <button className="btn btn-xs" disabled={busy || !validRange} onClick={() => setSelected((old) => new Set([...old, ...Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i)]))}>选中范围</button>
          <label className="frame-locate">当前帧 <input className="field" aria-label="定位帧" type="number" min={1} max={count} value={current + 1} onChange={(event) => seek(event.target.valueAsNumber - 1, true)} /></label>
        </div>
      </div>
      <div ref={gallery} className="frame-gallery" role="region" aria-label="全部视频帧" onScroll={(event) => {
        const top = event.currentTarget.scrollTop; setViewport((old) => ({ ...old, top }));
      }}>
        {pages.map((page) => <img key={`${page}:${sheetRetry}`} className="frame-sheet-loader" src={sheetUrl(page)} alt="" aria-hidden="true"
          onLoad={() => setSheet(page, 'ready')} onError={() => setSheet(page, 'error')} />)}
        <div className="frame-grid-space" style={{ height: Math.ceil(count / columns) * rowHeight + 24 }}>
          <div className="frame-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: cardHeight, top: Math.floor(from / columns) * rowHeight + 12 }}>
            {visible.map((frame) => {
              const page = Math.floor(frame / FRAME_SHEET_SIZE);
              const offset = frame % FRAME_SHEET_SIZE;
              return <div key={frame} className="frame-card" data-selected={selected.has(frame)} data-current={frame === current}>
                <button className="frame-thumbnail" style={{ height: imageHeight }} aria-label={`查看第 ${frame + 1} 帧`} onClick={() => seek(frame)}
                  onDoubleClick={() => { video.current?.pause(); setLightbox(frame); }}>
                  {sheets[page] === 'ready' ? <span role="img" aria-label={`第 ${frame + 1} 帧缩略图`} style={{ width: imageWidth, height: imageHeight, backgroundImage: `url("${sheetUrl(page)}")`,
                    backgroundPosition: `${offset % FRAME_SHEET_COLUMNS * 100 / (FRAME_SHEET_COLUMNS - 1)}% ${Math.floor(offset / FRAME_SHEET_COLUMNS) * 100 / (FRAME_SHEET_SIZE / FRAME_SHEET_COLUMNS - 1)}%` }} /> :
                    <span className="frame-thumbnail-placeholder">{sheets[page] === 'error' ? '读取失败' : '读取中…'}</span>}
                  {frame === current && <span className="frame-current-marker">当前</span>}
                </button>
                <div className="frame-card-caption"><label><input type="checkbox" aria-label={`选择第 ${frame + 1} 帧`} checked={selected.has(frame)} disabled={busy}
                  onChange={(event) => selectFrame(frame, (event.nativeEvent as MouseEvent).shiftKey ?? false)} />
                  <span>#{String(frame + 1).padStart(3, '0')}</span></label><time>{metadata.frameTimes[frame]!.toFixed(3)} s</time></div>
              </div>;
            })}
          </div>
        </div>
      </div>
      {pages.some((page) => sheets[page] === 'error') && <div className="media-dialog-error" role="alert">部分缩略图读取失败
        <button className="btn btn-xs" onClick={() => { setSheets({}); setSheetRetry((n) => n + 1); }}>重试缩略图</button></div>}
      <footer className="frame-export-bar">
        <div><strong>已选 {selected.size} / {count} 帧 <span>· {(selected.size / metadata.fps).toFixed(3)} 秒</span></strong>
          <p>按原顺序、原帧率导出 MP4，保留原分辨率；不含音频。</p></div>
        <button className="btn btn-primary" disabled={busy || !selected.size} onClick={() => void exportFrames()}>{busy ? '正在导出…' : `导出所选帧${selected.size ? `（${selected.size}）` : ''}`}</button>
      </footer>
    </>}
    {error && <div className="media-dialog-error" role="alert">{error}{!metadata && <button className="btn btn-xs" onClick={() => setRetry((n) => n + 1)}>重试</button>}</div>}
    {result && <div className="media-dialog-result" role="status"><span>已导出 {result.metadata.frameCount} 帧：{result.asset.originalName}</span>
      <a className="btn" href={api.assetContentUrl(result.asset.id)} download={result.asset.originalName}>下载视频</a>
      <button className="btn" disabled={added} onClick={addToCanvas}>{added ? '已添加到画布' : '添加到画布'}</button></div>}
    {lightbox !== null && metadata && <FrameLightbox assetId={assetId} metadata={metadata} frame={lightbox} selected={selected.has(lightbox)} busy={busy}
      onMove={(frame) => { setLightbox(frame); seek(frame, true); }} onSelect={() => selectFrame(lightbox, false)} onClose={() => setLightbox(null)} />}
  </dialog>, document.body);
}

function FrameLightbox({ assetId, metadata, frame, selected, busy, onMove, onSelect, onClose }: {
  assetId: string; metadata: VideoMetadata; frame: number; selected: boolean; busy: boolean;
  onMove: (frame: number) => void; onSelect: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [fit, setFit] = useState(true);
  const [loaded, setLoaded] = useState('');
  const [failed, setFailed] = useState('');
  const [retry, setRetry] = useState(0);
  const src = `${api.videoFrameUrl(assetId, frame)}?retry=${retry}`;
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="media-dialog frame-lightbox" aria-label="单帧查看"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'ArrowLeft' && frame > 0) { event.preventDefault(); onMove(frame - 1); }
      if (event.key === 'ArrowRight' && frame < metadata.frameCount - 1) { event.preventDefault(); onMove(frame + 1); }
    }}>
    <header><div><strong>第 {frame + 1} 帧 / {metadata.frameCount}</strong><p>{metadata.frameTimes[frame]!.toFixed(3)} 秒 · {metadata.width} × {metadata.height}</p></div>
      <div className="media-dialog-buttons"><button className="btn btn-xs" onClick={() => setFit(!fit)}>{fit ? '原始尺寸 · 100%' : '适应窗口'}</button>
        <button className="btn" onClick={onClose}>返回全部帧</button></div></header>
    <div className="media-viewport" data-fit={fit}>
      <img key={src} src={src} alt={`第 ${frame + 1} 帧原图`} style={{ width: metadata.width, height: metadata.height, visibility: loaded === src ? 'visible' : 'hidden' }}
        onLoad={() => setLoaded(src)} onError={() => setFailed(src)} />
      {loaded !== src && <div className="frame-loading">{failed === src ? <div>原图读取失败 <button className="btn" onClick={() => setRetry((n) => n + 1)}>重试原图</button></div> : '正在读取原始帧…'}</div>}
    </div>
    <footer className="frame-lightbox-controls"><button className="btn" disabled={frame === 0} onClick={() => onMove(frame - 1)}>上一帧</button>
      <button className="btn" disabled={busy} aria-pressed={selected} onClick={onSelect}>{selected ? '取消选择此帧' : '选择此帧'}</button>
      <button className="btn" disabled={frame === metadata.frameCount - 1} onClick={() => onMove(frame + 1)}>下一帧</button></footer>
  </dialog>;
}
