/**
 * MiniMax H3 接口客户端。
 *
 * 端点（docs/api/1..6）：
 *   POST   /v2/video_generation          创建视频生成任务
 *   GET    /v2/query/video_generation/{id}  查询单任务
 *   GET    /v2/query/video_generation       任务列表
 *   DELETE /v2/video_generation/{id}        按状态取消或删除
 *   POST   /v2/h3_context_ir             增强提示词
 *   POST   /v2/video_regeneration        768P → 2K 再生成
 */
import { explainApiError, validateApiRequest, type FriendlyError, type ValidationIssue } from '@h3/shared';
import type {
  ContextIRRequest,
  CreateTaskResponse,
  DeleteTaskResponse,
  ListTasksQuery,
  ListTasksResponse,
  QueryTaskResponse,
  RegenerationRequest,
  VideoGenerationRequest,
  VideoTask,
} from '@h3/shared';
import { mockSimulator } from './mock.ts';

export interface MinimaxClientOptions {
  /** 每次请求都会重新求值，保证「设置」里改完 Key 立刻生效 */
  config: () => { baseUrl: string; apiKey: string; mock: boolean };
  fetchImpl?: typeof fetch;
}

/** 统一的接口调用错误。 */
export class ApiError extends Error {
  readonly status: number;
  readonly friendly: FriendlyError;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const friendly = explainApiError(status, body);
    super(friendly.hint);
    this.name = 'ApiError';
    this.status = status;
    this.friendly = friendly;
    this.body = body;
  }

  toJSON(): Record<string, unknown> {
    return {
      status: this.status,
      hint: this.friendly.hint,
      message: this.friendly.message,
      type: this.friendly.type,
      innerCode: this.friendly.innerCode,
      requestId: this.friendly.requestId,
    };
  }
}

export class MissingApiKeyError extends Error {
  constructor() {
    super('尚未配置 MINIMAX_API_KEY。请在右上角「设置」中填入开放平台 API Key，或写入仓库根目录的 .env。');
    this.name = 'MissingApiKeyError';
  }
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class MinimaxClient {
  private readonly readConfig: () => { baseUrl: string; apiKey: string; mock: boolean };
  private readonly fetchImpl: typeof fetch;

  constructor(options: MinimaxClientOptions) {
    this.readConfig = options.config;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  get baseUrl(): string {
    return this.readConfig().baseUrl.replace(/\/+$/, '');
  }

  get mock(): boolean {
    return this.readConfig().mock;
  }

  get hasKey(): boolean {
    return this.readConfig().apiKey.trim().length > 0;
  }

  private get apiKey(): string {
    return this.readConfig().apiKey;
  }

  /**
   * 无副作用地校验一个请求体。
   * 在真正发起调用之前先跑一遍，保证「参数错误」不会被「未配置 API Key」掩盖。
   */
  validateRequest(
    type: 'generation' | 'h3_context_ir' | 'regeneration',
    payload: unknown,
  ): { ok: true } | { ok: false; issues: ValidationIssue[] } {
    const result = validateApiRequest(type, payload);
    return result.ok ? { ok: true } : { ok: false, issues: result.issues };
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.hasKey && !this.mock) throw new MissingApiKeyError();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (cause) {
      throw new ApiError(0, {
        type: 'error',
        error: {
          type: 'network_error',
          message: `无法连接 ${this.baseUrl}：${(cause as Error).message}`,
          http_code: '0',
        },
      });
    }

    const payload = await safeJson(response);
    if (!response.ok) throw new ApiError(response.status, payload);
    return payload as T;
  }

  createVideoGeneration(request: VideoGenerationRequest): Promise<CreateTaskResponse> {
    if (this.mock) return Promise.resolve(mockSimulator.create('generation', request as never));
    return this.request<CreateTaskResponse>('POST', '/v2/video_generation', request);
  }

  createContextIR(request: ContextIRRequest): Promise<CreateTaskResponse> {
    if (this.mock) return Promise.resolve(mockSimulator.create('h3_context_ir', request as never));
    return this.request<CreateTaskResponse>('POST', '/v2/h3_context_ir', request);
  }

  createRegeneration(request: RegenerationRequest): Promise<CreateTaskResponse> {
    if (this.mock) return Promise.resolve(mockSimulator.create('regeneration', request as never));
    return this.request<CreateTaskResponse>('POST', '/v2/video_regeneration', request);
  }

  queryTask(taskId: string): Promise<QueryTaskResponse> {
    if (this.mock) {
      const result = mockSimulator.query(taskId);
      if (!result) {
        return Promise.reject(
          new ApiError(400, {
            type: 'error',
            error: { type: 'bad_request_error', message: 'invalid task_id (2013)', http_code: '400' },
          }),
        );
      }
      return Promise.resolve(result);
    }
    return this.request<QueryTaskResponse>(
      'GET',
      `/v2/query/video_generation/${encodeURIComponent(taskId)}`,
    );
  }

  listTasks(query: ListTasksQuery = {}): Promise<ListTasksResponse> {
    if (this.mock) return Promise.resolve(mockSimulator.list(query));

    const search = new URLSearchParams();
    if (query.page_num !== undefined) search.set('page_num', String(query.page_num));
    if (query.page_size !== undefined) search.set('page_size', String(query.page_size));
    if (query['filter.status']) search.set('filter.status', query['filter.status']);
    if (query['filter.model']) search.set('filter.model', query['filter.model']);
    if (query['filter.task_type']) search.set('filter.task_type', query['filter.task_type']);
    for (const id of query['filter.task_ids'] ?? []) search.append('filter.task_ids', id);
    const qs = search.toString();
    return this.request<ListTasksResponse>('GET', `/v2/query/video_generation${qs ? `?${qs}` : ''}`);
  }

  async deleteTask(taskId: string): Promise<DeleteTaskResponse> {
    if (this.mock) {
      const result = mockSimulator.remove(taskId);
      if (!result) {
        return Promise.reject(
          new ApiError(400, {
            type: 'error',
            error: {
              type: 'bad_request_error',
              message: 'current task status does not allow this operation (2013)',
              http_code: '400',
            },
          }),
        );
      }
      return result;
    }
    return this.request<DeleteTaskResponse>(
      'DELETE',
      `/v2/video_generation/${encodeURIComponent(taskId)}`,
    );
  }

  /** 探活：任务列表接口对参数最宽容，用它验证 Key 是否可用且不会产生费用。 */
  async ping(): Promise<{ ok: true; total: number }> {
    const result = await this.listTasks({ page_num: 1, page_size: 1 });
    return { ok: true, total: result.total ?? 0 };
  }
}

/* ───────────────────────  归一化  ─────────────────────── */

export type LocalTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface TaskRecord {
  id: string;
  projectId: string | null;
  workflowId: string | null;
  nodeId: string | null;
  taskType: string;
  modality: string;
  model: string;
  status: LocalTaskStatus;
  resolution: string;
  duration: number | null;
  ratio: string;
  promptRaw: string;
  promptFinal: string;
  request: unknown;
  response: unknown;
  contentUrl: string;
  localPath: string;
  errorCode: string;
  errorMessage: string;
  usage: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export function normalizeTask(
  task: VideoTask,
  context: {
    projectId?: string | null;
    workflowId?: string | null;
    nodeId?: string | null;
    promptRaw?: string;
    promptFinal?: string;
    request?: unknown;
  } = {},
): TaskRecord {
  const timestamp = Math.floor(Date.now() / 1000);
  const usage: Record<string, number> = {};
  for (const [key, value] of Object.entries(task.usage ?? {})) {
    if (typeof value === 'number') usage[key] = value;
  }

  return {
    id: task.id,
    projectId: context.projectId ?? null,
    workflowId: context.workflowId ?? null,
    nodeId: context.nodeId ?? null,
    taskType: task.task_type ?? 'generation',
    modality: task.modality ?? 'video',
    model: task.model ?? '',
    status: task.status,
    resolution: task.resolution ?? '',
    duration: task.duration ?? null,
    ratio: task.ratio ?? '',
    promptRaw: context.promptRaw ?? '',
    promptFinal: context.promptFinal ?? '',
    request: context.request ?? {},
    response: task,
    contentUrl: task.content?.url ?? '',
    localPath: '',
    errorCode: task.error?.code ?? '',
    errorMessage: task.error?.message ?? '',
    usage,
    createdAt: task.created_at ?? timestamp,
    updatedAt: task.updated_at ?? timestamp,
  };
}

/** Context-IR 任务的产物是增强提示词，需要单独取出。 */
export function taskEnhancedPrompt(task: VideoTask): string {
  return task.content?.prompt ?? '';
}
