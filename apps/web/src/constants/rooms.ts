import type { RoomStatus, RoomTypeStatus } from '@hms/shared';

type TagType = 'success' | 'warning' | 'info' | 'danger';

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  VACANT_CLEAN: '空闲 · 已清洁',
  VACANT_DIRTY: '空闲 · 待清洁',
  OCCUPIED: '在住',
  MAINTENANCE: '维修中',
  DISABLED: '已停用',
};

export const ROOM_STATUS_TAG_TYPES: Record<RoomStatus, TagType> = {
  VACANT_CLEAN: 'success',
  VACANT_DIRTY: 'warning',
  OCCUPIED: 'danger',
  MAINTENANCE: 'info',
  DISABLED: 'info',
};

export const ROOM_TYPE_STATUS_LABELS: Record<RoomTypeStatus, string> = {
  ACTIVE: '启用',
  ARCHIVED: '已归档',
};

export const ROOM_TYPE_STATUS_TAG_TYPES: Record<RoomTypeStatus, TagType> = {
  ACTIVE: 'success',
  ARCHIVED: 'info',
};

export const ROOM_STATUS_ACTION_LABELS: Record<RoomStatus, string> = {
  VACANT_CLEAN: '清洁完成',
  VACANT_DIRTY: '恢复为待清洁',
  OCCUPIED: '设为在住',
  MAINTENANCE: '报维修',
  DISABLED: '停用',
};
