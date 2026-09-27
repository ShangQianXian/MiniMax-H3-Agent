// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MediaDialog, MediaPreview } from './MediaPreview.tsx';
import { api, type AssetRecord } from '../api/client.ts';
import { useGraph } from '../store/graph.ts';

const metadata = { width: 1080, height: 1920, fps: 25, frameCount: 10, durationSec: 0.4, frameTimes: Array.from({ length: 10 }, (_, i) => i / 25), hasAudio: true };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.spyOn(api, 'videoMetadata').mockResolvedValue({ metadata });
  useGraph.setState({ activeWorkflowId: 'w1', nodes: [], edges: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('显示图片真实尺寸，原始尺寸预览不受画布缩放影响', () => {
  render(<MediaPreview src="/image.png" kind="image" />);
  Object.defineProperties(screen.getByRole('img'), { naturalWidth: { value: 800 }, naturalHeight: { value: 1200 } });
  fireEvent.load(screen.getByRole('img'));
  expect(screen.getByText('800 × 1200')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '原始尺寸' }));
  const image = screen.getByAltText('图片原始尺寸');
  expect(image.style.width).toBe('800px');
  expect(image.style.height).toBe('1200px');
  expect(image.closest('.media-viewport')?.getAttribute('data-fit')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '适应窗口' }));
  expect(image.closest('.media-viewport')?.getAttribute('data-fit')).toBe('true');
});

it('逐帧移动与范围选择，按包含首尾帧的语义导出并持久化为新节点', async () => {
  const asset = { id: 'clip', originalName: '剪辑.mp4', bytes: 500, mime: 'video/mp4' } as AssetRecord;
  const trim = vi.spyOn(api, 'trimVideo').mockResolvedValue({ asset, metadata: { ...metadata, frameCount: 3 }, dataUri: 'data:video/mp4;base64,YQ==' });
  render(<MediaDialog src="/api/assets/source/content" kind="video" initialMode="edit" size={{ width: 1080, height: 1920 }} onClose={vi.fn()} />);
  await screen.findByLabelText('逐帧时间轴');
  fireEvent.click(screen.getByRole('button', { name: '下一帧' }));
  fireEvent.click(screen.getByRole('button', { name: '当前帧设为起点' }));
  fireEvent.change(screen.getByLabelText('当前帧'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: '当前帧设为终点' }));
  expect(screen.getByText(/保留 3 帧/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '导出剪辑' }));
  await screen.findByRole('link', { name: '下载剪辑' });
  expect(trim).toHaveBeenCalledWith('source', { startFrame: 1, endFrame: 4 });
  fireEvent.click(screen.getByRole('button', { name: '添加到画布' }));
  expect(useGraph.getState().exportGraph().nodes[0]?.params).toMatchObject({ assetId: 'clip', url: 'data:video/mp4;base64,YQ==', width: 1080, height: 1920 });
  fireEvent.click(screen.getByRole('button', { name: '已添加到画布' }));
  expect(useGraph.getState().nodes).toHaveLength(1);
});

it('禁止无效范围；导出失败保留选择并提示错误', async () => {
  vi.spyOn(api, 'trimVideo').mockRejectedValue(new Error('导出失败'));
  render(<MediaDialog src="/api/assets/source/content" kind="video" initialMode="edit" size={{ width: 1, height: 1 }} onClose={vi.fn()} />);
  await screen.findByLabelText('结束帧');
  fireEvent.change(screen.getByLabelText('起始帧'), { target: { value: '11' } });
  expect((screen.getByRole('button', { name: '导出剪辑' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重置范围' }));
  fireEvent.click(screen.getByRole('button', { name: '导出剪辑' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('导出失败'));
  expect((screen.getByLabelText('结束帧') as HTMLInputElement).value).toBe('10');
});

it('远端生成结果先转存再读取帧信息', async () => {
  const save = vi.spyOn(api, 'saveArtifact').mockResolvedValue({ asset: { id: 'saved' } as AssetRecord, task: {} as never });
  render(<MediaDialog src="https://example.com/generated.mp4" taskId="task1" kind="video" initialMode="edit" size={{ width: 1, height: 1 }} onClose={vi.fn()} />);
  await screen.findByLabelText('结束帧');
  expect(save).toHaveBeenCalledWith('task1');
  expect(api.videoMetadata).toHaveBeenCalledWith('saved');
});
