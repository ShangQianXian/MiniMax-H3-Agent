/**
 * 画布桥：把 React Flow 实例暴露给画布外/画布边缘的 UI（例如底部工具栏的「添加节点」菜单）。
 *
 * 为什么不直接用 useReactFlow：底部工具栏必须渲染在 ReactFlow 子树里才能复用同一个实例，
 * 而菜单需要挂在按钮上方且不被节点层裁剪，用一个小桥接更简单也更可控。
 */
import { create } from 'zustand';
import type { XYPosition } from '@xyflow/react';
import { nodeDef, type NodeKind } from '@h3/shared';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CanvasBridgeState {
  /** 画布视口的屏幕坐标矩形 */
  rect: Rect | null;
  /** 把屏幕坐标换算成画布坐标 */
  toFlowPosition: ((point: { x: number; y: number }) => XYPosition) | null;
  /** 让画布把某点居中（添加节点后定位用） */
  fitBoundsOf: ((nodeId: string) => void) | null;

  register: (input: { rect: Rect; toFlowPosition: (point: { x: number; y: number }) => XYPosition }) => void;
  unregister: () => void;
  setRect: (rect: Rect) => void;
  /** 在画布可视区中心添加一个节点，返回节点 id */
  addNodeAtCenter: (kind: NodeKind, params?: Record<string, unknown>) => string | null;
}

/** 让 store 能拿到 graph store 的 addNode（避免循环依赖，用 setter 注入） */
let addNodeImpl: ((kind: NodeKind, position: XYPosition, params?: Record<string, unknown>) => string) | null = null;

export function bindAddNode(
  impl: (kind: NodeKind, position: XYPosition, params?: Record<string, unknown>) => string,
): void {
  addNodeImpl = impl;
}

export const useCanvasBridge = create<CanvasBridgeState>((set, get) => ({
  rect: null,
  toFlowPosition: null,
  fitBoundsOf: null,

  register: ({ rect, toFlowPosition }) => set({ rect, toFlowPosition }),
  unregister: () => set({ rect: null, toFlowPosition: null }),
  setRect: (rect) => set({ rect }),

  addNodeAtCenter: (kind, params) => {
    const { rect, toFlowPosition } = get();
    if (!rect || !toFlowPosition || !addNodeImpl) return null;
    // 落在可视区中心，并稍微上移一点避免被底部创作台压住
    const center = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2 - 60,
    };
    const position = toFlowPosition(center);
    return addNodeImpl(kind, { x: position.x - 110, y: position.y - 20 }, { ...nodeDef(kind).defaultParams(), ...params });
  },
}));
