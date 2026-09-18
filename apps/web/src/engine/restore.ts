/**
 * 运行时恢复：页面刷新或切换工作流后，把已完成任务的结果重新贴回节点上。
 *
 * 为什么需要：执行引擎跑在浏览器里，刷新会丢掉 runtime。但任务本身一直存在服务端，
 * 且节点参数里保存了 lastTaskId —— 据此就能把状态、产物地址、增强提示词都恢复出来。
 */
import { api, type TaskRecord } from '../api/client.ts';
import { useGraph } from '../store/graph.ts';
import type { NodeRuntime } from '../canvas/workflow-types.ts';

function runtimeFromTask(task: TaskRecord): Partial<NodeRuntime> {
  const base: Partial<NodeRuntime> = {
    status: task.status,
    taskId: task.id,
    ...(task.createdAt ? { startedAt: task.createdAt * 1000 } : {}),
    ...(task.updatedAt ? { finishedAt: task.updatedAt * 1000 } : {}),
  };

  if (task.status === 'succeeded') {
    if (task.taskType === 'h3_context_ir') {
      const response = task.response as { content?: { prompt?: string } } | undefined;
      return { ...base, outputText: response?.content?.prompt ?? task.promptFinal ?? '' };
    }
    // 优先用原始产物地址；本地转存的地址需要通过 asset 接口回放
    return {
      ...base,
      ...(task.contentUrl ? { outputUrl: task.contentUrl } : {}),
      ...(task.localPath ? { localBackup: task.localPath } : {}),
    };
  }

  if (task.status === 'failed') {
    return { ...base, error: task.errorMessage || '任务失败。' };
  }

  return base;
}

/** 把本地转存路径换成可回放的 /api/assets/:id/content 地址。 */
async function resolveLocalBackup(runtime: NodeRuntime): Promise<string | undefined> {
  const localPath = (runtime as NodeRuntime & { localBackup?: string }).localBackup;
  if (!localPath) return undefined;
  try {
    const { asset } = await api.findAssetByLocalPath(localPath);
    return api.assetContentUrl(asset.id);
  } catch {
    return undefined;
  }
}

/** 依据任务表恢复画布上所有节点的运行时状态。 */
export async function restoreRuntimes(tasks: TaskRecord[]): Promise<void> {
  if (tasks.length === 0) return;
  const state = useGraph.getState();
  const byId = new Map(tasks.map((task) => [task.id, task]));

  for (const node of state.nodes) {
    const currentStatus = node.data.runtime?.status;
    const taskId =
      (typeof node.data.params.lastTaskId === 'string' ? node.data.params.lastTaskId : '') ||
      (typeof node.data.params.taskId === 'string' ? node.data.params.taskId : '');
    if (!taskId) continue;

    const task = byId.get(taskId);
    if (!task) continue;

    const runtime = runtimeFromTask(task);
    const isSameTask = node.data.runtime?.taskId === task.id;

    // 已经跑完且不是同一条任务的节点不覆盖；进行中的任务允许持续刷新状态
    if (isSameTask && currentStatus === 'succeeded' && task.status === 'succeeded') continue;
    if (currentStatus === 'succeeded' && task.status !== 'succeeded') continue;

    state.setNodeRuntime(node.id, runtime);

    if (task.status === 'succeeded' && task.localPath && task.taskType !== 'h3_context_ir') {
      const url = await resolveLocalBackup({ status: 'succeeded', localBackup: task.localPath } as NodeRuntime);
      if (url) state.setNodeRuntime(node.id, { outputUrl: url });
    }
  }
}

/** 拉取本地任务并恢复状态（启动与切换工作流后调用）。 */
export async function loadAndRestoreTasks(projectId?: string | null): Promise<TaskRecord[]> {
  const result = await api.listTasks({
    pageSize: 50,
    ...(projectId ? { projectId } : {}),
  });
  useGraph.getState().setTasks(result.items);
  await restoreRuntimes(result.items);
  return result.items;
}
