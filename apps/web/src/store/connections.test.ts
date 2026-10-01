import { beforeEach, describe, expect, it } from 'vitest';
import { useGraph } from './graph.ts';

beforeEach(() => {
  useGraph.setState({ nodes: [], edges: [], past: [], future: [], selectedNodeId: null });
});

describe('拖线创建节点', () => {
  it('按选择的端口创建默认节点，节点与连线一起撤销、重做和导出', () => {
    const graph = useGraph.getState();
    const source = graph.addNode('videoGen', { x: 0, y: 0 });
    const history = useGraph.getState().past.length;
    const id = graph.addConnectedNode('regenerate', { x: 400, y: 120 }, {
      nodeId: source, handleId: 'video', handleType: 'source',
    }, 'frames');
    expect(useGraph.getState().nodes.find((node) => node.id === id)).toMatchObject({
      position: { x: 400, y: 120 }, data: { kind: 'regenerate', params: { mode: 'video' } },
    });
    expect(graph.exportGraph().edges).toEqual([expect.objectContaining({ source, sourceHandle: 'video', target: id, targetHandle: 'frames' })]);
    expect(useGraph.getState().past).toHaveLength(history + 1);
    const signature = useGraph.getState().graphSignature;
    graph.undo();
    expect(useGraph.getState().nodes.map((node) => node.id)).toEqual([source]);
    expect(useGraph.getState().edges).toHaveLength(0);
    graph.redo();
    expect(useGraph.getState().nodes).toHaveLength(2);
    expect(useGraph.getState().edges).toHaveLength(1);
    expect(useGraph.getState().graphSignature).toBe(signature);
  });

  it('从输入端拖线会创建上游节点，方向保持正确', () => {
    const graph = useGraph.getState();
    const target = graph.addNode('videoGen', { x: 500, y: 0 });
    const id = graph.addConnectedNode('prompt', { x: 100, y: 0 }, {
      nodeId: target, handleId: 'text', handleType: 'target',
    }, 'out');
    expect(useGraph.getState().edges[0]).toMatchObject({ source: id, sourceHandle: 'out', target, targetHandle: 'text' });
  });

  it('起点消失、端口不存在或不兼容时，不创建节点也不改历史', () => {
    const graph = useGraph.getState();
    const id = graph.addNode('prompt', { x: 0, y: 0 });
    const before = useGraph.getState();
    for (const origin of [
      { nodeId: 'missing', handleId: 'out', handleType: 'source' as const },
      { nodeId: id, handleId: 'missing', handleType: 'source' as const },
      { nodeId: id, handleId: 'out', handleType: 'source' as const },
    ]) {
      expect(graph.addConnectedNode('videoGen', { x: 400, y: 0 }, origin, 'frames')).toBeNull();
      expect(useGraph.getState().nodes).toBe(before.nodes);
      expect(useGraph.getState().edges).toBe(before.edges);
      expect(useGraph.getState().past).toBe(before.past);
    }
  });
});

describe('断开连接', () => {
  it('只移除指定连线，保留节点和其他连线；撤销、重做更新持久化内容', () => {
    const graph = useGraph.getState();
    const source = graph.addNode('prompt', { x: 0, y: 0 });
    const target = graph.addConnectedNode('videoGen', { x: 400, y: 0 }, { nodeId: source, handleId: 'out', handleType: 'source' }, 'text');
    graph.addConnectedNode('contextIR', { x: 400, y: 300 }, { nodeId: source, handleId: 'out', handleType: 'source' }, 'text');
    const before = useGraph.getState();
    const removed = before.edges.find((edge) => edge.target === target)!;
    graph.removeElements([], [removed.id]);
    expect(useGraph.getState().nodes).toEqual(before.nodes);
    expect(graph.exportGraph().edges).toHaveLength(1);
    expect(useGraph.getState().graphSignature).not.toBe(before.graphSignature);
    graph.undo();
    expect(useGraph.getState().edges).toEqual(before.edges);
    expect(useGraph.getState().graphSignature).toBe(before.graphSignature);
    graph.redo();
    expect(graph.exportGraph().edges.some((edge) => edge.id === removed.id)).toBe(false);
  });

  it('混合删除节点和连线只需一次撤销，清理关联边；无效删除不占用历史', () => {
    const graph = useGraph.getState();
    const source = graph.addNode('prompt', { x: 0, y: 0 });
    const a = graph.addConnectedNode('videoGen', { x: 400, y: 0 }, { nodeId: source, handleId: 'out', handleType: 'source' }, 'text')!;
    graph.addConnectedNode('contextIR', { x: 400, y: 300 }, { nodeId: source, handleId: 'out', handleType: 'source' }, 'text');
    const before = useGraph.getState();
    graph.removeElements([a], [before.edges[1]!.id]);
    expect(useGraph.getState().nodes).toHaveLength(2);
    expect(useGraph.getState().edges).toHaveLength(0);
    expect(useGraph.getState().past).toHaveLength(before.past.length + 1);
    graph.undo();
    expect(useGraph.getState().nodes).toEqual(before.nodes);
    expect(useGraph.getState().edges).toEqual(before.edges);
    graph.removeElements([], ['missing']);
    expect(useGraph.getState().past).toHaveLength(before.past.length);
  });
});
