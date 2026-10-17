import type {
  BookingDetailDto,
  BookingDto,
  BookingStatus,
  CancelBookingRequest,
  CreateBookingRequest,
  Paginated,
} from '@hms/shared';

import { get, post } from './request';

export interface BookingListQuery {
  page: number;
  pageSize: number;
  status?: BookingStatus;
  guestId?: number;
  keyword?: string;
  checkInDateFrom?: string;
  checkInDateTo?: string;
  checkOutDateFrom?: string;
  checkOutDateTo?: string;
  sort?: string;
}

/** 导出纯参数映射，便于测试查询条件与契约一致 */
export function toBookingListParams(query: BookingListQuery): Record<string, unknown> {
  return {
    page: query.page,
    pageSize: query.pageSize,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.guestId === undefined ? {} : { guestId: query.guestId }),
    ...(query.keyword === undefined || query.keyword === '' ? {} : { keyword: query.keyword }),
    ...(query.checkInDateFrom === undefined ? {} : { checkInDateFrom: query.checkInDateFrom }),
    ...(query.checkInDateTo === undefined ? {} : { checkInDateTo: query.checkInDateTo }),
    ...(query.checkOutDateFrom === undefined ? {} : { checkOutDateFrom: query.checkOutDateFrom }),
    ...(query.checkOutDateTo === undefined ? {} : { checkOutDateTo: query.checkOutDateTo }),
    ...(query.sort === undefined || query.sort === '' ? {} : { sort: query.sort }),
  };
}

/** B2 预订列表 */
export function listBookings(query: BookingListQuery): Promise<Paginated<BookingDto>> {
  return get<Paginated<BookingDto>>('/bookings', toBookingListParams(query), { silent: true });
}

/** B3 预订详情 */
export function getBooking(id: number): Promise<BookingDetailDto> {
  return get<BookingDetailDto>(`/bookings/${id}`, undefined, { silent: true });
}

/**
 * B1 创建预订。失败由创建对话框内联展示（silent）；
 * 不提交 totalPrice 等客户端计算的最终金额。
 */
export function createBooking(payload: CreateBookingRequest): Promise<BookingDto> {
  return post<BookingDto>('/bookings', payload, { silent: true });
}

/** B4 取消预订：仅后端允许 CONFIRMED → CANCELLED */
export function cancelBooking(
  id: number,
  payload: CancelBookingRequest,
): Promise<BookingDetailDto> {
  return post<BookingDetailDto>(`/bookings/${id}/cancel`, payload);
}

/** B5 标记未到：仅后端允许 CONFIRMED 且入住日 ≤ 酒店今日 */
export function markBookingNoShow(id: number): Promise<BookingDetailDto> {
  return post<BookingDetailDto>(`/bookings/${id}/no-show`);
}
