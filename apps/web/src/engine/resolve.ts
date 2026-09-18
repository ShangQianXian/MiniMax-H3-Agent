/**
 * 槽位解析引擎：把画布上的上游节点解析成接口需要的 content 组成。
 *
 * 这是纯函数，不依赖任何 store，方便单测与在检查器里复用。
 */
import type {
  ContentRole,
  FrameSlot,
  MediaRef,
  MediaSlot,
  TextSlot,
} from '@h3/shared';
import type { CanvasEdge, CanvasNode } from '../store/graph.ts';

export interface ResolvedSlots {
  text: TextSlot | null;
  frames: FrameSlot[];
  media: MediaSlot[];
  /** 直接上游节点 ID（用于递归求值与等待） */
  upstreamNodeIds: string[];
  /** 上游视频产物地址，供再生成节点使用 */
  upstreamVideoUrl: string | null;
  /** 上游任务 ID，供「按任务 ID 再生成」与任务状态节点使用 */
  upstreamTaskId: string | null;
  /** 上游产物的其他可用信息 */
  upstreamTaskStatus: string | null;
  warnings: string[];
}

const EMPTY: Omit<ResolvedSlots, 'warnings'> = {
  text: null,
  frames: [],
  media: [],
  upstreamNodeIds: [],
  upstreamVideoUrl: null,
  upstreamTaskId: null,
  upstreamTaskStatus: null,
};

/** MediaRef 本身就是送进 content 的地址，resolver 只负责补全元数据。 */
export function mediaRefFromParams(params: Record<string, unknown>): MediaRef | null {
  const url = typeof params.url === 'string' ? params.url.trim() : '';
  if (url.length === 0) return null;

  const kind = params.kind === 'video' ? 'video' : params.kind === 'audio' ? 'audio' : 'image';
  const source: MediaRef['source'] = url.startsWith('data:')
    ? 'data-uri'
    : url.startsWith('mm_file://')
      ? 'mm-file'
      : 'remote';

  const num = (key: string): number | undefined => {
    const value = params[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };

  return {
    id: typeof params.assetId === 'string' && params.assetId ? params.assetId : url.slice(0, 24),
    kind,
    source,
    url,
    mime: typeof params.mime === 'string' ? params.mime : '',
    ...(num('bytes') !== undefined ? { bytes: num('bytes')! } : {}),
    ...(num('width') !== undefined ? { width: num('width')! } : {}),
    ...(num('height') !== undefined ? { height: num('height')! } : {}),
    ...(num('durationSec') !== undefined ? { durationSec: num('durationSec')! } : {}),
    ...(typeof params.assetId === 'string' && params.assetId ? { assetId: params.assetId } : {}),
    ...(typeof params.name === 'string' && params.name ? { originalName: params.name } : {}),
    // 创作台会把单张素材的角色直接写在参数上
    ...(typeof params.explicitRole === 'string'
      ? { explicitRole: params.explicitRole as MediaRef['explicitRole'] }
      : {}),
  };
}

/** 节点当前可对外提供的视频/图片地址（优先本地转存的地址）。 */
function nodeOutputUrl(node: CanvasNode): string | null {
  const runtime = node.data.runtime;
  if (runtime?.outputUrl) return runtime.outputUrl;
  return null;
}

function nodeOutputText(node: CanvasNode): string | null {
  const runtime = node.data.runtime;
  if (node.data.kind === 'contextIR') {
    if (runtime?.outputText) return runtime.outputText;
    return null;
  }
  if (node.data.kind === 'prompt') {
    const text = String(node.data.params.text ?? '');
    return text.length > 0 ? text : null;
  }
  return null;
}

export function resolveNodeSlots(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): ResolvedSlots {
  const warnings: string[] = [];
  const incoming = edges.filter((e) => e.target === nodeId);
  const mediaSlots: MediaSlot[] = [];
  const frameSlots: FrameSlot[] = [];
  let text: TextSlot | null = null;
  let upstreamVideoUrl: string | null = null;
  let upstreamTaskId: string | null = null;
  let upstreamTaskStatus: string | null = null;

  const upstreamNodeIds: string[] = [];

  for (const edge of incoming) {
    const source = nodes.find((n) => n.id === edge.source);
    if (!source) continue;
    if (!upstreamNodeIds.includes(source.id)) upstreamNodeIds.push(source.id);
    if (source.data.disabled) continue;

    const handle = edge.targetHandle ?? 'in';
    const kind = source.data.kind;

    // 文本类上游
    if (handle === 'text' || handle === 'in') {
      const output = nodeOutputText(source);
      if (output !== null) {
        const runtime = source.data.runtime;
        const slot: TextSlot = {
          text: output,
          sourceKind: kind === 'contextIR' ? 'contextIR' : 'prompt',
          sourceNodeId: source.id,
        };
        if (kind === 'contextIR') {
          const raw = String(source.data.params.rawText ?? '');
          if (raw.length > 0) slot.rawText = raw;
          if (runtime?.taskId) slot.taskId = runtime.taskId;
        }
        // 多个文本上游时以最后一个为准，但给出提示
        if (text !== null) {
          warnings.push('检测到多个提示词上游，只有最后一个会生效。');
        }
        text = slot;
        continue;
      }
    }

    // 视频任务产物（videoGen / regenerate / taskStatus）
    if (
      kind === 'videoGen' ||
      kind === 'regenerate' ||
      kind === 'taskStatus'
    ) {
      const runtime = source.data.runtime;
      if (runtime?.taskId) upstreamTaskId = runtime.taskId;
      if (runtime?.status) upstreamTaskStatus = runtime.status;
      const url = nodeOutputUrl(source);
      if (url) {
        upstreamVideoUrl = url;
        if (handle === 'video') {
          mediaSlots.push({
            ref: {
              id: source.id,
              kind: 'video',
              source: url.startsWith('data:') ? 'data-uri' : 'remote',
              url,
              mime: 'video/mp4',
            },
            sourceNodeId: source.id,
          });
        }
      }
      continue;
    }

    // Context-IR 也可以作为文本源被视频生成节点消费（handle 为 text 时上面已处理）
    if (kind === 'contextIR') {
      const output = nodeOutputText(source);
      if (output !== null && text === null) {
        text = { text: output, sourceKind: 'contextIR', sourceNodeId: source.id };
      }
      continue;
    }

    // 帧角色节点
    if (kind === 'frameRole') {
      const mode = source.data.params.mode === 'reference' ? 'reference' : 'first-last';
      const referenceRole = (source.data.params.referenceRole ?? 'reference_image') as ContentRole;

      // 帧角色节点的上游图片
      const innerEdges = edges.filter((e) => e.target === source.id);
      const refs: MediaRef[] = [];
      const nonImages: MediaRef[] = [];
      for (const inner of innerEdges) {
        const upstream = nodes.find((n) => n.id === inner.source);
        if (!upstream) continue;
        if (!upstreamNodeIds.includes(upstream.id)) upstreamNodeIds.push(upstream.id);
        const ref = mediaRefFromParams(upstream.data.params);
        if (!ref) continue;
        if (ref.kind === 'image') refs.push(ref);
        else nonImages.push(ref);
      }

      if (mode === 'reference') {
        // 参考模式：图片按参考图送进 content；视频 / 音频本身也是合法的多模态参考素材，原样透传
        for (const ref of refs) {
          const role: ContentRole =
            referenceRole === 'first_frame' || referenceRole === 'last_frame'
              ? 'reference_image'
              : referenceRole;
          frameSlots.push({ ref, role, sourceNodeId: source.id });
        }
        for (const ref of nonImages) {
          mediaSlots.push({
            ref,
            role: ref.kind === 'video' ? 'reference_video' : 'reference_audio',
            sourceNodeId: source.id,
          });
        }
      } else {
        for (const ref of nonImages) {
          warnings.push(`「帧角色」的首尾帧模式只接受图片，已忽略一个 ${ref.kind} 素材。改用「参考图」模式可以透传它。`);
        }
        if (refs.length === 1) {
          frameSlots.push({ ref: refs[0]!, role: 'first_frame', sourceNodeId: source.id });
        } else if (refs.length >= 2) {
          frameSlots.push({ ref: refs[0]!, role: 'first_frame', sourceNodeId: source.id });
          frameSlots.push({ ref: refs[refs.length - 1]!, role: 'last_frame', sourceNodeId: source.id });
          if (refs.length > 2) warnings.push('首尾帧模式只取第一张作首帧、最后一张作尾帧，中间的图片被忽略。');
        }
      }
      continue;
    }

    // 图片 / 视频 / 音频直连
    if (kind === 'image' || kind === 'video' || kind === 'audio') {
      const ref = mediaRefFromParams(source.data.params);
      if (!ref) {
        warnings.push(`「${source.data.label}」还没有素材，请先上传文件或填写 URL。`);
        continue;
      }
      // 视频 / 音频节点自带的时长决定了它自己该用什么 role
      const role: ContentRole | undefined =
        ref.kind === 'video' ? 'reference_video' : ref.kind === 'audio' ? 'reference_audio' : undefined;
      mediaSlots.push({ ref, ...(role ? { role } : {}), sourceNodeId: source.id });
      continue;
    }
  }

  return {
    text,
    frames: frameSlots,
    media: mediaSlots,
    upstreamNodeIds,
    upstreamVideoUrl,
    upstreamTaskId,
    upstreamTaskStatus,
    warnings,
  };
}

/** 供执行引擎判断：某个节点是否已经产出了下游需要的东西。 */
export function isNodeSatisfied(node: CanvasNode): boolean {
  return node.data.runtime?.status === 'succeeded';
}

export { EMPTY as EMPTY_SLOTS };
