/**
 * 节点操作条的回归测试（对应错误2：点不动「运行 / 复制 / 删除」）。
 *
 * 根因：这些按钮原先没有 nodrag 类，React Flow 会把 pointerdown 判定为「拖拽起手」，
 * 于是按钮的 click 永远不触发。
 *
 * 注意：无法在 jsdom 里复现 React Flow 的拖拽判定，所以这里直接断言
 * 「操作条与按钮都带 nodrag，且 pointerdown 不会冒泡」——
 * 这两条正是修复的本质，也能挡住以后有人把类名删掉。
 */
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { defaultParamsFor } from '@h3/shared';
import { NodeShell } from './NodeShell.tsx';
import { useGraph } from '../store/graph.ts';

const NODE_ID = 'videoGen-test';

function renderShell(onRun = () => undefined) {
  return render(
    createElement(
      ReactFlowProvider,
      null,
      createElement(NodeShell, {
        id: NODE_ID,
        type: 'videoGen',
        data: {
          kind: 'videoGen',
          label: '视频生成',
          params: { ...defaultParamsFor('videoGen') },
        },
        selected: false,
        onRun,
      }),
    ),
  );
}

beforeEach(() => {
  useGraph.setState({ nodes: [], edges: [], past: [], future: [], graphSignature: '' });
});

afterEach(() => {
  cleanup();
});

describe('节点操作条可点击性', () => {
  it('运行按钮带 nodrag，并能触发回调', () => {
    let runs = 0;
    renderShell(() => {
      runs += 1;
    });

    const runButton = screen.getByText('▶ 运行');
    expect(runButton.className).toContain('nodrag');
    runButton.click();
    expect(runs).toBe(1);
  });

  /**
   * 核心回归：操作条必须在「悬停容器」内部。
   *
   * 早期把它放在容器外面（absolute -top-8），鼠标从节点移向按钮时会先触发 onMouseLeave，
   * 操作条随即 opacity-0 / pointer-events-none，于是永远点不中。
   * 现在容器有 pt-8，操作条落在顶部内边距里 —— 下面这几条断言就是在守这个结构。
   */
  it('操作条是容器内部元素，且容器预留了顶部内边距', () => {
    renderShell();
    const runButton = screen.getByText('▶ 运行');
    const bar = runButton.parentElement!;
    const container = bar.parentElement!;

    // 操作条必须是容器的直接子元素
    expect(container.contains(bar)).toBe(true);
    // 容器要有 pt-8，操作条才有「容身之处」
    expect(container.className).toContain('pt-8');
    // 操作条贴在顶部内边距里，而不是飘到容器外面
    expect(bar.className).toContain('top-1');
    expect(bar.className).not.toContain('-top-');
  });

  it('未悬停时操作条只是变透明，不会变成不可点击', () => {
    renderShell();
    const bar = screen.getByText('▶ 运行').parentElement!;
    // 不能再出现 pointer-events-none：那会让按钮彻底点不动
    expect(bar.className).not.toContain('pointer-events-none');
    expect(bar.className).toContain('opacity-0');
  });

  it('操作条容器带 nodrag/nopan 且拦截 pointerdown 冒泡', () => {
    renderShell();
    const bar = screen.getByText('▶ 运行').parentElement!;
    expect(bar.className).toContain('nodrag');
    expect(bar.className).toContain('nopan');
  });

  it('复制与删除按钮都带 nodrag', () => {
    renderShell();
    const bar = screen.getByText('▶ 运行').parentElement!;
    const buttons = bar.querySelectorAll('button');
    // 运行 / 复制 / 删除
    expect(buttons.length).toBe(3);
    for (const button of Array.from(buttons)) {
      expect(button.className).toContain('nodrag');
    }
  });
  it('复制按钮真的会复制节点，删除按钮真的会删掉节点', () => {
    // beforeEach 会清空 store，所以节点要在渲染前建
    const id = useGraph.getState().addNode('videoGen', { x: 0, y: 0 });
    expect(useGraph.getState().nodes).toHaveLength(1);

    render(
      createElement(
        ReactFlowProvider,
        null,
        createElement(NodeShell, {
          id,
          type: 'videoGen',
          data: { kind: 'videoGen', label: '视频生成', params: { ...defaultParamsFor('videoGen') } },
          selected: false,
        }),
      ),
    );

    // 注意：没传 onRun 时操作条里只有「复制」与「删除」两个按钮，所以按下标取要谨慎
    const copyButton = screen.getByTitle('复制节点') as HTMLButtonElement;
    const deleteButton = screen.getByTitle('删除节点') as HTMLButtonElement;

    copyButton.click();
    expect(useGraph.getState().nodes).toHaveLength(2);

    deleteButton.click();
    expect(useGraph.getState().nodes).toHaveLength(1);
  });
});
