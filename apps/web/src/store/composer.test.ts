/**
 * 创作台测试：草稿 → 画布落地规划、预设语义、场景判定。
 *
 * 这一层是「参考图里的底部大输入面板」的核心逻辑，必须可预测：
 * 用户在创作台填的素材和文字，点发送后应该变成一张语义正确、连线正确的节点图。
 */
import { describe, expect, it } from 'vitest';
import {
  PRESETS,
  defaultParamsFor,
  modeFromPreset,
  presetById,
  rolesForCount,
} from '@h3/shared';
import {
  composerMode,
  makeComposerMedia,
  planMaterialize,
  materializeToCanvas,
  type ComposerMedia,
} from './composer.ts';
import { useGraph } from './graph.ts';
import { resolveNodeSlots } from '../engine/resolve.ts';

const image = (name: string): ComposerMedia =>
  makeComposerMedia({ kind: 'image', url: `data:image/png;base64,AAAA-${name}`, name, bytes: 1024 });
const video = (name: string, durationSec = 6): ComposerMedia =>
  makeComposerMedia({ kind: 'video', url: `https://e.com/${name}.mp4`, name, durationSec });
const audio = (name: string, durationSec = 5): ComposerMedia =>
  makeComposerMedia({ kind: 'audio', url: `https://e.com/${name}.mp3`, name, durationSec });

const baseDraft = {
  text: '一个男孩在海边打篮球',
  media: [] as ComposerMedia[],
  presetId: '文生视频',
  model: 'MiniMax-H3' as const,
  resolution: '2K' as const,
  duration: 8,
  ratio: '16:9' as const,
  aigcWatermark: false,
  sound: '有声' as const,
};

describe('落地后的素材语义', () => {
  it('将临时素材角色映射到真实节点 ID，单张参考图不会误变成首帧', () => {
    useGraph.setState({ nodes: [], edges: [], past: [], future: [] });
    const id = materializeToCanvas(planMaterialize({ draft: { ...baseDraft, presetId: '全能参考', media: [image('a')] }, targetNodeId: null, anchor: { x: 0, y: 0 } }));
    const graph = useGraph.getState();
    expect(resolveNodeSlots(id, graph.nodes, graph.edges).media[0]?.ref.explicitRole).toBe('reference_image');
  });
  it('单段参考视频不会被写入图片角色', () => {
    useGraph.setState({ nodes: [], edges: [], past: [], future: [] });
    const id = materializeToCanvas(planMaterialize({ draft: { ...baseDraft, presetId: '全能参考', media: [video('a')] }, targetNodeId: null, anchor: { x: 0, y: 0 } }));
    const graph = useGraph.getState();
    const slot = resolveNodeSlots(id, graph.nodes, graph.edges).media[0];
    expect(slot?.role).toBe('reference_video');
    expect(slot?.ref.explicitRole).toBeUndefined();
  });
});

describe('生成方式定义', () => {
  it('四个生成方式都有合法角色与场景', () => {
    expect(PRESETS).toHaveLength(4);
    expect(PRESETS.map((p) => p.id)).toEqual(['全能参考', '首尾帧', '首帧', '文生视频']);
    expect(presetById('首帧')?.roles).toEqual(['first_frame']);
    expect(presetById('首尾帧')?.roles).toEqual(['first_frame', 'last_frame']);
    expect(presetById('全能参考')?.mode).toBe('r2va');
    expect(presetById('文生视频')?.mode).toBe('t2va');
  });

  it('单角色预设把所有素材都标成同一角色', () => {
    expect(rolesForCount({ roles: ['reference_image'] }, 4)).toEqual([
      'reference_image',
      'reference_image',
      'reference_image',
      'reference_image',
    ]);
  });

  it('首尾帧预设把第一张与最后一张分开', () => {
    expect(rolesForCount({ roles: ['first_frame', 'last_frame'] }, 3)).toEqual([
      'first_frame',
      'first_frame',
      'last_frame',
    ]);
    expect(rolesForCount({ roles: ['first_frame', 'last_frame'] }, 2)).toEqual([
      'first_frame',
      'last_frame',
    ]);
  });

  it('文生视频预设不需要角色', () => {
    expect(rolesForCount({ roles: [] }, 3)).toEqual([]);
  });
});

describe('场景判定', () => {
  it('纯文本 + 文生视频 = t2va', () => {
    expect(composerMode('文生视频', [])).toBe('t2va');
    expect(modeFromPreset('文生视频', [])).toBe('t2va');
  });

  it('带图 + 首帧预设 = i2va', () => {
    expect(composerMode('首帧', [image('a')])).toBe('i2va');
  });

  it('全能参考 = r2va', () => {
    expect(composerMode('全能参考', [image('a')])).toBe('r2va');
  });

  it('出现视频/音频素材时一定是 r2va，即使预设是文生视频', () => {
    expect(composerMode('文生视频', [video('ref')])).toBe('r2va');
    expect(composerMode('首帧', [image('a'), audio('v')])).toBe('r2va');
  });
});

describe('planMaterialize：草稿 → 画布', () => {
  it('文生视频 + 新建节点：只产生 1 个生成节点与 1 个提示词节点', () => {
    const plan = planMaterialize({
      draft: { ...baseDraft },
      targetNodeId: null,
      anchor: { x: 80, y: 80 },
    });

    expect(plan.targetIsNew).toBe(true);
    const kinds = plan.nodes.map((n) => n.node.data.kind).sort();
    expect(kinds).toEqual(['prompt', 'videoGen']);
    expect(plan.edges).toHaveLength(1);
    expect(plan.edges[0]!.targetHandle).toBe('text');

    const gen = plan.nodes.find((n) => n.node.data.kind === 'videoGen')!.node;
    expect(gen.data.params.model).toBe('MiniMax-H3');
    expect(gen.data.params.resolution).toBe('2K');
    expect(gen.data.params.ratio).toBe('16:9');
  });

  it('单张图 + 首帧：直接连到 frames 并标记 explicitRole', () => {
    const plan = planMaterialize({
      draft: { ...baseDraft, presetId: '首帧', media: [image('a')] },
      targetNodeId: null,
      anchor: { x: 0, y: 0 },
    });

    const imageNode = plan.nodes.find((n) => n.node.data.kind === 'image')!;
    expect(plan.roleByTempId.get(imageNode.tempId)).toBe('first_frame');

    const frameEdges = plan.edges.filter((e) => e.targetHandle === 'frames');
    expect(frameEdges).toHaveLength(1);
    expect(frameEdges[0]!.source).toBe(imageNode.tempId);

    // 单张素材不需要帧角色节点
    expect(plan.nodes.some((n) => n.node.data.kind === 'frameRole')).toBe(false);
  });

  it('多张图 + 首尾帧：插入帧角色节点做角色分配', () => {
    const plan = planMaterialize({
      draft: { ...baseDraft, presetId: '首尾帧', media: [image('a'), image('b')] },
      targetNodeId: null,
      anchor: { x: 0, y: 0 },
    });

    const frameNode = plan.nodes.find((n) => n.node.data.kind === 'frameRole');
    expect(frameNode).toBeDefined();
    expect(frameNode!.node.data.params.mode).toBe('first-last');

    // 两张图都接到帧角色节点，帧角色再接到生成节点
    const imageTempIds = plan.nodes.filter((n) => n.node.data.kind === 'image').map((n) => n.tempId);
    expect(imageTempIds).toHaveLength(2);
    for (const tempId of imageTempIds) {
      expect(plan.edges.some((e) => e.source === tempId && e.target === frameNode!.tempId)).toBe(true);
    }
    expect(
      plan.edges.some((e) => e.source === frameNode!.tempId && e.targetHandle === 'frames'),
    ).toBe(true);
  });

  it('多模态参考：帧角色用 reference 模式，视频音频也接进去', () => {
    const plan = planMaterialize({
      draft: { ...baseDraft, presetId: '全能参考', media: [image('a'), image('b'), video('ref'), audio('v')] },
      targetNodeId: null,
      anchor: { x: 0, y: 0 },
    });

    const frameNode = plan.nodes.find((n) => n.node.data.kind === 'frameRole')!;
    expect(frameNode.node.data.params.mode).toBe('reference');

    // 4 个素材节点都被创建，且都连到帧角色
    expect(plan.nodes.filter((n) => ['image', 'video', 'audio'].includes(n.node.data.kind))).toHaveLength(4);
    const incoming = plan.edges.filter((e) => e.target === frameNode.tempId);
    expect(incoming).toHaveLength(4);
  });

  it('绑定到已有节点时不新建生成节点，只补素材与提示词', () => {
    const plan = planMaterialize({
      draft: { ...baseDraft, presetId: '首帧', media: [image('a')] },
      targetNodeId: 'videoGen-existing',
      anchor: { x: 0, y: 0 },
    });

    expect(plan.targetIsNew).toBe(false);
    expect(plan.targetTempId).toBe('videoGen-existing');
    expect(plan.nodes.some((n) => n.node.data.kind === 'videoGen')).toBe(false);
    // 提示词 + 图片
    expect(plan.nodes).toHaveLength(2);
    expect(plan.edges.every((e) => e.target === 'videoGen-existing')).toBe(true);
  });

  it('空文本不会创建提示词节点（但素材照常）', () => {
    const plan = planMaterialize({
      draft: { ...baseDraft, text: '   ', presetId: '首帧', media: [image('a')] },
      targetNodeId: null,
      anchor: { x: 0, y: 0 },
    });
    expect(plan.nodes.some((n) => n.node.data.kind === 'prompt')).toBe(false);
    expect(plan.nodes.some((n) => n.node.data.kind === 'image')).toBe(true);
  });

  it('素材节点的参数完整带上规格信息', () => {
    const item = makeComposerMedia({
      kind: 'video',
      url: 'https://e.com/a.mp4',
      assetId: 'asset-9',
      mime: 'video/mp4',
      bytes: 2048,
      width: 1280,
      height: 720,
      durationSec: 6,
      name: 'a.mp4',
    });
    const plan = planMaterialize({
      draft: { ...baseDraft, presetId: '全能参考', media: [item] },
      targetNodeId: null,
      anchor: { x: 0, y: 0 },
    });
    const node = plan.nodes.find((n) => n.node.data.kind === 'video')!.node;
    expect(node.data.params).toMatchObject({
      kind: 'video',
      url: 'https://e.com/a.mp4',
      assetId: 'asset-9',
      bytes: 2048,
      width: 1280,
      height: 720,
      durationSec: 6,
      name: 'a.mp4',
    });
  });

  it('生成的节点都带有合法的默认参数（可被画布直接渲染）', () => {
    const plan = planMaterialize({
      draft: { ...baseDraft, presetId: '全能参考', media: [image('a'), image('b')] },
      targetNodeId: null,
      anchor: { x: 0, y: 0 },
    });
    for (const { node } of plan.nodes) {
      const defaults = defaultParamsFor(node.data.kind);
      for (const key of Object.keys(defaults)) {
        expect(node.data.params).toHaveProperty(key);
      }
    }
  });
});
