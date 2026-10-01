/**
 * 节点通用外壳 —— 极简风格（对齐参考图）。
 *
 * 设计要点：
 *  - 默认近乎无边框，只有选中时才给一圈细描边；
 *  - 标题是文件名 / 名称，只有一行小字，不是彩色标题栏；
 *  - 参数不铺在卡片上，而是通过点击节点弹出的设置面板来调；
 *  - 卡片只负责「展示 + 触发」，保持画面干净。
 */
import { Handle, Position } from '@xyflow/react';
import { memo, useState, type SyntheticEvent } from 'react';
import { nodeDef, type NodeKind, type PortKind } from '@h3/shared';
import { useGraph } from '../store/graph.ts';
import { STATUS_COLOR, STATUS_LABEL, type CanvasNodeData, type NodeRuntime } from './workflow-types.ts';
import { classNames } from '../lib/media.ts';

export interface NodeShellProps {
  id: string;
  type?: string;
  data: CanvasNodeData;
  selected?: boolean;
  children?: React.ReactNode;
  /** 顶部一行小标题（例如文件名 / 生成方式），省略时用节点名 */
  title?: string;
  /** 卡片宽度，默认 232 */
  width?: number;
  /** 是否处于「设置面板已展开」状态 */
  active?: boolean;
  /** 悬停操作条里的运行按钮 */
  onRun?: () => void;
}

const PORT_CLASS: Record<PortKind, string> = {
  text: 'port-text',
  media: 'port-media',
  video: 'port-video',
  any: 'port-any',
};

const stopActionDrag = (event: SyntheticEvent) => event.stopPropagation();

function PortHandles({ nodeId, kind }: { nodeId: string; kind: NodeKind }) {
  const def = nodeDef(kind);
  const edges = useGraph((s) => s.edges);

  const isConnected = (handleId: string, direction: 'in' | 'out') =>
    edges.some((e) =>
      direction === 'in'
        ? e.target === nodeId && e.targetHandle === handleId
        : e.source === nodeId && e.sourceHandle === handleId,
    );

  return (
    <>
      {def.inputs.map((port, index) => (
        <Handle
          key={`in-${port.id}`}
          id={port.id}
          type="target"
          position={Position.Left}
          style={{ top: `${30 + (index + 1) * 55 / (def.inputs.length + 1)}%` }}
          className={classNames(
            PORT_CLASS[port.kind],
            !isConnected(port.id, 'in') && port.required && 'ring-1 ring-rose-400/60',
          )}
          title={`${port.label}${port.required ? '（必需）' : ''}`}
        />
      ))}
      {def.outputs.map((port, index) => (
        <Handle
          key={`out-${port.id}`}
          id={port.id}
          type="source"
          position={Position.Right}
          style={{ top: `${30 + (index + 1) * 55 / (def.outputs.length + 1)}%` }}
          className={PORT_CLASS[port.kind]}
          title={port.label}
        />
      ))}
    </>
  );
}

export const NodeShell = memo(function NodeShell(props: NodeShellProps) {
  const { id, data, selected, children, title, width = 232, active, onRun } = props;
  const [hovered, setHovered] = useState(false);
  const def = nodeDef(data.kind);
  const status: NodeRuntime['status'] = data.runtime?.status ?? 'idle';
  const runtime = data.runtime;
  const issues = data.issueCount;
  const hasError = Boolean(issues && issues.errors > 0);

  const borderStyle = hasError
    ? { borderColor: '#f43f5e' }
    : status !== 'idle'
      ? { borderColor: STATUS_COLOR[status] }
      : undefined;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      /*
        pt-8 是操作条的「容身之处」：操作条必须是本容器的子元素，
        鼠标从节点移向按钮时才不会触发 onMouseLeave 而把自己藏起来
        —— 这正是「运行那排按钮点不动」的根因。
      */
      className="min-node group relative cursor-grab pt-8 shadow-xl active:cursor-grabbing"
      data-selected={selected ? 'true' : 'false'}
      data-dim={data.disabled ? 'true' : 'false'}
      style={{ width, ...(borderStyle ?? {}) }}
    >
      {/*
        操作条的空白区域透传到节点，只有按钮拦截拖拽。
        按钮仍留在节点内部，鼠标移向按钮时不会触发节点的 mouseleave。
      */}
      <div
        className={classNames(
          'pointer-events-none absolute left-0 right-0 top-1 flex items-center justify-end gap-1 px-2 transition-opacity',
          hovered || active ? 'opacity-100' : 'opacity-0',
        )}
      >
        {onRun && (
          <button
            type="button"
            className="nodrag nopan pointer-events-auto rounded-md border border-ink-600 bg-ink-800/95 px-1.5 py-0.5 text-[10px] text-mist-200 hover:bg-ink-700"
            onPointerDown={stopActionDrag}
            onMouseDown={stopActionDrag}
            onClick={(event) => {
              event.stopPropagation();
              onRun();
            }}
            title="运行此节点及其上游"
          >
            ▶ 运行
          </button>
        )}
        <button
          type="button"
          className="nodrag nopan pointer-events-auto rounded-md border border-ink-600 bg-ink-800/95 px-1.5 py-0.5 text-[10px] text-mist-200 hover:bg-ink-700"
          onPointerDown={stopActionDrag}
          onMouseDown={stopActionDrag}
          onClick={(event) => {
            event.stopPropagation();
            useGraph.getState().duplicateNode(id);
          }}
          title="复制节点"
        >
          ⧉
        </button>
        <button
          type="button"
          className="nodrag nopan pointer-events-auto rounded-md border border-ink-600 bg-ink-800/95 px-1.5 py-0.5 text-[10px] text-mist-200 hover:bg-ink-700"
          onPointerDown={stopActionDrag}
          onMouseDown={stopActionDrag}
          onClick={(event) => {
            event.stopPropagation();
            useGraph.getState().removeNodes([id]);
          }}
          title="删除节点"
        >
          ×
        </button>
      </div>

      {/* 端口手柄：相对整个卡片垂直居中（含顶部操作条占用的高度），视觉上仍对齐内容区 */}
      <PortHandles nodeId={id} kind={data.kind} />

      <div className="relative z-10">
        {/* 标题：一行小字，像参考图里的文件名 */}
        <div className="flex items-center gap-1.5 px-3 pb-1 pt-1.5">
          <span className="truncate text-[11px] text-mist-400" title={title ?? data.label}>
            {title ?? def.label}
          </span>
          {issues && issues.errors > 0 && (
            <span className="shrink-0 text-[10px] text-rose-400">{issues.errors}</span>
          )}
          {issues && issues.warnings > 0 && issues.errors === 0 && (
            <span className="shrink-0 text-[10px] text-amber-400">{issues.warnings}</span>
          )}
          <span
            className="ml-auto shrink-0"
            title={STATUS_LABEL[status]}
            style={{ display: status === 'idle' && !active ? 'none' : undefined }}
          >
            <span
              className={classNames('block h-1.5 w-1.5 rounded-full', status === 'running' && 'status-running')}
              style={{ background: STATUS_COLOR[status] }}
            />
          </span>
        </div>

        {/* 主体 */}
        <div className="px-3 pb-2.5">{children}</div>

        {runtime?.error && (
          <div className="mx-3 mb-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-2 py-1 text-[10px] leading-snug text-rose-300">
            {runtime.error}
          </div>
        )}
      </div>
    </div>
  );
});
