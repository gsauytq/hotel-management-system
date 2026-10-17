import type {
  CreateUserRequest,
  Paginated,
  ResetPasswordRequest,
  Role,
  UpdateUserRequest,
  UserListItemDto,
  UserStatus,
} from '@hms/shared';

import { get, patch, post } from './request';

export interface UserListQuery {
  page: number;
  pageSize: number;
  role?: Role;
  status?: UserStatus;
  keyword?: string;
  sort?: string;
}

export function toUserListParams(query: UserListQuery): Record<string, unknown> {
  return {
    page: query.page,
    pageSize: query.pageSize,
    ...(query.role === undefined ? {} : { role: query.role }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.keyword === undefined || query.keyword === '' ? {} : { keyword: query.keyword }),
    ...(query.sort === undefined || query.sort === '' ? {} : { sort: query.sort }),
  };
}

/** U1 员工列表（ADMIN） */
export function listUsers(query: UserListQuery): Promise<Paginated<UserListItemDto>> {
  return get<Paginated<UserListItemDto>>('/users', toUserListParams(query), { silent: true });
}

/** U5 员工详情（ADMIN） */
export function getUser(id: number): Promise<UserListItemDto> {
  return get<UserListItemDto>(`/users/${id}`, undefined, { silent: true });
}

/** U2 创建员工（ADMIN） */
export function createUser(payload: CreateUserRequest): Promise<UserListItemDto> {
  return post<UserListItemDto>('/users', payload, { silent: true });
}

/** U3 修改员工（ADMIN） */
export function updateUser(id: number, payload: UpdateUserRequest): Promise<UserListItemDto> {
  return patch<UserListItemDto>(`/users/${id}`, payload, { silent: true });
}

/** U4 重置密码（ADMIN；会使该员工所有会话失效） */
export function resetUserPassword(id: number, payload: ResetPasswordRequest): Promise<void> {
  return patch<void>(`/users/${id}/password`, payload, { silent: true });
}
