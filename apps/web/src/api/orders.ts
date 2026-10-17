import type { OrderDto, OrderSummaryDto, Paginated } from '@hms/shared';

import { get } from './request';

export interface OrderListQuery {
  page: number;
  pageSize: number;
  stayId?: number;
  /** 酒店本地日历日，闭区间 */
  createdFrom?: string;
  /** 酒店本地日历日，闭区间 */
  createdTo?: string;
  sort?: string;
}

/** 导出纯参数映射，便于测试与契约核对 */
export function toOrderListParams(query: OrderListQuery): Record<string, unknown> {
  return {
    page: query.page,
    pageSize: query.pageSize,
    ...(query.stayId === undefined ? {} : { stayId: query.stayId }),
    ...(query.createdFrom === undefined ? {} : { createdFrom: query.createdFrom }),
    ...(query.createdTo === undefined ? {} : { createdTo: query.createdTo }),
    ...(query.sort === undefined || query.sort === '' ? {} : { sort: query.sort }),
  };
}

/** O1 账单分页列表（只读） */
export function listOrders(query: OrderListQuery): Promise<Paginated<OrderSummaryDto>> {
  return get<Paginated<OrderSummaryDto>>('/orders', toOrderListParams(query), { silent: true });
}

/** O2 账单详情（只读） */
export function getOrder(id: number): Promise<OrderDto> {
  return get<OrderDto>(`/orders/${id}`, undefined, { silent: true });
}
