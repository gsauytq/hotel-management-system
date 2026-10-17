import type { Request, Response } from 'express';
import type { Logger } from 'pino';

import type { HealthStatus } from '@hms/shared';

import { runHealthCheck, type HealthCheckDependencies } from './health.service.js';

export interface HealthControllerDependencies extends HealthCheckDependencies {
  logger: Logger;
}

export function createHealthController(deps: HealthControllerDependencies) {
  return async function getHealth(req: Request, res: Response): Promise<void> {
    const result = await runHealthCheck(deps);

    if (result.ok) {
      const payload: HealthStatus = { status: 'ok' };
      res.status(200).json(payload);
      return;
    }

    // 详细失败原因仅落日志（带 requestId），响应不泄露依赖信息（security-design §11）
    deps.logger.error(
      { err: result.error, requestId: req.requestId },
      'health check failed: database unavailable',
    );
    const payload: HealthStatus = { status: 'error' };
    res.status(503).json(payload);
  };
}
