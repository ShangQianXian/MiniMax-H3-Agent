/**
 * 右侧检查器：随选中节点切换。
 * 分区：参数（由节点自身表单负责）/ 校验结果 / 费用明细 / 请求体预览 + curl / 用量。
 */
import { useMemo, useState } from 'react';
import {
  buildContextIRRequest,
  buildRegenerationRequest,
  buildVideoGenerationRequest,
  formatCny,
  MEDIA_LIMITS,
  nodeDef,
  type H3ContextModel,
  type H3Model,
  type Ratio,
  type Resolution,
} from '@h3/shared';
import { useGraph } from '../store/graph.ts';
import { resolveNodeSlots } from '../engine/resolve.ts';
import { estimateNode } from '../engine/estimate.ts';
import { runNodes } from '../engine/run-controls.ts';
import { api } from '../api/client.ts';
import { buildCurl, classNames, copyToClipboard, downloadText, formatTime } from '../lib/media.ts';
import { STATUS_LABEL } from '../canvas/workflow-types.ts';

export function InspectorPanel() {
  const selectedId = useGraph((s) => s.selectedNodeId);
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const issues = useGraph((s) => s.issues);
  const tasks = useGraph((s) => s.tasks);

  const node = nodes.find((n) => n.id === selectedId) ?? null;

  const nodeIssues = useMemo(
    () => (selectedId ? issues.filter((i) => i.nodeId === selectedId) : []),
    [issues, selectedId],
  );

  const slots = useMemo(
    () => (selectedId ? resolveNodeSlots(selectedId, nodes, edges) : null),
    [edges, nodes, selectedId],
  );

  const estimate = useMemo(() => (node ? estimateNode(node, slots) : null), [node, slots]);

  const task = useMemo(
    () => tasks.find((t) => t.id === node?.data.runtime?.taskId) ?? null,
    [node?.data.runtime?.taskId, tasks],
  );

  const preview = useMemo(() => {
    if (!node || !slots) return null;
    try {
      const params = node.data.params;
      if (node.data.kind === 'videoGen') {
        const built = buildVideoGenerationRequest({
          model: (params.model === 'MiniMax-H3-Max' ? 'MiniMax-H3-Max' : 'MiniMax-H3') as H3Model,
          resolution: (['480P', '768P', '2K'].includes(String(params.resolution))
            ? params.resolution
            : '768P') as Resolution,
          duration: typeof params.duration === 'number' ? params.duration : 5,
          ratio: (typeof params.ratio === 'string' ? params.ratio : '16:9') as Ratio,
          aigcWatermark: params.aigcWatermark === true,
          ...slots,
        });
        return { path: '/v2/video_generation', request: built.request, mode: built.meta.mode, warning: built.meta.warning };
      }
      if (node.data.kind === 'contextIR') {
        const built = buildContextIRRequest({
          model: 'MiniMax-H3',
          duration: typeof params.duration === 'number' ? params.duration : 5,
          ratio: (typeof params.ratio === 'string' ? params.ratio : '16:9') as Ratio,
          ...slots,
        });
        return { path: '/v2/h3_context_ir', request: built.request, mode: built.meta.mode, warning: undefined };
      }
      if (node.data.kind === 'regenerate') {
        if (params.mode === 'task') {
          return {
            path: '/v2/video_regeneration',
            request: {
              model: 'MiniMax-H3' as H3ContextModel,
              source_task_id: String(params.sourceTaskId ?? ''),
              resolution: '2K',
            },
            mode: 'by-task-id',
            warning: '按任务 ID 再生成需要开通白名单。',
          };
        }
        const url = slots.upstreamVideoUrl ?? String(params.baseVideoUrl ?? '');
        const built = buildRegenerationRequest({
          mode: 'video',
          baseVideo: { id: 'base', kind: 'video', source: 'remote', url, mime: 'video/mp4' },
          aigcWatermark: params.aigcWatermark === true,
          ...slots,
        });
        return { path: '/v2/video_regeneration', request: built.request, mode: built.meta.mode, warning: built.meta.warning };
      }
    } catch (error) {
      return { path: '', request: { error: (error as Error).message }, mode: 'error', warning: undefined };
    }
    return null;
  }, [node, slots]);

  if (!node) {
    return (
      <aside className="flex h-full w-[330px] shrink-0 flex-col border-l border-ink-700 bg-ink-900">
        <div className="border-b border-ink-700 px-3 py-2 text-[12px] text-mist-300">检查器</div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
          <p className="text-[12px] text-mist-400">选中画布上的节点以查看与编辑参数</p>
          <div className="rounded-lg border border-ink-700 bg-ink-850/60 p-2 text-left text-[11px] leading-relaxed text-mist-400">
            <div className="mb-1 font-medium text-mist-300">规格速查</div>
            <div>· MiniMax-H3：768P / 2K，4–15 秒，支持多模态参考</div>
            <div>· MiniMax-H3-Max：480P / 768P，5–15 秒，仅文生 / 图生</div>
            <div>· 图片 ≤{MEDIA_LIMITS.image.maxReferenceImage} 张参考、单张 ≤30MB</div>
            <div>· 参考视频 ≤{MEDIA_LIMITS.video.maxCount} 段且总长 ≤15s</div>
            <div>· 参考音频 ≤{MEDIA_LIMITS.audio.maxCount} 段且总长 ≤15s（免费）</div>
            <div>· 请求体总计 ≤64MB，大素材请用公网 URL</div>
          </div>
        </div>
      </aside>
    );
  }

  const def = nodeDef(node.data.kind);
  const runtime = node.data.runtime;
  const isTaskNode = ['videoGen', 'contextIR', 'regenerate', 'taskStatus'].includes(node.data.kind);

  return (
    <aside className="flex h-full w-[330px] shrink-0 flex-col border-l border-ink-700 bg-ink-900">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 px-3 py-2">
        <span className="h-2 w-2 rounded-full" style={{ background: def.accent }} />
        <span className="text-[13px]">{def.label}</span>
        <span className="ml-auto text-[11px] text-mist-400">{STATUS_LABEL[runtime?.status ?? 'idle']}</span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <p className="text-[11px] leading-snug text-mist-400">{def.description}</p>

        {isTaskNode && (
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={runtime?.status === 'running' || runtime?.status === 'queued'}
            onClick={() => void runNodes([node.id])}
          >
            ▶ 运行此节点及其上游
          </button>
        )}

        {/* 校验 */}
        <section>
          <SectionTitle>校验</SectionTitle>
          {nodeIssues.length === 0 ? (
            <p className="text-[11px] text-emerald-300">该节点没有发现问题。</p>
          ) : (
            <ul className="space-y-1">
              {nodeIssues.map((issue, index) => (
                <li
                  key={`${issue.code}-${index}`}
                  className={classNames(
                    'rounded-md border p-1.5 text-[11px] leading-snug',
                    issue.severity === 'error'
                      ? 'border-rose-500/40 bg-rose-500/5 text-rose-300'
                      : 'border-amber-500/40 bg-amber-500/5 text-amber-300',
                  )}
                >
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 费用 */}
        {estimate && estimate.kind !== 'none' && (
          <section>
            <SectionTitle>费用预估</SectionTitle>
            <div className="rounded-lg border border-ink-700 bg-ink-850 p-2 text-[11px]">
              {estimate.breakdown.items.map((item, index) => (
                <div key={`${item.label}-${index}`} className="flex items-start justify-between gap-2 py-0.5">
                  <span className="text-mist-300">
                    {item.label}
                    {item.detail && <span className="block text-[10px] text-mist-400">{item.detail}</span>}
                  </span>
                  <span className={item.amount === 0 ? 'text-emerald-300' : ''}>{formatCny(item.amount)}</span>
                </div>
              ))}
              <div className="mt-1 flex items-center justify-between border-t border-ink-700 pt-1 font-medium">
                <span>合计</span>
                <span>{formatCny(estimate.breakdown.total)}</span>
              </div>
            </div>
            {estimate.notice && <p className="mt-1 text-[10px] leading-snug text-mist-400">{estimate.notice}</p>}
            {estimate.estimated && <p className="mt-1 text-[10px] text-amber-300">Context-IR 的 token 为预估值。</p>}
          </section>
        )}

        {/* 请求体预览 */}
        {preview && (
          <section>
            <SectionTitle>
              请求体预览
              {preview.mode && <span className="ml-1 chip !py-0 !text-[10px]">{preview.mode}</span>}
            </SectionTitle>
            <div className="max-h-[180px] overflow-auto rounded-lg border border-ink-700 bg-ink-950 p-2">
              <pre className="mono whitespace-pre-wrap break-all text-[10px] leading-snug text-mist-300">
                {JSON.stringify(preview.request, null, 2)}
              </pre>
            </div>
            {preview.warning && <p className="mt-1 text-[10px] leading-snug text-amber-300">{preview.warning}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => void copyToClipboard(JSON.stringify(preview.request, null, 2))}
              >
                复制 JSON
              </button>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => void copyToClipboard(buildCurl(preview.path, preview.request))}
              >
                复制 curl
              </button>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() =>
                  downloadText(
                    `${node.data.kind}-${node.id}.json`,
                    JSON.stringify({ path: preview.path, request: preview.request }, null, 2),
                  )
                }
              >
                导出
              </button>
            </div>
          </section>
        )}

        {/* 上游槽位 */}
        {slots && (slots.frames.length > 0 || slots.media.length > 0 || slots.text) && (
          <section>
            <SectionTitle>已解析的上游输入</SectionTitle>
            <div className="space-y-1 text-[10px] text-mist-300">
              {slots.text && (
                <div className="rounded-md border border-ink-700 bg-ink-850 p-1.5">
                  <div className="text-mist-400">
                    提示词 · {slots.text.sourceKind === 'contextIR' ? 'Context-IR 增强' : '原始'}
                  </div>
                  <div className="mt-0.5 max-h-[60px] overflow-auto leading-snug">
                    {slots.text.text.slice(0, 200) || '（空）'}
                  </div>
                </div>
              )}
              {[...slots.frames.map((f) => ({ kind: f.ref.kind, role: f.role as string })), ...slots.media.map((m) => ({ kind: m.ref.kind, role: String(m.role ?? 'auto') }))].map(
                (item, index) => (
                  <div key={index} className="flex items-center gap-1 rounded-md border border-ink-700 bg-ink-850 px-1.5 py-1">
                    <span className="chip !py-0 !text-[10px]">{item.kind}</span>
                    <span className="text-mist-400">{item.role}</span>
                  </div>
                ),
              )}
            </div>
          </section>
        )}

        {/* 任务信息 */}
        {task && (
          <section>
            <SectionTitle>任务</SectionTitle>
            <div className="space-y-1 rounded-lg border border-ink-700 bg-ink-850 p-2 text-[10px] text-mist-300">
              <div className="flex items-center justify-between">
                <span className="mono truncate">#{task.id}</span>
                <span>{STATUS_LABEL[task.status]}</span>
              </div>
              <div className="text-mist-400">
                {task.model} · {task.resolution} {task.duration ? `· ${task.duration}s` : ''}{' '}
                {task.ratio ? `· ${task.ratio}` : ''}
              </div>
              <div className="text-mist-400">创建：{formatTime(task.createdAt)}</div>
              {Object.keys(task.usage).length > 0 && (
                <div className="text-mist-400">
                  {task.usage.output_seconds !== undefined && <div>输出秒数：{task.usage.output_seconds}</div>}
                  {task.usage.input_seconds ? <div>输入参考视频秒数：{task.usage.input_seconds}</div> : null}
                  {task.usage.input_image_count !== undefined && (
                    <div>输入图片张数：{task.usage.input_image_count}</div>
                  )}
                  {task.usage.input_audio_seconds ? <div>输入参考音频秒数：{task.usage.input_audio_seconds}</div> : null}
                  {task.usage.total_tokens !== undefined && (
                    <div>
                      tokens：{task.usage.total_tokens}（输入 {task.usage.prompt_tokens ?? 0} / 输出{' '}
                      {task.usage.completion_tokens ?? 0}）
                    </div>
                  )}
                </div>
              )}
              {task.taskType === 'h3_context_ir' && task.promptFinal && (
                <button
                  type="button"
                  className="btn btn-xs w-full"
                  onClick={() => void copyToClipboard(task.promptFinal)}
                >
                  复制增强提示词
                </button>
              )}
              {task.contentUrl && (
                <a className="btn btn-xs w-full" href={task.contentUrl} target="_blank" rel="noreferrer">
                  打开产物链接
                </a>
              )}
              {task.id && (
                <button
                  type="button"
                  className="btn btn-xs w-full"
                  onClick={() => void api.saveArtifact(task.id).then(() => undefined).catch(() => undefined)}
                >
                  转存到本地
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 flex items-center text-[11px] font-medium uppercase tracking-wider text-mist-400">
      {children}
    </h3>
  );
}
