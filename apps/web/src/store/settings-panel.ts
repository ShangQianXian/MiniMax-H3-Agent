/**
 * 设置面板的打开状态（全局单例）。
 *
 * 为什么用独立的 store 而不是组件局部 state：
 * 创建台、画布工具条、节点卡片都要能打开同一块面板，且同一时刻只应该有一块面板打开。
 */
import { create } from 'zustand';

interface SettingsPanelState {
  /** 当前展开设置面板的节点；null 表示没有 */
  nodeId: string | null;
  /** 创作台是否展开 */
  composerOpen: boolean;
  /** H3 创作指南弹窗 */
  guideOpen: boolean;
  open: (nodeId: string) => void;
  close: () => void;
  toggle: (nodeId: string) => void;
  setComposerOpen: (open: boolean) => void;
  openGuide: () => void;
  closeGuide: () => void;
}

export const useSettingsPanel = create<SettingsPanelState>((set, get) => ({
  nodeId: null,
  composerOpen: true,
  guideOpen: false,

  open: (nodeId) => set({ nodeId }),
  close: () => set({ nodeId: null }),
  toggle: (nodeId) => set({ nodeId: get().nodeId === nodeId ? null : nodeId }),
  setComposerOpen: (open) => set({ composerOpen: open }),
  openGuide: () => set({ guideOpen: true }),
  closeGuide: () => set({ guideOpen: false }),
}));
