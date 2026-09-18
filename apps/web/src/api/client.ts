/**
 * 前端 API 客户端：只与同源 /api 通信，由 Vite 代理到本地后端。
 * API Key 从不进入浏览器，前端拿到的永远是掩码。
 */
import type { SkillTemplate, WorkflowGraph } from '@h3/shared';

export interface ApiIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  field?: string;
  nodeId?: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly issues: ApiIssue[];
  readonly detail: unknown;

  constructor(status: number, message: string, issues: ApiIssue[] = [], detail?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.issues = issues;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (cause) {
    throw new ApiRequestError(0, `无法连接本地后端：${(cause as Error).message}。请确认已运行 pnpm dev:server。`);
  }

  const text = await response.text();
  let payload: unknown = {};
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    const body = payload as { error?: string; issues?: ApiIssue[]; detail?: unknown };
    throw new ApiRequestError(
      response.status,
      body.error ?? `请求失败（HTTP ${response.status}）`,
      body.issues ?? [],
      body.detail,
    );
  }

  return payload as T;
}

/* ───────────────────────  类型  ─────────────────────── */

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  cover: string;
  createdAt: number;
  updatedAt: number;
  workflowCount?: number;
  taskCount?: number;
}

export interface WorkflowRecord {
  id: string;
  projectId: string;
  name: string;
  graph: WorkflowGraph;
  createdAt: number;
  updatedAt: number;
}

export interface TaskRecord {
  id: string;
  projectId: string | null;
  workflowId: string | null;
  nodeId: string | null;
  taskType: 'generation' | 'h3_context_ir' | 'regeneration' | string;
  modality: 'video' | 'text' | string;
  model: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
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

export interface TaskListResponse {
  items: TaskRecord[];
  total: number;
  source: 'local' | 'remote';
}

export interface AssetRecord {
  id: string;
  projectId: string | null;
  kind: string;
  originUrl: string;
  localPath: string;
  mime: string;
  bytes: number;
  sha256: string;
  durationSec: number | null;
  originalName: string;
  createdAt: number;
}

export interface SettingsSnapshot {
  baseUrl: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  apiKeyFromEnv: boolean;
  concurrency: number;
  mock: boolean;
  dataDir: string;
  dbPath: string;
}

export interface HealthSnapshot {
  ok: boolean;
  mock: boolean;
  hasApiKey: boolean;
  baseUrl: string;
  watchedTasks: number;
  counts: Record<string, number>;
  apiReachable: boolean | null;
  remoteTotal?: number;
  apiError?: { hint?: string; message?: string };
}

export interface CostBreakdown {
  items: Array<{ label: string; amount: number; detail?: string }>;
  total: number;
}

export interface QuoteResponse {
  kind: string;
  breakdown: CostBreakdown;
  estimated?: boolean;
  tokens?: { promptTokens: number; completionTokens: number };
  notice?: string;
}

export interface CreateTaskResponse {
  taskId: string;
  task: TaskRecord;
}

export interface CreateTaskPayload {
  taskType: 'generation' | 'h3_context_ir' | 'regeneration';
  request: unknown;
  projectId?: string | null;
  workflowId?: string | null;
  nodeId?: string | null;
  promptRaw?: string;
  promptFinal?: string;
}

/* ───────────────────────  接口  ─────────────────────── */

export const api = {
  health: () => request<HealthSnapshot>('/health'),

  createTask: (payload: CreateTaskPayload) =>
    request<CreateTaskResponse>('/tasks', { method: 'POST', body: JSON.stringify(payload) }),

  listTasks: (params: {
    pageNum?: number;
    pageSize?: number;
    status?: string;
    taskType?: string;
    projectId?: string;
    remote?: boolean;
  } = {}) => {
    const search = new URLSearchParams();
    search.set('page_num', String(params.pageNum ?? 1));
    search.set('page_size', String(params.pageSize ?? 20));
    if (params.status) search.set('filter.status', params.status);
    if (params.taskType) search.set('filter.task_type', params.taskType);
    if (params.projectId) search.set('projectId', params.projectId);
    if (params.remote) search.set('remote', '1');
    return request<TaskListResponse>(`/tasks?${search.toString()}`);
  },

  getTask: (taskId: string, refresh = false) =>
    request<{ task: TaskRecord; source: string; stale?: boolean; notice?: string }>(
      `/tasks/${encodeURIComponent(taskId)}${refresh ? '?refresh=1' : ''}`,
    ),

  refreshTask: (taskId: string) =>
    request<{ task: TaskRecord }>(`/tasks/${encodeURIComponent(taskId)}/refresh`, { method: 'POST' }),

  deleteTask: (taskId: string) =>
    request<{ task_id: string; action: 'cancelled' | 'deleted'; status: string }>(
      `/tasks/${encodeURIComponent(taskId)}`,
      { method: 'DELETE' },
    ),

  saveArtifact: (taskId: string) =>
    request<{ asset: AssetRecord; task: TaskRecord }>(
      `/tasks/${encodeURIComponent(taskId)}/artifact`,
      { method: 'POST' },
    ),

  getTaskPrompt: (taskId: string) =>
    request<{ taskId: string; prompt: string; rawPrompt: string }>(
      `/tasks/${encodeURIComponent(taskId)}/prompt`,
    ),

  /* 项目 */
  listProjects: () => request<{ items: ProjectRecord[] }>('/projects'),
  createProject: (input: { name: string; description?: string }) =>
    request<{ project: ProjectRecord; workflow: WorkflowRecord }>('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateProject: (id: string, patch: Partial<Pick<ProjectRecord, 'name' | 'description'>>) =>
    request<{ project: ProjectRecord }>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteProject: (id: string) => request<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),

  /* 工作流 */
  listWorkflows: (projectId?: string) =>
    request<{ items: WorkflowRecord[] }>(
      `/workflows${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
    ),
  getWorkflow: (id: string) =>
    request<{ workflow: WorkflowRecord; runs: unknown[] }>(`/workflows/${id}`),
  createWorkflow: (input: { projectId: string; name: string }) =>
    request<{ workflow: WorkflowRecord }>('/workflows', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  saveWorkflow: (id: string, graph: WorkflowGraph, name?: string) =>
    request<{ workflow: WorkflowRecord }>(`/workflows/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ graph, name }),
    }),
  deleteWorkflow: (id: string) => request<{ ok: true }>(`/workflows/${id}`, { method: 'DELETE' }),
  importWorkflow: (input: { projectId: string; name: string; graph: WorkflowGraph }) =>
    request<{ workflow: WorkflowRecord }>('/workflows/import', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /* Skill */
  listSkills: () => request<{ items: SkillTemplate[] }>('/skills'),
  createSkill: (skill: Partial<SkillTemplate>) =>
    request<{ skill: SkillTemplate }>('/skills', { method: 'POST', body: JSON.stringify(skill) }),
  updateSkill: (id: string, skill: Partial<SkillTemplate>) =>
    request<{ skill: SkillTemplate }>(`/skills/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(skill),
    }),
  deleteSkill: (id: string) =>
    request<{ ok: true }>(`/skills/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  duplicateSkill: (id: string) =>
    request<{ skill: SkillTemplate }>(`/skills/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
    }),

  /* 素材 */
  listAssets: (projectId?: string) =>
    request<{ items: AssetRecord[] }>(
      `/assets${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`,
    ),
  deleteAsset: (id: string) => request<{ ok: true }>(`/assets/${id}`, { method: 'DELETE' }),
  registerRemoteAsset: (input: { url: string; kind: string; projectId?: string | null; name?: string }) =>
    request<{ asset: AssetRecord }>('/assets/remote', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 浏览器直传二进制，避免 multipart 依赖。 */
  uploadAsset: async (input: {
    file: File;
    kind: 'image' | 'video' | 'audio';
    projectId?: string | null;
    durationSec?: number;
  }): Promise<{ asset: AssetRecord; dataUri: string }> => {
    const search = new URLSearchParams();
    search.set('kind', input.kind);
    search.set('name', input.file.name);
    search.set('mime', input.file.type || 'application/octet-stream');
    if (input.projectId) search.set('projectId', input.projectId);
    if (input.durationSec !== undefined) search.set('durationSec', String(input.durationSec));

    let response: Response;
    try {
      response = await fetch(`/api/assets/upload?${search.toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': input.file.type || 'application/octet-stream' },
        body: input.file,
      });
    } catch (cause) {
      throw new ApiRequestError(0, `上传失败：${(cause as Error).message}`);
    }
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new ApiRequestError(response.status, payload.error ?? '上传失败。');
    }
    return payload;
  },

  assetContentUrl: (id: string) => `/api/assets/${id}/content`,

  findAssetByLocalPath: (localPath: string) =>
    request<{ asset: AssetRecord }>(`/assets/by-path?localPath=${encodeURIComponent(localPath)}`),

  /* 设置 */
  getSettings: () => request<SettingsSnapshot>('/settings'),
  updateSettings: (patch: {
    baseUrl?: string;
    apiKey?: string;
    concurrency?: number;
    mock?: boolean;
    clearApiKey?: boolean;
  }) => request<SettingsSnapshot>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  testSettings: () =>
    request<{ ok: boolean; total?: number; baseUrl?: string; error?: unknown }>('/settings/test', {
      method: 'POST',
    }),

  /* 报价 */
  quote: (kind: 'generation' | 'regeneration' | 'contextIR', input: Record<string, unknown>) =>
    request<QuoteResponse>('/quote', { method: 'POST', body: JSON.stringify({ kind, input }) }),
};
