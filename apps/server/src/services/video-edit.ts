import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import ffprobe from '@ffprobe-installer/ffprobe';
import { FRAME_SHEET_COLUMNS, FRAME_SHEET_SIZE, type VideoFrameExportRequest, type VideoMetadata, type VideoTrimRequest } from '@h3/shared';
import type { AssetService } from './assets.ts';

const exec = promisify(execFile);
export const ffmpegPath = process.env.FFMPEG_PATH || ffmpeg.path;
const ffprobePath = process.env.FFPROBE_PATH || ffprobe.path;
const processOptions = { windowsHide: true, timeout: 180_000, maxBuffer: 32 * 1024 * 1024 };

export class VideoEditError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) { super(message); this.status = status; }
}

type Probe = VideoMetadata & { startTime: number };
type Stream = { codec_type: string; width?: number; height?: number; avg_frame_rate?: string;
  duration?: string; tags?: { rotate?: string }; side_data_list?: Array<{ rotation?: number }> };

/** Decode actual frame timestamps instead of deriving frame counts from rounded duration × FPS. */
export async function probeVideo(path: string): Promise<Probe> {
  try {
    const [streamsResult, framesResult] = await Promise.all([
      exec(ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', path], processOptions),
      exec(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_frames',
        '-show_entries', 'frame=best_effort_timestamp_time,pkt_duration_time,duration_time', '-of', 'json', path], processOptions),
    ]);
    const streams = (JSON.parse(streamsResult.stdout) as { streams: Stream[] }).streams;
    const video = streams.find((s) => s.codec_type === 'video');
    const frames = (JSON.parse(framesResult.stdout) as { frames: Array<{
      best_effort_timestamp_time?: string; pkt_duration_time?: string; duration_time?: string;
    }> }).frames;
    const times = frames.map((f) => Number(f.best_effort_timestamp_time));
    const [numerator, denominator] = (video?.avg_frame_rate ?? '0/1').split('/').map(Number);
    const fps = numerator! / denominator!;
    if (!video?.width || !video.height || !times.length || times.length > 100_000 ||
      !Number.isFinite(fps) || fps <= 0 || times.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= times[i - 1]!))) {
      throw new Error('invalid video');
    }
    const startTime = times[0]!;
    const frameTimes = times.map((t) => t - startTime);
    const last = frames.at(-1)!;
    const lastDuration = Number(last.duration_time ?? last.pkt_duration_time);
    const durationSec = frameTimes.at(-1)! + (lastDuration > 0 ? lastDuration : 1 / fps);
    const rotation = Number(video.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0);
    const rotated = Math.abs(rotation) % 180 === 90;
    return { width: rotated ? video.height : video.width, height: rotated ? video.width : video.height,
      fps, frameCount: frames.length, durationSec, frameTimes, startTime,
      hasAudio: streams.some((s) => s.codec_type === 'audio') };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new VideoEditError('找不到视频处理工具，请重新安装项目依赖或配置 FFMPEG_PATH / FFPROBE_PATH。', 503);
    }
    throw new VideoEditError('无法解析视频帧，请使用完整、可播放的视频文件。模拟模式的占位视频不能剪辑。');
  }
}

export class VideoEditService {
  private cache = new Map<string, Promise<Probe>>();
  private sheets = new Map<string, Promise<Buffer>>();
  private active = 0;
  private waiting: Array<() => void> = [];
  private assets: AssetService;
  constructor(assets: AssetService) { this.assets = assets; }

  private source(id: string) {
    const asset = this.assets.get(id);
    if (!asset) throw new VideoEditError('视频素材不存在。', 404);
    if (asset.kind !== 'video' && !asset.mime.startsWith('video/')) throw new VideoEditError('该素材不是视频。', 400);
    const file = this.assets.stat(id);
    if (!file) throw new VideoEditError('请先将生成的视频转存到本地再剪辑。', 409);
    return { asset, file };
  }

  private async limited<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 2) {
      if (this.waiting.length >= 32) throw new VideoEditError('视频处理繁忙，请稍后重试。', 429);
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else this.active++;
    try { return await work(); } finally {
      const next = this.waiting.shift();
      if (next) next(); else this.active--;
    }
  }

  async metadata(id: string): Promise<Probe> {
    const { file } = this.source(id);
    const info = await stat(file.path);
    const key = `${id}:${info.size}:${info.mtimeMs}`;
    let pending = this.cache.get(key);
    if (!pending) {
      if (this.cache.size >= 32) this.cache.delete(this.cache.keys().next().value!);
      pending = this.limited(() => probeVideo(file.path));
      this.cache.set(key, pending);
      pending.catch(() => this.cache.delete(key));
    }
    return pending;
  }

  async frame(id: string, index: number): Promise<Buffer> {
    const { file } = this.source(id);
    const metadata = await this.metadata(id);
    if (!Number.isSafeInteger(index) || index < 0 || index >= metadata.frameCount) {
      throw new VideoEditError('帧编号超出视频范围。', 400);
    }
    return this.limited(async () => {
      const result = await exec(ffmpegPath, ['-v', 'error', '-nostdin', '-i', file.path,
        '-vf', `select=eq(n\\,${index})`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
      { ...processOptions, encoding: 'buffer' });
      return result.stdout;
    });
  }

  async frameSheet(id: string, page: number): Promise<Buffer> {
    const { file } = this.source(id);
    const metadata = await this.metadata(id);
    if (!Number.isSafeInteger(page) || page < 0 || page * FRAME_SHEET_SIZE >= metadata.frameCount) {
      throw new VideoEditError('缩略图范围超出视频总帧数。', 400);
    }
    const info = await stat(file.path);
    const key = `${id}:${info.size}:${info.mtimeMs}:${page}`;
    let pending = this.sheets.get(key);
    if (!pending) {
      // Bounded, shared cache prevents one decoder process per thumbnail or browser request.
      if (this.sheets.size >= 32) this.sheets.delete(this.sheets.keys().next().value!);
      const start = page * FRAME_SHEET_SIZE;
      pending = this.limited(async () => {
        const filter = `trim=start_frame=${start}:end_frame=${start + FRAME_SHEET_SIZE},setpts=PTS-STARTPTS,` +
          `scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,setsar=1,` +
          `tile=${FRAME_SHEET_COLUMNS}x${FRAME_SHEET_SIZE / FRAME_SHEET_COLUMNS}`;
        const result = await exec(ffmpegPath, ['-v', 'error', '-nostdin', '-i', file.path,
          '-vf', filter, '-frames:v', '1', '-an', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '3', 'pipe:1'],
        { ...processOptions, encoding: 'buffer' });
        if (!result.stdout.length) throw new VideoEditError('缩略图读取失败，请重试。');
        return result.stdout;
      });
      this.sheets.set(key, pending);
      pending.catch(() => this.sheets.delete(key));
    }
    return pending;
  }

  async exportFrames(id: string, request: VideoFrameExportRequest) {
    const { asset, file } = this.source(id);
    if (!Array.isArray(request.frames) || !request.frames.length || request.frames.length > 100_000 ||
      request.frames.some((n) => !Number.isSafeInteger(n) || n < 0)) {
      throw new VideoEditError('请选择至少一帧，帧编号必须是有效整数。', 400);
    }
    const metadata = await this.metadata(id);
    const frames = [...new Set(request.frames)].sort((a, b) => a - b);
    if (frames.at(-1)! >= metadata.frameCount) throw new VideoEditError('所选帧超出视频总帧数。', 400);
    const runs: Array<{ start: number; end: number }> = [];
    for (const frame of frames) {
      const last = runs.at(-1);
      if (last && frame === last.end + 1) last.end = frame;
      else runs.push({ start: frame, end: frame });
    }
    if (runs.length > 2000) throw new VideoEditError('所选帧过于分散，请分批导出（每次最多 2000 个不连续片段）。', 400);
    return this.limited(async () => {
      const directory = await mkdtemp(join(tmpdir(), 'h3-frames-'));
      try {
        const output = join(directory, 'frames.mp4');
        const script = join(directory, 'select.txt');
        const expression = runs.map(({ start, end }) => start === end ? `eq(n,${start})` : `between(n,${start},${end})`).join('+');
        // A script avoids Windows command-line length limits for scattered selections.
        await writeFile(script, `select='${expression}',setpts=N/(${metadata.fps}*TB)`);
        await exec(ffmpegPath, ['-v', 'error', '-nostdin', '-i', file.path, '-map', '0:v:0',
          '-filter_script:v', script, '-an', '-vsync', '0', '-r', String(metadata.fps),
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
          '-pix_fmt', metadata.width % 2 || metadata.height % 2 ? 'yuv444p' : 'yuv420p',
          '-movflags', '+faststart', output], processOptions);
        const result = await probeVideo(output);
        if (result.frameCount !== frames.length || result.width !== metadata.width || result.height !== metadata.height) {
          throw new VideoEditError('导出视频的帧数或尺寸校验失败，请重试。');
        }
        const buffer = await readFile(output);
        const saved = await this.assets.saveUpload({ buffer, mime: 'video/mp4', kind: 'video', projectId: asset.projectId,
          originalName: `${asset.originalName.replace(/\.[^.]+$/, '')}_选帧${frames.length}帧.mp4`, durationSec: result.durationSec });
        return { asset: saved, metadata: result, dataUri: `data:video/mp4;base64,${buffer.toString('base64')}` };
      } finally { await rm(directory, { recursive: true, force: true }); }
    });
  }

  async trim(id: string, range: VideoTrimRequest) {
    const { asset, file } = this.source(id);
    const { startFrame, endFrame } = range;
    if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || startFrame < 0 || endFrame <= startFrame) {
      throw new VideoEditError('起止帧必须为整数，且结束帧必须大于起始帧。', 400);
    }
    const metadata = await this.metadata(id);
    if (endFrame > metadata.frameCount) throw new VideoEditError('剪辑范围超出视频总帧数。', 400);
    return this.limited(async () => {
      const directory = await mkdtemp(join(tmpdir(), 'h3-trim-'));
      try {
        const output = join(directory, 'clip.mp4');
        const start = metadata.frameTimes[startFrame]!;
        const end = metadata.frameTimes[endFrame] ?? metadata.durationSec;
        const absoluteStart = start + metadata.startTime;
        const absoluteEnd = end + metadata.startTime;
        const args = ['-v', 'error', '-nostdin', '-copyts', '-i', file.path,
          '-map', '0:v:0', '-vf', `trim=start_frame=${startFrame}:end_frame=${endFrame},setpts=PTS-STARTPTS`,
          '-vsync', '0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
          '-pix_fmt', metadata.width % 2 || metadata.height % 2 ? 'yuv444p' : 'yuv420p'];
        if (metadata.hasAudio) args.push('-map', '0:a:0', '-af',
          `atrim=start=${absoluteStart}:end=${absoluteEnd},asetpts=PTS-${absoluteStart}/TB`, '-c:a', 'aac', '-b:a', '192k');
        args.push('-t', String(end - start), '-movflags', '+faststart', output);
        await exec(ffmpegPath, args, processOptions);
        const result = await probeVideo(output);
        if (result.frameCount !== endFrame - startFrame || result.width !== metadata.width || result.height !== metadata.height) {
          throw new VideoEditError('导出视频的帧数或尺寸校验失败，请重试。');
        }
        const buffer = await readFile(output);
        const saved = await this.assets.saveUpload({ buffer, mime: 'video/mp4', kind: 'video', projectId: asset.projectId,
          originalName: `${asset.originalName.replace(/\.[^.]+$/, '')}_帧${startFrame + 1}-${endFrame}.mp4`,
          durationSec: result.durationSec });
        return { asset: saved, metadata: result, dataUri: `data:video/mp4;base64,${buffer.toString('base64')}` };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
}
