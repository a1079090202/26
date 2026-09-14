import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // 窗口老机器上的浏览器可能比较旧，目标放低一点
    target: 'es2017',
  },
  server: {
    // 开发时把接口请求转给本机服务（npm start 跑在 8080）
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
});
