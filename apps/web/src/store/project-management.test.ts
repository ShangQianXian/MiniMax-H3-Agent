// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type ProjectRecord, type WorkflowRecord } from '../api/client.ts';
import { useGraph } from './graph.ts';

vi.mock('../api/client.ts', () => ({ api: {
  saveWorkflow: vi.fn(), getWorkflow: vi.fn(), listWorkflows: vi.fn(), listProjects: vi.fn(),
  createProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn(),
  createWorkflow: vi.fn(), renameWorkflow: vi.fn(), deleteWorkflow: vi.fn(),
} }));
const project = (id: string): ProjectRecord => ({ id, name: id, description: '', cover: '', createdAt: 1, updatedAt: 1 });
const workflow = (id: string, projectId = 'p1'): WorkflowRecord => ({ id, projectId, name: id, graph: { nodes: [], edges: [] }, createdAt: 1, updatedAt: 1 });
let records: WorkflowRecord[];

beforeEach(async () => {
  vi.resetAllMocks();
  records = [workflow('w1'), workflow('w2'), workflow('w3', 'p2')];
  vi.mocked(api.getWorkflow).mockImplementation(async (id) => ({ workflow: records.find((w) => w.id === id)!, runs: [] }));
  vi.mocked(api.listWorkflows).mockImplementation(async (id) => ({ items: records.filter((w) => w.projectId === id) }));
  vi.mocked(api.saveWorkflow).mockImplementation(async (id, graph) => ({ workflow: { ...records.find((w) => w.id === id)!, graph } }));
  vi.mocked(api.renameWorkflow).mockImplementation(async (id, name) => ({ workflow: { ...records.find((w) => w.id === id)!, name } }));
  useGraph.setState({ projects: [project('p1'), project('p2')], workflows: [], activeProjectId: null, activeWorkflowId: null,
    nodes: [], edges: [], past: [], future: [], issues: [], selectedNodeId: null, loadError: null, workspaceBusy: false });
  await useGraph.getState().selectProject('p1');
});

describe('项目与工作流管理', () => {
  it('新建项目同步替换工作流列表与当前画布', async () => {
    vi.mocked(api.createProject).mockResolvedValue({ project: project('p2'), workflow: records[2]! });
    vi.mocked(api.listProjects).mockResolvedValue({ items: [project('p1'), project('p2')] });
    await useGraph.getState().createProject('  新项目  ');
    expect(api.createProject).toHaveBeenCalledWith({ name: '新项目' });
    expect(useGraph.getState().activeProjectId).toBe('p2');
    expect(useGraph.getState().activeWorkflowId).toBe('w3');
    expect(useGraph.getState().workflows.map((w) => w.id)).toEqual(['w3']);
  });

  it('切换前保存未完成的画布编辑；保存失败时停留原工作流', async () => {
    useGraph.getState().addNode('prompt', { x: 1, y: 2 });
    vi.mocked(api.saveWorkflow).mockRejectedValueOnce(new Error('磁盘不可写'));
    await expect(useGraph.getState().selectWorkflow('w2')).rejects.toThrow('磁盘不可写');
    expect(useGraph.getState().activeWorkflowId).toBe('w1');
    expect(useGraph.getState().nodes).toHaveLength(1);
    expect(useGraph.getState().workspaceBusy).toBe(false);
    await useGraph.getState().selectWorkflow('w2');
    expect(api.saveWorkflow).toHaveBeenLastCalledWith('w1', expect.objectContaining({ nodes: [expect.objectContaining({ kind: 'prompt' })] }));
    expect(useGraph.getState().activeWorkflowId).toBe('w2');
  });

  it('快速切换按顺序完成，最终项目与工作流一致', async () => {
    await Promise.all([useGraph.getState().selectProject('p2'), useGraph.getState().selectProject('p1')]);
    expect(useGraph.getState().activeProjectId).toBe('p1');
    expect(useGraph.getState().activeWorkflowId).toBe('w1');
    expect(useGraph.getState().workflows.map((w) => w.id)).toEqual(['w1', 'w2']);
  });

  it('重命名非当前工作流不切换画布，重命名当前工作流同步标题', async () => {
    const id = useGraph.getState().addNode('prompt', { x: 0, y: 0 });
    await useGraph.getState().renameWorkflow('w2', '  第二镜头  ');
    expect(useGraph.getState().workflowName).toBe('w1');
    expect(useGraph.getState().workflows[1]?.name).toBe('第二镜头');
    await useGraph.getState().renameWorkflow('w1', '第一镜头');
    await useGraph.getState().save();
    expect(useGraph.getState().workflowName).toBe('第一镜头');
    expect(useGraph.getState().workflows[0]?.name).toBe('第一镜头');
    expect(useGraph.getState().nodes[0]?.id).toBe(id);
    expect(vi.mocked(api.saveWorkflow).mock.calls[0]).toHaveLength(2);
  });

  it('修改项目名称立即更新列表；空名称不发出请求', async () => {
    vi.mocked(api.updateProject).mockResolvedValue({ project: { ...project('p1'), name: '广告项目' } });
    await useGraph.getState().updateProject('p1', { name: ' 广告项目 ' });
    expect(useGraph.getState().projects[0]?.name).toBe('广告项目');
    await expect(useGraph.getState().renameWorkflow('w1', '   ')).rejects.toThrow('名称');
    expect(api.renameWorkflow).not.toHaveBeenCalled();
  });

  it('删除其他项目或工作流保留当前选择和节点', async () => {
    const id = useGraph.getState().addNode('prompt', { x: 0, y: 0 });
    await useGraph.getState().deleteWorkflow('w2');
    await useGraph.getState().deleteProject('p2');
    expect(useGraph.getState().activeWorkflowId).toBe('w1');
    expect(useGraph.getState().activeProjectId).toBe('p1');
    expect(useGraph.getState().nodes[0]?.id).toBe(id);
  });

  it('删除当前工作流选择剩余工作流，删除最后一个清理画布与撤销历史', async () => {
    await useGraph.getState().deleteWorkflow('w1');
    expect(useGraph.getState().activeWorkflowId).toBe('w2');
    useGraph.getState().addNode('prompt', { x: 0, y: 0 });
    await useGraph.getState().deleteWorkflow('w2');
    expect(useGraph.getState()).toMatchObject({ activeWorkflowId: null, workflowName: '未命名工作流', nodes: [], edges: [], past: [], future: [] });
    useGraph.getState().undo();
    expect(useGraph.getState().nodes).toEqual([]);
  });

  it('删除最后一个项目后可重新创建项目', async () => {
    await useGraph.getState().deleteProject('p2');
    await useGraph.getState().deleteProject('p1');
    expect(useGraph.getState()).toMatchObject({ projects: [], workflows: [], activeProjectId: null, activeWorkflowId: null, nodes: [] });
    vi.mocked(api.createProject).mockResolvedValue({ project: project('p1'), workflow: records[0]! });
    vi.mocked(api.listProjects).mockResolvedValue({ items: [project('p1')] });
    await useGraph.getState().createProject('重建');
    expect(useGraph.getState().activeWorkflowId).toBe('w1');
  });

  it('删除失败保留本地列表和当前画布', async () => {
    vi.mocked(api.deleteWorkflow).mockRejectedValueOnce(new Error('删除失败'));
    await expect(useGraph.getState().deleteWorkflow('w1')).rejects.toThrow('删除失败');
    expect(useGraph.getState().workflows).toHaveLength(2);
    expect(useGraph.getState().activeWorkflowId).toBe('w1');
  });
});
