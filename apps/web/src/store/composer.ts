/**
 * 创作台（Composer）状态。
 *
 * 定位：画布底部的悬浮创作面板，是「素材 + 提示词 + 能力预设 + 参数 + 预估消耗 + 发送」的集中入口。
 * 它本身不是画布节点 —— 点发送时才把草稿落地成画布上的「图片节点 + 提示词节点」并接到目标生成节点上，
 * 这样画布始终是唯一的图谱事实来源，创作台只是一个更顺手的输入面。
 */
import { create } from 'zustand';
import {
  PRESETS,
  coerceRatio,
  defaultParamsFor,
  modeFromPreset,
  presetById,
  rolesForCount,
  type ContentRole,
  type GenMode,
  type H3Model,
  type Ratio,
  type Resolution,
  type SoundMode,
  type ValidationIssue,
} from '@h3/shared';
import type { CanvasNode, CanvasEdge } from './graph.ts';
import { useGraph } from './graph.ts';

export type { PresetId } from '@h3/shared';

export interface ComposerMedia {
  id: string;
  kind: 'image' | 'video' | 'audio';
  url: string;
  assetId?: string;
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
  durationSec?: number;
  name?: string;
}

export interface ComposerState {
  expanded: boolean;
  text: string;
  media: ComposerMedia[];
  presetId: string;
  model: H3Model;
  resolution: Resolution;
  duration: number;
  ratio: Ratio;
  aigcWatermark: boolean;
  sound: SoundMode;
  /** 绑定到哪个生成节点；为空表示发送时新建 */
  targetNodeId: string | null;
  /** 用户手动锁定过目标后不再跟随选中项 */
  targetPinned: boolean;
  lastIssue: ValidationIssue | null;

  setExpanded: (value: boolean) => void;
  toggleExpanded: () => void;
  setText: (value: string) => void;
  addMedia: (items: ComposerMedia[]) => void;
  removeMedia: (id: string) => void;
  clearMedia: () => void;
  setPreset: (id: string) => void;
  setParam: (
    patch: Partial<Pick<ComposerState, 'model' | 'resolution' | 'duration' | 'ratio' | 'aigcWatermark' | 'sound'>>,
  ) => void;
  setTarget: (nodeId: string | null, pinned?: boolean) => void;
  /** 跟随画布选中项（只在未锁定、未展开手动指定时生效） */
  followSelection: (nodeId: string | null) => void;
  reset: () => void;
  applyFromNode: (node: CanvasNode) => void;
  setIssue: (issue: ValidationIssue | null) => void;
}

const DEFAULTS = {
  expanded: true,
  text: '',
  media: [] as ComposerMedia[],
  presetId: '全能参考',
  model: 'MiniMax-H3' as H3Model,
  resolution: '768P' as Resolution,
  duration: 8,
  ratio: 'adaptive' as Ratio,
  aigcWatermark: false,
  sound: '有声' as SoundMode,
  targetNodeId: null as string | null,
  targetPinned: false,
  lastIssue: null as ValidationIssue | null,
};

let mediaSeq = 0;

export function makeComposerMedia(
  input: Omit<ComposerMedia, 'id'>,
): ComposerMedia {
  mediaSeq += 1;
  return { id: `cm-${Date.now().toString(36)}-${mediaSeq}`, ...input };
}

export const useComposer = create<ComposerState>((set, get) => ({
  ...DEFAULTS,

  setExpanded: (value) => set({ expanded: value }),
  toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),
  setText: (value) => set({ text: value }),

  addMedia: (items) => set((s) => ({ media: [...s.media, ...items] })),
  removeMedia: (id) => set((s) => ({ media: s.media.filter((m) => m.id !== id) })),
  clearMedia: () => set({ media: [] }),

  setPreset: (id) => {
    const preset = presetById(id);
    if (!preset) return;
    set((s) => ({
      presetId: preset.id,
      // 比例收敛到该生成方式允许的值，避免留下一个会被接口忽略的比例
      ratio: coerceRatio(preset.id, s.ratio),
    }));
  },

  setParam: (patch) => set(patch),

  setTarget: (nodeId, pinned = true) => set({ targetNodeId: nodeId, targetPinned: pinned }),

  followSelection: (nodeId) => {
    const { targetPinned } = get();
    if (targetPinned) return;
    set({ targetNodeId: nodeId });
  },

  reset: () =>
    set((s) => ({
      ...DEFAULTS,
      // 保留用户选的目标与展开状态，避免每次发完都要重新选一遍
      expanded: s.expanded,
      targetNodeId: s.targetNodeId,
      targetPinned: s.targetPinned,
      model: s.model,
      resolution: s.resolution,
      duration: s.duration,
    })),

  applyFromNode: (node) => {
    const params = node.data.params;
    const next: Partial<ComposerState> = {
      model: params.model === 'MiniMax-H3-Max' ? 'MiniMax-H3-Max' : 'MiniMax-H3',
      resolution: (['480P', '768P', '2K'].includes(String(params.resolution))
        ? params.resolution
        : '768P') as Resolution,
      duration: typeof params.duration === 'number' ? params.duration : 8,
      ratio: (typeof params.ratio === 'string' ? params.ratio : 'adaptive') as Ratio,
      aigcWatermark: params.aigcWatermark === true,
      sound: params.sound === '无声' ? '无声' : '有声',
      ...(typeof params.presetId === 'string' ? { presetId: params.presetId } : {}),
    };
    set(next);
  },

  setIssue: (issue) => set({ lastIssue: issue }),
}));

/** 预设 → 给定的图片角色序列（按张数循环补齐） */
export { rolesForCount } from '@h3/shared';

/** 由预设与素材推断当前会走哪种生成场景，用于创作台上显示徽标。 */
export function composerMode(presetId: string, media: ComposerMedia[]): GenMode {
  return modeFromPreset(
    presetId,
    media.map((m) => m.kind),
  );
}

/* ───────────────────────  草稿 → 画布  ─────────────────────── */

export interface MaterializePlan {
  /** 需要新建的节点（素材节点 + 提示词节点） */
  nodes: Array<{ tempId: string; node: CanvasNode }>;
  /** 需要新建的连线：source/target 既可能是临时 id，也可能是已存在的节点 id */
  edges: Array<Omit<CanvasEdge, 'id'> & { id?: string }>;
  roleByTempId: Map<string, ContentRole>;
  /** 绑定的已有生成节点 id（为空表示本次会新建） */
  targetNodeId: string | null;
  /** 绑定到已有生成节点时，需要同步写入的参数补丁 */
  targetParamPatch?: Record<string, unknown>;
}

/**
 * 把创作台草稿规划成画布改动。
 * 纯函数，不触碰 store —— 方便单测，也让「发送」这一步可预测。
 */
export function planMaterialize(input: {
  draft: Pick<
    ComposerState,
    'text' | 'media' | 'presetId' | 'model' | 'resolution' | 'duration' | 'ratio' | 'aigcWatermark' | 'sound'
  >;
  targetNodeId: string | null;
  anchor: { x: number; y: number };
}): MaterializePlan & { targetTempId: string; targetIsNew: boolean } {
  const preset = presetById(input.draft.presetId) ?? PRESETS[0]!;
  const nodes: MaterializePlan['nodes'] = [];
  const edges: MaterializePlan['edges'] = [];
  const roleByTempId = new Map<string, ContentRole>();

  let seq = 0;
  const nextTempId = (prefix: string) => {
    seq += 1;
    return `${prefix}-new-${seq}-${Math.random().toString(36).slice(2, 7)}`;
  };

  const targetIsNew = !input.targetNodeId;
  const targetTempId = input.targetNodeId ?? nextTempId('videoGen');
  let targetParamPatch: Record<string, unknown> | undefined;

  // 目标生成节点
  if (targetIsNew) {
    const targetParams = {
      ...defaultParamsFor('videoGen'),
      model: input.draft.model,
      resolution: input.draft.resolution,
      duration: input.draft.duration,
      ratio: input.draft.ratio,
      aigcWatermark: input.draft.aigcWatermark,
      presetId: preset.id,
      sound: input.draft.sound,
    };
    nodes.push({
      tempId: targetTempId,
      node: {
        id: targetTempId,
        type: 'videoGen',
        position: { x: input.anchor.x + 380, y: input.anchor.y },
        data: { kind: 'videoGen', label: '视频生成', params: targetParams },
      },
    });
  }

  // 绑定了已有节点时，把创作台的参数同步写进去（用户在创作台改的参数必须生效）
  if (!targetIsNew && input.targetNodeId) {
    targetParamPatch = {
      presetId: preset.id,
      model: input.draft.model,
      resolution: input.draft.resolution,
      duration: input.draft.duration,
      ratio: coerceRatio(preset.id, input.draft.ratio),
      sound: input.draft.sound,
    };
  }

  // 提示词节点
  const text = input.draft.text.trim();
  if (text.length > 0) {
    const tempId = nextTempId('prompt');
    nodes.push({
      tempId,
      node: {
        id: tempId,
        type: 'prompt',
        position: { x: input.anchor.x, y: input.anchor.y + 120 },
        data: { kind: 'prompt', label: text.slice(0, 18), params: { text } },
      },
    });
    edges.push({ source: tempId, sourceHandle: 'out', target: targetTempId, targetHandle: 'text' });
  }

  // 素材节点 + 一个聚合用的帧角色节点（多于 1 张时才需要）
  const roles = rolesForCount(preset, input.draft.media.length);
  const mediaTempIds: string[] = [];

  input.draft.media.forEach((item, index) => {
    const tempId = nextTempId(item.kind);
    const params: Record<string, unknown> = {
      // 先铺默认参数，保证节点可被画布直接渲染（例如素材节点的 ref 占位）
      ...defaultParamsFor(item.kind),
      kind: item.kind,
      url: item.url,
      ...(item.mime ? { mime: item.mime } : {}),
      ...(item.bytes !== undefined ? { bytes: item.bytes } : {}),
      ...(item.width !== undefined ? { width: item.width } : {}),
      ...(item.height !== undefined ? { height: item.height } : {}),
      ...(item.durationSec !== undefined ? { durationSec: item.durationSec } : {}),
      ...(item.assetId ? { assetId: item.assetId } : {}),
      ...(item.name ? { name: item.name } : {}),
    };
    nodes.push({
      tempId,
      node: {
        id: tempId,
        type: item.kind,
        position: { x: input.anchor.x, y: input.anchor.y + index * 200 },
        data: { kind: item.kind, label: item.name ?? item.kind, params },
      },
    });
    mediaTempIds.push(tempId);
  });

  const role = roles[0] ?? (preset.mode === 'r2va' ? 'reference_image' : undefined);

  if (mediaTempIds.length === 1) {
    const tempId = mediaTempIds[0]!;
    edges.push({ source: tempId, sourceHandle: 'out', target: targetTempId, targetHandle: 'frames' });
    if (role) roleByTempId.set(tempId, role);
  } else if (mediaTempIds.length > 1) {
    // 多张素材：插一个帧角色节点做角色分配，保持画布语义清晰
    const frameTempId = nextTempId('frameRole');
    const mode = preset.mode === 'r2va' ? 'reference' : 'first-last';
    nodes.push({
      tempId: frameTempId,
      node: {
        id: frameTempId,
        type: 'frameRole',
        position: { x: input.anchor.x + 190, y: input.anchor.y },
        data: {
          kind: 'frameRole',
          label: '帧角色',
          params: { ...defaultParamsFor('frameRole'), mode, referenceRole: 'reference_image' },
        },
      },
    });
    for (const mediaTempId of mediaTempIds) {
      edges.push({ source: mediaTempId, sourceHandle: 'out', target: frameTempId, targetHandle: 'in' });
    }
    edges.push({ source: frameTempId, sourceHandle: 'out', target: targetTempId, targetHandle: 'frames' });
    // 单角色预设（首帧 / 尾帧 / 参考图）需要逐个标到素材上
    if (preset.roles.length === 1 && preset.roles[0] !== 'reference_image') {
      mediaTempIds.forEach((tempId, index) => {
        if (index === 0) roleByTempId.set(tempId, preset.roles[0]!);
      });
    }
  }

  return {
    nodes,
    edges,
    roleByTempId,
    targetNodeId: input.targetNodeId,
    targetTempId,
    targetIsNew,
    ...(targetParamPatch ? { targetParamPatch } : {}),
  };
}

/** 把规划结果写进画布 store。 */
export function materializeToCanvas(plan: ReturnType<typeof planMaterialize>): string {
  const store = useGraph.getState();
  const idMap = new Map<string, string>();

  const created = plan.nodes.map(({ tempId, node }) => {
    const finalId = `${node.data.kind}-${Math.random().toString(36).slice(2, 9)}`;
    idMap.set(tempId, finalId);
    return { ...node, id: finalId };
  });

  const resolve = (id: string) => idMap.get(id) ?? id;

  const newEdges: CanvasEdge[] = plan.edges.map((edge) => ({
    id: `e-${resolve(edge.source)}-${edge.sourceHandle}-${resolve(edge.target)}-${edge.targetHandle}`,
    source: resolve(edge.source),
    sourceHandle: edge.sourceHandle,
    target: resolve(edge.target),
    targetHandle: edge.targetHandle,
    type: 'smoothstep',
  }));

  store.applyMaterialized(created, newEdges, plan.roleByTempId);

  // 绑定了已有生成节点时，把创作台上调的参数同步进去
  if (plan.targetParamPatch && plan.targetNodeId) {
    store.updateNodeParams(plan.targetNodeId, plan.targetParamPatch);
  }

  return resolve(plan.targetTempId);
}
