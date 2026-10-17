import type { BookingStatus } from '@hms/shared';

type TagType = 'success' | 'warning' | 'info' | 'danger';

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  CONFIRMED: '已确认',
  CHECKED_IN: '已入住',
  CANCELLED: '已取消',
  NO_SHOW: '未到',
};

export const BOOKING_STATUS_TAG_TYPES: Record<BookingStatus, TagType> = {
  CONFIRMED: 'success',
  CHECKED_IN: 'info',
  CANCELLED: 'info',
  NO_SHOW: 'warning',
};
