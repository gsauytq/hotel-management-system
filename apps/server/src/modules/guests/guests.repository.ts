import type { BookingStatus, IdType } from '@hms/shared';

import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';

export interface GuestRecord {
  id: number;
  name: string;
  phone: string;
  idType: IdType;
  idNumberHash: string;
  idNumberCipher: Uint8Array;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GuestRecentBookingRecord {
  id: number;
  checkInDate: Date;
  checkOutDate: Date;
  status: BookingStatus;
}

export interface GuestListParams {
  keyword?: string;
  phone?: string;
  page: number;
  pageSize: number;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
}

export interface CreateGuestData {
  name: string;
  phone: string;
  idType: IdType;
  idNumberHash: string;
  idNumberCipher: Uint8Array<ArrayBuffer>;
  remark?: string | undefined;
}

export interface UpdateGuestData {
  name?: string | undefined;
  phone?: string | undefined;
  remark?: string | undefined;
}

export interface GuestsRepository {
  list(params: GuestListParams): Promise<{ items: GuestRecord[]; total: number }>;
  findById(id: number): Promise<GuestRecord | null>;
  findByIdentity(idType: IdType, idNumberHash: string): Promise<GuestRecord | null>;
  create(data: CreateGuestData): Promise<GuestRecord>;
  update(id: number, data: UpdateGuestData): Promise<GuestRecord | null>;
  findRecentBookings(guestId: number, limit: number): Promise<GuestRecentBookingRecord[]>;
}

type GuestRow = {
  id: bigint;
  name: string;
  phone: string;
  idType: string;
  idNumberHash: string;
  idNumberCipher: Uint8Array;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapGuest(row: GuestRow): GuestRecord {
  return {
    id: Number(row.id),
    name: row.name,
    phone: row.phone,
    idType: row.idType as IdType,
    idNumberHash: row.idNumberHash,
    idNumberCipher: row.idNumberCipher,
    remark: row.remark,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createGuestsRepository(prisma: PrismaClient): GuestsRepository {
  return {
    async list(params) {
      const where: Prisma.GuestWhereInput = {
        ...(params.keyword === undefined
          ? {}
          : {
              OR: [
                { name: { contains: params.keyword } },
                { phone: { startsWith: params.keyword } },
              ],
            }),
        ...(params.phone === undefined ? {} : { phone: { startsWith: params.phone } }),
      };
      const [total, rows] = await Promise.all([
        prisma.guest.count({ where }),
        prisma.guest.findMany({
          where,
          orderBy: params.orderBy as unknown as Prisma.GuestOrderByWithRelationInput[],
          skip: (params.page - 1) * params.pageSize,
          take: params.pageSize,
        }),
      ]);
      return { total, items: rows.map(mapGuest) };
    },

    async findById(id) {
      const row = await prisma.guest.findUnique({ where: { id } });
      return row === null ? null : mapGuest(row);
    },

    async findByIdentity(idType, idNumberHash) {
      const row = await prisma.guest.findUnique({
        where: { idType_idNumberHash: { idType, idNumberHash } },
      });
      return row === null ? null : mapGuest(row);
    },

    async create(data) {
      const row = await prisma.guest.create({
        data: {
          name: data.name,
          phone: data.phone,
          idType: data.idType,
          idNumberHash: data.idNumberHash,
          idNumberCipher: data.idNumberCipher,
          remark: data.remark,
        },
      });
      return mapGuest(row);
    },

    async update(id, data) {
      const existing = await prisma.guest.findUnique({ where: { id }, select: { id: true } });
      if (existing === null) {
        return null;
      }
      const row = await prisma.guest.update({
        where: { id },
        data: {
          ...(data.name === undefined ? {} : { name: data.name }),
          ...(data.phone === undefined ? {} : { phone: data.phone }),
          ...(data.remark === undefined ? {} : { remark: data.remark }),
        },
      });
      return mapGuest(row);
    },

    async findRecentBookings(guestId, limit) {
      const rows = await prisma.booking.findMany({
        where: { guestId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, checkInDate: true, checkOutDate: true, status: true },
      });
      return rows.map((row) => ({
        id: Number(row.id),
        checkInDate: row.checkInDate,
        checkOutDate: row.checkOutDate,
        status: row.status as BookingStatus,
      }));
    },
  };
}
