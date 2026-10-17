import type { UserStatus } from '@hms/shared';

type TagType = 'success' | 'warning' | 'info' | 'danger';

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: '启用',
  DISABLED: '停用',
};

export const USER_STATUS_TAG_TYPES: Record<UserStatus, TagType> = {
  ACTIVE: 'success',
  DISABLED: 'info',
};

export const USER_SORT_OPTIONS = [
  { value: 'createdAt:desc', label: '最近创建' },
  { value: 'username:asc', label: '用户名升序' },
  { value: 'lastLoginAt:desc', label: '最近登录' },
];
