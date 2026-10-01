import { memo } from 'react';
import { BaseEdge, EdgeToolbar, getBezierPath, type EdgeProps } from '@xyflow/react';
import { useGraph } from '../store/graph.ts';

/** 工具条不随画布缩放，缩小时仍能方便地断开选中的连线。 */
export const DisconnectableEdge = memo(function DisconnectableEdge(props: EdgeProps) {
  const [path, x, y] = getBezierPath(props);
  return (
    <>
      <BaseEdge id={props.id} path={path} style={props.style} markerStart={props.markerStart}
        markerEnd={props.markerEnd} interactionWidth={24} />
      <EdgeToolbar edgeId={props.id} x={x} y={y} isVisible={Boolean(props.selected) && props.deletable !== false}>
        <button
          type="button"
          className="nodrag nopan rounded-full border border-ink-600 bg-ink-900 px-3 py-1.5 text-[11px] text-mist-200 shadow-lg hover:border-rose-400 hover:text-rose-300"
          title="断开连接（Delete / Backspace）"
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            useGraph.getState().removeElements([], [props.id]);
          }}
        >
          × 断开连接
        </button>
      </EdgeToolbar>
    </>
  );
});
