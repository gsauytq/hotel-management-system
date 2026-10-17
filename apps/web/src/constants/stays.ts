import type { OrderItemType, OrderStatus, PaymentMethod, StayStatus } from '@hms/shared';

type TagType = 'success' | 'warning' | 'info' | 'danger';

export const STAY_STATUS_LABELS: Record<StayStatus, string> = {
  CHECKED_IN: '在住',
  CHECKED_OUT: '已退房',
};

export const STAY_STATUS_TAG_TYPES: Record<StayStatus, TagType> = {
  CHECKED_IN: 'success',
  CHECKED_OUT: 'info',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: '现金',
  WECHAT: '微信支付',
  ALIPAY: '支付宝',
  BANK_CARD: '银行卡',
  MIXED: '组合支付',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  UNPAID: '未支付',
  PAID: '已支付',
};

export const ORDER_ITEM_TYPE_LABELS: Record<OrderItemType, string> = {
  ROOM_FEE: '房费',
  MISC: '杂费',
  DEPOSIT_APPLIED: '押金抵扣',
};
