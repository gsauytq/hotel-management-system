import { defineConfig } from 'vitest/config';

const runIntegration = process.env['HMS_INTEGRATION'] === '1';

const defaultExcludes = ['**/node_modules/**', '**/dist/**'];

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 集成测试需要真实 MySQL（HMS_INTEGRATION=1 时启用；数据库连接见 apps/server/.env）
    exclude: runIntegration ? defaultExcludes : [...defaultExcludes, 'tests/integration/**'],
    // 集成测试文件串行执行：避免不同测试文件的 afterAll 清理（删除父表行）
    // 与其他文件并发入住/退房（FK 子表插入）产生 InnoDB 死锁（仅测试隔离问题，非生产逻辑）
    fileParallelism: !runIntegration,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
