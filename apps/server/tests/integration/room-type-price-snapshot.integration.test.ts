import 'dotenv/config';

import { randomBytes } from 'node:crypto';

import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { loadEnv, type AppConfig } from '../../src/config/env.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createDatabasePing, createPrismaClient } from '../../src/lib/prisma.js';
import { createAuthRepository } from '../../src/modules/auth/auth.repository.js';
import { createAuthService, type AuthService } from '../../src/modules/auth/auth.service.js';
import { createBookingsRepository } from '../../src/modules/bookings/bookings.repository.js';
import { createBookingsService } from '../../src/modules/bookings/bookings.service.js';
import { createRoomTypesRepository } from '../../src/modules/room-types/room-types.repository.js';
import { createRoomTypesService } from '../../src/modules/room-types/room-types.service.js';
import { createRoomsRepository } from '../../src/modules/rooms/rooms.repository.js';
import { createRoomsService } from '../../src/modules/rooms/rooms.service.js';
import { createStaysRepository } from '../../src/modules/stays/stays.repository.js';
import { createStaysService } from '../../src/modules/stays/stays.service.js';
import { createAuditLogger } from '../../src/utils/audit.js';
import { hotelToday } from '../../src/utils/hotel-date.js';
import { createLogger } from '../../src/utils/logger.js';
import { hashPassword } from '../../src/utils/password.js';
import { createFakeGuestsService } from '../support/fake-guests.js';
import { createFakeOrdersService } from '../support/fake-orders.js';
import { createFakeUsersService } from '../support/fake-users.js';

/**
 * TC-RT-005（FR-RT-002 / A-12 / A-13）：房型调价不得改写存量预订与在住价格快照。
 * 真库 + 真服务：创建预订（价格 288）与在住记录（价格 288）→ PATCH 房型 basePrice=428
 * → 存量预订/在住快照保持 288，新建预订取 428。
 *
 * 默认不运行；执行：HMS_INTEGRATION=1 vitest run（见 scripts/run-integration-tests.mjs）。
 * 仅使用 itest_ 前缀数据并在 afterAll 清理，不触碰其他数据。
 */
const runIntegration =
  process.env['HMS_INTEGRATION'] === '1' && Boolean(process.env['DATABASE_URL']);

const suite = runIntegration ? describe : describe.skip;

function d(offset: number): string {
  const today = new Date(`${hotelToday()}T00:00:00.000Z`);
  return new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

suite('TC-RT-005 房型调价与价格快照（Supertest + 真实 MySQL）', () => {
  const password = 'Itest#Pass123';
  const runId = Date.now().toString(36).toUpperCase();
  const suffix = `${runId}${Math.floor(Math.random() * 46655)
    .toString(36)
    .toUpperCase()}`.replace(/[^A-Z0-9]/g, '');
  const usernamePrefix = `itest_ps_${runId.toLowerCase()}`;
  const codePrefix = `PS${suffix}`;
  const roomPrefix = `PS${suffix}`;

  const createdBookingIds: bigint[] = [];
  const createdStayIds: bigint[] = [];
  const createdGuestIds: bigint[] = [];
  const createdRoomIds: bigint[] = [];
  const createdRoomTypeIds: bigint[] = [];

  let config: AppConfig;
  let prisma: PrismaClient;
  let app: Express;
  let adminUserId: number;
  let adminCookie: string;

  beforeAll(async () => {
    config = loadEnv(process.env);
    prisma = createPrismaClient(config);
    const silent = createLogger({ nodeEnv: 'test', logLevel: 'silent' });
    const authService: AuthService = createAuthService({
      repository: createAuthRepository(prisma),
      audit: createAuditLogger(silent),
      sessionTtlHours: config.sessionTtlHours,
    });
    const roomTypesService = createRoomTypesService({
      repository: createRoomTypesRepository(prisma),
    });

    app = createApp({
      config,
      logger: silent,
      checkDatabase: () => createDatabasePing(prisma)(),
      authService,
      roomTypesService,
      roomsService: createRoomsService({
        repository: createRoomsRepository(prisma),
        roomTypesService,
      }),
      bookingsService: createBookingsService({
        repository: createBookingsRepository(prisma),
      }),
      staysService: createStaysService({
        repository: createStaysRepository(prisma),
        audit: createAuditLogger(silent),
      }),
      ordersService: createFakeOrdersService(),
      usersService: createFakeUsersService(),
      guestsService: createFakeGuestsService(),
    });

    const admin = await prisma.user.create({
      data: {
        username: `${usernamePrefix}_admin`,
        passwordHash: await hashPassword(password),
        displayName: '价格快照测试管理员',
        role: 'ADMIN',
      },
    });
    adminUserId = Number(admin.id);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: admin.username, password });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    adminCookie = (login.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { stayId: { in: createdStayIds } } });
    await prisma.stay.deleteMany({ where: { id: { in: createdStayIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    await prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } });
    await prisma.roomType.deleteMany({ where: { id: { in: createdRoomTypeIds } } });
    await prisma.guest.deleteMany({ where: { id: { in: createdGuestIds } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: usernamePrefix } } });
    await prisma.$disconnect();
  });

  async function seedRoomType(tag: string, basePrice: number) {
    const roomType = await prisma.roomType.create({
      data: {
        code: `${codePrefix}${tag}`,
        name: `价格快照房型${tag}`,
        basePrice,
        capacity: 2,
      },
    });
    createdRoomTypeIds.push(roomType.id);
    const room = await prisma.room.create({
      data: { roomNumber: `${roomPrefix}${tag}1`, roomTypeId: roomType.id },
    });
    createdRoomIds.push(room.id);
    return { id: Number(roomType.id), roomId: Number(room.id) };
  }

  async function seedGuest(tag: string) {
    const guest = await prisma.guest.create({
      data: {
        name: `价格快照客人${tag}${suffix}`,
        phone: '13800138000',
        idType: 'ID_CARD',
        idNumberHash: randomBytes(32).toString('hex'),
        idNumberCipher: Buffer.from('test-cipher'),
      },
    });
    createdGuestIds.push(guest.id);
    return { id: Number(guest.id) };
  }

  it('调价仅影响新预订：存量预订与在住价格快照保持不变', async () => {
    const type = await seedRoomType('A', 288);
    const guest = await seedGuest('A');

    // 1) 存量预订：通过真实 API 创建，价格 288，[d(40), d(42)) 两晚
    const created = await request(app)
      .post('/api/v1/bookings')
      .set('Cookie', adminCookie)
      .send({
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(40),
        checkOutDate: d(42),
      });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.data.pricePerNight).toBe(288);
    expect(created.body.data.totalPrice).toBe(576);
    createdBookingIds.push(BigInt(created.body.data.id as number));

    // 2) 在住记录：直接落库，模拟调价前已锁价的入住（快照 288，今日入住、明日离店 → 1 晚）
    const stay = await prisma.stay.create({
      data: {
        guestId: BigInt(guest.id),
        roomId: BigInt(type.roomId),
        roomTypeId: BigInt(type.id),
        pricePerNight: 288,
        checkInAt: new Date(),
        expectedCheckOutDate: new Date(`${d(1)}T00:00:00.000Z`),
        depositAmount: 200,
        createdBy: BigInt(adminUserId),
      },
    });
    createdStayIds.push(stay.id);

    // 3) 管理员调价 288 → 428（R3）
    const patched = await request(app)
      .patch(`/api/v1/room-types/${type.id}`)
      .set('Cookie', adminCookie)
      .send({ basePrice: 428 });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.data.basePrice).toBe(428);

    // 4) 存量预订快照不被改写
    const bookingDetail = await request(app)
      .get(`/api/v1/bookings/${created.body.data.id}`)
      .set('Cookie', adminCookie);
    expect(bookingDetail.status).toBe(200);
    expect(bookingDetail.body.data.pricePerNight).toBe(288);
    expect(bookingDetail.body.data.totalPrice).toBe(576);

    // 5) 在住记录快照不被改写（S3 详情：1 晚 × 288）
    const stayDetail = await request(app)
      .get(`/api/v1/stays/${stay.id}`)
      .set('Cookie', adminCookie);
    expect(stayDetail.status, JSON.stringify(stayDetail.body)).toBe(200);
    expect(stayDetail.body.data.pricePerNight).toBe(288);
    expect(stayDetail.body.data.currentCharges.nights).toBe(1);
    expect(stayDetail.body.data.currentCharges.roomFee).toBe(288);

    // 6) 新建预订使用新基准价
    const createdAfter = await request(app)
      .post('/api/v1/bookings')
      .set('Cookie', adminCookie)
      .send({
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(43),
        checkOutDate: d(45),
      });
    expect(createdAfter.status, JSON.stringify(createdAfter.body)).toBe(200);
    expect(createdAfter.body.data.pricePerNight).toBe(428);
    expect(createdAfter.body.data.totalPrice).toBe(856);
    createdBookingIds.push(BigInt(createdAfter.body.data.id as number));

    // 7) 数据库快照直接验证（不依赖 DTO 映射）
    const bookingRow = await prisma.booking.findUniqueOrThrow({
      where: { id: BigInt(created.body.data.id as number) },
    });
    expect(bookingRow.pricePerNight.toNumber()).toBe(288);
    expect(bookingRow.totalPrice.toNumber()).toBe(576);
    const stayRow = await prisma.stay.findUniqueOrThrow({ where: { id: stay.id } });
    expect(stayRow.pricePerNight.toNumber()).toBe(288);
    const typeRow = await prisma.roomType.findUniqueOrThrow({ where: { id: BigInt(type.id) } });
    expect(typeRow.basePrice.toNumber()).toBe(428);
  });
});
