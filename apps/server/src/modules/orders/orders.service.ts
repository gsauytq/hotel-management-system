import type { OrderDto, OrderSummaryDto, Paginated } from '@hms/shared';

import { ApiError } from '../../shared/http/ApiError.js';
import { buildPagination } from '../../shared/http/pagination.js';
import type {
  OrderDetailRecord,
  OrderListItemRecord,
  OrdersRepository,
} from './orders.repository.js';

export interface OrderListQuery {
  stayId?: number;
  createdFrom?: string;
  createdTo?: string;
  page: number;
  pageSize: number;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
}

export interface OrdersService {
  list(query: OrderListQuery): Promise<Paginated<OrderSummaryDto>>;
  getById(id: number): Promise<OrderDto>;
}

export interface OrdersServiceDependencies {
  repository: OrdersRepository;
}

export function toOrderSummaryDto(record: OrderListItemRecord): OrderSummaryDto {
  return {
    id: record.id,
    stayId: record.stayId,
    guestName: record.guestName,
    roomNumber: record.roomNumber,
    totalAmount: record.totalAmount,
    paidAmount: record.paidAmount,
    paymentMethod: record.paymentMethod,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toOrderDto(record: OrderDetailRecord): OrderDto {
  return {
    id: record.id,
    stayId: record.stayId,
    status: record.status,
    items: record.items,
    totalAmount: record.totalAmount,
    depositAmount: record.depositAmount,
    depositApplied: record.depositApplied,
    paidAmount: record.paidAmount,
    paymentMethod: record.paymentMethod,
    note: record.note,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function createOrdersService(deps: OrdersServiceDependencies): OrdersService {
  const { repository } = deps;

  return {
    async list(query) {
      const { items, total } = await repository.list(query);
      return {
        items: items.map(toOrderSummaryDto),
        pagination: buildPagination(query.page, query.pageSize, total),
      };
    },

    async getById(id) {
      const order = await repository.findById(id);
      if (order === null) {
        throw ApiError.notFound('订单不存在');
      }
      return toOrderDto(order);
    },
  };
}
