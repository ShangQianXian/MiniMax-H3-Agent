import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * 后端地址由启动器通过 H3_API_PORT 传入：端口被占用时启动器会自动换端口，
 * 这里跟着走，避免写死 8787 导致代理指错地方。
 */
const apiPort = Number.parseInt(process.env.H3_API_PORT ?? '', 10) || 8787;
const apiTarget = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  /**
   * 显式指定根目录。
   * 不写的话 Vite 用 process.cwd() 当根 —— 从仓库根启动（一键启动器就是这么做的）
   * 会去根目录找 index.html，结果整站 404。
   * import.meta.dirname 让配置无论从哪个目录被加载都指向 apps/web。
   */
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    watch: {
      /**
       * 忽略列表（踩过两次坑，这里写全）：
       *  - 编辑器/工具常用「原子写」：先写一个临时文件再改名。若 watcher 正好抓到该文件被占用，
       *    会抛 EBUSY 直接让 Vite 进程崩溃。
       *  - 注意 picomatch 默认不匹配「点开头」的名字，所以 `**\/*.tmpdir\/**` 漏得掉
       *    `.foo.123.tmpdir/bar.tmp` 这种隐藏临时目录 —— 必须单独写一条 `**\/.*.tmpdir\/**`。
       *  - data/ 是运行时数据库与产物：任务一跑就疯狂写盘，不排除会不停触发 HMR。
       *  - scripts/ 只在启动时用，跟前端无关。
       */
      ignored: [
        '**/node_modules/**',
        '**/.pnpm-store/**',
        '**/dist/**',
        '**/data/**',
        '**/scripts/**',
        '**/*.tsbuildinfo',
        '**/*.tmp',
        '**/*.tmpdir',
        '**/*.tmpdir/**',
        '**/.*.tmpdir',
        '**/.*.tmpdir/**',
        '**/.*.tmp',
      ],
    },
    // 前端只访问同源 /api，由 Vite 代理到本地后端，彻底规避 CORS 与密钥暴露
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});

