/**
 * MiniMax H3 接口契约类型。
 * 来源：docs/api/1..7 官方文档（/v2/video_generation、/v2/query/*、/v2/h3_context_ir、/v2/video_regeneration）。
 */

/* ─────────────────────────  枚举  ───────────────────────── */

export const H3_MODELS = ['MiniMax-H3', 'MiniMax-H3-Max'] as const;
export type H3Model = (typeof H3_MODELS)[number];

/** Context-IR 与视频再生成只支持 MiniMax-H3。 */
export const H3_CONTEXT_MODELS = ['MiniMax-H3'] as const;
export type H3ContextModel = (typeof H3_CONTEXT_MODELS)[number];

export const RESOLUTIONS = ['480P', '768P', '2K'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const RATIOS = ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export type Ratio = (typeof RATIOS)[number];

/** t2va 场景下 ratio 必填且不能为 adaptive。 */
export const CONCRETE_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export type ConcreteRatio = (typeof CONCRETE_RATIOS)[number];

export const DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export type DurationSec = (typeof DURATIONS)[number];

export const CONTENT_TYPES = ['text', 'image_url', 'video_url', 'audio_url'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_ROLES = [
  'first_frame',
  'last_frame',
  'reference_image',
  'reference_video',
  'reference_audio',
  'base_video',
] as const;
export type ContentRole = (typeof CONTENT_ROLES)[number];

/** 一旦出现任一 reference_*，就不得再出现 first_frame / last_frame（反之亦然）。 */
export const REFERENCE_ROLES = ['reference_image', 'reference_video', 'reference_audio'] as const;
export const FRAME_ROLES = ['first_frame', 'last_frame'] as const;

export const TASK_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

export const TASK_TYPES = ['generation', 'h3_context_ir', 'regeneration'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const MODALITIES = ['video', 'text'] as const;
export type Modality = (typeof MODALITIES)[number];

/* ─────────────────────  content 数组元素  ───────────────────── */

export interface ContentItem {
  type: ContentType;
  /** 仅 type=text 时存在，且整个数组必须有一个非空 text。 */
  text?: string;
  image_url?: { url: string };
  video_url?: { url: string };
  audio_url?: { url: string };
  role?: ContentRole;
}

/* ─────────────────────────  请求体  ───────────────────────── */

export interface VideoGenerationRequest {
  model: H3Model;
  content: ContentItem[];
  resolution: Resolution;
  duration: number;
  ratio?: Ratio;
  callback_url?: string;
  aigc_watermark?: boolean;
}

export interface ContextIRRequest {
  model: H3ContextModel;
  content: ContentItem[];
  /** 注意：Context-IR 没有 resolution 字段。 */
  duration: number;
  ratio?: Ratio;
  callback_url?: string;
}

/** 模式一：按已有成功任务的 task_id 再生成（需开通白名单）。 */
export interface RegenerationByTaskRequest {
  model: H3ContextModel;
  source_task_id: string;
  resolution: '2K';
  callback_url?: string;
  aigc_watermark?: boolean;
}

/** 模式二：按源视频再生成，content 中必须有且仅有一个 role=base_video 的 video_url 项。 */
export interface RegenerationByVideoRequest {
  model: H3ContextModel;
  content: ContentItem[];
  resolution: '2K';
  callback_url?: string;
  aigc_watermark?: boolean;
}

export type RegenerationRequest = RegenerationByTaskRequest | RegenerationByVideoRequest;

export interface CreateTaskResponse {
  task_id: string;
}

/* ─────────────────────────  任务对象  ───────────────────────── */

export interface VideoTaskError {
  code: string;
  message: string;
}

export interface VideoTaskContent {
  /** 视频任务产物的限时下载 URL。 */
  url?: string;
  /** H3-Context-IR 任务的结构化增强提示词。 */
  prompt?: string;
}

export interface VideoTaskUsage {
  total_seconds?: number;
  input_seconds?: number;
  output_seconds?: number;
  input_image_count?: number;
  input_audio_seconds?: number;
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}

export interface VideoTask {
  id: string;
  model?: string;
  status: TaskStatus;
  error?: VideoTaskError;
  /** Unix 秒 */
  created_at?: number;
  updated_at?: number;
  content?: VideoTaskContent;
  resolution?: string;
  duration?: number;
  usage?: VideoTaskUsage;
  ratio?: string;
  task_type?: TaskType;
  modality?: Modality;
}

export interface QueryTaskResponse {
  task: VideoTask;
}

export interface ListTasksQuery {
  page_num?: number;
  page_size?: number;
  'filter.status'?: TaskStatus;
  'filter.task_ids'?: string[];
  'filter.model'?: string;
  'filter.task_type'?: TaskType;
}

export interface ListTasksResponse {
  items: VideoTask[];
  total: number;
}

export type DeleteAction = 'cancelled' | 'deleted';

export interface DeleteTaskResponse {
  task_id: string;
  action: DeleteAction;
  status: DeleteAction;
}

/* ─────────────────────────  错误响应  ───────────────────────── */

export type OaiErrorType =
  | 'authorized_error'
  | 'bad_request_error'
  | 'rate_limit_error'
  | 'insufficient_balance_error'
  | 'unprocessable_entity_error'
  | 'overloaded_error'
  | 'server_error'
  | string;

export interface OaiErrorDetail {
  type: OaiErrorType;
  /** 末尾括号内为内部错误码，如 "... (2013)"。 */
  message: string;
  http_code: string;
}

export interface OaiErrorResponse {
  type: 'error';
  error: OaiErrorDetail;
  request_id?: string;
}

/* ─────────────────────  工作流图（画布模型）  ───────────────────── */

export const NODE_KINDS = [
  'prompt',
  'image',
  'video',
  'audio',
  'frameRole',
  'videoGen',
  'contextIR',
  'regenerate',
  'taskStatus',
  'taskList',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const PORT_KINDS = ['text', 'media', 'video', 'any'] as const;
export type PortKind = (typeof PORT_KINDS)[number];

/** 三种生成场景，由 content 组成自动判定。 */
export const GEN_MODES = ['t2va', 'i2va', 'r2va'] as const;
export type GenMode = (typeof GEN_MODES)[number];

/** 素材引用：本地上传转 data URI，或直接引用公网 URL / 平台 file_id / 历史产物 URL。 */
export interface MediaRef {
  id: string;
  kind: 'image' | 'video' | 'audio';
  source: 'data-uri' | 'remote' | 'mm-file' | 'artifact';
  /** 实际送进 content 的地址。 */
  url: string;
  mime: string;
  bytes?: number;
  width?: number;
  height?: number;
  durationSec?: number;
  originalName?: string;
  /** 本地素材表主键（若已入库）。 */
  assetId?: string;
  /**
   * 素材自带的显式角色（例如创作台把单张图直接标成 last_frame）。
   * 优先级高于由上游节点类型推断出来的角色。
   */
  explicitRole?: ContentRole;
}

export interface PromptValue {
  id: string;
  text: string;
  /** 若由 Context-IR 节点产出，记录增强提示词。 */
  enhancedFrom?: { taskId: string; rawText: string };
}

export interface WorkflowNode {
  id: string;
  kind: NodeKind;
  position: { x: number; y: number };
  /** 节点参数，按 kind 解释（见 node-params.ts）。 */
  params: Record<string, unknown>;
  width?: number;
  height?: number;
  disabled?: boolean;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

/** 执行记录（运行时产物，不写回图谱 JSON）。 */
export interface RunRecord {
  id: string;
  workflowId: string;
  nodeId: string;
  kind: NodeKind;
  status: TaskStatus | 'pending';
  taskId?: string;
  taskType?: TaskType;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}
