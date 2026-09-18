/**
 * 应用级共享状态：数据库、客户端、轮询器、各仓储。
 * 路由只依赖这个 AppContext，方便测试时替换。
 */
import { loadConfig, type AppConfig } from './config.ts';
import { openDatabase, type Db } from './db.ts';
import { AssetService } from './services/assets.ts';
import { MinimaxClient } from './services/minimax.ts';
import { TaskPoller } from './services/poller.ts';
import { ProjectStore, SettingsStore, SkillStore, WorkflowStore } from './services/store.ts';
import { RunStore, TaskStore } from './services/task-store.ts';

export interface AppContext {
  config: AppConfig;
  db: Db;
  projects: ProjectStore;
  workflows: WorkflowStore;
  tasks: TaskStore;
  runs: RunStore;
  skills: SkillStore;
  settings: SettingsStore;
  client: MinimaxClient;
  poller: TaskPoller;
  assets: AssetService;
}

export function createContext(overrides: Partial<AppConfig> = {}): AppContext {
  const config = { ...loadConfig(), ...overrides };
  const db = openDatabase(config);

  const projects = new ProjectStore(db);
  const workflows = new WorkflowStore(db);
  const tasks = new TaskStore(db);
  const runs = new RunStore(db);
  const skills = new SkillStore(db);
  const settings = new SettingsStore(db);
  const assets = new AssetService(db, config);

  // 优先级：SQLite 设置（UI 里填的） > .env > 默认值
  const readSettings = () => {
    const storedKey = settings.get('api_key');
    const mockSetting = settings.get('mock');
    return {
      baseUrl: settings.get('base_url') ?? config.baseUrl,
      apiKey: storedKey && storedKey.trim() !== '' ? storedKey : config.apiKey,
      mock: mockSetting === null ? config.mock : mockSetting === '1',
    };
  };

  // 把 .env 的默认值写回设置表，让界面能如实显示当前生效的模式
  if (settings.get('mock') === null) settings.set('mock', config.mock ? '1' : '0');

  const client = new MinimaxClient({ config: readSettings });
  const poller = new TaskPoller(client, tasks, { tickIntervalMs: config.pollIntervalMs });

  // 首次启动写入内置 Skill
  skills.seedBuiltins();

  // 数据库为空时创建一个默认项目与工作流，保证界面不是空的
  if (projects.list().length === 0) {
    const project = projects.create({ name: '我的第一个项目', description: 'MiniMax H3 视频生成工作区' });
    workflows.create({ projectId: project.id, name: '未命名工作流' });
  }

  return { config, db, projects, workflows, tasks, runs, skills, settings, client, poller, assets };
}
