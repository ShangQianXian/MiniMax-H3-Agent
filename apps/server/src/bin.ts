/**
 * 服务启动入口。
 * 开发与生产都直接由 Node 运行 TypeScript（Node 24 原生类型擦除，无需构建步骤）。
 */
import { createApp } from './app.ts';
import { createContext } from './context.ts';
import { REPO_ROOT } from './config.ts';

const ctx = createContext();
const app = createApp(ctx);

const resumed = ctx.poller.resumePending();

app.listen(ctx.config.port, ctx.config.host, () => {
  const lines = [
    '',
    '  MiniMax H3 Agent · 后端已启动',
    `  ▸ 地址       http://${ctx.config.host}:${ctx.config.port}`,
    `  ▸ Base URL   ${ctx.client.mock ? '(MOCK 模式，不会调用真实接口)' : ctx.config.baseUrl}`,
    `  ▸ API Key    ${ctx.client.hasKey ? '已配置' : '未配置 —— 请在界面「设置」中填写，或写入 .env'}`,
    `  ▸ 数据库     ${ctx.config.dbPath}`,
    `  ▸ 素材目录   ${ctx.config.dataDir}`,
    `  ▸ 仓库根目录 ${REPO_ROOT}`,
    resumed > 0 ? `  ▸ 已恢复 ${resumed} 个未完成任务继续轮询` : '  ▸ 无未完成任务',
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
});

const shutdown = (signal: string) => {
  process.stdout.write(`\n[api] 收到 ${signal}，正在停止轮询器...\n`);
  ctx.poller.stop();
  ctx.db.close();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
