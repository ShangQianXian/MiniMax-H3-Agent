/**
 * 应用外壳：顶栏 + 左侧栏 + 画布 + 右侧检查器 + 状态栏。
 * 同时负责：启动引导、工作流自动保存、付费确认弹窗、全局快捷键。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlowCanvas } from '../canvas/FlowCanvas.tsx';
import { TopBar } from './TopBar.tsx';
import { LeftSidebar } from './LeftSidebar.tsx';
import { WorkspaceEmpty } from './ProjectManager.tsx';
import { InspectorPanel } from './InspectorPanel.tsx';
import { StatusBar } from './StatusBar.tsx';
import { ComposerPanel } from './ComposerPanel.tsx';
import { H3GuideDialog } from './H3GuideDialog.tsx';
import { useGraph } from '../store/graph.ts';
import { useSettingsPanel } from '../store/settings-panel.ts';
import { setConfirmHandler, type ConfirmRequest } from '../engine/run-controls.ts';
import { loadAndRestoreTasks, restoreRuntimes } from '../engine/restore.ts';
import { api } from '../api/client.ts';

export function AppShell() {
  const bootstrap = useGraph((s) => s.bootstrap);
  const save = useGraph((s) => s.save);
  const activeProjectId = useGraph((s) => s.activeProjectId);
  const activeWorkflowId = useGraph((s) => s.activeWorkflowId);
  const workspaceBusy = useGraph((s) => s.workspaceBusy);
  const nodes = useGraph((s) => s.nodes);
  const graphSignature = useGraph((s) => s.graphSignature);
  const workflowName = useGraph((s) => s.workflowName);
  const loadError = useGraph((s) => s.loadError);
  const guideOpen = useSettingsPanel((s) => s.guideOpen);
  const closeGuide = useSettingsPanel((s) => s.closeGuide);
  const composerOpen = useSettingsPanel((s) => s.composerOpen);

  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const resolverRef = useRef<((approved: boolean) => void) | null>(null);
  const [dontAskAgain, setDontAskAgain] = useState(false);
  /**
   * 右侧检查器默认收起 —— 参考图的界面里没有它，参数都在节点弹出的设置面板里。
   * 需要查看请求体 JSON / 字段级校验时才展开（Ctrl+I），默认给画布最大空间。
   */
  const [inspectorOpen, setInspectorOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        setInspectorOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* 启动 */
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  /* 切换项目/工作流后，恢复任务状态与产物预览 */
  useEffect(() => {
    if (!activeWorkflowId) return;
    void loadAndRestoreTasks(activeProjectId).catch(() => undefined);
  }, [activeProjectId, activeWorkflowId]);

  /* 任务轮询：有未完成任务时每 4 秒同步一次（服务端也在轮询，这里只负责把状态推给界面） */
  useEffect(() => {
    const timer = setInterval(async () => {
      const tasks = useGraph.getState().tasks;
      const pending = tasks.filter((t) => t.status === 'queued' || t.status === 'running');
      if (pending.length === 0) return;
      await Promise.all(
        pending.map(async (task) => {
          try {
            const { task: refreshed } = await api.getTask(task.id, true);
            useGraph.getState().upsertTask(refreshed);
            await restoreRuntimes([refreshed]);
          } catch {
            // 网络抖动忽略，下一轮重试
          }
        }),
      );
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  /* 运行前确认 */
  useEffect(() => {
    setConfirmHandler(
      (request) =>
        new Promise<boolean>((resolve) => {
          if (dontAskAgain) {
            resolve(true);
            return;
          }
          resolverRef.current = resolve;
          setConfirmRequest(request);
        }),
    );
    return () => setConfirmHandler(null);
  }, [dontAskAgain]);

  const answerConfirm = useCallback(
    (approved: boolean) => {
      resolverRef.current?.(approved);
      resolverRef.current = null;
      setConfirmRequest(null);
    },
    [],
  );

  /**
   * 自动保存：只在**图谱内容**变化后 900ms 防抖保存。
   *
   * 关键点：依赖 graphSignature 而不是 nodes/edges 引用。
   * 运行时状态（任务进度、产物地址、校验计数）每几秒就会被轮询刷新一次并重建 nodes 数组，
   * 若依赖引用，防抖会被无限重置 —— 表现就是「一直提示已保存」。
   */
  useEffect(() => {
    if (!activeWorkflowId) return;
    const timer = setTimeout(() => void save(), 900);
    return () => clearTimeout(timer);
  }, [activeWorkflowId, graphSignature, save, workflowName]);

  /* 离开前提示未保存 */
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (useGraph.getState().saving) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const retry = useCallback(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <div className="app-shell relative flex h-full flex-col">
      <TopBar />

      <div className="relative flex min-h-0 flex-1">
        <div className="sidebar-slot contents">
          <LeftSidebar />
        </div>

        <main className="workspace-canvas relative min-w-0 flex-1" inert={workspaceBusy}>
          {activeWorkflowId ? <FlowCanvas /> : <WorkspaceEmpty />}

          {activeWorkflowId && composerOpen && <ComposerPanel />}

          {loadError && (
            <div className="absolute left-3 top-3 z-20 max-w-[520px] rounded-lg border border-rose-500/40 bg-rose-950/80 p-2.5 text-[12px] text-rose-200 shadow-xl">
              <div className="font-medium">无法连接本地后端</div>
              <div className="mt-1 leading-snug text-rose-300/90">{loadError}</div>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" className="btn btn-xs" onClick={retry}>
                  重试
                </button>
                <span className="text-[11px] text-rose-300/80">
                  请在仓库根目录运行 <span className="mono">pnpm dev</span>
                </span>
              </div>
            </div>
          )}

          {activeWorkflowId && nodes.length === 0 && !loadError && <EmptyCanvasHint />}
        </main>

        <div className="inspector-slot contents">{inspectorOpen && <InspectorPanel />}</div>
      </div>

      <div className="status-slot contents">
        <StatusBar />
      </div>

      {guideOpen && <H3GuideDialog onClose={closeGuide} />}

      {confirmRequest && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div className="panel w-[440px] max-w-full p-4">
            <h2 className="text-[15px] font-medium">{confirmRequest.title}</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-mist-300">{confirmRequest.message}</p>
            <p className="mt-2 text-[12px] text-amber-300">
              参数：{confirmRequest.estimateText || '—'}。真实 API 模式会产生费用；模拟模式不调用真实接口。
            </p>
            <label className="mt-3 flex items-center gap-2 text-[11px] text-mist-400">
              <input
                type="checkbox"
                checked={dontAskAgain}
                onChange={(event) => setDontAskAgain(event.target.checked)}
              />
              本次会话内不再询问
            </label>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" className="btn" onClick={() => answerConfirm(false)}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={() => answerConfirm(true)}>
                确认运行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyCanvasHint() {
  const skills = useGraph((s) => s.skills);
  const insertSkill = useGraph((s) => s.insertSkill);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[15%] z-10 flex justify-center">
      <div className="pointer-events-auto empty-canvas-hint">
        <h2 className="text-[15px] font-medium">把灵感，连成画面。</h2>
        <p className="mt-1.5 text-[12px] leading-relaxed text-mist-400">
          写下创意，添加参考，让 H3 完成下一个镜头。
          也可以选择一个模板，从节点开始探索。
        </p>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {skills.slice(0, 4).map((skill) => (
            <button
              key={skill.id}
              type="button"
              className="btn btn-xs"
              onClick={() => insertSkill(skill, { x: 200, y: 160 })}
            >
              {skill.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
