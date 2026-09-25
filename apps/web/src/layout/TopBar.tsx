/**
 * 顶部菜单栏 —— 对齐参考图：只有「应用名 + 文件/窗口/帮助」，高度很矮。
 * 高频动作（运行、保存、缩放）都挪到画布上，让画布尽量占满。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatCny } from '@h3/shared';
import { useGraph } from '../store/graph.ts';
import { useSettingsPanel } from '../store/settings-panel.ts';
import { resolveNodeSlots } from '../engine/resolve.ts';
import { estimateNode, totalEstimate, type NodeEstimate } from '../engine/estimate.ts';
import { autoLayout } from '../engine/layout.ts';
import { runNodes } from '../engine/run-controls.ts';
import { api, type HealthSnapshot, type SettingsSnapshot } from '../api/client.ts';
import { downloadText } from '../lib/media.ts';
import { SettingsDialog } from './SettingsDialog.tsx';

type MenuId = 'file' | 'window' | 'help';

export function TopBar() {
  const projects = useGraph((s) => s.projects);
  const workflows = useGraph((s) => s.workflows);
  const activeProjectId = useGraph((s) => s.activeProjectId);
  const activeWorkflowId = useGraph((s) => s.activeWorkflowId);
  const workflowName = useGraph((s) => s.workflowName);
  const selectProject = useGraph((s) => s.selectProject);
  const selectWorkflow = useGraph((s) => s.selectWorkflow);
  const save = useGraph((s) => s.save);
  const saving = useGraph((s) => s.saving);
  const savedAt = useGraph((s) => s.savedAt);
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const run = useGraph((s) => s.run);
  const issues = useGraph((s) => s.issues);
  const exportGraph = useGraph((s) => s.exportGraph);
  const importGraph = useGraph((s) => s.importGraph);
  const clearCanvas = useGraph((s) => s.clearCanvas);
  const openGuide = useSettingsPanel((s) => s.openGuide);
  const composerOpen = useSettingsPanel((s) => s.composerOpen);
  const setComposerOpen = useSettingsPanel((s) => s.setComposerOpen);

  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.health().then(setHealth).catch(() => setHealth(null));
    void api.getSettings().then(setSettings).catch(() => setSettings(null));
  }, [settingsOpen]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menu]);

  const errorCount = issues.filter((i) => i.severity === 'error').length;

  const grandTotal = useMemo(() => {
    const map = new Map<string, NodeEstimate>();
    for (const node of nodes) {
      map.set(node.id, estimateNode(node, resolveNodeSlots(node.id, nodes, edges)));
    }
    return totalEstimate(map);
  }, [edges, nodes]);

  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3200);
  }, []);

  const handleRunAll = useCallback(async () => {
    const targets = nodes
      .filter((n) => !n.data.disabled)
      .filter((n) => n.data.kind === 'videoGen' || n.data.kind === 'contextIR' || n.data.kind === 'regenerate')
      .map((n) => n.id);
    if (targets.length === 0) {
      notify('画布上还没有可运行的生成节点。点一下视频节点即可展开设置面板。');
      return;
    }
    const errorsByNode = new Map<string, string>();
    for (const issue of issues) {
      if (issue.severity === 'error' && issue.nodeId && !errorsByNode.has(issue.nodeId)) {
        errorsByNode.set(issue.nodeId, issue.message);
      }
    }
    if (errorsByNode.size > 0) {
      notify(`校验未通过：${[...errorsByNode.values()][0]}`);
      return;
    }
    const result = await runNodes(targets);
    if (result.summary) notify(result.summary);
    else if (result.failed.length > 0) notify(`有 ${result.failed.length} 个节点失败，详见节点上的红色提示。`);
    else notify(`全部完成，用时 ${result.totalSeconds} 秒，共创建 ${result.createdTaskIds.length} 个任务。`);
  }, [issues, nodes, notify]);

  const handleImport = useCallback(
    async (file: File) => {
      try {
        const parsed = JSON.parse(await file.text()) as { graph?: unknown; name?: string };
        const graph = (parsed.graph ?? parsed) as ReturnType<typeof exportGraph>;
        if (!graph || !Array.isArray(graph.nodes)) throw new Error('文件里没有 nodes 数组。');
        await importGraph(graph, parsed.name ?? file.name.replace(/\.json$/i, ''));
        notify('导入成功。');
      } catch (cause) {
        notify(`导入失败：${(cause as Error).message}`);
      }
    },
    [exportGraph, importGraph, notify],
  );

  const apiDot = health?.mock
    ? { color: '#a78bfa', label: 'MOCK 模式，不会调用真实接口' }
    : health?.hasApiKey
      ? health.apiReachable === false
        ? { color: '#f43f5e', label: '接口不可达' }
        : { color: '#22c55e', label: '已就绪' }
      : { color: '#f59e0b', label: '未配置 API Key，点「设置」填写' };

  const menuButton = (id: MenuId, label: string) => (
    <div key={id} className="relative">
      <button
        type="button"
        className="rounded px-2 py-1 text-[12px] text-mist-300 hover:bg-ink-800 hover:text-mist-100"
        onClick={(event) => {
          event.stopPropagation();
          setMenu((v) => (v === id ? null : id));
        }}
      >
        {label}
      </button>
      {menu === id && (
        <div
          className="absolute left-0 top-8 z-50 w-[212px] overflow-hidden rounded-lg border border-ink-600 bg-ink-800 py-1 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          {id === 'file' && (
            <>
              <Item onClick={() => { void save(); setMenu(null); }}>保存工作流</Item>
              <Item
                onClick={() => {
                  downloadText(
                    `${workflowName || 'workflow'}.json`,
                    JSON.stringify({ name: workflowName, graph: exportGraph() }, null, 2),
                  );
                  setMenu(null);
                }}
              >
                导出工作流 JSON
              </Item>
              <Item onClick={() => { fileRef.current?.click(); setMenu(null); }}>导入工作流 JSON</Item>
              <Divider />
              <Item onClick={() => { clearCanvas(); setMenu(null); }}>清空画布</Item>
            </>
          )}
          {id === 'window' && (
            <>
              <Item onClick={() => { autoLayout(); setMenu(null); }}>自动布局</Item>
              <Item onClick={() => { setComposerOpen(!composerOpen); setMenu(null); }}>
                {composerOpen ? '收起创作台' : '展开创作台'}
              </Item>
              <Divider />
              <Item onClick={() => { setSettingsOpen(true); setMenu(null); }}>设置…</Item>
            </>
          )}
          {id === 'help' && (
            <>
              <Item onClick={() => { openGuide(); setMenu(null); }}>H3 创作指南</Item>
              <Item onClick={() => { notify(apiDot.label); setMenu(null); }}>接口状态：{apiDot.label}</Item>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <header className="workspace-topbar relative flex shrink-0 items-center gap-1 border-b border-ink-700/70 bg-ink-900 px-2">
      <span className="px-1.5 text-[12px] text-mist-300">MiniMax H3</span>
      {menuButton('file', '文件')}
      {menuButton('window', '窗口')}
      {menuButton('help', '帮助')}

      <div className="workspace-breadcrumb ml-3 flex items-center gap-1.5 text-[12px]">
        <select
          className="!border-0 !bg-transparent !p-0 !text-[12px] !text-mist-300 outline-none"
          value={activeProjectId ?? ''}
          onChange={(event) => void selectProject(event.target.value).catch((cause: Error) => notify(cause.message))}
          title="切换项目"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <span className="text-mist-500">/</span>
        <select
          className="!border-0 !bg-transparent !p-0 !text-[12px] !text-mist-300 outline-none"
          value={activeWorkflowId ?? ''}
          onChange={(event) => void selectWorkflow(event.target.value).catch((cause: Error) => notify(cause.message))}
          title="切换工作流"
        >
          {workflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.name}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-mist-500">{saving ? '保存中…' : savedAt ? '已保存' : ''}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {errorCount > 0 && (
          <button
            type="button"
            className="rounded-md border border-rose-500/50 bg-rose-500/10 px-1.5 py-0.5 text-[11px] text-rose-300"
            onClick={() => notify(`${errorCount} 个节点存在参数错误，点开对应节点查看。`)}
          >
            {errorCount} 个错误
          </button>
        )}
        <span className="text-[11px] text-mist-400" title="画布上所有会调用接口的节点的预估费用之和">
          预估 {formatCny(grandTotal)}
        </span>
        <button
          type="button"
          className="rounded-md border border-ink-600 px-2 py-0.5 text-[11px] text-mist-200 hover:bg-ink-800 disabled:opacity-40"
          onClick={() => void handleRunAll()}
          disabled={run.running}
        >
          {run.running ? `运行中 ${run.done}/${run.total}` : '▶ 运行全图'}
        </button>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] text-mist-400 hover:bg-ink-800 hover:text-mist-100"
          onClick={() => setSettingsOpen(true)}
          title={apiDot.label}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: apiDot.color }} />
          设置
        </button>
      </div>

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => {
            setSettings(next);
            notify('设置已保存。');
          }}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed left-1/2 top-11 z-50 -translate-x-1/2">
          <div className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-1.5 text-[12px] shadow-xl">{toast}</div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleImport(file);
          event.target.value = '';
        }}
      />
    </header>
  );
}

function Item({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="block w-full px-3 py-1.5 text-left text-[12px] text-mist-200 hover:bg-ink-700"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="my-1 border-t border-ink-700" />;
}
