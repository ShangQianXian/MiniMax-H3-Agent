// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComposerPanel } from './ComposerPanel.tsx';
import { useComposer } from '../store/composer.ts';
import { useGraph } from '../store/graph.ts';
import { api } from '../api/client.ts';
import { fileToOutcome } from '../lib/media.ts';
import { runNodes } from '../engine/run-controls.ts';
import { defaultParamsFor } from '@h3/shared';

vi.mock('../api/client.ts', () => ({ api: { uploadAsset: vi.fn() } }));
vi.mock('../engine/run-controls.ts', () => ({ isBusy: () => false, runNodes: vi.fn(async () => ({ ok: true, failed: [] })) }));
vi.mock('../lib/media.ts', async (original) => ({ ...await original<typeof import('../lib/media.ts')>(), fileToOutcome: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  useComposer.setState({ text: '', media: [], targetNodeId: null, targetPinned: false, model: 'MiniMax-H3', presetId: '全能参考', resolution: '768P', ratio: 'adaptive', duration: 8, sound: '有声' });
  useGraph.setState({ nodes: [], edges: [], selectedNodeId: null, activeWorkflowId: 'test-workflow', run: { running: false, total: 0, done: 0, label: '' }, past: [], future: [] });
});
afterEach(cleanup);

describe('创作台交互回归', () => {
  it('默认创作台只输入文字时可直接创建合法的文生视频节点', async () => {
    render(<ComposerPanel />);
    fireEvent.change(screen.getByLabelText('视频提示词'), { target: { value: '晨雾中的森林，镜头缓慢向前推进' } });
    fireEvent.click(screen.getByLabelText('生成视频'));
    await waitFor(() => expect(runNodes).toHaveBeenCalledTimes(1));
    expect(useGraph.getState().nodes.find((n) => n.data.kind === 'videoGen')?.data.params).toMatchObject({ presetId: '文生视频', ratio: '16:9' });
  });
  it('不创建节点也能选择首尾帧，并自动收敛比例', () => {
    render(<ComposerPanel />);
    fireEvent.click(screen.getByLabelText('设置生成参数'));
    fireEvent.click(screen.getByRole('button', { name: '3:4' }));
    fireEvent.click(screen.getByRole('button', { name: '首尾帧' }));
    expect(useComposer.getState().ratio).toBe('adaptive');
    expect(screen.queryByRole('button', { name: '3:4' })).toBeNull();
    expect(useGraph.getState().nodes).toHaveLength(0);
  });
  it('切换 H3-Max 自动修正不支持的参数，并提供 480P', () => {
    useComposer.setState({ resolution: '2K', duration: 4 });
    render(<ComposerPanel />);
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'MiniMax-H3-Max' } });
    expect(useComposer.getState()).toMatchObject({ presetId: '首帧', resolution: '768P', duration: 5, ratio: 'adaptive' });
    fireEvent.click(screen.getByLabelText('设置生成参数'));
    expect(screen.getByRole('button', { name: '480P' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '全能参考' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('超长提示词不可通过按钮或快捷键提交', () => {
    render(<ComposerPanel />);
    const input = screen.getByLabelText('视频提示词');
    fireEvent.change(input, { target: { value: 'a'.repeat(7001) } });
    expect((screen.getByLabelText('生成视频') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(runNodes).not.toHaveBeenCalled();
    expect(useGraph.getState().nodes).toHaveLength(0);
  });
  it('上传未完成时按钮和快捷键均不能触发生成', async () => {
    let finish!: (value: Awaited<ReturnType<typeof fileToOutcome>>) => void;
    vi.mocked(fileToOutcome).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(api.uploadAsset).mockResolvedValue({ asset: { id: 'asset-test' } } as Awaited<ReturnType<typeof api.uploadAsset>>);
    useComposer.setState({ text: '海边的日落' });
    const { container } = render(<ComposerPanel />);
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['image'], 'a.png', { type: 'image/png' })] } });
    expect((screen.getByLabelText('生成视频') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText('视频提示词'), { key: 'Enter', ctrlKey: true });
    expect(runNodes).not.toHaveBeenCalled();
    await act(async () => finish({ url: 'data:image/png;base64,AAAA', name: 'a.png', bytes: 5, mime: 'image/png', probe: {} }));
    await waitFor(() => expect(useComposer.getState().media).toHaveLength(1));
    expect((screen.getByLabelText('生成视频') as HTMLButtonElement).disabled).toBe(false);
  });
  it('任务状态刷新不会覆盖草稿参数，费用跟随草稿调整', () => {
    const node = { id: 'g', type: 'videoGen', position: { x: 0, y: 0 }, data: { kind: 'videoGen' as const, label: '视频生成', params: defaultParamsFor('videoGen') } };
    useGraph.setState({ nodes: [node], selectedNodeId: 'g' });
    render(<ComposerPanel />);
    fireEvent.click(screen.getByLabelText('设置生成参数'));
    fireEvent.click(screen.getByRole('button', { name: '2K' }));
    expect(screen.getByText('¥6.40')).toBeTruthy();
    act(() => useGraph.setState({ nodes: [{ ...node, data: { ...node.data, runtime: { status: 'queued' } } }] }));
    expect(useComposer.getState().resolution).toBe('2K');
  });
  it('批次中的无效文件不会上传，也不会丢弃已添加的素材', async () => {
    useComposer.setState({ media: [{ id: 'existing', kind: 'image', url: 'existing.png' }] });
    const { container } = render(<ComposerPanel />);
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [new File(['bad'], 'a.pdf', { type: 'application/pdf' })] } });
    await screen.findByRole('alert');
    expect(api.uploadAsset).not.toHaveBeenCalled();
    expect(useComposer.getState().media).toHaveLength(1);
  });
  it('切换工作流不会把旧草稿连接到新工作流', () => {
    useComposer.setState({ text: '旧工作流的创意' });
    render(<ComposerPanel />);
    act(() => useGraph.setState({ activeWorkflowId: 'new-workflow' }));
    expect(useComposer.getState().text).toBe('');
    expect(useComposer.getState().targetNodeId).toBeNull();
  });
});

