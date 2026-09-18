/**
 * 左侧栏 —— 对齐参考图 1：
 *
 *   ▣ MiniMax Design            ← 品牌行
 *   ＋ 开始创作                  ← 主行动入口
 *   项目库 / Skill / 节点库 / 任务中心
 *   ─────────
 *   项目  ⌄
 *     项目名
 *       ▣ 工作流条目（带缩略图）
 *   （下方留白）
 *   ⚡ 本地工作区          v0.1   ← 底部账号行
 *
 * 参考图里的「ComfyUI 工作流 Beta」按需求不做，位置由「节点库」占用。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  NODE_DEFS,
  SKILL_CATEGORY_LABELS,
  type NodeKind,
  type SkillCategory,
  type SkillTemplate,
} from '@h3/shared';
import { useGraph } from '../store/graph.ts';
import { useSettingsPanel } from '../store/settings-panel.ts';
import { DRAG_MIME } from '../canvas/FlowCanvas.tsx';
import { api, ApiRequestError, type AssetRecord } from '../api/client.ts';
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
  const projects = useGraph((s) => s.projects);
  const activeProjectId = useGraph((s) => s.activeProjectId);
  const createProject = useGraph((s) => s.createProject);
  const tasks = useGraph((s) => s.tasks);
  const setComposerOpen = useSettingsPanel((s) => s.setComposerOpen);

  const [projectsOpen, setProjectsOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const pendingCount = tasks.filter((t) => t.status === 'queued' || t.status === 'running').length;

  const handleCreate = useCallback(async () => {
    const name = draftName.trim();
    if (name.length === 0) return;
    setError(null);
    try {
      await createProject(name);
      setDraftName('');
      setCreating(false);
      setProjectsOpen(true);
      setPanel('projects');
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : (cause as Error).message);
    }
  }, [createProject, draftName]);

  const navItem = (value: Panel, icon: string) => (
    <button
      key={value}
      type="button"
      onClick={() => {
        setPanel(value);
        if (value === 'projects') setProjectsOpen(true);
      }}
      className={classNames(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors',
        panel === value ? 'bg-ink-800 text-mist-100' : 'text-mist-300 hover:bg-ink-850 hover:text-mist-100',
      )}
    >
      <span className="w-4 text-center text-[12px] text-mist-400">{icon}</span>
      <span>{PANEL_TITLE[value]}</span>
      {value === 'tasks' && pendingCount > 0 && (
        <span className="ml-auto rounded-full bg-blue-500/15 px-1.5 text-[10px] text-blue-300">{pendingCount}</span>
      )}
    </button>
  );

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-ink-700/70 bg-ink-900">
      {/* 品牌行 */}
      <div className="flex h-9 shrink-0 items-center gap-2 px-3">
        <span className="grid h-5 w-5 place-items-center rounded bg-gradient-to-br from-cyan-glow to-accent-500 text-[10px] font-bold text-ink-950">
          M
        </span>
        <span className="text-[13px] text-mist-100">MiniMax Design</span>
      </div>

      {/* 主导航 */}
      <nav className="shrink-0 space-y-0.5 px-2">
        <button
          type="button"
          onClick={() => {
            setComposerOpen(true);
            void useGraph.getState().createWorkflow(`工作流 ${useGraph.getState().workflows.length + 1}`);
          }}
          className="mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] text-mist-100 hover:bg-ink-850"
        >
          <span className="w-4 text-center text-[12px] text-mist-400">＋</span>
          <span>开始创作</span>
        </button>
        {navItem('projects', '▤')}
        {navItem('skills', '⚙')}
        {navItem('nodes', '▢')}
        {navItem('tasks', '☰')}
      </nav>

      {/* 项目树 */}
      <div className="shrink-0 px-2 pt-3">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 px-1.5 py-1 text-left"
          onClick={() => setProjectsOpen((v) => !v)}
        >
          <span className="text-[12px] text-mist-300">项目</span>
          <span className="text-[10px] text-mist-500">{projectsOpen ? '⌄' : '›'}</span>
          <span className="ml-auto text-[10px] text-mist-500">{projects.length}</span>
        </button>

        {projectsOpen && (
          <div className="mb-2 space-y-0.5">
            {projects.map((project) => (
              <ProjectBranch key={project.id} projectId={project.id} active={project.id === activeProjectId} />
            ))}

            {creating ? (
              <div className="px-1 pt-1">
                <input
                  autoFocus
                  className="field !py-1 !text-[12px]"
                  placeholder="项目名称，回车确认"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') void handleCreate();
                    if (event.key === 'Escape') {
                      setCreating(false);
                      setDraftName('');
                    }
                  }}
                />
              </div>
            ) : (
              <button
                type="button"
                className="w-full rounded-lg px-1.5 py-1 text-left text-[11px] text-mist-500 hover:text-mist-200"
                onClick={() => setCreating(true)}
              >
                ＋ 新建项目
              </button>
            )}
          </div>
        )}
      </div>

      {/* 面板内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-3 pb-1 pt-2 text-[10px] text-mist-500">{PANEL_TITLE[panel]}</div>
        {panel === 'projects' && <ProjectsPanel />}
        {panel === 'skills' && <SkillsPanel />}
        {panel === 'nodes' && <NodeLibraryPanel />}
        {panel === 'tasks' && <TaskListPanel />}
      </div>

      {/* 底部账号行 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-ink-700/70 px-3 py-2">
        <span
          className="grid h-6 w-6 place-items-center rounded-full text-[10px] text-ink-950"
          style={{ background: 'linear-gradient(135deg, #6ee7ff, #f59e0b)' }}
        >
          A
        </span>
        <span className="text-[12px] text-mist-300">本地工作区</span>
        <span className="ml-auto text-[10px] text-mist-500">v0.1</span>
      </div>

      {error && (
        <p className="shrink-0 border-t border-rose-500/30 bg-rose-500/5 p-2 text-[11px] text-rose-300">{error}</p>
      )}
    </aside>
  );
}

/* ───────────────────────  项目树分支  ─────────────────────── */

function ProjectBranch({ projectId, active }: { projectId: string; active: boolean }) {
  const projects = useGraph((s) => s.projects);
  const workflows = useGraph((s) => s.workflows);
  const activeWorkflowId = useGraph((s) => s.activeWorkflowId);
  const selectProject = useGraph((s) => s.selectProject);
  const selectWorkflow = useGraph((s) => s.selectWorkflow);
  const createWorkflow = useGraph((s) => s.createWorkflow);
  const deleteWorkflow = useGraph((s) => s.deleteWorkflow);
  const [open, setOpen] = useState(active);

  const project = projects.find((p) => p.id === projectId);

  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  return (
    <div>
      <button
        type="button"
        className={classNames(
          'flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left',
          active ? 'bg-ink-800 text-mist-100' : 'text-mist-300 hover:bg-ink-850',
        )}
        onClick={() => {
          setOpen((v) => !v);
          if (!active) void selectProject(projectId);
        }}
      >
        <span className="w-3 shrink-0 text-[10px] text-mist-500">{open ? '⌄' : '›'}</span>
        <span className="shrink-0 text-[11px] text-mist-400">▤</span>
        <span className="min-w-0 flex-1 truncate text-[12px]">{project?.name ?? '未命名项目'}</span>
      </button>

      {open && active && (
        <div className="ml-4 space-y-0.5 border-l border-ink-700 pl-1.5 pt-0.5">
          {workflows.map((workflow) => (
            <button
              key={workflow.id}
              type="button"
              onClick={() => void selectWorkflow(workflow.id)}
              className={classNames(
                'group flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[11px]',
                workflow.id === activeWorkflowId ? 'text-mist-100' : 'text-mist-300 hover:bg-ink-850',
              )}
              style={workflow.id === activeWorkflowId ? { background: '#262f40' } : undefined}
            >
              <WorkflowThumb workflowId={workflow.id} />
              <span className="min-w-0 flex-1 truncate">{workflow.name}</span>
              <span
                role="button"
                tabIndex={-1}
                className="hidden shrink-0 px-0.5 text-mist-500 hover:text-rose-300 group-hover:inline"
                title="删除工作流"
                onClick={(event) => {
                  event.stopPropagation();
                  void deleteWorkflow(workflow.id);
                }}
              >
                ×
              </span>
            </button>
          ))}
          <button
            type="button"
            className="w-full rounded-md px-1 py-1 text-left text-[11px] text-mist-500 hover:text-mist-200"
            onClick={() => void createWorkflow(`工作流 ${workflows.length + 1}`)}
          >
            ＋ 新建工作流
          </button>
        </div>
      )}
    </div>
  );
}

/** 工作流缩略图：取项目里最新的产物素材，没有就画一个稳定占位色块 */
function WorkflowThumb({ workflowId }: { workflowId: string }) {
  const projectId = useGraph((s) => s.activeProjectId);
  const [asset, setAsset] = useState<AssetRecord | null>(null);

  useEffect(() => {
    let alive = true;
    if (!projectId) return;
    void api
      .listAssets(projectId)
      .then(({ items }) => {
        if (!alive) return;
        setAsset(items.find((a) => a.kind === 'video') ?? items[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [projectId]);

  const src = asset && asset.localPath ? api.assetContentUrl(asset.id) : '';

  if (src && asset?.kind === 'video') {
    return (
      <span className="relative h-6 w-6 shrink-0 overflow-hidden rounded border border-ink-600 bg-ink-800">
        <video src={src} className="h-full w-full object-cover" muted />
        <span className="absolute inset-0 grid place-items-center text-[8px] text-mist-100">▶</span>
      </span>
    );
  }

  let hash = 0;
  for (let i = 0; i < workflowId.length; i += 1) hash = (hash * 31 + workflowId.charCodeAt(i)) % 360;
  return (
    <span
      className="h-6 w-6 shrink-0 rounded border border-ink-600"
      style={{ background: `linear-gradient(135deg, hsl(${hash} 40% 30%), hsl(${(hash + 48) % 360} 35% 20%))` }}
    />
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

/* ───────────────────────  项目面板  ─────────────────────── */

function ProjectsPanel() {
  const projects = useGraph((s) => s.projects);
  const workflows = useGraph((s) => s.workflows);
  const activeProjectId = useGraph((s) => s.activeProjectId);
  const activeWorkflowId = useGraph((s) => s.activeWorkflowId);
  const selectWorkflow = useGraph((s) => s.selectWorkflow);
  const updateProject = useGraph((s) => s.updateProject);
  const deleteProject = useGraph((s) => s.deleteProject);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = projects.find((p) => p.id === activeProjectId);
  if (!active) return <p className="px-3 py-2 text-[11px] text-mist-500">还没有选中项目。</p>;

  return (
    <div className="space-y-2 px-3 pb-3">
      <div className="rounded-lg border border-ink-700 bg-ink-850 p-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-mist-200">{active.name}</span>
          <button
            type="button"
            className="ml-auto text-[10px] text-mist-500 hover:text-mist-200"
            onClick={() => {
              setRenaming(true);
              setDraft(active.name);
            }}
          >
            重命名
          </button>
        </div>

        {renaming ? (
          <div className="mt-1.5 flex items-center gap-1">
            <input
              autoFocus
              className="field !py-1 !text-[12px]"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  void updateProject(active.id, { name: draft.trim() || active.name }).then(() => setRenaming(false));
                }
                if (event.key === 'Escape') setRenaming(false);
              }}
            />
            <button
              type="button"
              className="btn btn-xs btn-primary"
              onClick={() =>
                void updateProject(active.id, { name: draft.trim() || active.name }).then(() => setRenaming(false))
              }
            >
              保存
            </button>
          </div>
        ) : (
          <p className="mt-1 text-[10px] text-mist-500">
            {workflows.length} 个工作流 · {active.taskCount ?? 0} 个任务
          </p>
        )}

        <button
          type="button"
          className="mt-1.5 text-[10px] text-rose-300/80 hover:text-rose-300"
          onClick={() => {
            if (projects.length <= 1) {
              setError('至少保留一个项目。');
              return;
            }
            void deleteProject(active.id);
          }}
        >
          删除项目
        </button>
      </div>

      <div className="space-y-0.5">
        {workflows.map((workflow) => (
          <button
            key={workflow.id}
            type="button"
            onClick={() => void selectWorkflow(workflow.id)}
            className={classNames(
              'flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px]',
              workflow.id === activeWorkflowId ? 'bg-ink-700 text-mist-100' : 'text-mist-300 hover:bg-ink-850',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{workflow.name}</span>
            <span className="text-[10px] text-mist-500">{workflow.graph.nodes.length}</span>
          </button>
        ))}
      </div>

      {error && <p className="rounded-md border border-rose-500/40 p-1.5 text-[11px] text-rose-300">{error}</p>}
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

  const load = useCallback(
    async (remote: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const result = await api.listTasks({
          pageSize: 40,
          remote,
          ...(filter !== 'all' ? { status: filter } : {}),
          ...(activeProjectId && !remote ? { projectId: activeProjectId } : {}),
        });
        setTasks(result.items);
      } catch (cause) {
        setError(cause instanceof ApiRequestError ? cause.message : (cause as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [activeProjectId, filter, setTasks],
  );

  const handleDelete = async (taskId: string) => {
    setError(null);
    try {
      const result = await api.deleteTask(taskId);
      const existing = tasks.find((t) => t.id === taskId);
      if (result.action === 'cancelled' && existing) upsertTask({ ...existing, status: 'cancelled' });
      else await load(false);
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
          onChange={(event) => {
            setFilter(event.target.value);
            void load(false);
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

      {tasks.length === 0 && (
        <p className="py-2 text-[11px] text-mist-500">还没有任务记录。点「远端」可拉取最近 7 天历史。</p>
      )}

      {tasks.map((task) => {
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
