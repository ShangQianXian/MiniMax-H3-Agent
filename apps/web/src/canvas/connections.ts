import { NODE_DEFS, isPortCompatible, type NodeKind, type PortKind } from '@h3/shared';
import type { HandleType } from '@xyflow/react';

export interface ConnectionOrigin {
  nodeId: string;
  handleId: string;
  handleType: HandleType;
}

/** 同时用于菜单过滤和创建前校验，输入端反向拖线时保持输出 → 输入的方向。 */
export function compatibleNodePorts(kind: NodeKind, portKind: PortKind, direction: HandleType) {
  const def = NODE_DEFS[kind];
  return (direction === 'source' ? def.inputs : def.outputs).filter((port) =>
    direction === 'source'
      ? isPortCompatible(portKind, port.kind)
      : isPortCompatible(port.kind, portKind),
  );
}
