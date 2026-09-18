/**
 * 任务轮询器：对非终态任务做自适应间隔轮询，进程重启后自动恢复。
 *
 * 为什么用轮询而不是 callback_url：接口的回调需要 MiniMax 服务器能访问到我们的地址，
 * 本地 127.0.0.1 不可达；且回调前要先原样回显 challenge 完成验证。轮询是本地部署的可靠选择。
 *
 * 退避策略：内部 tick 固定 3 秒；queued 任务每次 tick 都查；
 * running 任务按任务自身的轮询次数线性拉长间隔（5s → 最高 15s），避免长时间任务刷爆配额。
 */
import { EventEmitter } from 'node:events';
import type { MinimaxClient } from './minimax.ts';
import type { TaskStore } from './task-store.ts';

export interface PollerOptions {
  tickIntervalMs?: number;
  runningBaseIntervalMs?: number;
  runningMaxIntervalMs?: number;
  batchSize?: number;
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

interface WatchState {
  attempts: number;
  /** 上次实际发起查询的时间戳（毫秒） */
  lastPolledAt: number;
  status: string;
}

export class TaskPoller extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private readonly tickIntervalMs: number;
  private readonly runningBaseIntervalMs: number;
  private readonly runningMaxIntervalMs: number;
  private readonly batchSize: number;
  private readonly states = new Map<string, WatchState>();
  private readonly client: MinimaxClient;
  private readonly store: TaskStore;

  constructor(client: MinimaxClient, store: TaskStore, options: PollerOptions = {}) {
    super();
    this.client = client;
    this.store = store;
    this.tickIntervalMs = options.tickIntervalMs ?? 3000;
    this.runningBaseIntervalMs = options.runningBaseIntervalMs ?? 5000;
    this.runningMaxIntervalMs = options.runningMaxIntervalMs ?? 15000;
    this.batchSize = options.batchSize ?? 8;
  }

  get watchedCount(): number {
    return this.states.size;
  }

  watch(taskId: string, status = 'queued'): void {
    const existing = this.states.get(taskId);
    if (existing) {
      existing.status = status;
    } else {
      this.states.set(taskId, { attempts: 0, lastPolledAt: 0, status });
    }
    this.ensureTimer();
  }

  unwatch(taskId: string): void {
    this.states.delete(taskId);
    if (this.states.size === 0) this.stopTimer();
  }

  /** 进程启动时调用：把库里未完成的任务重新纳入轮询。 */
  resumePending(): number {
    const pending = this.store.pending();
    for (const task of pending) {
      this.states.set(task.id, { attempts: 0, lastPolledAt: 0, status: task.status });
    }
    if (pending.length > 0) {
      this.ensureTimer();
      this.emit('resumed', pending.length);
    }
    return pending.length;
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
    // 轮询定时器不应阻止进程退出
    this.timer.unref?.();
  }

  private stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** 前端手动点「刷新」时立即查一次。 */
  async pollNow(taskId: string): Promise<void> {
    await this.pollOne(taskId);
  }

  /** 计算该任务此刻是否到了该查的时间。 */
  private isDue(state: WatchState, now: number): boolean {
    if (state.lastPolledAt === 0) return true;
    if (state.status === 'queued') return true;
    const interval = Math.min(
      this.runningBaseIntervalMs * Math.max(1, state.attempts),
      this.runningMaxIntervalMs,
    );
    return now - state.lastPolledAt >= interval;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      const due = [...this.states.entries()]
        .filter(([, state]) => this.isDue(state, now))
        .slice(0, this.batchSize)
        .map(([id]) => id);
      await Promise.all(due.map((id) => this.pollOne(id)));
    } finally {
      this.ticking = false;
    }
  }

  private async pollOne(taskId: string): Promise<void> {
    const state = this.states.get(taskId);
    if (state) {
      state.attempts += 1;
      state.lastPolledAt = Date.now();
    }

    try {
      const { task } = await this.client.queryTask(taskId);
      if (state) state.status = task.status;

      const updated = this.store.syncFromApi(task);
      this.emit('update', updated ?? task);

      if (TERMINAL.has(task.status)) {
        this.unwatch(taskId);
        this.emit('settled', updated ?? task);
      }
    } catch (error) {
      // 单次查询失败不应中断轮询：限流、网络抖动、7 天窗口过期都可能发生
      this.emit('poll-error', { taskId, error });
    }
  }

  stop(): void {
    this.stopTimer();
    this.states.clear();
  }
}
