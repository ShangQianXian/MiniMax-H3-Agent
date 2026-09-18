/**
 * 运行配置：.env + 环境变量 + SQLite settings 表三级合并。
 * 注意：这里刻意不引入 dotenv 依赖，手写解析 .env 即可满足需求。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** apps/server/src -> 仓库根目录 */
export const REPO_ROOT = resolve(here, '..', '..', '..');

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = parseEnvFile(join(REPO_ROOT, '.env'));

function env(key: string, fallback: string): string {
  const fromProcess = process.env[key];
  if (fromProcess !== undefined && fromProcess !== '') return fromProcess;
  const fromFile = fileEnv[key];
  if (fromFile !== undefined && fromFile !== '') return fromFile;
  return fallback;
}

export interface AppConfig {
  port: number;
  host: string;
  apiKey: string;
  baseUrl: string;
  mock: boolean;
  dataDir: string;
  dbPath: string;
  assetsDir: string;
  artifactsDir: string;
  maxUploadBytes: number;
  /** 任务轮询的基础 tick 间隔（毫秒），集成测试会调小以加快验证 */
  pollIntervalMs: number;
}

export function loadConfig(): AppConfig {
  const dataDir = resolve(REPO_ROOT, env('DATA_DIR', 'data'));
  const port = Number.parseInt(env('PORT', '8787'), 10);
  const mockRaw = env('MOCK_H3', '0');
  const pollRaw = Number.parseInt(env('POLL_INTERVAL_MS', '3000'), 10);

  return {
    port: Number.isFinite(port) ? port : 8787,
    host: env('HOST', '127.0.0.1'),
    apiKey: env('MINIMAX_API_KEY', ''),
    baseUrl: env('MINIMAX_BASE_URL', 'https://api.minimax.cn').replace(/\/+$/, ''),
    mock: mockRaw === '1' || mockRaw.toLowerCase() === 'true',
    dataDir,
    dbPath: join(dataDir, 'h3.sqlite'),
    assetsDir: join(dataDir, 'assets'),
    artifactsDir: join(dataDir, 'artifacts'),
    maxUploadBytes: 64 * 1024 * 1024,
    pollIntervalMs: Number.isFinite(pollRaw) && pollRaw >= 200 ? pollRaw : 3000,
  };
}

export function ensureDataDirs(config: AppConfig): void {
  for (const dir of [config.dataDir, config.assetsDir, config.artifactsDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
