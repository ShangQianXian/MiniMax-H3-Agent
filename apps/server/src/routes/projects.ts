/**
 * 项目与工作流路由。
 */
import { Router, type Request, type Response } from 'express';
import { zWorkflowGraph } from '@h3/shared';
import type { AppContext } from '../context.ts';
import { param, queryString } from '../http.ts';

export function createProjectRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const projects = ctx.projects.list();
    const withCounts = projects.map((project) => ({
      ...project,
      workflowCount: ctx.workflows.list(project.id).length,
      taskCount: ctx.tasks.list({ projectId: project.id, pageSize: 1 }).total,
    }));
    res.json({ items: withCounts });
  });

  router.post('/', (req: Request, res: Response) => {
    const name = String(req.body?.name ?? '').trim();
    if (name.length === 0) {
      res.status(400).json({ error: '项目名称不能为空。' });
      return;
    }
    const project = ctx.projects.create({
      name,
      description: String(req.body?.description ?? ''),
    });
    const workflow = ctx.workflows.create({ projectId: project.id, name: '未命名工作流' });
    res.json({ project, workflow });
  });

  router.patch('/:id', (req: Request, res: Response) => {
    const updated = ctx.projects.update(param(req, 'id'), {
      ...(typeof req.body?.name === 'string' ? { name: req.body.name } : {}),
      ...(typeof req.body?.description === 'string' ? { description: req.body.description } : {}),
      ...(typeof req.body?.cover === 'string' ? { cover: req.body.cover } : {}),
    });
    if (!updated) {
      res.status(404).json({ error: '项目不存在。' });
      return;
    }
    res.json({ project: updated });
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const id = param(req, 'id');
    if (!ctx.projects.get(id)) {
      res.status(404).json({ error: '项目不存在。' });
      return;
    }
    ctx.projects.delete(id);
    res.json({ ok: true });
  });

  return router;
}

export function createWorkflowRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    const projectId = queryString(req, 'projectId');
    res.json({ items: ctx.workflows.list(projectId) });
  });

  router.get('/:id', (req: Request, res: Response) => {
    const workflow = ctx.workflows.get(param(req, 'id'));
    if (!workflow) {
      res.status(404).json({ error: '工作流不存在。' });
      return;
    }
    res.json({ workflow, runs: ctx.runs.listByWorkflow(workflow.id) });
  });

  router.post('/', (req: Request, res: Response) => {
    const projectId = String(req.body?.projectId ?? '');
    if (!ctx.projects.get(projectId)) {
      res.status(400).json({ error: '项目不存在，无法创建工作流。' });
      return;
    }
    const workflow = ctx.workflows.create({
      projectId,
      name: String(req.body?.name ?? '未命名工作流'),
    });
    res.json({ workflow });
  });

  /** 保存画布。前端 800ms 防抖后调用，因此这里必须是幂等覆盖写入。 */
  router.put('/:id', (req: Request, res: Response) => {
    const id = param(req, 'id');
    const parsed = zWorkflowGraph.safeParse(req.body?.graph);
    if (!parsed.success) {
      res.status(400).json({
        error: '画布数据格式不正确。',
        issues: parsed.error.issues.map((i: { code: string; path: PropertyKey[]; message: string }) => ({
          severity: 'error',
          code: `schema.${i.code}`,
          message: `${i.path.join('.') || 'graph'}：${i.message}`,
        })),
      });
      return;
    }
    const saved = ctx.workflows.saveGraph(
      id,
      parsed.data,
      typeof req.body?.name === 'string' ? req.body.name : undefined,
    );
    if (!saved) {
      res.status(404).json({ error: '工作流不存在。' });
      return;
    }
    res.json({ workflow: saved });
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const id = param(req, 'id');
    if (!ctx.workflows.get(id)) {
      res.status(404).json({ error: '工作流不存在。' });
      return;
    }
    ctx.workflows.delete(id);
    res.json({ ok: true });
  });

  /** 导入：把外部 JSON 直接建成新的工作流。 */
  router.post('/import', (req: Request, res: Response) => {
    const projectId = String(req.body?.projectId ?? '');
    if (!ctx.projects.get(projectId)) {
      res.status(400).json({ error: '项目不存在。' });
      return;
    }
    const parsed = zWorkflowGraph.safeParse(req.body?.graph);
    if (!parsed.success) {
      res.status(400).json({ error: '导入的画布 JSON 格式不正确。' });
      return;
    }
    const workflow = ctx.workflows.create({
      projectId,
      name: String(req.body?.name ?? '导入的工作流'),
      graph: parsed.data,
    });
    res.json({ workflow });
  });

  return router;
}
