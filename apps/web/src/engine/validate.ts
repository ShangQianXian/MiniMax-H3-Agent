/**
 * 校验引擎：把画布上的每个节点组装成请求体并跑一遍 @h3/shared 的校验，
 * 产出带 nodeId 的问题列表，供节点红点、检查器列表、顶部汇总三处使用。
 */
import {
  assembleContent,
  buildContextIRRequest,
  buildRegenerationRequest,
  buildVideoGenerationRequest,
  validateRegeneration,
  validateVideoGeneration,
  type ContextIRParams,
  type H3ContextModel,
  type H3Model,
  type Ratio,
  type RegenerateParams,
  type Resolution,
  type ValidationIssue,
  type ValidationResult,
  type VideoGenParams,
} from '@h3/shared';
import type { CanvasEdge, CanvasNode } from '../store/graph.ts';
import { resolveNodeSlots } from './resolve.ts';

function asVideoGenParams(params: Record<string, unknown>): VideoGenParams {
  return {
    model: (params.model === 'MiniMax-H3-Max' ? 'MiniMax-H3-Max' : 'MiniMax-H3') as H3Model,
    resolution: (['480P', '768P', '2K'].includes(String(params.resolution))
      ? params.resolution
      : '768P') as Resolution,
    duration: typeof params.duration === 'number' ? params.duration : 8,
    ratio: (typeof params.ratio === 'string' ? params.ratio : 'adaptive') as Ratio,
    aigcWatermark: params.aigcWatermark === true,
    confirmBeforeRun: params.confirmBeforeRun !== false,
    presetId: typeof params.presetId === 'string' ? params.presetId : '全能参考',
    sound: params.sound === '无声' ? '无声' : '有声',
  };
}

function asContextIRParams(params: Record<string, unknown>): ContextIRParams {
  return {
    model: 'MiniMax-H3',
    duration: typeof params.duration === 'number' ? params.duration : 8,
    ratio: (typeof params.ratio === 'string' ? params.ratio : '16:9') as Ratio,
  };
}

function asRegenParams(params: Record<string, unknown>): RegenerateParams {
  return {
    mode: params.mode === 'task' ? 'task' : 'video',
    sourceTaskId: typeof params.sourceTaskId === 'string' ? params.sourceTaskId : '',
    aigcWatermark: params.aigcWatermark === true,
  };
}

function issue(
  severity: 'error' | 'warning',
  code: string,
  message: string,
  nodeId: string,
  field?: string,
): ValidationIssue {
  return { severity, code, message, nodeId, ...(field ? { field } : {}) };
}

export interface ValidationReport {
  issues: ValidationIssue[];
  ok: boolean;
}

export function validateGraph(nodes: CanvasNode[], edges: CanvasEdge[]): ValidationReport {
  const issues: ValidationIssue[] = [];

  for (const node of nodes) {
    const slots = resolveNodeSlots(node.id, nodes, edges);

    // 上游提示
    for (const warning of slots.warnings) {
      issues.push(issue('warning', 'graph.upstream', warning, node.id));
    }

    if (node.data.kind === 'prompt') {
      const text = String(node.data.params.text ?? '');
      if (text.trim().length === 0) {
        issues.push(issue('warning', 'prompt.empty', '提示词为空，下游节点无法运行。', node.id, 'text'));
      }
    }

    if (node.data.kind === 'image' || node.data.kind === 'video' || node.data.kind === 'audio') {
      const url = String(node.data.params.url ?? '');
      if (url.trim().length === 0) {
        issues.push(issue('warning', 'media.empty', '尚未选择素材。', node.id, 'url'));
      }
    }

    if (node.data.kind === 'videoGen') {
      const params = asVideoGenParams(node.data.params);
      const connectedInputs = new Set(edges.filter((e) => e.target === node.id).map((e) => e.targetHandle));
      if (!connectedInputs.has('text')) {
        issues.push(
          issue(
            'error',
            'graph.missingInput',
            '「视频生成」节点的「提示词」输入未连接。请连接一个「提示词」或「Context-IR 增强」节点。',
            node.id,
          ),
        );
        continue;
      }

      const { request } = buildVideoGenerationRequest({ ...params, ...slots });
      const assembled = assembleContent(slots);
      const result: ValidationResult = validateVideoGeneration(request, assembled, { nodeId: node.id });
      issues.push(...result.errors, ...result.warnings);
    }

    if (node.data.kind === 'contextIR') {
      const connectedInputs = new Set(edges.filter((e) => e.target === node.id).map((e) => e.targetHandle));
      if (!connectedInputs.has('text')) {
        issues.push(
          issue('error', 'graph.missingInput', '「Context-IR 增强」节点的「原始提示词」输入未连接。', node.id),
        );
        continue;
      }
      const params = asContextIRParams(node.data.params);
      const { request } = buildContextIRRequest({ ...params, ...slots });
      const text = request.content.find((c) => c.type === 'text')?.text ?? '';
      if (text.trim().length === 0) {
        issues.push(issue('error', 'content.text.missing', '缺少非空 prompt。', node.id, 'text'));
      }
      if (text.length > 7000) {
        issues.push(issue('error', 'text.tooLong', `提示词 ${text.length} 字符超过 7000 上限。`, node.id, 'text'));
      }
    }

    if (node.data.kind === 'regenerate') {
      const params = asRegenParams(node.data.params);

      if (params.mode === 'task') {
        if (params.sourceTaskId.trim().length === 0) {
          issues.push(
            issue('error', 'regen.sourceTaskId', '请填写源任务的 task_id（必须是当前账号下成功的生成任务）。', node.id, 'sourceTaskId'),
          );
        }
        const result = validateRegeneration(
          { model: 'MiniMax-H3' as H3ContextModel, source_task_id: params.sourceTaskId, resolution: '2K' },
          { nodeId: node.id },
        );
        issues.push(...result.errors, ...result.warnings);
        continue;
      }

      // 按源视频再生成：需要有 base_video
      const baseVideoUrl = slots.upstreamVideoUrl;
      const paramsWithUrl = String(node.data.params.baseVideoUrl ?? '');
      const effectiveUrl = baseVideoUrl ?? paramsWithUrl;

      if (!effectiveUrl) {
        issues.push(
          issue(
            'error',
            'regen.baseVideo.missing',
            '缺少源视频：请连接一个上游「视频生成」节点（768P 产物），或在参数里填写 768P 源视频 URL。',
            node.id,
          ),
        );
        continue;
      }

      const connectedInputs = new Set(edges.filter((e) => e.target === node.id).map((e) => e.targetHandle));
      if (!connectedInputs.has('text')) {
        issues.push(
          issue(
            'warning',
            'regen.text.missing',
            '未连接提示词。再生成必须原样重放当时的输入，建议连接与生成源视频时完全一致的提示词节点。',
            node.id,
          ),
        );
      }

      const { request, meta } = buildRegenerationRequest({
        mode: 'video',
        baseVideo: {
          id: 'base',
          kind: 'video',
          source: effectiveUrl.startsWith('data:') ? 'data-uri' : 'remote',
          url: effectiveUrl,
          mime: 'video/mp4',
        },
        aigcWatermark: params.aigcWatermark,
        ...slots,
      });

      const result = validateRegeneration(request, {
        nodeId: node.id,
        durationSec: undefined,
      });
      issues.push(...result.errors, ...result.warnings);
      void meta;
    }

    if (node.data.kind === 'taskStatus') {
      const params = node.data.params;
      const follow = params.followUpstream !== false;
      const taskId = String(params.taskId ?? '');
      if (!follow && taskId.trim().length === 0) {
        issues.push(
          issue('error', 'taskStatus.taskId', '请填写要监控的 task_id，或开启「跟随上游任务」。', node.id, 'taskId'),
        );
      }
      if (follow && !slots.upstreamTaskId) {
        issues.push(
          issue('warning', 'taskStatus.noUpstream', '尚未收到上游任务 ID，运行上游节点后这里会自动填充。', node.id),
        );
      }
    }
  }

  return { issues, ok: !issues.some((i) => i.severity === 'error') };
}

/** 只取某个节点相关的问题。 */
export function issuesForNode(issues: ValidationIssue[], nodeId: string): ValidationIssue[] {
  return issues.filter((i) => i.nodeId === nodeId);
}
