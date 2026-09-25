import { MODEL_CAPABILITIES, coerceRatio, formatCny, presetById, type H3Model } from '@h3/shared';
import { useGraph } from '../store/graph.ts';
import { useSettingsPanel } from '../store/settings-panel.ts';
import { NodeFloatingPanel } from '../canvas/NodeFloatingPanel.tsx';
import { resolveNodeSlots } from '../engine/resolve.ts';
import { estimateNode } from '../engine/estimate.ts';
import { runNodes } from '../engine/run-controls.ts';
import { GenerationControls, type GenerationValues } from './GenerationControls.tsx';
import { Icon } from './Icon.tsx';

export function NodeSettingsPanel({ nodeId }: { nodeId: string }) {
  const node = useGraph((s) => s.nodes.find((n) => n.id === nodeId));
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const update = useGraph((s) => s.updateNodeParams);
  const close = useSettingsPanel((s) => s.close);
  if (!node) return null;
  const params = node.data.params;
  const value: GenerationValues = {
    presetId: String(params.presetId ?? '全能参考'),
    model: params.model === 'MiniMax-H3-Max' ? 'MiniMax-H3-Max' : 'MiniMax-H3',
    resolution: params.resolution as GenerationValues['resolution'] ?? '768P',
    duration: Number(params.duration ?? 8),
    ratio: params.ratio as GenerationValues['ratio'] ?? 'adaptive',
    sound: params.sound === '无声' ? '无声' : '有声',
  };
  const estimate = estimateNode(node, resolveNodeSlots(nodeId, nodes, edges));
  const changeModel = (model: H3Model) => {
    const cap = MODEL_CAPABILITIES[model];
    const presetId = !cap.supportsReference && presetById(value.presetId)?.mode === 'r2va' ? '首帧' : value.presetId;
    update(nodeId, { model, presetId, ratio: coerceRatio(presetId, value.ratio),
      resolution: cap.resolutions.includes(value.resolution) ? value.resolution : cap.defaultResolution,
      duration: Math.min(cap.maxDuration, Math.max(cap.minDuration, value.duration)) });
  };
  return (
    <NodeFloatingPanel nodeId={nodeId} deps={[value.presetId, value.model]}>
      <div className="settings-heading">
        <span>视频设置</span>
        <button type="button" className="icon-button" onClick={close} aria-label="关闭参数面板" title="关闭（Esc）"><Icon name="close" /></button>
      </div>
      <GenerationControls value={value} onChange={(patch) => update(nodeId, patch)} />
      <details className="advanced-settings">
        <summary>更多设置</summary>
        <label className="flex items-center justify-between gap-3">模型
          <select className="field !w-auto" value={value.model} onChange={(e) => changeModel(e.target.value as H3Model)}>
            <option value="MiniMax-H3">MiniMax H3</option><option value="MiniMax-H3-Max">MiniMax H3 Max</option>
          </select>
        </label>
        <label><input type="checkbox" checked={params.aigcWatermark === true} onChange={(e) => update(nodeId, { aigcWatermark: e.target.checked })} /> AIGC 水印</label>
        <label><input type="checkbox" checked={params.confirmBeforeRun !== false} onChange={(e) => update(nodeId, { confirmBeforeRun: e.target.checked })} /> 运行前确认</label>
      </details>
      <div className="settings-footer">
        <span>预估 {formatCny(estimate.breakdown.total)}</span>
        <button type="button" className="btn btn-primary" onClick={() => void runNodes([nodeId])}
          disabled={node.data.runtime?.status === 'running' || node.data.runtime?.status === 'queued'}>生成视频 <Icon name="arrow" size={15} /></button>
      </div>
    </NodeFloatingPanel>
  );
}
