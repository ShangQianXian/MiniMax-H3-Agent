/**
 * Skill 路由：内置模板来自 @h3/shared，自定义 Skill 存在 SQLite。
 */
import { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { zSkillTemplate, type SkillTemplate } from '@h3/shared';
import type { AppContext } from '../context.ts';
import { param } from '../http.ts';

export function createSkillRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    res.json({ items: ctx.skills.list() });
  });

  router.post('/', (req: Request, res: Response) => {
    const parsed = zSkillTemplate.safeParse({
      ...req.body,
      id: typeof req.body?.id === 'string' && req.body.id ? req.body.id : `skill.${randomUUID()}`,
      builtin: false,
      version: 1,
    });
    if (!parsed.success) {
      res.status(400).json({
        error: 'Skill 定义不合法。',
        issues: parsed.error.issues.map((i: { code: string; path: PropertyKey[]; message: string }) => ({
          severity: 'error',
          code: `schema.${i.code}`,
          message: `${i.path.join('.') || 'skill'}：${i.message}`,
        })),
      });
      return;
    }
    const skill: SkillTemplate = { ...parsed.data, builtin: false };
    res.json({ skill: ctx.skills.upsert(skill) });
  });

  router.put('/:id', (req: Request, res: Response) => {
    const id = param(req, 'id');
    const existing = ctx.skills.get(id);
    if (!existing) {
      res.status(404).json({ error: 'Skill 不存在。' });
      return;
    }
    if (existing.builtin) {
      res.status(400).json({ error: '内置 Skill 不可编辑，请先复制为自定义 Skill。' });
      return;
    }
    const parsed = zSkillTemplate.safeParse({ ...req.body, id, builtin: false, version: existing.version + 1 });
    if (!parsed.success) {
      res.status(400).json({ error: 'Skill 定义不合法。' });
      return;
    }
    res.json({ skill: ctx.skills.upsert({ ...parsed.data, builtin: false }) });
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const result = ctx.skills.delete(param(req, 'id'));
    if (!result.deleted) {
      res.status(400).json({ error: result.reason ?? '删除失败。' });
      return;
    }
    res.json({ ok: true });
  });

  /** 复制（内置 Skill 想要改造时的推荐路径）。 */
  router.post('/:id/duplicate', (req: Request, res: Response) => {
    const source = ctx.skills.get(param(req, 'id'));
    if (!source) {
      res.status(404).json({ error: 'Skill 不存在。' });
      return;
    }
    const copy: SkillTemplate = {
      ...source,
      id: `skill.${randomUUID()}`,
      name: `${source.name} 副本`,
      builtin: false,
      version: 1,
    };
    res.json({ skill: ctx.skills.upsert(copy) });
  });

  return router;
}
