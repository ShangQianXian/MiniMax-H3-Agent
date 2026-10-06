import { useEffect, useRef, useState } from 'react';
import { FRAME_SHEET_COLUMNS, FRAME_SHEET_SIZE } from '@h3/shared';
import { api } from '../api/client.ts';

/** Preview decoded frames directly, without exporting or repeatedly seeking an HTML video. */
export function SelectedFramePlayer({ assetId, frames, fps, playing, onFrame }: {
  assetId: string; frames: number[]; fps: number; playing: boolean; onFrame: (frame: number) => void;
}) {
  const [position, setPosition] = useState(0);
  const [retry, setRetry] = useState(0);
  const [revision, setRevision] = useState(0);
  const images = useRef(new Map<number, HTMLImageElement>());
  const errors = useRef(new Set<number>());
  const canvas = useRef<HTMLCanvasElement>(null);
  const cursor = useRef(0);
  const sequence = useRef(frames);
  const callback = useRef(onFrame);
  useEffect(() => { callback.current = onFrame; }, [onFrame]);

  useEffect(() => {
    sequence.current = frames; cursor.current = 0; setPosition(0);
  }, [frames]);

  const index = sequence.current === frames ? Math.min(position, frames.length - 1) : 0;
  const frame = frames[Math.max(0, index)]!;
  const page = Math.floor(frame / FRAME_SHEET_SIZE);
  // Keep just current and next sheets decoded. Long selections do not preload the entire video.
  let nextPage = page;
  for (let step = 1; step <= Math.min(frames.length, Math.ceil(fps)); step++) {
    const candidate = Math.floor(frames[(Math.max(0, index) + step) % frames.length]! / FRAME_SHEET_SIZE);
    if (candidate !== page) { nextPage = candidate; break; }
  }
  useEffect(() => {
    let disposed = false;
    const keep = new Set([page, nextPage]);
    for (const [key, img] of images.current) {
      if (!keep.has(key)) { img.onload = null; img.onerror = null; images.current.delete(key); errors.current.delete(key); }
    }
    for (const key of keep) {
      let img = images.current.get(key);
      if (!img) {
        img = new Image();
        images.current.set(key, img);
        img.src = `${api.videoFrameSheetUrl(assetId, key)}?preview=${retry}`;
      }
      img.onload = () => { if (!disposed) { errors.current.delete(key); setRevision((n) => n + 1); } };
      img.onerror = () => { if (!disposed) { errors.current.add(key); setRevision((n) => n + 1); } };
    }
    return () => { disposed = true; };
  }, [assetId, page, nextPage, retry]);

  const image = images.current.get(page);
  const ready = !!image?.complete && image.naturalWidth > 0;
  const failed = errors.current.has(page) || errors.current.has(nextPage);
  useEffect(() => {
    const img = images.current.get(page);
    const target = canvas.current;
    if (!target || !img?.complete || !img.naturalWidth) return;
    const width = img.naturalWidth / FRAME_SHEET_COLUMNS;
    const height = img.naturalHeight / (FRAME_SHEET_SIZE / FRAME_SHEET_COLUMNS);
    target.width = width; target.height = height;
    const offset = frame % FRAME_SHEET_SIZE;
    target.getContext('2d')?.drawImage(img, offset % FRAME_SHEET_COLUMNS * width,
      Math.floor(offset / FRAME_SHEET_COLUMNS) * height, width, height, 0, 0, width, height);
    callback.current(frame);
  }, [frame, page, revision]);

  useEffect(() => {
    if (!playing || !ready || failed || !frames.length) return;
    let tick = 0;
    let previous = performance.now();
    const interval = 1000 / fps;
    const advance = (now: number) => {
      if (now - previous >= interval) {
        const next = (cursor.current + 1) % frames.length;
        const nextImage = images.current.get(Math.floor(frames[next]! / FRAME_SHEET_SIZE));
        // Wait at a sheet boundary; never show a blank or silently omit a selected frame.
        if (nextImage?.complete && nextImage.naturalWidth > 0) {
          cursor.current = next; setPosition(next);
        }
        previous = now - (now - previous) % interval;
      }
      tick = requestAnimationFrame(advance);
    };
    tick = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(tick);
  }, [frames, fps, playing, ready, failed, revision]);

  useEffect(() => () => {
    for (const img of images.current.values()) { img.onload = null; img.onerror = null; }
    images.current.clear();
  }, []);

  return <div className="selected-frame-player" role="region" aria-label="所选帧循环预览">
    <canvas ref={canvas} role="img" aria-label={`循环预览第 ${frame + 1} 帧`} />
    {(!ready || failed) && <div className="frame-loading">{failed ? <span>预览读取失败 <button className="btn btn-xs" onClick={() => {
      for (const img of images.current.values()) { img.onload = null; img.onerror = null; }
      images.current.clear(); errors.current.clear(); setRetry((n) => n + 1);
    }}>重试预览</button></span> : '正在准备循环预览…'}</div>}
    <span className="selected-frame-position">{playing ? '循环播放' : '已暂停'} · {index + 1} / {frames.length} · 原视频第 {frame + 1} 帧</span>
  </div>;
}
