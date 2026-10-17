import type { BookingDetailDto, OrderDto, StayDetailDto } from '@hms/shared';

import { getBooking } from '@/api/bookings';
import { getOrder } from '@/api/orders';
import { getStay } from '@/api/stays';
import { toApiRequestError, type ApiRequestError } from '@/utils/errors';

/**
 * 入住请求是否需要查询服务端核对。
 * ROOM_NOT_ASSIGNABLE 也纳入：后端先校验房间再校验预订，
 * 重复入住时可能因房间已 OCCUPIED 返回该错误而非 BOOKING_STATUS_INVALID；
 * 是否真正成功仍由 B3 预订状态决定。
 */
export function shouldReconcileCheckInError(error: ApiRequestError): boolean {
  return (
    error.isNetworkError ||
    (error.status !== undefined && error.status >= 500) ||
    error.code === 'BOOKING_STATUS_INVALID' ||
    error.code === 'ROOM_NOT_ASSIGNABLE'
  );
}

export interface CheckInReconciliation {
  confirmed: boolean;
  detail: BookingDetailDto | null;
}

/**
 * 入住请求结果不确定时核对服务端：
 * 只有预订状态为 CHECKED_IN 且存在 stayId 才视为成功。
 */
export async function reconcileCheckIn(
  bookingId: number,
  fetchBooking: (id: number) => Promise<BookingDetailDto> = getBooking,
): Promise<CheckInReconciliation> {
  try {
    const detail = await fetchBooking(bookingId);
    return {
      confirmed: detail.status === 'CHECKED_IN' && detail.stayId !== null,
      detail,
    };
  } catch {
    return { confirmed: false, detail: null };
  }
}

export interface CheckoutReconciliation {
  completed: boolean;
  stay: StayDetailDto | null;
  order: OrderDto | null;
  orderError: string | null;
}

/**
 * 退房请求结果不确定时核对服务端：
 * - 只有入住状态为 CHECKED_OUT 才视为完成；
 * - 账单详情加载失败不影响“已退房”结论，但会返回错误供 UI 提示。
 */
export async function reconcileCheckout(
  stayId: number,
  deps: {
    fetchStay?: (id: number) => Promise<StayDetailDto>;
    fetchOrder?: (id: number) => Promise<OrderDto>;
  } = {},
): Promise<CheckoutReconciliation> {
  const fetchStay = deps.fetchStay ?? getStay;
  const fetchOrder = deps.fetchOrder ?? getOrder;
  try {
    const stay = await fetchStay(stayId);
    if (stay.status !== 'CHECKED_OUT') {
      return { completed: false, stay, order: null, orderError: null };
    }
    if (stay.order === null) {
      return {
        completed: true,
        stay,
        order: null,
        orderError: '已退房，但服务端未返回关联账单',
      };
    }
    try {
      const order = await fetchOrder(stay.order.id);
      return { completed: true, stay, order, orderError: null };
    } catch (error) {
      return {
        completed: true,
        stay,
        order: null,
        orderError: toApiRequestError(error).message,
      };
    }
  } catch {
    return { completed: false, stay: null, order: null, orderError: null };
  }
}
