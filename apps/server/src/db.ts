/**
 * SQLite 持久化层。使用 Node 内置的 node:sqlite，零原生依赖、零编译。
 */
import { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from './config.ts';
import { ensureDataDirs } from './config.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  graph_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  project_id    TEXT,
  workflow_id   TEXT,
  node_id       TEXT,
  task_type     TEXT NOT NULL DEFAULT 'generation',
  modality      TEXT NOT NULL DEFAULT 'video',
  model         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL,
  resolution    TEXT NOT NULL DEFAULT '',
  duration      INTEGER,
  ratio         TEXT NOT NULL DEFAULT '',
  prompt_raw    TEXT NOT NULL DEFAULT '',
  prompt_final  TEXT NOT NULL DEFAULT '',
  request_json  TEXT NOT NULL DEFAULT '{}',
  response_json TEXT NOT NULL DEFAULT '{}',
  content_url   TEXT NOT NULL DEFAULT '',
  local_path    TEXT NOT NULL DEFAULT '',
  error_code    TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  usage_json    TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS assets (
  id           TEXT PRIMARY KEY,
  project_id   TEXT,
  kind         TEXT NOT NULL,
  origin_url   TEXT NOT NULL DEFAULT '',
  local_path   TEXT NOT NULL,
  mime         TEXT NOT NULL DEFAULT '',
  bytes        INTEGER NOT NULL DEFAULT 0,
  sha256       TEXT NOT NULL DEFAULT '',
  duration_sec REAL,
  original_name TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);

CREATE TABLE IF NOT EXISTS skills (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  builtin      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  node_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  task_id     TEXT,
  error       TEXT NOT NULL DEFAULT '',
  started_at  INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_runs_workflow ON runs(workflow_id);
`;

export function openDatabase(config: AppConfig): DatabaseSync {
  ensureDataDirs(config);
  const db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export type Db = DatabaseSync;

/** node:sqlite 返回的行是 null 原型对象，统一转成普通对象方便序列化。 */
export function plain<T extends Record<string, unknown>>(row: unknown): T {
  return { ...(row as T) };
}

export function plainAll<T extends Record<string, unknown>>(rows: unknown[]): T[] {
  return rows.map((r) => ({ ...(r as T) }));
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
