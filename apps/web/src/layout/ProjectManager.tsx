import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGraph } from '../store/graph.ts';
import { Icon } from './Icon.tsx';

export type ProjectAction = {
  kind: 'project' | 'workflow';
  operation: 'create' | 'rename' | 'delete';
  id?: string;
  name?: string;
};

export function WorkspaceEmpty() {
  const projectId = useGraph((s) => s.activeProjectId);
  const [action, setAction] = useState<ProjectAction | null>(null);
  return <div className="workspace-empty">
    <Icon name={projectId ? 'nodes' : 'folder'} size={36} />
    <h2>{projectId ? '创建你的第一个工作流' : '从一个新项目开始'}</h2>
    <p>{projectId ? '把提示词、参考素材和生成节点连接在同一张画布上。' : '按项目整理工作流，让每一次创作都有自己的空间。'}</p>
    <button type="button" className="btn btn-primary" onClick={() => setAction({ kind: projectId ? 'workflow' : 'project', operation: 'create' })}>
      <Icon name="plus" size={16} />{projectId ? '新建工作流' : '新建项目'}
    </button>
    {action && <ProjectActionDialog action={action} onClose={() => setAction(null)} />}
  </div>;
}

export function ProjectTree({ onAction }: { onAction: (action: ProjectAction) => void }) {
  const projects = useGraph((s) => s.projects);
  const workflows = useGraph((s) => s.workflows);
  const activeProjectId = useGraph((s) => s.activeProjectId);
  const activeWorkflowId = useGraph((s) => s.activeWorkflowId);
  const busy = useGraph((s) => s.workspaceBusy);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [error, setError] = useState('');

  const select = async (kind: 'project' | 'workflow', id: string) => {
    setError('');
    try {
      if (kind === 'project') await useGraph.getState().selectProject(id);
      else await useGraph.getState().selectWorkflow(id);
    } catch (cause) { setError((cause as Error).message); }
  };
  const actions = (kind: ProjectAction['kind'], id: string, name: string) => (
    <div className="project-row-actions">
      <button type="button" disabled={busy} title="重命名" aria-label={`重命名${kind === 'project' ? '项目' : '工作流'}：${name}`}
        onClick={() => onAction({ kind, operation: 'rename', id, name })}><Icon name="edit" size={14} /></button>
      <button type="button" disabled={busy} title="删除" aria-label={`删除${kind === 'project' ? '项目' : '工作流'}：${name}`}
        className="delete-action" onClick={() => onAction({ kind, operation: 'delete', id, name })}><Icon name="trash" size={14} /></button>
    </div>
  );

  return <section className="project-tree" aria-label="项目管理">
    <div className="project-tree-heading"><span>项目</span><small>{projects.length}</small>
      <button type="button" disabled={busy} title="新建项目" aria-label="新建项目" onClick={() => onAction({ kind: 'project', operation: 'create' })}><Icon name="plus" size={16} /></button>
    </div>
    {projects.length === 0 && <p className="project-empty">还没有项目，创建一个项目开始整理你的创意。</p>}
    {projects.map((project) => {
      const active = project.id === activeProjectId;
      const open = active && !collapsed.includes(project.id);
      return <div key={project.id} className="project-branch">
        <div className={`project-row ${active ? 'is-active' : ''}`}>
          <button type="button" disabled={busy} className="project-row-select" aria-expanded={open} title={project.name}
            onClick={() => {
              if (active) setCollapsed((ids) => open ? [...ids, project.id] : ids.filter((id) => id !== project.id));
              else {
                setCollapsed((ids) => ids.filter((id) => id !== project.id));
                void select('project', project.id);
              }
            }}>
            <span className={`project-chevron ${open ? 'is-open' : ''}`}><Icon name="chevron" size={12} /></span>
            <Icon name="folder" size={16} /><span>{project.name}</span>
          </button>
          {actions('project', project.id, project.name)}
        </div>
        {open && <div className="workflow-branches">
          {workflows.map((workflow) => <div key={workflow.id} className={`project-row workflow-row ${workflow.id === activeWorkflowId ? 'is-active' : ''}`}>
            <button type="button" disabled={busy} className="project-row-select" title={workflow.name}
              aria-current={workflow.id === activeWorkflowId ? 'page' : undefined} onClick={() => void select('workflow', workflow.id)}>
              <Icon name="nodes" size={15} /><span>{workflow.name}</span>
            </button>
            {actions('workflow', workflow.id, workflow.name)}
          </div>)}
          {workflows.length === 0 && <p className="project-empty">暂无工作流</p>}
          <button type="button" disabled={busy} className="project-create" onClick={() => onAction({ kind: 'workflow', operation: 'create' })}>
            <Icon name="plus" size={14} />新建工作流
          </button>
        </div>}
      </div>;
    })}
    <button type="button" disabled={busy} className="project-create" onClick={() => onAction({ kind: 'project', operation: 'create' })}>
      <Icon name="plus" size={14} />新建项目
    </button>
    {error && <p role="alert" className="project-error">{error}</p>}
  </section>;
}

export function ProjectActionDialog({ action, onClose }: { action: ProjectAction; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const [name, setName] = useState(action.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const deleting = action.operation === 'delete';
  const label = action.kind === 'project' ? '项目' : '工作流';
  const verb = { create: '新建', rename: '重命名', delete: '删除' }[action.operation];

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    input.current?.select();
    cancel.current?.focus();
    return () => { element.close(); previous?.focus(); };
  }, []);

  const submit = async () => {
    if (submitting.current) return;
    const trimmed = name.trim();
    if (!deleting && (!trimmed || trimmed.length > 80)) {
      setError('名称需为 1–80 个字符，不能只包含空格。');
      input.current?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const store = useGraph.getState();
      if (action.kind === 'project') {
        if (action.operation === 'create') await store.createProject(trimmed);
        else if (action.operation === 'rename') await store.updateProject(action.id!, { name: trimmed });
        else await store.deleteProject(action.id!);
      } else {
        if (action.operation === 'create') await store.createWorkflow(trimmed);
        else if (action.operation === 'rename') await store.renameWorkflow(action.id!, trimmed);
        else await store.deleteWorkflow(action.id!);
      }
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return createPortal(<dialog ref={dialog} className="project-dialog" aria-labelledby="project-dialog-title" aria-describedby="project-dialog-description"
    onCancel={(event) => { event.preventDefault(); if (!submitting.current) onClose(); }}
    onKeyDown={(event) => event.stopPropagation()}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="project-dialog-heading"><span className={deleting ? 'danger-icon' : ''}><Icon name={deleting ? 'trash' : action.kind === 'project' ? 'folder' : 'nodes'} size={22} /></span>
        <h2 id="project-dialog-title">{verb}{label}</h2>
        <button type="button" aria-label="关闭" disabled={busy} onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <p id="project-dialog-description">{deleting
        ? `确定删除“${action.name}”吗？${action.kind === 'project' ? '项目及其全部工作流画布将被删除。' : '此工作流的节点和连线将被删除。'}此操作无法撤销。历史任务和已下载素材会保留，也不会取消正在生成的任务。`
        : action.operation === 'create' ? (action.kind === 'project' ? '为创意新建一个项目，系统会自动创建第一个工作流。' : '在当前项目中创建一张独立的工作流画布。') : '修改名称后立即保存，画布内容保持不变。'}</p>
      {!deleting && <label className="project-name-label">{label}名称
        <input ref={input} autoFocus aria-label={`${label}名称`} className="field" value={name} maxLength={80} disabled={busy}
          placeholder={action.kind === 'project' ? '例如：品牌短片' : '例如：镜头 01 · 开场'}
          onChange={(event) => { setName(event.target.value); setError(''); }} aria-invalid={!!error} aria-describedby={error ? 'project-action-error' : undefined} />
        <small>{name.length} / 80</small>
      </label>}
      {error && <p id="project-action-error" role="alert" className="project-error">{error}</p>}
      <div className="project-dialog-footer">
        <button ref={deleting ? cancel : undefined} type="button" className="btn" disabled={busy} onClick={onClose}>取消</button>
        <button type="submit" className={`btn ${deleting ? 'project-delete-button' : 'btn-primary'}`} disabled={busy}>
          {busy ? '处理中…' : deleting ? '确认删除' : action.operation === 'create' ? '创建' : '保存名称'}
        </button>
      </div>
    </form>
  </dialog>, document.body);
}
