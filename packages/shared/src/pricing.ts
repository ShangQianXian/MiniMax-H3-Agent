/**
 * 按量计费价格表 —— 来源 docs/api/7.按量计费.md。
 * 单位：元。所有预估都基于此表，实际以平台账单为准。
 */
import type { H3Model, Resolution } from './types.ts';
import { IMAGE_FREE_COUNT } from './limits.ts';

export { IMAGE_FREE_COUNT };

/** 视频生成输出：元/秒 */
export const VIDEO_OUTPUT_PRICE: Record<H3Model, Partial<Record<Resolution, number>>> = {
  'MiniMax-H3': { '768P': 0.5, '2K': 0.8 },
  'MiniMax-H3-Max': { '480P': 0.33, '768P': 0.5 },
};

/** 视频生成输入参考视频：按输入视频时长计费，元/秒（按生成分辨率档位） */
export const VIDEO_INPUT_SECOND_PRICE: Partial<Record<Resolution, number>> = {
  '768P': 0.5,
  '2K': 0.8,
};

/** 视频生成输入图片：超出免费张数后的单价 */
export const IMAGE_OVERFLOW_PRICE = 0.2;

/** 视频再生成 */
export const REGEN_OUTPUT_PRICE_PER_SEC = 0.3;
export const REGEN_IMAGE_OVERFLOW_PRICE = 0.15;
export const REGEN_INPUT_VIDEO_PRICE_PER_SEC = 0.3;

/** H3-Context-IR：元/百万 tokens */
export const CONTEXT_IR_INPUT_PRICE_PER_MTOK = 5.8;
export const CONTEXT_IR_OUTPUT_PRICE_PER_MTOK = 23.0;

export interface VideoGenerationCostInput {
  model: H3Model;
  resolution: Resolution;
  /** 输出视频秒数 */
  outputSeconds: number;
  /** 输入图片总张数（first_frame + last_frame + reference_image 全部相加） */
  inputImageCount: number;
  /** 输入参考视频秒数 */
  inputVideoSeconds: number;
}

export interface VideoRegenerationCostInput {
  /** 再生成输出秒数 */
  outputSeconds: number;
  /** 原 768P 任务中的输入图片张数（需要重新计费） */
  inputImageCount: number;
  /** 原 768P 任务中的输入参考视频秒数（需要重新计费） */
  inputVideoSeconds: number;
}

export interface ContextIRCostInput {
  promptTokens: number;
  completionTokens: number;
}

export interface CostBreakdown {
  /** 分项明细，便于在费用卡片里逐条展示 */
  items: Array<{ label: string; amount: number; detail?: string }>;
  total: number;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 视频生成总费用。音频输入免费，不计入。 */
export function estimateVideoGenerationCost(input: VideoGenerationCostInput): CostBreakdown {
  const items: CostBreakdown['items'] = [];

  const outPrice = VIDEO_OUTPUT_PRICE[input.model][input.resolution] ?? 0;
  const outputAmount = outPrice * input.outputSeconds;
  items.push({
    label: '输出视频',
    amount: round4(outputAmount),
    detail: `${input.resolution} ${input.outputSeconds}s × ¥${outPrice}/s`,
  });

  if (input.inputVideoSeconds > 0) {
    const price = VIDEO_INPUT_SECOND_PRICE[input.resolution] ?? 0;
    items.push({
      label: '输入参考视频',
      amount: round4(price * input.inputVideoSeconds),
      detail: `${input.inputVideoSeconds}s × ¥${price}/s`,
    });
  }

  const overflowImages = Math.max(0, input.inputImageCount - IMAGE_FREE_COUNT);
  if (overflowImages > 0) {
    items.push({
      label: '输入图片超出免费额度',
      amount: round4(overflowImages * IMAGE_OVERFLOW_PRICE),
      detail: `${input.inputImageCount} 张，前 ${IMAGE_FREE_COUNT} 张免费，超出 ${overflowImages} 张 × ¥${IMAGE_OVERFLOW_PRICE}/张`,
    });
  } else if (input.inputImageCount > 0) {
    items.push({
      label: '输入图片',
      amount: 0,
      detail: `${input.inputImageCount} 张，在 ${IMAGE_FREE_COUNT} 张免费额度内`,
    });
  }

  return { items, total: round4(items.reduce((sum, i) => sum + i.amount, 0)) };
}

/** 视频再生成总费用。原 768P 任务的输入素材需要重新计费。 */
export function estimateVideoRegenerationCost(
  input: VideoRegenerationCostInput,
): CostBreakdown {
  const items: CostBreakdown['items'] = [];

  items.push({
    label: '再生成输出',
    amount: round4(REGEN_OUTPUT_PRICE_PER_SEC * input.outputSeconds),
    detail: `768P → 2K ${input.outputSeconds}s × ¥${REGEN_OUTPUT_PRICE_PER_SEC}/s`,
  });

  if (input.inputVideoSeconds > 0) {
    items.push({
      label: '原任务输入视频（重新计费）',
      amount: round4(REGEN_INPUT_VIDEO_PRICE_PER_SEC * input.inputVideoSeconds),
      detail: `${input.inputVideoSeconds}s × ¥${REGEN_INPUT_VIDEO_PRICE_PER_SEC}/s`,
    });
  }

  const overflowImages = Math.max(0, input.inputImageCount - IMAGE_FREE_COUNT);
  if (overflowImages > 0) {
    items.push({
      label: '原任务输入图片（重新计费）',
      amount: round4(overflowImages * REGEN_IMAGE_OVERFLOW_PRICE),
      detail: `超出 ${overflowImages} 张 × ¥${REGEN_IMAGE_OVERFLOW_PRICE}/张`,
    });
  }

  return { items, total: round4(items.reduce((sum, i) => sum + i.amount, 0)) };
}

/** H3-Context-IR 费用：输入 5.80 元/百万 tokens，输出 23.00 元/百万 tokens。 */
export function estimateContextIRCost(input: ContextIRCostInput): CostBreakdown {
  const items: CostBreakdown['items'] = [];

  if (input.promptTokens > 0) {
    items.push({
      label: '输入 tokens',
      amount: round4((input.promptTokens / 1_000_000) * CONTEXT_IR_INPUT_PRICE_PER_MTOK),
      detail: `${input.promptTokens} tokens × ¥${CONTEXT_IR_INPUT_PRICE_PER_MTOK}/M`,
    });
  }
  if (input.completionTokens > 0) {
    items.push({
      label: '输出 tokens',
      amount: round4((input.completionTokens / 1_000_000) * CONTEXT_IR_OUTPUT_PRICE_PER_MTOK),
      detail: `${input.completionTokens} tokens × ¥${CONTEXT_IR_OUTPUT_PRICE_PER_MTOK}/M`,
    });
  }

  return { items, total: round4(items.reduce((sum, i) => sum + i.amount, 0)) };
}

/**
 * Context-IR 在任务创建前无法得知 token 数。用字符数做保守预估：
 * 官方口径 1600 中文字符 ≈ 1000 tokens（即 0.625 token/字符），输出约为输入的 60%。
 * 仅用于「预估」展示，实际以任务返回的 usage 为准。
 */
export const CHARS_PER_TOKEN_ESTIMATE = 1.6;
export const CONTEXT_IR_OUTPUT_RATIO_ESTIMATE = 0.6;

export function estimateContextIRTokens(inputChars: number): {
  promptTokens: number;
  completionTokens: number;
} {
  const promptTokens = Math.round(inputChars / CHARS_PER_TOKEN_ESTIMATE);
  return {
    promptTokens,
    completionTokens: Math.round(promptTokens * CONTEXT_IR_OUTPUT_RATIO_ESTIMATE),
  };
}

/** 用任务返回的真实 usage 计算实际花费。 */
export function actualVideoCost(
  resolution: Resolution,
  usage: { output_seconds?: number; input_seconds?: number; input_image_count?: number } | undefined,
): CostBreakdown | null {
  if (!usage || usage.output_seconds === undefined) return null;
  const model: H3Model = 'MiniMax-H3';
  if (!(resolution in VIDEO_OUTPUT_PRICE[model])) {
    // H3-Max 档位
    const alt = VIDEO_OUTPUT_PRICE['MiniMax-H3-Max'][resolution];
    if (alt === undefined) return null;
    return estimateVideoGenerationCost({
      model: 'MiniMax-H3-Max',
      resolution,
      outputSeconds: usage.output_seconds,
      inputImageCount: usage.input_image_count ?? 0,
      inputVideoSeconds: usage.input_seconds ?? 0,
    });
  }
  return estimateVideoGenerationCost({
    model,
    resolution,
    outputSeconds: usage.output_seconds,
    inputImageCount: usage.input_image_count ?? 0,
    inputVideoSeconds: usage.input_seconds ?? 0,
  });
}

export function formatCny(amount: number): string {
  if (amount === 0) return '¥0';
  if (amount < 0.01) return `¥${amount.toFixed(4)}`;
  return `¥${amount.toFixed(2)}`;
}
