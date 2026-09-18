/**
 * 工作流图与接口参数的 zod schema。
 * 前端表单与后端 API 共用同一份定义，保证「前端拦住的东西后端也一定拦得住」。
 */
import { z } from 'zod';
import {
  CONTENT_ROLES,
  H3_MODELS,
  NODE_KINDS,
  RATIOS,
  RESOLUTIONS,
  TASK_STATUSES,
  TASK_TYPES,
} from './types.ts';

export const zModel = z.enum(H3_MODELS);
export const zResolution = z.enum(RESOLUTIONS);
export const zRatio = z.enum(RATIOS);
export const zContentRole = z.enum(CONTENT_ROLES);
export const zTaskStatus = z.enum(TASK_STATUSES);
export const zTaskType = z.enum(TASK_TYPES);

/** 时长：文档给出的合法枚举为 4–15 的整数 */
export const zDuration = z.number().int().min(4).max(15);

/**
 * 入参地址：公网 URL / mm_file:// / data URI。
 * 与实际接口行为一致 —— 本地磁盘路径、相对路径等一律拒绝，避免"看起来提交了其实没生效"。
 */
export const zMediaUrl = z
  .string()
  .min(1)
  .refine(
    (v) =>
      /^https?:\/\//i.test(v) ||
      v.startsWith('mm_file://') ||
      /^data:(image|video|audio)\/[a-z0-9.+-]+;base64,/i.test(v),
    { message: '地址必须是公网 URL、mm_file://{file_id} 或 data:<mime>;base64,<...>' },
  );

export const zContentItem = z
  .object({
    type: z.enum(['text', 'image_url', 'video_url', 'audio_url']),
    text: z.string().optional(),
    image_url: z.object({ url: zMediaUrl }).optional(),
    video_url: z.object({ url: zMediaUrl }).optional(),
    audio_url: z.object({ url: zMediaUrl }).optional(),
    role: zContentRole.optional(),
  })
  .refine(
    (item) => {
      // 每个元素都必须带上与 type 匹配的载荷，否则接口会报参数错误
      switch (item.type) {
        case 'text':
          return typeof item.text === 'string';
        case 'image_url':
          return item.image_url !== undefined;
        case 'video_url':
          return item.video_url !== undefined;
        case 'audio_url':
          return item.audio_url !== undefined;
        default:
          return false;
      }
    },
    { message: 'type 与载荷不匹配：image_url / video_url / audio_url 必须带上对应对象。' },
  );

export const zVideoGenerationRequest = z.object({
  model: zModel,
  content: z.array(zContentItem).min(1),
  resolution: zResolution,
  duration: zDuration,
  ratio: zRatio.optional(),
  callback_url: z.string().url().optional(),
  aigc_watermark: z.boolean().optional(),
});

export const zContextIRRequest = z.object({
  model: z.literal('MiniMax-H3'),
  content: z.array(zContentItem).min(1),
  duration: zDuration,
  ratio: zRatio.optional(),
  callback_url: z.string().url().optional(),
});

export const zRegenerationRequest = z.union([
  z.object({
    model: z.literal('MiniMax-H3'),
    source_task_id: z.string().min(1),
    resolution: z.literal('2K'),
    callback_url: z.string().url().optional(),
    aigc_watermark: z.boolean().optional(),
  }),
  z.object({
    model: z.literal('MiniMax-H3'),
    content: z.array(zContentItem).min(1),
    resolution: z.literal('2K'),
    callback_url: z.string().url().optional(),
    aigc_watermark: z.boolean().optional(),
  }),
]);

/* ───────────────────────  画布图谱  ─────────────────────── */

export const zWorkflowNode = z.object({
  id: z.string().min(1),
  kind: z.enum(NODE_KINDS),
  position: z.object({ x: z.number(), y: z.number() }),
  params: z.record(z.string(), z.unknown()),
  width: z.number().optional(),
  height: z.number().optional(),
  disabled: z.boolean().optional(),
});

export const zWorkflowEdge = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  sourceHandle: z.string().min(1),
  target: z.string().min(1),
  targetHandle: z.string().min(1),
});

export const zWorkflowGraph = z.object({
  nodes: z.array(zWorkflowNode),
  edges: z.array(zWorkflowEdge),
});

/* ───────────────────────  持久化实体  ─────────────────────── */

export const zProject = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(''),
  cover: z.string().default(''),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const zWorkflowRecord = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  graph: zWorkflowGraph,
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const zSkillTemplate = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  category: z.enum(['generation', 'reference', 'pipeline', 'utility']),
  description: z.string().max(2000).default(''),
  nodes: z.array(
    z.object({
      key: z.string().min(1),
      kind: z.enum(NODE_KINDS),
      params: z.record(z.string(), z.unknown()).default({}),
      offset: z.object({ x: z.number(), y: z.number() }).optional(),
    }),
  ),
  edges: z.array(
    z.object({
      from: z.string().min(1),
      fromHandle: z.string().default('out'),
      to: z.string().min(1),
      toHandle: z.string().default('in'),
    }),
  ),
  builtin: z.boolean().default(false),
  version: z.number().int().default(1),
});

export const zAppSettings = z.object({
  baseUrl: z.string().url(),
  /** 只写不读：读接口永远返回掩码 */
  apiKey: z.string().optional(),
  concurrency: z.number().int().min(1).max(8),
  mock: z.boolean(),
});

export type WorkflowGraphInput = z.infer<typeof zWorkflowGraph>;
export type SkillTemplateInput = z.infer<typeof zSkillTemplate>;
