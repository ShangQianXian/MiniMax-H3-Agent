/**
 * 项目 / 工作流 / Skill / 设置的持久化仓储。
 */
import { randomUUID } from 'node:crypto';
import { nowSeconds, plain, plainAll, type Db } from '../db.ts';
import { BUILTIN_SKILLS, zWorkflowGraph, zSkillTemplate, type SkillTemplate, type WorkflowGraph } from '@h3/shared';

/* ───────────────────────  项目  ─────────────────────── */

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  cover: string;
  createdAt: number;
  updatedAt: number;
}

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  cover: string;
  created_at: number;
  updated_at: number;
};

function rowToProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    cover: row.cover,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ProjectStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  list(): ProjectRecord[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
    return plainAll<ProjectRow>(rows).map(rowToProject);
  }

  get(id: string): ProjectRecord | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row ? rowToProject(plain<ProjectRow>(row)) : null;
  }

  create(input: { name: string; description?: string; cover?: string }): ProjectRecord {
    const id = randomUUID();
    const ts = nowSeconds();
    this.db
      .prepare(
        'INSERT INTO projects (id, name, description, cover, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, input.name, input.description ?? '', input.cover ?? '', ts, ts);
    return this.get(id)!;
  }

  update(
    id: string,
    patch: Partial<Pick<ProjectRecord, 'name' | 'description' | 'cover'>>,
  ): ProjectRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    this.db
      .prepare('UPDATE projects SET name = ?, description = ?, cover = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.name ?? existing.name,
        patch.description ?? existing.description,
        patch.cover ?? existing.cover,
        nowSeconds(),
        id,
      );
    return this.get(id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM workflows WHERE project_id = ?').run(id);
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }
}

/* ───────────────────────  工作流  ─────────────────────── */

export interface WorkflowRecord {
  id: string;
  projectId: string;
  name: string;
  graph: WorkflowGraph;
  createdAt: number;
  updatedAt: number;
}

type WorkflowRow = {
  id: string;
  project_id: string;
  name: string;
  graph_json: string;
  created_at: number;
  updated_at: number;
};

const EMPTY_GRAPH: WorkflowGraph = { nodes: [], edges: [] };

function rowToWorkflow(row: WorkflowRow): WorkflowRecord {
  let graph: WorkflowGraph = EMPTY_GRAPH;
  try {
    const parsed = zWorkflowGraph.safeParse(JSON.parse(row.graph_json));
    if (parsed.success) graph = parsed.data;
  } catch {
    graph = EMPTY_GRAPH;
  }
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    graph,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class WorkflowStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  list(projectId?: string): WorkflowRecord[] {
    const rows = projectId
      ? this.db.prepare('SELECT * FROM workflows WHERE project_id = ? ORDER BY updated_at DESC').all(projectId)
      : this.db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC').all();
    return plainAll<WorkflowRow>(rows).map(rowToWorkflow);
  }

  get(id: string): WorkflowRecord | null {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    return row ? rowToWorkflow(plain<WorkflowRow>(row)) : null;
  }

  create(input: { projectId: string; name: string; graph?: WorkflowGraph }): WorkflowRecord {
    const id = randomUUID();
    const ts = nowSeconds();
    const graph = input.graph ?? EMPTY_GRAPH;
    this.db
      .prepare(
        'INSERT INTO workflows (id, project_id, name, graph_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, input.projectId, input.name, JSON.stringify(graph), ts, ts);
    return this.get(id)!;
  }

  saveGraph(id: string, graph: WorkflowGraph, name?: string): WorkflowRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    this.db
      .prepare('UPDATE workflows SET graph_json = ?, name = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(graph), name ?? existing.name, nowSeconds(), id);
    return this.get(id);
  }

  rename(id: string, name: string): WorkflowRecord | null {
    this.db.prepare('UPDATE workflows SET name = ?, updated_at = ? WHERE id = ?').run(name, nowSeconds(), id);
    return this.get(id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
  }
}

/* ───────────────────────  Skill  ─────────────────────── */

export interface SkillRecord extends SkillTemplate {
  createdAt: number;
  updatedAt: number;
}

type SkillRow = {
  id: string;
  name: string;
  category: string;
  description: string;
  payload_json: string;
  builtin: number;
  created_at: number;
  updated_at: number;
};

function rowToSkill(row: SkillRow): SkillRecord | null {
  try {
    const parsed = zSkillTemplate.safeParse(JSON.parse(row.payload_json));
    if (!parsed.success) return null;
    return {
      ...parsed.data,
      builtin: row.builtin === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

export class SkillStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /** 首次启动时把内置 Skill 写入库，并补齐缺失项（不覆盖用户改动过的同名自定义 Skill）。 */
  seedBuiltins(): number {
    const ts = nowSeconds();
    let inserted = 0;
    for (const skill of BUILTIN_SKILLS) {
      const existing = this.db.prepare('SELECT id FROM skills WHERE id = ?').get(skill.id);
      if (existing) continue;
      this.db
        .prepare(
          'INSERT INTO skills (id, name, category, description, payload_json, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
        )
        .run(skill.id, skill.name, skill.category, skill.description, JSON.stringify(skill), ts, ts);
      inserted += 1;
    }
    return inserted;
  }

  list(): SkillRecord[] {
    const rows = this.db.prepare('SELECT * FROM skills ORDER BY builtin DESC, updated_at DESC').all();
    return plainAll<SkillRow>(rows)
      .map(rowToSkill)
      .filter((s): s is SkillRecord => s !== null);
  }

  get(id: string): SkillRecord | null {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id);
    return row ? rowToSkill(plain<SkillRow>(row)) : null;
  }

  upsert(input: SkillTemplate): SkillRecord {
    const ts = nowSeconds();
    const builtin = input.builtin ? 1 : 0;
    const payload = JSON.stringify({ ...input, builtin: Boolean(input.builtin) });
    this.db
      .prepare(
        `INSERT INTO skills (id, name, category, description, payload_json, builtin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           category = excluded.category,
           description = excluded.description,
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at`,
      )
      .run(input.id, input.name, input.category, input.description, payload, builtin, ts, ts);
    return this.get(input.id)!;
  }

  /** 内置 Skill 不允许删除，避免用户误删后无法恢复。 */
  delete(id: string): { deleted: boolean; reason?: string } {
    const existing = this.get(id);
    if (!existing) return { deleted: false, reason: 'Skill 不存在。' };
    if (existing.builtin) return { deleted: false, reason: '内置 Skill 不可删除，可复制为自定义 Skill 后修改。' };
    this.db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    return { deleted: true };
  }
}

/* ───────────────────────  设置  ─────────────────────── */

export class SettingsStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
    return row ? (row as { value: string }).value : null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  }

  all(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM app_settings').all();
    const out: Record<string, string> = {};
    for (const row of plainAll<{ key: string; value: string }>(rows)) out[row.key] = row.value;
    return out;
  }
}

/** API Key 掩码：只回显尾部 4 位。 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length <= 4) return '****';
  return `${'*'.repeat(Math.min(8, trimmed.length - 4))}${trimmed.slice(-4)}`;
}
