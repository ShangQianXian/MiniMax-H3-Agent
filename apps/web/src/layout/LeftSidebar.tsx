/**
 * 左侧栏 —— 对齐参考图 1：
 *
 *   ▣ MiniMax H3                ← 品牌行
 *   ＋ 开始创作                  ← 主行动入口
 *   项目库 / Skill / 节点库 / 任务中心
 *   ─────────
 *   项目  ⌄
 *     项目名
 *       ▣ 工作流条目及重命名、删除操作
 *   （下方留白）
 *   ⚡ 本地工作区          v0.1   ← 底部账号行
 *
 * 参考图里的「ComfyUI 工作流 Beta」按需求不做，位置由「节点库」占用。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NODE_DEFS,
  SKILL_CATEGORY_LABELS,
  type NodeKind,
  type SkillCategory,
  type SkillTemplate,
} from '@h3/shared';
import { useGraph } from '../store/graph.ts';
import { useSettingsPanel } from '../store/settings-panel.ts';
import { Icon } from './Icon.tsx';
import { ProjectTree, ProjectActionDialog, type ProjectAction } from './ProjectManager.tsx';
import { DRAG_MIME } from '../canvas/FlowCanvas.tsx';
import { api, ApiRequestError } from '../api/client.ts';
import { classNames, formatTime } from '../lib/media.ts';

type Panel = 'projects' | 'skills' | 'nodes' | 'tasks';

const PANEL_TITLE: Record<Panel, string> = {
  projects: '项目库',
  skills: 'Skill',
  nodes: '节点库',
  tasks: '任务中心',
};

const GROUP_ORDER = ['输入', '组织', '任务', '管理'] as const;
const GROUP_LABELS: Record<(typeof GROUP_ORDER)[number], string> = {
  输入: '输入',
  组织: '组织',
  任务: '任务',
  管理: '管理',
};

export function LeftSidebar() {
  const [panel, setPanel] = useState<Panel>('projects');
  const activeProjectId = useGraph((s) => s.activeProjectId);
  const busy = useGraph((s) => s.workspaceBusy);
  const tasks = useGraph((s) => s.tasks);
  const setComposerOpen = useSettingsPanel((s) => s.setComposerOpen);
  const [action, setAction] = useState<ProjectAction | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pendingCount = tasks.filter((t) => t.status === 'queued' || t.status === 'running').length;

  const navItem = (value: Panel, icon: 'folder' | 'spark' | 'nodes' | 'tasks') => (
    <button
      key={value}
      type="button"
      onClick={() => {
        setPanel(value);
        if (value === 'projects') setMobileOpen((value) => !value);
      }}
      className={classNames(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors',
        panel === value ? 'bg-ink-800 text-mist-100' : 'text-mist-300 hover:bg-ink-850 hover:text-mist-100',
      )}
      aria-label={PANEL_TITLE[value]}
    >
      <Icon name={icon} size={19} />
      <span>{PANEL_TITLE[value]}</span>
      {value === 'tasks' && pendingCount > 0 && (
        <span className="ml-auto rounded-full bg-blue-500/15 px-1.5 text-[10px] text-blue-300">{pendingCount}</span>
      )}
    </button>
  );

  return (
    <aside className={`workspace-sidebar flex h-full shrink-0 flex-col ${mobileOpen ? 'mobile-projects-open' : ''}`}>
      {/* 品牌行 */}
      <div className="sidebar-brand">
        <span className="brand-symbol"><Icon name="wave" size={22} /></span>
        <span>MiniMax <strong>H3</strong><small>H3 VIDEO WORKSPACE</small></span>
      </div>

      <button type="button" className="mobile-project-close" aria-label="收起项目库" onClick={() => setMobileOpen(false)}><Icon name="close" size={18} /></button>
      {/* 主导航 */}
      <nav className="shrink-0 space-y-0.5 px-2">
        <button
          type="button"
          onClick={() => {
            setComposerOpen(true);
            setAction({ kind: activeProjectId ? 'workflow' : 'project', operation: 'create' });
          }}
          disabled={busy}
          aria-label="开始创作"
          className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] text-mist-100 hover:bg-ink-850"
        >
          <span className="new-workflow-icon"><Icon name="plus" size={18} /></span>
          <span>开始创作</span>
        </button>
        {navItem('projects', 'folder')}
        {navItem('skills', 'spark')}
        {navItem('nodes', 'nodes')}
        {navItem('tasks', 'tasks')}
      </nav>

      {/* 面板内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {panel !== 'projects' && <div className="px-3 pb-1 pt-2 text-[10px] text-mist-500">{PANEL_TITLE[panel]}</div>}
        {panel === 'projects' && <ProjectTree onAction={setAction} />}
        {panel === 'skills' && <SkillsPanel />}
        {panel === 'nodes' && <NodeLibraryPanel />}
        {panel === 'tasks' && <TaskListPanel />}
      </div>

      {/* 底部账号行 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-ink-700/70 px-3 py-2">
        <span
          className="grid h-6 w-6 place-items-center rounded-full text-[10px] text-ink-950"
          style={{ background: '#b9aff2' }}
        >
          A
        </span>
        <span className="text-[12px] text-mist-300">本地工作区</span>
        <span className="ml-auto text-[10px] text-mist-500">v0.1</span>
      </div>

      {action && <ProjectActionDialog action={action} onClose={() => setAction(null)} />}
    </aside>
  );
}

/* ───────────────────────  节点库  ─────────────────────── */

function NodeLibraryPanel() {
  const addNode = useGraph((s) => s.addNode);
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const map = new Map<string, (typeof NODE_DEFS)[NodeKind][]>();
    for (const def of Object.values(NODE_DEFS)) {
      if (query.length > 0 && !`${def.label}${def.description}`.toLowerCase().includes(query.toLowerCase())) {
        continue;
      }
      const list = map.get(def.group) ?? [];
      list.push(def);
      map.set(def.group, list);
    }
    return map;
  }, [query]);

  return (
    <div className="px-3 pb-3">
      <input
        className="field !py-1 !text-[12px]"
        placeholder="搜索节点…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {GROUP_ORDER.map((group) => {
        const items = grouped.get(group);
        if (!items || items.length === 0) return null;
        return (
          <div key={group} className="mt-2.5">
            <div className="mb-1 text-[10px] text-mist-500">{GROUP_LABELS[group]}</div>
            <div className="space-y-0.5">
              {items.map((def) => (
                <div
                  key={def.kind}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_MIME, def.kind);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDoubleClick={() => addNode(def.kind, { x: 140 + Math.random() * 60, y: 120 + Math.random() * 60 })}
                  className="cursor-grab rounded-lg px-2 py-1.5 hover:bg-ink-850 active:cursor-grabbing"
                  title={def.description}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: def.accent }} />
                    <span className="text-[12px] text-mist-200">{def.label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <p className="mt-3 text-[10px] leading-relaxed text-mist-500">
        拖到画布，或双击直接添加。双击画布空白新建提示词节点。
      </p>
    </div>
  );
}

/* ───────────────────────  Skill  ─────────────────────── */

function SkillsPanel() {
  const skills = useGraph((s) => s.skills);
  const loadSkills = useGraph((s) => s.loadSkills);
  const insertSkill = useGraph((s) => s.insertSkill);
  const saveSkillFromSelection = useGraph((s) => s.saveSkillFromSelection);
  const nodes = useGraph((s) => s.nodes);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<SkillCategory | 'all'>('all');

  const filtered = useMemo(
    () => (category === 'all' ? skills : skills.filter((s) => s.category === category)),
    [category, skills],
  );

  const selectedIds = nodes.filter((n) => n.selected).map((n) => n.id);

  const handleCreate = async () => {
    setError(null);
    try {
      const ids = selectedIds.length > 0 ? selectedIds : nodes.map((n) => n.id);
      if (ids.length === 0) throw new Error('画布上还没有节点。');
      await saveSkillFromSelection({
        name: name.trim() || `我的 Skill ${skills.length + 1}`,
        description: description.trim(),
        nodeIds: ids,
      });
      setCreating(false);
      setName('');
      setDescription('');
      await loadSkills();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : (cause as Error).message);
    }
  };

  const handleAction = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await loadSkills();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : (cause as Error).message);
    }
  };

  return (
    <div className="px-3 pb-3">
      <div className="flex items-center gap-1">
        <select
          className="field !py-1 !text-[12px]"
          value={category}
          onChange={(event) => setCategory(event.target.value as SkillCategory | 'all')}
        >
          <option value="all">全部分类</option>
          {(Object.keys(SKILL_CATEGORY_LABELS) as SkillCategory[]).map((key) => (
            <option key={key} value={key}>
              {SKILL_CATEGORY_LABELS[key]}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-xs" onClick={() => setCreating((v) => !v)}>
          {creating ? '取消' : '新建'}
        </button>
      </div>

      {creating && (
        <div className="mt-2 space-y-1 rounded-lg border border-ink-700 bg-ink-850 p-2">
          <input
            className="field !py-1 !text-[12px]"
            placeholder="Skill 名称"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <textarea
            className="field h-[54px] resize-none !text-[11px]"
            placeholder="说明这个 Skill 解决什么问题"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <p className="text-[10px] text-mist-500">
            打包{selectedIds.length > 0 ? `选中的 ${selectedIds.length} 个节点` : `画布上全部 ${nodes.length} 个节点`}
          </p>
          <button type="button" className="btn btn-xs btn-primary w-full" onClick={() => void handleCreate()}>
            创建
          </button>
        </div>
      )}

      <div className="mt-2 space-y-1">
        {filtered.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            onInsert={() => insertSkill(skill, { x: 160 + Math.random() * 80, y: 140 + Math.random() * 80 })}
            onDelete={() => void handleAction(() => api.deleteSkill(skill.id))}
            onDuplicate={() => void handleAction(() => api.duplicateSkill(skill.id))}
          />
        ))}
        {filtered.length === 0 && <p className="py-2 text-[11px] text-mist-500">没有匹配的 Skill。</p>}
      </div>

      {error && <p className="mt-2 rounded-md border border-rose-500/40 p-1.5 text-[11px] text-rose-300">{error}</p>}
    </div>
  );
}

function SkillCard({
  skill,
  onInsert,
  onDelete,
  onDuplicate,
}: {
  skill: SkillTemplate;
  onInsert: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-850 p-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-mist-200">{skill.name}</span>
        {skill.builtin && <span className="text-[10px] text-mist-500">内置</span>}
        <span className="ml-auto text-[10px] text-mist-500">
          {SKILL_CATEGORY_LABELS[skill.category] ?? skill.category}
        </span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-mist-500">{skill.description}</p>
      <div className="mt-1 flex items-center gap-1">
        <button type="button" className="btn btn-xs ml-auto" onClick={onInsert}>
          插入画布
        </button>
        <button type="button" className="btn btn-xs" onClick={onDuplicate}>
          复制
        </button>
        {!skill.builtin && (
          <button type="button" className="btn btn-xs btn-danger" onClick={onDelete}>
            删除
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────  任务列表  ─────────────────────── */

const STATUS_STYLE: Record<string, string> = {
  queued: 'text-sky-300',
  running: 'text-blue-300',
  succeeded: 'text-emerald-300',
  failed: 'text-rose-300',
  cancelled: 'text-orange-300',
};

const STATUS_TEXT: Record<string, string> = {
  queued: '排队',
  running: '运行',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
};

function TaskListPanel() {
  const tasks = useGraph((s) => s.tasks);
  const setTasks = useGraph((s) => s.setTasks);
  const upsertTask = useGraph((s) => s.upsertTask);
  const activeProjectId = useGraph((s) => s.activeProjectId);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [listedIds, setListedIds] = useState<string[] | null>(null);
  const requestSeq = useRef(0);
  const visibleTasks = tasks.filter((task) =>
    (listedIds === null ? !activeProjectId || task.projectId === activeProjectId : listedIds.includes(task.id)) &&
    (filter === 'all' || task.status === filter));

  const load = useCallback(
    async (remote: boolean, nextFilter = filter) => {
      const request = ++requestSeq.current;
      setBusy(true);
      setError(null);
      try {
        const result = await api.listTasks({
          pageSize: 40,
          remote,
          ...(nextFilter !== 'all' ? { status: nextFilter } : {}),
          ...(activeProjectId && !remote ? { projectId: activeProjectId } : {}),
        });
        if (request !== requestSeq.current) return;
        // Filtering is presentation state; retain pending tasks for background polling.
        result.items.forEach(upsertTask);
        setListedIds(result.items.map((task) => task.id));
      } catch (cause) {
        if (request !== requestSeq.current) return;
        setError(cause instanceof ApiRequestError ? cause.message : (cause as Error).message);
      } finally {
        if (request === requestSeq.current) setBusy(false);
      }
    },
    [activeProjectId, filter, upsertTask],
  );

  const handleDelete = async (taskId: string) => {
    setError(null);
    try {
      const result = await api.deleteTask(taskId);
      const existing = tasks.find((t) => t.id === taskId);
      if (result.action === 'cancelled' && existing) upsertTask({ ...existing, status: 'cancelled' });
      else {
        setTasks(useGraph.getState().tasks.filter((task) => task.id !== taskId));
        await load(false);
      }
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : (cause as Error).message);
    }
  };

  return (
    <div className="space-y-1 px-3 pb-3">
      <div className="flex items-center gap-1">
        <select
          className="field !py-1 !text-[11px]"
          value={filter}
          aria-label="任务状态筛选"
          onChange={(event) => {
            setFilter(event.target.value);
            void load(false, event.target.value);
          }}
        >
          <option value="all">全部状态</option>
          <option value="queued">排队中</option>
          <option value="running">运行中</option>
          <option value="succeeded">成功</option>
          <option value="failed">失败</option>
          <option value="cancelled">已取消</option>
        </select>
        <button type="button" className="btn btn-xs" onClick={() => void load(false)} disabled={busy}>
          本地
        </button>
        <button
          type="button"
          className="btn btn-xs"
          onClick={() => void load(true)}
          disabled={busy}
          title="从 MiniMax 拉取最近 7 天"
        >
          远端
        </button>
      </div>

      {visibleTasks.length === 0 && (
        <p className="py-2 text-[11px] text-mist-500">{busy ? '正在加载任务…' : '暂无符合条件的任务。点「远端」可拉取最近 7 天历史。'}</p>
      )}

      {visibleTasks.map((task) => {
        const open = openId === task.id;
        return (
          <div key={task.id} className="rounded-lg border border-ink-700 bg-ink-850">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[10px]"
              onClick={() => setOpenId(open ? null : task.id)}
            >
              <span className={classNames(STATUS_STYLE[task.status])}>{STATUS_TEXT[task.status] ?? task.status}</span>
              <span className="mono truncate text-mist-300">#{task.id.slice(-8)}</span>
              <span className="ml-auto shrink-0 text-mist-500">
                {task.resolution} {task.duration ? `${task.duration}s` : ''}
              </span>
            </button>

            {open && (
              <div className="space-y-1 border-t border-ink-700 px-2 py-1.5 text-[10px] text-mist-300">
                <div className="text-mist-500">
                  {task.taskType} · {formatTime(task.createdAt)}
                </div>
                {task.promptFinal && (
                  <div className="max-h-[60px] overflow-auto rounded border border-ink-700 bg-ink-900 p-1 leading-snug">
                    {task.promptFinal.slice(0, 240)}
                  </div>
                )}
                {task.errorMessage && <div className="text-rose-300">{task.errorMessage}</div>}
                {Object.keys(task.usage).length > 0 && (
                  <div className="text-mist-500">
                    {task.usage.output_seconds !== undefined && <span>输出 {task.usage.output_seconds}s </span>}
                    {task.usage.total_tokens !== undefined && <span>tokens {task.usage.total_tokens}</span>}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                  {task.contentUrl && (
                    <a className="btn btn-xs" href={task.contentUrl} target="_blank" rel="noreferrer">
                      打开产物
                    </a>
                  )}
                  {task.taskType !== 'h3_context_ir' && task.contentUrl && (
                    <button
                      type="button"
                      className="btn btn-xs"
                      onClick={() => void api.saveArtifact(task.id).then((r) => upsertTask(r.task))}
                    >
                      转存
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-xs"
                    disabled={task.status !== 'queued'}
                    onClick={() => void handleDelete(task.id)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs btn-danger"
                    disabled={task.status !== 'succeeded' && task.status !== 'failed'}
                    onClick={() => void handleDelete(task.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {error && <p className="rounded-md border border-rose-500/40 p-1.5 text-[10px] text-rose-300">{error}</p>}
      <p className="text-[10px] text-mist-500">本地缓存 · MiniMax 侧仅保留 7 天</p>
    </div>
  );
}
