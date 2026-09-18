/**
 * 生成方式 / 比例 / 有声视频 的契约测试。
 *
 * 这几条直接对应界面上的三张参考图：
 *   图3 —— 点「全能参考」时比例有 7 项（自适应 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 21:9）
 *   图4 —— 点「首尾帧」时比例只剩「自适应」
 * 界面渲染的比例项完全来自 PRESETS[].ratioOptions，所以这些断言等于在守界面行为。
 */
import { describe, expect, it } from 'vitest';
import {
  PRESETS,
  RATIO_META,
  SOUND_DIRECTIVES,
  applySoundDirective,
  coerceRatio,
  isRatioAllowed,
  modeFromPreset,
  presetById,
} from './presets.ts';
import type { Ratio } from './types.ts';

const ALL: Ratio[] = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];

describe('生成方式定义', () => {
  it('四种生成方式，顺序与界面一致', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['全能参考', '首尾帧', '首帧', '文生视频']);
  });

  it('每种方式都声明了自己的场景', () => {
    expect(presetById('全能参考')?.mode).toBe('r2va');
    expect(presetById('首尾帧')?.mode).toBe('i2va');
    expect(presetById('首帧')?.mode).toBe('i2va');
    expect(presetById('文生视频')?.mode).toBe('t2va');
  });

  it('旧的「尾帧」叫法仍能解析（兼容历史工作流）', () => {
    expect(presetById('尾帧')?.id).toBe('首帧');
  });
});

describe('比例选项（对应图3 / 图4）', () => {
  it('全能参考：7 项全给', () => {
    const allowed = ALL.filter((key) => isRatioAllowed('全能参考', key));
    expect(allowed).toEqual(ALL);
    expect(presetById('全能参考')?.ratioLocked).toBe(false);
  });

  it('首尾帧：只剩「自适应」（图4）', () => {
    const allowed = ALL.filter((key) => isRatioAllowed('首尾帧', key));
    expect(allowed).toEqual(['adaptive']);
    expect(presetById('首尾帧')?.ratioLocked).toBe(true);
  });

  it('首帧：只剩「自适应」', () => {
    expect(ALL.filter((key) => isRatioAllowed('首帧', key))).toEqual(['adaptive']);
  });

  it('文生视频：不能选「自适应」', () => {
    const allowed = ALL.filter((key) => isRatioAllowed('文生视频', key));
    expect(allowed).not.toContain('adaptive');
    expect(allowed).toEqual(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']);
  });

  it('每个比例都有图标尺寸定义，界面才能画出选择卡片', () => {
    for (const key of ALL) {
      const meta = RATIO_META[key];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.w).toBeGreaterThan(0);
      expect(meta.h).toBeGreaterThan(0);
    }
  });
});

describe('切换生成方式时的比例收敛', () => {
  it('全能参考 → 首尾帧：16:9 收敛为 adaptive（避免留下会被接口忽略的值）', () => {
    expect(coerceRatio('首尾帧', '16:9')).toBe('adaptive');
    expect(coerceRatio('首帧', '21:9')).toBe('adaptive');
  });

  it('首尾帧 → 全能参考：adaptive 保留', () => {
    expect(coerceRatio('全能参考', 'adaptive')).toBe('adaptive');
  });

  it('全能参考 → 文生视频：adaptive 收敛为 16:9', () => {
    expect(coerceRatio('文生视频', 'adaptive')).toBe('16:9');
  });

  it('允许的值原样保留', () => {
    expect(coerceRatio('全能参考', '9:16')).toBe('9:16');
    expect(coerceRatio('文生视频', '4:3')).toBe('4:3');
  });
});

describe('场景推断', () => {
  it('纯图片 + 全能参考 = r2va；纯图片 + 首帧 = i2va', () => {
    expect(modeFromPreset('全能参考', ['image'])).toBe('r2va');
    expect(modeFromPreset('首帧', ['image'])).toBe('i2va');
  });

  it('出现视频 / 音频参考时一律 r2va', () => {
    expect(modeFromPreset('首帧', ['image', 'audio'])).toBe('r2va');
    expect(modeFromPreset('文生视频', ['video'])).toBe('r2va');
  });

  it('文生视频无素材 = t2va', () => {
    expect(modeFromPreset('文生视频', [])).toBe('t2va');
  });
});

describe('有声视频', () => {
  it('两种模式都有可读说明与提示词指令', () => {
    for (const mode of ['有声', '无声'] as const) {
      expect(SOUND_DIRECTIVES[mode].hint.length).toBeGreaterThan(0);
      expect(SOUND_DIRECTIVES[mode].promptSuffix).toContain('Audio:');
    }
  });

  it('指令会拼在提示词末尾', () => {
    const result = applySoundDirective('一个男孩在海边打篮球', '无声');
    expect(result.startsWith('一个男孩在海边打篮球')).toBe(true);
    expect(result).toContain('completely silent');
  });

  it('幂等：反复切换不会累积多条指令', () => {
    let text = 'test';
    text = applySoundDirective(text, '有声');
    text = applySoundDirective(text, '无声');
    text = applySoundDirective(text, '有声');
    expect((text.match(/Audio:/g) ?? []).length).toBe(1);
    // 原始内容始终保留在开头
    expect(text.startsWith('test')).toBe(true);
  });
});
