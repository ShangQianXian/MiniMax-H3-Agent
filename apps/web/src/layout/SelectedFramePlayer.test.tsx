// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SelectedFramePlayer } from './SelectedFramePlayer.tsx';

let images: FakeImage[];
class FakeImage {
  src = '';
  complete = false;
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { images.push(this); }
  load() { this.complete = true; this.naturalWidth = 1600; this.naturalHeight = 900; this.onload?.(); }
  fail() { this.complete = true; this.onerror?.(); }
}
beforeEach(() => {
  images = [];
  vi.useFakeTimers();
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 10));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const load = (page: number) => act(() => images.find((img) => img.src.includes(`/frame-sheets/${page}?`))!.load());

it('按原帧率循环播放不连续选帧，不播放中间未选帧；暂停后保留位置并可继续', () => {
  const frames = [1, 9, 15];
  const onFrame = vi.fn();
  const props = { assetId: 'source', frames, fps: 25, playing: true, onFrame };
  const view = render(<SelectedFramePlayer {...props} />);
  load(0);
  expect(onFrame).toHaveBeenLastCalledWith(1);
  advance(40); expect(onFrame).toHaveBeenLastCalledWith(9);
  advance(40); expect(onFrame).toHaveBeenLastCalledWith(15);
  advance(40); expect(onFrame).toHaveBeenLastCalledWith(1);
  expect(onFrame.mock.calls.map(([frame]) => frame)).toEqual([1, 9, 15, 1]);
  view.rerender(<SelectedFramePlayer {...props} playing={false} />);
  advance(400); expect(onFrame).toHaveBeenCalledTimes(4);
  view.rerender(<SelectedFramePlayer {...props} />);
  advance(40); expect(onFrame).toHaveBeenLastCalledWith(9);
  view.unmount(); advance(400); expect(onFrame).toHaveBeenCalledTimes(5);
});

it('选择变更立即从新序列第一帧循环，单帧选择保持同一画面', () => {
  const onFrame = vi.fn();
  const frames = [0, 3, 7];
  const view = render(<SelectedFramePlayer assetId="source" frames={frames} fps={25} playing onFrame={onFrame} />);
  load(0); advance(40); advance(40);
  expect(onFrame).toHaveBeenLastCalledWith(7);
  view.rerender(<SelectedFramePlayer assetId="source" frames={[12]} fps={25} playing onFrame={onFrame} />);
  expect(screen.getByRole('img', { name: '循环预览第 13 帧' })).toBeTruthy();
  expect(onFrame).toHaveBeenLastCalledWith(12);
  advance(400);
  expect(onFrame).toHaveBeenLastCalledWith(12);
});

it('跨缩略图批次会等待加载并可重试，加载后继续循环', () => {
  const onFrame = vi.fn();
  render(<SelectedFramePlayer assetId="source" frames={[99, 100]} fps={25} playing onFrame={onFrame} />);
  expect(images).toHaveLength(2);
  load(0); advance(200);
  expect(onFrame).toHaveBeenLastCalledWith(99);
  act(() => images[1]!.fail());
  fireEvent.click(screen.getByRole('button', { name: '重试预览' }));
  expect(images).toHaveLength(4);
  act(() => { images[2]!.load(); images[3]!.load(); });
  advance(40); expect(onFrame).toHaveBeenLastCalledWith(100);
  advance(40); expect(onFrame).toHaveBeenLastCalledWith(99);
});
