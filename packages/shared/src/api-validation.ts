/**
 * 服务端权威校验入口。
 *
 * 前端的校验负责即时反馈，这里才是真正的守门人：
 * 任何绕过前端直接打接口的请求，都要在这里被 schema + 模型能力 + content 组成三重拦下。
 */
import {
  MODEL_CAPABILITIES,
  TEXT_MAX_CHARS,
  isDurationAllowed,
  isResolutionAllowed,
} from './limits.ts';
import type { ValidationIssue } from './validate.ts';
import { zContextIRRequest, zRegenerationRequest, zVideoGenerationRequest } from './workflow-schema.ts';
import type { ZodError } from 'zod';

export type TaskTypeKey = 'generation' | 'h3_context_ir' | 'regeneration';

export interface RequestValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** 解析后的请求体（仅在校验通过时提供） */
  parsed?: unknown;
}

function fromZod(error: ZodError, nodeId?: string): ValidationIssue[] {
  return error.issues.map((issue) => ({
    severity: 'error' as const,
    code: `schema.${issue.code}`,
    message: `${issue.path.join('.') || '请求体'}：${issue.message}`,
    ...(nodeId ? { nodeId } : {}),
  }));
}

function issue(code: string, message: string, field?: string): ValidationIssue {
  return { severity: 'error', code, message, ...(field ? { field } : {}) };
}

/** 模型能力校验：这是最容易被遗漏、也最容易白花钱的一类错误。 */
export function validateModelCapability(request: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const model = String(request.model ?? '');

  if (model !== 'MiniMax-H3' && model !== 'MiniMax-H3-Max') {
    issues.push(issue('model.unknown', `不支持的模型 "${model}"，可用值：MiniMax-H3、MiniMax-H3-Max。`, 'model'));
    return issues;
  }

  const capability = MODEL_CAPABILITIES[model];
  const duration = typeof request.duration === 'number' ? request.duration : undefined;
  const resolution = typeof request.resolution === 'string' ? request.resolution : undefined;

  if (duration !== undefined && !isDurationAllowed(model, duration)) {
    issues.push(
      issue(
        'duration.range',
        `${model} 的时长必须为 ${capability.minDuration}~${capability.maxDuration} 之间的整数秒，当前 ${duration}s。`,
        'duration',
      ),
    );
  }

  if (
    resolution !== undefined &&
    (resolution === '480P' || resolution === '768P' || resolution === '2K') &&
    !isResolutionAllowed(model, resolution)
  ) {
    issues.push(
      issue(
        'resolution.unsupported',
        `${model} 不支持 ${resolution}，可用档位：${capability.resolutions.join(' / ')}。`,
        'resolution',
      ),
    );
  }

  // 多模态参考与 H3-Max 互斥
  const content = Array.isArray(request.content) ? (request.content as Array<{ role?: string }>) : [];
  const hasReference = content.some(
    (item) =>
      item.role === 'reference_image' || item.role === 'reference_video' || item.role === 'reference_audio',
  );
  if (hasReference && !capability.supportsReference) {
    issues.push(
      issue(
        'model.reference.unsupported',
        `${model} 是极速生成版本，不支持多模态参考（参考图 / 参考视频 / 参考音频）。请改用 MiniMax-H3，或去掉参考素材。`,
      ),
    );
  }

  // 时长占位：schema 已限制 4–15，这里只做模型差异补充
  return issues;
}

/** 文本长度与 prompt 必填。 */
export function validatePromptPresence(
  request: Record<string, unknown>,
  taskType: TaskTypeKey,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const content = Array.isArray(request.content) ? (request.content as Array<Record<string, unknown>>) : [];

  if (taskType === 'regeneration' && typeof request.source_task_id === 'string' && request.source_task_id) {
    // 按任务 ID 再生成不需要 content
    return issues;
  }

  const textItem = content.find((item) => item.type === 'text');
  const text = typeof textItem?.text === 'string' ? textItem.text : '';

  if (text.trim().length === 0) {
    issues.push(
      issue(
        'content.text.missing',
        '每次请求必须包含一个非空 text 项（prompt 必填）。',
        'content',
      ),
    );
    return issues;
  }

  const limit = taskType === 'regeneration' ? 40000 : TEXT_MAX_CHARS;
  if (text.length > limit) {
    issues.push(issue('text.tooLong', `提示词 ${text.length} 字符超过 ${limit} 上限。`, 'content'));
  }

  return issues;
}

/** 视频生成的场景相关规则：t2va 必须显式指定具体宽高比。 */
export function validateScenario(request: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const content = Array.isArray(request.content) ? (request.content as Array<Record<string, unknown>>) : [];
  const roles = content.map((item) => item.role).filter(Boolean) as string[];

  const hasFrame = roles.includes('first_frame') || roles.includes('last_frame');
  const hasReference = roles.some((r) => r.startsWith('reference_'));
  const ratio = typeof request.ratio === 'string' ? request.ratio : undefined;

  if (!hasFrame && !hasReference) {
    // 文生视频
    if (ratio === undefined || ratio === 'adaptive') {
      issues.push(issue('ratio.required', '文生视频必须显式指定宽高比，不能使用 adaptive。', 'ratio'));
    }
  }

  return issues;
}

/**
 * 完整的服务端校验。顺序很重要：
 * 1) schema 解析（结构 + 地址格式）
 * 2) prompt 必填与长度
 * 3) 模型能力（时长 / 分辨率 / 参考素材支持情况）
 * 4) 场景规则（ratio）
 * 5) 再生成的模式二选一与 base_video 唯一性
 */
export function validateApiRequest(
  taskType: TaskTypeKey,
  payload: unknown,
): RequestValidationResult {
  const schema =
    taskType === 'h3_context_ir'
      ? zContextIRRequest
      : taskType === 'regeneration'
        ? zRegenerationRequest
        : zVideoGenerationRequest;

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, issues: fromZod(parsed.error) };
  }

  const request = payload as Record<string, unknown>;
  const issues: ValidationIssue[] = [
    ...validatePromptPresence(request, taskType),
    ...validateModelCapability(request),
  ];

  if (taskType === 'generation') {
    issues.push(...validateScenario(request));
  }

  if (taskType === 'regeneration') {
    issues.push(...validateRegenerationMode(request));
  }

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    parsed: parsed.data,
  };
}

/**
 * 视频再生成：source_task_id 与 content 必须且只能提供其一；
 * 按源视频模式必须有且仅有一个 role=base_video 的视频项。
 */
export function validateRegenerationMode(request: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const sourceTaskId = typeof request.source_task_id === 'string' ? request.source_task_id.trim() : '';
  const content = Array.isArray(request.content) ? (request.content as Array<Record<string, unknown>>) : [];

  const hasTaskId = sourceTaskId.length > 0;
  const hasContent = content.length > 0;

  if (hasTaskId && hasContent) {
    issues.push(
      issue(
        'regen.mode.both',
        'source_task_id 与 content 必须且只能提供其一，不能同时提供。',
        'source_task_id',
      ),
    );
    return issues;
  }

  if (!hasTaskId && !hasContent) {
    issues.push(
      issue('regen.mode.none', '必须提供 source_task_id 或 content（含 base_video）其中之一。'),
    );
    return issues;
  }

  if (hasContent) {
    const baseVideos = content.filter((item) => item.role === 'base_video');
    if (baseVideos.length === 0) {
      issues.push(
        issue(
          'regen.baseVideo.missing',
          '按源视频再生成时，content 中必须有且仅有一个 role=base_video 的视频项。',
          'content',
        ),
      );
    } else if (baseVideos.length > 1) {
      issues.push(
        issue('regen.baseVideo.multiple', `base_video 只能有 1 个，当前 ${baseVideos.length} 个。`, 'content'),
      );
    }
  }

  return issues;
}
