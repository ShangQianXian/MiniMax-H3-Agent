/**
 * 付费确认与运行状态的轻量协调层。
 * 让节点上的「运行」按钮与顶栏的「运行全图」共用同一个确认弹窗。
 */
import { executeNodes, type ExecuteResult } from './executor.ts';

export interface ConfirmRequest {
  title: string;
  message: string;
  estimateText: string;
}

type ConfirmHandler = (request: ConfirmRequest) => Promise<boolean>;

let confirmHandler: ConfirmHandler | null = null;
let latestResult: ExecuteResult | null = null;
let busy = false;

export function setConfirmHandler(handler: ConfirmHandler | null): void {
  confirmHandler = handler;
}

export function getLatestResult(): ExecuteResult | null {
  return latestResult;
}

export function isBusy(): boolean {
  return busy;
}

export async function runNodes(
  targets: string[],
  options: { onlyTaskIds?: string[] } = {},
): Promise<ExecuteResult> {
  if (busy) {
    return {
      ok: false,
      failed: [],
      skipped: [],
      createdTaskIds: [],
      totalSeconds: 0,
      summary: '已有运行中的任务，请等待完成。',
    };
  }
  busy = true;
  try {
    const result = await executeNodes(targets, {
      confirm: confirmHandler ?? undefined,
      ...(options.onlyTaskIds ? { onlyTaskIds: options.onlyTaskIds } : {}),
    });
    latestResult = result;
    return result;
  } finally {
    busy = false;
  }
}
