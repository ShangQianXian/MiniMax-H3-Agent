/**
 * 自动布局：分层（按依赖深度分列）+ 列内按顺序纵向排列。
 * 不引入 dagre，实现只有几十行，且对「左 → 右」的生成流水线足够好用。
 */
import { useGraph, type CanvasNode } from '../store/graph.ts';

const COLUMN_GAP = 360;
const ROW_GAP = 260;
const ORIGIN_X = 80;
const ORIGIN_Y = 80;

function computeColumns(nodes: CanvasNode[], edges: { source: string; target: string }[]): Map<string, number> {
  const depth = new Map<string, number>();
  for (const node of nodes) depth.set(node.id, 0);

  // 迭代松弛，最多 nodes.length 轮（同时天然免疫环）
  for (let round = 0; round < nodes.length; round += 1) {
    let changed = false;
    for (const edge of edges) {
      if (!depth.has(edge.source) || !depth.has(edge.target)) continue;
      const next = (depth.get(edge.source) ?? 0) + 1;
      if (next > (depth.get(edge.target) ?? 0)) {
        depth.set(edge.target, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return depth;
}

export function autoLayout(): void {
  const { nodes, edges } = useGraph.getState();
  if (nodes.length === 0) return;

  const depth = computeColumns(nodes, edges);
  const byColumn = new Map<number, CanvasNode[]>();
  for (const node of nodes) {
    const column = depth.get(node.id) ?? 0;
    const list = byColumn.get(column) ?? [];
    list.push(node);
    byColumn.set(column, list);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const [column, list] of [...byColumn.entries()].sort((a, b) => a[0] - b[0])) {
    // 同列内按当前纵坐标排序，保持用户的心理模型
    list.sort((a, b) => a.position.y - b.position.y);
    let rowY = ORIGIN_Y;
    list.forEach((node) => {
      positions.set(node.id, {
        x: ORIGIN_X + column * COLUMN_GAP,
        y: rowY,
      });
      rowY += Math.max(ROW_GAP, (node.measured?.height ?? 260) + 56);
    });
  }

  const next = nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, position } : node;
  });

  useGraph.setState((state) => ({
    past: [...state.past, { nodes: state.nodes, edges: state.edges }].slice(-50),
    future: [],
    nodes: next,
  }));
}
