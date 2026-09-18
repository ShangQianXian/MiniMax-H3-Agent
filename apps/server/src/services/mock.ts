/**
 * MOCK 模式：在没有真实 API Key 的情况下回放一套符合接口契约的响应，
 * 用于离线开发与端到端验证（不消耗额度、不产生费用）。
 *
 * 打开方式：.env 里 MOCK_H3=1，或在界面「设置」里勾选 MOCK 模式。
 */
import type {
  CreateTaskResponse,
  DeleteTaskResponse,
  ListTasksQuery,
  ListTasksResponse,
  QueryTaskResponse,
  VideoTask,
} from '@h3/shared';

/** 160 字节的最小合法 MP4（ftyp + moov/mvhd + mdat），用于产物转存的下载源。 */
export const MOCK_ARTIFACT_BYTES = Buffer.from(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAB0bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAE4gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAxtZGF0AAAAAA==',
  'base64',
);

export const MOCK_CDN_PREFIX = 'https://mock.h3.local/';

interface MockTaskState {
  task: VideoTask;
  polls: number;
  /** 第几次轮询后进入 succeeded */
  succeedAtPoll: number;
  promptRaw: string;
  /** 创建时的输入素材量，任务成功时用来生成符合口径的 usage */
  metrics: { imageCount: number; videoCount: number; audioCount: number; duration: number };
}

const states = new Map<string, MockTaskState>();

let sequence = 0;

function nextTaskId(): string {
  sequence += 1;
  const base = Math.floor(Date.now() / 1000) * 1000;
  return String(base + sequence).padStart(15, '0');
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

const MOCK_ENHANCED_PROMPT = [
  'integrated_multimodal_description: [Shot 1] Cinematic wide shot with a slow push-in on a lone figure standing centre frame against a colossal curved observation window. Sleek metallic consoles flank the frame, emitting soft cyan light; beyond the glass a massed fleet assembles against a deep-purple nebula.',
  '[Shot 2] At 00:02.800 the camera cuts to a medium close-up in profile as a blinding cyan-white flash bursts through the window, casting harsh overexposed light across the subject\'s face before snapping into deep shadow.',
  'overall_soundscape: Deep low-frequency engine thrum, rhythmic console beeps, then a sudden sub-bass boom and metallic clatter dropping into a stark mechanical hum.',
  'non_diegetic_music: Symphonic brass and string crescendo cut off abruptly into a single sustained low cello note.',
].join('\n');

export const mockSimulator = {
  /** 需要多少次轮询才完成任务（可由测试调小） */
  pollsToSucceed: 2,

  create(
    taskType: 'generation' | 'h3_context_ir' | 'regeneration',
    request: Record<string, unknown>,
  ): CreateTaskResponse {
    const id = nextTaskId();
    const content = Array.isArray(request.content) ? (request.content as Array<Record<string, unknown>>) : [];
    const textItem = content.find((item) => item.type === 'text');
    const promptRaw = typeof textItem?.text === 'string' ? textItem.text : '';
    const imageCount = content.filter((item) => item.type === 'image_url').length;
    const videoCount = content.filter((item) => item.type === 'video_url').length;
    const audioCount = content.filter((item) => item.type === 'audio_url').length;

    const duration = typeof request.duration === 'number' ? request.duration : 5;

    const task: VideoTask = {
      id,
      model: typeof request.model === 'string' ? request.model : 'MiniMax-H3',
      status: 'queued',
      created_at: nowSeconds(),
      updated_at: nowSeconds(),
      resolution: typeof request.resolution === 'string' ? request.resolution : undefined,
      duration,
      ratio: typeof request.ratio === 'string' ? request.ratio : 'adaptive',
      task_type: taskType,
      modality: taskType === 'h3_context_ir' ? 'text' : 'video',
      usage: {},
    };

    states.set(id, {
      task,
      polls: 0,
      succeedAtPoll: mockSimulator.pollsToSucceed,
      promptRaw,
      metrics: { imageCount, videoCount, audioCount, duration },
    });

    return { task_id: id };
  },

  query(taskId: string): QueryTaskResponse | null {
    const state = states.get(taskId);
    if (!state) return null;

    state.polls += 1;
    const metrics = state.metrics;

    if (state.polls === 1) {
      state.task = { ...state.task, status: 'running', updated_at: nowSeconds() };
    } else if (state.polls >= state.succeedAtPoll) {
      const isContextIR = state.task.task_type === 'h3_context_ir';
      const isRegeneration = state.task.task_type === 'regeneration';

      if (isContextIR) {
        const promptTokens = Math.round(state.promptRaw.length / 1.6) + 5200;
        const completionTokens = Math.round(promptTokens * 0.6);
        state.task = {
          ...state.task,
          status: 'succeeded',
          updated_at: nowSeconds(),
          content: { prompt: MOCK_ENHANCED_PROMPT },
          usage: {
            total_tokens: promptTokens + completionTokens,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
          },
        };
      } else {
        const outSeconds = state.task.duration ?? 5;
        const inputVideoSeconds = metrics.videoCount > 0 ? metrics.videoCount * 3 : 0;
        const inputImageCount = isRegeneration ? 0 : metrics.imageCount;
        const fidelity = isRegeneration ? '2k' : (state.task.resolution ?? '768p').toLowerCase();
        state.task = {
          ...state.task,
          status: 'succeeded',
          updated_at: nowSeconds(),
          content: { url: `${MOCK_CDN_PREFIX}${fidelity}-${taskId}.mp4` },
          resolution: isRegeneration ? '2K' : state.task.resolution,
          usage: {
            total_seconds: inputVideoSeconds + outSeconds,
            input_seconds: inputVideoSeconds,
            output_seconds: outSeconds,
            input_image_count: inputImageCount,
            ...(metrics.audioCount > 0 ? { input_audio_seconds: metrics.audioCount * 4 } : {}),
            total_tokens: outSeconds * 52000 + inputImageCount * 5200,
            prompt_tokens: inputImageCount * 5200,
            completion_tokens: outSeconds * 52000,
          },
        };
      }
    }

    return { task: state.task };
  },

  list(query: ListTasksQuery): ListTasksResponse {
    let items = [...states.values()].map((state) => state.task);
    const status = query['filter.status'];
    if (status) items = items.filter((task) => task.status === status);
    const taskType = query['filter.task_type'];
    if (taskType) items = items.filter((task) => task.task_type === taskType);
    const model = query['filter.model'];
    if (model) items = items.filter((task) => task.model === model);

    const total = items.length;
    const pageSize = query.page_size ?? 20;
    const pageNum = query.page_num ?? 1;
    return { items: items.slice((pageNum - 1) * pageSize, pageNum * pageSize), total };
  },

  remove(taskId: string): DeleteTaskResponse | null {
    const state = states.get(taskId);
    if (!state) return null;
    const status = state.task.status;
    if (status === 'running' || status === 'cancelled') return null;

    if (status === 'queued') {
      state.task = { ...state.task, status: 'cancelled' };
      return { task_id: taskId, action: 'cancelled', status: 'cancelled' };
    }
    states.delete(taskId);
    return { task_id: taskId, action: 'deleted', status: 'deleted' };
  },

  reset(): void {
    states.clear();
    sequence = 0;
  },
};
