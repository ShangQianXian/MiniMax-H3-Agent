// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveWorkflow = vi.fn(async (id: string, graph: unknown, name?: string) => ({
  workflow: { id, projectId: 'p1', name: name ?? 'w', graph: graph as never, createdAt: 1, updatedAt: Math.floor(Date.now() / 1000) },
}));

vi.mock('../api/client.ts', () => ({
  ApiRequestError: class ApiRequestError extends Error {},
  api: {
    saveWorkflow: (id: string, graph: unknown, name?: string) => saveWorkflow(id, graph, name),
    getWorkflow: vi.fn(),
    listProjects: vi.fn(),
    listSkills: vi.fn(),
  },
}));

import { useGraph } from './graph.ts';

beforeEach(() => {
  saveWorkflow.mockClear();
  useGraph.setState({
    nodes: [], edges: [], issues: [], graphSignature: '', past: [], future: [],
    activeWorkflowId: 'w1', workflowName: '测试流',
  });
});

describe('save 去重', () => {
  it('内容没变时重复调用只发一次 PUT', async () => {
    useGraph.getState().addNode('videoGen', { x: 0, y: 0 });
    await useGraph.getState().save();
    expect(saveWorkflow).toHaveBeenCalledTimes(1);

    // 模拟任务轮询：连续推入运行时状态
    const id = useGraph.getState().nodes[0]!.id;
    for (let i = 0; i < 8; i += 1) {
      useGraph.getState().setNodeRuntime(id, { status: 'running', taskId: 't1' });
      await useGraph.getState().save();
    }
    expect(saveWorkflow).toHaveBeenCalledTimes(1);
  });

  it('改参数后允许再次保存', async () => {
    const id = useGraph.getState().addNode('videoGen', { x: 0, y: 0 });
    await useGraph.getState().save();
    expect(saveWorkflow).toHaveBeenCalledTimes(1);

    useGraph.getState().updateNodeParams(id, { duration: 9 });
    await useGraph.getState().save();
    expect(saveWorkflow).toHaveBeenCalledTimes(2);
  });
});
