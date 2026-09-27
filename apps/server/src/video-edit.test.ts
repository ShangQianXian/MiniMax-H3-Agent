import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createContext, type AppContext } from './context.ts';
import { createApp } from './app.ts';
import { ffmpegPath, probeVideo } from './services/video-edit.ts';
import type { AssetRecord } from './services/assets.ts';
import type { VideoMetadata } from '@h3/shared';

const exec = promisify(execFile);
let dir: string;
let ctx: AppContext;
let server: Server;
let base: string;
let source: AssetRecord;
let silent: AssetRecord;
let variable: AssetRecord;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'h3-frame-test-'));
  ctx = createContext({ dataDir: dir, dbPath: join(dir, 'test.sqlite'), assetsDir: join(dir, 'assets'), artifactsDir: join(dir, 'artifacts'), mock: true });
  const make = async (name: string, options: string[]) => {
    const path = join(dir, name);
    await exec(ffmpegPath, ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30000/1001:duration=2',
      ...options, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path], { windowsHide: true });
    return ctx.assets.saveUpload({ buffer: await readFile(path), kind: 'video', mime: 'video/mp4', projectId: null, originalName: name });
  };
  source = await make('audio.mp4', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', '-shortest']);
  silent = await make('silent.mp4', []);
  variable = await make('variable.mp4', ['-vf', 'select=not(mod(n\\,3))+not(mod(n\\,5))', '-vsync', '0']);
  server = createApp(ctx).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as { port: number };
  base = `http://127.0.0.1:${address.port}/api/assets`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  ctx?.db.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function trim(asset: AssetRecord, startFrame: number, endFrame: number) {
  const response = await fetch(`${base}/${asset.id}/trim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startFrame, endFrame }) });
  const body = await response.json() as { asset: AssetRecord; metadata: VideoMetadata; error?: string; dataUri: string };
  expect(response.status, body.error).toBe(200);
  return body;
}

it('读取真实分辨率、非整数帧率和所有帧的时间戳；逐帧图片可访问', async () => {
  const response = await fetch(`${base}/${source.id}/video-metadata`);
  const { metadata } = await response.json() as { metadata: VideoMetadata };
  expect(metadata).toMatchObject({ width: 160, height: 90, frameCount: 60, hasAudio: true });
  expect(metadata.fps).toBeCloseTo(30000 / 1001, 3);
  expect(metadata.frameTimes[1]).toBeCloseTo(1001 / 30000, 5);
  const frame = await fetch(`${base}/${source.id}/frames/13`);
  expect(frame.status).toBe(200);
  expect(frame.headers.get('content-type')).toContain('image/jpeg');
  expect((await frame.arrayBuffer()).byteLength).toBeGreaterThan(100);
  expect((await fetch(`${base}/${source.id}/frames/60`)).status).toBe(400);
});

it('非关键帧处裁切恰好 13 帧，保留尺寸、声音和原文件，并支持 Range', async () => {
  const original = await readFile(source.localPath);
  const result = await trim(source, 7, 20);
  expect(result.metadata).toMatchObject({ width: 160, height: 90, frameCount: 13, hasAudio: true });
  expect(result.metadata.durationSec).toBeCloseTo(13 * 1001 / 30000, 2);
  expect(result.asset.id).not.toBe(source.id);
  expect(await readFile(source.localPath)).toEqual(original);
  const range = await fetch(`${base}/${result.asset.id}/content`, { headers: { Range: 'bytes=0-31' } });
  expect(range.status).toBe(206);
  expect((await range.arrayBuffer()).byteLength).toBe(32);
  expect(result.dataUri.startsWith('data:video/mp4;base64,')).toBe(true);
  // Compare decoded boundary frames, allowing for the second lossy H.264 encoding.
  const pixels = async (path: string, frame: number) => (await exec(ffmpegPath, ['-v', 'error', '-i', path,
    '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
  { encoding: 'buffer', windowsHide: true })).stdout;
  for (const [before, after] of [[7, 0], [19, 12]]) {
    const a = await pixels(source.localPath, before!);
    const b = await pixels(result.asset.localPath, after!);
    expect(b.length).toBe(a.length);
    const error = a.reduce((sum, byte, i) => sum + Math.abs(byte - b[i]!), 0) / a.length;
    expect(error).toBeLessThan(8);
  }
});

it('可以导出无声视频的首帧、最后一帧以及完整范围', async () => {
  for (const [start, end] of [[0, 1], [59, 60], [0, 60]]) {
    const result = await trim(silent, start!, end!);
    expect(result.metadata.frameCount).toBe(end! - start!);
    expect(result.metadata.hasAudio).toBe(false);
  }
});

it('可变帧率按实际帧编号裁切，保留时间间隔', async () => {
  const metadata = await probeVideo(variable.localPath);
  const result = await trim(variable, 3, 12);
  expect(result.metadata.frameCount).toBe(9);
  for (let index = 0; index < 9; index++) {
    expect(result.metadata.frameTimes[index]).toBeCloseTo(metadata.frameTimes[index + 3]! - metadata.frameTimes[3]!, 4);
  }
});

it('拒绝非法范围、非视频素材和缺失素材', async () => {
  for (const range of [{ startFrame: -1, endFrame: 2 }, { startFrame: 1.5, endFrame: 3 },
    { startFrame: 3, endFrame: 3 }, { startFrame: 0, endFrame: 61 }, { startFrame: '0', endFrame: 1 }, {}]) {
    const response = await fetch(`${base}/${source.id}/trim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(range) });
    expect(response.status).toBe(400);
  }
  const image = await ctx.assets.saveUpload({ buffer: Buffer.from('image'), mime: 'image/png', kind: 'image', projectId: null });
  expect((await fetch(`${base}/${image.id}/video-metadata`)).status).toBe(400);
  expect((await fetch(`${base}/missing/video-metadata`)).status).toBe(404);
  const invalid = await ctx.assets.saveUpload({ buffer: Buffer.from('invalid'), mime: 'video/mp4', kind: 'video', projectId: null });
  expect((await fetch(`${base}/${invalid.id}/video-metadata`)).status).toBe(422);
});
