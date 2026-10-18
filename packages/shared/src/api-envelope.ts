import type { ErrorCode } from './error-codes.js';
import type { Role, UserStatus } from './roles.js';

export interface ErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
  requestId?: string;
}

export interface ApiErrorEnvelope {
  error: ApiErrorBody;
}

export interface ApiSuccessEnvelope<T> {
  data: T;
}

export interface OkResult {
  ok: boolean;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: Pagination;
}

export interface SessionUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  /** A-20 B：为 true 时仅允许 me/logout/change-password，其他受保护接口返回 403 */
  mustChangePassword: boolean;
}

/** GET /auth/me 响应：会话用户 + 账号状态（api-contract A3） */
export interface CurrentUser extends SessionUser {
  status: UserStatus;
}
