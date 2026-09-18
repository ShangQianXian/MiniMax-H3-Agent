#!/usr/bin/env node
/**
 * 一键启动 MiniMax H3 Agent。
 *
 * 做这些事：
 *   1. 检查 Node 版本与 pnpm
 *   2. 缺依赖就自动装（fresh clone 直接双击也能跑）
 *   3. 没有 .env 就从 .env.example 复制一份
 *   4. 端口被占用就自动往后找空闲端口
 *   5. 同时拉起后端与前端，等后端健康检查通过
 *   6. 自动打开浏览器
 *   7. Ctrl+C 时把两个子进程（含孙进程）一起干净地收掉
 *
 * 用法：
 *   node scripts/start.mjs               正常启动
 *   node scripts/start.mjs --mock        模拟模式（不调用真实接口，不消耗额度）
 *   node scripts/start.mjs --fresh       每个端口都从默认值重新探测
 *   node scripts/start.mjs --no-open     不自动开浏览器
 *   node scripts/start.mjs --api-port 9000 --web-port 4000
 *   node scripts/start.mjs --no-install  缺依赖也不装，直接报错退出
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_FILE = join(ROOT, 'data', 'dev-runtime.json');
const MIN_NODE_MAJOR = 22;
const DEFAULT_API_PORT = 8787;
const DEFAULT_WEB_PORT = 5173;

/* ───────────────────────  参数  ─────────────────────── */

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : null;
};

const options = {
  mock: has('--mock'),
  fresh: has('--fresh'),
  open: !has('--no-open'),
  install: !has('--no-install'),
  stop: has('--stop'),
  apiPort: Number.parseInt(valueOf('--api-port') ?? '', 10) || null,
  webPort: Number.parseInt(valueOf('--web-port') ?? '', 10) || null,
  help: has('--help') || has('-h'),
};

/* ───────────────────────  输出  ─────────────────────── */

const supportsColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const paint = (code, text) => (supportsColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const c = {
  dim: (t) => paint('2', t),
  bold: (t) => paint('1', t),
  red: (t) => paint('31', t),
  green: (t) => paint('32', t),
  yellow: (t) => paint('33', t),
  blue: (t) => paint('34', t),
  magenta: (t) => paint('35', t),
  cyan: (t) => paint('36', t),
};

const log = (...parts) => process.stdout.write(`${parts.join(' ')}\n`);
const step = (text) => log(`${c.cyan('▸')} ${text}`);
const ok = (text) => log(`${c.green('✓')} ${text}`);
const warn = (text) => log(`${c.yellow('!')} ${text}`);

function fail(text, hint) {
  log(`\n${c.red('✗')} ${text}`);
  if (hint) log(`  ${c.dim(hint)}`);
  log('');
  process.exit(1);
}

function printHelp() {
  log(`
${c.bold('MiniMax H3 Agent · 一键启动')}

  node scripts/start.mjs [选项]

  ${c.dim('--mock')}              模拟模式：不调用真实接口，不消耗额度
  ${c.dim('--stop')}              停止上次启动的服务（清理占用的端口）
  ${c.dim('--fresh')}             重新探测端口（忽略上次记住的端口）
  ${c.dim('--no-open')}           不自动打开浏览器
  ${c.dim('--no-install')}        缺依赖时不自动安装
  ${c.dim('--api-port <n>')}      指定后端端口（默认 ${DEFAULT_API_PORT}）
  ${c.dim('--web-port <n>')}      指定前端端口（默认 ${DEFAULT_WEB_PORT}）
  ${c.dim('-h, --help')}          显示本帮助

  Windows 直接双击 ${c.bold('启动.cmd')} 即可；停止用 ${c.bold('停止.cmd')}。`);
}

/* ───────────────────────  工具  ─────────────────────── */

/**
 * 在 PATH 里找一个可执行文件。
 *
 * 为什么不用 spawnSync(command, ['--version'])：
 * Windows 上 pnpm 是 pnpm.cmd，Node 无法在 shell:false 下直接执行它；
 * 而开了 shell:true 又会触发 DEP0190 警告（往 shell 调用里传参数）。
 * 直接查 PATH 最干净，也不依赖 PATHEXT 的解析细节。
 */
function findExecutable(command) {
  const pathValue = process.env.PATH ?? process.env.Path ?? '';
  const dirs = pathValue.split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
      : [''];

  for (const dir of dirs) {
    for (const extension of extensions.length > 0 ? extensions : ['']) {
      const candidate = join(dir, command + extension.toLowerCase());
      if (existsSync(candidate)) return candidate;
      const upper = join(dir, command + extension.toUpperCase());
      if (existsSync(upper)) return upper;
      const bare = join(dir, command);
      if (existsSync(bare)) return bare;
    }
  }
  return null;
}

function isPortFree(port) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolvePromise(false));
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => resolvePromise(true));
    });
  });
}

async function findFreePort(preferred, label) {
  let port = preferred;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isPortFree(port)) {
      if (port !== preferred) warn(`${label} 端口 ${preferred} 被占用，改用 ${port}`);
      return port;
    }
    port += 1;
  }
  fail(`${label} 端口从 ${preferred} 开始连续 40 个都被占用`, '请先用 --api-port / --web-port 指定空闲端口');
  return preferred;
}

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return await response.json();
    } catch {
      // 后端还没起来，继续等
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

function openBrowser(url) {
  const commands = {
    win32: ['cmd', ['/c', 'start', '""', url]],
    darwin: ['open', [url]],
    linux: ['xdg-open', [url]],
  };
  const entry = commands[process.platform] ?? commands.linux;
  try {
    spawn(entry[0], entry[1], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * 收尾清理：把上次启动器留下的进程按端口收掉。
 *
 * 什么时候需要它：启动窗口被强行关掉（点 X、任务管理器结束、终端崩溃）时
 * Ctrl+C 的清理逻辑没机会跑，端口会一直被占着。
 */
function stopPrevious() {
  log('');
  log(`  ${c.bold('MiniMax H3 Agent')} ${c.dim('· 停止服务')}`);
  log('');

  if (!existsSync(RUNTIME_FILE)) {
    warn('没有找到运行时记录，说明不是通过启动器启动的，或已经清理过了');
    log(`  ${c.dim(`（期望的文件：${RUNTIME_FILE}）`)}`);
    return 0;
  }

  let runtime;
  try {
    runtime = JSON.parse(readFileSync(RUNTIME_FILE, 'utf8'));
  } catch {
    warn('运行时记录损坏，无法判断端口');
    return 1;
  }

  const ports = [runtime.apiPort, runtime.webPort].filter((p) => Number.isInteger(p));
  if (ports.length === 0) {
    warn('运行时记录里没有端口信息');
    return 1;
  }

  let cleared = 0;
  for (const [index, port] of ports.entries()) {
    const label = index === 0 ? '后端' : '前端';
    if (killPortOccupant(port)) {
      ok(`已停止占用 ${label} 端口 ${port} 的进程`);
      cleared += 1;
    } else {
      log(`  ${c.dim(`· ${label} 端口 ${port} 本来就是空的`)}`);
    }
  }

  try {
    rmSync(RUNTIME_FILE, { force: true });
  } catch {
    // 删不掉也不影响
  }

  log('');
  if (cleared === 0) warn('没有找到需要停止的进程（可能已经退出，或端口被别的程序占用）');
  else ok('已停止');
  log('');
  return 0;
}

/* ───────────────────────  子进程管理  ─────────────────────── */

const children = [];
let shuttingDown = false;

/**
 * 解析某个包内可执行文件的位置（pnpm 会把依赖软链到各 workspace 包的 node_modules）。
 * 直接执行 node 而不是 `pnpm run`：少一层中间进程，
 * Ctrl+C 时才能把真正的服务进程收干净，不会留下孤儿占着端口。
 */
function resolveBin(pkgDir, relativePath, label) {
  const candidates = [
    join(ROOT, pkgDir, 'node_modules', relativePath),
    join(ROOT, 'node_modules', relativePath),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  fail(`找不到 ${label}（${relativePath}）`, '依赖可能不完整，请重新执行 pnpm install');
  return candidates[0];
}

function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // Windows 上 child.kill() 不会带走孙进程（node --watch 的子进程），必须用 taskkill /T
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

/** 杀掉占用某个端口的进程（兜底清理，防止上次异常退出留下的孤儿）。 */
function killPortOccupant(port) {
  if (process.platform !== 'win32') return false;
  try {
    const result = spawnSync('netstat', ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0 || !result.stdout) return false;
    const pids = new Set();
    for (const line of result.stdout.split(/\r?\n/)) {
      // 形如：  TCP    127.0.0.1:8787    0.0.0.0:0    LISTENING    12345
      const match = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
      if (match && Number(match[1]) === port) pids.add(match[2]);
    }
    let killed = false;
    for (const pid of pids) {
      if (pid === String(process.pid)) continue;
      spawnSync('taskkill', ['/pid', pid, '/T', '/F'], { stdio: 'ignore' });
      killed = true;
    }
    return killed;
  } catch {
    return false;
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`\n${c.dim('正在停止服务…')}`);
  for (const child of children) killTree(child);
  try {
    if (existsSync(RUNTIME_FILE)) writeFileSync(RUNTIME_FILE, JSON.stringify({ stoppedAt: Date.now() }, null, 2));
  } catch {
    // 清理失败不影响退出
  }
  // 给 taskkill 一点时间把子进程收干净，避免端口残留
  setTimeout(() => process.exit(exitCode), process.platform === 'win32' ? 600 : 150);
}

function startProcess(name, color, entry, entryArgs, env, nodeArgs = [], options = {}) {
  const child = spawn(process.execPath, [...nodeArgs, entry, ...entryArgs], {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...env, FORCE_COLOR: supportsColor ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    // 不用 shell：避免多一层 cmd.exe，也让 pid 就是真正的服务进程
    shell: false,
  });

  const prefix = color(`[${name}]`);
  const pipe = (stream, isError) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        process.stdout.write(`${prefix} ${isError ? c.dim(line) : line}\n`);
      }
    });
  };
  pipe(child.stdout, false);
  pipe(child.stderr, true);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    warn(`${name} 进程退出（code=${code ?? 'null'} signal=${signal ?? 'null'}）`);
    // 任一进程挂掉就整体收工，避免留下半死不活的状态
    shutdown(code ?? 1);
  });

  children.push(child);
  return child;
}

/* ───────────────────────  主流程  ─────────────────────── */

async function main() {
  if (options.help) {
    printHelp();
    return;
  }

  if (options.stop) {
    process.exit(stopPrevious());
  }

  log('');
  log(`  ${c.bold('MiniMax H3 Agent')} ${c.dim('· 画布式视频生成工作流')}`);
  log('');

  /* 1. 环境检查 */
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major < MIN_NODE_MAJOR) {
    fail(`Node 版本过低：当前 v${process.versions.node}，需要 v${MIN_NODE_MAJOR} 以上`, '本项目用 Node 原生类型擦除直接运行 TS，无需构建步骤');
  }
  ok(`Node v${process.versions.node}`);

  if (!findExecutable('pnpm')) {
    fail('找不到 pnpm', '安装：npm install -g pnpm   或访问 https://pnpm.io/installation');
  }

  /* 2. 依赖 */
  if (!existsSync(join(ROOT, 'node_modules'))) {
    if (!options.install) {
      fail('依赖尚未安装（node_modules 不存在）', '先运行 pnpm install，或去掉 --no-install');
    }
    step('首次启动，正在安装依赖（约 1–2 分钟）…');
    // Windows 上 pnpm 是 .cmd，spawnSync 必须开 shell 才能执行；
    // 这里不传任何参数（只有 'install'），所以不会有 DEP0190 的参数转义问题
    const install = spawnSync('pnpm', ['install'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, CI: 'true' },
    });
    if (install.status !== 0) {
      fail('依赖安装失败', '可手动执行 pnpm install 查看详细报错');
    }
    ok('依赖安装完成');
  } else {
    ok('依赖已就绪');
  }

  /* 3. 配置文件 */
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) {
    const examplePath = join(ROOT, '.env.example');
    if (existsSync(examplePath)) {
      writeFileSync(envPath, readFileSync(examplePath));
      warn('已从 .env.example 生成 .env —— 想调用真实接口请填入 MINIMAX_API_KEY');
    }
  } else {
    const envText = readFileSync(envPath, 'utf8');
    const match = /^\s*MINIMAX_API_KEY\s*=\s*(.*)$/m.exec(envText);
    const key = match?.[1]?.trim() ?? '';
    if (key.length === 0 && !options.mock) {
      warn('未检测到 MINIMAX_API_KEY —— 可以在界面右上角「设置」里填，或用 --mock 先体验');
    } else if (key.length > 0) {
      ok('已读取 API Key');
    }
  }

  /* 4. 端口 */
  let apiPort = options.apiPort ?? DEFAULT_API_PORT;
  let webPort = options.webPort ?? DEFAULT_WEB_PORT;
  if (!options.fresh && !options.apiPort && existsSync(RUNTIME_FILE)) {
    try {
      const previous = JSON.parse(readFileSync(RUNTIME_FILE, 'utf8'));
      if (Number.isInteger(previous.apiPort) && (await isPortFree(previous.apiPort))) apiPort = previous.apiPort;
      if (Number.isInteger(previous.webPort) && (await isPortFree(previous.webPort))) webPort = previous.webPort;
    } catch {
      // 运行时文件坏了就按默认来
    }
  }
  apiPort = await findFreePort(apiPort, '后端');
  webPort = await findFreePort(webPort, '前端');

  try {
    if (!existsSync(dirname(RUNTIME_FILE))) mkdirSync(dirname(RUNTIME_FILE), { recursive: true });
    writeFileSync(
      RUNTIME_FILE,
      JSON.stringify({ startedAt: Date.now(), apiPort, webPort, mock: options.mock, pid: process.pid }, null, 2),
    );
  } catch {
    // 记不住也没关系
  }

  const url = `http://127.0.0.1:${webPort}`;

  /* 5. 拉起服务 */
  step(options.mock ? '启动服务（模拟模式，不会调用真实接口）' : '启动服务');

  // 兜底：清掉上次异常退出可能留下的孤儿进程。
  // 只在 --fresh（强制重新探测）时做，否则会误杀用户自己开着的服务。
  if (options.fresh) {
    for (const [port, label] of [
      [apiPort, '后端'],
      [webPort, '前端'],
    ]) {
      if (killPortOccupant(port)) warn(`清理了占用 ${label} 端口 ${port} 的残留进程`);
    }
  }

  // 后端直接跑 TS 源码（Node 原生类型擦除）。
  // 用 --watch-path 限定只监听服务端源码：不加的话 node --watch 会盯着整个工作区，
  // node_modules 里任何一次写入都会触发一次无意义的重启。
  const serverEntry = join(ROOT, 'apps', 'server', 'src', 'bin.ts');
  if (!existsSync(serverEntry)) fail(`找不到后端入口 ${serverEntry}`);
  startProcess(
    'api',
    c.magenta,
    serverEntry,
    [],
    {
      PORT: String(apiPort),
      HOST: '127.0.0.1',
      ...(options.mock ? { MOCK_H3: '1', POLL_INTERVAL_MS: '1000' } : {}),
    },
    [`--watch-path=${join(ROOT, 'apps', 'server', 'src')}`, '--watch-path=' + join(ROOT, 'packages', 'shared', 'src')],
  );

  const viteBin = resolveBin('apps/web', join('vite', 'bin', 'vite.js'), 'Vite');
  /*
    两个关键点：

    1) cwd 必须是 apps/web。
       从仓库根启动时 Vite 会用 cwd 当根目录，于是去根目录找 index.html，整站 404。
       （Vite 的 root 是「位置参数」而不是 --root 选项，直接切工作目录最直白可靠。）

    2) --host 必须显式给。
       一旦从命令行传了 --port，Vite 就不再读配置文件里的 host，
       会退回只绑 IPv6 的 ::1，导致 127.0.0.1 连不上。
  */
  startProcess(
    'web',
    c.cyan,
    viteBin,
    ['--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
    {
      // 让 Vite 的 /api 代理指向真实的后端端口
      H3_API_PORT: String(apiPort),
    },
    [],
    { cwd: join(ROOT, 'apps', 'web') },
  );

  /* 6. 等后端就绪 */
  step('等待后端就绪…');
  const health = await waitForHealth(`${url}/api/health`, 45_000);
  if (!health) {
    warn('后端健康检查超时，服务可能仍在启动中，请看上面的日志');
  } else {
    ok(`后端就绪（${health.mock ? '模拟模式' : '真实接口'}${health.hasApiKey ? '' : ' · 未配置 API Key'}）`);
  }

  /* 7. 打开浏览器 */
  log('');
  log(`  ${c.bold('WebUI')}   ${c.cyan(url)}`);
  log(`  ${c.bold('后端')}    http://127.0.0.1:${apiPort}`);
  log(`  ${c.dim('停止服务：在本窗口按 Ctrl+C')}`);
  log('');

  if (options.open) {
    if (openBrowser(url)) ok('已尝试打开浏览器');
    else warn(`无法自动打开浏览器，请手动访问 ${url}`);
  }

  /* 8. 信号处理 */
  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', (error) => {
    log(`\n${c.red('启动器异常')} ${error.message}`);
    shutdown(1);
  });
}

main().catch((error) => {
  fail(error?.message ?? String(error));
});
