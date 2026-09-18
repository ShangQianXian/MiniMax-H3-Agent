/**
 * 设置路由：Base URL、API Key、并发数、Mock 开关。
 * 读接口永远只回显掩码，明文 Key 不会离开服务端。
 */
import { Router, type Request, type Response } from 'express';
import type { AppContext } from '../context.ts';
import { MinimaxClient } from '../services/minimax.ts';
import { maskApiKey } from '../services/store.ts';

export function createSettingsRouter(ctx: AppContext): Router {
  const router = Router();

  const snapshot = () => ({
    baseUrl: ctx.settings.get('base_url') ?? ctx.config.baseUrl,
    apiKeyMasked: maskApiKey(ctx.settings.get('api_key') ?? ctx.config.apiKey),
    hasApiKey: ctx.client.hasKey,
    apiKeyFromEnv: Boolean(ctx.config.apiKey) && !ctx.settings.get('api_key'),
    concurrency: Number.parseInt(ctx.settings.get('concurrency') ?? '2', 10),
    mock: ctx.settings.get('mock') === '1' ? true : ctx.client.mock,
    dataDir: ctx.config.dataDir,
    dbPath: ctx.config.dbPath,
  });

  router.get('/', (_req: Request, res: Response) => {
    res.json(snapshot());
  });

  router.put('/', (req: Request, res: Response) => {
    if (typeof req.body?.baseUrl === 'string' && req.body.baseUrl.trim()) {
      const url = req.body.baseUrl.trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(url)) {
        res.status(400).json({ error: 'Base URL 必须是 http(s) 地址。' });
        return;
      }
      ctx.settings.set('base_url', url);
    }

    // 传掩码或空串视为「不修改」
    if (typeof req.body?.apiKey === 'string') {
      const key = req.body.apiKey.trim();
      if (key.length > 0 && !key.includes('*')) ctx.settings.set('api_key', key);
      if (key.length === 0 && req.body?.clearApiKey === true) ctx.settings.delete('api_key');
    }

    if (typeof req.body?.concurrency === 'number') {
      const value = Math.min(Math.max(Math.round(req.body.concurrency), 1), 8);
      ctx.settings.set('concurrency', String(value));
    }

    if (typeof req.body?.mock === 'boolean') {
      ctx.settings.set('mock', req.body.mock ? '1' : '0');
    }

    res.json(snapshot());
  });

  /** 用最轻量的任务列表接口验证 Key 是否可用，不产生费用。 */
  router.post('/test', async (_req: Request, res: Response) => {
    const probe = new MinimaxClient({
      config: () => ({
        baseUrl: ctx.settings.get('base_url') ?? ctx.config.baseUrl,
        apiKey: ctx.settings.get('api_key') ?? ctx.config.apiKey,
        // 连通性测试必须打真实接口，否则测不出任何东西
        mock: false,
      }),
    });

    if (!probe.hasKey) {
      res.status(400).json({ ok: false, error: '尚未填写 API Key。' });
      return;
    }
    try {
      const result = await probe.ping();
      res.json({ ok: true, total: result.total, baseUrl: probe.baseUrl });
    } catch (error) {
      const detail = (error as { toJSON?: () => unknown }).toJSON?.() ?? { hint: (error as Error).message };
      res.status(200).json({ ok: false, error: detail });
    }
  });

  return router;
}
