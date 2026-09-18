/**
 * 「添加节点」菜单的回归测试（对应错误3 的诉求）。
 *
 * 诉求原文：把底部工具栏的 ＋ 改成「添加节点的内容，而不是添加对话」。
 * 这里锁死三件事：
 *   1. 菜单里列出全部节点类型，且按分组组织
 *   2. 点某一项会把该类型的节点加到画布
 *   3. 没有画布实例时不会炸，只是什么都不做
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { NODE_DEFS } from '@h3/shared';
import { bindAddNode, useCanvasBridge } from '../canvas/canvas-bridge.ts';
import { NodePickerMenu } from './NodePickerMenu.tsx';

const added: Array<{ kind: string; params: Record<string, unknown> }> = [];

beforeEach(() => {
  added.length = 0;
  // 模拟画布已登记：有视口矩形与坐标换算
  useCanvasBridge.getState().register({
    rect: { left: 240, top: 36, width: 900, height: 600 },
    toFlowPosition: (point) => ({ x: point.x - 240, y: point.y - 36 }),
  });
  bindAddNode((kind, position, params) => {
    added.push({ kind, params: { ...(params ?? {}), __position: position } });
    return `${kind}-1`;
  });
});

afterEach(() => {
  cleanup();
  useCanvasBridge.getState().unregister();
});

describe('添加节点菜单', () => {
  it('列出全部 10 种节点，并按分组标题组织', () => {
    render(createElement(NodePickerMenu, { onClose: () => undefined }));

    expect(screen.getByText('添加节点')).toBeTruthy();
    for (const def of Object.values(NODE_DEFS)) {
      expect(screen.getAllByText(def.label).length).toBeGreaterThan(0);
    }
    for (const group of ['输入', '组织', '任务', '管理']) {
      expect(screen.getAllByText(group).length).toBeGreaterThan(0);
    }
  });

  it('点「图片」会往画布加一个图片节点（而不是提示词）', () => {
    render(createElement(NodePickerMenu, { onClose: () => undefined }));
    fireEvent.click(screen.getByText('图片'));

    expect(added).toHaveLength(1);
    expect(added[0]!.kind).toBe('image');
    // 默认参数要带上，节点才能直接被画布渲染
    expect(added[0]!.params).toMatchObject({ kind: 'image', ref: null });
  });

  it('点「视频生成」加的是生成节点，并带齐默认参数', () => {
    render(createElement(NodePickerMenu, { onClose: () => undefined }));
    fireEvent.click(screen.getByText('视频生成'));

    expect(added[0]!.kind).toBe('videoGen');
    expect(added[0]!.params).toMatchObject({
      model: 'MiniMax-H3',
      resolution: '768P',
      duration: 8,
      ratio: 'adaptive',
      presetId: '全能参考',
      sound: '有声',
    });
  });

  it('节点落在画布可视区中心附近', () => {
    render(createElement(NodePickerMenu, { onClose: () => undefined }));
    fireEvent.click(screen.getByText('提示词'));

    const position = added[0]!.params.__position as { x: number; y: number };
    // 视口中心 x = 240 + 900/2 = 690 → 画布坐标 450；再左右各偏移 110
    expect(position.x).toBeCloseTo(690 - 240 - 110, 0);
    // y 中心上移 60 以避开底部创作台
    expect(position.y).toBeCloseTo(36 + 300 - 60 - 36 - 20, 0);
  });

  it('加完会通知调用方并关闭菜单', () => {
    const onClose = vi.fn();
    const onAdded = vi.fn();
    render(createElement(NodePickerMenu, { onClose, onAdded }));
    fireEvent.click(screen.getByText('音频'));

    expect(onAdded).toHaveBeenCalledWith('audio');
    expect(onClose).toHaveBeenCalled();
  });

  it('搜索可以过滤节点', () => {
    render(createElement(NodePickerMenu, { onClose: () => undefined }));
    fireEvent.change(screen.getByPlaceholderText('搜索节点…'), { target: { value: '参考' } });

    // 「全能参考」在描述里含「参考」，节点名里带「参考」的都应保留
    expect(screen.getAllByText(/参考/).length).toBeGreaterThan(0);
    // 明显不相关的节点应被过滤掉
    expect(screen.queryByText('任务列表')).toBeNull();
  });

  it('没有画布实例时不报错，也不加节点', () => {
    useCanvasBridge.getState().unregister();
    render(createElement(NodePickerMenu, { onClose: () => undefined }));
    expect(() => fireEvent.click(screen.getByText('图片'))).not.toThrow();
    expect(added).toHaveLength(0);
  });
});
