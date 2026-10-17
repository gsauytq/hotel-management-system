import type {
  BookingDetailDto,
  BookingDto,
  BookingStatus,
  CancelBookingRequest,
  CreateBookingRequest,
  Paginated,
} from '@hms/shared';

import { ApiError } from '../../shared/http/ApiError.js';
import { buildPagination } from '../../shared/http/pagination.js';
import { formatDateOnly, hotelToday, nightsBetween, toDateOnly } from '../../utils/hotel-date.js';
import type { BookingRecord, BookingsRepository } from './bookings.repository.js';

export interface BookingListQuery {
  status?: BookingStatus;
  guestId?: number;
  checkInDateFrom?: string;
  checkInDateTo?: string;
  checkOutDateFrom?: string;
  checkOutDateTo?: string;
  keyword?: string;
  page: number;
  pageSize: number;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
}

export interface BookingsService {
  create(input: CreateBookingRequest, actorId: number): Promise<BookingDto>;
  list(query: BookingListQuery): Promise<Paginated<BookingDto>>;
  getById(id: number): Promise<BookingDetailDto>;
  cancel(id: number, input: CancelBookingRequest): Promise<BookingDetailDto>;
  markNoShow(id: number): Promise<BookingDetailDto>;
}

export interface BookingsServiceDependencies {
  repository: BookingsRepository;
}

export function toBookingDto(record: BookingRecord): BookingDto {
  return {
    id: record.id,
    guestId: record.guestId,
    guestName: record.guestName,
    guestPhone: record.guestPhone,
    roomTypeId: record.roomTypeId,
    roomTypeName: record.roomTypeName,
    checkInDate: formatDateOnly(record.checkInDate),
    checkOutDate: formatDateOnly(record.checkOutDate),
    roomCount: record.roomCount,
    pricePerNight: record.pricePerNight,
    totalPrice: record.totalPrice,
    status: record.status,
    note: record.note,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toBookingDetailDto(record: BookingRecord): BookingDetailDto {
  return {
    ...toBookingDto(record),
    stayId: record.stayId,
    cancelledAt: record.cancelledAt === null ? null : record.cancelledAt.toISOString(),
    cancelReason: record.cancelReason,
  };
}

export function createBookingsService(deps: BookingsServiceDependencies): BookingsService {
  const { repository } = deps;

  return {
    async create(input, actorId) {
      // 日期语义（A-10）：入住日 ≥ 酒店本地“今日”；检查不依赖服务器时区
      if (input.checkInDate < hotelToday()) {
        throw ApiError.validation('参数校验失败', [
          { field: 'checkInDate', message: '入住日期不能早于今日（酒店本地日）' },
        ]);
      }

      const result = await repository.create({
        guestId: input.guestId,
        roomTypeId: input.roomTypeId,
        checkInDate: toDateOnly(input.checkInDate),
        checkOutDate: toDateOnly(input.checkOutDate),
        pricePerNight: input.pricePerNight ?? undefined,
        note: input.note,
        createdBy: actorId,
        roomCount: 1,
        nights: nightsBetween(input.checkInDate, input.checkOutDate),
      });

      switch (result.outcome) {
        case 'created':
          return toBookingDto(result.booking);
        case 'room_type_not_found':
          throw ApiError.notFound('房型不存在');
        case 'room_type_archived':
          throw ApiError.conflict('ROOM_TYPE_ARCHIVED', '房型已归档，不可创建预订');
        case 'guest_not_found':
          throw ApiError.notFound('客人不存在');
        case 'sold_out':
          throw ApiError.conflict(
            'ROOM_TYPE_SOLD_OUT',
            `${input.checkInDate} 至 ${input.checkOutDate} 该房型已无可售房间`,
            [{ field: 'checkOutDate', message: `剩余可售: ${result.remaining}` }],
          );
      }
    },

    async list(query) {
      const { items, total } = await repository.list(query);
      return {
        items: items.map(toBookingDto),
        pagination: buildPagination(query.page, query.pageSize, total),
      };
    },

    async getById(id) {
      const booking = await repository.findById(id);
      if (booking === null) {
        throw ApiError.notFound('预订不存在');
      }
      return toBookingDetailDto(booking);
    },

    async cancel(id, input) {
      const result = await repository.cancel(id, { reason: input.reason, now: new Date() });
      switch (result.outcome) {
        case 'updated':
          return toBookingDetailDto(result.booking);
        case 'not_found':
          throw ApiError.notFound('预订不存在');
        case 'invalid_status':
          throw ApiError.conflict('BOOKING_STATUS_INVALID', '仅已确认预订可取消');
        case 'conflict':
          throw ApiError.conflict(
            'BOOKING_STATUS_INVALID',
            '预订状态已被其他操作修改，请刷新后重试',
          );
      }
    },

    async markNoShow(id) {
      const result = await repository.markNoShow(id, { hotelToday: hotelToday() });
      switch (result.outcome) {
        case 'updated':
          return toBookingDetailDto(result.booking);
        case 'not_found':
          throw ApiError.notFound('预订不存在');
        case 'invalid_status':
          throw ApiError.conflict('BOOKING_STATUS_INVALID', '仅已确认预订可标记未到');
        case 'not_yet_due':
          throw ApiError.conflict('BOOKING_STATUS_INVALID', '未到入住日，暂不可标记未到');
        case 'conflict':
          throw ApiError.conflict(
            'BOOKING_STATUS_INVALID',
            '预订状态已被其他操作修改，请刷新后重试',
          );
      }
    },
  };
}
