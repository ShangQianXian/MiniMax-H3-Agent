/**
 * H3 接口代理路由。
 * 所有请求经由后端转发：密钥只留在服务端，前端零 CORS 问题，并可做二次校验与请求体大小检查。
 */
import { Router, type Request, type Response } from 'express';
import {
  zTaskStatus,
  zTaskType,
  validateApiRequest,
  validateContentComposition,
  assembleContent,
  type AssembleInput,
  type ContentItem,
  type FrameSlot,
  type MediaSlot,
  type TaskTypeKey,
} from '@h3/shared';
import type { AppContext } from '../context.ts';
import { ApiError, MissingApiKeyError, normalizeTask } from '../services/minimax.ts';
import { toFriendlyIssues } from '../issues.ts';
import { param, queryNumber, queryString } from '../http.ts';

/** 请求里已经带了 content，这里把它还原成 AssembleResult 以便复用组成层校验。 */
function assembledFromContent(content: ContentItem[]) {
  const frames: FrameSlot[] = [];
  const media: MediaSlot[] = [];
  let text: AssembleInput['text'] = null;

  for (const item of content) {
    if (item.type === 'text') {
      text = { text: item.text ?? '' };
      continue;
    }
    const url = item.image_url?.url ?? item.video_url?.url ?? item.audio_url?.url ?? '';
    const kind: 'image' | 'video' | 'audio' =
      item.type === 'image_url' ? 'image' : item.type === 'video_url' ? 'video' : 'audio';
    const ref = { id: `up-${frames.length + media.length}`, kind, source: 'remote' as const, url, mime: '' };
    if (item.role === 'first_frame' || item.role === 'last_frame') {
      frames.push({ ref, role: item.role });
    } else {
      media.push({ ref, ...(item.role ? { role: item.role } : {}) });
    }
  }

  return assembleContent({ text, frames, media });
}

/**
 * 创建任务：先做服务端权威校验（不产生任何费用），再调用上游接口，最后登记到本地库。
 */
export function createH3Router(ctx: AppContext): Router {
  const router = Router();

  /** 探活 + Key 可用性验证（用任务列表接口，不产生费用）。 */
  router.get('/health', async (_req: Request, res: Response) => {
    const summary = {
      ok: true,
      mock: ctx.client.mock,
      hasApiKey: ctx.client.hasKey,
      baseUrl: ctx.config.baseUrl,
      watchedTasks: ctx.poller.watchedCount,
      counts: ctx.tasks.counts(),
    };
    if (!ctx.client.hasKey || ctx.client.mock) {
      res.json({ ...summary, apiReachable: null });
      return;
    }
    try {
      // 用任务列表同时完成两件事：验证 Key 可用、把最近的远端任务同步进本地库
      const remote = await ctx.client.listTasks({ page_num: 1, page_size: 20 });
      let synced = 0;
      for (const task of remote.items) {
        if (ctx.tasks.syncFromApi(task)) synced += 1;
      }
      res.json({
        ...summary,
        apiReachable: true,
        remoteTotal: remote.total,
        synced,
      });
    } catch (error) {
      const detail = error instanceof ApiError ? error.toJSON() : { hint: (error as Error).message };
      res.json({ ...summary, apiReachable: false, apiError: detail });
    }
  });

  /* ─────────────  创建任务  ───────────── */

  router.post('/tasks', async (req: Request, res: Response) => {
    const taskType = typeof req.body?.taskType === 'string' ? req.body.taskType : 'generation';
    const payload: unknown = req.body?.request ?? req.body?.payload;

    if (!payload || typeof payload !== 'object') {
      res.status(400).json({ error: '缺少 request 字段。' });
      return;
    }

    const request = payload as Record<string, unknown>;
    const textItem = Array.isArray(request.content)
      ? (request.content as Array<{ type?: string; text?: string }>).find((item) => item.type === 'text')
      : undefined;
    const derivedPrompt = typeof textItem?.text === 'string' ? textItem.text : '';

    const context = {
      projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : null,
      workflowId: typeof req.body?.workflowId === 'string' ? req.body.workflowId : null,
      nodeId: typeof req.body?.nodeId === 'string' ? req.body.nodeId : null,
      // 客户端没显式传 prompt 时从请求体里推导，保证任务详情始终能看到当时用的提示词
      promptRaw: typeof req.body?.promptRaw === 'string' && req.body.promptRaw ? req.body.promptRaw : derivedPrompt,
      promptFinal:
        typeof req.body?.promptFinal === 'string' && req.body.promptFinal ? req.body.promptFinal : derivedPrompt,
    };

    // content 组成层的二次校验（互斥、数量、总时长、总体积）
    const content = Array.isArray(request.content) ? (request.content as ContentItem[]) : [];
    if (content.length > 0) {
      const composition = validateContentComposition(assembledFromContent(content));
      if (!composition.ok) {
        res
          .status(400)
          .json({ error: '请求参数未通过校验。', issues: toFriendlyIssues(composition.errors) });
        return;
      }
    }

    const bodyBytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
    if (bodyBytes > ctx.config.maxUploadBytes) {
      res.status(413).json({
        error: `请求体 ${(bodyBytes / 1024 / 1024).toFixed(1)} MB 超过 64 MB 上限，请改用公网 URL 或压缩素材。`,
      });
      return;
    }

    // 服务端权威校验（schema + prompt + 模型能力 + 场景规则）。
    // 放在调用上游之前，保证「参数错误」不会被「未配置 API Key」掩盖，也不会白跑一次网络请求。
    const preflight = validateApiRequest(taskType as TaskTypeKey, request);
    if (!preflight.ok) {
      res.status(400).json({ error: '请求参数未通过校验。', issues: toFriendlyIssues(preflight.issues) });
      return;
    }

    try {
      const result =
        taskType === 'h3_context_ir'
          ? await ctx.client.createContextIR(request as never)
          : taskType === 'regeneration'
            ? await ctx.client.createRegeneration(request as never)
            : await ctx.client.createVideoGeneration(request as never);

      // 立刻登记到本地，前端马上就能看到这条任务
      const nowTs = Math.floor(Date.now() / 1000);
      const record = normalizeTask(
        {
          id: result.task_id,
          status: 'queued',
          model: String(request.model ?? ''),
          task_type: taskType as never,
          modality: taskType === 'h3_context_ir' ? 'text' : 'video',
          resolution: String(request.resolution ?? ''),
          duration: typeof request.duration === 'number' ? request.duration : undefined,
          ratio: typeof request.ratio === 'string' ? request.ratio : '',
          created_at: nowTs,
          updated_at: nowTs,
        },
        { ...context, request },
      );

      const saved = ctx.tasks.upsert({
        ...record,
        // Context-IR 的 promptRaw 才是原始输入；增强结果要等任务成功后才回填到 promptFinal
        promptFinal: taskType === 'h3_context_ir' ? context.promptRaw : context.promptFinal,
        promptRaw: context.promptRaw,
      });

      ctx.poller.watch(result.task_id, 'queued');
      res.json({ taskId: result.task_id, task: saved });
    } catch (error) {
      handleUpstreamError(error, res);
    }
  });

  /* ─────────────  列表与查询  ───────────── */

  router.get('/tasks', async (req: Request, res: Response) => {
    const pageNum = queryNumber(req, 'page_num', 1);
    const pageSize = queryNumber(req, 'page_size', 20);
    const statusRaw = queryString(req, 'filter.status');
    const typeRaw = queryString(req, 'filter.task_type');
    const useRemote = queryString(req, 'remote') === '1';

    const statusParsed = statusRaw ? zTaskStatus.safeParse(statusRaw) : null;
    const typeParsed = typeRaw ? zTaskType.safeParse(typeRaw) : null;

    if (useRemote) {
      if (!ctx.client.hasKey && !ctx.client.mock) {
        res.status(400).json({ error: new MissingApiKeyError().message });
        return;
      }
      try {
        const remote = await ctx.client.listTasks({
          page_num: pageNum,
          page_size: pageSize,
          ...(statusParsed?.success ? { 'filter.status': statusParsed.data } : {}),
          ...(typeParsed?.success ? { 'filter.task_type': typeParsed.data } : {}),
        });
        // 远端任务顺手同步进本地库，让详情有 prompt 上下文
        for (const task of remote.items) ctx.tasks.syncFromApi(task);
        res.json({ ...remote, source: 'remote' });
      } catch (error) {
        handleUpstreamError(error, res);
      }
      return;
    }

    const projectId = queryString(req, 'projectId');
    const local = ctx.tasks.list({
      pageNum,
      pageSize,
      ...(statusParsed?.success ? { status: statusParsed.data } : {}),
      ...(typeParsed?.success ? { taskType: typeParsed.data } : {}),
      ...(projectId ? { projectId } : {}),
    });
    res.json({ ...local, source: 'local' });
  });

  router.get('/tasks/:taskId', async (req: Request, res: Response) => {
    const taskId = param(req, 'taskId');
    const local = ctx.tasks.get(taskId);
    const refresh = queryString(req, 'refresh') === '1';

    if (!refresh && local) {
      res.json({ task: local, source: 'local' });
      return;
    }

    try {
      const remote = await ctx.client.queryTask(taskId);
      const synced = ctx.tasks.syncFromApi(remote.task);
      if (remote.task.status === 'queued' || remote.task.status === 'running') {
        ctx.poller.watch(taskId, remote.task.status);
      }
      res.json({ task: synced ?? remote.task, remote: remote.task, source: 'remote' });
    } catch (error) {
      // 远端查不到（超出 7 天窗口或已删除）时仍返回本地缓存
      if (local && error instanceof ApiError) {
        res.json({
          task: local,
          source: 'local',
          stale: true,
          notice: '远端查询失败：任务记录只保留 7 天，或该任务已被删除。以下是本地缓存。',
        });
        return;
      }
      // 本地和远端都没有这条记录
      if (!local && error instanceof ApiError) {
        res.status(404).json({
          error: '找不到该任务。它可能已被删除，或创建时间已超出 7 天的查询窗口。',
          detail: error.toJSON(),
        });
        return;
      }
      handleUpstreamError(error, res);
    }
  });

  /** 手动触发一次轮询。 */
  router.post('/tasks/:taskId/refresh', async (req: Request, res: Response) => {
    const taskId = param(req, 'taskId');
    try {
      await ctx.poller.pollNow(taskId);
      res.json({ task: ctx.tasks.get(taskId) });
    } catch (error) {
      handleUpstreamError(error, res);
    }
  });

  /**
   * 取消（仅 queued）或删除（仅 succeeded / failed）。
   * 状态机来自 docs/api/4.取消或删除任务.md：
   *   queued → cancelled（无扣费）
   *   succeeded / failed → deleted
   *   running / cancelled → 不可操作，接口会报错
   */
  router.delete('/tasks/:taskId', async (req: Request, res: Response) => {
    const taskId = param(req, 'taskId');
    const local = ctx.tasks.get(taskId);
    const status = local?.status;

    if (status === 'running') {
      res.status(400).json({
        error: '任务正在运行中，无法取消。MiniMax 只在排队阶段（queued）允许取消。',
      });
      return;
    }
    if (status === 'cancelled') {
      res.status(400).json({ error: '任务已取消，不可重复操作。' });
      return;
    }

    try {
      const result = await ctx.client.deleteTask(taskId);
      if (result.action === 'cancelled') {
        const existing = ctx.tasks.get(taskId);
        if (existing) ctx.tasks.upsert({ ...existing, status: 'cancelled' });
        ctx.poller.unwatch(taskId);
      } else {
        ctx.tasks.delete(taskId);
        ctx.poller.unwatch(taskId);
      }
      res.json(result);
    } catch (error) {
      handleUpstreamError(error, res);
    }
  });

  /** 把限时产物下载链接转存到本地。 */
  router.post('/tasks/:taskId/artifact', async (req: Request, res: Response) => {
    const taskId = param(req, 'taskId');
    const local = ctx.tasks.get(taskId);
    if (!local) {
      res.status(404).json({ error: '本地没有这条任务记录。' });
      return;
    }
    if (!local.contentUrl) {
      res.status(400).json({ error: '该任务暂无可下载的产物（可能仍在运行或已失败）。' });
      return;
    }

    try {
      const asset = await ctx.assets.fetchArtifact({
        url: local.contentUrl,
        taskId,
        projectId: local.projectId,
      });
      ctx.tasks.setLocalPath(taskId, asset.localPath);
      res.json({ asset, task: ctx.tasks.get(taskId) });
    } catch (error) {
      res.status(502).json({ error: (error as Error).message });
    }
  });

  /** 取 Context-IR 的增强提示词产物。 */
  router.get('/tasks/:taskId/prompt', async (req: Request, res: Response) => {
    const taskId = param(req, 'taskId');
    const local = ctx.tasks.get(taskId);
    if (!local) {
      res.status(404).json({ error: '本地没有这条任务记录。' });
      return;
    }
    if (local.taskType !== 'h3_context_ir') {
      res.status(400).json({ error: '该任务不是 H3-Context-IR 任务，没有增强提示词产物。' });
      return;
    }
    if (local.status !== 'succeeded') {
      res.status(400).json({
        error: `任务当前状态为 ${local.status}，增强提示词要等任务成功后才有。`,
      });
      return;
    }

    const response = local.response as { content?: { prompt?: string } } | undefined;
    const enhanced = response?.content?.prompt;
    if (!enhanced) {
      res.status(400).json({ error: '该任务没有增强提示词产物。' });
      return;
    }
    res.json({ taskId, prompt: enhanced, rawPrompt: local.promptRaw });
  });

  return router;
}

function handleUpstreamError(error: unknown, res: Response): void {
  if (error instanceof MissingApiKeyError) {
    res.status(400).json({ error: error.message, code: 'missing_api_key' });
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status === 0 ? 502 : error.status).json({
      error: error.friendly.hint,
      detail: error.toJSON(),
    });
    return;
  }
  res.status(500).json({ error: (error as Error).message });
}
