import 'dotenv/config';

import { randomBytes } from 'node:crypto';

import type { Express } from 'express';
import type { RoomStatus } from '@hms/shared';
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
 * 集成测试：Supertest + 真实 MySQL（开发计划 T-10/T-11 写入部分）。
 * 默认不运行；执行方式：HMS_INTEGRATION=1 pnpm --filter @hms/server test
 * 覆盖：入住/退房状态联动、回滚、重复提交、并发（房间行锁 + 唯一约束兜底）、权限。
 */
const runIntegration =
  process.env['HMS_INTEGRATION'] === '1' && Boolean(process.env['DATABASE_URL']);

const suite = runIntegration ? describe : describe.skip;

function d(offset: number): string {
  const today = new Date(`${hotelToday()}T00:00:00.000Z`);
  return new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

suite('入住与退房集成测试（Supertest + 真实 MySQL）', () => {
  const password = 'Itest#Pass123';
  const runId = Date.now().toString(36).toUpperCase();
  const suffix = `${runId}${Math.floor(Math.random() * 46655)
    .toString(36)
    .toUpperCase()}`.replace(/[^A-Z0-9]/g, '');
  const usernamePrefix = `itest_st_${runId.toLowerCase()}`;
  const codePrefix = `ST${suffix}`;
  const roomPrefix = `ST${suffix}`;

  const createdStayIds: bigint[] = [];
  const createdBookingIds: bigint[] = [];
  const createdGuestIds: bigint[] = [];
  const createdRoomIds: bigint[] = [];
  const createdRoomTypeIds: bigint[] = [];

  let config: AppConfig;
  let prisma: PrismaClient;
  let app: Express;
  let adminUserId: number;
  let receptionistUserId: number;
  let adminCookie: string;
  let receptionistCookie: string;

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

    const admin = await seedUser('admin', 'ADMIN');
    adminUserId = admin.id;
    const receptionist = await seedUser('rec', 'RECEPTIONIST');
    receptionistUserId = receptionist.id;
    adminCookie = await loginCookie(admin.username);
    receptionistCookie = await loginCookie(receptionist.username);
  });

  afterAll(async () => {
    // 清理顺序：order_items（级联 orders）→ orders → stays（occupancy 级联）→ bookings → rooms → types → guests → users
    await prisma.order.deleteMany({ where: { stayId: { in: createdStayIds } } });
    await prisma.stay.deleteMany({ where: { id: { in: createdStayIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    await prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } });
    await prisma.roomType.deleteMany({ where: { id: { in: createdRoomTypeIds } } });
    await prisma.guest.deleteMany({ where: { id: { in: createdGuestIds } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: usernamePrefix } } });
    await prisma.$disconnect();
  });

  async function seedUser(tag: string, role: 'ADMIN' | 'RECEPTIONIST') {
    const user = await prisma.user.create({
      data: {
        username: `${usernamePrefix}_${tag}`,
        passwordHash: await hashPassword(password),
        displayName: '入住测试用户',
        role,
      },
    });
    return { id: Number(user.id), username: user.username };
  }

  async function loginCookie(username: string): Promise<string> {
    const res = await request(app).post('/api/v1/auth/login').send({ username, password });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const raw = res.headers['set-cookie']?.[0] ?? '';
    return raw.split(';')[0] ?? '';
  }

  async function seedRoomType(tag: string, options: { basePrice?: number; rooms?: number } = {}) {
    const roomType = await prisma.roomType.create({
      data: {
        code: `${codePrefix}${tag}`,
        name: `入住测试房型${tag}`,
        basePrice: options.basePrice ?? 300,
        capacity: 2,
      },
    });
    createdRoomTypeIds.push(roomType.id);
    const roomCount = options.rooms ?? 1;
    const rooms: Array<{ id: number; roomNumber: string }> = [];
    for (let index = 1; index <= roomCount; index += 1) {
      const room = await prisma.room.create({
        data: { roomNumber: `${roomPrefix}${tag}${index}`, roomTypeId: roomType.id },
      });
      createdRoomIds.push(room.id);
      rooms.push({ id: Number(room.id), roomNumber: room.roomNumber });
    }
    return { id: Number(roomType.id), name: roomType.name, rooms };
  }

  async function seedGuest(tag: string) {
    const guest = await prisma.guest.create({
      data: {
        name: `入住集成${tag}${suffix}`,
        phone: '13800138000',
        idType: 'ID_CARD',
        idNumberHash: randomBytes(32).toString('hex'),
        idNumberCipher: Buffer.from('test-cipher'),
      },
    });
    createdGuestIds.push(guest.id);
    return { id: Number(guest.id), name: guest.name };
  }

  async function seedBookingDirect(params: {
    roomTypeId: number;
    guestId: number;
    checkInOffset: number;
    checkOutOffset: number;
    pricePerNight?: number;
    status?: 'CONFIRMED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW';
  }) {
    const price = params.pricePerNight ?? 300;
    const booking = await prisma.booking.create({
      data: {
        guestId: params.guestId,
        roomTypeId: params.roomTypeId,
        checkInDate: new Date(`${d(params.checkInOffset)}T00:00:00.000Z`),
        checkOutDate: new Date(`${d(params.checkOutOffset)}T00:00:00.000Z`),
        pricePerNight: price,
        totalPrice: price * (params.checkOutOffset - params.checkInOffset),
        status: params.status ?? 'CONFIRMED',
        createdBy: adminUserId,
      },
    });
    createdBookingIds.push(booking.id);
    return { id: Number(booking.id) };
  }

  /** 直接落库一条在住记录 + 占用行（用于构造占用冲突/历史数据） */
  async function seedOccupiedStayDirect(params: {
    roomId: number;
    roomTypeId: number;
    guestId: number;
    occupancyDates: string[];
  }) {
    const stay = await prisma.stay.create({
      data: {
        guestId: params.guestId,
        roomId: params.roomId,
        roomTypeId: params.roomTypeId,
        pricePerNight: 300,
        checkInAt: new Date(),
        expectedCheckOutDate: new Date(`${d(2)}T00:00:00.000Z`),
        createdBy: adminUserId,
      },
    });
    createdStayIds.push(stay.id);
    if (params.occupancyDates.length > 0) {
      await prisma.roomOccupancy.createMany({
        data: params.occupancyDates.map((date) => ({
          stayId: stay.id,
          roomId: BigInt(params.roomId),
          date: new Date(`${date}T00:00:00.000Z`),
        })),
      });
    }
    return { id: Number(stay.id) };
  }

  async function setRoomStatus(roomId: number, status: RoomStatus): Promise<void> {
    await prisma.room.update({ where: { id: roomId }, data: { status } });
  }

  function checkIn(cookie: string, bookingId: number, body: Record<string, unknown>) {
    return request(app)
      .post(`/api/v1/bookings/${bookingId}/check-in`)
      .set('Cookie', cookie)
      .send(body);
  }

  function walkIn(cookie: string, body: Record<string, unknown>) {
    return request(app).post('/api/v1/stays').set('Cookie', cookie).send(body);
  }

  function checkout(cookie: string, stayId: number, body: Record<string, unknown>) {
    return request(app).post(`/api/v1/stays/${stayId}/checkout`).set('Cookie', cookie).send(body);
  }

  describe('认证与权限', () => {
    it('未登录访问入住/退房全部端点 → 401 SESSION_EXPIRED', async () => {
      const requests = [
        request(app).get('/api/v1/stays'),
        request(app).post('/api/v1/stays').send({}),
        request(app).get('/api/v1/stays/1'),
        request(app).post('/api/v1/stays/1/checkout').send({}),
        request(app).post('/api/v1/bookings/1/check-in').send({}),
      ];
      for (const pending of requests) {
        const res = await pending;
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('SESSION_EXPIRED');
      }
    });
  });

  describe('B6 预订入住', () => {
    it('成功：预订/房间/入住/占用/房态在同一事务内联动，记录实际时间与操作员工', async () => {
      const type = await seedRoomType('B6');
      const room = type.rooms[0]!;
      const guest = await seedGuest('B6');
      const booking = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest.id,
        checkInOffset: 0,
        checkOutOffset: 2,
        pricePerNight: 288,
      });

      const res = await checkIn(receptionistCookie, booking.id, {
        roomId: room.id,
        depositAmount: 200,
      });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        bookingId: booking.id,
        guestId: guest.id,
        guestName: guest.name,
        roomId: room.id,
        roomNumber: room.roomNumber,
        roomTypeId: type.id,
        roomTypeName: type.name,
        pricePerNight: 288,
        expectedCheckOutDate: d(2),
        depositAmount: 200,
        status: 'CHECKED_IN',
      });
      const stayId = Number(res.body.data.id as number);
      createdStayIds.push(BigInt(stayId));
      expect(
        Math.abs(Date.now() - new Date(res.body.data.checkInAt as string).getTime()),
      ).toBeLessThan(60_000);

      const [stay, roomRow, bookingRow, occupancy] = await Promise.all([
        prisma.stay.findUniqueOrThrow({ where: { id: BigInt(stayId) } }),
        prisma.room.findUniqueOrThrow({ where: { id: BigInt(room.id) } }),
        prisma.booking.findUniqueOrThrow({ where: { id: BigInt(booking.id) } }),
        prisma.roomOccupancy.findMany({
          where: { stayId: BigInt(stayId) },
          orderBy: { date: 'asc' },
        }),
      ]);
      expect(Number(stay.createdBy)).toBe(receptionistUserId);
      expect(roomRow.status).toBe('OCCUPIED');
      expect(bookingRow.status).toBe('CHECKED_IN');
      expect(occupancy.map((row) => row.date.toISOString().slice(0, 10))).toEqual([d(0), d(1)]);
    });

    it('未到入住日 → 409 BOOKING_DATE_MISMATCH，且整体回滚（预订/房间/入住均不变）', async () => {
      const type = await seedRoomType('DM');
      const room = type.rooms[0]!;
      const guest = await seedGuest('DM');
      const booking = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest.id,
        checkInOffset: 1,
        checkOutOffset: 3,
      });

      const res = await checkIn(adminCookie, booking.id, { roomId: room.id });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'BOOKING_DATE_MISMATCH',
        message: '入住/离店日期与预订不符',
      });

      const [bookingRow, roomRow, stayCount] = await Promise.all([
        prisma.booking.findUniqueOrThrow({ where: { id: BigInt(booking.id) } }),
        prisma.room.findUniqueOrThrow({ where: { id: BigInt(room.id) } }),
        prisma.stay.count({ where: { bookingId: BigInt(booking.id) } }),
      ]);
      expect(bookingRow.status).toBe('CONFIRMED');
      expect(roomRow.status).toBe('VACANT_DIRTY');
      expect(stayCount).toBe(0);
    });

    it('房间维修中 → 409 ROOM_NOT_ASSIGNABLE（回滚）；房型不匹配 → 409', async () => {
      const type = await seedRoomType('MA');
      const room = type.rooms[0]!;
      await setRoomStatus(room.id, 'MAINTENANCE');
      const guest = await seedGuest('MA');
      const booking = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest.id,
        checkInOffset: 0,
        checkOutOffset: 1,
      });

      const maintenance = await checkIn(adminCookie, booking.id, { roomId: room.id });
      expect(maintenance.status).toBe(409);
      expect(maintenance.body.error).toMatchObject({
        code: 'ROOM_NOT_ASSIGNABLE',
        message: '房间处于维修或停用状态，不可分配',
      });

      const otherType = await seedRoomType('MA2');
      const mismatch = await checkIn(adminCookie, booking.id, {
        roomId: otherType.rooms[0]!.id,
      });
      expect(mismatch.status).toBe(409);
      expect(mismatch.body.error.code).toBe('ROOM_NOT_ASSIGNABLE');

      const bookingRow = await prisma.booking.findUniqueOrThrow({
        where: { id: BigInt(booking.id) },
      });
      expect(bookingRow.status).toBe('CONFIRMED');
      expect(await prisma.stay.count({ where: { bookingId: BigInt(booking.id) } })).toBe(0);
    });

    it('重复办理入住 → 409 BOOKING_STATUS_INVALID，且不产生第二条入住记录', async () => {
      const type = await seedRoomType('RP', { rooms: 2 });
      const guest = await seedGuest('RP');
      const booking = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest.id,
        checkInOffset: 0,
        checkOutOffset: 1,
      });

      const first = await checkIn(adminCookie, booking.id, { roomId: type.rooms[0]!.id });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      createdStayIds.push(BigInt(first.body.data.id as number));

      const again = await checkIn(adminCookie, booking.id, { roomId: type.rooms[1]!.id });
      expect(again.status).toBe(409);
      expect(again.body.error).toMatchObject({
        code: 'BOOKING_STATUS_INVALID',
        message: '该预订已办理入住或已取消',
      });
      expect(await prisma.stay.count({ where: { bookingId: BigInt(booking.id) } })).toBe(1);
    });

    it('价格覆盖生效（缺省取预订价，覆盖价优先，A-12）', async () => {
      const type = await seedRoomType('PR');
      const guest = await seedGuest('PR');
      const booking = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest.id,
        checkInOffset: 0,
        checkOutOffset: 1,
        pricePerNight: 288,
      });

      const res = await checkIn(adminCookie, booking.id, {
        roomId: type.rooms[0]!.id,
        pricePerNight: 320,
      });
      expect(res.status).toBe(200);
      createdStayIds.push(BigInt(res.body.data.id as number));
      expect(res.body.data.pricePerNight).toBe(320);
    });

    it('预订离店日已到/已过 → 409 BOOKING_DATE_MISMATCH（不再触发 CHECK 约束 500，审查 P-2）', async () => {
      const type = await seedRoomType('EX');
      const room = type.rooms[0]!;
      const guest = await seedGuest('EX');

      // 边界：离店日=昨日（已过）与离店日=今日（到达）；入住日均早于今日，A-18 不拦截
      for (const checkOutOffset of [-1, 0]) {
        const booking = await seedBookingDirect({
          roomTypeId: type.id,
          guestId: guest.id,
          checkInOffset: checkOutOffset - 2,
          checkOutOffset,
        });
        const res = await checkIn(adminCookie, booking.id, { roomId: room.id });
        expect(res.status, `checkOutOffset=${checkOutOffset}`).toBe(409);
        expect(res.body.error).toMatchObject({
          code: 'BOOKING_DATE_MISMATCH',
          message: '预订离店日期已到或已过，不可办理入住，请重新预订',
        });

        const [bookingRow, roomRow, stayCount] = await Promise.all([
          prisma.booking.findUniqueOrThrow({ where: { id: BigInt(booking.id) } }),
          prisma.room.findUniqueOrThrow({ where: { id: BigInt(room.id) } }),
          prisma.stay.count({ where: { bookingId: BigInt(booking.id) } }),
        ]);
        expect(bookingRow.status).toBe('CONFIRMED');
        expect(roomRow.status).toBe('VACANT_DIRTY');
        expect(stayCount).toBe(0);
      }
    });

    it('占用冲突（同房同日已有占用行）→ 409 ROOM_OCCUPIED 且回滚', async () => {
      const type = await seedRoomType('OC', { rooms: 2 });
      const room = type.rooms[0]!;
      const guest = await seedGuest('OC');
      // 构造不一致数据：房间状态 VACANT_CLEAN 但存在占用行（模拟历史/异常数据）
      await seedOccupiedStayDirect({
        roomId: room.id,
        roomTypeId: type.id,
        guestId: guest.id,
        occupancyDates: [d(0), d(1)],
      });
      await setRoomStatus(room.id, 'VACANT_CLEAN');

      const guest2 = await seedGuest('OC2');
      const booking = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest2.id,
        checkInOffset: 0,
        checkOutOffset: 2,
      });

      const res = await checkIn(adminCookie, booking.id, { roomId: room.id });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'ROOM_OCCUPIED',
        message: '该房间在所选日期已被占用',
      });

      const [bookingRow, roomRow, occupancyCount] = await Promise.all([
        prisma.booking.findUniqueOrThrow({ where: { id: BigInt(booking.id) } }),
        prisma.room.findUniqueOrThrow({ where: { id: BigInt(room.id) } }),
        prisma.roomOccupancy.count({ where: { roomId: BigInt(room.id) } }),
      ]);
      expect(bookingRow.status).toBe('CONFIRMED'); // 回滚：预订未被置为 CHECKED_IN
      expect(roomRow.status).toBe('VACANT_CLEAN'); // 回滚：房态未变
      expect(occupancyCount).toBe(2); // 仅有既有占用行
    });

    it('并发（TC-BK-021）：两笔预订并发入住同一房间仅一次成功', async () => {
      const type = await seedRoomType('CC');
      const room = type.rooms[0]!;
      const guestA = await seedGuest('CCA');
      const guestB = await seedGuest('CCB');
      const bookingA = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guestA.id,
        checkInOffset: 0,
        checkOutOffset: 1,
      });
      const bookingB = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guestB.id,
        checkInOffset: 0,
        checkOutOffset: 1,
      });

      const results = await Promise.all([
        checkIn(adminCookie, bookingA.id, { roomId: room.id }),
        checkIn(adminCookie, bookingB.id, { roomId: room.id }),
      ]);

      const succeeded = results.filter((res) => res.status === 200);
      const rejected = results.filter((res) => res.status === 409);
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(['ROOM_NOT_ASSIGNABLE', 'ROOM_OCCUPIED']).toContain(
        rejected[0]!.body.error.code as string,
      );
      createdStayIds.push(BigInt(succeeded[0]!.body.data.id as number));

      const statuses = await prisma.booking.findMany({
        where: { id: { in: [BigInt(bookingA.id), BigInt(bookingB.id)] } },
        select: { status: true },
      });
      expect(statuses.filter((row) => row.status === 'CHECKED_IN')).toHaveLength(1);
      expect(await prisma.stay.count({ where: { roomId: BigInt(room.id) } })).toBe(1);
      const roomRow = await prisma.room.findUniqueOrThrow({ where: { id: BigInt(room.id) } });
      expect(roomRow.status).toBe('OCCUPIED');
    });
  });

  describe('S1 无预订入住（walk-in）', () => {
    it('成功：bookingId 为 null，占用行与房态联动，记录操作员工', async () => {
      const type = await seedRoomType('WI');
      const room = type.rooms[0]!;
      const guest = await seedGuest('WI');

      const res = await walkIn(receptionistCookie, {
        guestId: guest.id,
        roomId: room.id,
        pricePerNight: 318,
        expectedCheckOutDate: d(2),
        depositAmount: 300,
        note: '深夜到店',
      });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        bookingId: null,
        guestId: guest.id,
        roomId: room.id,
        pricePerNight: 318,
        expectedCheckOutDate: d(2),
        depositAmount: 300,
        status: 'CHECKED_IN',
        note: '深夜到店',
      });
      const stayId = Number(res.body.data.id as number);
      createdStayIds.push(BigInt(stayId));

      const [stay, roomRow, occupancyCount] = await Promise.all([
        prisma.stay.findUniqueOrThrow({ where: { id: BigInt(stayId) } }),
        prisma.room.findUniqueOrThrow({ where: { id: BigInt(room.id) } }),
        prisma.roomOccupancy.count({ where: { stayId: BigInt(stayId) } }),
      ]);
      expect(Number(stay.createdBy)).toBe(receptionistUserId);
      expect(roomRow.status).toBe('OCCUPIED');
      expect(occupancyCount).toBe(2);
    });

    it('离店日期必须晚于酒店今日（同日 → 422）；房间/客人不存在 → 404', async () => {
      const type = await seedRoomType('WV');
      const room = type.rooms[0]!;
      const guest = await seedGuest('WV');

      const sameDay = await walkIn(adminCookie, {
        guestId: guest.id,
        roomId: room.id,
        pricePerNight: 300,
        expectedCheckOutDate: d(0),
      });
      expect(sameDay.status).toBe(422);
      expect(sameDay.body.error.details[0].field).toBe('expectedCheckOutDate');

      const missingRoom = await walkIn(adminCookie, {
        guestId: guest.id,
        roomId: 999999,
        pricePerNight: 300,
        expectedCheckOutDate: d(1),
      });
      expect(missingRoom.status).toBe(404);

      const missingGuest = await walkIn(adminCookie, {
        guestId: 999999,
        roomId: room.id,
        pricePerNight: 300,
        expectedCheckOutDate: d(1),
      });
      expect(missingGuest.status).toBe(404);
    });

    it('并发（TC-SY-004）：同一房间两个 walk-in 并发仅一次成功', async () => {
      const type = await seedRoomType('CW');
      const room = type.rooms[0]!;
      const guestA = await seedGuest('CWA');
      const guestB = await seedGuest('CWB');

      const body = (guestId: number) => ({
        guestId,
        roomId: room.id,
        pricePerNight: 300,
        expectedCheckOutDate: d(1),
      });
      const results = await Promise.all([
        walkIn(adminCookie, body(guestA.id)),
        walkIn(adminCookie, body(guestB.id)),
      ]);

      const succeeded = results.filter((res) => res.status === 200);
      expect(succeeded).toHaveLength(1);
      createdStayIds.push(BigInt(succeeded[0]!.body.data.id as number));
      const failed = results.filter((res) => res.status !== 200);
      expect(failed).toHaveLength(1);
      const failedCode = failed[0]!.body.error.code as string;
      expect(['ROOM_NOT_ASSIGNABLE', 'ROOM_OCCUPIED']).toContain(failedCode);
      expect(await prisma.stay.count({ where: { roomId: BigInt(room.id) } })).toBe(1);
    });
  });

  describe('S2 列表', () => {
    it('按状态/房间/关键字过滤，分页与排序白名单生效，注入 422', async () => {
      const type = await seedRoomType('LS', { rooms: 2 });
      const guest = await seedGuest('LS');
      const booking = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest.id,
        checkInOffset: 0,
        checkOutOffset: 2,
      });
      const checkedIn = await checkIn(adminCookie, booking.id, {
        roomId: type.rooms[0]!.id,
      });
      expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(200);
      createdStayIds.push(BigInt(checkedIn.body.data.id as number));

      const byRoom = await request(app)
        .get(`/api/v1/stays?roomId=${type.rooms[0]!.id}&status=CHECKED_IN`)
        .set('Cookie', adminCookie);
      expect(byRoom.status).toBe(200);
      expect(byRoom.body.data.pagination.total).toBe(1);
      expect(byRoom.body.data.items[0].guestName).toBe(guest.name);

      const byKeyword = await request(app)
        .get(`/api/v1/stays?keyword=${encodeURIComponent(guest.name)}`)
        .set('Cookie', adminCookie);
      expect(byKeyword.body.data.pagination.total).toBe(1);

      const paged = await request(app)
        .get(`/api/v1/stays?roomId=${type.rooms[0]!.id}&page=1&pageSize=1&sort=checkInAt:desc`)
        .set('Cookie', adminCookie);
      expect(paged.body.data.pagination).toMatchObject({ page: 1, pageSize: 1, total: 1 });

      for (const query of ['sort=id:asc', 'sort=checkInAt:up', 'page=0', 'pageSize=101']) {
        const res = await request(app).get(`/api/v1/stays?${query}`).set('Cookie', adminCookie);
        expect(res.status, query).toBe(422);
      }
    });
  });

  describe('S3 详情', () => {
    it('在住详情：预计晚数费用与空订单；不存在 404', async () => {
      const type = await seedRoomType('DT', { basePrice: 300 });
      const guest = await seedGuest('DT');
      const booking = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest.id,
        checkInOffset: 0,
        checkOutOffset: 2,
        pricePerNight: 288,
      });
      const checkedIn = await checkIn(adminCookie, booking.id, {
        roomId: type.rooms[0]!.id,
      });
      expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(200);
      const stayId = Number(checkedIn.body.data.id as number);
      createdStayIds.push(BigInt(stayId));

      const detail = await request(app).get(`/api/v1/stays/${stayId}`).set('Cookie', adminCookie);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({
        id: stayId,
        actualCheckOutAt: null,
        currentCharges: { roomFee: 576, miscTotal: 0, total: 576, nights: 2 },
        order: null,
      });

      const missing = await request(app).get('/api/v1/stays/999999').set('Cookie', adminCookie);
      expect(missing.status).toBe(404);
    });
  });

  describe('S4 退房结算', () => {
    it('成功：账单计算正确、房态/入住状态联动、释放当日及未来占用', async () => {
      const type = await seedRoomType('CO', { basePrice: 300 });
      const room = type.rooms[0]!;
      const guest = await seedGuest('CO');
      const booking = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest.id,
        checkInOffset: 0,
        checkOutOffset: 2,
        pricePerNight: 288,
      });
      const checkedIn = await checkIn(adminCookie, booking.id, {
        roomId: room.id,
        depositAmount: 200,
      });
      expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(200);
      const stayId = Number(checkedIn.body.data.id as number);
      createdStayIds.push(BigInt(stayId));

      const res = await checkout(receptionistCookie, stayId, {
        paymentMethod: 'WECHAT',
        miscItems: [{ name: '迷你吧消费', amount: 38 }],
        note: '客人对房费无异议',
      });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        stayId,
        status: 'PAID',
        totalAmount: 614, // 2 晚 × 288 + 38
        depositAmount: 200,
        depositApplied: 200,
        paidAmount: 414,
        paymentMethod: 'WECHAT',
        note: '客人对房费无异议',
      });
      expect(res.body.data.items).toEqual([
        { type: 'ROOM_FEE', name: '房费 2 晚 × 288.00', amount: 576 },
        { type: 'MISC', name: '迷你吧消费', amount: 38 },
        { type: 'DEPOSIT_APPLIED', name: '押金抵扣', amount: 200 },
      ]);

      const [stay, roomRow, bookingRow, occupancyCount, orderRow] = await Promise.all([
        prisma.stay.findUniqueOrThrow({ where: { id: BigInt(stayId) } }),
        prisma.room.findUniqueOrThrow({ where: { id: BigInt(room.id) } }),
        prisma.booking.findUniqueOrThrow({ where: { id: BigInt(booking.id) } }),
        prisma.roomOccupancy.count({ where: { stayId: BigInt(stayId) } }),
        prisma.order.findUniqueOrThrow({ where: { stayId: BigInt(stayId) } }),
      ]);
      expect(stay.status).toBe('CHECKED_OUT');
      expect(stay.actualCheckOutAt).not.toBeNull();
      expect(roomRow.status).toBe('VACANT_DIRTY');
      expect(bookingRow.status).toBe('CHECKED_IN'); // 预订为终态（database-design §5.1）
      expect(occupancyCount).toBe(0); // 当日及未来占用已释放
      expect(Number(orderRow.createdBy)).toBe(receptionistUserId);

      const detail = await request(app).get(`/api/v1/stays/${stayId}`).set('Cookie', adminCookie);
      expect(detail.body.data.order).toMatchObject({ id: Number(orderRow.id), totalAmount: 614 });
      expect(detail.body.data.currentCharges).toEqual({
        roomFee: 576,
        miscTotal: 38,
        total: 614,
        nights: 2,
      });
    });

    it('凌晨入住（UTC 前一日）按酒店本地日历日计晚数，不多收一晚（审查 P-1）', async () => {
      const type = await seedRoomType('NB', { basePrice: 100 });
      const room = type.rooms[0]!;
      const guest = await seedGuest('NB');

      // 上海今日 00:30（UTC 昨日 16:30），预计明日退房：酒店日历日语义为 1 晚
      const checkInAt = new Date(`${hotelToday()}T00:30:00+08:00`);
      const stay = await prisma.stay.create({
        data: {
          guestId: guest.id,
          roomId: room.id,
          roomTypeId: type.id,
          pricePerNight: 100,
          checkInAt,
          expectedCheckOutDate: new Date(`${d(1)}T00:00:00.000Z`),
          depositAmount: 0,
          status: 'CHECKED_IN',
          createdBy: adminUserId,
        },
      });
      createdStayIds.push(stay.id);
      await prisma.roomOccupancy.createMany({
        data: [{ stayId: stay.id, roomId: room.id, date: new Date(`${d(0)}T00:00:00.000Z`) }],
      });
      await setRoomStatus(room.id, 'OCCUPIED');

      // S3 详情口径与 S4 结算口径必须一致：1 晚 × 100
      const detail = await request(app)
        .get(`/api/v1/stays/${Number(stay.id)}`)
        .set('Cookie', adminCookie);
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);
      expect(detail.body.data.currentCharges).toEqual({
        roomFee: 100,
        miscTotal: 0,
        total: 100,
        nights: 1,
      });

      const res = await checkout(adminCookie, Number(stay.id), { paymentMethod: 'CASH' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ totalAmount: 100, paidAmount: 100 });
      expect(res.body.data.items).toEqual([
        { type: 'ROOM_FEE', name: '房费 1 晚 × 100.00', amount: 100 },
      ]);
    });

    it('重复退房 → 409 STAY_STATUS_INVALID，且只有一张账单', async () => {
      const type = await seedRoomType('RC');
      const guest = await seedGuest('RC');
      const booking = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest.id,
        checkInOffset: 0,
        checkOutOffset: 1,
      });
      const checkedIn = await checkIn(adminCookie, booking.id, { roomId: type.rooms[0]!.id });
      expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(200);
      const stayId = Number(checkedIn.body.data.id as number);
      createdStayIds.push(BigInt(stayId));

      const first = await checkout(adminCookie, stayId, { paymentMethod: 'CASH' });
      expect(first.status, JSON.stringify(first.body)).toBe(200);

      const again = await checkout(adminCookie, stayId, { paymentMethod: 'CASH' });
      expect(again.status).toBe(409);
      expect(again.body.error).toMatchObject({
        code: 'STAY_STATUS_INVALID',
        message: '该入住记录已退房，不可重复结算',
      });
      expect(await prisma.order.count({ where: { stayId: BigInt(stayId) } })).toBe(1);
    });

    it('并发（TC-SY-012）：两个并发退房请求仅一次成功，只生成一张账单', async () => {
      const type = await seedRoomType('PC');
      const guest = await seedGuest('PC');
      const booking = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest.id,
        checkInOffset: 0,
        checkOutOffset: 1,
      });
      const checkedIn = await checkIn(adminCookie, booking.id, { roomId: type.rooms[0]!.id });
      expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(200);
      const stayId = Number(checkedIn.body.data.id as number);
      createdStayIds.push(BigInt(stayId));

      const results = await Promise.all([
        checkout(adminCookie, stayId, { paymentMethod: 'CASH' }),
        checkout(adminCookie, stayId, { paymentMethod: 'CASH' }),
      ]);
      expect(results.filter((res) => res.status === 200)).toHaveLength(1);
      expect(results.filter((res) => res.status === 409)).toHaveLength(1);
      expect(await prisma.order.count({ where: { stayId: BigInt(stayId) } })).toBe(1);
      const stay = await prisma.stay.findUniqueOrThrow({ where: { id: BigInt(stayId) } });
      expect(stay.status).toBe('CHECKED_OUT');
    });

    it('押金大于总额：抵扣封顶为总额，实收为 0', async () => {
      const type = await seedRoomType('DP');
      const guest = await seedGuest('DP');
      const booking = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest.id,
        checkInOffset: 0,
        checkOutOffset: 1,
        pricePerNight: 100,
      });
      const checkedIn = await checkIn(adminCookie, booking.id, {
        roomId: type.rooms[0]!.id,
        depositAmount: 500,
      });
      const stayId = Number(checkedIn.body.data.id as number);
      createdStayIds.push(BigInt(stayId));

      const res = await checkout(adminCookie, stayId, { paymentMethod: 'ALIPAY' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        totalAmount: 100,
        depositAmount: 500,
        depositApplied: 100,
        paidAmount: 0,
      });
    });

    it('参数校验与资源不存在：支付方式/杂费非法 422；入住记录不存在 404', async () => {
      const type = await seedRoomType('IV');
      const guest = await seedGuest('IV');
      const booking = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest.id,
        checkInOffset: 0,
        checkOutOffset: 1,
      });
      const checkedIn = await checkIn(adminCookie, booking.id, { roomId: type.rooms[0]!.id });
      expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(200);
      const stayId = Number(checkedIn.body.data.id as number);
      createdStayIds.push(BigInt(stayId));

      const badMethod = await checkout(adminCookie, stayId, { paymentMethod: 'BITCOIN' });
      expect(badMethod.status).toBe(422);

      const badMisc = await checkout(adminCookie, stayId, {
        paymentMethod: 'CASH',
        miscItems: [{ name: 'x', amount: 0 }],
      });
      expect(badMisc.status).toBe(422);

      const tooManyMisc = await checkout(adminCookie, stayId, {
        paymentMethod: 'CASH',
        miscItems: Array.from({ length: 21 }, (_, index) => ({ name: `项${index}`, amount: 1 })),
      });
      expect(tooManyMisc.status).toBe(422);

      const missing = await checkout(adminCookie, 999999, { paymentMethod: 'CASH' });
      expect(missing.status).toBe(404);

      // 校验失败不应改变入住状态
      const stay = await prisma.stay.findUniqueOrThrow({ where: { id: BigInt(stayId) } });
      expect(stay.status).toBe('CHECKED_IN');
    });
  });
});
