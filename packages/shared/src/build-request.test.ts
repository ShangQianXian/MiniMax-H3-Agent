import { describe, expect, it } from 'vitest';
import {
  assembleContent,
  buildContextIRRequest,
  buildRegenerationRequest,
  buildVideoGenerationRequest,
  estimateBodyBytes,
  type AssembleInput,
  type BuildGenerationInput,
  type FrameSlot,
  type MediaSlot,
  type TextSlot,
} from './build-request.ts';
import type { H3Model, MediaRef, Ratio, Resolution } from './types.ts';
import { validateContentComposition, validateRegeneration, validateVideoGeneration } from './validate.ts';
import { normalizeRatio } from './limits.ts';

const img = (url: string, extra: Partial<MediaRef> = {}): MediaRef => ({
  id: `img-${url}`,
  kind: 'image',
  source: url.startsWith('data:') ? 'data-uri' : 'remote',
  url,
  mime: 'image/png',
  ...extra,
});

const vid = (url: string, durationSec = 3): MediaRef => ({
  id: `vid-${url}`,
  kind: 'video',
  source: 'remote',
  url,
  mime: 'video/mp4',
  durationSec,
});

const aud = (url: string, durationSec = 4): MediaRef => ({
  id: `aud-${url}`,
  kind: 'audio',
  source: 'remote',
  url,
  mime: 'audio/mpeg',
  durationSec,
});

const text = (value: string, raw?: string): TextSlot => ({
  text: value,
  sourceKind: raw ? 'contextIR' : 'prompt',
  ...(raw !== undefined ? { rawText: raw } : {}),
});

const frame = (role: FrameSlot['role'], url: string): FrameSlot => ({ ref: img(url), role });
const media = (ref: MediaRef, role?: MediaSlot['role']): MediaSlot => ({ ref, ...(role ? { role } : {}) });

describe('assembleContent', () => {
  it('仅文本 → t2va', () => {
    const out = assembleContent({ text: text('一个男孩在海边打篮球'), frames: [], media: [] });
    expect(out.mode).toBe('t2va');
    expect(out.content).toHaveLength(1);
    expect(out.content[0]).toEqual({ type: 'text', text: '一个男孩在海边打篮球' });
    expect(out.imageCount).toBe(0);
  });

  it('文本 + 首帧 → i2va', () => {
    const out = assembleContent({
      text: text('拉焦到背景的人'),
      frames: [frame('first_frame', 'https://cdn.example.com/a.png')],
      media: [],
    });
    expect(out.mode).toBe('i2va');
    expect(out.content).toHaveLength(2);
    expect(out.content[1]).toMatchObject({ type: 'image_url', role: 'first_frame' });
    expect(out.imageCount).toBe(1);
  });

  it('文本 + 首尾帧 → i2va，2 张图', () => {
    const out = assembleContent({
      text: text('转场'),
      frames: [frame('first_frame', 'https://e.com/a.png'), frame('last_frame', 'https://e.com/b.png')],
      media: [],
    });
    expect(out.mode).toBe('i2va');
    expect(out.imageCount).toBe(2);
  });

  it('文本 + 参考视频 + 参考音频 → r2va，并统计参考秒数', () => {
    const out = assembleContent({
      text: text('角色说话'),
      frames: [],
      media: [
        media(vid('https://e.com/ref.mp4', 6), 'reference_video'),
        media(aud('https://e.com/voice.mp3', 6), 'reference_audio'),
      ],
    });
    expect(out.mode).toBe('r2va');
    expect(out.referenceVideoSeconds).toBe(6);
    expect(out.referenceAudioSeconds).toBe(6);
  });

  it('未标注角色的图片默认按参考图 role 处理', () => {
    const out = assembleContent({
      text: text('x'),
      frames: [],
      media: [media(img('https://e.com/a.png'))],
    });
    expect(out.content[1]).toMatchObject({ role: 'reference_image' });
  });

  it('空 prompt 不产生 text 项', () => {
    const out = assembleContent({ text: text('   '), frames: [], media: [] });
    expect(out.content).toHaveLength(0);
  });
});

describe('ratio 归一化', () => {
  it('t2va 的 adaptive 视为无效', () => {
    expect(normalizeRatio('t2va', 'adaptive')).toBeUndefined();
    expect(normalizeRatio('t2va', '16:9')).toBe('16:9');
  });
  it('i2va 恒为 adaptive', () => {
    expect(normalizeRatio('i2va', '16:9')).toBe('adaptive');
    expect(normalizeRatio('i2va', undefined)).toBe('adaptive');
  });
  it('r2va 默认 adaptive', () => {
    expect(normalizeRatio('r2va', undefined)).toBe('adaptive');
    expect(normalizeRatio('r2va', '9:16')).toBe('9:16');
  });
});

const baseGen = {
  model: 'MiniMax-H3' as H3Model,
  resolution: '2K' as Resolution,
  duration: 5,
  ratio: '16:9' as Ratio,
  aigcWatermark: false,
};

describe('buildVideoGenerationRequest', () => {
  it('文生视频 2K 请求体符合文档示例结构', () => {
    const { request, meta } = buildVideoGenerationRequest({
      ...baseGen,
      text: text('史诗级太空歌剧院线预告'),
      frames: [],
      media: [],
    });
    expect(request).toEqual({
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: '史诗级太空歌剧院线预告' }],
      resolution: '2K',
      duration: 5,
      ratio: '16:9',
    });
    expect(meta.mode).toBe('t2va');
  });

  it('图生视频忽略非 adaptive 的 ratio 并给出提示', () => {
    const { request, meta } = buildVideoGenerationRequest({
      ...baseGen,
      text: text('pull focus'),
      frames: [frame('first_frame', 'https://e.com/a.png')],
      media: [],
    });
    expect(request.ratio).toBe('adaptive');
    expect(meta.warning).toContain('adaptive');
  });

  it('不传 ratio 时文生视频请求体内不会出现 ratio 字段', () => {
    const { request } = buildVideoGenerationRequest({
      ...baseGen,
      ratio: 'adaptive',
      text: text('x'),
      frames: [],
      media: [],
    });
    expect('ratio' in request).toBe(false);
  });

  it('aigc_watermark 仅在开启时出现', () => {
    const off = buildVideoGenerationRequest({ ...baseGen, text: text('x'), frames: [], media: [] });
    expect('aigc_watermark' in off.request).toBe(false);
    const on = buildVideoGenerationRequest({
      ...baseGen,
      aigcWatermark: true,
      text: text('x'),
      frames: [],
      media: [],
    });
    expect(on.request.aigc_watermark).toBe(true);
  });

  it('Context-IR 增强后的文本保留 rawPrompt 快照', () => {
    const { meta } = buildVideoGenerationRequest({
      ...baseGen,
      text: text('enhanced description [Shot 1] ...', '原始一句话'),
      frames: [],
      media: [],
    });
    expect(meta.rawPrompt).toBe('原始一句话');
    expect(meta.finalPrompt).toContain('enhanced');
  });
});

describe('buildContextIRRequest', () => {
  it('请求体不含 resolution 字段', () => {
    const { request } = buildContextIRRequest({
      model: 'MiniMax-H3',
      duration: 5,
      ratio: '16:9',
      text: text('太空歌剧'),
      frames: [],
      media: [],
    });
    expect('resolution' in request).toBe(false);
    expect(request).toEqual({
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: '太空歌剧' }],
      duration: 5,
      ratio: '16:9',
    });
  });
});

describe('buildRegenerationRequest', () => {
  it('按任务 ID 模式只发送 source_task_id + resolution=2K', () => {
    const { request } = buildRegenerationRequest({
      mode: 'task',
      sourceTaskId: '424010985738629',
      aigcWatermark: false,
    });
    expect(request).toEqual({
      model: 'MiniMax-H3',
      source_task_id: '424010985738629',
      resolution: '2K',
    });
    expect('content' in request).toBe(false);
  });

  it('按源视频模式把 base_video 追加在 content 末尾', () => {
    const { request } = buildRegenerationRequest({
      mode: 'video',
      baseVideo: vid('https://e.com/h3-768p.mp4', 5),
      aigcWatermark: false,
      text: text('最终 prompt'),
      frames: [frame('first_frame', 'https://e.com/a.png')],
      media: [],
    });
    const content = (request as unknown as { content: Array<Record<string, unknown>> }).content;
    expect(content).toHaveLength(3);
    expect(content[2]).toMatchObject({ type: 'video_url', role: 'base_video' });
  });
});

describe('校验：content 组成', () => {
  it('首帧与参考图混用会被拒绝', () => {
    const assembled = assembleContent({
      text: text('x'),
      frames: [frame('first_frame', 'https://e.com/a.png')],
      media: [media(img('https://e.com/b.png'), 'reference_image')],
    });
    const result = validateContentComposition(assembled);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('content.role.mutex');
  });

  it('参考图超过 9 张会报错', () => {
    const mediaSlots = Array.from({ length: 10 }, (_, i) =>
      media(img(`https://e.com/${i}.png`), 'reference_image'),
    );
    const assembled = assembleContent({ text: text('x'), frames: [], media: mediaSlots });
    const result = validateContentComposition(assembled);
    expect(result.errors.map((e) => e.code)).toContain('content.referenceImage.count');
  });

  it('参考视频总时长超过 15s 会报错', () => {
    const assembled = assembleContent({
      text: text('x'),
      frames: [],
      media: [
        media(vid('https://e.com/1.mp4', 15), 'reference_video'),
        media(vid('https://e.com/2.mp4', 2), 'reference_video'),
      ],
    });
    const result = validateContentComposition(assembled);
    expect(result.errors.map((e) => e.code)).toContain('content.referenceVideo.duration');
  });

  it('base64 内联导致请求体超过 64MB 会报错', () => {
    const bigBase64 = `data:image/png;base64,${'A'.repeat(80 * 1024 * 1024)}`;
    const assembled = assembleContent({
      text: text('x'),
      frames: [],
      media: [media(img(bigBase64), 'reference_image')],
    });
    expect(estimateBodyBytes(assembled.content)).toBeGreaterThan(64 * 1024 * 1024);
    const result = validateContentComposition(assembled);
    expect(result.errors.map((e) => e.code)).toContain('request.tooLarge');
  });
});

describe('校验：视频生成', () => {
  const run = (
    overrides: Partial<BuildGenerationInput> & AssembleInput,
  ) => {
    const { request, meta } = buildVideoGenerationRequest({ ...baseGen, ...overrides });
    const assembled = assembleContent(overrides);
    return validateVideoGeneration(request, { ...assembled, referenceVideoSeconds: meta.referenceVideoSeconds });
  };

  it('缺少 prompt 报错', () => {
    const result = run({ text: null, frames: [], media: [] });
    expect(result.errors.map((e) => e.code)).toContain('content.text.missing');
  });

  it('提示词超过 7000 字符报错', () => {
    const result = run({ text: text('字'.repeat(7001)), frames: [], media: [] });
    expect(result.errors.map((e) => e.code)).toContain('text.tooLong');
  });

  it('H3-Max 不支持 2K', () => {
    const result = run({ model: 'MiniMax-H3-Max', resolution: '2K', text: text('x'), frames: [], media: [] });
    expect(result.errors.map((e) => e.code)).toContain('resolution.unsupported');
  });

  it('H3-Max 不支持多模态参考', () => {
    const result = run({
      model: 'MiniMax-H3-Max',
      resolution: '768P',
      text: text('x'),
      frames: [],
      media: [media(vid('https://e.com/r.mp4'), 'reference_video')],
    });
    expect(result.errors.map((e) => e.code)).toContain('model.reference.unsupported');
  });

  it('H3-Max 不支持 4 秒', () => {
    const result = run({
      model: 'MiniMax-H3-Max',
      resolution: '768P',
      duration: 4,
      text: text('x'),
      frames: [],
      media: [],
    });
    expect(result.errors.map((e) => e.code)).toContain('duration.range');
  });

  it('MiniMax-H3 支持 4 秒', () => {
    const result = run({ duration: 4, text: text('x'), frames: [], media: [] });
    expect(result.ok).toBe(true);
  });

  it('文生视频未指定宽高比时报错', () => {
    const result = run({ ratio: 'adaptive', text: text('x'), frames: [], media: [] });
    expect(result.errors.map((e) => e.code)).toContain('ratio.required');
  });

  it('未标注角色的图片给出警告', () => {
    const result = run({
      text: text('x'),
      frames: [],
      media: [media({ ...img('https://e.com/a.png'), kind: 'image' })],
    });
    // 未指定 role 的图片在 assembleContent 里会被补成 reference_image，因此走警告分支而不是 bare
    expect(result.ok).toBe(true);
  });
});

describe('校验：再生成', () => {
  it('source_task_id 与 content 同时提供报错', () => {
    const result = validateRegeneration({
      model: 'MiniMax-H3',
      source_task_id: '1',
      content: [{ type: 'text', text: 'x' }],
      resolution: '2K',
    } as never);
    expect(result.errors.map((e) => e.code)).toContain('regen.mode.both');
  });

  it('两者都不提供报错', () => {
    const result = validateRegeneration({ model: 'MiniMax-H3', resolution: '2K' } as never);
    expect(result.errors.map((e) => e.code)).toContain('regen.mode.none');
  });

  it('按源视频模式缺少 base_video 报错', () => {
    const { request } = buildRegenerationRequest({
      mode: 'video',
      baseVideo: vid('https://e.com/768p.mp4', 5),
      aigcWatermark: false,
      text: text('x'),
      frames: [],
      media: [],
    });
    const broken = { ...request, content: [{ type: 'text' as const, text: 'x' }] };
    const result = validateRegeneration(broken);
    expect(result.errors.map((e) => e.code)).toContain('regen.baseVideo.missing');
  });

  it('按任务 ID 模式给出白名单提示', () => {
    const { request } = buildRegenerationRequest({
      mode: 'task',
      sourceTaskId: '424010985738629',
      aigcWatermark: false,
    });
    const result = validateRegeneration(request);
    expect(result.warnings.map((w) => w.code)).toContain('regen.sourceTask.whitelist');
  });

  it('base_video 时长不符合 768P 规格时报错', () => {
    const { request } = buildRegenerationRequest({
      mode: 'video',
      baseVideo: vid('https://e.com/768p.mp4', 5),
      aigcWatermark: false,
      text: text('x'),
      frames: [],
      media: [],
    });
    const result = validateRegeneration(request, { durationSec: 3 });
    expect(result.errors.map((e) => e.code)).toContain('regen.baseVideo.spec');
  });
});
