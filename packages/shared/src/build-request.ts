/**
 * 请求体组装：把画布节点的槽位解析成官方接口要求的 content 数组。
 *
 * 组装规则（docs/api/1.创建视频生成任务.md）：
 * - 必须包含一个非空 text 项；
 * - image_url 通过 role 区分 first_frame / last_frame / reference_image；
 * - video_url / audio_url 只用于多模态参考场景；
 * - 出现任一 reference_* 就不能出现 first_frame / last_frame（反之亦然）。
 */
import { detectGenMode } from './node-params.ts';
import { normalizeRatio } from './limits.ts';
import type {
  ContentItem,
  ContentRole,
  ContextIRRequest,
  H3ContextModel,
  H3Model,
  MediaRef,
  Ratio,
  RegenerationByTaskRequest,
  RegenerationByVideoRequest,
  Resolution,
  VideoGenerationRequest,
} from './types.ts';

/** 一个「文本槽位」：内容可能是原始 prompt，也可能是 Context-IR 产出的增强提示词。 */
export interface TextSlot {
  /** 实际送入模型的文本 */
  text: string;
  /** 若经过 Context-IR 增强，这里是增强前的原始文本 */
  rawText?: string;
  sourceKind?: 'prompt' | 'contextIR';
  sourceNodeId?: string;
  /** 若来自成功任务，记录该任务 ID */
  taskId?: string;
}

export interface FrameSlot {
  ref: MediaRef;
  role: ContentRole;
  sourceNodeId?: string;
}

export interface MediaSlot {
  ref: MediaRef;
  /** 显式指定的 role；未指定时由上游节点类型推断 */
  role?: ContentRole;
  sourceNodeId?: string;
}

export interface AssembleInput {
  text: TextSlot | null;
  frames: FrameSlot[];
  media: MediaSlot[];
}

export interface AssembleResult {
  content: ContentItem[];
  mode: 't2va' | 'i2va' | 'r2va';
  /** 图片项总数（首帧 + 尾帧 + 参考图），用于计费与图片数量校验 */
  imageCount: number;
  /** 参考视频秒数合计 */
  referenceVideoSeconds: number;
  /** 参考音频秒数合计 */
  referenceAudioSeconds: number;
  warning?: string;
}

function roleForMedia(slot: MediaSlot): ContentRole | undefined {
  // 素材自带的显式角色优先
  if (slot.ref.explicitRole) return slot.ref.explicitRole;
  if (slot.role) return slot.role;
  switch (slot.ref.kind) {
    case 'video':
      return 'reference_video';
    case 'audio':
      return 'reference_audio';
    case 'image':
      // 未显式指定角色的图片按参考图处理（首帧必须由「帧角色」节点显式声明）
      return 'reference_image';
    default:
      return undefined;
  }
}

export function assembleContent(input: AssembleInput): AssembleResult {
  const content: ContentItem[] = [];

  if (input.text && input.text.text.trim().length > 0) {
    content.push({ type: 'text', text: input.text.text });
  }

  let imageCount = 0;
  let referenceVideoSeconds = 0;
  let referenceAudioSeconds = 0;

  // 帧槽位：first_frame / last_frame
  for (const frame of input.frames) {
    if (frame.ref.kind === 'image') {
      content.push({ type: 'image_url', image_url: { url: frame.ref.url }, role: frame.role });
      imageCount += 1;
    } else if (frame.ref.kind === 'video') {
      content.push({ type: 'video_url', video_url: { url: frame.ref.url }, role: frame.role });
      referenceVideoSeconds += frame.ref.durationSec ?? 0;
    } else {
      content.push({ type: 'audio_url', audio_url: { url: frame.ref.url }, role: frame.role });
      referenceAudioSeconds += frame.ref.durationSec ?? 0;
    }
  }

  // 通用素材槽位：按 kind + role 展开
  for (const slot of input.media) {
    const role = roleForMedia(slot);
    switch (slot.ref.kind) {
      case 'image':
        content.push({ type: 'image_url', image_url: { url: slot.ref.url }, ...(role ? { role } : {}) });
        imageCount += 1;
        break;
      case 'video':
        content.push({ type: 'video_url', video_url: { url: slot.ref.url }, ...(role ? { role } : {}) });
        referenceVideoSeconds += slot.ref.durationSec ?? 0;
        break;
      case 'audio':
        content.push({ type: 'audio_url', audio_url: { url: slot.ref.url }, ...(role ? { role } : {}) });
        referenceAudioSeconds += slot.ref.durationSec ?? 0;
        break;
    }
  }

  const roles = content.map((c) => c.role).filter((r): r is ContentRole => Boolean(r));
  const mediaKinds = input.media.map((m) => m.ref.kind);
  const mode = detectGenMode(roles, mediaKinds);

  return {
    content,
    mode,
    imageCount,
    referenceVideoSeconds,
    referenceAudioSeconds,
  };
}

/* ───────────────────────  视频生成  ─────────────────────── */

export interface BuildGenerationInput extends AssembleInput {
  model: H3Model;
  resolution: Resolution;
  duration: number;
  ratio: Ratio;
  aigcWatermark: boolean;
}

export interface BuildResult<T> {
  request: T;
  meta: {
    mode: 't2va' | 'i2va' | 'r2va';
    imageCount: number;
    referenceVideoSeconds: number;
    referenceAudioSeconds: number;
    /** 实际生效的 ratio（i2va 场景恒为 adaptive） */
    effectiveRatio?: Ratio;
    /** 原始 prompt（未经 Context-IR 增强） */
    rawPrompt?: string;
    /** 最终送入模型的 prompt */
    finalPrompt: string;
    warning?: string;
  };
}

export function buildVideoGenerationRequest(input: BuildGenerationInput): BuildResult<VideoGenerationRequest> {
  const assembled = assembleContent(input);
  const effectiveRatio = normalizeRatio(assembled.mode, input.ratio);

  const request: VideoGenerationRequest = {
    model: input.model,
    content: assembled.content,
    resolution: input.resolution,
    duration: input.duration,
    ...(effectiveRatio ? { ratio: effectiveRatio } : {}),
    ...(input.aigcWatermark ? { aigc_watermark: true } : {}),
  };

  const warnings: string[] = [];
  if (assembled.mode === 'i2va' && input.ratio !== 'adaptive') {
    warnings.push('图生视频的宽高比由输入图片决定，ratio 恒按 adaptive 处理，已忽略你的设置。');
  }
  if (assembled.mode === 't2va' && input.ratio === 'adaptive') {
    warnings.push('文生视频必须指定具体宽高比，adaptive 无效。');
  }

  return {
    request,
    meta: {
      mode: assembled.mode,
      imageCount: assembled.imageCount,
      referenceVideoSeconds: assembled.referenceVideoSeconds,
      referenceAudioSeconds: assembled.referenceAudioSeconds,
      effectiveRatio,
      ...(input.text?.rawText !== undefined ? { rawPrompt: input.text.rawText } : {}),
      finalPrompt: input.text?.text ?? '',
      ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
    },
  };
}

/* ───────────────────────  H3-Context-IR  ─────────────────────── */

export interface BuildContextIRInput extends AssembleInput {
  model: H3ContextModel;
  duration: number;
  ratio: Ratio;
}

export function buildContextIRRequest(input: BuildContextIRInput): BuildResult<ContextIRRequest> {
  const assembled = assembleContent(input);
  const effectiveRatio = normalizeRatio(assembled.mode, input.ratio);

  const request: ContextIRRequest = {
    model: input.model,
    content: assembled.content,
    duration: input.duration,
    ...(effectiveRatio ? { ratio: effectiveRatio } : {}),
  };

  return {
    request,
    meta: {
      mode: assembled.mode,
      imageCount: assembled.imageCount,
      referenceVideoSeconds: assembled.referenceVideoSeconds,
      referenceAudioSeconds: assembled.referenceAudioSeconds,
      effectiveRatio,
      ...(input.text?.rawText !== undefined ? { rawPrompt: input.text.rawText } : {}),
      finalPrompt: input.text?.text ?? '',
    },
  };
}

/* ───────────────────────  视频再生成  ─────────────────────── */

export interface BuildRegenerationInputByTask {
  mode: 'task';
  sourceTaskId: string;
  aigcWatermark: boolean;
}

export interface BuildRegenerationInputByVideo extends AssembleInput {
  mode: 'video';
  /** 源 768P 视频（role=base_video） */
  baseVideo: MediaRef;
  aigcWatermark: boolean;
}

export type BuildRegenerationInput = BuildRegenerationInputByTask | BuildRegenerationInputByVideo;

export function buildRegenerationRequest(
  input: BuildRegenerationInput,
): BuildResult<RegenerationByTaskRequest | RegenerationByVideoRequest> {
  if (input.mode === 'task') {
    const request: RegenerationByTaskRequest = {
      model: 'MiniMax-H3',
      source_task_id: input.sourceTaskId,
      resolution: '2K',
      ...(input.aigcWatermark ? { aigc_watermark: true } : {}),
    };
    return {
      request,
      meta: {
        mode: 't2va',
        imageCount: 0,
        referenceVideoSeconds: 0,
        referenceAudioSeconds: 0,
        finalPrompt: '',
      },
    };
  }

  const assembled = assembleContent(input);
  const content: ContentItem[] = [
    ...assembled.content,
    { type: 'video_url', video_url: { url: input.baseVideo.url }, role: 'base_video' },
  ];

  const request: RegenerationByVideoRequest = {
    model: 'MiniMax-H3',
    content,
    resolution: '2K',
    ...(input.aigcWatermark ? { aigc_watermark: true } : {}),
  };

  return {
    request,
    meta: {
      mode: assembled.mode === 't2va' ? 't2va' : assembled.mode,
      imageCount: assembled.imageCount,
      referenceVideoSeconds: assembled.referenceVideoSeconds,
      referenceAudioSeconds: assembled.referenceAudioSeconds,
      ...(input.text?.rawText !== undefined ? { rawPrompt: input.text.rawText } : {}),
      finalPrompt: input.text?.text ?? '',
      warning: '再生成必须原样重放生成 768P 源视频时的全部输入，且 prompt 要用当时送入模型的最终版本。',
    },
  };
}

/** 估算请求体字节数（含 Base64 膨胀），用于 64 MB 上限预判。 */
export function estimateBodyBytes(content: ContentItem[]): number {
  const json = JSON.stringify({ content });
  return new TextEncoder().encode(json).length;
}

export type { ContentItem, ContentRole, MediaRef };
