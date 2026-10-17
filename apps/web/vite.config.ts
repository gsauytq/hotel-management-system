import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, appRoot, 'VITE_');

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        // changeOrigin 保持 false（默认）：Host 头透传，后端 CSRF Origin 校验按同源通过
        '/api': {
          target: env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:3000',
          changeOrigin: false,
        },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['tests/**/*.spec.ts'],
      setupFiles: ['./tests/setup.ts'],
      restoreMocks: true,
      clearMocks: true,
      // Element Plus 复杂表格/弹窗测试在并行环境下偶发超过默认 5 秒
      testTimeout: 20_000,
      hookTimeout: 20_000,
    },
  };
});
