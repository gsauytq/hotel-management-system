import type {
  CreateGuestRequest,
  GuestDetailDto,
  GuestDto,
  Paginated,
  UpdateGuestRequest,
} from '@hms/shared';

import { ApiError } from '../../shared/http/ApiError.js';
import { buildPagination } from '../../shared/http/pagination.js';
import { isUniqueConstraintError } from '../../shared/http/prisma-errors.js';
import type { GuestCrypto } from '../../utils/crypto.js';
import { formatDateOnly } from '../../utils/hotel-date.js';
import type { GuestRecord, GuestsRepository } from './guests.repository.js';

export interface GuestListQuery {
  keyword?: string;
  phone?: string;
  page: number;
  pageSize: number;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
}

export interface GuestsService {
  list(query: GuestListQuery): Promise<Paginated<GuestDto>>;
  getById(id: number): Promise<GuestDetailDto>;
  create(input: CreateGuestRequest): Promise<GuestDto>;
  update(id: number, input: UpdateGuestRequest): Promise<GuestDto>;
}

export interface GuestsServiceDependencies {
  repository: GuestsRepository;
  crypto: GuestCrypto;
}

const RECENT_BOOKINGS_LIMIT = 10;

function toGuestDto(record: GuestRecord, crypto: GuestCrypto): GuestDto {
  const idNumber = crypto.decryptIdNumber(record.idNumberCipher);
  return {
    id: record.id,
    name: record.name,
    phone: record.phone,
    idType: record.idType,
    idNumberMasked: crypto.maskIdNumber(idNumber),
    remark: record.remark,
    createdAt: record.createdAt.toISOString(),
  };
}

export function createGuestsService(deps: GuestsServiceDependencies): GuestsService {
  const { repository, crypto } = deps;

  return {
    async list(query) {
      const { items, total } = await repository.list(query);
      return {
        items: items.map((item) => toGuestDto(item, crypto)),
        pagination: buildPagination(query.page, query.pageSize, total),
      };
    },

    async getById(id) {
      const guest = await repository.findById(id);
      if (guest === null) {
        throw ApiError.notFound('客人档案不存在');
      }
      const recentBookings = await repository.findRecentBookings(id, RECENT_BOOKINGS_LIMIT);
      return {
        ...toGuestDto(guest, crypto),
        updatedAt: guest.updatedAt.toISOString(),
        recentBookings: recentBookings.map((booking) => ({
          id: booking.id,
          checkInDate: formatDateOnly(booking.checkInDate),
          checkOutDate: formatDateOnly(booking.checkOutDate),
          status: booking.status,
        })),
      };
    },

    async create(input) {
      const idNumberHash = crypto.hashIdNumber(input.idNumber);
      try {
        const guest = await repository.create({
          name: input.name,
          phone: input.phone,
          idType: input.idType,
          idNumberHash,
          idNumberCipher: crypto.encryptIdNumber(input.idNumber),
          remark: input.remark,
        });
        return toGuestDto(guest, crypto);
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          // 证件号查重（uq_guests_id_number），返回既有档案 id（api-contract G2）
          const existing = await repository.findByIdentity(input.idType, idNumberHash);
          throw ApiError.conflict('GUEST_EXISTS', '该证件号已有客人档案', [
            {
              field: 'idNumber',
              message: `existingGuestId: ${existing === null ? 'unknown' : existing.id}`,
            },
          ]);
        }
        throw error;
      }
    },

    async update(id, input) {
      const guest = await repository.findById(id);
      if (guest === null) {
        throw ApiError.notFound('客人档案不存在');
      }
      // 证件号创建后不可修改（改证件=新档案，api-contract §7 G4；假设 A-16）
      if (input.idType !== undefined || input.idNumber !== undefined) {
        throw ApiError.conflict('GUEST_EXISTS', '证件号不可修改，如需变更请新建档案');
      }
      if (input.name === undefined && input.phone === undefined && input.remark === undefined) {
        return toGuestDto(guest, crypto);
      }
      const updated = await repository.update(id, input);
      if (updated === null) {
        throw ApiError.notFound('客人档案不存在');
      }
      return toGuestDto(updated, crypto);
    },
  };
}
