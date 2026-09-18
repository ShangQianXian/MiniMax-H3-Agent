/**
 * 把 zod 与自研校验结果统一成前端可直接展示的 issue 列表。
 */
import type { ZodError } from 'zod';
import type { ValidationIssue } from '@h3/shared';

export interface FriendlyIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  field?: string;
  nodeId?: string;
}

export function toFriendlyIssues(issues: ValidationIssue[]): FriendlyIssue[] {
  return issues.map((issue) => ({
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    ...(issue.field ? { field: issue.field } : {}),
    ...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
  }));
}

export function zodToIssues(error: ZodError): FriendlyIssue[] {
  return error.issues.map((issue) => ({
    severity: 'error' as const,
    code: `schema.${issue.code}`,
    message: `${issue.path.join('.') || '请求体'}：${issue.message}`,
    field: issue.path.join('.'),
  }));
}
