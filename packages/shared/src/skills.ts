/**
 * 内置 Skill —— 可复用的节点图模板 + 参数预设。
 * 在无 LLM 的纯工作流引擎里，「Skill」= 一套编排好的节点与连线，一键插入画布。
 */
import type { NodeKind } from './types.ts';

export type SkillCategory = 'generation' | 'reference' | 'pipeline' | 'utility';

export interface SkillNodeTemplate {
  /** Skill 内部的局部 key，供 edges 引用 */
  key: string;
  kind: NodeKind;
  params: Record<string, unknown>;
  offset?: { x: number; y: number };
}

export interface SkillEdgeTemplate {
  from: string;
  fromHandle: string;
  to: string;
  toHandle: string;
}

export interface SkillTemplate {
  id: string;
  name: string;
  category: SkillCategory;
  description: string;
  nodes: SkillNodeTemplate[];
  edges: SkillEdgeTemplate[];
  builtin: boolean;
  version: number;
}

export const SKILL_CATEGORY_LABELS: Record<SkillCategory, string> = {
  generation: '生成',
  reference: '参考素材',
  pipeline: '流水线',
  utility: '工具',
};

export const BUILTIN_SKILLS: SkillTemplate[] = [
  {
    id: 'skill.t2va-768p',
    name: '文生视频 768P',
    category: 'generation',
    description: 'H3 + 768P + 16:9 + 5s 的文生视频起步模板（0.50 元/秒）。',
    nodes: [
      { key: 'prompt', kind: 'prompt', params: { text: '' }, offset: { x: 0, y: 0 } },
      {
        key: 'gen',
        kind: 'videoGen',
        params: {
          model: 'MiniMax-H3',
          resolution: '768P',
          duration: 5,
          ratio: '16:9',
          aigcWatermark: false,
          confirmBeforeRun: true,
        },
        offset: { x: 340, y: 0 },
      },
    ],
    edges: [{ from: 'prompt', fromHandle: 'out', to: 'gen', toHandle: 'text' }],
    builtin: true,
    version: 1,
  },
  {
    id: 'skill.t2va-2k',
    name: '文生视频 2K',
    category: 'generation',
    description: 'H3 + 2K + 16:9 + 5s（0.80 元/秒）。适合最终输出。',
    nodes: [
      { key: 'prompt', kind: 'prompt', params: { text: '' }, offset: { x: 0, y: 0 } },
      {
        key: 'gen',
        kind: 'videoGen',
        params: {
          model: 'MiniMax-H3',
          resolution: '2K',
          duration: 5,
          ratio: '16:9',
          aigcWatermark: false,
          confirmBeforeRun: true,
        },
        offset: { x: 340, y: 0 },
      },
    ],
    edges: [{ from: 'prompt', fromHandle: 'out', to: 'gen', toHandle: 'text' }],
    builtin: true,
    version: 1,
  },
  {
    id: 'skill.i2va-first-frame',
    name: '图生视频 · 首帧',
    category: 'generation',
    description: '一张图作为首帧驱动生成。宽高比由图片决定（恒为 adaptive）。',
    nodes: [
      { key: 'img', kind: 'image', params: { kind: 'image', ref: null }, offset: { x: 0, y: 0 } },
      { key: 'frame', kind: 'frameRole', params: { mode: 'first-last', referenceRole: 'reference_image' }, offset: { x: 0, y: 260 } },
      { key: 'prompt', kind: 'prompt', params: { text: '' }, offset: { x: 0, y: 480 } },
      {
        key: 'gen',
        kind: 'videoGen',
        params: {
          model: 'MiniMax-H3',
          resolution: '2K',
          duration: 5,
          ratio: 'adaptive',
          aigcWatermark: false,
          confirmBeforeRun: true,
        },
        offset: { x: 360, y: 200 },
      },
    ],
    edges: [
      { from: 'img', fromHandle: 'out', to: 'frame', toHandle: 'in' },
      { from: 'frame', fromHandle: 'out', to: 'gen', toHandle: 'frames' },
      { from: 'prompt', fromHandle: 'out', to: 'gen', toHandle: 'text' },
    ],
    builtin: true,
    version: 1,
  },
  {
    id: 'skill.i2va-first-last',
    name: '首尾帧转场',
    category: 'generation',
    description: '两张图分别作为首帧与尾帧，生成中间过渡。首尾帧成对出现。',
    nodes: [
      { key: 'first', kind: 'image', params: { kind: 'image', ref: null }, offset: { x: 0, y: 0 } },
      { key: 'last', kind: 'image', params: { kind: 'image', ref: null }, offset: { x: 0, y: 240 } },
      { key: 'frame', kind: 'frameRole', params: { mode: 'first-last', referenceRole: 'reference_image' }, offset: { x: 300, y: 100 } },
      { key: 'prompt', kind: 'prompt', params: { text: '' }, offset: { x: 0, y: 480 } },
      {
        key: 'gen',
        kind: 'videoGen',
        params: {
          model: 'MiniMax-H3',
          resolution: '2K',
          duration: 5,
          ratio: 'adaptive',
          aigcWatermark: false,
          confirmBeforeRun: true,
        },
        offset: { x: 640, y: 200 },
      },
    ],
    edges: [
      { from: 'first', fromHandle: 'out', to: 'frame', toHandle: 'in' },
      { from: 'last', fromHandle: 'out', to: 'frame', toHandle: 'in' },
      { from: 'frame', fromHandle: 'out', to: 'gen', toHandle: 'frames' },
      { from: 'prompt', fromHandle: 'out', to: 'gen', toHandle: 'text' },
    ],
    builtin: true,
    version: 1,
  },
  {
    id: 'skill.r2va-multimodal',
    name: '多模态参考 r2va',
    category: 'reference',
    description: '文本 + 参考图 / 参考视频 / 参考音频。注意：与首尾帧互斥，不可混用。',
    nodes: [
      { key: 'prompt', kind: 'prompt', params: { text: '' }, offset: { x: 0, y: 0 } },
      { key: 'refImg', kind: 'image', params: { kind: 'image', ref: null }, offset: { x: 0, y: 240 } },
      { key: 'refVid', kind: 'video', params: { kind: 'video', ref: null }, offset: { x: 0, y: 460 } },
      { key: 'refAud', kind: 'audio', params: { kind: 'audio', ref: null }, offset: { x: 0, y: 680 } },
      {
        key: 'gen',
        kind: 'videoGen',
        params: {
          model: 'MiniMax-H3',
          resolution: '2K',
          duration: 5,
          ratio: 'adaptive',
          aigcWatermark: false,
          confirmBeforeRun: true,
        },
        offset: { x: 380, y: 300 },
      },
    ],
    edges: [
      { from: 'prompt', fromHandle: 'out', to: 'gen', toHandle: 'text' },
      { from: 'refImg', fromHandle: 'out', to: 'gen', toHandle: 'frames' },
      { from: 'refVid', fromHandle: 'out', to: 'gen', toHandle: 'frames' },
      { from: 'refAud', fromHandle: 'out', to: 'gen', toHandle: 'frames' },
    ],
    builtin: true,
    version: 1,
  },
  {
    id: 'skill.context-ir-2k',
    name: 'Context-IR 扩写 → 2K 生成',
    category: 'pipeline',
    description:
      '先用 H3-Context-IR 把一句话扩写成结构化提示词，再送入 2K 生成。再生成时可直接复用最终 prompt。',
    nodes: [
      { key: 'prompt', kind: 'prompt', params: { text: '' }, offset: { x: 0, y: 0 } },
      { key: 'ir', kind: 'contextIR', params: { model: 'MiniMax-H3', duration: 5, ratio: '16:9' }, offset: { x: 340, y: 0 } },
      {
        key: 'gen',
        kind: 'videoGen',
        params: {
          model: 'MiniMax-H3',
          resolution: '2K',
          duration: 5,
          ratio: '16:9',
          aigcWatermark: false,
          confirmBeforeRun: true,
        },
        offset: { x: 700, y: 0 },
      },
    ],
    edges: [
      { from: 'prompt', fromHandle: 'out', to: 'ir', toHandle: 'text' },
      { from: 'ir', fromHandle: 'text', to: 'gen', toHandle: 'text' },
    ],
    builtin: true,
    version: 1,
  },
  {
    id: 'skill.regen-2k',
    name: '768P → 2K 再生成',
    category: 'pipeline',
    description:
      '把 768P 产物再生成为 2K（0.30 元/秒）。必须原样重放当时的全部输入，prompt 用最终版本。',
    nodes: [
      { key: 'prompt', kind: 'prompt', params: { text: '' }, offset: { x: 0, y: 0 } },
      { key: 'img', kind: 'image', params: { kind: 'image', ref: null }, offset: { x: 0, y: 240 } },
      { key: 'srcVid', kind: 'video', params: { kind: 'video', ref: null }, offset: { x: 0, y: 460 } },
      {
        key: 'regen',
        kind: 'regenerate',
        params: { mode: 'video', sourceTaskId: '', aigcWatermark: false },
        offset: { x: 400, y: 220 },
      },
    ],
    edges: [
      { from: 'prompt', fromHandle: 'out', to: 'regen', toHandle: 'text' },
      { from: 'img', fromHandle: 'out', to: 'regen', toHandle: 'frames' },
      { from: 'srcVid', fromHandle: 'out', to: 'regen', toHandle: 'video' },
    ],
    builtin: true,
    version: 1,
  },
  {
    id: 'skill.task-monitor',
    name: '任务监控',
    category: 'utility',
    description: '轮询指定任务并展示状态，支持取消 / 删除 / 产物转存。',
    nodes: [
      {
        key: 'status',
        kind: 'taskStatus',
        params: { taskId: '', followUpstream: true },
        offset: { x: 0, y: 0 },
      },
    ],
    edges: [],
    builtin: true,
    version: 1,
  },
];

export function skillById(id: string): SkillTemplate | undefined {
  return BUILTIN_SKILLS.find((s) => s.id === id);
}
