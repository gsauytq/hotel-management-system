import type { RequestHandler } from 'express';

import { ApiError } from '../http/ApiError.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(ApiError.notFound(`接口不存在: ${req.method} ${req.originalUrl}`));
};
