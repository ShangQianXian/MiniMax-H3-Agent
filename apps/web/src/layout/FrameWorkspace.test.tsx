// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MediaPreview, MediaDialog } from './MediaPreview.tsx';
import { FrameWorkspace } from './FrameWorkspace.tsx';
import { api, type AssetRecord } from '../api/client.ts';
import { useGraph } from '../store/graph.ts';

const metadata = { width: 1920, height: 1080, fps: 25, frameCount: 240, durationSec: 9.6,
  frameTimes: Array.from({ length: 240 }, (_, i) => i / 25), hasAudio: true };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(api, 'videoMetadata').mockResolvedValue({ metadata });
  useGraph.setState({ activeWorkflowId: 'w1', nodes: [], edges: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('视频入口打开专门界面，保留原视频，滚动/定位可到达最后一帧', async () => {
  render(<MediaPreview src="/api/assets/source/content" kind="video" name="行走.mp4" />);
  fireEvent.click(screen.getByRole('button', { name: '逐帧分解' }));
  await screen.findByRole('region', { name: '全部视频帧' });
  expect(screen.getByLabelText('原视频').tagName).toBe('VIDEO');
  expect(screen.getByRole('button', { name: '查看第 1 帧' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '查看第 240 帧' })).toBeNull();
  fireEvent.change(screen.getByLabelText('定位帧'), { target: { value: '240' } });
  expect(screen.getByRole('button', { name: '查看第 240 帧' })).toBeTruthy();
  expect((screen.getByLabelText('原视频') as HTMLVideoElement).currentTime).toBe(9.56);
  fireEvent.click(screen.getByRole('button', { name: '返回视频' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('双击打开原始单帧，单击和双击不更改选择，关闭后保留选择', async () => {
  render(<FrameWorkspace src="/api/assets/source/content" kind="video" onClose={vi.fn()} />);
  const thumbnail = await screen.findByRole('button', { name: '查看第 4 帧' });
  fireEvent.click(thumbnail); fireEvent.doubleClick(thumbnail);
  const viewer = screen.getByRole('dialog', { name: '单帧查看' });
  expect(within(viewer).getByAltText('第 4 帧原图').getAttribute('src')).toContain('/frames/3');
  fireEvent.click(within(viewer).getByRole('button', { name: '选择此帧' }));
  fireEvent.keyDown(viewer, { key: 'ArrowRight' });
  expect(within(viewer).getByAltText('第 5 帧原图')).toBeTruthy();
  fireEvent.click(within(viewer).getByRole('button', { name: '返回全部帧' }));
  expect(screen.queryByRole('dialog', { name: '单帧查看' })).toBeNull();
  expect((screen.getByLabelText('选择第 4 帧') as HTMLInputElement).checked).toBe(true);
});

it('Shift 连选、反选、清空、范围追加及不连续导出；导出后可添加画布', async () => {
  const exportFrames = vi.spyOn(api, 'exportVideoFrames').mockResolvedValue({
    asset: { id: 'export', originalName: '选帧.mp4', bytes: 500, mime: 'video/mp4' } as AssetRecord,
    metadata: { ...metadata, frameCount: 4, hasAudio: false }, dataUri: 'data:video/mp4;base64,YQ==',
  });
  render(<FrameWorkspace src="/api/assets/source/content" kind="video" onClose={vi.fn()} />);
  await screen.findByLabelText('选择第 1 帧');
  expect((screen.getByRole('button', { name: '导出所选帧' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('选择第 2 帧'));
  fireEvent.click(screen.getByLabelText('选择第 5 帧'), { shiftKey: true });
  expect(screen.getByRole('button', { name: '导出所选帧（4）' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '反选' }));
  expect(screen.getByRole('button', { name: '导出所选帧（236）' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '全选' }));
  expect(screen.getByRole('button', { name: '导出所选帧（240）' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }));
  fireEvent.click(screen.getByLabelText('选择第 8 帧'));
  fireEvent.change(screen.getByLabelText('选帧起点'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText('选帧终点'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: '选中范围' }));
  fireEvent.click(screen.getByRole('button', { name: '导出所选帧（4）' }));
  await screen.findByRole('link', { name: '下载视频' });
  expect(exportFrames).toHaveBeenCalledWith('source', { frames: [1, 2, 3, 7] });
  fireEvent.click(screen.getByRole('button', { name: '添加到画布' }));
  expect(useGraph.getState().exportGraph().nodes[0]?.params).toMatchObject({ assetId: 'export', width: 1920, height: 1080 });
});

it('导出失败保留选择并可重试，导出期间禁用修改与关闭', async () => {
  let rejectExport: (cause: Error) => void = () => {};
  vi.spyOn(api, 'exportVideoFrames').mockImplementation(() => new Promise((_resolve, reject) => { rejectExport = reject; }));
  render(<FrameWorkspace src="/api/assets/source/content" kind="video" onClose={vi.fn()} />);
  fireEvent.click(await screen.findByLabelText('选择第 1 帧'));
  fireEvent.click(screen.getByRole('button', { name: '导出所选帧（1）' }));
  expect((screen.getByRole('button', { name: '返回视频' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('选择第 1 帧') as HTMLInputElement).disabled).toBe(true);
  rejectExport(new Error('导出失败，请重试'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('导出失败'));
  expect((screen.getByLabelText('选择第 1 帧') as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole('button', { name: '导出所选帧（1）' }) as HTMLButtonElement).disabled).toBe(false);
});

it('从原始尺寸预览进入分解，远端生成视频先转存', async () => {
  vi.spyOn(api, 'saveArtifact').mockResolvedValue({ asset: { id: 'saved' } as AssetRecord, task: {} as never });
  render(<MediaDialog src="https://example.com/movie.mp4" taskId="task1" kind="video" initialMode="view" size={{ width: 1920, height: 1080 }} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '逐帧分解' }));
  await screen.findByRole('region', { name: '全部视频帧' });
  expect(api.saveArtifact).toHaveBeenCalledWith('task1');
  expect(api.videoMetadata).toHaveBeenCalledWith('saved');
});

it('缩放帧图片会重排网格，保留选择与末尾浏览位置', async () => {
  render(<FrameWorkspace src="/api/assets/source/content" kind="video" onClose={vi.fn()} />);
  fireEvent.click(await screen.findByLabelText('选择第 1 帧'));
  const initialHeight = screen.getByRole('button', { name: '查看第 1 帧' }).style.height;
  fireEvent.click(screen.getByRole('button', { name: '放大帧图片' }));
  expect(parseFloat(screen.getByRole('button', { name: '查看第 1 帧' }).style.height)).toBeGreaterThan(parseFloat(initialHeight));
  expect((screen.getByLabelText('选择第 1 帧') as HTMLInputElement).checked).toBe(true);
  fireEvent.change(screen.getByLabelText('定位帧'), { target: { value: '240' } });
  fireEvent.change(screen.getByRole('slider', { name: '缩略图大小' }), { target: { value: '200' } });
  expect(screen.getByRole('button', { name: '查看第 240 帧' })).toBeTruthy();
  expect((screen.getByRole('button', { name: '放大帧图片' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole('slider', { name: '缩略图大小' }), { target: { value: '75' } });
  expect(screen.getByRole('button', { name: '查看第 240 帧' })).toBeTruthy();
  expect((screen.getByRole('button', { name: '缩小帧图片' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: '导出所选帧（1）' })).toBeTruthy();
});

it('所选帧可播放、暂停、继续、返回原视频；清空选择后停止且不生成导出文件', async () => {
  const exportFrames = vi.spyOn(api, 'exportVideoFrames');
  render(<FrameWorkspace src="/api/assets/source/content" kind="video" onClose={vi.fn()} />);
  await screen.findByRole('button', { name: '播放所选帧' });
  expect((screen.getByRole('button', { name: '播放所选帧' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('选择第 1 帧'));
  fireEvent.click(screen.getByLabelText('选择第 4 帧'));
  fireEvent.click(screen.getByRole('button', { name: '播放所选帧' }));
  expect(screen.getByRole('region', { name: '所选帧循环预览' })).toBeTruthy();
  expect((screen.getByLabelText('原视频') as HTMLVideoElement).hidden).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '暂停预览' }));
  expect(screen.getByText(/已暂停 · 1 \/ 2/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '播放所选帧' }));
  fireEvent.click(screen.getByRole('button', { name: '返回原视频' }));
  expect(screen.queryByRole('region', { name: '所选帧循环预览' })).toBeNull();
  expect((screen.getByLabelText('原视频') as HTMLVideoElement).hidden).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '播放所选帧' }));
  fireEvent.click(screen.getByRole('button', { name: '清空选择' }));
  expect(screen.queryByRole('region', { name: '所选帧循环预览' })).toBeNull();
  expect((screen.getByRole('button', { name: '播放所选帧' }) as HTMLButtonElement).disabled).toBe(true);
  expect(exportFrames).not.toHaveBeenCalled();
});
