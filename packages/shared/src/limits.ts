/**
 * 接口限制台账 —— 全部来自 docs/api/1.创建视频生成任务.md 与 5./6. 的「输入媒体限制」表。
 * 前端在发送前用它做校验，后端收到请求后用同一份常量做二次校验。
 */
import type { H3Model, Ratio, Resolution } from './types.ts';

/** 请求体总大小上限：64 MB（Base64 会放大约 33%）。 */
export const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
export const BASE64_OVERHEAD = 1.34;

export const TEXT_MAX_CHARS = 7000;
/** 视频再生成的 prompt 必须原样重放生成时送入模型的最终 prompt，上限更宽。 */
export const REGEN_TEXT_MAX_CHARS = 40000;

export interface ModelCapability {
  /** 支持的分辨率档位 */
  resolutions: Resolution[];
  defaultResolution: Resolution;
  /** 时长区间（闭区间，整数秒） */
  minDuration: number;
  maxDuration: number;
  /** 是否支持多模态参考（参考图 / 参考视频 / 参考音频） */
  supportsReference: boolean;
  /** 是否支持首帧 / 尾帧图生视频 */
  supportsFrames: boolean;
}

export const MODEL_CAPABILITIES: Record<H3Model, ModelCapability> = {
  'MiniMax-H3': {
    resolutions: ['768P', '2K'],
    defaultResolution: '768P',
    minDuration: 4,
    maxDuration: 15,
    supportsReference: true,
    supportsFrames: true,
  },
  'MiniMax-H3-Max': {
    resolutions: ['480P', '768P'],
    defaultResolution: '768P',
    minDuration: 5,
    maxDuration: 15,
    supportsReference: false,
    supportsFrames: true,
  },
};

export const MEDIA_LIMITS = {
  image: {
    formats: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    maxBytes: 30 * 1024 * 1024,
    minSide: 256,
    maxSide: 5760,
    minAspect: 0.4,
    maxAspect: 2.5,
    /** 数量上限（按 role 区分） */
    maxFirstFrame: 1,
    maxLastFrame: 1,
    maxReferenceImage: 9,
  },
  video: {
    formats: ['mp4', 'mov'],
    mimeTypes: ['video/mp4', 'video/quicktime'],
    maxBytes: 50 * 1024 * 1024,
    maxCount: 3,
    minDurationSec: 2,
    maxDurationSec: 15,
    /** 多段参考视频总时长上限 */
    maxTotalDurationSec: 15,
    minSide: 256,
    maxSide: 5760,
    minAspect: 0.4,
    maxAspect: 2.5,
    minFps: 23.976,
    maxFps: 60,
  },
  audio: {
    formats: ['wav', 'mp3'],
    mimeTypes: ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3'],
    maxBytes: 15 * 1024 * 1024,
    maxCount: 3,
    minDurationSec: 2,
    maxDurationSec: 15,
    maxTotalDurationSec: 15,
  },
} as const;

/**
 * 视频再生成的源视频（base_video）必须符合 MiniMax-H3 768P 输出规格。
 * 注意：本接口不支持任意视频的通用再生成。
 */
export const REGEN_BASE_VIDEO_SPEC = {
  requiresAudioTrack: true,
  fps: 24,
  /** 宽、高都必须能被 32 整除 */
  dimensionMultiple: 32,
  /** 面积（宽 × 高）区间 */
  minArea: 768 * 768,
  maxArea: 768 * 1344,
  minFrames: 107,
  maxFrames: 362,
  frameStep: 17,
} as const;

/** 任务查询窗口：仅支持查询最近 7 天内的任务。 */
export const QUERY_WINDOW_DAYS = 7;

/** 视频生成输入图片的免费张数（见 7.按量计费.md）。 */
export const IMAGE_FREE_COUNT = 5;

/** 任务列表分页默认值 */
export const DEFAULT_PAGE_SIZE = 20;

export function isResolutionAllowed(model: H3Model, resolution: Resolution): boolean {
  return MODEL_CAPABILITIES[model].resolutions.includes(resolution);
}

export function isDurationAllowed(model: H3Model, duration: number): boolean {
  const cap = MODEL_CAPABILITIES[model];
  return Number.isInteger(duration) && duration >= cap.minDuration && duration <= cap.maxDuration;
}

/**
 * 宽高比取整策略：
 * - 文生视频（content 仅 text）：必填，且不能为 adaptive
 * - 图生视频（含 first/last_frame）：恒按 adaptive 处理，其他值会被忽略
 * - 多模态参考生视频：可选，默认 adaptive
 */
export function normalizeRatio(
  mode: 't2va' | 'i2va' | 'r2va',
  ratio: Ratio | undefined,
): Ratio | undefined {
  if (mode === 'i2va') return 'adaptive';
  if (mode === 't2va') return ratio === 'adaptive' ? undefined : ratio;
  return ratio ?? 'adaptive';
}
