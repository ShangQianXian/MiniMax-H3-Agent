// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectActionDialog, ProjectTree } from './ProjectManager.tsx';
import { useGraph } from '../store/graph.ts';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('空名称提示错误，有效名称去除首尾空格后创建', async () => {
  const create = vi.spyOn(useGraph.getState(), 'createProject').mockResolvedValue();
  const close = vi.fn();
  render(<ProjectActionDialog action={{ kind: 'project', operation: 'create' }} onClose={close} />);
  fireEvent.click(screen.getByRole('button', { name: '创建' }));
  expect(screen.getByRole('alert').textContent).toContain('不能只包含空格');
  expect(create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  品牌短片  ' } });
  fireEvent.click(screen.getByRole('button', { name: '创建' }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(create).toHaveBeenCalledWith('品牌短片');
});

it('删除必须明确确认；失败保留弹窗和错误信息', async () => {
  const remove = vi.spyOn(useGraph.getState(), 'deleteWorkflow').mockRejectedValue(new Error('服务连接中断'));
  const close = vi.fn();
  render(<ProjectActionDialog action={{ kind: 'workflow', operation: 'delete', id: 'w1', name: '镜头一' }} onClose={close} />);
  expect(remove).not.toHaveBeenCalled();
  expect(screen.getByText(/此操作无法撤销/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('服务连接中断'));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(close).toHaveBeenCalledOnce();
});

it('重命名过程中禁用重复提交，使用目标工作流 ID', async () => {
  let resolve!: () => void;
  const rename = vi.spyOn(useGraph.getState(), 'renameWorkflow').mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
  render(<ProjectActionDialog action={{ kind: 'workflow', operation: 'rename', id: 'w2', name: '旧名称' }} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '新名称' } });
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
  fireEvent.click(screen.getByRole('button', { name: '处理中…' }));
  expect(rename).toHaveBeenCalledExactlyOnceWith('w2', '新名称');
  resolve();
  await waitFor(() => expect(screen.getByRole('button', { name: '保存名称' })).toBeTruthy());
});

it('项目树为项目和工作流提供独立可访问的管理按钮', () => {
  useGraph.setState({ workspaceBusy: false, activeProjectId: 'p1', activeWorkflowId: 'w1',
    projects: [{ id: 'p1', name: '短片', description: '', cover: '', createdAt: 1, updatedAt: 1 }],
    workflows: [{ id: 'w1', projectId: 'p1', name: '开场', graph: { nodes: [], edges: [] }, createdAt: 1, updatedAt: 1 }] });
  const action = vi.fn();
  const { container } = render(<ProjectTree onAction={action} />);
  fireEvent.click(screen.getByRole('button', { name: '重命名工作流：开场' }));
  expect(action).toHaveBeenLastCalledWith({ kind: 'workflow', operation: 'rename', id: 'w1', name: '开场' });
  fireEvent.click(screen.getByRole('button', { name: '删除项目：短片' }));
  expect(action).toHaveBeenLastCalledWith({ kind: 'project', operation: 'delete', id: 'p1', name: '短片' });
  expect(container.querySelector('button button')).toBeNull();
});
