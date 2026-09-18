/**
 * 费用预估路由。
 *
 * 为什么放在服务端也算一遍：前端已经算过一次用于即时反馈，
 * 服务端再算一次可以保证「执行前确认金额」与真实计费口径一致，且便于后续接账单对账。
 */
import { Router, type Request, type Response } from 'express';
import {
  estimateContextIRCost,
  estimateContextIRTokens,
  estimateVideoGenerationCost,
  estimateVideoRegenerationCost,
  MEDIA_LIMITS,
} from '@h3/shared';
import type { AppContext } from '../context.ts';

export function createQuoteRouter(_ctx: AppContext): Router {
  const router = Router();

  router.post('/', (req: Request, res: Response) => {
    const kind = String(req.body?.kind ?? '');
    const input = (req.body?.input ?? {}) as Record<string, number | string>;

    const num = (key: string, fallback = 0): number => {
      const value = input[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    };

    if (kind === 'generation') {
      const model = input.model === 'MiniMax-H3-Max' ? 'MiniMax-H3-Max' : 'MiniMax-H3';
      const resolutionRaw = String(input.resolution ?? '768P');
      const resolution = (
        ['480P', '768P', '2K'].includes(resolutionRaw) ? resolutionRaw : '768P'
      ) as '480P' | '768P' | '2K';
      const breakdown = estimateVideoGenerationCost({
        model,
        resolution,
        outputSeconds: num('outputSeconds', 5),
        inputImageCount: num('inputImageCount'),
        inputVideoSeconds: num('inputVideoSeconds'),
      });
      res.json({ kind, breakdown });
      return;
    }

    if (kind === 'regeneration') {
      const breakdown = estimateVideoRegenerationCost({
        outputSeconds: num('outputSeconds', 5),
        inputImageCount: num('inputImageCount'),
        inputVideoSeconds: num('inputVideoSeconds'),
      });
      res.json({ kind, breakdown });
      return;
    }

    if (kind === 'contextIR') {
      const hasTokens = typeof input.promptTokens === 'number' && input.promptTokens > 0;
      const estimate = hasTokens
        ? {
            promptTokens: num('promptTokens'),
            completionTokens: num('completionTokens'),
          }
        : estimateContextIRTokens(num('inputChars'));
      const breakdown = estimateContextIRCost(estimate);
      res.json({
        kind,
        breakdown,
        estimated: !hasTokens,
        tokens: estimate,
        notice: hasTokens ? undefined : '任务创建前无法得知真实 token 数，此处按字符数保守预估，实际以任务返回的 usage 为准。',
      });
      return;
    }

    res.status(400).json({ error: 'kind 必须是 generation / regeneration / contextIR 之一。' });
  });

  /** 免费额度与限制说明，供费用卡片展示。 */
  router.get('/rules', (_req: Request, res: Response) => {
    res.json({
      imageFreeCount: 5,
      imageOverflowPrice: 0.2,
      regenImageOverflowPrice: 0.15,
      videoInputPrice: { '768P': 0.5, '2K': 0.8 },
      regenOutputPrice: 0.3,
      regenInputVideoPrice: 0.3,
      outputPrice: {
        'MiniMax-H3': { '768P': 0.5, '2K': 0.8 },
        'MiniMax-H3-Max': { '480P': 0.33, '768P': 0.5 },
      },
      contextIR: { input: 5.8, output: 23 },
      mediaLimits: MEDIA_LIMITS,
      note: '价格为刊例价，单位为元；音频输入免费。',
    });
  });

  return router;
}
