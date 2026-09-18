/**
 * 底部状态栏：后端连通性、待处理任务数、当前运行进度、快捷键提示。
 */
import { useEffect, useState } from 'react';
import { useGraph } from '../store/graph.ts';
import { api, type HealthSnapshot } from '../api/client.ts';
import { classNames } from '../lib/media.ts';

export function StatusBar() {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [offline, setOffline] = useState(false);
  const run = useGraph((s) => s.run);
  const nodes = useGraph((s) => s.nodes);
  const edges = useGraph((s) => s.edges);
  const tasks = useGraph((s) => s.tasks);
  const past = useGraph((s) => s.past);
  const future = useGraph((s) => s.future);
  const loadError = useGraph((s) => s.loadError);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const result = await api.health();
        if (!alive) return;
        setHealth(result);
        setOffline(false);
      } catch {
        if (!alive) return;
        setOffline(true);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const pending = tasks.filter((t) => t.status === 'queued' || t.status === 'running').length;

  const statusDot = offline
    ? { color: '#f43f5e', text: '后端未连接 —— 请运行 pnpm dev:server' }
    : health?.mock
      ? { color: '#a78bfa', text: 'MOCK 模式（不会调用真实接口）' }
      : health?.hasApiKey
        ? health.apiReachable === false
          ? { color: '#f59e0b', text: health.apiError?.hint ?? 'API 不可达' }
          : { color: '#22c55e', text: `已就绪 · ${health.baseUrl}` }
        : { color: '#f59e0b', text: '未配置 API Key —— 点右上角「设置」填写' };

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-ink-700 bg-ink-900 px-3 text-[11px] text-mist-400">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusDot.color }} />
        <span className="truncate">{statusDot.text}</span>
      </span>

      <span className="h-3 w-px bg-ink-700" />
      <span>
        节点 {nodes.length} · 连线 {edges.length}
      </span>

      {pending > 0 && (
        <>
          <span className="h-3 w-px bg-ink-700" />
          <span className={classNames(pending > 0 && 'text-blue-300')}>{pending} 个任务进行中</span>
        </>
      )}

      {run.running && (
        <>
          <span className="h-3 w-px bg-ink-700" />
          <span className="text-accent-300">
            运行中 {run.done}/{run.total} {run.label && `· ${run.label}`}
          </span>
        </>
      )}

      {loadError && (
        <>
          <span className="h-3 w-px bg-ink-700" />
          <span className="truncate text-rose-300">{loadError}</span>
        </>
      )}

      <span className="ml-auto flex items-center gap-3">
        <span>撤销 {past.length}</span>
        <span>重做 {future.length}</span>
        <span className="hidden md:inline">Shift+L 布局 · Ctrl+Z 撤销 · Delete 删除 · 双击空白加提示词</span>
      </span>
    </footer>
  );
}
