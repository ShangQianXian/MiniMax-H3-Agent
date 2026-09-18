/**
 * 生成方式（能力预设）与「有声视频」指令。
 *
 * 「生成方式」把官方三种场景（t2va / i2va / r2va）再细分一层，成为界面上可点的分段控件：
 *   全能参考 → r2va   （参考图 / 参考视频 / 参考音频）
 *   首尾帧   → i2va   （首帧 + 尾帧）
 *   首帧     → i2va   （仅首帧）
 *   文生视频 → t2va   （仅文本）
 *
 * 比例可用性完全由官方规则决定（docs/api/1.创建视频生成任务.md）：
 *   - 文生视频：ratio 必填且不能是 adaptive
 *   - 图生视频（首帧 / 尾帧 / 首尾帧）：宽高比由输入图片决定，ratio 恒为 adaptive，UI 只给「自适应」
 *   - 多模态参考：ratio 可选，默认 adaptive，也可显式指定任一具体比例
 */
import type { ContentRole, Ratio, Resolution } from './types.ts';

export const GEN_METHODS = ['全能参考', '首尾帧', '首帧', '文生视频'] as const;
export type GenMethodId = (typeof GEN_METHODS)[number];

/** 兼容早期叫法（旧工作流里可能存着「尾帧」） */
export const PRESET_IDS = [...GEN_METHODS, '尾帧'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export interface PresetOption {
  id: GenMethodId;
  label: string;
  description: string;
  /** 需要的图片角色（按顺序分配；只有一项时全部素材都用这个角色） */
  roles: ContentRole[];
  /** 该方式对应的官方场景 */
  mode: 't2va' | 'i2va' | 'r2va';
  /** 该方式下「比例」的可选项 —— 只给官方允许的值，不给用户造成误解 */
  ratioOptions: Ratio[];
  /** 该方式下比例是否被接口忽略（图生视频恒为 adaptive） */
  ratioLocked: boolean;
  /** 素材要求提示 */
  expectedImages: string;
  defaults: { ratio: Ratio; resolution: Resolution };
}

const ALL_RATIOS: Ratio[] = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
/** 图生视频：接口按输入图片决定，UI 只保留「自适应」 */
const ADAPTIVE_ONLY: Ratio[] = ['adaptive'];
/** 文生视频：不能是 adaptive，必须显式指定 */
const CONCRETE_ONLY: Ratio[] = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];

export const PRESETS: PresetOption[] = [
  {
    id: '全能参考',
    label: '全能参考',
    description: '多模态参考生视频（r2va）：参考图 + 参考视频 + 参考音频',
    roles: ['reference_image'],
    mode: 'r2va',
    ratioOptions: ALL_RATIOS,
    ratioLocked: false,
    expectedImages: '参考图 ≤9 张（可再加参考视频 ≤3 段、参考音频 ≤3 段）',
    defaults: { ratio: 'adaptive', resolution: '768P' },
  },
  {
    id: '首尾帧',
    label: '首尾帧',
    description: '图生视频（i2va）：第一张作首帧、最后一张作尾帧，生成中间过渡',
    roles: ['first_frame', 'last_frame'],
    mode: 'i2va',
    ratioOptions: ADAPTIVE_ONLY,
    ratioLocked: true,
    expectedImages: '首帧 + 尾帧共 2 张',
    defaults: { ratio: 'adaptive', resolution: '768P' },
  },
  {
    id: '首帧',
    label: '首帧',
    description: '图生视频（i2va）：一张图作为首帧',
    roles: ['first_frame'],
    mode: 'i2va',
    ratioOptions: ADAPTIVE_ONLY,
    ratioLocked: true,
    expectedImages: '首帧 1 张',
    defaults: { ratio: 'adaptive', resolution: '768P' },
  },
  {
    id: '文生视频',
    label: '文生视频',
    description: '纯文本生成（t2va）：必须显式指定具体宽高比',
    roles: [],
    mode: 't2va',
    ratioOptions: CONCRETE_ONLY,
    ratioLocked: false,
    expectedImages: '不需要图片',
    defaults: { ratio: '16:9', resolution: '768P' },
  },
];

export function presetById(id: string): PresetOption | undefined {
  // 早期版本用过「尾帧」，语义等价于只有一个素材的「首帧」，这里做一次兼容映射
  if (id === '尾帧') return PRESETS.find((p) => p.id === '首帧');
  return PRESETS.find((p) => p.id === id);
}

/**
 * 按素材张数展开角色序列：
 * - 单角色方式（首帧 / 参考图）：所有素材都用该角色
 * - 首尾帧：第一张首帧、最后一张尾帧，中间保持首帧
 */
export function rolesForCount(preset: Pick<PresetOption, 'roles'>, count: number): ContentRole[] {
  if (preset.roles.length === 0) return [];
  return Array.from({ length: count }, (_, index) => {
    if (preset.roles.length === 1) return preset.roles[0]!;
    if (index === 0) return preset.roles[0]!;
    if (index === count - 1) return preset.roles[1] ?? preset.roles[0]!;
    return preset.roles[0]!;
  });
}

/** 由生成方式与素材种类推断实际会走的场景（有视频/音频参考时一定是 r2va）。 */
export function modeFromPreset(
  presetId: string,
  mediaKinds: Array<'image' | 'video' | 'audio'>,
): 't2va' | 'i2va' | 'r2va' {
  if (mediaKinds.some((kind) => kind !== 'image')) return 'r2va';
  const preset = presetById(presetId);
  if (!preset) return mediaKinds.length > 0 ? 'r2va' : 't2va';
  if (preset.mode === 't2va' && mediaKinds.length > 0) return 'r2va';
  return preset.mode;
}

/** 比例的中文名与图标比例，用于可视化选择器 */
export const RATIO_META: Record<Ratio, { label: string; w: number; h: number }> = {
  adaptive: { label: '自适应', w: 18, h: 18 },
  '16:9': { label: '16:9', w: 24, h: 14 },
  '4:3': { label: '4:3', w: 21, h: 16 },
  '1:1': { label: '1:1', w: 18, h: 18 },
  '3:4': { label: '3:4', w: 16, h: 21 },
  '9:16': { label: '9:16', w: 13, h: 23 },
  '21:9': { label: '21:9', w: 26, h: 11 },
};

/**
 * 该生成方式下某个比例是否可选。
 * 图生视频只有「自适应」；文生视频不能选「自适应」。
 */
export function isRatioAllowed(presetId: string, ratio: Ratio): boolean {
  const preset = presetById(presetId);
  if (!preset) return true;
  return preset.ratioOptions.includes(ratio);
}

/** 切换到新生成方式时，把比例收敛到该方式允许的值。 */
export function coerceRatio(presetId: string, current: Ratio): Ratio {
  const preset = presetById(presetId);
  if (!preset) return current;
  if (preset.ratioOptions.includes(current)) return current;
  return preset.defaults.ratio;
}

/* ───────────────────────  有声视频  ─────────────────────── */

export type SoundMode = '有声' | '无声';

/**
 * 官方接口没有「是否配音」这个参数 —— 声音由提示词与参考音频决定。
 * 因此这里把这个开关落成一段**附加提示词**：语义明确、可预期，并且在界面上如实标注。
 */
export const SOUND_DIRECTIVES: Record<SoundMode, { label: string; promptSuffix: string; hint: string }> = {
  有声: {
    label: '有声',
    promptSuffix:
      '\n\nAudio: include full diegetic sound design — ambience, foley and character dialogue if present — mixed clearly with the music.',
    hint: '在提示词末尾追加「包含完整环境音、拟音与对白」的指令。声音由提示词与参考音频决定，接口没有独立的配音开关。',
  },
  无声: {
    label: '无声',
    promptSuffix: '\n\nAudio: no diegetic sound and no music — the video must be completely silent.',
    hint: '在提示词末尾追加「完全无声」的指令。声音由提示词决定，接口没有独立的配音开关。',
  },
};

/** 把声音指令拼到提示词末尾（幂等：先移除上一次追加的指令）。 */
export function applySoundDirective(text: string, mode: SoundMode): string {
  const suffixes = Object.values(SOUND_DIRECTIVES).map((d) => d.promptSuffix);
  let base = text;
  for (const suffix of suffixes) {
    if (base.endsWith(suffix)) base = base.slice(0, -suffix.length);
  }
  return `${base}${SOUND_DIRECTIVES[mode].promptSuffix}`;
}
