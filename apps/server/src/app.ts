/**
 * Express 应用装配。
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { createH3Router } from './routes/h3.ts';
import { createAssetRouter } from './routes/assets.ts';
import { createProjectRouter, createWorkflowRouter } from './routes/projects.ts';
import { createQuoteRouter } from './routes/quote.ts';
import { createSettingsRouter } from './routes/settings.ts';
import { createSkillRouter } from './routes/skills.ts';
import type { AppContext } from './context.ts';

export function createApp(ctx: AppContext): Express {
  const app = express();

  // data URI 内联素材会让请求体非常大，这里必须显式放大 JSON 上限
  app.use(express.json({ limit: '64mb' }));
  app.disable('x-powered-by');

  app.use((req, _res, next) => {
    if (req.path !== '/api/health') {
      process.stdout.write(`[api] ${req.method} ${req.path}\n`);
    }
    next();
  });

  app.use('/api', createH3Router(ctx));
  app.use('/api/projects', createProjectRouter(ctx));
  app.use('/api/workflows', createWorkflowRouter(ctx));
  app.use('/api/skills', createSkillRouter(ctx));
  app.use('/api/assets', createAssetRouter(ctx));
  app.use('/api/settings', createSettingsRouter(ctx));
  app.use('/api/quote', createQuoteRouter(ctx));

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: '接口不存在。' });
  });

  // 兜底错误处理：任何未捕获异常都返回结构化 JSON，避免前端拿到 HTML
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    const status = (error as { status?: number }).status ?? 500;
    res.status(status).json({ error: error.message || '服务端内部错误。' });
  });

  return app;
}
