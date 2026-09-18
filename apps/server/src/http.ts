/**
 * 路由小工具：Express 5 的路径参数类型为 string | string[]，
 * 统一收敛成 string，避免每个 handler 里都写类型断言。
 */
import type { Request } from 'express';

export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function queryString(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return undefined;
}

export function queryNumber(req: Request, name: string, fallback: number): number {
  const raw = queryString(req, name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
