// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinalConnectionState, ReactFlowProps } from '@xyflow/react';
import { useGraph, type CanvasEdge, type CanvasNode } from '../store/graph.ts';
import { FlowCanvas } from './FlowCanvas.tsx';
import { DisconnectableEdge } from './DisconnectableEdge.tsx';

const flow = vi.hoisted(() => ({
  props: {} as ReactFlowProps<CanvasNode, CanvasEdge>,
  api: {
    screenToFlowPosition: (point: { x: number; y: number }) => ({ x: point.x / 2 - 100, y: point.y / 2 - 50 }),
    fitView: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(), zoomTo: vi.fn(),
  },
}));

vi.mock('@xyflow/react', async (importOriginal) => ({
  ...await importOriginal<typeof import('@xyflow/react')>(),
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: (props: ReactFlowProps<CanvasNode, CanvasEdge>) => {
    flow.props = props;
    return createElement('div', { className: 'react-flow__pane', 'data-testid': 'pane' }, props.children);
  },
  Background: () => null,
  MiniMap: () => null,
  EdgeToolbar: ({ children, isVisible }: { children: ReactNode; isVisible: boolean }) => isVisible ? children : null,
  BaseEdge: () => null,
  useReactFlow: () => flow.api,
  useViewport: () => ({ x: 0, y: 0, zoom: 2 }),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  useGraph.setState({ nodes: [], edges: [], past: [], future: [], selectedNodeId: null, activeWorkflowId: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function dragFrom(nodeId: string, id: string, type: 'source' | 'target', options: { valid?: boolean; target?: Element; touch?: boolean; cancelled?: boolean } = {}) {
  const target = options.target ?? screen.getByTestId('pane');
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => target) });
  act(() => flow.props.onConnectStart?.(new MouseEvent('mousedown'), { nodeId, handleId: id, handleType: type }));
  if (options.cancelled) fireEvent.keyDown(window, { key: 'Escape' });
  const event = options.touch
    ? Object.assign(new Event('touchend'), { changedTouches: [{ clientX: 800, clientY: 400 }] }) as unknown as TouchEvent
    : new MouseEvent('mouseup', { clientX: 800, clientY: 400 });
  act(() => flow.props.onConnectEnd?.(event, {
    isValid: options.valid ?? false,
    fromHandle: { nodeId, id, type },
  } as FinalConnectionState));
}

describe('画布连线交互', () => {
  it('拖至空白只列兼容节点，搜索并回车在缩放后的落点创建和连接', () => {
    const id = useGraph.getState().addNode('prompt', { x: 0, y: 0 });
    render(createElement(FlowCanvas));
    dragFrom(id, 'out', 'source');
    const dialog = screen.getByRole('dialog', { name: '添加并连接节点' });
    expect(within(dialog).queryByRole('button', { name: /^图片/ })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /^任务列表/ })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索节点' }), { target: { value: '视频生成' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const graph = useGraph.getState();
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[1]).toMatchObject({ data: { kind: 'videoGen' }, position: { x: 300, y: 90 } });
    expect(graph.edges[0]).toMatchObject({ source: id, target: graph.nodes[1]!.id, targetHandle: 'text' });
  });

  it('从输入口反向拖动，触摸落点也能创建上游', () => {
    const id = useGraph.getState().addNode('videoGen', { x: 500, y: 0 });
    render(createElement(FlowCanvas));
    dragFrom(id, 'text', 'target', { touch: true });
    fireEvent.click(screen.getByRole('button', { name: /^提示词 文本/ }));
    expect(useGraph.getState().edges[0]).toMatchObject({ target: id, targetHandle: 'text', sourceHandle: 'out' });
    expect(useGraph.getState().nodes[1]!.data.kind).toBe('prompt');
  });

  it('同一节点的多个兼容端口单独列出，选择后接入正确端口', () => {
    const id = useGraph.getState().addNode('videoGen', { x: 0, y: 0 });
    render(createElement(FlowCanvas));
    dragFrom(id, 'video', 'source');
    expect(screen.getByRole('button', { name: /^视频再生成 源素材/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^视频再生成 原任务素材/ }));
    expect(useGraph.getState().edges[0]!.targetHandle).toBe('frames');
  });

  it('搜索框里 Esc 取消，不遗留节点或历史；拖线中 Esc 也不会打开菜单', () => {
    const id = useGraph.getState().addNode('prompt', { x: 0, y: 0 });
    render(createElement(FlowCanvas));
    const history = useGraph.getState().past.length;
    dragFrom(id, 'out', 'source');
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    dragFrom(id, 'out', 'source', { cancelled: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useGraph.getState().nodes).toHaveLength(1);
    expect(useGraph.getState().past).toHaveLength(history);
  });

  it('连到已有节点、落在节点或画布外均不打开菜单', () => {
    const id = useGraph.getState().addNode('prompt', { x: 0, y: 0 });
    render(createElement(FlowCanvas));
    dragFrom(id, 'out', 'source', { valid: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    dragFrom(id, 'out', 'source', { target: document.createElement('div') });
    expect(screen.queryByRole('dialog')).toBeNull();
    dragFrom(id, 'out', 'source', { target: document.body });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['Delete', 'Backspace'])('按 %s 只删除选中连线，输入文字时不影响画布', (key) => {
    const graph = useGraph.getState();
    const source = graph.addNode('prompt', { x: 0, y: 0 });
    graph.addConnectedNode('videoGen', { x: 400, y: 0 }, { nodeId: source, handleId: 'out', handleType: 'source' }, 'text');
    useGraph.setState({ nodes: useGraph.getState().nodes.map((node) => ({ ...node, selected: false })), edges: useGraph.getState().edges.map((edge) => ({ ...edge, selected: true })) });
    render(createElement(FlowCanvas));
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key });
    input.remove();
    expect(useGraph.getState().edges).toHaveLength(1);
    fireEvent.keyDown(window, { key });
    expect(useGraph.getState().edges).toHaveLength(0);
    expect(useGraph.getState().nodes).toHaveLength(2);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(useGraph.getState().edges).toHaveLength(1);
  });

  it('切换工作流会关闭待创建菜单', () => {
    const id = useGraph.getState().addNode('prompt', { x: 0, y: 0 });
    render(createElement(FlowCanvas));
    dragFrom(id, 'out', 'source');
    act(() => useGraph.setState({ activeWorkflowId: 'other' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('点击断开连接按钮保留两端节点，支持撤销', () => {
    const graph = useGraph.getState();
    const source = graph.addNode('prompt', { x: 0, y: 0 });
    graph.addConnectedNode('videoGen', { x: 400, y: 0 }, { nodeId: source, handleId: 'out', handleType: 'source' }, 'text');
    const edge = useGraph.getState().edges[0]!;
    render(createElement(DisconnectableEdge, { ...edge, selected: true, sourceX: 0, sourceY: 0, targetX: 400, targetY: 0 } as Parameters<typeof DisconnectableEdge>[0]));
    fireEvent.click(screen.getByRole('button', { name: '× 断开连接' }));
    expect(useGraph.getState().nodes).toHaveLength(2);
    expect(useGraph.getState().edges).toHaveLength(0);
    act(() => graph.undo());
    expect(useGraph.getState().edges).toEqual([edge]);
  });
});
