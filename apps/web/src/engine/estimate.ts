/**
 * 每个节点的费用预估。规则来自 docs/api/7.按量计费.md，与后端 /api/quote 使用同一份 @h3/shared 计价函数。
 */
import {
  estimateContextIRCost,
  estimateContextIRTokens,
  estimateVideoGenerationCost,
  estimateVideoRegenerationCost,
  MEDIA_LIMITS,
  type CostBreakdown,
  type H3Model,
  type Ratio,
  type Resolution,
} from '@h3/shared';
import type { CanvasNode } from '../store/graph.ts';
import type { ResolvedSlots } from '../engine/resolve.ts';

export interface NodeEstimate {
  kind: 'generation' | 'regeneration' | 'contextIR' | 'none';
  breakdown: CostBreakdown;
  /** Context-IR 的 token 为估算值 */
  estimated?: boolean;
  notice?: string;
  /** 无法预估时的原因 */
  blocked?: string;
}

const NONE: NodeEstimate = { kind: 'none', breakdown: { items: [], total: 0 } };

export function estimateNode(node: CanvasNode, slots: ResolvedSlots | null): NodeEstimate {
  if (node.data.disabled) return { ...NONE, blocked: '节点已禁用。' };
  if (!slots) return NONE;

  const params = node.data.params;

  if (node.data.kind === 'videoGen') {
    const model = (params.model === 'MiniMax-H3-Max' ? 'MiniMax-H3-Max' : 'MiniMax-H3') as H3Model;
    const resolution = (
      ['480P', '768P', '2K'].includes(String(params.resolution)) ? params.resolution : '768P'
    ) as Resolution;
    const duration = typeof params.duration === 'number' ? params.duration : 5;

    const imageCount =
      slots.frames.filter((f) => f.ref.kind === 'image').length +
      slots.media.filter((m) => m.ref.kind === 'image').length;
    const videoSeconds =
      slots.frames
        .filter((f) => f.ref.kind === 'video')
        .reduce((sum, f) => sum + (f.ref.durationSec ?? 0), 0) +
      slots.media
        .filter((m) => m.ref.kind === 'video')
        .reduce((sum, m) => sum + (m.ref.durationSec ?? 0), 0);

    const breakdown = estimateVideoGenerationCost({
      model,
      resolution,
      outputSeconds: duration,
      inputImageCount: imageCount,
      inputVideoSeconds: videoSeconds,
    });

    const overflow = Math.max(0, imageCount - MEDIA_LIMITS.image.maxReferenceImage);
    return {
      kind: 'generation',
      breakdown,
      ...(overflow >= 0 && imageCount > 5
        ? { notice: `${imageCount} 张输入图片，前 5 张免费。` }
        : {}),
    };
  }

  if (node.data.kind === 'regenerate') {
    const duration = slots.upstreamTaskId ? 0 : 5;
    // 再生成的输出秒数来自源视频，运行前只能按上游任务信息推断
    const outputSeconds = duration;
    const imageCount =
      slots.frames.filter((f) => f.ref.kind === 'image').length +
      slots.media.filter((m) => m.ref.kind === 'image').length;
    const videoSeconds =
      slots.media
        .filter((m) => m.ref.kind === 'video')
        .reduce((sum, m) => sum + (m.ref.durationSec ?? 0), 0) +
      slots.frames
        .filter((f) => f.ref.kind === 'video')
        .reduce((sum, f) => sum + (f.ref.durationSec ?? 0), 0);

    const breakdown = estimateVideoRegenerationCost({
      outputSeconds,
      inputImageCount: imageCount,
      inputVideoSeconds: videoSeconds,
    });

    return {
      kind: 'regeneration',
      breakdown,
      notice: '再生成按输出秒数计费（0.30 元/秒），原 768P 任务的输入素材需要重新计费。',
    };
  }

  if (node.data.kind === 'contextIR') {
    const textLength = slots.text?.text.length ?? 0;
    const tokens = estimateContextIRTokens(textLength);
    const breakdown = estimateContextIRCost(tokens);
    return {
      kind: 'contextIR',
      breakdown,
      estimated: true,
      notice: `按 ${textLength} 字符预估约 ${tokens.promptTokens} 输入 / ${tokens.completionTokens} 输出 tokens，实际以任务返回的 usage 为准。`,
    };
  }

  return NONE;
}

/** 整图费用：所有「会真实调用接口」的节点之和。 */
export function totalEstimate(estimates: Map<string, NodeEstimate>): number {
  let total = 0;
  for (const estimate of estimates.values()) {
    if (estimate.kind === 'none') continue;
    total += estimate.breakdown.total;
  }
  return Math.round(total * 10000) / 10000;
}

export function ratioLabel(ratio: Ratio | string): string {
  return ratio === 'adaptive' ? '自适应' : String(ratio);
}
