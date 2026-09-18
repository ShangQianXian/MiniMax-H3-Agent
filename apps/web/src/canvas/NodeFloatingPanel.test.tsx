/**
 * 浮层面板的回归测试。
 *
 * 对应两个真实反馈：
 *   1. 「右上角的 × 点不动」—— 拖动抓手层盖住了关闭按钮，把点击吃掉了。
 *      抓手必须 pointer-events:none，事件上完全透明。
 *   2. 「面板太长」—— 改成三列横向布局，宽度按视口自适应。
 *
 * jsdom 里没法复现真实的命中测试，所以这里断言的是「修复的本质」：
 * 抓手层不参与事件 + 面板里能正常点到关闭按钮 + 拖动只认非控件区域。
 *
 * 注意：面板要从 React Flow store 里读节点坐标，所以测试必须渲染在一个
 * 真正的 <ReactFlow> 里（只包 Provider 的话 nodeLookup 是空的）。
 */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { NodeFloatingPanel } from './NodeFloatingPanel.tsx';

const NODE_ID = 'node-1';

/**
 * jsdom 没有 ResizeObserver，而 React Flow 内部依赖它。
 * 这里补一个最小实现（只记录回调，不真的观察）。
 */
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
  }
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const TEST_NODE = {
  id: NODE_ID,
  type: 'default',
  position: { x: 120, y: 120 },
  data: { label: '节点' },
  measured: { width: 244, height: 260 },
};

function renderPanel(children: ReactNode) {
  return render(
    createElement(
      ReactFlowProvider,
      null,
      createElement(
        ReactFlow,
        { nodes: [TEST_NODE] as never, edges: [] },
        createElement(NodeFloatingPanel, { nodeId: NODE_ID, children }),
      ),
    ),
  );
}

/** portal 渲染到 body，这里取它的根元素 */
function panelRoot(): HTMLElement {
  const root = document.body.querySelector('.fixed') as HTMLElement | null;
  if (!root) throw new Error('面板没有渲染出来');
  return root;
}

describe('关闭按钮不被拖动抓手挡住', () => {
  it('抓手层 pointer-events 为 none', () => {
    renderPanel(
      createElement(
        'div',
        null,
        createElement('span', null, '参数'),
        createElement('button', { type: 'button' }, '×'),
      ),
    );

    const dragHandle = panelRoot().querySelector('.cursor-grab') as HTMLElement | null;
    expect(dragHandle).toBeTruthy();
    // 关键断言：抓手在事件上必须完全透明
    expect(dragHandle!.style.pointerEvents).toBe('none');
  });

  it('点关闭按钮能触发回调（不会被抓手吞掉）', () => {
    const onClose = vi.fn();
    renderPanel(
      createElement(
        'div',
        null,
        createElement('span', null, '参数'),
        createElement('button', { type: 'button', onClick: onClose, 'aria-label': '关闭参数面板' }, '×'),
      ),
    );

    fireEvent.click(screen.getByLabelText('关闭参数面板'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('尺寸与拖动', () => {
  it('面板宽度自适应视口，且不超过首选宽度', () => {
    renderPanel(createElement('div', null, '内容'));

    const width = Number.parseFloat(panelRoot().style.width);
    // jsdom 默认视口 1024，减去两侧 12px 边距 → 1000，被首选宽度 760 收住
    expect(width).toBeLessThanOrEqual(760);
    expect(width).toBeGreaterThanOrEqual(300);
  });

  it('在非控件区域按下才开始拖动', () => {
    renderPanel(
      createElement(
        'div',
        null,
        createElement('span', { 'data-testid': 'blank' }, '空白区域'),
        createElement('button', { type: 'button' }, '按钮'),
      ),
    );

    const root = panelRoot();
    const panel = root.querySelector('.overflow-y-auto') as HTMLElement;
    expect(panel).toBeTruthy();

    const before = root.style.left;

    // 按在按钮上：不应该拖动
    fireEvent.pointerDown(screen.getByText('按钮'), { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(panel, { clientX: 320, clientY: 320 });
    expect(root.style.left).toBe(before);

    // 按在空白处：应该拖动
    fireEvent.pointerDown(screen.getByTestId('blank'), { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(panel, { clientX: 260, clientY: 120 });
    expect(root.style.left).not.toBe(before);

    fireEvent.pointerUp(panel, { clientX: 260, clientY: 120 });
  });
});
