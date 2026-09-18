/**
 * 自动保存相关回归测试。
 *
 * 背景（真实 bug）：任务轮询每 4 秒会把任务状态推回节点，
 * 早期实现无条件重建 nodes 数组 → AppShell 里依赖 nodes 引用的防抖被无限重置 →
 * 每轮都真的发一次 PUT，界面一直显示「刚刚已保存」，而且存的是同一份图谱。
 *
 * 修复思路：运行时状态没变就不产生新节点对象；自动保存改依赖「图谱内容签名」。
 * 下面这些断言就是为了让这个 bug 不能回归。
 */
import { describe, expect, it } from 'vitest';
import { defaultParamsFor } from '@h3/shared';
import { graphSignature, useGraph, type CanvasNode } from './graph.ts';
import { issueCountEquals, runtimeEquals } from '../canvas/workflow-types.ts';

function resetStore() {
  useGraph.setState({
    nodes: [],
    edges: [],
    issues: [],
    graphSignature: '',
    past: [],
    future: [],
    selectedNodeId: null,
    tasks: [],
    run: { running: false, total: 0, done: 0, label: '' },
  });
}

function node(id: string, kind: CanvasNode['data']['kind'], params: Record<string, unknown> = {}): CanvasNode {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: { kind, label: kind, params: { ...defaultParamsFor(kind), ...params } },
  };
}

describe('runtimeEquals', () => {
  it('同一份状态视为相等', () => {
    const a = { status: 'running' as const, taskId: 't1', startedAt: 100 };
    expect(runtimeEquals(a, { ...a })).toBe(true);
  });

  it('状态或产物变化视为不同', () => {
    const a = { status: 'running' as const, taskId: 't1' };
    expect(runtimeEquals(a, { status: 'succeeded', taskId: 't1' })).toBe(false);
    expect(runtimeEquals(a, { status: 'running', taskId: 't1', outputUrl: 'x' })).toBe(false);
  });

  it('undefined 的处理', () => {
    expect(runtimeEquals(undefined, undefined)).toBe(true);
    expect(runtimeEquals(undefined, { status: 'idle' })).toBe(false);
  });
});

describe('issueCountEquals', () => {
  it('未定义等同 0/0', () => {
    expect(issueCountEquals(undefined, { errors: 0, warnings: 0 })).toBe(true);
    expect(issueCountEquals({ errors: 0, warnings: 0 }, undefined)).toBe(true);
  });

  it('计数变化视为不同', () => {
    expect(issueCountEquals({ errors: 1, warnings: 0 }, { errors: 0, warnings: 0 })).toBe(false);
  });
});

describe('graphSignature', () => {
  it('与节点顺序无关', () => {
    const a = [node('n1', 'prompt', { text: 'x' }), node('n2', 'videoGen')];
    const b = [a[1]!, a[0]!];
    expect(graphSignature(a, [])).toBe(graphSignature(b, []));
  });

  it('参数变化会改变签名', () => {
    const before = [node('n1', 'videoGen', { duration: 5 })];
    const after = [node('n1', 'videoGen', { duration: 9 })];
    expect(graphSignature(before, [])).not.toBe(graphSignature(after, []));
  });

  it('位置变化会改变签名', () => {
    const before = [node('n1', 'prompt')];
    const moved = [{ ...before[0]!, position: { x: 40, y: 0 } }];
    expect(graphSignature(before, [])).not.toBe(graphSignature(moved, []));
  });

  it('连线变化会改变签名', () => {
    const nodes = [node('n1', 'prompt'), node('n2', 'videoGen')];
    const edges = [
      { id: 'e1', source: 'n1', sourceHandle: 'out', target: 'n2', targetHandle: 'text' },
    ];
    expect(graphSignature(nodes, [])).not.toBe(graphSignature(nodes, edges));
  });
});

describe('运行时状态写入不会污染图谱签名（核心回归）', () => {
  it('相同的运行时状态写入不产生新的 nodes 数组', () => {
    resetStore();
    const id = useGraph.getState().addNode('videoGen', { x: 0, y: 0 });
    const before = useGraph.getState().nodes;

    // 第一次写入：真的变了
    useGraph.getState().setNodeRuntime(id, { status: 'running', taskId: 't1', startedAt: 1000 });
    const afterFirst = useGraph.getState().nodes;
    expect(afterFirst).not.toBe(before);

    // 同样的内容再写一次：不应该产生新数组（否则自动保存会被反复触发）
    useGraph.getState().setNodeRuntime(id, { status: 'running', taskId: 't1', startedAt: 1000 });
    expect(useGraph.getState().nodes).toBe(afterFirst);

    // 再写很多次也一样
    for (let i = 0; i < 10; i += 1) {
      useGraph.getState().setNodeRuntime(id, { status: 'running', taskId: 't1', startedAt: 1000 });
    }
    expect(useGraph.getState().nodes).toBe(afterFirst);
  });

  it('状态推回不会改变图谱签名', () => {
    resetStore();
    const id = useGraph.getState().addNode('videoGen', { x: 0, y: 0 });
    const signatureBefore = useGraph.getState().graphSignature;
    expect(signatureBefore).not.toBe('');

    useGraph.getState().setNodeRuntime(id, { status: 'queued', taskId: 't1' });
    expect(useGraph.getState().graphSignature).toBe(signatureBefore);

    useGraph.getState().setNodeRuntime(id, { status: 'running', taskId: 't1' });
    expect(useGraph.getState().graphSignature).toBe(signatureBefore);

    useGraph.getState().setNodeRuntime(id, {
      status: 'succeeded',
      taskId: 't1',
      outputUrl: '/api/assets/a/content',
      actualCost: 4,
    });
    expect(useGraph.getState().graphSignature).toBe(signatureBefore);
  });

  it('真正改参数才会改变签名', () => {
    resetStore();
    const id = useGraph.getState().addNode('videoGen', { x: 0, y: 0 });
    const before = useGraph.getState().graphSignature;
    useGraph.getState().updateNodeParams(id, { duration: 9 });
    expect(useGraph.getState().graphSignature).not.toBe(before);
  });

  it('校验计数没变时不重建节点数组', () => {
    resetStore();
    const id = useGraph.getState().addNode('prompt', { x: 0, y: 0 });
    const issues = [
      { severity: 'warning' as const, code: 'prompt.empty', message: '空', nodeId: id },
    ];

    useGraph.getState().setIssues(issues);
    const afterFirst = useGraph.getState().nodes;
    expect(afterFirst[0]!.data.issueCount).toEqual({ errors: 0, warnings: 1 });

    // 同样的校验结果重复写入：数组引用必须保持不变
    useGraph.getState().setIssues([...issues]);
    expect(useGraph.getState().nodes).toBe(afterFirst);
    useGraph.getState().setIssues([...issues]);
    expect(useGraph.getState().nodes).toBe(afterFirst);
  });

  it('校验计数变化时才重建节点数组', () => {
    resetStore();
    const id = useGraph.getState().addNode('prompt', { x: 0, y: 0 });
    useGraph.getState().setIssues([
      { severity: 'warning' as const, code: 'prompt.empty', message: '空', nodeId: id },
    ]);
    const before = useGraph.getState().nodes;

    useGraph.getState().setIssues([
      { severity: 'warning' as const, code: 'prompt.empty', message: '空', nodeId: id },
      { severity: 'error' as const, code: 'text.tooLong', message: '太长', nodeId: id },
    ]);
    expect(useGraph.getState().nodes).not.toBe(before);
    expect(useGraph.getState().nodes[0]!.data.issueCount).toEqual({ errors: 1, warnings: 1 });
  });

  it('相同内容的 run 状态写入不产生新对象', () => {
    resetStore();
    useGraph.getState().setRun({ running: true, total: 3, done: 1, label: '排队中' });
    const before = useGraph.getState().run;
    useGraph.getState().setRun({ running: true, total: 3, done: 1, label: '排队中' });
    expect(useGraph.getState().run).toBe(before);

    useGraph.getState().setRun({ done: 2 });
    expect(useGraph.getState().run).not.toBe(before);
  });
});
