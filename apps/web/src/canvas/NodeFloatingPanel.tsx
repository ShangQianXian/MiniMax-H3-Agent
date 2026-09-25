/**
 * 浮层锚定：把节点弹出的面板渲染到 document.body，并按节点在屏幕上的位置定位。
 *
 * 为什么要 portal：面板如果渲染在节点内部，它就只是画布层的子元素，
 * 必然被底部的创作台（画布层的兄弟、z-index 更高）压住。
 * portal 到 body + 跟随节点屏幕坐标，才能保证它真正浮在最上层。
 *
 * 拖动：抓面板顶部即可移动。
 * 抓手层必须 pointer-events:none —— 否则它会吃掉落在该区域里的按钮
 * （曾经把右上角的关闭按钮彻底挡死）。拖动本身由容器自己的 pointer 事件驱动，
 * 抓手只负责提供光标与命中区域提示。
 *
 * 尺寸：纵向参数面板最多 420px，高度超出视口时可内部滚动。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, useViewport } from '@xyflow/react';
import { useCanvasBridge } from './canvas-bridge.ts';
import { useSettingsPanel } from '../store/settings-panel.ts';

/** 与创作台参数弹窗保持同一宽度。 */
const PREFERRED_WIDTH = 420;
const VIEWPORT_MARGIN = 12;
const GAP = 10;
/** 顶部可拖动区域的高度 */
const DRAG_ZONE_HEIGHT = 40;

interface Props {
  nodeId: string;
  children: React.ReactNode;
  /** 面板内容变化时重新量高（例如切换生成方式导致比例项增减） */
  deps?: unknown[];
}

export function NodeFloatingPanel({ nodeId, children, deps = [] }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: PREFERRED_WIDTH, height: 0 });
  /** 用户拖动产生的屏幕坐标偏移 */
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  /**
   * 注意：这里刻意拆成几个原始值订阅。
   * 如果在一个 selector 里返回新对象，zustand 每次都会认为「变了」→ 无限重渲染。
   */
  const x = useStore((state) => state.nodeLookup.get(nodeId)?.internals.positionAbsolute.x ?? null);
  const y = useStore((state) => state.nodeLookup.get(nodeId)?.internals.positionAbsolute.y ?? null);
  const nodeHeight = useStore((state) => state.nodeLookup.get(nodeId)?.measured?.height ?? 0);

  const viewport = useViewport();
  const canvasRect = useCanvasBridge((s) => s.rect);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const resize = () => setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useSettingsPanel.getState().close();
    };
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('resize', resize); window.removeEventListener('keydown', onKey); };
  }, []);

  /* 量真实尺寸：既要决定「往下弹还是往上弹」，也要按视口宽度自适应 */
  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    // 没有 ResizeObserver 的环境（jsdom / 老浏览器）退化为只量一次，不影响主流程
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, ...deps]);

  /* 切换节点时把偏移清零，避免上一个节点拖走的位置影响新节点 */
  useEffect(() => {
    setDragOffset({ x: 0, y: 0 });
    dragState.current = null;
  }, [nodeId]);

  const onDragStart = useCallback(
    (event: React.PointerEvent) => {
      // 落在控件上的按下不进入拖动，交给控件自己处理
      if ((event.target as HTMLElement).closest('button, input, select, textarea, a, summary, label')) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragState.current = {
        startX: event.clientX,
        startY: event.clientY,
        baseX: dragOffset.x,
        baseY: dragOffset.y,
      };
    },
    [dragOffset.x, dragOffset.y],
  );

  const onDragMove = useCallback((event: React.PointerEvent) => {
    const state = dragState.current;
    if (!state) return;
    event.stopPropagation();
    setDragOffset({
      x: state.baseX + (event.clientX - state.startX),
      y: state.baseY + (event.clientY - state.startY),
    });
  }, []);

  const onDragEnd = useCallback(() => {
    dragState.current = null;
  }, []);

  if (x === null || y === null) return null;

  const screenLeft = x * viewport.zoom + viewport.x + (canvasRect?.left ?? 0);
  const screenTop = y * viewport.zoom + viewport.y + (canvasRect?.top ?? 0);
  const screenBottom = screenTop + nodeHeight * viewport.zoom;

  const viewportWidth = windowSize.width;
  const viewportHeight = windowSize.height;
  const maxHeight = viewportHeight - VIEWPORT_MARGIN * 2;

  // 宽度自适应视口，但不超过首选宽度
  const availableWidth = Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2);
  const panelWidth = Math.min(PREFERRED_WIDTH, availableWidth);

  const anchorLeft = screenLeft + dragOffset.x;
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - panelWidth - VIEWPORT_MARGIN);
  const left = Math.min(Math.max(VIEWPORT_MARGIN, anchorLeft), maxLeft);

  // 优先向下弹；下方空间不够就向上弹
  const spaceBelow = viewportHeight - (screenBottom + dragOffset.y) - VIEWPORT_MARGIN;
  const openUp = spaceBelow < Math.min(size.height, viewportHeight * 0.6) + GAP && screenTop + dragOffset.y > size.height + GAP;
  const top = openUp
    ? Math.max(VIEWPORT_MARGIN, screenTop + dragOffset.y - size.height - GAP)
    : Math.min(screenBottom + dragOffset.y + GAP, Math.max(VIEWPORT_MARGIN, viewportHeight - size.height - VIEWPORT_MARGIN));

  return createPortal(
    <div
      ref={wrapperRef}
      className="nowheel fixed z-[40]"
      role="dialog"
      aria-label="视频节点参数"
      style={{ left, top, width: panelWidth, maxHeight }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {/* 抓手层：提供光标反馈，但事件上完全透明，不会挡住关闭按钮 */}
      <div
        className="absolute inset-x-0 top-0 z-10 cursor-grab touch-none select-none active:cursor-grabbing"
        style={{ height: DRAG_ZONE_HEIGHT, pointerEvents: 'none' }}
        title="拖动可移动面板"
      />

      <div
        className="node-settings-surface overflow-y-auto"
        style={{ maxHeight }}
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
