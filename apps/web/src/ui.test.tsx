/**
 * 前端渲染冒烟测试 + 画布状态机测试（jsdom 环境）。
 *
 * 目的：在没有浏览器的前提下，验证「渲染路径不崩、关键交互元素存在、图状态机正确」。
 * 真实的画布几何 / 拖拽依赖浏览器，这里不做断言。
 *
 * 注意：AppShell 里用了 React Flow，其节点渲染依赖真实布局能力。
 * 这里只渲染不依赖 React Flow 命中的三块面板（左栏 / 检查器 / 状态栏），
 * 并用 store 直接验证画布逻辑，避免因缺少 DOMMatrix 等浏览器 API 而误报。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { BUILTIN_SKILLS, NODE_DEFS } from '@h3/shared';
import { useGraph } from './store/graph.ts';
import { LeftSidebar } from './layout/LeftSidebar.tsx';
import { InspectorPanel } from './layout/InspectorPanel.tsx';
import { StatusBar } from './layout/StatusBar.tsx';
import { validateGraph } from './engine/validate.ts';
import { estimateNode } from './engine/estimate.ts';
import { resolveNodeSlots } from './engine/resolve.ts';
import { api, type TaskRecord } from './api/client.ts';

/* ─────────────  mock 掉后端 ───────────── */

const projectId = 'p-1';
const workflowId = 'w-1';

const graphStore = {
  nodes: [] as unknown[],
  edges: [] as unknown[],
};

vi.mock('./api/client.ts', () => {
  return {
    ApiRequestError: class ApiRequestError extends Error {
      status = 500;
      issues: unknown[] = [];
    },
    api: {
      health: vi.fn(async () => ({
        ok: true,
        mock: true,
        hasApiKey: true,
        baseUrl: 'https://api.minimax.cn',
        watchedTasks: 0,
        counts: {},
        apiReachable: true,
      })),
      listProjects: vi.fn(async () => ({
        items: [
          {
            id: projectId,
            name: '演示项目',
            description: '',
            cover: '',
            createdAt: 1,
            updatedAt: 1,
            workflowCount: 1,
            taskCount: 0,
          },
        ],
      })),
      listWorkflows: vi.fn(async () => ({
        items: [
          {
            id: workflowId,
            projectId,
            name: '演示工作流',
            graph: { nodes: graphStore.nodes, edges: graphStore.edges },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      })),
      getWorkflow: vi.fn(async () => ({
        workflow: {
          id: workflowId,
          projectId,
          name: '演示工作流',
          graph: { nodes: graphStore.nodes, edges: graphStore.edges },
          createdAt: 1,
          updatedAt: 1,
        },
        runs: [],
      })),
      listSkills: vi.fn(async () => ({
        items: BUILTIN_SKILLS.map((skill) => ({
          ...skill,
          createdAt: 1,
          updatedAt: 1,
        })),
      })),
      listTasks: vi.fn(async () => ({ items: [], total: 0, source: 'local' as const })),
      listAssets: vi.fn(async () => ({ items: [] })),
      updateProject: vi.fn(async () => ({ project: { id: projectId } })),
      deleteProject: vi.fn(async () => ({ ok: true as const })),
      createWorkflow: vi.fn(async () => ({
        workflow: { id: workflowId, projectId, name: '新工作流', graph: { nodes: [], edges: [] }, createdAt: 1, updatedAt: 1 },
      })),
      deleteWorkflow: vi.fn(async () => ({ ok: true as const })),
      saveArtifact: vi.fn(async () => ({ asset: { id: 'a-1' }, task: {} })),
      deleteTask: vi.fn(async () => ({ task_id: 't-1', action: 'deleted' as const, status: 'deleted' })),
      deleteSkill: vi.fn(async () => ({ ok: true as const })),
      duplicateSkill: vi.fn(async () => ({ skill: BUILTIN_SKILLS[0] })),
      createSkill: vi.fn(async () => ({ skill: BUILTIN_SKILLS[0] })),
      saveWorkflow: vi.fn(async () => ({
        workflow: { id: workflowId, projectId, name: '演示工作流', graph: { nodes: [], edges: [] }, createdAt: 1, updatedAt: 2 },
      })),
      getSettings: vi.fn(async () => ({
        baseUrl: 'https://api.minimax.cn',
        apiKeyMasked: '****abcd',
        hasApiKey: true,
        apiKeyFromEnv: false,
        concurrency: 2,
        mock: true,
        dataDir: 'data',
        dbPath: 'data/h3.sqlite',
      })),
      findAssetByLocalPath: vi.fn(async () => ({ asset: { id: 'a-1' } })),
      assetContentUrl: (id: string) => `/api/assets/${id}/content`,
    },
  };
});

beforeEach(() => {
  graphStore.nodes = [];
  graphStore.edges = [];
  useGraph.setState({
    projects: [],
    workflows: [],
    activeProjectId: null,
    activeWorkflowId: null,
    workflowName: '未命名工作流',
    nodes: [],
    edges: [],
    skills: [],
    tasks: [],
    issues: [],
    selectedNodeId: null,
    past: [],
    future: [],
    loadError: null,
  });
});

afterEach(() => {
  cleanup();
});

/* ─────────────  渲染冒烟  ───────────── */

describe('渲染冒烟测试', () => {
  it('左侧栏渲染出四个固定入口与项目树', async () => {
    render(createElement(LeftSidebar));
    // 顶部固定功能入口（对齐参考图）。「项目库」同时出现在导航与面板标题上，用 getAllByText。
    expect(screen.getAllByText('项目库').length).toBeGreaterThan(0);
    expect(screen.getByText('Skill')).toBeTruthy();
    expect(screen.getByText('节点库')).toBeTruthy();
    expect(screen.getByText('任务中心')).toBeTruthy();
    // 可折叠的项目分组
    expect(screen.getByText('项目')).toBeTruthy();

    // 项目树内容来自 store（真实运行时由 bootstrap 填充）
    await act(async () => {
      await useGraph.getState().bootstrap();
    });
    await waitFor(() => {
      // 「演示项目」同时出现在项目树与当前项目卡片里
      expect(screen.getAllByText('演示项目').length).toBeGreaterThan(0);
      expect(screen.getAllByText('演示工作流').length).toBeGreaterThan(0);
    });
  });

  it('切到节点库能看到全部 10 种节点', async () => {
    render(createElement(LeftSidebar));
    // 点导航里的「节点库」（面板标题会重名，取第一个）
    fireEvent.click(screen.getAllByText('节点库')[0]!);
    await waitFor(() => {
      expect(screen.getByPlaceholderText('搜索节点…')).toBeTruthy();
    });
    for (const def of Object.values(NODE_DEFS)) {
      expect(screen.getAllByText(def.label).length).toBeGreaterThan(0);
    }
  });

  it('切到任务中心会展示筛选与拉取入口', async () => {
    render(createElement(LeftSidebar));
    fireEvent.click(screen.getByText('任务中心'));
    await waitFor(() => {
      expect(screen.getByText('本地')).toBeTruthy();
    });
    expect(screen.getByText('远端')).toBeTruthy();
    expect(screen.getByText(/本地缓存/)).toBeTruthy();
  });

  it('按最新状态筛选任务，同时保留后台待完成任务', async () => {
    useGraph.setState({ tasks: [{ id: 'pending-task', status: 'queued', projectId: null } as TaskRecord] });
    render(createElement(LeftSidebar));
    fireEvent.click(screen.getByRole('button', { name: '任务中心' }));
    fireEvent.change(screen.getByLabelText('任务状态筛选'), { target: { value: 'succeeded' } });
    await waitFor(() => expect(api.listTasks).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'succeeded' })));
    expect(useGraph.getState().tasks.some((task) => task.id === 'pending-task')).toBe(true);
    expect(screen.queryByText('#ing-task')).toBeNull();
  });

  it('检查器在未选中节点时给出规格速查', () => {
    render(createElement(InspectorPanel));
    expect(screen.getByText('选中画布上的节点以查看与编辑参数')).toBeTruthy();
    expect(screen.getByText('规格速查')).toBeTruthy();
  });

  it('检查器选中视频生成节点后展示费用明细与请求体预览', async () => {
    useGraph.setState({
      nodes: [
        {
          id: 'p1',
          type: 'prompt',
          position: { x: 0, y: 0 },
          data: { kind: 'prompt', label: '提示词', params: { text: '海边打篮球' } },
        },
        {
          id: 'g1',
          type: 'videoGen',
          position: { x: 340, y: 0 },
          data: {
            kind: 'videoGen',
            label: '视频生成',
            params: {
              model: 'MiniMax-H3',
              resolution: '2K',
              duration: 5,
              ratio: '16:9',
              aigcWatermark: false,
              confirmBeforeRun: true,
            },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'p1', sourceHandle: 'out', target: 'g1', targetHandle: 'text' },
      ],
      selectedNodeId: 'g1',
    });

    render(createElement(InspectorPanel));

    // 2K 5s = 4.00 元
    expect(screen.getByText('费用预估')).toBeTruthy();
    expect(screen.getAllByText('¥4.00').length).toBeGreaterThan(0);
    expect(screen.getByText('请求体预览')).toBeTruthy();
    expect(screen.getByText('复制 curl')).toBeTruthy();
    expect(screen.getByText('已解析的上游输入')).toBeTruthy();
    // 按钮上带 ▶ 图标，用子串匹配
    expect(screen.getByText(/运行此节点及其上游/)).toBeTruthy();
  });

  it('检查器在参数非法时展示可读的中文错误', async () => {
    useGraph.setState({
      nodes: [
        {
          id: 'p1',
          type: 'prompt',
          position: { x: 0, y: 0 },
          data: { kind: 'prompt', label: '提示词', params: { text: 'x' } },
        },
        {
          id: 'g1',
          type: 'videoGen',
          position: { x: 340, y: 0 },
          data: {
            kind: 'videoGen',
            label: '视频生成',
            params: {
              model: 'MiniMax-H3-Max',
              resolution: '2K',
              duration: 5,
              ratio: '16:9',
              aigcWatermark: false,
            },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'p1', sourceHandle: 'out', target: 'g1', targetHandle: 'text' }],
      selectedNodeId: 'g1',
    });

    const report = validateGraph(useGraph.getState().nodes, useGraph.getState().edges);
    useGraph.getState().setIssues(report.issues);

    render(createElement(InspectorPanel));
    await waitFor(() => {
      expect(screen.getByText(/H3-Max 极速生成版本|不支持 2K/)).toBeTruthy();
    });
  });

  it('状态栏在 mock 模式下显示 MOCK 提示与节点统计', async () => {
    render(createElement(StatusBar));
    expect(await screen.findByText(/MOCK 模式/, {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText(/节点 0 · 连线 0/)).toBeTruthy();
    expect(screen.getByText(/Shift\+L 布局/)).toBeTruthy();
  });
});

/* ─────────────  图状态机  ───────────── */

describe('画布图状态机', () => {
  it('新增节点进入历史，可以撤销与重做', () => {
    const store = useGraph.getState();
    const id = store.addNode('prompt', { x: 10, y: 20 });
    expect(useGraph.getState().nodes).toHaveLength(1);
    expect(useGraph.getState().past.length).toBe(1);

    useGraph.getState().undo();
    expect(useGraph.getState().nodes).toHaveLength(0);
    expect(useGraph.getState().future.length).toBe(1);

    useGraph.getState().redo();
    expect(useGraph.getState().nodes).toHaveLength(1);
    expect(useGraph.getState().nodes[0]!.id).toBe(id);
  });

  it('连线遵守端口类型：text 不能接 media', () => {
    useGraph.getState().addNode('prompt', { x: 0, y: 0 });
    useGraph.getState().addNode('videoGen', { x: 300, y: 0 });
    const [promptNode, genNode] = useGraph.getState().nodes;

    // text -> text 允许
    const okConnection = useGraph.getState().onConnect({
      source: promptNode!.id,
      sourceHandle: 'out',
      target: genNode!.id,
      targetHandle: 'text',
    });
    expect(okConnection).toBe(true);
    expect(useGraph.getState().edges).toHaveLength(1);

    // text -> frames（media）不允许
    const badConnection = useGraph.getState().onConnect({
      source: promptNode!.id,
      sourceHandle: 'out',
      target: genNode!.id,
      targetHandle: 'frames',
    });
    expect(badConnection).toBe(false);
    expect(useGraph.getState().edges).toHaveLength(1);
  });

  it('不允许成环', () => {
    const a = useGraph.getState().addNode('contextIR', { x: 0, y: 0 });
    const b = useGraph.getState().addNode('videoGen', { x: 300, y: 0 });
    expect(
      useGraph.getState().onConnect({ source: a, sourceHandle: 'text', target: b, targetHandle: 'text' }),
    ).toBe(true);
    // 反向连回去应当被拒绝
    expect(
      useGraph.getState().onConnect({ source: b, sourceHandle: 'video', target: a, targetHandle: 'text' }),
    ).toBe(false);
  });

  it('删除节点会连带删除相关连线', () => {
    const p = useGraph.getState().addNode('prompt', { x: 0, y: 0 });
    const g = useGraph.getState().addNode('videoGen', { x: 300, y: 0 });
    useGraph.getState().onConnect({ source: p, sourceHandle: 'out', target: g, targetHandle: 'text' });
    expect(useGraph.getState().edges).toHaveLength(1);

    useGraph.getState().removeNodes([g]);
    expect(useGraph.getState().nodes).toHaveLength(1);
    expect(useGraph.getState().edges).toHaveLength(0);
  });

  it('复制节点保留参数并偏移位置', () => {
    const id = useGraph.getState().addNode('videoGen', { x: 100, y: 100 }, { duration: 9 });
    useGraph.getState().duplicateNode(id);
    const nodes = useGraph.getState().nodes;
    expect(nodes).toHaveLength(2);
    expect(nodes[1]!.data.params.duration).toBe(9);
    expect(nodes[1]!.position.x).toBeGreaterThan(nodes[0]!.position.x);
  });

  it('setIssues 把问题数量挂到对应节点上', () => {
    const p = useGraph.getState().addNode('prompt', { x: 0, y: 0 });
    const g = useGraph.getState().addNode('videoGen', { x: 300, y: 0 });
    useGraph.getState().onConnect({ source: p, sourceHandle: 'out', target: g, targetHandle: 'text' });

    const report = validateGraph(useGraph.getState().nodes, useGraph.getState().edges);
    useGraph.getState().setIssues(report.issues);

    const gen = useGraph.getState().nodes.find((n) => n.id === g)!;
    // 提示词为空 → 至少有一个告警挂在提示词节点上
    const prompt = useGraph.getState().nodes.find((n) => n.id === p)!;
    expect(prompt.data.issueCount?.warnings ?? 0).toBeGreaterThan(0);
    expect(gen.data.issueCount).toBeDefined();
  });

  it('插入 Skill 会一并带出节点与连线', () => {
    const skill = BUILTIN_SKILLS.find((s) => s.id === 'skill.context-ir-2k')!;
    useGraph.getState().insertSkill(skill, { x: 50, y: 60 });

    const state = useGraph.getState();
    expect(state.nodes).toHaveLength(3);
    expect(state.edges).toHaveLength(2);
    // 连线两端都指向新建的节点
    for (const edge of state.edges) {
      expect(state.nodes.some((n) => n.id === edge.source)).toBe(true);
      expect(state.nodes.some((n) => n.id === edge.target)).toBe(true);
    }
  });

  it('导出图谱时剔除运行时信息', () => {
    const id = useGraph.getState().addNode('videoGen', { x: 12, y: 34 });
    useGraph.getState().setNodeRuntime(id, { status: 'running', taskId: 't-1' });

    const graph = useGraph.getState().exportGraph();
    expect(graph.nodes).toHaveLength(1);
    expect(JSON.stringify(graph)).not.toContain('runtime');
    expect(JSON.stringify(graph)).not.toContain('t-1');
  });

  it('清空画布会同时清掉节点与连线', () => {
    const p = useGraph.getState().addNode('prompt', { x: 0, y: 0 });
    const g = useGraph.getState().addNode('videoGen', { x: 300, y: 0 });
    useGraph.getState().onConnect({ source: p, sourceHandle: 'out', target: g, targetHandle: 'text' });
    useGraph.getState().clearCanvas();
    expect(useGraph.getState().nodes).toHaveLength(0);
    expect(useGraph.getState().edges).toHaveLength(0);
  });
});

/* ─────────────  费用预估（节点级）  ───────────── */

describe('节点级费用预估', () => {
  it('2K 5 秒 + 6 秒参考视频 + 8 张图片', () => {
    const prompt = {
      id: 'p1',
      type: 'prompt' as const,
      position: { x: 0, y: 0 },
      data: { kind: 'prompt' as const, label: '提示词', params: { text: 'x' } },
    };
    const images = Array.from({ length: 8 }, (_, i) => ({
      id: `i${i}`,
      type: 'image' as const,
      position: { x: 0, y: i * 100 },
      data: { kind: 'image' as const, label: `图${i}`, params: { kind: 'image' as const, url: `https://e.com/${i}.png` } },
    }));
    const video = {
      id: 'v1',
      type: 'video' as const,
      position: { x: 0, y: 900 },
      data: {
        kind: 'video' as const,
        label: '视频',
        params: { kind: 'video' as const, url: 'https://e.com/r.mp4', durationSec: 6 },
      },
    };
    const gen = {
      id: 'g1',
      type: 'videoGen' as const,
      position: { x: 400, y: 0 },
      data: {
        kind: 'videoGen' as const,
        label: '视频生成',
        params: {
          model: 'MiniMax-H3' as const,
          resolution: '2K' as const,
          duration: 5,
          ratio: '16:9' as const,
          aigcWatermark: false,
        },
      },
    };

    const nodes = [prompt, ...images, video, gen] as never[];
    const edges = [
      { id: 'e1', source: 'p1', sourceHandle: 'out', target: 'g1', targetHandle: 'text' },
      ...images.map((img: { id: string }, i: number) => ({
        id: `ei${i}`,
        source: img.id,
        sourceHandle: 'out',
        target: 'g1',
        targetHandle: 'frames',
      })),
      { id: 'ev', source: 'v1', sourceHandle: 'out', target: 'g1', targetHandle: 'frames' },
    ] as never[];

    const slots = resolveNodeSlots('g1', nodes, edges);
    const genNode = (nodes as Array<{ id: string }>).find((n) => n.id === 'g1');
    const estimate = estimateNode(genNode as never, slots);

    // 输出 5s × 0.8 = 4.0；参考视频 6s × 0.8 = 4.8；图片 8 张 → 超出 3 张 × 0.2 = 0.6
    expect(estimate.breakdown.total).toBeCloseTo(4 + 4.8 + 0.6, 4);

    const labels = estimate.breakdown.items.map((i) => i.label);
    expect(labels).toContain('输出视频');
    expect(labels).toContain('输入参考视频');
    expect(labels).toContain('输入图片超出免费额度');
  });
});
