export const ROOM_TYPE_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;

export type RoomTypeStatus = (typeof ROOM_TYPE_STATUSES)[number];

export const ROOM_STATUSES = [
  'VACANT_CLEAN',
  'VACANT_DIRTY',
  'OCCUPIED',
  'MAINTENANCE',
  'DISABLED',
] as const;

export type RoomStatus = (typeof ROOM_STATUSES)[number];

/**
 * 人工可执行的房态迁移（M5，database-design §5.2）。
 * OCCUPIED 的迁入/迁出只发生在入住/退房事务中，不允许经 M5 手工设置。
 */
export const ROOM_STATUS_MANUAL_TRANSITIONS: Record<RoomStatus, readonly RoomStatus[]> = {
  VACANT_CLEAN: ['MAINTENANCE', 'DISABLED'],
  VACANT_DIRTY: ['VACANT_CLEAN', 'MAINTENANCE', 'DISABLED'],
  MAINTENANCE: ['VACANT_DIRTY', 'DISABLED'],
  DISABLED: ['VACANT_DIRTY'],
  OCCUPIED: [],
};

/** 进入/退出 MAINTENANCE、DISABLED 需要 ADMIN（architecture §1.7 权限矩阵） */
export const ADMIN_ONLY_ROOM_STATUSES: readonly RoomStatus[] = ['MAINTENANCE', 'DISABLED'];

export const BOOKING_STATUSES = ['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * 预订状态迁移（database-design §5.1）。
 * - CONFIRMED → CHECKED_IN 由预订入住（B6，T-10）执行
 * - CONFIRMED → CANCELLED/NO_SHOW 由 B4/B5 执行（事务内先锁房型行释放房量）
 * - CANCELLED / NO_SHOW / CHECKED_IN 为终态（CHECKED_IN 后由 stay 承接）
 */
export const BOOKING_STATUS_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export const STAY_STATUSES = ['CHECKED_IN', 'CHECKED_OUT'] as const;

export type StayStatus = (typeof STAY_STATUSES)[number];

/** 入住状态迁移（database-design §5.3）：CHECKED_IN → CHECKED_OUT 仅经退房事务 */
export const STAY_STATUS_TRANSITIONS: Record<StayStatus, readonly StayStatus[]> = {
  CHECKED_IN: ['CHECKED_OUT'],
  CHECKED_OUT: [],
};

export const PAYMENT_METHODS = ['CASH', 'WECHAT', 'ALIPAY', 'BANK_CARD', 'MIXED'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ORDER_STATUSES = ['UNPAID', 'PAID'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_ITEM_TYPES = ['ROOM_FEE', 'MISC', 'DEPOSIT_APPLIED'] as const;

export type OrderItemType = (typeof ORDER_ITEM_TYPES)[number];

export const ID_TYPES = ['ID_CARD', 'PASSPORT', 'OTHER'] as const;

export type IdType = (typeof ID_TYPES)[number];

/** database-design §5 约定的 STATES / TRANSITIONS 常量导出（前端仅用于展示映射） */
export const STATES = {
  ROOM_TYPE: ROOM_TYPE_STATUSES,
  ROOM: ROOM_STATUSES,
  BOOKING: BOOKING_STATUSES,
  STAY: STAY_STATUSES,
  ORDER: ORDER_STATUSES,
} as const;

export const TRANSITIONS = {
  ROOM_MANUAL: ROOM_STATUS_MANUAL_TRANSITIONS,
  BOOKING: BOOKING_STATUS_TRANSITIONS,
  STAY: STAY_STATUS_TRANSITIONS,
} as const;
