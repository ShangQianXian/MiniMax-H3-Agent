import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/*.test.ts',
      'packages/**/*.test.tsx',
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
      // 启动器是纯 Node 脚本，单独放在 scripts/ 下
      'scripts/**/*.test.mjs',
    ],
    environment: 'node',
    globals: false,
    // 启动器集成测试要真的拉起服务并等健康检查，默认 5 秒不够
    testTimeout: 90_000,
    hookTimeout: 90_000,
    // 集成测试会调用后端设置接口，必须用独立的临时数据目录，
    // 否则会污染开发用的 data/h3.sqlite（例如把 mock 开关写进去）。
    env: {
      DATA_DIR: '.vitest-data',
    },
    // 生产构建产物与本地数据不参与测试收集
    exclude: ['**/node_modules/**', '**/dist/**', '**/data/**', '**/.vitest-data/**'],
  },
});
