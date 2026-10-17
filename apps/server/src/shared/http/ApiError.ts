import {
  HTTP_STATUS_BY_ERROR_CODE,
  type ErrorCode,
  type ErrorDetail,
  type HttpStatusCode,
} from '@hms/shared';

export class ApiError extends Error {
  readonly status: HttpStatusCode;
  readonly code: ErrorCode;
  readonly details: ErrorDetail[] | undefined;

  constructor(status: HttpStatusCode, code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static fromCode(code: ErrorCode, message: string, details?: ErrorDetail[]): ApiError {
    return new ApiError(HTTP_STATUS_BY_ERROR_CODE[code], code, message, details);
  }

  static badRequest(message: string, details?: ErrorDetail[]): ApiError {
    return ApiError.fromCode('INVALID_BODY', message, details);
  }

  static unauthorized(message = '未登录或会话已过期'): ApiError {
    return ApiError.fromCode('SESSION_EXPIRED', message);
  }

  static forbidden(message = '无权限执行该操作'): ApiError {
    return ApiError.fromCode('FORBIDDEN', message);
  }

  static notFound(message = '资源不存在'): ApiError {
    return ApiError.fromCode('NOT_FOUND', message);
  }

  static conflict(code: ErrorCode, message: string, details?: ErrorDetail[]): ApiError {
    return ApiError.fromCode(code, message, details);
  }

  static validation(message = '参数校验失败', details?: ErrorDetail[]): ApiError {
    return ApiError.fromCode('VALIDATION_FAILED', message, details);
  }

  static internal(message = '服务器内部错误'): ApiError {
    return ApiError.fromCode('INTERNAL_ERROR', message);
  }
}
