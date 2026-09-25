import { DURATIONS, MODEL_CAPABILITIES, PRESETS, RATIO_META, SOUND_DIRECTIVES, coerceRatio, presetById, type H3Model, type Ratio, type Resolution, type SoundMode } from '@h3/shared';

export interface GenerationValues {
  presetId: string;
  model: H3Model;
  ratio: Ratio;
  resolution: Resolution;
  duration: number;
  sound: SoundMode;
}

/** Shared by the draft composer and saved nodes, so both expose the same capabilities. */
export function GenerationControls({ value, onChange }: {
  value: GenerationValues;
  onChange: (patch: Partial<GenerationValues>) => void;
}) {
  const capability = MODEL_CAPABILITIES[value.model];
  const preset = presetById(value.presetId) ?? PRESETS[0]!;
  return (
    <div className="generation-controls">
      <section>
        <div className="panel-label">生成方式</div>
        <div className="method-tabs">
          {PRESETS.filter((p) => p.id === '全能参考' || p.id === '首尾帧').map((p) => (
            <button key={p.id} type="button" data-active={value.presetId === p.id} aria-pressed={value.presetId === p.id}
              disabled={value.model === 'MiniMax-H3-Max' && p.mode === 'r2va'}
              onClick={() => onChange({ presetId: p.id, ratio: coerceRatio(p.id, value.ratio) })}>{p.label}</button>
          ))}
        </div>
        <div className="method-secondary">
          {PRESETS.filter((p) => p.id === '首帧' || p.id === '文生视频').map((p) => (
            <button key={p.id} type="button" data-active={value.presetId === p.id} aria-pressed={value.presetId === p.id}
              onClick={() => onChange({ presetId: p.id, ratio: coerceRatio(p.id, value.ratio) })}>{p.label}</button>
          ))}
          <span title={preset.expectedImages}>{preset.mode === 'r2va' ? '最多 9 张参考图' : preset.expectedImages}</span>
        </div>
      </section>
      <section>
        <div className="panel-label">比例</div>
        <div className="ratio-grid">
          {preset.ratioOptions.map((ratio) => (
            <button key={ratio} type="button" className="ratio-tile" data-active={value.ratio === ratio}
              aria-pressed={value.ratio === ratio} onClick={() => onChange({ ratio })}>
              <span className="ratio-glyph" style={{ width: RATIO_META[ratio].w, height: RATIO_META[ratio].h }} />
              {RATIO_META[ratio].label}
            </button>
          ))}
        </div>
        {preset.ratioLocked && <p className="control-hint">画面比例将跟随首帧图片。</p>}
      </section>
      <section>
        <div className="panel-label">清晰度</div>
        <div className="seg">{capability.resolutions.map((resolution) => (
          <button key={resolution} type="button" className="seg-item" data-active={value.resolution === resolution}
            aria-pressed={value.resolution === resolution} onClick={() => onChange({ resolution })}>{resolution}</button>
        ))}</div>
      </section>
      <section>
        <div className="panel-label">时长</div>
        <div className="duration-grid">{DURATIONS.filter((n) => n >= capability.minDuration && n <= capability.maxDuration).map((duration) => (
          <button key={duration} type="button" className="tile" data-active={value.duration === duration}
            aria-pressed={value.duration === duration} onClick={() => onChange({ duration })}>{duration}s</button>
        ))}</div>
      </section>
      <section>
        <div className="panel-label">有声视频</div>
        <div className="seg seg-compact">{(['有声', '无声'] as SoundMode[]).map((sound) => (
          <button key={sound} type="button" className="seg-item" data-active={value.sound === sound}
            aria-pressed={value.sound === sound} onClick={() => onChange({ sound })}>{sound}</button>
        ))}</div>
        <p className="control-hint" title={SOUND_DIRECTIVES[value.sound].hint}>通过提示词引导声音生成，最终效果以模型输出为准。</p>
      </section>
    </div>
  );
}
