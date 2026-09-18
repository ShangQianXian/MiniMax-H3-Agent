/**
 * MiniMax 错误码 → 中文可读提示。
 * 内部错误码出现在 error.message 末尾的括号里，例如 "... (2013)"。
 */
import type { OaiErrorResponse } from './types.ts';

export const ERROR_CODE_HINTS: Record<string, string> = {
  '1000': '服务端内部错误，请稍后重试。',
  '1002': '触发限流，请降低频率后重试。',
  '1004': '鉴权失败：请检查 API Key 是否正确、是否已随请求发送。',
  '1008': '账户余额不足，请先充值。',
  '1026': '输入内容涉及敏感信息，被平台拦截。',
  '1027': '输入内容涉及敏感信息，被平台拦截。',
  '2013': '参数错误：content 必须包含一个非空 text 项（prompt 必填）。',
};

const HTTP_HINTS: Record<number, string> = {
  400: '请求参数错误，请检查提示词与素材是否满足接口限制。',
  401: '鉴权失败，请检查 API Key。',
  402: '账户余额或额度不足，请先充值。',
  403: '没有访问权限，部分能力（如按任务 ID 再生成）需要开通白名单。',
  404: '资源不存在。注意任务查询只覆盖最近 7 天。',
  422: '输入涉及敏感内容，被平台拦截。',
  429: '触发限流，请稍后再试。',
  500: '服务端错误，请稍后重试。',
  529: '服务过载，请稍后重试。',
};

export function extractInnerCode(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const match = /\((\d{3,6})\)\s*$/.exec(message.trim());
  return match?.[1];
}

export interface FriendlyError {
  httpCode: number;
  /** 原始错误类型，如 bad_request_error */
  type: string;
  /** 原始 message（保留英文原文便于排查） */
  message: string;
  /** 中文可读说明 */
  hint: string;
  /** 内部错误码 */
  innerCode?: string;
  requestId?: string;
}

export function explainApiError(status: number, body: unknown): FriendlyError {
  const parsed = body as Partial<OaiErrorResponse> | undefined;
  const detail = parsed?.error;
  const message = detail?.message ?? (typeof body === 'string' ? body : '未知错误');
  const innerCode = extractInnerCode(message);
  const type = detail?.type ?? 'unknown_error';

  const hint =
    (innerCode ? ERROR_CODE_HINTS[innerCode] : undefined) ??
    HTTP_HINTS[status] ??
    '接口返回了未预期的错误，请查看原始信息。';

  return {
    httpCode: status,
    type,
    message,
    hint,
    ...(innerCode ? { innerCode } : {}),
    ...(parsed?.request_id ? { requestId: parsed.request_id } : {}),
  };
}

/** 任务失败时 task.error 的中文提示。 */
export function explainTaskError(code: string | undefined, message: string | undefined): string {
  if (code && ERROR_CODE_HINTS[code]) return ERROR_CODE_HINTS[code]!;
  return message ?? '任务执行失败。';
}
