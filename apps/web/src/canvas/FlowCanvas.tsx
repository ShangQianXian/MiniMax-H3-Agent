/**
 * 画布：React Flow 封装 + 拖放建节点 + 快捷键 + 画布内悬浮控件。
 *
 * 控件布局对齐参考图：
 *   右上角 —— 缩放（− 57% ＋）、网格、自动布局、小地图、仅画布
 *   底部居中 —— 新建 / 适应视图 / 创作台 / 导入 / 导出 / 指南
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { NODE_DEFS, isPortCompatible, type NodeKind, type PortKind } from '@h3/shared';
import { autoLayout } from '../engine/layout.ts';
import { useGraph, type CanvasEdge, type CanvasNode } from '../store/graph.ts';
import { useSettingsPanel } from '../store/settings-panel.ts';
import { bindAddNode, useCanvasBridge } from './canvas-bridge.ts';
import { nodeTypes } from '../nodes/index.tsx';
import { NodePickerMenu } from '../layout/NodePickerMenu.tsx';
import { downloadText } from '../lib/media.ts';

export const DRAG_MIME = 'application/h3-node-kind';

function CanvasInner() {
  const { screenToFlowPosition, fitView, zoomIn, zoomOut, zoomTo } = useReactFlow();
  const viewport = useViewport();

  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const onNodesChange = useGraph((s) => s.onNodesChange);
  const onEdgesChange = useGraph((s) => s.onEdgesChange);
  const onConnect = useGraph((s) => s.onConnect);
  const addNode = useGraph((s) => s.addNode);
  const setSelectedNode = useGraph((s) => s.setSelectedNode);
  const removeNodes = useGraph((s) => s.removeNodes);
  const duplicateNode = useGraph((s) => s.duplicateNode);
  const undo = useGraph((s) => s.undo);
  const redo = useGraph((s) => s.redo);
  const exportGraph = useGraph((s) => s.exportGraph);
  const importGraph = useGraph((s) => s.importGraph);
  const workflowName = useGraph((s) => s.workflowName);
  const openGuide = useSettingsPanel((s) => s.openGuide);
  const composerOpen = useSettingsPanel((s) => s.composerOpen);
  const setComposerOpen = useSettingsPanel((s) => s.setComposerOpen);

  const [grid, setGrid] = useState(true);
  const [minimap, setMinimap] = useState(false);
  const [canvasOnly, setCanvasOnly] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  /* 「仅画布」：把左右两侧面板一起收起，最大化画布区域 */
  useEffect(() => {
    document.body.dataset.canvasOnly = canvasOnly ? 'true' : 'false';
  }, [canvasOnly]);

  /**
   * 把画布实例与视口矩形登记到桥接 store，
   * 这样底部的「添加节点」菜单才能把节点加到可视区中心。
   */
  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;

    const sync = () => {
      const rect = element.getBoundingClientRect();
      useCanvasBridge.getState().register({
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        toFlowPosition: (point) => screenToFlowPosition(point),
      });
    };
    sync();

    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => {
      observer.disconnect();
      useCanvasBridge.getState().unregister();
    };
  }, [screenToFlowPosition]);

  /* 让桥接能直接建节点（避免它去 import graph store 造成循环依赖） */
  useEffect(() => {
    bindAddNode((kind, position, params) => useGraph.getState().addNode(kind, position, params));
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData(DRAG_MIME) as NodeKind;
      if (!kind || !(kind in NODE_DEFS)) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode(kind, { x: position.x - 110, y: position.y - 20 });
    },
    [addNode, screenToFlowPosition],
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if ((event.target as HTMLElement).closest('.react-flow__node')) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode('prompt', { x: position.x - 110, y: position.y - 20 });
    },
    [addNode, screenToFlowPosition],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (typing) return;

      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (mod && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
        event.preventDefault();
        redo();
        return;
      }
      if (!mod && event.key === 'Delete') {
        const selected = nodes.filter((n) => n.selected).map((n) => n.id);
        if (selected.length > 0) {
          event.preventDefault();
          removeNodes(selected);
        }
        return;
      }
      if (mod && event.key.toLowerCase() === 'd') {
        const selected = nodes.filter((n) => n.selected)[0];
        if (selected) {
          event.preventDefault();
          duplicateNode(selected.id);
        }
        return;
      }
      if (event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        autoLayout();
        setTimeout(() => fitView({ padding: 0.25, duration: 400 }), 60);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [duplicateNode, fitView, nodes, redo, removeNodes, undo]);

  const zoomPercent = Math.round(viewport.zoom * 100);
  const ctlBtn = 'rounded-md px-1.5 text-[11px]';

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <ReactFlow<CanvasNode, CanvasEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes: NodeChange<CanvasNode>[]) => onNodesChange(changes)}
        onEdgesChange={(changes: EdgeChange<CanvasEdge>[]) => onEdgesChange(changes)}
        onConnect={(connection: Connection) => {
          onConnect(connection);
        }}
        onNodeClick={(_, node) => setSelectedNode(node.id)}
        onPaneClick={() => {
          setSelectedNode(null);
          useSettingsPanel.getState().close();
        }}
        onDoubleClick={handleDoubleClick}
        isValidConnection={(connection) => {
          const source = nodes.find((n) => n.id === connection.source);
          const target = nodes.find((n) => n.id === connection.target);
          if (!source || !target || source.id === target.id) return false;
          const sourceKind = source.data.kind as NodeKind;
          const targetKind = target.data.kind as NodeKind;
          const outPort = NODE_DEFS[sourceKind].outputs.find((p) => p.id === connection.sourceHandle);
          const inPort = NODE_DEFS[targetKind].inputs.find((p) => p.id === connection.targetHandle);
          if (!outPort || !inPort) return false;
          return isPortCompatible(outPort.kind as PortKind, inPort.kind as PortKind);
        }}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        connectionLineStyle={{ stroke: '#60a5fa', strokeWidth: 2 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Control', 'Meta']}
        panOnScroll
        selectionOnDrag
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
      >
        {grid && <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#1b2230" />}

        {minimap && (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            maskColor="rgba(7,9,13,0.75)"
            nodeColor={(node) => NODE_DEFS[(node as CanvasNode).data.kind as NodeKind].accent}
            style={{ width: 168, height: 108, marginBottom: 56 }}
          />
        )}

        {/* 右上角悬浮控件（对齐参考图） */}
        <div className="canvas-controls absolute right-3 top-3 z-20">
          <button type="button" onClick={() => zoomOut({ duration: 160 })} title="缩小">
            −
          </button>
          <button type="button" onClick={() => zoomTo(1, { duration: 200 })} title="重置为 100%">
            {zoomPercent}%
          </button>
          <button type="button" onClick={() => zoomIn({ duration: 160 })} title="放大">
            ＋
          </button>
          <span className="mx-0.5 h-4 w-px bg-ink-700" />
          <button type="button" onClick={() => setGrid((v) => !v)} data-active={grid} title="网格">
            ▦
          </button>
          <button
            type="button"
            onClick={() => {
              autoLayout();
              setTimeout(() => fitView({ padding: 0.25, duration: 400 }), 60);
            }}
            title="自动布局（Shift+L）"
          >
            ⌗
          </button>
          <button type="button" onClick={() => setMinimap((v) => !v)} data-active={minimap} title="小地图">
            ▣
          </button>
          <button
            type="button"
            onClick={() => setCanvasOnly((v) => !v)}
            data-active={canvasOnly}
            title={canvasOnly ? '退出仅画布' : '仅画布（收起两侧面板）'}
          >
            ⛶
          </button>
        </div>

        {/* 底部居中工具栏（对齐参考图） */}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
          <div className="canvas-controls pointer-events-auto !gap-1 !rounded-full !px-2 !py-1.5">
            <button
              type="button"
              className="!h-9 !w-9 !rounded-full !bg-mist-100 !text-[16px] !text-ink-900 hover:!bg-white"
              onClick={() => setPickerOpen((v) => !v)}
              data-active={pickerOpen}
              title="添加节点"
            >
              ＋
            </button>
            <button
              type="button"
              className={ctlBtn}
              onClick={() => fitView({ padding: 0.25, duration: 400 })}
              title="适应视图"
            >
              ⤢
            </button>
            <button
              type="button"
              className={ctlBtn}
              onClick={() => setComposerOpen(!composerOpen)}
              data-active={composerOpen}
              title={composerOpen ? '收起创作台' : '展开创作台'}
            >
              ⌃
            </button>
            <button type="button" className={ctlBtn} onClick={() => fileRef.current?.click()} title="导入工作流 JSON">
              ▤
            </button>
            <button
              type="button"
              className={ctlBtn}
              onClick={() =>
                downloadText(
                  `${workflowName || 'workflow'}.json`,
                  JSON.stringify({ name: workflowName, graph: exportGraph() }, null, 2),
                )
              }
              title="导出工作流 JSON"
            >
              ⤓
            </button>
            <button type="button" className={ctlBtn} onClick={openGuide} title="H3 创作指南">
              ?
            </button>
          </div>
        </div>
      </ReactFlow>

      {/* 「添加节点」菜单：挂在画布容器上，避免被节点层裁剪 */}
      {pickerOpen && <NodePickerMenu onClose={() => setPickerOpen(false)} />}

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          void (async () => {
            try {
              const parsed = JSON.parse(await file.text()) as { graph?: unknown; name?: string };
              const graph = (parsed.graph ?? parsed) as ReturnType<typeof exportGraph>;
              if (graph && Array.isArray(graph.nodes)) {
                await importGraph(graph, parsed.name ?? file.name.replace(/\.json$/i, ''));
              }
            } catch {
              // 顶栏有统一提示
            }
          })();
          event.target.value = '';
        }}
      />
    </div>
  );
}

export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
