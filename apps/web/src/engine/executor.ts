/**
 * 执行引擎。
 *
 * 语义：节点按拓扑顺序执行；下游节点运行时会先递归求值上游依赖并等待其任务成功。
 * 之所以按拓扑「推进式」执行而不是真正并行，是因为 H3 的绝大多数下游输入都依赖上游产物，
 * 并发在这里收益很低、正确性风险却很高。不同分支之间仍然会并行推进。
 */
import {
  actualVideoCost,
  applySoundDirective,
  ERROR_CODE_HINTS,
  buildContextIRRequest,
  buildRegenerationRequest,
  buildVideoGenerationRequest,
  type ContextIRParams,
  type H3ContextModel,
  type H3Model,
  type Ratio,
  type RegenerateParams,
  type Resolution,
  type VideoGenParams,
} from '@h3/shared';
import { api, ApiRequestError } from '../api/client.ts';
import { useGraph, type CanvasEdge, type CanvasNode } from '../store/graph.ts';
import type { NodeRuntime } from '../canvas/workflow-types.ts';
import { resolveNodeSlots } from './resolve.ts';
import { validateGraph } from './validate.ts';

type NodeRuntimeStatus = NodeRuntime['status'];

export interface ExecuteOptions {
  /** 运行前确认：返回 false 表示用户放弃 */
  confirm?: (input: { title: string; message: string; estimateText: string }) => Promise<boolean>;
  /** 等待上限（毫秒） */
  timeoutMs?: number;
  /**
   * 只执行这些节点自身的任务，其余被依赖的节点只求值、不创建任务。
   * 用于「运行选中节点」：不想因为点了一个节点就把它上游的生成任务也重跑一遍。
   */
  onlyTaskIds?: string[];
}

export interface ExecuteResult {
  ok: boolean;
  failed: Array<{ nodeId: string; message: string }>;
  skipped: string[];
  createdTaskIds: string[];
  totalSeconds: number;
  /** 整体中止时的可读原因（例如校验未通过） */
  summary?: string;
}

const PENDING = new Set(['queued', 'running']);
const FAILED = new Set(['failed', 'cancelled']);

function terminal(status: string | undefined): boolean {
  return status === 'succeeded' || FAILED.has(status ?? '');
}

function asVideoGenParams(params: Record<string, unknown>): VideoGenParams {
  return {
    model: (params.model === 'MiniMax-H3-Max' ? 'MiniMax-H3-Max' : 'MiniMax-H3') as H3Model,
    resolution: (['480P', '768P', '2K'].includes(String(params.resolution))
      ? params.resolution
      : '768P') as Resolution,
    duration: typeof params.duration === 'number' ? params.duration : 8,
    ratio: (typeof params.ratio === 'string' ? params.ratio : 'adaptive') as Ratio,
    aigcWatermark: params.aigcWatermark === true,
    confirmBeforeRun: params.confirmBeforeRun !== false,
    presetId: typeof params.presetId === 'string' ? params.presetId : '全能参考',
    sound: params.sound === '无声' ? '无声' : '有声',
  };
}

function asContextIRParams(params: Record<string, unknown>): ContextIRParams {
  return {
    model: 'MiniMax-H3',
    duration: typeof params.duration === 'number' ? params.duration : 5,
    ratio: (typeof params.ratio === 'string' ? params.ratio : '16:9') as Ratio,
  };
}

function asRegenParams(params: Record<string, unknown>): RegenerateParams {
  return {
    mode: params.mode === 'task' ? 'task' : 'video',
    sourceTaskId: typeof params.sourceTaskId === 'string' ? params.sourceTaskId : '',
    aigcWatermark: params.aigcWatermark === true,
  };
}

function isTaskNode(node: CanvasNode): boolean {
  return node.data.kind === 'videoGen' || node.data.kind === 'contextIR' || node.data.kind === 'regenerate';
}

/** 依赖顺序（拓扑排序）：上游在前。存在环时把剩余节点追加在末尾由校验拦截。 */
function topoOrder(nodes: CanvasNode[], edges: CanvasEdge[]): CanvasNode[] {
  const indegree = new Map<string, number>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const node of nodes) indegree.set(node.id, 0);
  for (const edge of edges) {
    if (byId.has(edge.target) && byId.has(edge.source)) {
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    }
  }

  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0);
  const ordered: CanvasNode[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    ordered.push(node);
    for (const edge of edges) {
      if (edge.source !== node.id) continue;
      const next = indegree.get(edge.target);
      if (next === undefined) continue;
      indegree.set(edge.target, next - 1);
      if (next - 1 <= 0) {
        const target = byId.get(edge.target);
        if (target) queue.push(target);
      }
    }
  }

  for (const node of nodes) if (!seen.has(node.id)) ordered.push(node);
  return ordered;
}

/** 从目标节点出发收集全部上游依赖（含自身）。 */
function collectDependencies(targets: string[], edges: CanvasEdge[]): Set<string> {
  const result = new Set<string>();
  const stack = [...targets];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    for (const edge of edges) {
      if (edge.target === current && !result.has(edge.source)) stack.push(edge.source);
    }
  }
  return result;
}

function estimateText(node: CanvasNode): string {
  const params = node.data.params;
  if (node.data.kind === 'videoGen') {
    const p = asVideoGenParams(params);
    return `${p.model} · ${p.resolution} · ${p.duration}s`;
  }
  if (node.data.kind === 'regenerate') return '768P → 2K';
  if (node.data.kind === 'contextIR') return 'H3-Context-IR';
  return '';
}

/** 执行一组目标节点及其依赖。 */
export async function executeNodes(
  targetIds: string[],
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const store = useGraph.getState();
  const { nodes, edges } = store;

  const report = validateGraph(nodes, edges);
  store.setIssues(report.issues);

  const errorsByNode = new Map<string, string>();
  for (const issue of report.issues) {
    if (issue.severity !== 'error' || !issue.nodeId) continue;
    if (!errorsByNode.has(issue.nodeId)) errorsByNode.set(issue.nodeId, issue.message);
  }

  const needed = collectDependencies(targetIds, edges);
  const ordered = topoOrder(
    nodes.filter((n) => needed.has(n.id)),
    edges,
  );
  const onlyTaskIds = options.onlyTaskIds ? new Set(options.onlyTaskIds) : null;
  /** 上游节点在当前运行中不创建任务，直接复用其已有产物 */
  const reuseUpstreamTask = (node: CanvasNode) => Boolean(onlyTaskIds) && !onlyTaskIds!.has(node.id);

  const skipped: string[] = [];
  const failed: Array<{ nodeId: string; message: string }> = [];
  const createdTaskIds: string[] = [];
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 20 * 60 * 1000;

  store.setRun({ running: true, total: ordered.length, done: 0, label: '准备中' });

  let done = 0;
  let aborted = false;

  const bump = (label: string) => {
    done += 1;
    useGraph.getState().setRun({ done, label });
  };

  const markSkipped = (node: CanvasNode, reason: string) => {
    skipped.push(node.id);
    const blocking = [
      ...errorsByNode.keys(),
    ].filter((id) => id !== node.id && needed.has(id));
    useGraph.getState().setNodeRuntime(node.id, {
      status: 'idle',
      error: `已跳过：${reason}${blocking.length > 0 ? `（上游节点 ${blocking.length} 个有问题）` : ''}`,
    });
    bump(`跳过 ${node.data.label}`);
  };

  // 1) 预检：任一被依赖节点存在校验错误就整体中止，避免产生半成品
  const blockingNodes = [...needed].filter((id) => errorsByNode.has(id));
  if (blockingNodes.length > 0) {
    const first = errorsByNode.get(blockingNodes[0]!)!;
    useGraph.getState().setRun({ running: false, label: '' });
    return {
      ok: false,
      failed: blockingNodes.map((id) => ({ nodeId: id, message: errorsByNode.get(id)! })),
      skipped: [...needed].filter((id) => !blockingNodes.includes(id)),
      createdTaskIds: [],
      totalSeconds: 0,
      summary: `校验未通过：${first}`,
    };
  }

  for (const node of ordered) {
    if (aborted) {
      skipped.push(node.id);
      continue;
    }
    if (Date.now() - startedAt > timeoutMs) {
      aborted = true;
      skipped.push(node.id);
      useGraph.getState().setNodeRuntime(node.id, { status: 'idle', error: '超时中止。' });
      continue;
    }

    const current = useGraph.getState().nodes.find((n) => n.id === node.id);
    if (!current) continue;
    if (current.data.disabled) {
      markSkipped(current, '节点已禁用');
      continue;
    }

    const blockers = ordered.filter(
      (n) => errorsByNode.has(n.id) && needed.has(n.id) && n.id !== node.id,
    );
    if (blockers.length > 0) {
      markSkipped(current, '上游校验未通过');
      continue;
    }

    // 非任务节点：同步产出，直接标记成功
    if (!isTaskNode(current)) {
      useGraph.getState().setNodeRuntime(node.id, {
        status: 'succeeded',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        error: undefined,
      });
      bump(current.data.label);
      continue;
    }

    // 「运行选中节点」模式下，上游任务节点不重新创建任务，直接复用已有产物
    if (reuseUpstreamTask(current)) {
      const status = current.data.runtime?.status;
      if (status === 'succeeded') {
        bump(current.data.label);
        continue;
      }
      const taskId = current.data.runtime?.taskId;
      if (taskId) {
        try {
          const final = await waitForTask(taskId, {
            timeoutMs,
            onStatus: (s) =>
              useGraph.getState().setNodeRuntime(current.id, { status: s as NodeRuntimeStatus }),
            onTask: (task) => useGraph.getState().upsertTask(task),
          });
          if (final.status === 'succeeded') {
            const response = final.response as { content?: { prompt?: string } } | undefined;
            useGraph.getState().setNodeRuntime(current.id, {
              status: 'succeeded',
              ...(final.taskType === 'h3_context_ir'
                ? { outputText: response?.content?.prompt ?? '' }
                : { outputUrl: final.contentUrl }),
            });
            bump(current.data.label);
            continue;
          }
        } catch {
          // 落到下面的跳过分支
        }
      }
      markSkipped(current, '未产出可用结果，请先单独运行该上游节点');
      continue;
    }

    const slots = resolveNodeSlots(node.id, useGraph.getState().nodes, useGraph.getState().edges);

    // 上游任务仍在进行中：等待其落定
    const stillRunning = slots.upstreamNodeIds
      .map((id) => useGraph.getState().nodes.find((n) => n.id === id))
      .filter((n): n is CanvasNode => Boolean(n) && isTaskNode(n!))
      .filter((n) => PENDING.has(n.data.runtime?.status ?? ''));
    if (stillRunning.length > 0) {
      markSkipped(current, '上游任务尚未完成，请等待后再运行本节点');
      continue;
    }

    const failedUpstream = slots.upstreamNodeIds
      .map((id) => useGraph.getState().nodes.find((n) => n.id === id))
      .filter((n): n is CanvasNode => Boolean(n))
      .filter((n) => FAILED.has(n.data.runtime?.status ?? ''));
    if (failedUpstream.length > 0) {
      markSkipped(current, '上游任务失败');
      continue;
    }

    try {
      useGraph.getState().setRun({ label: `${current.data.label} · 提交中` });

      /* ── 组装请求体 ── */
      let taskType: 'generation' | 'h3_context_ir' | 'regeneration' = 'generation';
      let request: unknown = null;
      let promptRaw = '';
      let promptFinal = '';

      if (current.data.kind === 'videoGen') {
        const params = asVideoGenParams(current.data.params);
        // 「有声 / 无声」落成附加提示词 —— 官方接口没有独立的配音开关，声音由提示词决定
        const withSound = slots.text
          ? { ...slots, text: { ...slots.text, text: applySoundDirective(slots.text.text, params.sound) } }
          : slots;
        const built = buildVideoGenerationRequest({ ...params, ...withSound });
        request = built.request;
        taskType = 'generation';
        promptRaw = built.meta.rawPrompt ?? built.meta.finalPrompt;
        promptFinal = built.meta.finalPrompt;
      } else if (current.data.kind === 'contextIR') {
        const params = asContextIRParams(current.data.params);
        const built = buildContextIRRequest({ ...params, ...slots });
        request = built.request;
        taskType = 'h3_context_ir';
        promptRaw = built.meta.rawPrompt ?? built.meta.finalPrompt;
        promptFinal = built.meta.finalPrompt;
      } else if (current.data.kind === 'regenerate') {
        const params = asRegenParams(current.data.params);
        if (params.mode === 'task') {
          request = {
            model: 'MiniMax-H3' as H3ContextModel,
            source_task_id: params.sourceTaskId.trim(),
            resolution: '2K',
            ...(params.aigcWatermark ? { aigc_watermark: true } : {}),
          };
          taskType = 'regeneration';
        } else {
          const baseVideoUrl =
            slots.upstreamVideoUrl ?? String(current.data.params.baseVideoUrl ?? '');
          const built = buildRegenerationRequest({
            mode: 'video',
            baseVideo: {
              id: 'base',
              kind: 'video',
              source: baseVideoUrl.startsWith('data:') ? 'data-uri' : 'remote',
              url: baseVideoUrl,
              mime: 'video/mp4',
            },
            aigcWatermark: params.aigcWatermark,
            ...slots,
          });
          request = built.request;
          taskType = 'regeneration';
          // 再生成必须用当初真正送入模型的最终 prompt
          promptRaw = built.meta.rawPrompt ?? built.meta.finalPrompt;
          promptFinal = built.meta.finalPrompt;
        }
      }

      /* ── 付费确认 ── */
      const needConfirm = current.data.params.confirmBeforeRun !== false;
      if (needConfirm && options.confirm) {
        const approved = await options.confirm({
          title: `运行「${current.data.label}」`,
          message:
            taskType === 'h3_context_ir'
              ? '这会创建 H3-Context-IR 任务，只产出增强提示词，不会生成视频。'
              : taskType === 'regeneration'
                ? '这会创建视频再生成任务，把 768P 源视频再生成为 2K。'
                : '这会使用当前模型与素材创建视频生成任务。',
          estimateText: estimateText(current),
        });
        if (!approved) {
          markSkipped(current, '用户取消');
          continue;
        }
      }

      /* ── 提交 ── */
      useGraph.getState().setNodeRuntime(current.id, {
        status: 'queued',
        startedAt: Date.now(),
        error: undefined,
        outputText: undefined,
      });

      const state = useGraph.getState();
      const created = await api.createTask({
        taskType,
        request,
        projectId: state.activeProjectId,
        workflowId: state.activeWorkflowId,
        nodeId: current.id,
        promptRaw,
        promptFinal,
      });

      createdTaskIds.push(created.taskId);
      useGraph.getState().upsertTask(created.task);
      useGraph.getState().setNodeRuntime(current.id, {
        status: 'queued',
        taskId: created.taskId,
      });
      useGraph.getState().setRun({ label: `${current.data.label} · 排队中` });

      /* ── 等待落定 ── */
      const finalTask = await waitForTask(created.taskId, {
        timeoutMs,
        onStatus: (status) => {
          useGraph.getState().setNodeRuntime(current.id, { status: status as NodeRuntimeStatus });
          useGraph
            .getState()
            .setRun({ label: `${current.data.label} · ${status === 'running' ? '运行中' : status}` });
        },
        onTask: (task) => useGraph.getState().upsertTask(task),
      });

      const runtime: {
        status: 'succeeded' | 'failed' | 'cancelled';
        finishedAt: number;
        actualCost?: number;
        outputUrl?: string;
        outputText?: string;
        error?: string;
      } = {
        status: finalTask.status as 'succeeded' | 'failed' | 'cancelled',
        finishedAt: Date.now(),
      };

      if (finalTask.status === 'succeeded') {
        if (finalTask.taskType === 'h3_context_ir') {
          const response = finalTask.response as { content?: { prompt?: string } } | undefined;
          runtime.outputText = response?.content?.prompt ?? '';
        } else if (finalTask.contentUrl) {
          runtime.outputUrl = finalTask.contentUrl;
          // 顺手转存，避免限时链接过期
          try {
            const saved = await api.saveArtifact(finalTask.id);
            runtime.outputUrl = api.assetContentUrl(saved.asset.id);
            useGraph.getState().upsertTask(saved.task);
          } catch {
            // 转存失败不影响主流程，节点仍持有远端地址
          }
          const cost = actualVideoCost(
            (finalTask.resolution || '768P') as Resolution,
            finalTask.usage,
          );
          if (cost) runtime.actualCost = cost.total;
        }

        // Context-IR 的增强提示词回填到下游可用的位置
        const rawFromParams = promptRaw;
        if (finalTask.taskType === 'h3_context_ir') {
          useGraph.getState().updateNodeParams(current.id, {
            rawText: rawFromParams,
            lastTaskId: finalTask.id,
          });
        } else {
          useGraph.getState().updateNodeParams(current.id, {
            lastTaskId: finalTask.id,
            lastPromptFinal: promptFinal,
          });
        }
      } else {
        runtime.error =
          (finalTask.errorCode ? ERROR_CODE_HINTS[finalTask.errorCode] : undefined) ??
          finalTask.errorMessage ??
          '任务失败。';
      }

      useGraph.getState().setNodeRuntime(current.id, runtime);
      if (finalTask.status !== 'succeeded') {
        failed.push({ nodeId: current.id, message: runtime.error ?? '任务失败。' });
        aborted = false; // 单分支失败不阻断其他分支
      }
      bump(current.data.label);
    } catch (error) {
      const message =
        error instanceof ApiRequestError
          ? `${error.message}${error.issues.length > 0 ? `（${error.issues[0]!.message}）` : ''}`
          : (error as Error).message;
      useGraph.getState().setNodeRuntime(current.id, {
        status: 'failed',
        finishedAt: Date.now(),
        error: message,
      });
      failed.push({ nodeId: current.id, message });
      bump(current.data.label);
    }
  }

  useGraph.getState().setRun({ running: false, label: '' });
  await useGraph.getState().save();

  return {
    ok: failed.length === 0,
    failed,
    skipped,
    createdTaskIds,
    totalSeconds: Math.round((Date.now() - startedAt) / 1000),
  };
}

/** 轮询单个任务直到终态。 */
export async function waitForTask(
  taskId: string,
  handlers: {
    timeoutMs?: number;
    onStatus?: (status: string) => void;
    onTask?: (task: import('../api/client.ts').TaskRecord) => void;
  } = {},
): Promise<import('../api/client.ts').TaskRecord> {
  const timeoutMs = handlers.timeoutMs ?? 20 * 60 * 1000;
  const startedAt = Date.now();
  let delay = 2500;

  for (;;) {
    const { task } = await api.getTask(taskId, true);
    handlers.onTask?.(task);
    handlers.onStatus?.(task.status);

    if (terminal(task.status)) return task;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`等待任务 ${taskId} 超时（${Math.round(timeoutMs / 1000)} 秒）。任务仍在服务端执行，可稍后在任务中心查看。`);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(Math.round(delay * 1.35), 10000);
  }
}
