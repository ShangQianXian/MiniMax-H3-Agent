/**
 * 素材路由：浏览器直传二进制、登记公网 URL、回放本地文件、转存产物。
 *
 * 说明：刻意不走 multipart，浏览器直接 POST 原始二进制，元数据放 query string。
 * 这样服务端不需要引入 multer 之类的依赖，且天然支持大文件流式落盘。
 */
import { Router, raw, type Request, type Response } from 'express';
import { MEDIA_LIMITS } from '@h3/shared';
import type { AppContext } from '../context.ts';
import { param, queryString } from '../http.ts';
import { VideoEditError, VideoEditService } from '../services/video-edit.ts';

const KIND_LIMITS: Record<string, number> = {
  image: MEDIA_LIMITS.image.maxBytes,
  video: MEDIA_LIMITS.video.maxBytes,
  audio: MEDIA_LIMITS.audio.maxBytes,
};

export function createAssetRouter(ctx: AppContext): Router {
  const router = Router();
  const videoEdit = new VideoEditService(ctx.assets);
  const editError = (error: unknown, res: Response) => {
    res.status(error instanceof VideoEditError ? error.status : 500).json({
      error: error instanceof VideoEditError ? error.message : '视频处理失败，请检查文件是否完整后重试。',
    });
  };

  router.get('/:id/video-metadata', async (req, res) => {
    try { res.json({ metadata: await videoEdit.metadata(param(req, 'id')) }); }
    catch (error) { editError(error, res); }
  });

  router.get('/:id/frames/:frame', async (req, res) => {
    try {
      const frame = await videoEdit.frame(param(req, 'id'), Number(param(req, 'frame')));
      res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' }).send(frame);
    } catch (error) { editError(error, res); }
  });

  router.post('/:id/trim', async (req, res) => {
    try {
      res.json(await videoEdit.trim(param(req, 'id'), {
        startFrame: req.body?.startFrame, endFrame: req.body?.endFrame,
      }));
    } catch (error) { editError(error, res); }
  });

  router.get('/:id/frame-sheets/:page', async (req, res) => {
    try {
      const sheet = await videoEdit.frameSheet(param(req, 'id'), Number(param(req, 'page')));
      res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' }).send(sheet);
    } catch (error) { editError(error, res); }
  });

  router.post('/:id/export-frames', async (req, res) => {
    try { res.json(await videoEdit.exportFrames(param(req, 'id'), { frames: req.body?.frames })); }
    catch (error) { editError(error, res); }
  });

  router.get('/', (req: Request, res: Response) => {
    const projectId = queryString(req, 'projectId');
    res.json({ items: ctx.assets.list(projectId) });
  });

  /**
   * 浏览器直传：POST /api/assets/upload?kind=image&projectId=xxx&name=a.png
   * body 为原始二进制。
   */
  router.post(
    '/upload',
    raw({ type: () => true, limit: ctx.config.maxUploadBytes }),
    async (req: Request, res: Response) => {
      const kind = queryString(req, 'kind') ?? '';
      if (!KIND_LIMITS[kind]) {
        res.status(400).json({ error: 'kind 必须是 image / video / audio 之一。' });
        return;
      }
      const buffer = req.body as Buffer;
      if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
        res.status(400).json({ error: '请求体为空。' });
        return;
      }
      if (buffer.byteLength > KIND_LIMITS[kind]!) {
        res.status(413).json({
          error: `文件 ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB 超过该类素材上限 ${(
            KIND_LIMITS[kind]! /
            1024 /
            1024
          ).toFixed(0)} MB。`,
        });
        return;
      }

      const mime = queryString(req, 'mime') || String(req.headers['content-type'] ?? '').split(';')[0] || '';
      const projectId = queryString(req, 'projectId');
      const durationRaw = queryString(req, 'durationSec');

      try {
        const asset = await ctx.assets.saveUpload({
          buffer,
          mime,
          kind,
          projectId: projectId && projectId.length > 0 ? projectId : null,
          ...(queryString(req, 'name') ? { originalName: queryString(req, 'name')! } : {}),
          ...(durationRaw ? { durationSec: Number(durationRaw) } : {}),
        });
        res.json({ asset, dataUri: `data:${mime};base64,${buffer.toString('base64')}` });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    },
  );

  /** 只登记公网 URL，不下载。 */
  router.post('/remote', (req: Request, res: Response) => {
    const url = String(req.body?.url ?? '').trim();
    const kind = String(req.body?.kind ?? '');
    if (!/^https?:\/\//i.test(url) && !url.startsWith('mm_file://')) {
      res.status(400).json({ error: '地址必须是公网 URL 或 mm_file://{file_id}。' });
      return;
    }
    if (!KIND_LIMITS[kind]) {
      res.status(400).json({ error: 'kind 必须是 image / video / audio 之一。' });
      return;
    }
    const asset = ctx.assets.registerRemote({
      url,
      kind,
      projectId: typeof req.body?.projectId === 'string' && req.body.projectId ? req.body.projectId : null,
      ...(typeof req.body?.mime === 'string' ? { mime: req.body.mime } : {}),
      ...(typeof req.body?.bytes === 'number' ? { bytes: req.body.bytes } : {}),
      ...(typeof req.body?.name === 'string' ? { originalName: req.body.name } : {}),
    });
    res.json({ asset });
  });

  /** 按本地落盘路径反查素材（页面刷新后恢复产物预览用）。 */
  router.get('/by-path', (req: Request, res: Response) => {
    const localPath = queryString(req, 'localPath') ?? '';
    if (localPath.length === 0) {
      res.status(400).json({ error: '缺少 localPath 参数。' });
      return;
    }
    const asset = ctx.assets.getByLocalPath(localPath);
    if (!asset) {
      res.status(404).json({ error: '没有对应的本地素材。' });
      return;
    }
    res.json({ asset });
  });

  /** 回放本地文件，支持 Range（视频预览拖拽进度条必需）。 */
  router.get('/:id/content', (req: Request, res: Response) => {
    const info = ctx.assets.stat(param(req, 'id'));
    if (!info) {
      res.status(404).json({ error: '素材不存在或未落盘。' });
      return;
    }

    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? Number.parseInt(match[1], 10) : 0;
      const end = match?.[2] ? Number.parseInt(match[2], 10) : info.bytes - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
        res.status(416).set('Content-Range', `bytes */${info.bytes}`).end();
        return;
      }
      res.status(206);
      res.set({
        'Content-Type': info.mime,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${info.bytes}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=3600',
      });
      ctx.assets.createStream(info.path, { start, end }).pipe(res);
      return;
    }

    res.set({
      'Content-Type': info.mime,
      'Content-Length': String(info.bytes),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    });
    ctx.assets.createStream(info.path).pipe(res);
  });

  router.delete('/:id', (req: Request, res: Response) => {
    const asset = ctx.assets.get(param(req, 'id'));
    if (!asset) {
      res.status(404).json({ error: '素材不存在。' });
      return;
    }
    ctx.db.prepare('DELETE FROM assets WHERE id = ?').run(asset.id);
    res.json({ ok: true });
  });

  return router;
}
