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
 * TC-SY-013（FR-SY-004 / A-05）：退房后当日该房可再售并可再次入住（显式回归）。
 * 真库 + 真服务：walk-in 在住 → 当日退房 → 可分配列表重新包含该房 → 同日再次 walk-in 成功。
 *
 * 默认不运行；执行：HMS_INTEGRATION=1 vitest run。
 */
const runIntegration =
  process.env['HMS_INTEGRATION'] === '1' && Boolean(process.env['DATABASE_URL']);

const suite = runIntegration ? describe : describe.skip;

function d(offset: number): string {
  const today = new Date(`${hotelToday()}T00:00:00.000Z`);
  return new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

suite('TC-SY-013 退房当日再售（Supertest + 真实 MySQL）', () => {
  const password = 'Itest#Pass123';
  const runId = Date.now().toString(36).toUpperCase();
  const suffix = `${runId}${Math.floor(Math.random() * 46655)
    .toString(36)
    .toUpperCase()}`.replace(/[^A-Z0-9]/g, '');
  const usernamePrefix = `itest_sr_${runId.toLowerCase()}`;
  const codePrefix = `SR${suffix}`;
  const roomPrefix = `SR${suffix}`;

  const createdStayIds: bigint[] = [];
  const createdGuestIds: bigint[] = [];
  const createdRoomIds: bigint[] = [];
  const createdRoomTypeIds: bigint[] = [];

  let config: AppConfig;
  let prisma: PrismaClient;
  let app: Express;
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
        displayName: '当日再售测试管理员',
        role: 'ADMIN',
      },
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: admin.username, password });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    adminCookie = (login.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
  });

  afterAll(async () => {
    await prisma.order.deleteMany({ where: { stayId: { in: createdStayIds } } });
    await prisma.stay.deleteMany({ where: { id: { in: createdStayIds } } });
    await prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } });
    await prisma.roomType.deleteMany({ where: { id: { in: createdRoomTypeIds } } });
    await prisma.guest.deleteMany({ where: { id: { in: createdGuestIds } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: usernamePrefix } } });
    await prisma.$disconnect();
  });

  async function seedRoomType(tag: string) {
    const roomType = await prisma.roomType.create({
      data: {
        code: `${codePrefix}${tag}`,
        name: `当日再售房型${tag}`,
        basePrice: 318,
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
        name: `当日再售客人${tag}${suffix}`,
        phone: '13800138000',
        idType: 'ID_CARD',
        idNumberHash: randomBytes(32).toString('hex'),
        idNumberCipher: Buffer.from('test-cipher'),
      },
    });
    createdGuestIds.push(guest.id);
    return { id: Number(guest.id) };
  }

  function listAvailable(roomTypeId: number) {
    return request(app)
      .get('/api/v1/rooms/available')
      .query({ roomTypeId, checkInDate: d(0), checkOutDate: d(2) })
      .set('Cookie', adminCookie);
  }

  it('当日退房后释放占用：可分配列表恢复，且同日可再次入住', async () => {
    const type = await seedRoomType('A');
    const guest = await seedGuest('A');

    // 1) 今日 walk-in 在住 [d(0), d(1))
    const first = await request(app)
      .post('/api/v1/stays')
      .set('Cookie', adminCookie)
      .send({
        guestId: guest.id,
        roomId: type.roomId,
        pricePerNight: 318,
        expectedCheckOutDate: d(1),
        depositAmount: 100,
      });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const firstStayId = first.body.data.id as number;
    createdStayIds.push(BigInt(firstStayId));

    const occupied = await listAvailable(type.id);
    expect(occupied.status, JSON.stringify(occupied.body)).toBe(200);
    expect(occupied.body.data.items.map((item: { id: number }) => item.id)).not.toContain(
      type.roomId,
    );

    // 2) 当日退房（空杂费、现金）
    const checkout = await request(app)
      .post(`/api/v1/stays/${firstStayId}/checkout`)
      .set('Cookie', adminCookie)
      .send({ paymentMethod: 'CASH' });
    expect(checkout.status, JSON.stringify(checkout.body)).toBe(200);
    expect(checkout.body.data.status).toBe('PAID');
    expect(checkout.body.data.totalAmount).toBe(318);

    // 3) 房态变 VACANT_DIRTY；今日起的占用行已释放（历史占用保留）
    const roomRow = await prisma.room.findUniqueOrThrow({ where: { id: BigInt(type.roomId) } });
    expect(roomRow.status).toBe('VACANT_DIRTY');
    const firstOccupancyRemaining = await prisma.roomOccupancy.count({
      where: { stayId: BigInt(firstStayId) },
    });
    expect(firstOccupancyRemaining).toBe(0);

    // 4) 可分配列表重新包含该房（退房日当日可再售）
    const released = await listAvailable(type.id);
    expect(released.status).toBe(200);
    expect(released.body.data.items.map((item: { id: number }) => item.id)).toContain(type.roomId);

    // 5) 同日再次 walk-in [d(0), d(2))
    const second = await request(app)
      .post('/api/v1/stays')
      .set('Cookie', adminCookie)
      .send({
        guestId: guest.id,
        roomId: type.roomId,
        pricePerNight: 318,
        expectedCheckOutDate: d(2),
        depositAmount: 0,
      });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    const secondStayId = second.body.data.id as number;
    createdStayIds.push(BigInt(secondStayId));

    const secondOccupancy = await prisma.roomOccupancy.findMany({
      where: { stayId: BigInt(secondStayId) },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    expect(
      secondOccupancy.map((row) => row.date.toISOString().slice(0, 10)),
      '再次入住应重新生成 [今日, 离店日) 逐日占用',
    ).toEqual([d(0), d(1)]);
  });
});
