/**
 * 前端画布的本地类型。与 @h3/shared 的 WorkflowNode/WorkflowEdge 保持一致，
 * 额外携带运行时信息（任务状态、产物），运行时信息不写回服务端图谱。
 */
import type { NodeKind } from '@h3/shared';

export interface NodeRuntime {
  status: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  taskId?: string;
  startedAt?: number;
  finishedAt?: number;
  /** 节点产出的地址：视频节点为 mp4，图片节点为图片地址 */
  outputUrl?: string;
  /** Context-IR 节点产出的增强提示词 */
  outputText?: string;
  error?: string;
  /** 该节点本次运行的实际花费（元），成功后依据 usage 计算 */
  actualCost?: number;
}

export interface CanvasNodeData extends Record<string, unknown> {
  kind: NodeKind;
  label: string;
  params: Record<string, unknown>;
  runtime?: NodeRuntime;
  disabled?: boolean;
  /** 由画布注入：当前节点是否处于校验错误状态 */
  issueCount?: { errors: number; warnings: number };
}

/** 画布上的单个输入槽位解析结果 */
export interface ResolvedSlot {
  text: import('@h3/shared').TextSlot | null;
  frames: import('@h3/shared').FrameSlot[];
  media: import('@h3/shared').MediaSlot[];
  /** 上游依赖的节点 ID（用于递归求值与等待） */
  upstreamNodeIds: string[];
  /** 上游视频产物地址（再生成节点用） */
  upstreamVideoUrl?: string;
  upstreamTaskId?: string;
}

export const STATUS_LABEL: Record<NodeRuntime['status'], string> = {
  idle: '待运行',
  queued: '排队中',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
};

export const STATUS_COLOR: Record<NodeRuntime['status'], string> = {
  idle: '#6b7688',
  queued: '#60a5fa',
  running: '#3b82f6',
  succeeded: '#22c55e',
  failed: '#f43f5e',
  cancelled: '#fb923c',
};

/**
 * 运行时状态的浅比较。
 *
 * 为什么必须有：任务轮询每几秒就会把当前状态推回节点，如果每次都产生新的 node 对象，
 * 依赖 nodes 引用的自动保存就会被无限触发（用户看到的是「一直提示已保存」）。
 */
export function runtimeEquals(a: NodeRuntime | undefined, b: NodeRuntime | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.status === b.status &&
    a.taskId === b.taskId &&
    a.startedAt === b.startedAt &&
    a.finishedAt === b.finishedAt &&
    a.outputUrl === b.outputUrl &&
    a.outputText === b.outputText &&
    a.error === b.error &&
    a.actualCost === b.actualCost
  );
}

/** issues 计数比较，避免校验结果没变却重建节点数组。 */
export function issueCountEquals(
  a: CanvasNodeData['issueCount'],
  b: CanvasNodeData['issueCount'],
): boolean {
  const left = a ?? { errors: 0, warnings: 0 };
  const right = b ?? { errors: 0, warnings: 0 };
  return left.errors === right.errors && left.warnings === right.warnings;
}
