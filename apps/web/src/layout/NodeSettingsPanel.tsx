/**
 * 节点设置面板 —— 对应参考图 3 / 图 4。
 *
 * 交互：
 *   点视频节点 → 卡片下方展开本面板
 *   生成方式切「全能参考」→ 比例 7 项全给（图3）
 *   生成方式切「首尾帧」  → 比例只剩「自适应」（图4），因为宽高比由输入图片决定
 *
 * 比例的可选项完全来自 @h3/shared 的 PRESETS[].ratioOptions，
 * 与接口规则一一对应，不做任何「界面允许但接口会忽略」的假选项。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  DURATIONS,
  MODEL_CAPABILITIES,
  PRESETS,
  RATIO_META,
  SOUND_DIRECTIVES,
  coerceRatio,
  formatCny,
  isRatioAllowed,
  presetById,
  type GenMethodId,
  type H3Model,
  type Ratio,
  type Resolution,
  type SoundMode,
} from '@h3/shared';
import { useGraph } from '../store/graph.ts';
import { useSettingsPanel } from '../store/settings-panel.ts';
import { NodeFloatingPanel } from '../canvas/NodeFloatingPanel.tsx';
import { resolveNodeSlots } from '../engine/resolve.ts';
import { estimateNode } from '../engine/estimate.ts';
import { runNodes } from '../engine/run-controls.ts';
import { classNames } from '../lib/media.ts';

interface Props {
  nodeId: string;
}

export function NodeSettingsPanel({ nodeId }: Props) {
  const node = useGraph((s) => s.nodes.find((n) => n.id === nodeId) ?? null);
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const update = useGraph((s) => s.updateNodeParams);
  const close = useSettingsPanel((s) => s.close);
  const openGuide = useSettingsPanel((s) => s.openGuide);

  const slots = useMemo(() => resolveNodeSlots(nodeId, nodes, edges), [edges, nodeId, nodes]);
  const estimate = useMemo(() => (node ? estimateNode(node, slots) : null), [node, slots]);

  if (!node) return null;

  const params = node.data.params;
  const methodId = (String(params.presetId ?? '') || '全能参考') as GenMethodId;
  const preset = presetById(methodId) ?? PRESETS[0]!;
  const model = (params.model === 'MiniMax-H3-Max' ? 'MiniMax-H3-Max' : 'MiniMax-H3') as H3Model;
  const capability = MODEL_CAPABILITIES[model];
  const resolution = String(params.resolution ?? preset.defaults.resolution) as Resolution;
  const duration = typeof params.duration === 'number' ? params.duration : 8;
  const ratio = String(params.ratio ?? preset.defaults.ratio) as Ratio;
  const sound = (params.sound === '无声' ? '无声' : '有声') as SoundMode;

  const imageCount = slots.frames.length + slots.media.filter((m) => m.ref.kind === 'image').length;
  const hasReferenceMedia = slots.media.some((m) => m.ref.kind === 'video' || m.ref.kind === 'audio');

  const switchMethod = (next: GenMethodId) => {
    const nextPreset = presetById(next)!;
    update(nodeId, {
      presetId: next,
      // 切方式时把比例收敛到该方式允许的值，避免留下一个会被接口忽略的比例
      ratio: coerceRatio(next, ratio),
      ...(nextPreset.mode === 't2va' && nextPreset.ratioOptions.includes(ratio) ? {} : {}),
    });
  };

  const aspectLocked = preset.ratioLocked;
  const ratioOptions = (Object.keys(RATIO_META) as Ratio[]).filter((key) => isRatioAllowed(methodId, key));

  /** 窄屏（放不下三列）时退化为单列，避免每列被挤成一条 */
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const compute = () => setNarrow(window.innerWidth < 900);
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  const switchModel = (value: H3Model) => {
    const nextCap = MODEL_CAPABILITIES[value];
    update(nodeId, {
      model: value,
      ...(nextCap.resolutions.includes(resolution) ? {} : { resolution: nextCap.defaultResolution }),
      ...(duration < nextCap.minDuration ? { duration: nextCap.minDuration } : {}),
      // H3-Max 不支持多模态参考，当前是参考类方式就退回首帧
      ...(value === 'MiniMax-H3-Max' && preset.mode === 'r2va' ? { presetId: '首帧', ratio: 'adaptive' } : {}),
    });
  };

  return (
    <NodeFloatingPanel nodeId={nodeId} deps={[methodId, ratioOptions.length, narrow]}>
      {/* 顶部一行：标题 + 关闭。可拖动提示做在光标上，不占文字宽度 */}
      <div className="mb-3 flex items-center gap-2">
        <span className="cursor-grab text-[12px] text-mist-300" title="按住空白处可拖动面板">
          参数
        </span>
        <span className="chip !py-0 !text-[10px]">{preset.mode}</span>
        <span className="truncate text-[10px] text-mist-500">
          {preset.label} · {preset.expectedImages}
        </span>
        <button
          type="button"
          className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-md text-[14px] leading-none text-mist-400 hover:bg-ink-700 hover:text-mist-100"
          onClick={close}
          title="关闭（Esc）"
          aria-label="关闭参数面板"
        >
          ×
        </button>
      </div>

      {/* 三列横向布局；窄屏退化为单列 */}
      <div className={narrow ? 'space-y-3.5' : 'grid grid-cols-3 gap-x-4 gap-y-3'}>
        {/* 第 1 列：生成方式 + 模型 + 清晰度 */}
        <section className="space-y-3">
          <div>
            <div className="panel-label">生成方式</div>
            <div className="grid grid-cols-2 gap-1.5">
              {PRESETS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="seg-item !px-1 !py-1.5 !text-[12px]"
                  data-active={methodId === option.id}
                  onClick={() => switchMethod(option.id)}
                  title={option.description}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="panel-label">模型</div>
            <div className="space-y-1.5">
              {(['MiniMax-H3', 'MiniMax-H3-Max'] as H3Model[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className="seg-item w-full !py-1.5 !text-[12px]"
                  data-active={model === value}
                  onClick={() => switchModel(value)}
                >
                  {value === 'MiniMax-H3' ? 'H3（全功能）' : 'H3-Max（极速）'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="panel-label">清晰度</div>
            <div className="seg">
              {(['768P', '2K'] as Resolution[]).map((value) => {
                const supported = capability.resolutions.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    className="seg-item"
                    data-active={resolution === value}
                    disabled={!supported}
                    onClick={() => update(nodeId, { resolution: value })}
                    title={supported ? undefined : `${model} 不支持 ${value}`}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* 第 2 列：比例 */}
        <section>
          <div className="panel-label">比例</div>
          <div className="flex flex-wrap gap-1.5">
            {ratioOptions.map((key) => {
              const meta = RATIO_META[key];
              return (
                <button
                  key={key}
                  type="button"
                  className="ratio-tile !h-[64px] !w-[68px] !text-[11px]"
                  data-active={ratio === key}
                  onClick={() => update(nodeId, { ratio: key })}
                >
                  <span className="ratio-glyph" style={{ width: meta.w, height: meta.h }} />
                  {meta.label}
                </button>
              );
            })}
          </div>
          {aspectLocked && (
            <p className="mt-1.5 text-[10px] leading-snug text-mist-400">
              宽高比由输入图片决定，接口会忽略其他取值，因此只保留「自适应」。
            </p>
          )}
          {methodId === '文生视频' && (
            <p className="mt-1.5 text-[10px] leading-snug text-amber-300">
              文生视频必须指定具体宽高比，不能使用「自适应」。
            </p>
          )}
        </section>

        {/* 第 3 列：时长 + 有声视频 */}
        <section className="space-y-3">
          <div>
            <div className="panel-label">时长</div>
            <div className="flex flex-wrap gap-1.5">
              {DURATIONS.map((value) => {
                const supported = value >= capability.minDuration && value <= capability.maxDuration;
                return (
                  <button
                    key={value}
                    type="button"
                    className="tile !min-w-[40px] !px-1 !text-[11px]"
                    data-active={duration === value}
                    disabled={!supported}
                    onClick={() => update(nodeId, { duration: value })}
                    title={
                      supported ? undefined : `${model} 的时长范围是 ${capability.minDuration}~${capability.maxDuration} 秒`
                    }
                  >
                    {value}s
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="panel-label">有声视频</div>
            <div className="seg seg-compact">
              {(['有声', '无声'] as SoundMode[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className="seg-item !min-w-0 !flex-1 !px-2 !py-1.5 !text-[12px]"
                  data-active={sound === value}
                  onClick={() => update(nodeId, { sound: value })}
                  title={SOUND_DIRECTIVES[value].hint}
                >
                  {value}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] leading-snug text-mist-400">{SOUND_DIRECTIVES[sound].hint}</p>
          </div>
        </section>
      </div>

      {/* 底部一行：本次请求摘要 + 选项 + 动作 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-ink-700 pt-2.5">
        <span className="text-[10px] text-mist-400">
          本次请求：提示词 {slots.text?.text.trim() ? `${slots.text.text.length} 字符` : '未连接'} · 图片 {imageCount} 张
          {hasReferenceMedia && (
            <>
              {' '}
              · 参考视频 {slots.media.filter((m) => m.ref.kind === 'video').length} 段 / 音频{' '}
              {slots.media.filter((m) => m.ref.kind === 'audio').length} 段
            </>
          )}{' '}
          · 场景 <span className="mono text-mist-300">{preset.mode}</span>
        </span>

        <span className="ml-auto" />

        <label className="flex items-center gap-1.5 text-[11px] text-mist-300">
          <input
            type="checkbox"
            checked={params.aigcWatermark === true}
            onChange={(event) => update(nodeId, { aigcWatermark: event.target.checked })}
          />
          AIGC 水印
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-mist-300">
          <input
            type="checkbox"
            checked={params.confirmBeforeRun !== false}
            onChange={(event) => update(nodeId, { confirmBeforeRun: event.target.checked })}
          />
          运行前确认
        </label>

        <span className="chip !py-0.5 !text-[10px]">
          预估 {estimate ? formatCny(estimate.breakdown.total) : '—'}
        </span>
        <button
          type="button"
          className="rounded-md border border-ink-600 px-2 py-1 text-[11px] text-mist-300 hover:bg-ink-800"
          onClick={openGuide}
        >
          H3创作指南
        </button>
        <button
          type="button"
          className={classNames('btn btn-xs btn-primary !text-[11px]')}
          onClick={() => void runNodes([nodeId])}
          disabled={node.data.runtime?.status === 'running' || node.data.runtime?.status === 'queued'}
        >
          ▶ 生成
        </button>
      </div>
    </NodeFloatingPanel>
  );
}