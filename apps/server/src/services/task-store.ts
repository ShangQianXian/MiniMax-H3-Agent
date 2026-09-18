/**
 * 本地任务仓库：把 H3 的任务镜像到 SQLite，支持列表、筛选、刷新、删除与产物转存。
 * 所有 SQL 都使用参数绑定，不做字符串拼接。
 */
import { randomUUID } from 'node:crypto';
import { nowSeconds, plain, plainAll, type Db } from '../db.ts';
import { taskEnhancedPrompt, type TaskRecord } from './minimax.ts';
import type { VideoTask, TaskStatus, TaskType } from '@h3/shared';

type TaskRow = {
  id: string;
  project_id: string | null;
  workflow_id: string | null;
  node_id: string | null;
  task_type: string;
  modality: string;
  model: string;
  status: string;
  resolution: string;
  duration: number | null;
  ratio: string;
  prompt_raw: string;
  prompt_final: string;
  request_json: string;
  response_json: string;
  content_url: string;
  local_path: string;
  error_code: string;
  error_message: string;
  usage_json: string;
  created_at: number;
  updated_at: number;
};

const SELECT_COLUMNS = `
  id, project_id, workflow_id, node_id, task_type, modality, model, status,
  resolution, duration, ratio, prompt_raw, prompt_final, request_json, response_json,
  content_url, local_path, error_code, error_message, usage_json, created_at, updated_at
`;

function safeParse(value: string): unknown {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function rowToRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    workflowId: row.workflow_id,
    nodeId: row.node_id,
    taskType: row.task_type,
    modality: row.modality,
    model: row.model,
    status: row.status as TaskRecord['status'],
    resolution: row.resolution,
    duration: row.duration,
    ratio: row.ratio,
    promptRaw: row.prompt_raw,
    promptFinal: row.prompt_final,
    request: safeParse(row.request_json),
    response: safeParse(row.response_json),
    contentUrl: row.content_url,
    localPath: row.local_path,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    usage: safeParse(row.usage_json) as Record<string, number>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ListLocalTasksOptions {
  status?: TaskStatus;
  taskType?: TaskType;
  model?: string;
  projectId?: string;
  workflowId?: string;
  /** 仅返回本地记录对应的任务 ID（用于批量刷新） */
  ids?: string[];
  pageNum?: number;
  pageSize?: number;
}

export class TaskStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  upsert(record: TaskRecord): TaskRecord {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, project_id, workflow_id, node_id, task_type, modality, model, status,
        resolution, duration, ratio, prompt_raw, prompt_final, request_json, response_json,
        content_url, local_path, error_code, error_message, usage_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        model = excluded.model,
        task_type = excluded.task_type,
        modality = excluded.modality,
        resolution = excluded.resolution,
        duration = excluded.duration,
        ratio = excluded.ratio,
        response_json = excluded.response_json,
        content_url = excluded.content_url,
        error_code = excluded.error_code,
        error_message = excluded.error_message,
        usage_json = excluded.usage_json,
        prompt_raw = CASE WHEN excluded.prompt_raw != '' THEN excluded.prompt_raw ELSE tasks.prompt_raw END,
        prompt_final = CASE WHEN excluded.prompt_final != '' THEN excluded.prompt_final ELSE tasks.prompt_final END,
        request_json = CASE WHEN excluded.request_json != '{}' THEN excluded.request_json ELSE tasks.request_json END,
        local_path = CASE WHEN excluded.local_path != '' THEN excluded.local_path ELSE tasks.local_path END,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      record.id,
      record.projectId,
      record.workflowId,
      record.nodeId,
      record.taskType,
      record.modality,
      record.model,
      record.status,
      record.resolution,
      record.duration,
      record.ratio,
      record.promptRaw,
      record.promptFinal,
      JSON.stringify(record.request ?? {}),
      JSON.stringify(record.response ?? {}),
      record.contentUrl,
      record.localPath,
      record.errorCode,
      record.errorMessage,
      JSON.stringify(record.usage ?? {}),
      record.createdAt,
      record.updatedAt,
    );

    return this.get(record.id) ?? record;
  }

  /** 从接口返回的任务对象刷新本地记录，保留本地上下文（项目 / 工作流 / prompt）。 */
  syncFromApi(task: VideoTask): TaskRecord | null {
    const existing = this.get(task.id);
    if (!existing) return null;

    const usage: Record<string, number> = {};
    for (const [key, value] of Object.entries(task.usage ?? {})) {
      if (typeof value === 'number') usage[key] = value;
    }

    const status = task.status;
    const isContextIR = (task.task_type ?? existing.taskType) === 'h3_context_ir';
    const promptFinal = isContextIR && status === 'succeeded' ? taskEnhancedPrompt(task) : existing.promptFinal;

    return this.upsert({
      ...existing,
      status,
      model: task.model ?? existing.model,
      taskType: task.task_type ?? existing.taskType,
      modality: task.modality ?? existing.modality,
      resolution: task.resolution ?? existing.resolution,
      duration: task.duration ?? existing.duration,
      ratio: task.ratio ?? existing.ratio,
      response: task,
      contentUrl: task.content?.url ?? existing.contentUrl,
      errorCode: task.error?.code ?? '',
      errorMessage: task.error?.message ?? '',
      usage,
      promptFinal,
      updatedAt: task.updated_at ?? nowSeconds(),
    });
  }

  get(id: string): TaskRecord | null {
    const row = this.db.prepare(`SELECT ${SELECT_COLUMNS} FROM tasks WHERE id = ?`).get(id);
    return row ? rowToRecord(plain<TaskRow>(row)) : null;
  }

  list(options: ListLocalTasksOptions = {}): { items: TaskRecord[]; total: number } {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (options.status) {
      where.push('status = ?');
      params.push(options.status);
    }
    if (options.taskType) {
      where.push('task_type = ?');
      params.push(options.taskType);
    }
    if (options.model) {
      where.push('model = ?');
      params.push(options.model);
    }
    if (options.projectId) {
      where.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.workflowId) {
      where.push('workflow_id = ?');
      params.push(options.workflowId);
    }
    if (options.ids && options.ids.length > 0) {
      where.push(`id IN (${options.ids.map(() => '?').join(', ')})`);
      params.push(...options.ids);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = this.db.prepare(`SELECT COUNT(*) AS total FROM tasks ${clause}`).get(...params);
    const total = Number((totalRow as { total?: number } | undefined)?.total ?? 0);

    const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
    const pageNum = Math.max(options.pageNum ?? 1, 1);
    const offset = (pageNum - 1) * pageSize;

    const rows = this.db
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM tasks ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset);

    return { items: plainAll<TaskRow>(rows).map(rowToRecord), total };
  }

  /** 未处于终态的任务，用于进程重启后恢复轮询。 */
  pending(): TaskRecord[] {
    const rows = this.db
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM tasks WHERE status IN ('queued', 'running') ORDER BY created_at ASC`,
      )
      .all();
    return plainAll<TaskRow>(rows).map(rowToRecord);
  }

  setLocalPath(id: string, localPath: string): void {
    this.db
      .prepare('UPDATE tasks SET local_path = ?, updated_at = ? WHERE id = ?')
      .run(localPath, nowSeconds(), id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  /** 统计信息，用于状态栏。 */
  counts(): Record<string, number> {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').all();
    const out: Record<string, number> = {};
    for (const row of plainAll<{ status: string; n: number }>(rows)) out[row.status] = Number(row.n);
    return out;
  }
}

/* ───────────────────────  运行记录  ─────────────────────── */

export interface RunRow {
  id: string;
  workflow_id: string;
  node_id: string;
  kind: string;
  status: string;
  task_id: string | null;
  error: string;
  started_at: number;
  finished_at: number | null;
}

export class RunStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  start(input: { workflowId: string; nodeId: string; kind: string }): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO runs (id, workflow_id, node_id, kind, status, error, started_at)
         VALUES (?, ?, ?, ?, 'pending', '', ?)`,
      )
      .run(id, input.workflowId, input.nodeId, input.kind, nowSeconds());
    return id;
  }

  finish(id: string, input: { status: string; taskId?: string; error?: string }): void {
    this.db
      .prepare('UPDATE runs SET status = ?, task_id = ?, error = ?, finished_at = ? WHERE id = ?')
      .run(input.status, input.taskId ?? null, input.error ?? '', nowSeconds(), id);
  }

  listByWorkflow(workflowId: string, limit = 50): RunRow[] {
    const rows = this.db
      .prepare('SELECT * FROM runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(workflowId, limit);
    return plainAll<RunRow & Record<string, unknown>>(rows);
  }
}
