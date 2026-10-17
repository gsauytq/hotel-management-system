import type { IdType } from '@hms/shared';

export const ID_TYPE_LABELS: Record<IdType, string> = {
  ID_CARD: '身份证',
  PASSPORT: '护照',
  OTHER: '其他证件',
};

export const GUEST_SORT_LABELS: Record<string, string> = {
  'createdAt:desc': '最近创建',
  'name:asc': '姓名升序',
};
