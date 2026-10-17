import { Router } from 'express';

import { createHealthController, type HealthControllerDependencies } from './health.controller.js';

export function createHealthRouter(deps: HealthControllerDependencies): Router {
  const router = Router();
  router.get('/', createHealthController(deps));
  return router;
}
