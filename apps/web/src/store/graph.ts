/**
 * 画布图状态（zustand）。
 * 负责：节点/连线的增删改、撤销重做、与后端的工作流持久化、Skill 插入、校验结果与任务状态注入。
 */
import { create } from 'zustand';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type XYPosition,
} from '@xyflow/react';
import {
  defaultParamsFor,
  isPortCompatible,
  nodeDef,
  type ContentRole,
  type NodeKind,
  type SkillTemplate,
  type ValidationIssue,
  type WorkflowGraph,
  type PortKind,
} from '@h3/shared';
import { api, type ProjectRecord, type TaskRecord, type WorkflowRecord } from '../api/client.ts';
import { resolveNodeSlots } from '../engine/resolve.ts';
import {
  issueCountEquals,
  runtimeEquals,
  type CanvasNodeData,
  type NodeRuntime,
} from '../canvas/workflow-types.ts';

export type CanvasNode = Node<CanvasNodeData>;
export type CanvasEdge = Edge;

interface HistorySnapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface RunState {
  running: boolean;
  total: number;
  done: number;
  label: string;
}

interface GraphState {
  /* 数据 */
  projects: ProjectRecord[];
  workflows: WorkflowRecord[];
  activeProjectId: string | null;
  activeWorkflowId: string | null;
  workflowName: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  skills: SkillTemplate[];
  tasks: TaskRecord[];
  issues: ValidationIssue[];
  /**
   * 图谱内容签名（只含会被持久化的字段）。
   * 自动保存依赖它而不是 nodes 引用，避免运行时状态刷新导致反复保存。
   */
  graphSignature: string;
  selectedNodeId: string | null;
  run: RunState;
  saving: boolean;
  savedAt: number | null;
  loadError: string | null;

  /* 历史 */
  past: HistorySnapshot[];
  future: HistorySnapshot[];

  /* 节点操作 */
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<CanvasEdge>[]) => void;
  onConnect: (connection: Connection) => boolean;
  addNode: (kind: NodeKind, position: XYPosition, params?: Record<string, unknown>) => string;
  updateNodeParams: (nodeId: string, patch: Record<string, unknown>) => void;
  setNodeRuntime: (nodeId: string, patch: Partial<NodeRuntime>) => void;
  clearRuntime: () => void;
  removeNodes: (ids: string[]) => void;
  duplicateNode: (id: string) => void;
  setSelectedNode: (id: string | null) => void;
  toggleNodeDisabled: (id: string) => void;
  /**
   * 一次性写入一批节点与连线（创作台「发送」用）。
   * roleOverrides 的 key 是节点 id，用于把帧角色模式表达不到的单张素材角色标出来。
   */
  applyMaterialized: (
    nodes: CanvasNode[],
    edges: CanvasEdge[],
    roleOverrides?: Map<string, ContentRole>,
  ) => void;
  /** 只改素材节点的显式角色（生成节点上的能力预设用）。 */
  applyRoleOverrides: (overrides: Map<string, ContentRole>) => void;

  /* 历史 */
  undo: () => void;
  redo: () => void;

  /* 工作流 */
  bootstrap: () => Promise<void>;
  createProject: (name: string) => Promise<void>;
  updateProject: (projectId: string, patch: { name?: string; description?: string; cover?: string }) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
  selectWorkflow: (workflowId: string) => Promise<void>;
  createWorkflow: (name: string) => Promise<void>;
  deleteWorkflow: (workflowId: string) => Promise<void>;
  renameWorkflow: (name: string) => void;
  save: () => Promise<void>;
  reload: () => Promise<void>;
  importGraph: (graph: WorkflowGraph, name?: string) => Promise<void>;
  exportGraph: () => WorkflowGraph;
  clearCanvas: () => void;

  /* Skill */
  loadSkills: () => Promise<void>;
  insertSkill: (skill: SkillTemplate, position: XYPosition) => void;
  saveSkillFromSelection: (input: { name: string; description: string; nodeIds: string[] }) => Promise<void>;

  /* 任务 */
  setTasks: (tasks: TaskRecord[]) => void;
  upsertTask: (task: TaskRecord) => void;
  setIssues: (issues: ValidationIssue[]) => void;
  setRun: (patch: Partial<RunState>) => void;
}

const MAX_HISTORY = 50;

function snapshot(state: Pick<GraphState, 'nodes' | 'edges'>): HistorySnapshot {
  return { nodes: state.nodes, edges: state.edges };
}

/**
 * 图谱内容签名 —— 只包含会被持久化的字段（id / kind / position / params / disabled / 连线）。
 *
 * 运行时状态（任务进度、产物地址、校验计数）刻意不算在内：它们本来就是内存态，
 * 每几秒都会被轮询刷新一次；若参与签名，自动保存会被无限触发。
 */
export function graphSignature(nodes: CanvasNode[], edges: CanvasEdge[]): string {
  const nodePart = nodes
    .map(
      (node) =>
        `${node.id}:${node.data.kind}:${Math.round(node.position.x)},${Math.round(node.position.y)}:${node.data.disabled ? 1 : 0}:${JSON.stringify(node.data.params)}`,
    )
    .sort()
    .join('|');
  const edgePart = edges
    .map((edge) => `${edge.source}.${edge.sourceHandle ?? ''}>${edge.target}.${edge.targetHandle ?? ''}`)
    .sort()
    .join('|');
  return `${nodePart}##${edgePart}`;
}

function nodeLabel(kind: NodeKind, params: Record<string, unknown>): string {
  if (kind === 'prompt') {
    const text = String(params.text ?? '').trim();
    if (text.length > 0) return text.slice(0, 18);
  }
  return nodeDef(kind).label;
}

function makeNode(
  kind: NodeKind,
  position: XYPosition,
  params?: Record<string, unknown>,
): CanvasNode {
  const merged = { ...defaultParamsFor(kind), ...(params ?? {}) };
  return {
    id: `${kind}-${Math.random().toString(36).slice(2, 9)}`,
    type: kind,
    position,
    data: { kind, label: nodeLabel(kind, merged), params: merged },
  };
}

/** 收集某个节点的全部上游节点（含间接上游）。 */
function collectUpstream(nodeId: string, edges: CanvasEdge[]): string[] {
  const result = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const edge of edges) {
      if (edge.target === current && !result.has(edge.source)) {
        result.add(edge.source);
        queue.push(edge.source);
      }
    }
  }
  return [...result];
}

/**
 * 已经落盘过的工作流内容签名与名称。
 * 文件级 Map 而不是 store 字段：它不是 UI 状态，变化也不需要触发渲染。
 */
const lastSavedSignature = new Map<string, string>();
const lastSavedName = new Map<string, string>();

export const useGraph = create<GraphState>((rawSet, get) => {
  /**
   * 包一层 set：任何图谱变更后自动重算内容签名。
   * 用 get() 重新取值，因此写入顺序无关，也不会漏掉任何一条变更路径。
   */
  const set: typeof rawSet = (partial, replace) => {
    rawSet(partial as never, replace as never);
    const { nodes, edges } = get();
    rawSet({ graphSignature: graphSignature(nodes, edges) } as never);
  };

  return {
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
  graphSignature: '',
  selectedNodeId: null,
  run: { running: false, total: 0, done: 0, label: '' },
  saving: false,
  savedAt: null,
  loadError: null,
  past: [],
  future: [],

  onNodesChange: (changes) => {
    // 位置变化不进入历史（否则拖动一次会产生几十步撤销），只在结构变化时压栈
    const structural = changes.some((c) => c.type === 'remove' || c.type === 'add');
    if (structural) {
      set((state) => ({
        past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
        future: [],
      }));
    }
    set((state) => ({
      nodes: applyNodeChanges(changes as NodeChange<CanvasNode>[], state.nodes) as CanvasNode[],
    }));
  },

  onEdgesChange: (changes) => {
    const structural = changes.some((c) => c.type === 'remove' || c.type === 'add');
    if (structural) {
      set((state) => ({
        past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
        future: [],
      }));
    }
    set((state) => ({
      edges: applyEdgeChanges(changes as EdgeChange<CanvasEdge>[], state.edges) as CanvasEdge[],
    }));
  },

  onConnect: (connection) => {
    const { nodes, edges } = get();
    if (!connection.source || !connection.target) return false;
    if (connection.source === connection.target) return false;

    const sourceNode = nodes.find((n) => n.id === connection.source);
    const targetNode = nodes.find((n) => n.id === connection.target);
    if (!sourceNode || !targetNode) return false;

    const sourceDef = nodeDef(sourceNode.data.kind);
    const targetDef = nodeDef(targetNode.data.kind);
    const outPort = sourceDef.outputs.find((p) => p.id === connection.sourceHandle);
    const inPort = targetDef.inputs.find((p) => p.id === connection.targetHandle);
    if (!outPort || !inPort) return false;
    if (!isPortCompatible(outPort.kind as PortKind, inPort.kind as PortKind)) return false;

    // 不允许成环
    const upstreamOfSource = collectUpstream(connection.source, edges);
    if (upstreamOfSource.includes(connection.target)) return false;

    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
      future: [],
      edges: addEdge(
        {
          ...connection,
          id: `e-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
          type: 'smoothstep',
          animated: false,
        },
        state.edges,
      ) as CanvasEdge[],
    }));
    return true;
  },

  addNode: (kind, position, params) => {
    const node = makeNode(kind, position, params);
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
      future: [],
      nodes: [...state.nodes, node],
      selectedNodeId: node.id,
    }));
    return node.id;
  },

  applyMaterialized: (newNodes, newEdges, roleOverrides) => {
    if (newNodes.length === 0 && newEdges.length === 0) return;
    set((state) => {
      // 单张素材节点的角色：帧角色节点表达不了「这张是尾帧」这种单点信息，
      // 因此直接落到素材节点参数上，由 resolve.ts 读取。
      let nodes = newNodes;
      if (roleOverrides && roleOverrides.size > 0) {
        nodes = nodes.map((node) => {
          const role = roleOverrides.get(node.id);
          if (!role) return node;
          return {
            ...node,
            data: { ...node.data, params: { ...node.data.params, explicitRole: role } },
          };
        });
      }
      return {
        past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
        future: [],
        nodes: [...state.nodes, ...nodes],
        edges: [...state.edges, ...newEdges],
        selectedNodeId: nodes[0]?.id ?? state.selectedNodeId,
      };
    });
  },

  applyRoleOverrides: (overrides) => {
    if (overrides.size === 0) return;
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
      future: [],
      nodes: state.nodes.map((node) => {
        const role = overrides.get(node.id);
        if (!role) return node;
        return {
          ...node,
          data: { ...node.data, params: { ...node.data.params, explicitRole: role } },
        };
      }),
    }));
  },

  updateNodeParams: (nodeId, patch) => {
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
      future: [],
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId) return node;
        const params = { ...node.data.params, ...patch };
        return { ...node, data: { ...node.data, params, label: nodeLabel(node.data.kind, params) } };
      }),
    }));
  },

  setNodeRuntime: (nodeId, patch) => {
    set((state) => {
      let changed = false;
      const nodes = state.nodes.map((node) => {
        if (node.id !== nodeId) return node;
        const runtime: NodeRuntime = { status: 'idle', ...(node.data.runtime ?? {}), ...patch };
        // 关键：状态没变就不要产生新对象，否则依赖 nodes 引用的自动保存会被无限触发
        if (runtimeEquals(node.data.runtime, runtime)) return node;
        changed = true;
        return { ...node, data: { ...node.data, runtime } };
      });
      return changed ? { nodes } : {};
    });
  },

  clearRuntime: () => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        const data = { ...node.data };
        delete data.runtime;
        return { ...node, data };
      }),
    }));
  },

  removeNodes: (ids) => {
    const idSet = new Set(ids);
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
      future: [],
      nodes: state.nodes.filter((n) => !idSet.has(n.id)),
      edges: state.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
      selectedNodeId: state.selectedNodeId && idSet.has(state.selectedNodeId) ? null : state.selectedNodeId,
    }));
  },

  duplicateNode: (id) => {
    const node = get().nodes.find((n) => n.id === id);
    if (!node) return;
    const copy = makeNode(node.data.kind, { x: node.position.x + 40, y: node.position.y + 40 }, node.data.params);
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
      future: [],
      nodes: [...state.nodes, copy],
      selectedNodeId: copy.id,
    }));
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),
  toggleNodeDisabled: (id) =>
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, disabled: !n.data.disabled } } : n,
      ),
    })),

  undo: () => {
    const { past, nodes, edges } = get();
    const previous = past[past.length - 1];
    if (!previous) return;
    set((state) => ({
      past: state.past.slice(0, -1),
      future: [...state.future, { nodes, edges }],
      nodes: previous.nodes,
      edges: previous.edges,
    }));
  },

  redo: () => {
    const { future, nodes, edges } = get();
    const next = future[future.length - 1];
    if (!next) return;
    set((state) => ({
      future: state.future.slice(0, -1),
      past: [...state.past, { nodes, edges }],
      nodes: next.nodes,
      edges: next.edges,
    }));
  },

  /* ─────────────  工作流  ───────────── */

  bootstrap: async () => {
    try {
      const [{ items: projects }, { items: skills }] = await Promise.all([
        api.listProjects(),
        api.listSkills(),
      ]);
      set({ projects, skills, loadError: null });
      const first = projects[0];
      if (first) {
        await get().selectProject(first.id);
      }
    } catch (error) {
      set({ loadError: (error as Error).message });
    }
  },

  createProject: async (name) => {
    const { project } = await api.createProject({ name });
    const { items: projects } = await api.listProjects();
    set({ projects, activeProjectId: project.id });
    await get().selectWorkflow(project.id ? (await api.listWorkflows(project.id)).items[0]?.id ?? '' : '');
  },

  updateProject: async (projectId, patch) => {
    await api.updateProject(projectId, patch);
    const { items: projects } = await api.listProjects();
    set({ projects });
  },

  deleteProject: async (projectId) => {
    await api.deleteProject(projectId);
    const { items: projects } = await api.listProjects();
    set({ projects });
    const next = projects[0];
    if (next) await get().selectProject(next.id);
    else set({ activeProjectId: null, activeWorkflowId: null, workflows: [], nodes: [], edges: [] });
  },

  selectProject: async (projectId) => {
    const { items: workflows } = await api.listWorkflows(projectId);
    set({ activeProjectId: projectId, workflows });
    const first = workflows[0];
    if (first) {
      await get().selectWorkflow(first.id);
    } else {
      set({ activeWorkflowId: null, nodes: [], edges: [], workflowName: '未命名工作流' });
    }
  },

  selectWorkflow: async (workflowId) => {
    if (!workflowId) return;
    const { workflow } = await api.getWorkflow(workflowId);
    const loadedNodes = workflow.graph.nodes.map((n) => ({
      id: n.id,
      type: n.kind,
      position: n.position,
      data: {
        kind: n.kind,
        label: nodeLabel(n.kind, n.params),
        params: n.params,
        ...(n.disabled !== undefined ? { disabled: n.disabled } : {}),
      },
    })) as CanvasNode[];
    const loadedEdges = workflow.graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
      type: 'smoothstep',
    })) as CanvasEdge[];

    // 记下「刚读进来的内容」，这样刚打开就被自动保存触发时不会产生一次无意义的 PUT
    lastSavedSignature.set(workflow.id, graphSignature(loadedNodes, loadedEdges));
    lastSavedName.set(workflow.id, workflow.name);

    set({
      activeWorkflowId: workflow.id,
      workflowName: workflow.name,
      nodes: loadedNodes,
      edges: loadedEdges,
      past: [],
      future: [],
      selectedNodeId: null,
      savedAt: workflow.updatedAt * 1000,
    });
  },

  createWorkflow: async (name) => {
    const projectId = get().activeProjectId;
    if (!projectId) return;
    const { workflow } = await api.createWorkflow({ projectId, name });
    const { items: workflows } = await api.listWorkflows(projectId);
    set({ workflows });
    await get().selectWorkflow(workflow.id);
  },

  deleteWorkflow: async (workflowId) => {
    await api.deleteWorkflow(workflowId);
    const projectId = get().activeProjectId;
    if (!projectId) return;
    const { items: workflows } = await api.listWorkflows(projectId);
    set({ workflows });
    const next = workflows[0];
    if (next) await get().selectWorkflow(next.id);
    else set({ activeWorkflowId: null, nodes: [], edges: [] });
  },

  renameWorkflow: (name) => set({ workflowName: name }),

  save: async () => {
    const { activeWorkflowId, nodes, edges, workflowName, graphSignature: signature } = get();
    if (!activeWorkflowId) return;
    // 内容没变就不发请求：轮询、状态刷新都不应该产生一次 PUT
    if (signature === lastSavedSignature.get(activeWorkflowId) && workflowName === lastSavedName.get(activeWorkflowId)) {
      return;
    }
    set({ saving: true });
    try {
      const graph: WorkflowGraph = {
        nodes: nodes.map((n) => ({
          id: n.id,
          kind: n.data.kind,
          position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
          params: n.data.params,
          ...(n.data.disabled !== undefined ? { disabled: n.data.disabled } : {}),
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          sourceHandle: e.sourceHandle ?? 'out',
          target: e.target,
          targetHandle: e.targetHandle ?? 'in',
        })),
      };
      const { workflow } = await api.saveWorkflow(activeWorkflowId, graph, workflowName);
      lastSavedSignature.set(activeWorkflowId, signature);
      lastSavedName.set(activeWorkflowId, workflowName);
      set({ savedAt: workflow.updatedAt * 1000, loadError: null });
    } catch (error) {
      set({ loadError: (error as Error).message });
    } finally {
      set({ saving: false });
    }
  },

  reload: async () => {
    const id = get().activeWorkflowId;
    if (id) await get().selectWorkflow(id);
  },

  importGraph: async (graph, name) => {
    const projectId = get().activeProjectId;
    if (!projectId) return;
    const { workflow } = await api.importWorkflow({
      projectId,
      name: name ?? '导入的工作流',
      graph,
    });
    const { items: workflows } = await api.listWorkflows(projectId);
    set({ workflows });
    await get().selectWorkflow(workflow.id);
  },

  exportGraph: () => {
    const { nodes, edges } = get();
    return {
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: n.data.kind,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        params: n.data.params,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle ?? 'out',
        target: e.target,
        targetHandle: e.targetHandle ?? 'in',
      })),
    };
  },

  clearCanvas: () =>
    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
      future: [],
      nodes: [],
      edges: [],
      selectedNodeId: null,
    })),

  /* ─────────────  Skill  ───────────── */

  loadSkills: async () => {
    const { items } = await api.listSkills();
    set({ skills: items });
  },

  insertSkill: (skill, position) => {
    const baseX = position.x;
    const baseY = position.y;
    const idByKey = new Map<string, string>();
    const newNodes: CanvasNode[] = skill.nodes.map((template, index) => {
      const offset = template.offset ?? { x: index * 280, y: 0 };
      const node = makeNode(template.kind, { x: baseX + offset.x, y: baseY + offset.y }, template.params);
      idByKey.set(template.key, node.id);
      return node;
    });

    const newEdges: CanvasEdge[] = skill.edges
      .map((template) => {
        const source = idByKey.get(template.from);
        const target = idByKey.get(template.to);
        if (!source || !target) return null;
        return {
          id: `e-${source}-${template.fromHandle}-${target}-${template.toHandle}`,
          source,
          sourceHandle: template.fromHandle,
          target,
          targetHandle: template.toHandle,
          type: 'smoothstep',
        } as CanvasEdge;
      })
      .filter((e): e is CanvasEdge => e !== null);

    set((state) => ({
      past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
      future: [],
      nodes: [...state.nodes, ...newNodes],
      edges: [...state.edges, ...newEdges],
      selectedNodeId: newNodes[0]?.id ?? null,
    }));
  },

  saveSkillFromSelection: async ({ name, description, nodeIds }) => {
    const { nodes, edges } = get();
    const idSet = new Set(nodeIds);
    const selected = nodes.filter((n) => idSet.has(n.id));
    if (selected.length === 0) return;

    // 以选区左上角为原点归一化坐标
    const minX = Math.min(...selected.map((n) => n.position.x));
    const minY = Math.min(...selected.map((n) => n.position.y));

    const keyById = new Map<string, string>();
    selected.forEach((node, index) => keyById.set(node.id, `n${index + 1}`));

    const skill: Partial<SkillTemplate> = {
      name,
      category: 'generation',
      description,
      nodes: selected.map((node) => ({
        key: keyById.get(node.id)!,
        kind: node.data.kind,
        params: node.data.params,
        offset: { x: node.position.x - minX, y: node.position.y - minY },
      })),
      edges: edges
        .filter((e) => idSet.has(e.source) && idSet.has(e.target))
        .map((e) => ({
          from: keyById.get(e.source)!,
          fromHandle: e.sourceHandle ?? 'out',
          to: keyById.get(e.target)!,
          toHandle: e.targetHandle ?? 'in',
        })),
    };

    const { skill: created } = await api.createSkill(skill);
    set((state) => ({ skills: [...state.skills, created] }));
  },

  /* ─────────────  任务与校验  ───────────── */

  setTasks: (tasks) => set({ tasks }),

  upsertTask: (task) =>
    set((state) => {
      const index = state.tasks.findIndex((t) => t.id === task.id);
      if (index === -1) return { tasks: [task, ...state.tasks] };
      const next = [...state.tasks];
      next[index] = task;
      return { tasks: next };
    }),

  setIssues: (issues) => {
    const byNode = new Map<string, { errors: number; warnings: number }>();
    for (const issue of issues) {
      if (!issue.nodeId) continue;
      const entry = byNode.get(issue.nodeId) ?? { errors: 0, warnings: 0 };
      if (issue.severity === 'error') entry.errors += 1;
      else entry.warnings += 1;
      byNode.set(issue.nodeId, entry);
    }
    set((state) => {
      let changed = false;
      const nodes = state.nodes.map((node) => {
        const counts = byNode.get(node.id);
        const next = counts ?? { errors: 0, warnings: 0 };
        // 计数没变就不要产生新对象
        if (issueCountEquals(node.data.issueCount, next)) return node;
        changed = true;
        return { ...node, data: { ...node.data, issueCount: next } };
      });
      return changed ? { issues, nodes } : { issues };
    });
  },

  setRun: (patch) => {
    set((state) => {
      const next = { ...state.run, ...patch };
      const same =
        next.running === state.run.running &&
        next.total === state.run.total &&
        next.done === state.run.done &&
        next.label === state.run.label;
      return same ? {} : { run: next };
    });
  },
};
});

/** 便捷 selector：当前选中节点 */
export function useSelectedNode(): CanvasNode | null {
  return useGraph((state) => state.nodes.find((n) => n.id === state.selectedNodeId) ?? null);
}

/** 解析某个节点的全部输入槽位（供执行引擎与检查器复用）。 */
export function useResolvedSlots(nodeId: string | null) {
  return useGraph((state) => (nodeId ? resolveNodeSlots(nodeId, state.nodes, state.edges) : null));
}
