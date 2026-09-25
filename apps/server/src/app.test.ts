/**
 * 端到端集成测试（MOCK 模式）：不访问外网、不消耗额度，验证后端全部接口与状态机。
 *
 * 覆盖：
 *  - 健康检查
 *  - 三类任务的创建 → 轮询 → 成功 → 产物转存
 *  - Context-IR 增强提示词回填
 *  - 本地任务列表与远端列表
 *  - 取消（queued）/ 删除（succeeded 行不通 → 删除记录）状态机
 *  - 参数校验（互斥 role、t2va 的 adaptive、H3-Max 的 2K）
 *  - 费用预估
 *  - 项目 / 工作流 / Skill 持久化
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { createContext } from './context.ts';
import { mockSimulator } from './services/mock.ts';

let server: Server;
let base: string;
let dataDir: string;

interface ApiResult<T> {
  status: number;
  body: T;
}

async function call<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as T };
}

async function createTask(taskType: string, request: unknown, extra: Record<string, unknown> = {}) {
  return call<{ taskId: string; task: { id: string; status: string } }>('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ taskType, request, ...extra }),
  });
}

/** 直接触发后端轮询，避免测试依赖真实时间流逝。 */
async function settle(taskId: string, rounds = 4) {
  let last: { task?: { status: string } } = {};
  for (let i = 0; i < rounds; i += 1) {
    const result = await call<{ task: { status: string } }>(`/api/tasks/${taskId}/refresh`, {
      method: 'POST',
    });
    last = result.body;
    if (last.task && ['succeeded', 'failed', 'cancelled'].includes(last.task.status)) break;
  }
  return last;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'h3-e2e-'));
  mockSimulator.reset();
  mockSimulator.pollsToSucceed = 2;

  const ctx = createContext({
    dataDir,
    dbPath: join(dataDir, 'h3.sqlite'),
    assetsDir: join(dataDir, 'assets'),
    artifactsDir: join(dataDir, 'artifacts'),
    mock: true,
    apiKey: '',
    pollIntervalMs: 300,
  });

  const app = createApp(ctx);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('健康检查与初始化', () => {
  it('返回 mock 状态并自动创建默认项目与 Skill', async () => {
    const health = await call<{ ok: boolean; mock: boolean }>('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(health.body.mock).toBe(true);

    const projects = await call<{ items: Array<{ name: string }> }>('/api/projects');
    expect(projects.body.items.length).toBeGreaterThan(0);

    const skills = await call<{ items: Array<{ id: string; builtin: boolean }> }>('/api/skills');
    expect(skills.body.items.length).toBe(8);
    expect(skills.body.items.every((s) => s.builtin)).toBe(true);
  });
});

describe('文生视频全链路', () => {
  let taskId: string;

  it('创建任务返回 task_id 并立即登记为 queued', async () => {
    const created = await createTask('generation', {
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: '一个男孩在海边打篮球' }],
      resolution: '2K',
      duration: 5,
      ratio: '16:9',
    });
    expect(created.status).toBe(200);
    expect(created.body.taskId).toMatch(/^\d+$/);
    expect(created.body.task.status).toBe('queued');
    taskId = created.body.taskId;
  });

  it('轮询后进入 succeeded 并带出产物 URL 与 usage', async () => {
    const settled = await settle(taskId);
    expect(settled.task?.status).toBe('succeeded');

    const detail = await call<{
      task: {
        status: string;
        contentUrl: string;
        resolution: string;
        usage: Record<string, number>;
        taskType: string;
        promptFinal: string;
      };
    }>(`/api/tasks/${taskId}?refresh=1`);

    expect(detail.body.task.status).toBe('succeeded');
    expect(detail.body.task.contentUrl).toContain('.mp4');
    expect(detail.body.task.taskType).toBe('generation');
    expect(detail.body.task.promptFinal).toBe('一个男孩在海边打篮球');
    expect(detail.body.task.usage.output_seconds).toBe(5);
    expect(detail.body.task.usage.completion_tokens).toBeGreaterThan(0);
  });

  it('产物可以转存到本地并支持 Range 回放', async () => {
    const saved = await call<{ asset: { id: string; bytes: number; mime: string }; task: { localPath: string } }>(
      `/api/tasks/${taskId}/artifact`,
      { method: 'POST' },
    );
    expect(saved.status).toBe(200);
    expect(saved.body.asset.bytes).toBeGreaterThan(0);
    expect(saved.body.asset.mime).toContain('video');
    expect(saved.body.task.localPath).toContain('artifacts');

    const content = await fetch(`${base}/api/assets/${saved.body.asset.id}/content`, {
      headers: { Range: 'bytes=0-15' },
    });
    expect(content.status).toBe(206);
    expect(content.headers.get('content-range')).toContain('bytes 0-15/');
    const bytes = new Uint8Array(await content.arrayBuffer());
    expect(bytes.length).toBe(16);
    // MP4 的 ftyp box：前 4 字节是 size，紧接着是 'ftyp'
    expect(String.fromCharCode(...bytes.slice(4, 8))).toBe('ftyp');

    const byPath = await call<{ asset: { id: string } }>(
      `/api/assets/by-path?localPath=${encodeURIComponent(saved.body.task.localPath)}`,
    );
    expect(byPath.body.asset.id).toBe(saved.body.asset.id);
  });

  it('本地任务列表能查到这条任务', async () => {
    const list = await call<{ items: Array<{ id: string }>; total: number; source: string }>(
      '/api/tasks?page_num=1&page_size=20',
    );
    expect(list.body.source).toBe('local');
    expect(list.body.items.some((t) => t.id === taskId)).toBe(true);
  });

  it('远端任务列表（mock）也能返回', async () => {
    const list = await call<{ items: unknown[]; source: string }>('/api/tasks?remote=1&page_size=5');
    expect(list.status).toBe(200);
    expect(list.body.source).toBe('remote');
    expect(Array.isArray(list.body.items)).toBe(true);
  });

  it('succeeded 的任务可以删除记录，删除后本地查不到', async () => {
    const deleted = await call<{ action: string; status: string }>(`/api/tasks/${taskId}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(200);
    expect(deleted.body.action).toBe('deleted');

    const detail = await call<{ error?: string; task?: { id: string } }>(`/api/tasks/${taskId}`);
    // 本地记录已删除，远端（mock）也删了 → 应当明确回 404，而不是返回空壳
    expect(detail.status).toBe(404);
    expect(detail.body.error).toContain('找不到该任务');
  });
});

describe('Context-IR 全链路', () => {
  it('产出增强提示词并写入 promptFinal', async () => {
    const created = await createTask('h3_context_ir', {
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: '史诗级太空歌剧院线预告' }],
      duration: 5,
      ratio: '16:9',
    });
    expect(created.status).toBe(200);
    const taskId = created.body.taskId;

    const settled = await settle(taskId);
    expect(settled.task?.status).toBe('succeeded');

    const prompt = await call<{ prompt: string; rawPrompt: string }>(`/api/tasks/${taskId}/prompt`);
    expect(prompt.status).toBe(200);
    expect(prompt.body.prompt).toContain('integrated_multimodal_description');
    expect(prompt.body.rawPrompt).toBe('史诗级太空歌剧院线预告');

    const detail = await call<{ task: { taskType: string; promptFinal: string; promptRaw: string; modality: string } }>(
      `/api/tasks/${taskId}?refresh=1`,
    );
    expect(detail.body.task.taskType).toBe('h3_context_ir');
    expect(detail.body.task.modality).toBe('text');
    expect(detail.body.task.promptFinal).toContain('overall_soundscape');
    expect(detail.body.task.promptRaw).toBe('史诗级太空歌剧院线预告');
  });

  it('未成功前取增强提示词返回 400', async () => {
    const created = await createTask('h3_context_ir', {
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: 'x' }],
      duration: 5,
      ratio: '16:9',
    });
    const result = await call<{ error: string }>(`/api/tasks/${created.body.taskId}/prompt`);
    expect(result.status).toBe(400);
  });
});

describe('视频再生成全链路', () => {
  it('按任务 ID 模式创建并成功', async () => {
    const source = await createTask('generation', {
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: '源视频' }],
      resolution: '768P',
      duration: 5,
      ratio: '16:9',
    });
    await settle(source.body.taskId);

    const created = await createTask('regeneration', {
      model: 'MiniMax-H3',
      source_task_id: source.body.taskId,
      resolution: '2K',
    });
    expect(created.status).toBe(200);

    const settled = await settle(created.body.taskId);
    expect(settled.task?.status).toBe('succeeded');

    const detail = await call<{ task: { taskType: string; resolution: string } }>(
      `/api/tasks/${created.body.taskId}?refresh=1`,
    );
    expect(detail.body.task.taskType).toBe('regeneration');
    expect(detail.body.task.resolution).toBe('2K');
  });

  it('source_task_id 与 content 同时提供会被拒绝', async () => {
    const result = await createTask('regeneration', {
      model: 'MiniMax-H3',
      source_task_id: '1',
      content: [{ type: 'text', text: 'x' }],
      resolution: '2K',
    });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain('regen.mode.both');
  });
});

describe('取消 / 删除状态机', () => {
  it('queued 的任务可以被取消', async () => {
    const created = await createTask('generation', {
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: '待取消' }],
      resolution: '768P',
      duration: 5,
      ratio: '16:9',
    });
    const taskId = created.body.taskId;

    const cancelled = await call<{ action: string; status: string }>(`/api/tasks/${taskId}`, {
      method: 'DELETE',
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.action).toBe('cancelled');

    const again = await call<{ error: string }>(`/api/tasks/${taskId}`, { method: 'DELETE' });
    expect(again.status).toBe(400);
    expect(again.body.error).toContain('已取消');
  });

  it('running 的任务不允许取消，并给出可读原因', async () => {
    const created = await createTask('generation', {
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: '运行中' }],
      resolution: '768P',
      duration: 5,
      ratio: '16:9',
    });
    const taskId = created.body.taskId;

    // 第一次刷新把 mock 状态推进到 running
    await call(`/api/tasks/${taskId}/refresh`, { method: 'POST' });
    const local = await call<{ task: { status: string } }>(`/api/tasks/${taskId}?refresh=0`);
    expect(local.body.task.status).toBe('running');

    const result = await call<{ error: string }>(`/api/tasks/${taskId}`, { method: 'DELETE' });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('运行中');
  });
});

describe('参数校验（发送前拦截）', () => {
  it('图生视频与多模态参考互斥', async () => {
    const result = await createTask('generation', {
      model: 'MiniMax-H3',
      content: [
        { type: 'text', text: 'x' },
        { type: 'image_url', image_url: { url: 'https://e.com/a.png' }, role: 'first_frame' },
        { type: 'image_url', image_url: { url: 'https://e.com/b.png' }, role: 'reference_image' },
      ],
      resolution: '2K',
      duration: 5,
      ratio: 'adaptive',
    });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain('content.role.mutex');
  });

  it('文生视频不能使用 adaptive', async () => {
    const result = await createTask('generation', {
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: 'x' }],
      resolution: '2K',
      duration: 5,
      ratio: 'adaptive',
    });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain('ratio.required');
  });

  it('缺少非空 text 会被拒绝', async () => {
    const result = await createTask('generation', {
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: '   ' }],
      resolution: '2K',
      duration: 5,
      ratio: '16:9',
    });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain('text');
  });

  it('H3-Max 不支持 2K', async () => {
    const result = await createTask('generation', {
      model: 'MiniMax-H3-Max',
      content: [{ type: 'text', text: 'x' }],
      resolution: '2K',
      duration: 5,
      ratio: '16:9',
    });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain('resolution.unsupported');
  });

  it('H3-Max 不支持 4 秒', async () => {
    const result = await createTask('generation', {
      model: 'MiniMax-H3-Max',
      content: [{ type: 'text', text: 'x' }],
      resolution: '768P',
      duration: 4,
      ratio: '16:9',
    });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain('duration.range');
  });

  it('参考视频超过 3 段会被拒绝', async () => {
    const videos = Array.from({ length: 4 }, (_, i) => ({
      type: 'video_url',
      video_url: { url: `https://e.com/${i}.mp4` },
      role: 'reference_video',
    }));
    const result = await createTask('generation', {
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: 'x' }, ...videos],
      resolution: '2K',
      duration: 5,
      ratio: 'adaptive',
    });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain('content.referenceVideo.count');
  });

  it('非法素材地址（既不是 URL 也不是 data URI）会被拒绝', async () => {
    const result = await createTask('generation', {
      model: 'MiniMax-H3',
      content: [
        { type: 'text', text: 'x' },
        { type: 'image_url', image_url: { url: 'C:\\Users\\me\\a.png' }, role: 'reference_image' },
      ],
      resolution: '2K',
      duration: 5,
      ratio: 'adaptive',
    });
    expect(result.status).toBe(400);
  });
});

describe('费用预估接口', () => {
  it('2K 5 秒文生视频 = 4.00 元', async () => {
    const result = await call<{ breakdown: { total: number } }>('/api/quote', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'generation',
        input: {
          model: 'MiniMax-H3',
          resolution: '2K',
          outputSeconds: 5,
          inputImageCount: 0,
          inputVideoSeconds: 0,
        },
      }),
    });
    expect(result.body.breakdown.total).toBe(4);
  });

  it('图片 8 张时按超出 3 张计费', async () => {
    const result = await call<{ breakdown: { total: number } }>('/api/quote', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'generation',
        input: {
          model: 'MiniMax-H3',
          resolution: '768P',
          outputSeconds: 5,
          inputImageCount: 8,
          inputVideoSeconds: 0,
        },
      }),
    });
    expect(result.body.breakdown.total).toBeCloseTo(3.1, 4);
  });

  it('Context-IR 按字符预估并标注 estimated', async () => {
    const result = await call<{ estimated: boolean; tokens: { promptTokens: number } }>('/api/quote', {
      method: 'POST',
      body: JSON.stringify({ kind: 'contextIR', input: { inputChars: 1600 } }),
    });
    expect(result.body.estimated).toBe(true);
    expect(result.body.tokens.promptTokens).toBe(1000);
  });

  it('再生成接口返回规则说明', async () => {
    const result = await call<{ regenOutputPrice: number; imageFreeCount: number }>('/api/quote/rules');
    expect(result.body.regenOutputPrice).toBe(0.3);
    expect(result.body.imageFreeCount).toBe(5);
  });
});

describe('项目 / 工作流 / Skill 持久化', () => {
  it('项目与工作流支持创建、独立重命名和删除，重命名不覆盖图数据', async () => {
    const created = await call<{ project: { id: string; name: string }; workflow: { id: string } }>('/api/projects', {
      method: 'POST', body: JSON.stringify({ name: '  管理测试项目  ' }),
    });
    expect(created.body.project.name).toBe('管理测试项目');
    const pid = created.body.project.id;
    const firstId = created.body.workflow.id;
    const graph = { nodes: [{ id: 'text', kind: 'prompt', position: { x: 1, y: 2 }, params: { text: '保留这段提示词' } }], edges: [] };
    await call(`/api/workflows/${firstId}`, { method: 'PUT', body: JSON.stringify({ graph }) });
    const renamed = await call<{ workflow: { name: string; graph: unknown } }>(`/api/workflows/${firstId}`, {
      method: 'PATCH', body: JSON.stringify({ name: '  开场镜头  ' }),
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.workflow.name).toBe('开场镜头');
    expect(renamed.body.workflow.graph).toEqual(graph);
    // 之后的画布自动保存不携带旧名称，重命名不会被回滚。
    await call(`/api/workflows/${firstId}`, { method: 'PUT', body: JSON.stringify({ graph }) });
    const read = await call<{ workflow: { name: string } }>(`/api/workflows/${firstId}`);
    expect(read.body.workflow.name).toBe('开场镜头');
    const projectRename = await call<{ project: { name: string } }>(`/api/projects/${pid}`, {
      method: 'PATCH', body: JSON.stringify({ name: '广告制作' }),
    });
    expect(projectRename.body.project.name).toBe('广告制作');
    const second = await call<{ workflow: { id: string } }>('/api/workflows', {
      method: 'POST', body: JSON.stringify({ projectId: pid, name: '镜头二' }),
    });
    expect((await call(`/api/workflows/${second.body.workflow.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(`/api/workflows/${second.body.workflow.id}`)).status).toBe(404);
    expect((await call(`/api/projects/${pid}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(`/api/workflows/${firstId}`)).status).toBe(404);
    const list = await call<{ items: unknown[] }>(`/api/workflows?projectId=${pid}`);
    expect(list.body.items).toEqual([]);
    expect((await call('/api/workflows/does-not-exist', { method: 'PATCH', body: JSON.stringify({ name: '新名称' }) })).status).toBe(404);
  });

  it('项目与工作流名称拒绝空格、超长名称和非字符串', async () => {
    const created = await call<{ project: { id: string }; workflow: { id: string } }>('/api/projects', {
      method: 'POST', body: JSON.stringify({ name: '名称校验' }),
    });
    for (const name of ['', '   ', 'x'.repeat(81), 123]) {
      for (const [path, method, extra] of [
        ['/api/projects', 'POST', {}],
        [`/api/projects/${created.body.project.id}`, 'PATCH', {}],
        ['/api/workflows', 'POST', { projectId: created.body.project.id }],
        [`/api/workflows/${created.body.workflow.id}`, 'PATCH', {}],
      ] as const) {
        expect((await call(path, { method, body: JSON.stringify({ name, ...extra }) })).status).toBe(400);
      }
    }
    await call(`/api/projects/${created.body.project.id}`, { method: 'DELETE' });
  });

  it('项目创建后自动带一个工作流，画布可保存并读回', async () => {
    const created = await call<{ project: { id: string }; workflow: { id: string } }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: '集成测试项目' }),
    });
    expect(created.status).toBe(200);
    const workflowId = created.body.workflow.id;

    const graph = {
      nodes: [
        { id: 'p1', kind: 'prompt', position: { x: 0, y: 0 }, params: { text: '海边打篮球' } },
        {
          id: 'g1',
          kind: 'videoGen',
          position: { x: 340, y: 0 },
          params: { model: 'MiniMax-H3', resolution: '2K', duration: 5, ratio: '16:9' },
        },
      ],
      edges: [{ id: 'e1', source: 'p1', sourceHandle: 'out', target: 'g1', targetHandle: 'text' }],
    };

    const saved = await call<{ workflow: { graph: { nodes: unknown[]; edges: unknown[] } } }>(
      `/api/workflows/${workflowId}`,
      { method: 'PUT', body: JSON.stringify({ graph, name: '文生视频流' }) },
    );
    expect(saved.status).toBe(200);
    expect(saved.body.workflow.graph.nodes).toHaveLength(2);
    expect(saved.body.workflow.graph.edges).toHaveLength(1);

    const reloaded = await call<{ workflow: { name: string; graph: { nodes: Array<{ params: { text: string } }> } } }>(
      `/api/workflows/${workflowId}`,
    );
    expect(reloaded.body.workflow.name).toBe('文生视频流');
    expect(reloaded.body.workflow.graph.nodes[0]!.params.text).toBe('海边打篮球');
  });

  it('非法画布数据被拒绝', async () => {
    const projects = await call<{ items: Array<{ id: string }> }>('/api/projects');
    const projectId = projects.body.items[0]!.id;
    const created = await call<{ workflow: { id: string } }>('/api/workflows', {
      method: 'POST',
      body: JSON.stringify({ projectId, name: '临时' }),
    });

    const bad = await call<{ error: string }>(`/api/workflows/${created.body.workflow.id}`, {
      method: 'PUT',
      body: JSON.stringify({ graph: { nodes: [{ id: 'x' }], edges: [] } }),
    });
    expect(bad.status).toBe(400);
  });

  it('内置 Skill 不可删除，但可以复制后删除', async () => {
    const skills = await call<{ items: Array<{ id: string; builtin: boolean }> }>('/api/skills');
    const builtin = skills.body.items.find((s) => s.builtin)!;

    const denied = await call<{ error: string }>(`/api/skills/${encodeURIComponent(builtin.id)}`, {
      method: 'DELETE',
    });
    expect(denied.status).toBe(400);
    expect(denied.body.error).toContain('内置');

    const copy = await call<{ skill: { id: string; builtin: boolean } }>(
      `/api/skills/${encodeURIComponent(builtin.id)}/duplicate`,
      { method: 'POST' },
    );
    expect(copy.body.skill.builtin).toBe(false);

    const removed = await call<{ ok: boolean }>(`/api/skills/${encodeURIComponent(copy.body.skill.id)}`, {
      method: 'DELETE',
    });
    expect(removed.body.ok).toBe(true);
  });

  it('可以从选区创建自定义 Skill', async () => {
    const created = await call<{ skill: { id: string; nodes: unknown[]; edges: unknown[] } }>('/api/skills', {
      method: 'POST',
      body: JSON.stringify({
        name: '我的模板',
        category: 'pipeline',
        description: '提示词 + 生成 + 状态',
        nodes: [
          { key: 'n1', kind: 'prompt', params: { text: '' }, offset: { x: 0, y: 0 } },
          { key: 'n2', kind: 'videoGen', params: { resolution: '2K' }, offset: { x: 300, y: 0 } },
        ],
        edges: [{ from: 'n1', fromHandle: 'out', to: 'n2', toHandle: 'text' }],
      }),
    });
    expect(created.status).toBe(200);
    expect(created.body.skill.nodes).toHaveLength(2);
    expect(created.body.skill.edges).toHaveLength(1);
  });
});

describe('素材上传（浏览器直传二进制）', () => {
  it('上传 PNG 后返回 data URI 与素材记录', async () => {
    // 最小 1x1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );
    const response = await fetch(`${base}/api/assets/upload?kind=image&name=tiny.png&mime=image/png`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: png,
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { dataUri: string; asset: { id: string; bytes: number } };
    expect(payload.dataUri.startsWith('data:image/png;base64,')).toBe(true);
    expect(payload.asset.bytes).toBe(png.byteLength);

    const listed = await call<{ items: Array<{ id: string }> }>('/api/assets');
    expect(listed.body.items.some((a) => a.id === payload.asset.id)).toBe(true);
  });

  it('非法 kind 被拒绝', async () => {
    const response = await fetch(`${base}/api/assets/upload?kind=exe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from([1, 2, 3]),
    });
    expect(response.status).toBe(400);
  });
});

describe('设置接口', () => {
  it('读接口只回显掩码，写接口不泄露明文', async () => {
    const initial = await call<{ apiKeyMasked: string; hasApiKey: boolean }>('/api/settings');
    expect(initial.body.apiKeyMasked).toBe('');
    expect(initial.body.hasApiKey).toBe(false);

    const saved = await call<{ apiKeyMasked: string; hasApiKey: boolean; baseUrl: string }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ apiKey: 'sk-test-1234567890abcd', baseUrl: 'https://api.minimaxi.com' }),
    });
    expect(saved.body.hasApiKey).toBe(true);
    expect(saved.body.apiKeyMasked).toContain('abcd');
    expect(saved.body.apiKeyMasked).not.toContain('1234567890');
    expect(saved.body.baseUrl).toBe('https://api.minimaxi.com');

    const again = await call<{ apiKeyMasked: string }>('/api/settings');
    expect(again.body.apiKeyMasked).toContain('abcd');
    expect(JSON.stringify(again.body)).not.toContain('sk-test');
  });

  it('非法 Base URL 被拒绝', async () => {
    const result = await call<{ error: string }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ baseUrl: 'not-a-url' }),
    });
    expect(result.status).toBe(400);
  });
});
