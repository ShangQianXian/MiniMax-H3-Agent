import { describe, expect, it } from 'vitest';
import {
  IMAGE_FREE_COUNT,
  actualVideoCost,
  estimateContextIRCost,
  estimateContextIRTokens,
  estimateVideoGenerationCost,
  estimateVideoRegenerationCost,
  formatCny,
} from './pricing.ts';

describe('视频生成费用', () => {
  it('H3 · 768P · 5s = 2.50 元', () => {
    const cost = estimateVideoGenerationCost({
      model: 'MiniMax-H3',
      resolution: '768P',
      outputSeconds: 5,
      inputImageCount: 0,
      inputVideoSeconds: 0,
    });
    expect(cost.total).toBe(2.5);
  });

  it('H3 · 2K · 5s = 4.00 元', () => {
    const cost = estimateVideoGenerationCost({
      model: 'MiniMax-H3',
      resolution: '2K',
      outputSeconds: 5,
      inputImageCount: 0,
      inputVideoSeconds: 0,
    });
    expect(cost.total).toBe(4);
  });

  it('H3-Max · 480P · 10s = 3.30 元', () => {
    const cost = estimateVideoGenerationCost({
      model: 'MiniMax-H3-Max',
      resolution: '480P',
      outputSeconds: 10,
      inputImageCount: 0,
      inputVideoSeconds: 0,
    });
    expect(cost.total).toBeCloseTo(3.3, 4);
  });

  it('图片 5 张以内免费', () => {
    const cost = estimateVideoGenerationCost({
      model: 'MiniMax-H3',
      resolution: '768P',
      outputSeconds: 5,
      inputImageCount: IMAGE_FREE_COUNT,
      inputVideoSeconds: 0,
    });
    expect(cost.total).toBe(2.5);
    expect(cost.items.some((i) => i.amount === 0 && i.label === '输入图片')).toBe(true);
  });

  it('超出 5 张的图片按 0.20 元/张计费', () => {
    const cost = estimateVideoGenerationCost({
      model: 'MiniMax-H3',
      resolution: '768P',
      outputSeconds: 5,
      inputImageCount: 8,
      inputVideoSeconds: 0,
    });
    // 2.5 + 3 × 0.2
    expect(cost.total).toBeCloseTo(3.1, 4);
  });

  it('参考视频按输入秒数 × 生成分辨率档位单价', () => {
    const cost = estimateVideoGenerationCost({
      model: 'MiniMax-H3',
      resolution: '2K',
      outputSeconds: 5,
      inputImageCount: 0,
      inputVideoSeconds: 6,
    });
    // 4.0 + 6 × 0.8
    expect(cost.total).toBeCloseTo(8.8, 4);
  });

  it('音频输入免费（不产生任何计费项）', () => {
    const cost = estimateVideoGenerationCost({
      model: 'MiniMax-H3',
      resolution: '768P',
      outputSeconds: 5,
      inputImageCount: 0,
      inputVideoSeconds: 0,
    });
    expect(cost.items.some((i) => i.label.includes('音频'))).toBe(false);
  });

  it('2K 十秒太空歌剧场景：4.0 + 4.8 = 8.8', () => {
    const cost = estimateVideoGenerationCost({
      model: 'MiniMax-H3',
      resolution: '2K',
      outputSeconds: 10,
      inputImageCount: 1,
      inputVideoSeconds: 6,
    });
    expect(cost.total).toBeCloseTo(8.8 + 4, 4);
  });
});

describe('视频再生成费用', () => {
  it('5s 再生成 = 1.50 元', () => {
    const cost = estimateVideoRegenerationCost({
      outputSeconds: 5,
      inputImageCount: 0,
      inputVideoSeconds: 0,
    });
    expect(cost.total).toBeCloseTo(1.5, 4);
  });

  it('原任务输入素材需要重新计费', () => {
    const cost = estimateVideoRegenerationCost({
      outputSeconds: 5,
      inputImageCount: 7,
      inputVideoSeconds: 3,
    });
    // 1.5 + 2×0.15 + 3×0.30 = 1.5 + 0.3 + 0.9
    expect(cost.total).toBeCloseTo(2.7, 4);
  });
});

describe('Context-IR 费用', () => {
  it('按 token 单价计算', () => {
    const cost = estimateContextIRCost({ promptTokens: 5664, completionTokens: 3426 });
    // 5664/1e6×5.8 = 0.0329（4 位小数）+ 3426/1e6×23 = 0.0788 → 0.1117
    expect(cost.total).toBeCloseTo(0.1117, 4);
  });

  it('token 预估：1600 字符 ≈ 1000 输入 tokens', () => {
    const est = estimateContextIRTokens(1600);
    expect(est.promptTokens).toBe(1000);
    expect(est.completionTokens).toBe(600);
  });
});

describe('实际用量折算', () => {
  it('用 usage 还原 2K 5s 的实际费用', () => {
    const cost = actualVideoCost('2K', {
      output_seconds: 5,
      input_seconds: 0,
      input_image_count: 1,
    });
    expect(cost?.total).toBe(4);
  });

  it('缺少 output_seconds 时返回 null', () => {
    expect(actualVideoCost('2K', {})).toBeNull();
    expect(actualVideoCost('2K', undefined)).toBeNull();
  });
});

describe('格式化', () => {
  it('整数与小数', () => {
    expect(formatCny(0)).toBe('¥0');
    expect(formatCny(2.5)).toBe('¥2.50');
    expect(formatCny(0.0033)).toBe('¥0.0033');
  });
});
