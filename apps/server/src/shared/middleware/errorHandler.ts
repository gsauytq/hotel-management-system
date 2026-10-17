import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

import type { ApiErrorEnvelope, ErrorDetail } from '@hms/shared';

import { ApiError } from '../http/ApiError.js';
import { JSON_BODY_LIMIT } from '../http/limits.js';

interface BodyParserError extends Error {
  status?: number;
  type?: string;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  if (typeof error !== 'object' || error === null) return false;
  const type = (error as { type?: unknown }).type;
  return typeof type === 'string' && type.startsWith('entity.');
}

function isJsonSyntaxError(error: unknown): error is BodyParserError {
  return error instanceof SyntaxError && (error as BodyParserError).status === 400;
}

function isPrismaKnownError(error: unknown): error is { code: string; meta?: unknown } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    /^P\d{4}$/.test((error as { code: string }).code)
  );
}

function zodDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)',
    message: issue.message,
  }));
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, _next) => {
    const requestId = req.requestId;
    let apiError: ApiError;

    if (error instanceof ApiError) {
      apiError = error;
    } else if (error instanceof ZodError) {
      apiError = ApiError.validation('参数校验失败', zodDetails(error));
    } else if (isBodyParserError(error) && error.type === 'entity.too.large') {
      // 请求体超限属客户端参数错误；错误码表无 413，统一归入 INVALID_BODY（400）
      apiError = ApiError.badRequest(`请求体超过大小限制（${JSON_BODY_LIMIT}）`);
    } else if (isJsonSyntaxError(error)) {
      apiError = ApiError.badRequest('请求体不是合法的 JSON');
    } else if (isPrismaKnownError(error) && error.code === 'P2025') {
      apiError = ApiError.notFound('资源不存在');
    } else {
      // 注意：P2002（唯一约束）等 Prisma 冲突必须由服务层翻译为业务错误码
      // （api-contract §1.5）；未翻译的数据库错误视为服务端缺陷，统一 500。
      logger.error({ err: error, requestId }, 'unhandled request error');
      apiError = ApiError.internal();
    }

    const envelope: ApiErrorEnvelope = {
      error: {
        code: apiError.code,
        message: apiError.message,
        ...(apiError.details ? { details: apiError.details } : {}),
        ...(apiError.status >= 500 ? { requestId } : {}),
      },
    };
    res.status(apiError.status).json(envelope);
  };
}
