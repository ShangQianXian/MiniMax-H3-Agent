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
  type OnConnectEnd,
  type XYPosition,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { NODE_DEFS, isPortCompatible, type NodeKind, type PortKind } from '@h3/shared';
import { autoLayout } from '../engine/layout.ts';
import { useGraph, type CanvasEdge, type CanvasNode } from '../store/graph.ts';
import { useSettingsPanel } from '../store/settings-panel.ts';
import { bindAddNode, useCanvasBridge } from './canvas-bridge.ts';
import { nodeTypes } from '../nodes/index.tsx';
import { Icon } from '../layout/Icon.tsx';
import { NodePickerMenu } from '../layout/NodePickerMenu.tsx';
import { downloadText } from '../lib/media.ts';
import { DisconnectableEdge } from './DisconnectableEdge.tsx';
import type { ConnectionOrigin } from './connections.ts';

export const DRAG_MIME = 'application/h3-node-kind';
const edgeTypes = { default: DisconnectableEdge };

interface ConnectionPicker {
  origin: ConnectionOrigin;
  position: XYPosition;
  anchor: XYPosition;
  portKind: PortKind;
  label: string;
}

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
  const removeElements = useGraph((s) => s.removeElements);
  const duplicateNode = useGraph((s) => s.duplicateNode);
  const undo = useGraph((s) => s.undo);
  const redo = useGraph((s) => s.redo);
  const exportGraph = useGraph((s) => s.exportGraph);
  const importGraph = useGraph((s) => s.importGraph);
  const workflowName = useGraph((s) => s.workflowName);
  const workflowId = useGraph((s) => s.activeWorkflowId);
  const openGuide = useSettingsPanel((s) => s.openGuide);
  const composerOpen = useSettingsPanel((s) => s.composerOpen);
  const setComposerOpen = useSettingsPanel((s) => s.setComposerOpen);

  const [grid, setGrid] = useState(true);
  const [minimap, setMinimap] = useState(true);
  const [canvasOnly, setCanvasOnly] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connectionPicker, setConnectionPicker] = useState<ConnectionPicker | null>(null);
  const connectionCancelled = useRef(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setConnectionPicker(null);
    wrapperRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    setPickerOpen(false);
    setConnectionPicker(null);
    connectionCancelled.current = true;
  }, [workflowId]);

  useEffect(() => {
    if (connectionPicker && !nodes.some((node) => node.id === connectionPicker.origin.nodeId)) closePicker();
  }, [nodes, connectionPicker, closePicker]);

  const handleConnectEnd = useCallback<OnConnectEnd>((event, connection) => {
    if (connectionCancelled.current || event.type === 'touchcancel' || connection.isValid || !connection.fromHandle) return;
    const point = 'changedTouches' in event ? event.changedTouches[0] : event;
    if (!point) return;
    // 触摸结束事件仍指向起点，用实际落点命中检测，避免在节点或工具栏上误建节点。
    const target = document.elementFromPoint(point.clientX, point.clientY);
    if (!target?.classList.contains('react-flow__pane') || !wrapperRef.current?.contains(target)) return;
    const handle = connection.fromHandle;
    const node = useGraph.getState().nodes.find((item) => item.id === handle.nodeId);
    if (!node) return;
    const def = NODE_DEFS[node.data.kind];
    const port = (handle.type === 'source' ? def.outputs : def.inputs).find((item) => item.id === handle.id);
    if (!port) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    setPickerOpen(false);
    useSettingsPanel.getState().close();
    setConnectionPicker({
      origin: { nodeId: node.id, handleId: port.id, handleType: handle.type },
      position: screenToFlowPosition({ x: point.clientX, y: point.clientY }),
      anchor: { x: point.clientX - rect.left, y: point.clientY - rect.top },
      portKind: port.kind,
      label: `${def.label} · ${port.label}`,
    });
  }, [screenToFlowPosition]);
  const fitVisible = useCallback((nodeId?: string) => {
    const composerHeight = composerOpen ? document.querySelector('.composer-panel')?.getBoundingClientRect().height ?? 324 : 0;
    const selectedIds = new Set<string>();
    if (nodeId) {
      const graph = useGraph.getState();
      const visit = (id: string) => {
        if (selectedIds.has(id)) return;
        selectedIds.add(id);
        graph.edges.filter((edge) => edge.target === id).forEach((edge) => visit(edge.source));
      };
      visit(nodeId);
    }
    void fitView({ padding: { top: '72px', left: '50px', right: '50px', bottom: `${composerHeight + 110}px` },
      maxZoom: 1, duration: 350, ...(nodeId ? { nodes: [...selectedIds].map((id) => ({ id })) } : {}) });
  }, [composerOpen, fitView]);
  useEffect(() => {
    useCanvasBridge.setState({ fitBoundsOf: (nodeId) => { setTimeout(() => fitVisible(nodeId), 100); } });
    return () => { useCanvasBridge.setState({ fitBoundsOf: null }); };
  }, [fitVisible]);

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
      if (!(event.target as Element).classList.contains('react-flow__pane')) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNode('prompt', { x: position.x - 110, y: position.y - 20 });
    },
    [addNode, screenToFlowPosition],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (typing) return;

      if (event.key === 'Escape') {
        connectionCancelled.current = true;
        if (pickerOpen || connectionPicker) closePicker();
        return;
      }
      if (pickerOpen || connectionPicker || target?.closest('[role="dialog"], [aria-modal="true"]')) return;

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
      if (!mod && (event.key === 'Delete' || event.key === 'Backspace')) {
        const selected = nodes.filter((n) => n.selected).map((n) => n.id);
        const selectedEdges = edges.filter((edge) => edge.selected && edge.deletable !== false).map((edge) => edge.id);
        if (selected.length > 0 || selectedEdges.length > 0) {
          event.preventDefault();
          removeElements(selected, selectedEdges);
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
        setTimeout(() => fitVisible(), 60);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closePicker, connectionPicker, duplicateNode, edges, fitVisible, nodes, pickerOpen, redo, removeElements, undo]);

  const zoomPercent = Math.round(viewport.zoom * 100);
  const ctlBtn = 'rounded-md px-1.5 text-[11px]';

  return (
    <div
      ref={wrapperRef}
      tabIndex={-1}
      className="relative h-full w-full outline-none"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <ReactFlow<CanvasNode, CanvasEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={(changes: NodeChange<CanvasNode>[]) => onNodesChange(changes)}
        onEdgesChange={(changes: EdgeChange<CanvasEdge>[]) => onEdgesChange(changes)}
        onConnect={(connection: Connection) => {
          onConnect(connection);
        }}
        onConnectStart={() => {
          connectionCancelled.current = false;
          setPickerOpen(false);
          setConnectionPicker(null);
        }}
        onConnectEnd={handleConnectEnd}
        onNodeClick={(_, node) => setSelectedNode(node.id)}
        onEdgeClick={() => {
          setSelectedNode(null);
          useSettingsPanel.getState().close();
        }}
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
        defaultEdgeOptions={{ type: 'default' }}
        connectionLineStyle={{ stroke: '#b8aaec', strokeWidth: 2 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2}
        deleteKeyCode={null}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={['Control', 'Meta']}
        panOnScroll
        selectionOnDrag
        fitView
        fitViewOptions={{ padding: { top: '72px', left: '50px', right: '50px', bottom: composerOpen ? '420px' : '80px' }, maxZoom: 1 }}
      >
        {grid && <Background variant={BackgroundVariant.Dots} gap={24} size={0.8} color="#303030" />}

        {minimap && nodes.length > 0 && (
          <MiniMap
            pannable
            zoomable
            position="top-right"
            maskColor="rgba(0,0,0,0.4)"
            nodeColor="#737373"
            style={{ width: 178, height: 116, marginTop: 68, marginRight: 16 }}
          />
        )}

        {/* 右上角悬浮控件（对齐参考图） */}
        <div className="canvas-controls canvas-top-controls absolute right-4 top-4 z-20">
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
            <Icon name="grid" size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              autoLayout();
              setTimeout(() => fitVisible(), 60);
            }}
            title="自动布局（Shift+L）"
          >
            <Icon name="nodes" size={17} />
          </button>
          <button type="button" onClick={() => setMinimap((v) => !v)} data-active={minimap} title="小地图">
            <Icon name="map" size={17} />
          </button>
          <button
            type="button"
            onClick={() => setCanvasOnly((v) => !v)}
            data-active={canvasOnly}
            title={canvasOnly ? '退出仅画布' : '仅画布（收起两侧面板）'}
          >
            <Icon name="panel" size={17} />
          </button>
        </div>

        {/* 底部居中工具栏（对齐参考图） */}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
          <div className="canvas-controls canvas-dock pointer-events-auto">
            <button
              type="button"
              className="!h-9 !w-9 !rounded-full !bg-mist-100 !text-[16px] !text-ink-900 hover:!bg-white"
              onClick={() => {
                setConnectionPicker(null);
                setPickerOpen((v) => !v);
              }}
              data-active={pickerOpen}
              title="添加节点"
            >
              ＋
            </button>
            <button
              type="button"
              className={ctlBtn}
              onClick={() => fitVisible()}
              title="适应视图"
            >
              <Icon name="expand" />
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
              <Icon name="folder" />
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
              <Icon name="download" />
            </button>
            <button type="button" className={ctlBtn} onClick={openGuide} title="H3 创作指南">
              <Icon name="help" />
            </button>
          </div>
        </div>
      </ReactFlow>

      {/* 「添加节点」菜单：挂在画布容器上，避免被节点层裁剪 */}
      {pickerOpen && <NodePickerMenu onClose={closePicker} />}
      {connectionPicker && <NodePickerMenu onClose={closePicker} connection={{
        anchor: connectionPicker.anchor,
        portKind: connectionPicker.portKind,
        direction: connectionPicker.origin.handleType,
        label: connectionPicker.label,
        onSelect: (kind, handleId) => {
          const { position, origin } = connectionPicker;
          useGraph.getState().addConnectedNode(kind, {
            x: position.x - (origin.handleType === 'target' ? 260 : 0),
            y: position.y - 60,
          }, origin, handleId);
        },
      }} />}
      {importError && <div role="alert" className="absolute left-4 top-4 z-30 max-w-[350px] rounded-xl border border-rose-500/40 bg-ink-900 p-3 text-[12px] text-rose-300">{importError}<button type="button" className="ml-3" aria-label="关闭导入错误" onClick={() => setImportError(null)}>×</button></div>}

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setImportError(null);
          void (async () => {
            try {
              const parsed = JSON.parse(await file.text()) as { graph?: unknown; name?: string };
              const graph = (parsed.graph ?? parsed) as ReturnType<typeof exportGraph>;
              if (graph && Array.isArray(graph.nodes)) {
                await importGraph(graph, parsed.name ?? file.name.replace(/\.json$/i, ''));
              } else throw new Error('请选择有效的工作流 JSON 文件。');
            } catch (cause) {
              setImportError(`导入失败：${(cause as Error).message}`);
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
