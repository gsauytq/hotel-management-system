import type {
  CheckInBookingRequest,
  CheckoutStayRequest,
  OrderDto,
  Paginated,
  StayDetailDto,
  StayDto,
  StayStatus,
} from '@hms/shared';

import { get, post } from './request';

export interface StayListQuery {
  page: number;
  pageSize: number;
  status?: StayStatus;
  roomId?: number;
  keyword?: string;
  sort?: string;
}

export function toStayListParams(query: StayListQuery): Record<string, unknown> {
  return {
    page: query.page,
    pageSize: query.pageSize,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.roomId === undefined ? {} : { roomId: query.roomId }),
    ...(query.keyword === undefined || query.keyword === '' ? {} : { keyword: query.keyword }),
    ...(query.sort === undefined || query.sort === '' ? {} : { sort: query.sort }),
  };
}

/** S2 入住记录列表 */
export function listStays(query: StayListQuery): Promise<Paginated<StayDto>> {
  return get<Paginated<StayDto>>('/stays', toStayListParams(query), { silent: true });
}

/** S3 入住详情（含实时费用与账单摘要） */
export function getStay(id: number): Promise<StayDetailDto> {
  return get<StayDetailDto>(`/stays/${id}`, undefined, { silent: true });
}

/**
 * B6 预订办理入住（端点挂载在 /bookings）。
 * 失败由入住对话框内联处理，并在网络/5xx 等不确定场景查询服务端状态。
 */
export function checkInBooking(
  bookingId: number,
  payload: CheckInBookingRequest,
): Promise<StayDto> {
  return post<StayDto>(`/bookings/${bookingId}/check-in`, payload, { silent: true });
}

/**
 * S4 退房结算，返回服务端生成的账单。
 * 失败由退房对话框内联处理，并在不确定场景查询服务端状态。
 */
export function checkoutStay(stayId: number, payload: CheckoutStayRequest): Promise<OrderDto> {
  return post<OrderDto>(`/stays/${stayId}/checkout`, payload, { silent: true });
}
