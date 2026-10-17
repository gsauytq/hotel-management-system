import type {
  CheckInBookingRequest,
  CheckoutStayRequest,
  CreateStayRequest,
  CurrentChargesDto,
  OrderDto,
  OrderSummaryDto,
  Paginated,
  StayDetailDto,
  StayDto,
  StayStatus,
} from '@hms/shared';

import { ApiError } from '../../shared/http/ApiError.js';
import type { RequestContext } from '../../shared/http/auth.js';
import { buildPagination } from '../../shared/http/pagination.js';
import type { AuditLogger } from '../../utils/audit.js';
import {
  formatDateOnly,
  hotelDateOf,
  hotelToday,
  nightsBetween,
  toDateOnly,
} from '../../utils/hotel-date.js';
import { addMoney, multiplyMoney } from '../../utils/money.js';
import type {
  CreateStayParams,
  OrderRecord,
  OrderSummaryRecord,
  StayRecord,
  StaysRepository,
} from './stays.repository.js';

export interface StayListQuery {
  status?: StayStatus;
  roomId?: number;
  keyword?: string;
  page: number;
  pageSize: number;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
}

export interface StaysService {
  checkInBooking(
    bookingId: number,
    input: CheckInBookingRequest,
    actorId: number,
  ): Promise<StayDto>;
  createWalkIn(input: CreateStayRequest, actorId: number): Promise<StayDto>;
  list(query: StayListQuery): Promise<Paginated<StayDto>>;
  getById(id: number): Promise<StayDetailDto>;
  checkout(
    stayId: number,
    input: CheckoutStayRequest,
    context: RequestContext & { actorId: number },
  ): Promise<OrderDto>;
}

export interface StaysServiceDependencies {
  repository: StaysRepository;
  /** 审计日志（security-design §9：退房结算） */
  audit: AuditLogger;
}

export function toStayDto(record: StayRecord): StayDto {
  return {
    id: record.id,
    bookingId: record.bookingId,
    guestId: record.guestId,
    guestName: record.guestName,
    roomId: record.roomId,
    roomNumber: record.roomNumber,
    roomTypeId: record.roomTypeId,
    roomTypeName: record.roomTypeName,
    pricePerNight: record.pricePerNight,
    checkInAt: record.checkInAt.toISOString(),
    expectedCheckOutDate: formatDateOnly(record.expectedCheckOutDate),
    depositAmount: record.depositAmount,
    status: record.status,
    note: record.note,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toOrderDto(record: OrderRecord): OrderDto {
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

function toOrderSummaryDto(record: OrderSummaryRecord): OrderSummaryDto {
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

export function createStaysService(deps: StaysServiceDependencies): StaysService {
  const { repository, audit } = deps;

  async function performCreate(params: CreateStayParams): Promise<StayDto> {
    const result = await repository.createStay(params);
    switch (result.outcome) {
      case 'created':
        return toStayDto(result.stay);
      case 'room_not_found':
        throw ApiError.notFound('房间不存在');
      case 'guest_not_found':
        throw ApiError.notFound('客人不存在');
      case 'booking_not_found':
        throw ApiError.notFound('预订不存在');
      case 'room_not_assignable':
        throw ApiError.conflict('ROOM_NOT_ASSIGNABLE', '房间处于维修或停用状态，不可分配');
      case 'room_type_mismatch':
        throw ApiError.conflict('ROOM_NOT_ASSIGNABLE', '房间房型与预订不符');
      case 'booking_invalid':
        throw ApiError.conflict('BOOKING_STATUS_INVALID', '该预订已办理入住或已取消');
      case 'booking_date_mismatch':
        throw ApiError.conflict('BOOKING_DATE_MISMATCH', '入住/离店日期与预订不符');
      case 'booking_expired':
        throw ApiError.conflict(
          'BOOKING_DATE_MISMATCH',
          '预订离店日期已到或已过，不可办理入住，请重新预订',
        );
      case 'room_occupied':
        throw ApiError.conflict('ROOM_OCCUPIED', '该房间在所选日期已被占用');
      case 'room_type_sold_out':
        throw ApiError.conflict(
          'ROOM_TYPE_SOLD_OUT',
          '该房型在所选日期区间内无可售房量（与在店或已确认预订冲突）',
        );
      case 'room_changed':
        throw ApiError.conflict('ROOM_STATUS_INVALID', '房间信息已变更，请刷新后重试');
    }
  }

  return {
    async checkInBooking(bookingId, input, actorId) {
      return performCreate({
        bookingId,
        guestId: undefined,
        roomId: input.roomId,
        pricePerNight: input.pricePerNight ?? undefined,
        expectedCheckOutDate: undefined,
        depositAmount: input.depositAmount ?? 0,
        note: undefined,
        createdBy: actorId,
        now: new Date(),
        hotelToday: hotelToday(),
      });
    },

    async createWalkIn(input, actorId) {
      const today = hotelToday();
      if (input.expectedCheckOutDate <= today) {
        throw ApiError.validation('参数校验失败', [
          { field: 'expectedCheckOutDate', message: '离店日期必须晚于今日（酒店本地日）' },
        ]);
      }
      return performCreate({
        bookingId: null,
        guestId: input.guestId,
        roomId: input.roomId,
        pricePerNight: input.pricePerNight,
        expectedCheckOutDate: toDateOnly(input.expectedCheckOutDate),
        depositAmount: input.depositAmount ?? 0,
        note: input.note,
        createdBy: actorId,
        now: new Date(),
        hotelToday: today,
      });
    },

    async list(query) {
      const { items, total } = await repository.list(query);
      return {
        items: items.map(toStayDto),
        pagination: buildPagination(query.page, query.pageSize, total),
      };
    },

    async getById(id) {
      const stay = await repository.findById(id);
      if (stay === null) {
        throw ApiError.notFound('入住记录不存在');
      }
      const order = await repository.findOrderSummaryByStayId(id);

      // 预计晚数（CurrentCharges.nights，openapi）：expected_check_out_date − DATE(check_in_at)
      // DATE(check_in_at) 按酒店本地日历日（Asia/Shanghai）口径（A-10；审查 P-1）
      const nights = nightsBetween(
        hotelDateOf(stay.checkInAt),
        formatDateOnly(stay.expectedCheckOutDate),
      );
      const roomFee = multiplyMoney(stay.pricePerNight, nights);
      // 在住期间杂费为 0（A-19）；已退房时取账单明细中 MISC 的精确合计
      const miscTotal = order === null ? 0 : order.miscTotal;
      const currentCharges: CurrentChargesDto = {
        roomFee,
        miscTotal,
        total: addMoney(roomFee, miscTotal),
        nights,
      };

      return {
        ...toStayDto(stay),
        actualCheckOutAt:
          stay.actualCheckOutAt === null ? null : stay.actualCheckOutAt.toISOString(),
        currentCharges,
        order: order === null ? null : toOrderSummaryDto(order),
      };
    },

    async checkout(stayId, input, context) {
      const result = await repository.checkout(stayId, {
        paymentMethod: input.paymentMethod,
        miscItems: input.miscItems ?? [],
        note: input.note,
        createdBy: context.actorId,
        now: new Date(),
        hotelToday: hotelToday(),
      });
      switch (result.outcome) {
        case 'checked_out':
          audit({
            action: 'stay.checkout',
            outcome: 'SUCCESS',
            requestId: context.requestId,
            ip: context.ip,
            actorId: context.actorId,
            target: `stay:${stayId}`,
          });
          return toOrderDto(result.order);
        case 'not_found':
          throw ApiError.notFound('入住记录不存在');
        case 'invalid_status':
        case 'conflict':
          throw ApiError.conflict('STAY_STATUS_INVALID', '该入住记录已退房，不可重复结算');
      }
    },
  };
}
