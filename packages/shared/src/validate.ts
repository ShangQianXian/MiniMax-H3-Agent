/**
 * 发送前校验：把 docs/api 里的全部限制变成可读的中文错误。
 * 前端运行时校验一次（拦住无效请求、不浪费额度），后端收到请求后再校验一次。
 */
import {
  IMAGE_FREE_COUNT,
  MAX_REQUEST_BYTES,
  MEDIA_LIMITS,
  MODEL_CAPABILITIES,
  REGEN_BASE_VIDEO_SPEC,
  REGEN_TEXT_MAX_CHARS,
  TEXT_MAX_CHARS,
  isDurationAllowed,
  isResolutionAllowed,
} from './limits.ts';
import { estimateBodyBytes, type AssembleInput, type AssembleResult } from './build-request.ts';
import type {
  ContentItem,
  ContentRole,
  MediaRef,
  Resolution,
  VideoGenerationRequest,
  RegenerationRequest,
} from './types.ts';

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  /** 机器可读标识，便于测试与 UI 分类 */
  code: string;
  /** 面向用户的中文说明 */
  message: string;
  nodeId?: string;
  field?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function emptyResult(): ValidationResult {
  return { ok: true, errors: [], warnings: [] };
}

export function finalize(issues: ValidationIssue[]): ValidationResult {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { ok: errors.length === 0, errors, warnings };
}

export function mergeResults(...results: ValidationResult[]): ValidationResult {
  return finalize(results.flatMap((r) => [...r.errors, ...r.warnings]));
}

function err(code: string, message: string, extra: Partial<ValidationIssue> = {}): ValidationIssue {
  return { severity: 'error', code, message, ...extra };
}

function warn(code: string, message: string, extra: Partial<ValidationIssue> = {}): ValidationIssue {
  return { severity: 'warning', code, message, ...extra };
}

/* ───────────────────────  素材校验  ─────────────────────── */

export function validateMediaRef(
  ref: MediaRef,
  options: { textChars?: number; nodeId?: string } = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { nodeId } = options;

  if (!ref.url || ref.url.trim().length === 0) {
    issues.push(err('media.empty', '素材地址为空，请上传文件或填写 URL。', { nodeId }));
    return finalize(issues);
  }

  const isHttp = /^https?:\/\//i.test(ref.url);
  const isMmFile = ref.url.startsWith('mm_file://');
  const isDataUri = /^data:(image|video|audio)\/[a-z0-9.+-]+;base64,/i.test(ref.url);

  if (!isHttp && !isMmFile && !isDataUri) {
    issues.push(
      err(
        'media.url.scheme',
        '地址只支持公网 URL、mm_file://{file_id} 或 data:<mime>;base64,<...> 三种形式。',
        { nodeId, field: 'url' },
      ),
    );
  }

  if (ref.kind === 'image') {
    const limit = MEDIA_LIMITS.image;
    if (ref.bytes !== undefined && ref.bytes > limit.maxBytes) {
      issues.push(
        err('media.image.size', `图片 ${formatBytes(ref.bytes)} 超过单张 ${formatBytes(limit.maxBytes)} 上限。`, {
          nodeId,
        }),
      );
    }
    if (ref.width !== undefined && (ref.width < limit.minSide || ref.width > limit.maxSide)) {
      issues.push(
        err('media.image.width', `图片宽度 ${ref.width}px 超出 [${limit.minSide}, ${limit.maxSide}] 范围。`, {
          nodeId,
        }),
      );
    }
    if (ref.height !== undefined && (ref.height < limit.minSide || ref.height > limit.maxSide)) {
      issues.push(
        err('media.image.height', `图片高度 ${ref.height}px 超出 [${limit.minSide}, ${limit.maxSide}] 范围。`, {
          nodeId,
        }),
      );
    }
    if (ref.width && ref.height) {
      const aspect = ref.width / ref.height;
      if (aspect < limit.minAspect || aspect > limit.maxAspect) {
        issues.push(
          err(
            'media.image.aspect',
            `图片宽高比 ${aspect.toFixed(2)} 超出 [${limit.minAspect}, ${limit.maxAspect}] 范围。`,
            { nodeId },
          ),
        );
      }
    }
  }

  if (ref.kind === 'video') {
    const limit = MEDIA_LIMITS.video;
    if (ref.bytes !== undefined && ref.bytes > limit.maxBytes) {
      issues.push(
        err('media.video.size', `视频 ${formatBytes(ref.bytes)} 超过单个 ${formatBytes(limit.maxBytes)} 上限。`, {
          nodeId,
        }),
      );
    }
    if (ref.durationSec !== undefined) {
      if (ref.durationSec < limit.minDurationSec || ref.durationSec > limit.maxDurationSec) {
        issues.push(
          err(
            'media.video.duration',
            `参考视频单段时长 ${ref.durationSec}s 超出 [${limit.minDurationSec}, ${limit.maxDurationSec}]s 范围。`,
            { nodeId },
          ),
        );
      }
    }
  }

  if (ref.kind === 'audio') {
    const limit = MEDIA_LIMITS.audio;
    if (ref.bytes !== undefined && ref.bytes > limit.maxBytes) {
      issues.push(
        err('media.audio.size', `音频 ${formatBytes(ref.bytes)} 超过单个 ${formatBytes(limit.maxBytes)} 上限。`, {
          nodeId,
        }),
      );
    }
    if (ref.durationSec !== undefined) {
      if (ref.durationSec < limit.minDurationSec || ref.durationSec > limit.maxDurationSec) {
        issues.push(
          err(
            'media.audio.duration',
            `参考音频单段时长 ${ref.durationSec}s 超出 [${limit.minDurationSec}, ${limit.maxDurationSec}]s 范围。`,
            { nodeId },
          ),
        );
      }
    }
  }

  if (options.textChars !== undefined && options.textChars > REGEN_TEXT_MAX_CHARS) {
    issues.push(
      err('text.tooLong', `提示词 ${options.textChars} 字符超过 ${REGEN_TEXT_MAX_CHARS} 上限。`, { nodeId }),
    );
  }

  return finalize(issues);
}

/* ───────────────────────  content 组成校验  ─────────────────────── */

/**
 * 校验 content 的组成规则（互斥、数量、总时长、总体积）。
 * 与具体接口无关，视频生成 / Context-IR / 再生成共用。
 */
export function validateContentComposition(
  assembled: AssembleResult,
  extra: { nodeId?: string; videoSecondsLimit?: number } = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { nodeId } = extra;

  const roles = assembled.content.map((c) => c.role).filter(Boolean) as ContentRole[];
  const hasFrameRole = roles.some((r) => r === 'first_frame' || r === 'last_frame');
  const refRoles = roles.filter(
    (r) => r === 'reference_image' || r === 'reference_video' || r === 'reference_audio',
  );

  if (hasFrameRole && refRoles.length > 0) {
    issues.push(
      err(
        'content.role.mutex',
        '图生视频与多模态参考生视频互斥：content 中出现参考图/参考视频/参考音频后，就不能再有首帧或尾帧。请拆成两个节点分别运行。',
        { nodeId },
      ),
    );
  }

  const firstFrames = roles.filter((r) => r === 'first_frame').length;
  const lastFrames = roles.filter((r) => r === 'last_frame').length;
  if (firstFrames > MEDIA_LIMITS.image.maxFirstFrame) {
    issues.push(err('content.firstFrame.count', `首帧最多 1 张，当前 ${firstFrames} 张。`, { nodeId }));
  }
  if (lastFrames > MEDIA_LIMITS.image.maxLastFrame) {
    issues.push(err('content.lastFrame.count', `尾帧最多 1 张，当前 ${lastFrames} 张。`, { nodeId }));
  }
  if (lastFrames > 0 && firstFrames === 0) {
    issues.push(
      warn('content.lastFrame.alone', '只提供了尾帧，接口会按「图生视频-尾帧」处理。', { nodeId }),
    );
  }

  const referenceImages = roles.filter((r) => r === 'reference_image').length;
  if (referenceImages > MEDIA_LIMITS.image.maxReferenceImage) {
    issues.push(
      err(
        'content.referenceImage.count',
        `参考图最多 ${MEDIA_LIMITS.image.maxReferenceImage} 张，当前 ${referenceImages} 张。`,
        { nodeId },
      ),
    );
  }

  const referenceVideos = assembled.content.filter(
    (c) => c.type === 'video_url' && c.role !== 'base_video',
  ).length;
  if (referenceVideos > MEDIA_LIMITS.video.maxCount) {
    issues.push(
      err('content.referenceVideo.count', `参考视频最多 ${MEDIA_LIMITS.video.maxCount} 个，当前 ${referenceVideos} 个。`, {
        nodeId,
      }),
    );
  }

  const referenceAudios = assembled.content.filter((c) => c.type === 'audio_url').length;
  if (referenceAudios > MEDIA_LIMITS.audio.maxCount) {
    issues.push(
      err('content.referenceAudio.count', `参考音频最多 ${MEDIA_LIMITS.audio.maxCount} 个，当前 ${referenceAudios} 个。`, {
        nodeId,
      }),
    );
  }

  const videoLimit = extra.videoSecondsLimit ?? MEDIA_LIMITS.video.maxTotalDurationSec;
  if (assembled.referenceVideoSeconds > videoLimit) {
    issues.push(
      err(
        'content.referenceVideo.duration',
        `参考视频总时长 ${assembled.referenceVideoSeconds}s 超过 ${videoLimit}s 上限。`,
        { nodeId },
      ),
    );
  }
  if (assembled.referenceAudioSeconds > MEDIA_LIMITS.audio.maxTotalDurationSec) {
    issues.push(
      err(
        'content.referenceAudio.duration',
        `参考音频总时长 ${assembled.referenceAudioSeconds}s 超过 ${MEDIA_LIMITS.audio.maxTotalDurationSec}s 上限。`,
        { nodeId },
      ),
    );
  }

  const bytes = estimateBodyBytes(assembled.content);
  if (bytes > MAX_REQUEST_BYTES) {
    issues.push(
      err(
        'request.tooLarge',
        `请求体约 ${formatBytes(bytes)}，超过 64 MB 上限。Base64 会放大约 33%，大素材请改用公网 URL 或先压缩。`,
        { nodeId },
      ),
    );
  }

  return finalize(issues);
}

/* ───────────────────────  视频生成校验  ─────────────────────── */

export function validateVideoGeneration(
  request: VideoGenerationRequest,
  meta: AssembleResult & { referenceVideoSeconds: number },
  options: { nodeId?: string } = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { nodeId } = options;
  const model = request.model;
  const cap = MODEL_CAPABILITIES[model];

  const textItem = request.content.find((c) => c.type === 'text');
  if (!textItem || !textItem.text || textItem.text.trim().length === 0) {
    issues.push(
      err('content.text.missing', '每次请求必须包含一个非空 text 项（prompt 必填）。请连接「提示词」节点并填写内容。', {
        nodeId,
        field: 'text',
      }),
    );
  } else if (textItem.text.length > TEXT_MAX_CHARS) {
    issues.push(
      err('text.tooLong', `提示词 ${textItem.text.length} 字符超过 ${TEXT_MAX_CHARS} 上限。`, {
        nodeId,
        field: 'text',
      }),
    );
  }

  if (!isDurationAllowed(model, request.duration)) {
    issues.push(
      err(
        'duration.range',
        `${model} 的时长必须为 ${cap.minDuration}~${cap.maxDuration} 之间的整数秒，当前 ${request.duration}s。`,
        { nodeId, field: 'duration' },
      ),
    );
  }

  if (!isResolutionAllowed(model, request.resolution)) {
    issues.push(
      err(
        'resolution.unsupported',
        `${model} 不支持 ${request.resolution}，可用档位：${cap.resolutions.join(' / ')}。`,
        { nodeId, field: 'resolution' },
      ),
    );
  }

  const hasReference = meta.content.some(
    (c) => c.role === 'reference_image' || c.role === 'reference_video' || c.role === 'reference_audio',
  );
  if (hasReference && !cap.supportsReference) {
    issues.push(
      err(
        'model.reference.unsupported',
        `${model} 是极速生成版本，不支持多模态参考（参考图/参考视频/参考音频）。请改用 MiniMax-H3，或去掉参考素材。`,
        { nodeId },
      ),
    );
  }

  if (meta.mode === 't2va') {
    if (!request.ratio) {
      issues.push(
        err('ratio.required', '文生视频必须显式指定宽高比，不能使用 adaptive。', {
          nodeId,
          field: 'ratio',
        }),
      );
    }
  }

  issues.push(...validateContentComposition(meta, { nodeId }).errors);

  if (options.nodeId) {
    // 单张图片未指定 role 时接口默认按 first_frame 处理，这里给出提示避免误用
    const bareImages = meta.content.filter((c) => c.type === 'image_url' && !c.role).length;
    if (bareImages > 0) {
      issues.push(
        warn(
          'content.image.bare',
          '存在未标注角色的图片，接口会默认按首帧（first_frame）处理。若想作为参考图，请把图片接到「帧角色」节点并选择参考图模式。',
          { nodeId },
        ),
      );
    }
  }

  return finalize(issues);
}

/* ───────────────────────  再生成校验  ─────────────────────── */

export function validateRegeneration(
  request: RegenerationRequest,
  options: { nodeId?: string; assembled?: AssembleResult; durationSec?: number } = {},
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { nodeId } = options;

  const hasTaskId = 'source_task_id' in request && Boolean(request.source_task_id);
  const hasContent = 'content' in request && Array.isArray(request.content) && request.content.length > 0;

  if (hasTaskId && hasContent) {
    issues.push(
      err('regen.mode.both', 'source_task_id 与 content 必须且只能提供其一，不能同时提供。', { nodeId }),
    );
  }
  if (!hasTaskId && !hasContent) {
    issues.push(
      err('regen.mode.none', '必须提供 source_task_id 或 content（含 base_video）其中之一。', { nodeId }),
    );
  }

  if ('content' in request) {
    const baseVideos = request.content.filter((c) => c.role === 'base_video');
    if (baseVideos.length === 0) {
      issues.push(
        err('regen.baseVideo.missing', '按源视频再生成时，content 中必须有且仅有一个 role=base_video 的视频项。', {
          nodeId,
        }),
      );
    } else if (baseVideos.length > 1) {
      issues.push(err('regen.baseVideo.multiple', `base_video 只能有 1 个，当前 ${baseVideos.length} 个。`, { nodeId }));
    }

    const textItem = request.content.find((c) => c.type === 'text');
    if (!textItem || !textItem.text || textItem.text.trim().length === 0) {
      issues.push(
        err(
          'regen.text.missing',
          '需原样重放生成 768P 源视频时的全部输入，包含当时实际送入模型的最终 prompt。',
          { nodeId, field: 'text' },
        ),
      );
    } else if (textItem.text.length > REGEN_TEXT_MAX_CHARS) {
      issues.push(
        err('text.tooLong', `提示词 ${textItem.text.length} 字符超过 ${REGEN_TEXT_MAX_CHARS} 上限。`, { nodeId }),
      );
    }

    if (baseVideos.length === 1 && options.durationSec !== undefined) {
      const spec = REGEN_BASE_VIDEO_SPEC;
      const durations = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      if (!durations.includes(options.durationSec)) {
        issues.push(
          err(
            'regen.baseVideo.spec',
            `源视频时长 ${options.durationSec}s 不符合 H3 768P 输出规格（总帧数 ${spec.minFrames}–${spec.maxFrames}，约 4–15 秒）。`,
            { nodeId },
          ),
        );
      }
    }

    if (options.assembled) {
      issues.push(...validateContentComposition(options.assembled, { nodeId }).errors);
    }
  }

  if (hasTaskId) {
    issues.push(
      warn(
        'regen.sourceTask.whitelist',
        '按任务 ID 再生成需要开通白名单，且源任务必须属于当前账号、状态为 succeeded、创建于 7 天内。',
        { nodeId },
      ),
    );
  }

  return finalize(issues);
}

/* ───────────────────────  工具  ─────────────────────── */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 图片张数超出免费额度时的提示，供费用卡片使用。 */
export function imageOverflowHint(imageCount: number): string | null {
  if (imageCount <= IMAGE_FREE_COUNT) return null;
  return `${imageCount} 张图片，前 ${IMAGE_FREE_COUNT} 张免费，超出 ${imageCount - IMAGE_FREE_COUNT} 张需计费。`;
}

export function summarizeIssues(result: ValidationResult): string {
  if (result.ok && result.warnings.length === 0) return '校验通过';
  const parts: string[] = [];
  if (result.errors.length > 0) parts.push(`${result.errors.length} 个错误`);
  if (result.warnings.length > 0) parts.push(`${result.warnings.length} 个提示`);
  return parts.join(' · ');
}

/** 给「帧角色」节点用：把素材按角色汇总成帧槽位所需的形状。 */
export function roleCountSummary(items: Array<{ role: ContentRole }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[item.role] = (out[item.role] ?? 0) + 1;
  return out;
}

/** 生成节点在发送前的 quick check：不依赖图谱，只看组装结果。 */
export function quickCheckContent(content: ContentItem[], resolution: Resolution): ValidationResult {
  const issues: ValidationIssue[] = [];
  const hasText = content.some((c) => c.type === 'text' && (c.text ?? '').trim().length > 0);
  if (!hasText) {
    issues.push(err('content.text.missing', '缺少非空 text 项。'));
  }
  if (resolution === '2K') {
    const images = content.filter((c) => c.type === 'image_url').length;
    if (images > MEDIA_LIMITS.image.maxReferenceImage + 2) {
      issues.push(warn('content.images.many', `输入图片 ${images} 张，超出 5 张免费额度后按 ¥0.20/张计费。`));
    }
  }
  return finalize(issues);
}

export type { AssembleInput };
