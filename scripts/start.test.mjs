/**
 * 一键启动器的集成测试。
 *
 * 覆盖三件事：
 *   1. --help 能打印用法并正常退出
 *   2. 指定端口启动后，前端与后端都真的可访问，且前端代理指向后端
 *   3. 收掉启动器后端口能被释放（不留孤儿进程）
 *
 * 测试用的是高位端口（默认 55000 起），不会和用户开着的 5173/8787 打架。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const START_SCRIPT = join(ROOT, 'scripts', 'start.mjs');
const RUNTIME_FILE = join(ROOT, 'data', 'dev-runtime.json');

const API_PORT = 55187;
const WEB_PORT = 55173;

function isPortFree(port) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolvePromise(false));
    server.listen({ port, host: '127.0.0.1' }, () => server.close(() => resolvePromise(true)));
  });
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return response;
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // 已经没了
    }
  }
}

describe('--help', () => {
  it('打印用法后以 0 退出', () => {
    const result = spawnSync(process.execPath, [START_SCRIPT, '--help'], { cwd: ROOT, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('一键启动');
    expect(result.stdout).toContain('--mock');
    expect(result.stdout).toContain('--stop');
    expect(result.stdout).toContain('--no-open');
    expect(result.stdout).toContain('启动.cmd');
  });
});

/**
 * 批处理文件的硬性要求（踩过坑，必须钉死）：
 *
 *  1. 换行必须是 CRLF。cmd.exe 解析不了 LF，双击后会一闪而过并报
 *     "The syntax of the command is incorrect."。
 *  2. 内容必须是纯 ASCII。cmd.exe 默认跑在 GBK 代码页，UTF-8 的中文会变乱码；
 *     所有中文都交给 Node 输出（Node 写 UTF-8 到控制台是正常的）。
 */
describe('Windows 批处理文件的硬性要求', () => {
  const cmdFiles = ['启动.cmd', '启动-模拟模式.cmd', '停止.cmd'];

  it.each(cmdFiles)('%s 使用 CRLF 换行', (name) => {
    const path = join(ROOT, name);
    expect(existsSync(path), `${name} 应该存在`).toBe(true);
    const bytes = readFileSync(path);
    const text = bytes.toString('utf8');
    expect(text.includes('\r\n'), `${name} 必须含 CRLF`).toBe(true);
    // 不能有「落单的 LF」：把 CRLF 去掉后不应再有 \n
    expect(text.replace(/\r\n/g, '').includes('\n'), `${name} 不能有落单的 LF`).toBe(false);
  });

  it.each(cmdFiles)('%s 只包含 ASCII 字符', (name) => {
    const text = readFileSync(join(ROOT, name), 'utf8');
    const offenders = [...text].filter((ch) => ch.charCodeAt(0) > 127);
    expect(offenders, `${name} 含有非 ASCII 字符：${offenders.slice(0, 5).join('')}`).toHaveLength(0);
  });

  it.each(cmdFiles)('%s 以 @echo off 开头并调用了启动器', (name) => {
    const text = readFileSync(join(ROOT, name), 'utf8');
    expect(text.startsWith('@echo off')).toBe(true);
    expect(text).toContain('scripts\\start.mjs');
  });
});

describe('--stop', () => {
  it('没有运行时记录时给出可读提示，不报错崩溃', () => {
    const backup = existsSync(RUNTIME_FILE) ? readFileSync(RUNTIME_FILE, 'utf8') : null;
    if (backup !== null) rmSync(RUNTIME_FILE, { force: true });
    try {
      const result = spawnSync(process.execPath, [START_SCRIPT, '--stop'], { cwd: ROOT, encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('停止服务');
      expect(result.stdout).toContain('没有找到运行时记录');
    } finally {
      if (backup !== null) writeFileSync(RUNTIME_FILE, backup);
    }
  });
});

describe('完整启动与退出', () => {
  let launcher = null;
  let launcherPid = null;
  const output = [];

  beforeAll(async () => {
    // 端口被占就先跳过这一组，避免误报
    expect(await isPortFree(API_PORT), `端口 ${API_PORT} 应空闲`).toBe(true);
    expect(await isPortFree(WEB_PORT), `端口 ${WEB_PORT} 应空闲`).toBe(true);

    launcher = spawn(
      process.execPath,
      [START_SCRIPT, '--no-open', '--fresh', '--api-port', String(API_PORT), '--web-port', String(WEB_PORT)],
      { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    launcherPid = launcher.pid;
    launcher.stdout.setEncoding('utf8');
    launcher.stderr.setEncoding('utf8');
    launcher.stdout.on('data', (chunk) => output.push(chunk));
    launcher.stderr.on('data', (chunk) => output.push(chunk));

    // 等后端健康检查通过
    await waitFor(`http://127.0.0.1:${WEB_PORT}/api/health`, 60_000);
  }, 90_000);

  afterAll(() => {
    if (launcherPid) killTree(launcherPid);
    if (existsSync(RUNTIME_FILE)) rmSync(RUNTIME_FILE, { force: true });
  });

  it('前端与后端都监听在 127.0.0.1 上（不是只绑 IPv6）', async () => {
    const web = await fetch(`http://127.0.0.1:${WEB_PORT}/`, { signal: AbortSignal.timeout(5000) });
    expect(web.status).toBe(200);

    const api = await fetch(`http://127.0.0.1:${API_PORT}/api/health`, { signal: AbortSignal.timeout(5000) });
    expect(api.status).toBe(200);
    const health = await api.json();
    expect(health.ok).toBe(true);
  });

  it('前端首页返回的是真正的应用（不是 404 也不是目录列表）', async () => {
    const response = await fetch(`http://127.0.0.1:${WEB_PORT}/`, { signal: AbortSignal.timeout(5000) });
    const html = await response.text();
    expect(html).toContain('<div id="root">');
    expect(html).toContain('/src/main.tsx');
  });

  it('前端代理把 /api 转给了后端', async () => {
    const response = await fetch(`http://127.0.0.1:${WEB_PORT}/api/health`, { signal: AbortSignal.timeout(5000) });
    expect(response.status).toBe(200);
    const health = await response.json();
    // 能有 counts 字段说明确实是后端响应的，不是前端兜底
    expect(health).toHaveProperty('counts');
    expect(health).toHaveProperty('mock');
  });

  it('运行时文件记录了本次启动的真实端口', () => {
    expect(existsSync(RUNTIME_FILE)).toBe(true);
    const runtime = JSON.parse(readFileSync(RUNTIME_FILE, 'utf8'));
    expect(runtime.apiPort).toBe(API_PORT);
    expect(runtime.webPort).toBe(WEB_PORT);
    expect(runtime.pid).toBe(launcherPid);
  });

  it('输出里给出了 WebUI 地址', () => {
    const text = output.join('');
    expect(text).toContain(`http://127.0.0.1:${WEB_PORT}`);
    expect(text).toContain('Node v');
  });

  it('收掉启动器后端口被释放，不留孤儿进程', async () => {
    killTree(launcherPid);
    launcherPid = null;
    // 给 taskkill 一点时间
    await new Promise((r) => setTimeout(r, 2500));

    // 端口应能被重新监听
    expect(await isPortFree(WEB_PORT), `端口 ${WEB_PORT} 应已释放`).toBe(true);
    expect(await isPortFree(API_PORT), `端口 ${API_PORT} 应已释放`).toBe(true);
  }, 20_000);
});
