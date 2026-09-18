/**
 * 节点参数定义（单一事实来源）。
 * 画布渲染、参数表单、校验、请求体组装全部从这里读取能力与端口定义，避免多处漂移。
 */
import type {
  ContentRole,
  GenMode,
  H3Model,
  NodeKind,
  PortKind,
  Ratio,
  Resolution,
} from './types.ts';

/* ───────────────────────  节点参数结构  ─────────────────────── */

export interface PromptParams {
  text: string;
}

export interface MediaParams {
  /** 素材类型，决定送进 content 时用 image_url / video_url / audio_url */
  kind: 'image' | 'video' | 'audio';
  ref: unknown | null;
}

export interface FrameRoleParams {
  /** 该槽位把上游图片标记成什么角色 */
  mode: 'first-last' | 'reference';
  referenceRole: ContentRole;
}

export interface VideoGenParams {
  model: H3Model;
  resolution: Resolution;
  duration: number;
  ratio: Ratio;
  aigcWatermark: boolean;
  /** 运行前确认（会真实扣费） */
  confirmBeforeRun: boolean;
  /** 生成方式（界面上的分段控件） */
  presetId: string;
  /** 有声 / 无声：落成附加提示词，接口本身没有配音开关 */
  sound: '有声' | '无声';
}

export interface ContextIRParams {
  model: 'MiniMax-H3';
  duration: number;
  ratio: Ratio;
}

export interface RegenerateParams {
  mode: 'task' | 'video';
  sourceTaskId: string;
  aigcWatermark: boolean;
}

export interface TaskStatusParams {
  taskId: string;
  /** 自动跟随节点运行产出的 taskId */
  followUpstream: boolean;
}

export interface TaskListParams {
  pageSize: number;
  taskType: 'all' | 'generation' | 'h3_context_ir' | 'regeneration';
  autoRefresh: boolean;
}

export type NodeParamsOf<K extends NodeKind> = K extends 'prompt'
  ? PromptParams
  : K extends 'image' | 'video' | 'audio'
    ? MediaParams
    : K extends 'frameRole'
      ? FrameRoleParams
      : K extends 'videoGen'
        ? VideoGenParams
        : K extends 'contextIR'
          ? ContextIRParams
          : K extends 'regenerate'
            ? RegenerateParams
            : K extends 'taskStatus'
              ? TaskStatusParams
              : K extends 'taskList'
                ? TaskListParams
                : never;

/* ───────────────────────  端口定义  ─────────────────────── */

export interface PortDef {
  id: string;
  kind: PortKind;
  label: string;
  /** 该输入端口是否至少需要一个上游连接 */
  required?: boolean;
  /** 该输入端口是否接受多个上游 */
  multiple?: boolean;
}

export interface NodeDef {
  kind: NodeKind;
  label: string;
  /** 左栏节点库的分组 */
  group: '输入' | '任务' | '组织' | '管理';
  description: string;
  accent: string;
  inputs: PortDef[];
  outputs: PortDef[];
  defaultParams: () => Record<string, unknown>;
}

export const NODE_DEFS: Record<NodeKind, NodeDef> = {
  prompt: {
    kind: 'prompt',
    label: '提示词',
    group: '输入',
    description: '描述期望生成的视频。所有场景都必须有一个非空 prompt。',
    accent: '#8b5cf6',
    inputs: [],
    outputs: [{ id: 'out', kind: 'text', label: '文本' }],
    defaultParams: () => ({ text: '' }),
  },
  image: {
    kind: 'image',
    label: '图片',
    group: '输入',
    description: '本地上传或公网 URL。单张 ≤ 30 MB，宽高 ∈ [256,5760]px，宽高比 ∈ [0.4,2.5]。',
    accent: '#0ea5e9',
    inputs: [],
    outputs: [{ id: 'out', kind: 'media', label: '素材' }],
    defaultParams: () => ({ kind: 'image', ref: null }),
  },
  video: {
    kind: 'video',
    label: '视频',
    group: '输入',
    description: '多模态参考用。MP4/MOV，单个 ≤ 50 MB，≤3 段且总时长 ≤ 15s。',
    accent: '#14b8a6',
    inputs: [],
    outputs: [{ id: 'out', kind: 'media', label: '素材' }],
    defaultParams: () => ({ kind: 'video', ref: null }),
  },
  audio: {
    kind: 'audio',
    label: '音频',
    group: '输入',
    description: '音色参考用。WAV/MP3，单个 ≤ 15 MB，≤3 段且总时长 ≤ 15s。音频输入免费。',
    accent: '#f59e0b',
    inputs: [],
    outputs: [{ id: 'out', kind: 'media', label: '素材' }],
    defaultParams: () => ({ kind: 'audio', ref: null }),
  },
  frameRole: {
    kind: 'frameRole',
    label: '帧角色',
    group: '组织',
    description:
      '把上游图片按角色送入生成节点。图生视频与多模态参考互斥，不可混用。',
    accent: '#ec4899',
    inputs: [{ id: 'in', kind: 'media', label: '图片', multiple: true }],
    outputs: [{ id: 'out', kind: 'media', label: '带角色素材' }],
    defaultParams: () => ({ mode: 'first-last', referenceRole: 'reference_image' }),
  },
  videoGen: {
    kind: 'videoGen',
    label: '视频生成',
    group: '任务',
    description:
      '调用 POST /v2/video_generation。场景由 content 组成自动判定为 t2va / i2va / r2va。',
    accent: '#3b82f6',
    inputs: [
      { id: 'text', kind: 'text', label: '提示词', required: true },
      { id: 'frames', kind: 'media', label: '帧 / 参考素材', multiple: true },
    ],
    outputs: [{ id: 'video', kind: 'video', label: '视频' }],
    defaultParams: () => ({
      model: 'MiniMax-H3',
      resolution: '768P',
      duration: 8,
      ratio: 'adaptive',
      aigcWatermark: false,
      confirmBeforeRun: true,
      presetId: '全能参考',
      sound: '有声',
    }),
  },
  contextIR: {
    kind: 'contextIR',
    label: 'Context-IR 增强',
    group: '任务',
    description:
      '调用 POST /v2/h3_context_ir 生成结构化增强提示词。注意：不会创建视频生成任务。',
    accent: '#a855f7',
    inputs: [
      { id: 'text', kind: 'text', label: '原始提示词', required: true },
      { id: 'frames', kind: 'media', label: '上下文素材', multiple: true },
    ],
    outputs: [{ id: 'text', kind: 'text', label: '增强提示词' }],
    defaultParams: () => ({
      model: 'MiniMax-H3',
      duration: 5,
      ratio: '16:9',
    }),
  },
  regenerate: {
    kind: 'regenerate',
    label: '视频再生成',
    group: '任务',
    description:
      '调用 POST /v2/video_regeneration，把 H3 768P 产物再生成为 2K（0.30 元/秒）。',
    accent: '#f97316',
    inputs: [
      { id: 'video', kind: 'video', label: '源素材 / 上游任务', multiple: false },
      { id: 'text', kind: 'text', label: '原始提示词', multiple: false },
      { id: 'frames', kind: 'media', label: '原任务素材', multiple: true },
    ],
    outputs: [{ id: 'video', kind: 'video', label: '2K 视频' }],
    defaultParams: () => ({
      mode: 'video',
      sourceTaskId: '',
      aigcWatermark: false,
    }),
  },
  taskStatus: {
    kind: 'taskStatus',
    label: '任务状态',
    group: '管理',
    description: '轮询单个任务，支持取消（仅 queued）、删除（仅 succeeded/failed）与产物转存。',
    accent: '#22c55e',
    inputs: [{ id: 'in', kind: 'any', label: '上游任务', multiple: true }],
    outputs: [{ id: 'video', kind: 'video', label: '产物' }],
    defaultParams: () => ({ taskId: '', followUpstream: true }),
  },
  taskList: {
    kind: 'taskList',
    label: '任务列表',
    group: '管理',
    description: '查询最近 7 天任务列表，可把任一任务的参数一键填回画布。',
    accent: '#64748b',
    inputs: [],
    outputs: [],
    defaultParams: () => ({ pageSize: 20, taskType: 'all', autoRefresh: false }),
  },
};

/* ───────────────────────  便捷方法  ─────────────────────── */

export function nodeDef(kind: NodeKind): NodeDef {
  return NODE_DEFS[kind];
}

/** 端口类型兼容矩阵：上游输出 kind → 下游输入 kind。 */
export function isPortCompatible(source: PortKind, target: PortKind): boolean {
  if (target === 'any') return true;
  if (source === target) return true;
  // 视频产物可以喂给需要素材的输入口（例如再生成的原任务素材）
  if (source === 'video' && target === 'media') return true;
  // 文本节点可以接到 any 口（上面已处理）
  return false;
}

export function defaultParamsFor(kind: NodeKind): Record<string, unknown> {
  return NODE_DEFS[kind].defaultParams();
}

/** 参数摘要，用于节点头部一行展示。 */
export function summarizeParams(kind: NodeKind, params: Record<string, unknown>): string {
  switch (kind) {
    case 'prompt': {
      const text = String(params.text ?? '');
      return text.length === 0 ? '未填写' : `${text.length} 字符`;
    }
    case 'videoGen': {
      const p = params as unknown as VideoGenParams;
      const method = typeof params.presetId === 'string' ? `${params.presetId} · ` : '';
      return `${method}${p.model} · ${p.resolution} · ${p.duration}s · ${p.ratio}`;
    }
    case 'contextIR': {
      const p = params as unknown as ContextIRParams;
      return `H3 · ${p.duration}s · ${p.ratio}`;
    }
    case 'regenerate':
      return (params.mode as string) === 'task' ? '按任务 ID · 2K' : '按源视频 · 2K';
    case 'frameRole': {
      const p = params as unknown as FrameRoleParams;
      return p.mode === 'first-last' ? '首帧 / 尾帧' : `参考图`;
    }
    case 'taskStatus': {
      const id = String(params.taskId ?? '');
      return id ? `任务 ${id}` : '跟随上游';
    }
    case 'taskList':
      return '最近 7 天';
    default:
      return '';
  }
}

/** content 组成 → 生成场景（t2va / i2va / r2va）。 */
export function detectGenMode(roles: ContentRole[], mediaKinds: Array<'image' | 'video' | 'audio'>): GenMode {
  const hasReference =
    roles.some((r) => r === 'reference_image' || r === 'reference_video' || r === 'reference_audio') ||
    mediaKinds.some((k) => k !== 'image');
  if (hasReference) return 'r2va';
  if (roles.some((r) => r === 'first_frame' || r === 'last_frame')) return 'i2va';
  return 't2va';
}
