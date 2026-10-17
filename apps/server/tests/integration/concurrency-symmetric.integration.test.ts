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
import { createAuditLogger } from '../../src/utils/audit.js';
import { hotelToday } from '../../src/utils/hotel-date.js';
import { createLogger } from '../../src/utils/logger.js';
import { hashPassword } from '../../src/utils/password.js';
import { createFakeGuestsService } from '../support/fake-guests.js';
import { createFakeOrdersService } from '../support/fake-orders.js';
import { createFakeStaysService } from '../support/fake-stays.js';
import { createFakeUsersService } from '../support/fake-users.js';

/**
 * TC-CON-001 / TC-CON-002（NFR-CON-001；database-design §6.1 对称规则）。
 *
 * 真实并发（Promise.all 同时发起 HTTP 请求）+ 真实 MySQL：
 * - 停用房间 vs 并发创建预订：两者均先锁 room_types 行 → 串行化；
 *   并发创建成功数不得超过变更前的可售房数，冲突必须返回 409 而非 5xx。
 * - 取消预订 vs 并发创建同区间预订：取消释放的容量与新建占用保持一致，
 *   终态 CONFIRMED 数量与响应结果严格互补（无容量漂移）。
 *
 * 说明：停用房间若发生在已有预订提交之后，可使可售房数低于已确认预订数（顺序语义，
 * 非并发竞态）；该业务规则未在设计文档中定义，本文件不做断言，作为待确认风险登记。
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

suite('TC-CON-001/002 对称锁与容量竞态（Supertest + 真实 MySQL）', () => {
  const password = 'Itest#Pass123';
  const runId = Date.now().toString(36).toUpperCase();
  const suffix = `${runId}${Math.floor(Math.random() * 46655)
    .toString(36)
    .toUpperCase()}`.replace(/[^A-Z0-9]/g, '');
  const usernamePrefix = `itest_cn_${runId.toLowerCase()}`;
  const codePrefix = `CN${suffix}`;
  const roomPrefix = `CN${suffix}`;

  const createdBookingIds: bigint[] = [];
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
      staysService: createFakeStaysService(),
      ordersService: createFakeOrdersService(),
      usersService: createFakeUsersService(),
      guestsService: createFakeGuestsService(),
    });

    const admin = await prisma.user.create({
      data: {
        username: `${usernamePrefix}_admin`,
        passwordHash: await hashPassword(password),
        displayName: '并发对称锁测试管理员',
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
    await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    await prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } });
    await prisma.roomType.deleteMany({ where: { id: { in: createdRoomTypeIds } } });
    await prisma.guest.deleteMany({ where: { id: { in: createdGuestIds } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: usernamePrefix } } });
    await prisma.$disconnect();
  });

  async function seedRoomType(tag: string, rooms: number) {
    const roomType = await prisma.roomType.create({
      data: {
        code: `${codePrefix}${tag}`,
        name: `并发测试房型${tag}`,
        basePrice: 300,
        capacity: 2,
      },
    });
    createdRoomTypeIds.push(roomType.id);
    const roomIds: number[] = [];
    for (let index = 1; index <= rooms; index += 1) {
      const room = await prisma.room.create({
        data: { roomNumber: `${roomPrefix}${tag}${index}`, roomTypeId: roomType.id },
      });
      createdRoomIds.push(room.id);
      roomIds.push(Number(room.id));
    }
    return { id: Number(roomType.id), roomIds };
  }

  async function seedGuest(tag: string) {
    const guest = await prisma.guest.create({
      data: {
        name: `并发客人${tag}${suffix}`,
        phone: '13800138000',
        idType: 'ID_CARD',
        idNumberHash: randomBytes(32).toString('hex'),
        idNumberCipher: Buffer.from('test-cipher'),
      },
    });
    createdGuestIds.push(guest.id);
    return { id: Number(guest.id) };
  }

  function createBooking(guestId: number, roomTypeId: number, from: number, to: number) {
    return request(app)
      .post('/api/v1/bookings')
      .set('Cookie', adminCookie)
      .send({ guestId, roomTypeId, checkInDate: d(from), checkOutDate: d(to) });
  }

  function disableRoom(roomId: number) {
    return request(app)
      .patch(`/api/v1/rooms/${roomId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'DISABLED' });
  }

  async function confirmedOverlapping(roomTypeId: number, from: number, to: number) {
    return prisma.booking.count({
      where: {
        roomTypeId: BigInt(roomTypeId),
        status: 'CONFIRMED',
        checkInDate: { lt: new Date(`${d(to)}T00:00:00.000Z`) },
        checkOutDate: { gt: new Date(`${d(from)}T00:00:00.000Z`) },
      },
    });
  }

  it('TC-CON-001a：停用先提交时，后续预订只能按缩减后的可售房数成功', async () => {
    const type = await seedRoomType('A', 2);
    const guest = await seedGuest('A');

    // 停用 R2（R1 仍可售）
    const disabled = await disableRoom(type.roomIds[1]!);
    expect(disabled.status, JSON.stringify(disabled.body)).toBe(200);
    expect(disabled.body.data.status).toBe('DISABLED');

    // 6 个并发预订：容量已降为 1，只能成功 1 个
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => createBooking(guest.id, type.id, 60, 62)),
    );

    const succeeded = responses.filter((res) => res.status === 200);
    const rejected = responses.filter((res) => res.status === 409);
    expect(succeeded, '停用后仅 1 间可售').toHaveLength(1);
    expect(rejected).toHaveLength(5);
    for (const res of rejected) {
      expect(res.body.error.code).toBe('ROOM_TYPE_SOLD_OUT');
    }
    for (const res of responses) {
      expect(res.status).toBeLessThan(500);
    }
    for (const res of succeeded) {
      createdBookingIds.push(BigInt(res.body.data.id as number));
    }

    expect(await confirmedOverlapping(type.id, 60, 62)).toBe(1);
  });

  it('TC-CON-001b：停用房间与并发预订竞争时无超售、无 5xx（串行化生效）', async () => {
    const type = await seedRoomType('B', 2);
    const guest = await seedGuest('B');

    const [disabled, ...bookings] = await Promise.all([
      disableRoom(type.roomIds[1]!),
      ...Array.from({ length: 6 }, () => createBooking(guest.id, type.id, 63, 65)),
    ]);

    expect(disabled.status, JSON.stringify(disabled.body)).toBe(200);
    expect(disabled.body.data.status).toBe('DISABLED');

    const succeeded = bookings.filter((res) => res.status === 200);
    const rejected = bookings.filter((res) => res.status === 409);
    for (const res of bookings) {
      expect([200, 409], `非预期状态 ${res.status}：${JSON.stringify(res.body)}`).toContain(
        res.status,
      );
    }
    for (const res of rejected) {
      expect(res.body.error.code).toBe('ROOM_TYPE_SOLD_OUT');
    }

    // 并发成功数不得超过变更前可售房数（2）；若停用先提交则只能 1
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    expect(succeeded.length).toBeLessThanOrEqual(2);
    expect(succeeded.length + rejected.length).toBe(6);

    for (const res of succeeded) {
      createdBookingIds.push(BigInt(res.body.data.id as number));
    }
    expect(await confirmedOverlapping(type.id, 63, 65)).toBe(succeeded.length);

    const roomRow = await prisma.room.findUniqueOrThrow({
      where: { id: BigInt(type.roomIds[1]!) },
    });
    expect(roomRow.status).toBe('DISABLED');
  });

  it('TC-CON-002：取消与并发创建同区间预订，容量终态与响应严格一致', async () => {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const type = await seedRoomType(`C${iteration}`, 1);
      const guest = await seedGuest(`C${iteration}`);
      const from = 70 + iteration * 2;
      const to = 72 + iteration * 2;

      // 先占满唯一一间房
      const first = await createBooking(guest.id, type.id, from, to);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const firstId = first.body.data.id as number;
      createdBookingIds.push(BigInt(firstId));

      // 并发：取消既有预订 + 创建同区间新预订
      const [cancelled, created] = await Promise.all([
        request(app)
          .post(`/api/v1/bookings/${firstId}/cancel`)
          .set('Cookie', adminCookie)
          .send({ reason: '并发取消' }),
        createBooking(guest.id, type.id, from, to),
      ]);

      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      expect(cancelled.body.data.status).toBe('CANCELLED');
      expect([200, 409], `非预期状态 ${created.status}`).toContain(created.status);

      if (created.status === 200) {
        createdBookingIds.push(BigInt(created.body.data.id as number));
        expect(created.body.data.status).toBe('CONFIRMED');
      } else {
        expect(created.body.error.code).toBe('ROOM_TYPE_SOLD_OUT');
      }

      const finalConfirmed = await confirmedOverlapping(type.id, from, to);
      expect(
        finalConfirmed,
        `迭代 ${iteration}：取消与创建并发后容量计数漂移（响应=${created.status}）`,
      ).toBe(created.status === 200 ? 1 : 0);
    }
  });
});
