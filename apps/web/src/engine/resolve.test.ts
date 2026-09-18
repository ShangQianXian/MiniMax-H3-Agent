/**
 * 画布槽位解析测试：验证「节点图 → 接口 content」这一步在各种接线方式下都正确。
 */
import { describe, expect, it } from 'vitest';
import { assembleContent, defaultParamsFor, type PortKind } from '@h3/shared';
import { resolveNodeSlots, mediaRefFromParams } from './resolve.ts';
import type { CanvasNode } from '../store/graph.ts';

type Edge = { id: string; source: string; sourceHandle: string; target: string; targetHandle: string };

function node(id: string, kind: CanvasNode['data']['kind'], params: Record<string, unknown> = {}): CanvasNode {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: { kind, label: kind, params: { ...defaultParamsFor(kind), ...params } },
  };
}

function edge(source: string, sourceHandle: string, target: string, targetHandle: string): Edge {
  return { id: `${source}-${target}`, source, sourceHandle, target, targetHandle };
}

describe('mediaRefFromParams', () => {
  it('识别 data URI / mm_file / 公网 URL 三种来源', () => {
    expect(mediaRefFromParams({ kind: 'image', url: 'data:image/png;base64,AAA' })?.source).toBe('data-uri');
    expect(mediaRefFromParams({ kind: 'video', url: 'mm_file://abc' })?.source).toBe('mm-file');
    expect(mediaRefFromParams({ kind: 'image', url: 'https://e.com/a.png' })?.source).toBe('remote');
  });

  it('没有 url 时返回 null', () => {
    expect(mediaRefFromParams({ kind: 'image', url: '' })).toBeNull();
    expect(mediaRefFromParams({})).toBeNull();
  });

  it('携带尺寸、时长、字节数等元数据', () => {
    const ref = mediaRefFromParams({
      kind: 'video',
      url: 'https://e.com/a.mp4',
      bytes: 1234,
      width: 1280,
      height: 720,
      durationSec: 5.5,
      assetId: 'asset-1',
      name: 'a.mp4',
    });
    expect(ref).toMatchObject({
      kind: 'video',
      bytes: 1234,
      width: 1280,
      height: 720,
      durationSec: 5.5,
      assetId: 'asset-1',
      originalName: 'a.mp4',
    });
  });
});

describe('resolveNodeSlots', () => {
  it('提示词 → 视频生成：文本正确传递并解析为 t2va', () => {
    const nodes = [
      node('p1', 'prompt', { text: '海边打篮球' }),
      node('g1', 'videoGen', { ratio: '16:9' }),
    ];
    const edges = [edge('p1', 'out', 'g1', 'text')];

    const slots = resolveNodeSlots('g1', nodes, edges);
    expect(slots.text?.text).toBe('海边打篮球');
    expect(slots.text?.sourceKind).toBe('prompt');
    expect(slots.media).toHaveLength(0);
    expect(slots.frames).toHaveLength(0);
    expect(slots.upstreamNodeIds).toEqual(['p1']);

    const assembled = assembleContent(slots);
    expect(assembled.mode).toBe('t2va');
  });

  it('图片 → 帧角色（首尾帧）：第一张为首帧、最后一张为尾帧', () => {
    const nodes = [
      node('i1', 'image', { url: 'https://e.com/1.png' }),
      node('i2', 'image', { url: 'https://e.com/2.png' }),
      node('i3', 'image', { url: 'https://e.com/3.png' }),
      node('f1', 'frameRole', { mode: 'first-last' }),
      node('g1', 'videoGen'),
    ];
    const edges = [
      edge('i1', 'out', 'f1', 'in'),
      edge('i2', 'out', 'f1', 'in'),
      edge('i3', 'out', 'f1', 'in'),
      edge('f1', 'out', 'g1', 'frames'),
    ];

    const slots = resolveNodeSlots('g1', nodes, edges);
    expect(slots.frames).toHaveLength(2);
    expect(slots.frames[0]!.role).toBe('first_frame');
    expect(slots.frames[0]!.ref.url).toBe('https://e.com/1.png');
    expect(slots.frames[1]!.role).toBe('last_frame');
    expect(slots.frames[1]!.ref.url).toBe('https://e.com/3.png');
    // 中间的图被忽略，必须给出提示
    expect(slots.warnings.some((w) => w.includes('中间'))).toBe(true);

    const assembled = assembleContent(slots);
    expect(assembled.mode).toBe('i2va');
    expect(assembled.imageCount).toBe(2);
  });

  it('单张图片接帧角色 → 作为首帧', () => {
    const nodes = [
      node('i1', 'image', { url: 'https://e.com/a.png' }),
      node('f1', 'frameRole', { mode: 'first-last' }),
      node('g1', 'videoGen'),
    ];
    const edges = [edge('i1', 'out', 'f1', 'in'), edge('f1', 'out', 'g1', 'frames')];
    const slots = resolveNodeSlots('g1', nodes, edges);
    expect(slots.frames).toHaveLength(1);
    expect(slots.frames[0]!.role).toBe('first_frame');
  });

  it('帧角色切到参考图模式 → role=reference_image，判定为 r2va', () => {
    const nodes = [
      node('i1', 'image', { url: 'https://e.com/a.png' }),
      node('i2', 'image', { url: 'https://e.com/b.png' }),
      node('f1', 'frameRole', { mode: 'reference', referenceRole: 'reference_image' }),
      node('g1', 'videoGen'),
    ];
    const edges = [
      edge('i1', 'out', 'f1', 'in'),
      edge('i2', 'out', 'f1', 'in'),
      edge('f1', 'out', 'g1', 'frames'),
    ];
    const slots = resolveNodeSlots('g1', nodes, edges);
    expect(slots.frames.every((f) => f.role === 'reference_image')).toBe(true);
    expect(assembleContent(slots).mode).toBe('r2va');
  });

  it('帧角色在参考图模式下透传视频 / 音频作为多模态参考', () => {
    const nodes = [
      node('i1', 'image', { url: 'https://e.com/a.png' }),
      node('v1', 'video', { url: 'https://e.com/v.mp4', durationSec: 4 }),
      node('f1', 'frameRole', { mode: 'reference', referenceRole: 'reference_image' }),
      node('g1', 'videoGen'),
    ];
    const edges = [
      edge('i1', 'out', 'f1', 'in'),
      edge('v1', 'out', 'f1', 'in'),
      edge('f1', 'out', 'g1', 'frames'),
    ];
    const slots = resolveNodeSlots('g1', nodes, edges);
    expect(slots.frames).toHaveLength(1);
    expect(slots.frames[0]!.role).toBe('reference_image');
    expect(slots.media).toHaveLength(1);
    expect(slots.media[0]!.role).toBe('reference_video');
  });

  it('帧角色在首尾帧模式下忽略视频并给出提示', () => {
    const nodes = [
      node('i1', 'image', { url: 'https://e.com/a.png' }),
      node('v1', 'video', { url: 'https://e.com/v.mp4' }),
      node('f1', 'frameRole', { mode: 'first-last' }),
      node('g1', 'videoGen'),
    ];
    const edges = [
      edge('i1', 'out', 'f1', 'in'),
      edge('v1', 'out', 'f1', 'in'),
      edge('f1', 'out', 'g1', 'frames'),
    ];
    const slots = resolveNodeSlots('g1', nodes, edges);
    expect(slots.frames).toHaveLength(1);
    expect(slots.media).toHaveLength(0);
    expect(slots.warnings.some((w) => w.includes('只接受图片'))).toBe(true);
  });

  it('参考视频与音频直连生成节点 → 计入参考秒数', () => {
    const nodes = [
      node('p1', 'prompt', { text: '角色说话' }),
      node('v1', 'video', { url: 'https://e.com/ref.mp4', durationSec: 6 }),
      node('a1', 'audio', { url: 'https://e.com/voice.mp3', durationSec: 6 }),
      node('g1', 'videoGen'),
    ];
    const edges = [
      edge('p1', 'out', 'g1', 'text'),
      edge('v1', 'out', 'g1', 'frames'),
      edge('a1', 'out', 'g1', 'frames'),
    ];
    const slots = resolveNodeSlots('g1', nodes, edges);
    const assembled = assembleContent(slots);
    expect(assembled.mode).toBe('r2va');
    expect(assembled.referenceVideoSeconds).toBe(6);
    expect(assembled.referenceAudioSeconds).toBe(6);
  });

  it('素材节点缺 URL 时给出可读提示', () => {
    const nodes = [node('i1', 'image', {}), node('g1', 'videoGen')];
    const edges = [edge('i1', 'out', 'g1', 'frames')];
    const slots = resolveNodeSlots('g1', nodes, edges);
    expect(slots.media).toHaveLength(0);
    expect(slots.warnings.some((w) => w.includes('还没有素材'))).toBe(true);
  });

  it('禁用的上游节点不参与解析', () => {
    const disabled = node('i1', 'image', { url: 'https://e.com/a.png' });
    disabled.data.disabled = true;
    const nodes = [disabled, node('g1', 'videoGen')];
    const edges = [edge('i1', 'out', 'g1', 'frames')];
    const slots = resolveNodeSlots('g1', nodes, edges);
    expect(slots.media).toHaveLength(0);
  });

  it('上游 Context-IR 成功后，下游拿到增强提示词并保留原始 prompt', () => {
    const ir = node('c1', 'contextIR', { rawText: '原始一句话' });
    ir.data.runtime = {
      status: 'succeeded',
      taskId: 't-1',
      outputText: 'integrated_multimodal_description: ...',
    };
    const nodes = [ir, node('g1', 'videoGen')];
    const edges = [edge('c1', 'text', 'g1', 'text')];

    const slots = resolveNodeSlots('g1', nodes, edges);
    expect(slots.text?.text).toContain('integrated_multimodal_description');
    expect(slots.text?.rawText).toBe('原始一句话');
    expect(slots.text?.sourceKind).toBe('contextIR');
    expect(slots.text?.taskId).toBe('t-1');
  });

  it('上游生成成功后，视频产物可作为再生成的源视频', () => {
    const gen = node('g1', 'videoGen');
    gen.data.runtime = {
      status: 'succeeded',
      taskId: 't-2',
      outputUrl: 'https://e.com/h3-768p.mp4',
    };
    const nodes = [gen, node('r1', 'regenerate')];
    const edges = [edge('g1', 'video', 'r1', 'video')];

    const slots = resolveNodeSlots('r1', nodes, edges);
    expect(slots.upstreamVideoUrl).toBe('https://e.com/h3-768p.mp4');
    expect(slots.upstreamTaskId).toBe('t-2');
    expect(slots.upstreamTaskStatus).toBe('succeeded');
    expect(slots.media).toHaveLength(1);
    expect(slots.media[0]!.ref.kind).toBe('video');
  });

  it('多个提示词上游时以最后一个为准并告警', () => {
    const nodes = [
      node('p1', 'prompt', { text: '第一个' }),
      node('p2', 'prompt', { text: '第二个' }),
      node('g1', 'videoGen'),
    ];
    const edges = [edge('p1', 'out', 'g1', 'text'), edge('p2', 'out', 'g1', 'text')];
    const slots = resolveNodeSlots('g1', nodes, edges);
    expect(slots.text?.text).toBe('第二个');
    expect(slots.warnings.some((w) => w.includes('多个提示词上游'))).toBe(true);
  });

  it('没有上游时返回空槽位且不报错', () => {
    const nodes = [node('g1', 'videoGen')];
    const slots = resolveNodeSlots('g1', nodes, []);
    expect(slots.text).toBeNull();
    expect(slots.frames).toHaveLength(0);
    expect(slots.media).toHaveLength(0);
    expect(slots.upstreamNodeIds).toHaveLength(0);
  });
});

describe('端口兼容矩阵', () => {
  it('any 口接受任何输出，视频可以喂给素材输入', async () => {
    const { isPortCompatible } = await import('@h3/shared');
    expect(isPortCompatible('text' as PortKind, 'any' as PortKind)).toBe(true);
    expect(isPortCompatible('video' as PortKind, 'media' as PortKind)).toBe(true);
    expect(isPortCompatible('text' as PortKind, 'media' as PortKind)).toBe(false);
  });
});
