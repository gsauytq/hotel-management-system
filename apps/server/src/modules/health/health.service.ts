export interface HealthCheckDependencies {
  /** 真实数据库探测函数（生产环境由 lib/prisma 的 SELECT 1 实现，不得为空实现） */
  checkDatabase: () => Promise<void>;
}

export interface HealthCheckResult {
  ok: boolean;
  error?: unknown;
}

export async function runHealthCheck(deps: HealthCheckDependencies): Promise<HealthCheckResult> {
  try {
    await deps.checkDatabase();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
