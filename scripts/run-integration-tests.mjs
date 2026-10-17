#!/usr/bin/env node
/**
 * 集成测试统一入口（docs/test-plan.md §7-2、§8-3）。
 *
 * 背景：apps/server/vitest.config.ts 在未设置 HMS_INTEGRATION=1 时排除 tests/integration/**，
 * 直接 `vitest run` 会静默跳过全部真库用例（含并发/事务/约束）。本脚本显式设置环境变量，
 * 从 apps/server 目录执行，使 dotenv 正确加载 apps/server/.env 的 DATABASE_URL。
 *
 * 用法（在 apps/server 或仓库根目录均可）：
 *   node ../../scripts/run-integration-tests.mjs   # 在 apps/server 下
 *   node scripts/run-integration-tests.mjs         # 在仓库根目录
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(repoRoot, 'apps', 'server');
const binName = process.platform === 'win32' ? 'vitest.cmd' : 'vitest';
const vitestBin = path.join(serverDir, 'node_modules', '.bin', binName);

const result = spawnSync(vitestBin, ['run'], {
  cwd: serverDir,
  stdio: 'inherit',
  env: { ...process.env, HMS_INTEGRATION: '1' },
  shell: process.platform === 'win32',
});

if (result.error !== undefined && result.error !== null) {
  console.error('[test:integration] 无法启动 vitest：', result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`[test:integration] 失败（退出码 ${String(result.status)}）`);
  process.exit(result.status ?? 1);
}

console.info('[test:integration] 集成测试全部通过');
