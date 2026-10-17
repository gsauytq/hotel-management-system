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
import { createFakeUsersService } from '../support/fake-users.js';
import { createFakeStaysService } from '../support/fake-stays.js';

/**
 * 集成测试：Supertest + 真实 MySQL（开发计划 T-09）。
 * 默认不运行；执行方式：HMS_INTEGRATION=1 pnpm --filter @hms/server test
 * 并发用例（TC-BK-005）证明「房型行锁 + 重叠计数」在并发下的防超售正确性。
 */
const runIntegration =
  process.env['HMS_INTEGRATION'] === '1' && Boolean(process.env['DATABASE_URL']);

const suite = runIntegration ? describe : describe.skip;

/** 相对酒店本地“今日”的日期（YYYY-MM-DD），保证测试不受运行时刻影响 */
function d(offset: number): string {
  const today = new Date(`${hotelToday()}T00:00:00.000Z`);
  return new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

suite('客房预订集成测试（Supertest + 真实 MySQL）', () => {
  const password = 'Itest#Pass123';
  const runId = Date.now().toString(36).toUpperCase();
  const suffix = `${runId}${Math.floor(Math.random() * 46655)
    .toString(36)
    .toUpperCase()}`.replace(/[^A-Z0-9]/g, '');
  const usernamePrefix = `itest_bk_${runId.toLowerCase()}`;
  const codePrefix = `BK${suffix}`;
  const roomPrefix = `BK${suffix}`;

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
    const bookingsService = createBookingsService({
      repository: createBookingsRepository(prisma),
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
      bookingsService,
      staysService: createFakeStaysService(),
      ordersService: createFakeOrdersService(),
      usersService: createFakeUsersService(),
      guestsService: createFakeGuestsService(),
    });

    const admin = await seedUser('admin', 'ADMIN');
    adminUserId = admin.id;
    await seedUser('rec', 'RECEPTIONIST');
    adminCookie = await loginCookie(admin.username);
    receptionistCookie = await loginCookie(`${usernamePrefix}_rec`);
  });

  afterAll(async () => {
    // 清理顺序：stays → bookings → rooms → room_types → guests → users
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
        displayName: '预订测试用户',
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

  async function seedRoomType(
    tag: string,
    options: { basePrice?: number; status?: 'ACTIVE' | 'ARCHIVED'; rooms?: number } = {},
  ) {
    const roomType = await prisma.roomType.create({
      data: {
        code: `${codePrefix}${tag}`,
        name: `预订测试房型${tag}`,
        basePrice: options.basePrice ?? 300,
        capacity: 2,
        status: options.status ?? 'ACTIVE',
      },
    });
    createdRoomTypeIds.push(roomType.id);
    const roomCount = options.rooms ?? 1;
    for (let index = 1; index <= roomCount; index += 1) {
      const room = await prisma.room.create({
        data: { roomNumber: `${roomPrefix}${tag}${index}`, roomTypeId: roomType.id },
      });
      createdRoomIds.push(room.id);
    }
    return { id: Number(roomType.id), name: roomType.name };
  }

  async function seedGuest(tag: string) {
    const guest = await prisma.guest.create({
      data: {
        name: `预订集成${tag}${suffix}`,
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
    status?: 'CONFIRMED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW';
  }) {
    const booking = await prisma.booking.create({
      data: {
        guestId: params.guestId,
        roomTypeId: params.roomTypeId,
        checkInDate: new Date(`${d(params.checkInOffset)}T00:00:00.000Z`),
        checkOutDate: new Date(`${d(params.checkOutOffset)}T00:00:00.000Z`),
        pricePerNight: 300,
        totalPrice: 300 * (params.checkOutOffset - params.checkInOffset),
        status: params.status ?? 'CONFIRMED',
        createdBy: adminUserId,
      },
    });
    createdBookingIds.push(booking.id);
    return { id: Number(booking.id) };
  }

  function createBooking(cookie: string, body: Record<string, unknown>) {
    return request(app).post('/api/v1/bookings').set('Cookie', cookie).send(body);
  }

  describe('认证与权限', () => {
    it('未登录访问预订全部端点 → 401 SESSION_EXPIRED', async () => {
      const requests = [
        request(app).get('/api/v1/bookings'),
        request(app).get('/api/v1/bookings/1'),
        request(app).post('/api/v1/bookings').send({}),
        request(app).post('/api/v1/bookings/1/cancel').send({}),
        request(app).post('/api/v1/bookings/1/no-show'),
      ];
      for (const pending of requests) {
        const res = await pending;
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('SESSION_EXPIRED');
      }
    });

    it('RECEPTIONIST 可创建与取消（预订操作登录角色均可）', async () => {
      const type = await seedRoomType('P');
      const guest = await seedGuest('P');
      const created = await createBooking(receptionistCookie, {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(1),
        checkOutDate: d(2),
      });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      createdBookingIds.push(BigInt(created.body.data.id as number));

      const cancelled = await request(app)
        .post(`/api/v1/bookings/${created.body.data.id}/cancel`)
        .set('Cookie', receptionistCookie)
        .send({ reason: '前台取消' });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.data.status).toBe('CANCELLED');
    });
  });

  describe('B1 创建与价格快照', () => {
    it('成功：返回客人/房型摘要，价格快照与总价由服务端计算，记录 createdBy', async () => {
      const type = await seedRoomType('A', { basePrice: 300 });
      const guest = await seedGuest('A');

      const res = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(1),
        checkOutDate: d(3),
        pricePerNight: 288,
        note: '高楼层',
      });

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        guestId: guest.id,
        guestName: guest.name,
        guestPhone: '13800138000',
        roomTypeId: type.id,
        roomTypeName: type.name,
        checkInDate: d(1),
        checkOutDate: d(3),
        roomCount: 1,
        pricePerNight: 288,
        totalPrice: 576,
        status: 'CONFIRMED',
        note: '高楼层',
      });
      createdBookingIds.push(BigInt(res.body.data.id as number));

      const row = await prisma.booking.findUniqueOrThrow({
        where: { id: BigInt(res.body.data.id as number) },
      });
      expect(Number(row.createdBy)).toBe(adminUserId);
      expect(row.pricePerNight.toNumber()).toBe(288);
      expect(row.totalPrice.toNumber()).toBe(576);
    });

    it('缺省价格：取房型基准价快照（A-12）', async () => {
      const type = await seedRoomType('B', { basePrice: 299.5 });
      const guest = await seedGuest('B');
      const res = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(5),
        checkOutDate: d(6),
      });
      expect(res.status).toBe(200);
      createdBookingIds.push(BigInt(res.body.data.id as number));
      expect(res.body.data).toMatchObject({ pricePerNight: 299.5, totalPrice: 299.5 });
    });

    it('日期边界：今日可订；过去 422；同日 422；不信任客户端总价（严格 schema）', async () => {
      const type = await seedRoomType('C');
      const guest = await seedGuest('C');

      const todayBooking = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(0),
        checkOutDate: d(1),
      });
      expect(todayBooking.status, JSON.stringify(todayBooking.body)).toBe(200);
      createdBookingIds.push(BigInt(todayBooking.body.data.id as number));

      const past = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(-1),
        checkOutDate: d(1),
      });
      expect(past.status).toBe(422);
      expect(past.body.error.code).toBe('VALIDATION_FAILED');

      const sameDay = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(2),
        checkOutDate: d(2),
      });
      expect(sameDay.status).toBe(422);
      expect(sameDay.body.error.details[0].field).toBe('checkOutDate');

      const forgedTotal = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(2),
        checkOutDate: d(3),
        totalPrice: 0.01,
      });
      expect(forgedTotal.status).toBe(422);
    });

    it('无效客人 404；归档房型 409；房型不存在 404', async () => {
      const type = await seedRoomType('D');
      const archived = await seedRoomType('DX', { status: 'ARCHIVED' });
      const guest = await seedGuest('D');

      const missingGuest = await createBooking(adminCookie, {
        guestId: 999999,
        roomTypeId: type.id,
        checkInDate: d(1),
        checkOutDate: d(2),
      });
      expect(missingGuest.status).toBe(404);

      const archivedType = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: archived.id,
        checkInDate: d(1),
        checkOutDate: d(2),
      });
      expect(archivedType.status).toBe(409);
      expect(archivedType.body.error.code).toBe('ROOM_TYPE_ARCHIVED');

      const missingType = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: 999999,
        checkInDate: d(1),
        checkOutDate: d(2),
      });
      expect(missingType.status).toBe(404);
    });

    it('半开区间重叠判定与售罄（1 房：重复/部分重叠拒绝，相邻区间允许）', async () => {
      const type = await seedRoomType('E', { rooms: 1 });
      const guest = await seedGuest('E');
      const mk = (from: number, to: number) =>
        createBooking(adminCookie, {
          guestId: guest.id,
          roomTypeId: type.id,
          checkInDate: d(from),
          checkOutDate: d(to),
        });

      const first = await mk(10, 12); // A: [10,12)
      expect(first.status).toBe(200);
      createdBookingIds.push(BigInt(first.body.data.id as number));

      const duplicate = await mk(10, 12);
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error).toMatchObject({
        code: 'ROOM_TYPE_SOLD_OUT',
        details: [{ field: 'checkOutDate', message: '剩余可售: 0' }],
      });

      const partialOverlap = await mk(11, 13);
      expect(partialOverlap.status).toBe(409);

      const checkoutDay = await mk(12, 14); // [12,14) 与 [10,12) 无重叠（退房日当日可再订）
      expect(checkoutDay.status).toBe(200);
      createdBookingIds.push(BigInt(checkoutDay.body.data.id as number));

      const adjacentBefore = await mk(8, 10); // [8,10) 与 [10,12) 无重叠
      expect(adjacentBefore.status).toBe(200);
      createdBookingIds.push(BigInt(adjacentBefore.body.data.id as number));
    });

    it('同一客人重叠时段预订当前允许（Q-TP-01 语义固化；容量足够时仅受房量约束）', async () => {
      const type = await seedRoomType('G', { rooms: 2 });
      const guest = await seedGuest('G');

      const first = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(30),
        checkOutDate: d(32),
      });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      createdBookingIds.push(BigInt(first.body.data.id as number));

      const overlapping = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(31),
        checkOutDate: d(33),
      });
      // 现行模型无客人维度冲突规则（仅房型容量约束，A-03）；若业务裁决改为拒绝，
      // 应走需求变更并同步修改本断言（见 docs/test-plan.md §11 Q-TP-01）。
      expect(overlapping.status, JSON.stringify(overlapping.body)).toBe(200);
      createdBookingIds.push(BigInt(overlapping.body.data.id as number));

      const confirmedCount = await prisma.booking.count({
        where: {
          guestId: BigInt(guest.id),
          status: 'CONFIRMED',
          checkInDate: { lt: new Date(`${d(33)}T00:00:00.000Z`) },
          checkOutDate: { gt: new Date(`${d(30)}T00:00:00.000Z`) },
        },
      });
      expect(confirmedCount).toBe(2);
    });

    it('并发（TC-BK-005）：2 房房型 10 个并发创建仅 2 个成功，DB 中 CONFIRMED 恰为 2', async () => {
      const type = await seedRoomType('F', { rooms: 2 });
      const guest = await seedGuest('F');

      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          createBooking(adminCookie, {
            guestId: guest.id,
            roomTypeId: type.id,
            checkInDate: d(20),
            checkOutDate: d(22),
          }),
        ),
      );

      const succeeded = responses.filter((res) => res.status === 200);
      const rejected = responses.filter((res) => res.status === 409);
      expect(succeeded).toHaveLength(2);
      expect(rejected).toHaveLength(8);
      for (const res of rejected) {
        expect(res.body.error.code).toBe('ROOM_TYPE_SOLD_OUT');
      }
      for (const res of succeeded) {
        createdBookingIds.push(BigInt(res.body.data.id as number));
      }

      const confirmedCount = await prisma.booking.count({
        where: {
          roomTypeId: type.id,
          status: 'CONFIRMED',
          checkInDate: { lt: new Date(`${d(22)}T00:00:00.000Z`) },
          checkOutDate: { gt: new Date(`${d(20)}T00:00:00.000Z`) },
        },
      });
      expect(confirmedCount).toBe(2);
    });
  });

  describe('B2 列表查询', () => {
    it('按状态/客人/关键字/入住日期范围/退房日期范围过滤，分页与排序白名单生效', async () => {
      const type = await seedRoomType('L', { rooms: 3 });
      const guestA = await seedGuest('LA');
      const guestB = await seedGuest('LB');

      const bookingA1 = await createBooking(adminCookie, {
        guestId: guestA.id,
        roomTypeId: type.id,
        checkInDate: d(40),
        checkOutDate: d(42),
      });
      expect(bookingA1.status).toBe(200);
      createdBookingIds.push(BigInt(bookingA1.body.data.id as number));

      const bookingA2 = await createBooking(adminCookie, {
        guestId: guestA.id,
        roomTypeId: type.id,
        checkInDate: d(45),
        checkOutDate: d(47),
      });
      expect(bookingA2.status).toBe(200);
      createdBookingIds.push(BigInt(bookingA2.body.data.id as number));

      const bookingB = await createBooking(adminCookie, {
        guestId: guestB.id,
        roomTypeId: type.id,
        checkInDate: d(50),
        checkOutDate: d(51),
      });
      expect(bookingB.status).toBe(200);
      const bookingBId = BigInt(bookingB.body.data.id as number);
      createdBookingIds.push(bookingBId);

      // 状态 + 客人过滤 + 排序
      const byGuest = await request(app)
        .get(`/api/v1/bookings?guestId=${guestA.id}&status=CONFIRMED&sort=checkInDate:asc`)
        .set('Cookie', adminCookie);
      expect(byGuest.status).toBe(200);
      expect(byGuest.body.data.pagination.total).toBe(2);
      expect(byGuest.body.data.items[0].checkInDate).toBe(d(40));

      // 关键字（客人姓名子串）
      const byKeyword = await request(app)
        .get(`/api/v1/bookings?keyword=${encodeURIComponent(guestB.name)}`)
        .set('Cookie', adminCookie);
      expect(byKeyword.body.data.pagination.total).toBe(1);
      expect(byKeyword.body.data.items[0].id).toBe(Number(bookingBId));

      // 入住日期范围
      const byCheckInRange = await request(app)
        .get(
          `/api/v1/bookings?guestId=${guestA.id}&checkInDateFrom=${d(44)}&checkInDateTo=${d(46)}`,
        )
        .set('Cookie', adminCookie);
      expect(byCheckInRange.body.data.pagination.total).toBe(1);
      expect(byCheckInRange.body.data.items[0].checkInDate).toBe(d(45));

      // ★ 退房日期范围（增量参数）
      const byCheckOutRange = await request(app)
        .get(
          `/api/v1/bookings?guestId=${guestA.id}&checkOutDateFrom=${d(46)}&checkOutDateTo=${d(48)}`,
        )
        .set('Cookie', adminCookie);
      expect(byCheckOutRange.body.data.pagination.total).toBe(1);
      expect(byCheckOutRange.body.data.items[0].checkOutDate).toBe(d(47));

      // 分页
      const paged = await request(app)
        .get(`/api/v1/bookings?guestId=${guestA.id}&page=2&pageSize=1`)
        .set('Cookie', adminCookie);
      expect(paged.body.data.pagination).toEqual({
        page: 2,
        pageSize: 1,
        total: 2,
        totalPages: 2,
      });

      // 排序白名单/注入与非法分页
      for (const query of ['sort=id:asc', 'sort=createdAt:up', 'page=0', 'pageSize=101']) {
        const res = await request(app).get(`/api/v1/bookings?${query}`).set('Cookie', adminCookie);
        expect(res.status, query).toBe(422);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
    });
  });

  describe('B3 详情', () => {
    it('详情返回完整字段；不存在 404；已入住预订含 stayId', async () => {
      const type = await seedRoomType('T');
      const guest = await seedGuest('T');
      const created = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(60),
        checkOutDate: d(62),
      });
      expect(created.status).toBe(200);
      const bookingId = Number(created.body.data.id as number);
      createdBookingIds.push(BigInt(bookingId));

      const detail = await request(app)
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Cookie', adminCookie);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({
        id: bookingId,
        guestName: guest.name,
        roomTypeName: type.name,
        stayId: null,
        cancelledAt: null,
        cancelReason: null,
      });

      const missing = await request(app).get('/api/v1/bookings/999999').set('Cookie', adminCookie);
      expect(missing.status).toBe(404);

      // 已入住：stay 关联后 detail 返回 stayId
      const room = await prisma.room.findFirstOrThrow({ where: { roomTypeId: type.id } });
      const stay = await prisma.stay.create({
        data: {
          bookingId: BigInt(bookingId),
          guestId: BigInt(guest.id),
          roomId: room.id,
          roomTypeId: BigInt(type.id),
          pricePerNight: 300,
          checkInAt: new Date(),
          expectedCheckOutDate: new Date(`${d(62)}T00:00:00.000Z`),
          createdBy: BigInt(adminUserId),
        },
      });
      createdStayIds.push(stay.id);
      await prisma.booking.update({
        where: { id: BigInt(bookingId) },
        data: { status: 'CHECKED_IN' },
      });

      const checkedInDetail = await request(app)
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Cookie', adminCookie);
      expect(checkedInDetail.body.data.stayId).toBe(Number(stay.id));
    });
  });

  describe('B4 取消（状态机 + 释放房量 + 保留历史）', () => {
    it('取消成功：状态/CANCELLED、cancelledAt、原因持久化；记录保留；重复取消 409', async () => {
      const type = await seedRoomType('X');
      const guest = await seedGuest('X');
      const created = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(70),
        checkOutDate: d(72),
      });
      const bookingId = Number(created.body.data.id as number);
      createdBookingIds.push(BigInt(bookingId));

      const cancelled = await request(app)
        .post(`/api/v1/bookings/${bookingId}/cancel`)
        .set('Cookie', adminCookie)
        .send({ reason: '客人行程变更' });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.data).toMatchObject({
        status: 'CANCELLED',
        cancelReason: '客人行程变更',
      });
      expect(cancelled.body.data.cancelledAt).not.toBeNull();

      // 不物理删除：记录仍存在
      const row = await prisma.booking.findUnique({ where: { id: BigInt(bookingId) } });
      expect(row).not.toBeNull();
      expect(row?.status).toBe('CANCELLED');

      const again = await request(app)
        .post(`/api/v1/bookings/${bookingId}/cancel`)
        .set('Cookie', adminCookie)
        .send({});
      expect(again.status).toBe(409);
      expect(again.body.error).toMatchObject({
        code: 'BOOKING_STATUS_INVALID',
        message: '仅已确认预订可取消',
      });
    });

    it('CHECKED_IN 不可取消 → 409', async () => {
      const type = await seedRoomType('Y');
      const guest = await seedGuest('Y');
      const seeded = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest.id,
        checkInOffset: 80,
        checkOutOffset: 82,
        status: 'CHECKED_IN',
      });

      const res = await request(app)
        .post(`/api/v1/bookings/${seeded.id}/cancel`)
        .set('Cookie', adminCookie)
        .send({});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BOOKING_STATUS_INVALID');
    });

    it('取消释放房量：1 房房型售罄后取消，可再次预订同区间', async () => {
      const type = await seedRoomType('Z', { rooms: 1 });
      const guest = await seedGuest('Z');
      const mk = () =>
        createBooking(adminCookie, {
          guestId: guest.id,
          roomTypeId: type.id,
          checkInDate: d(90),
          checkOutDate: d(92),
        });

      const first = await mk();
      expect(first.status).toBe(200);
      const bookingId = Number(first.body.data.id as number);
      createdBookingIds.push(BigInt(bookingId));

      const blocked = await mk();
      expect(blocked.status).toBe(409);

      const cancelled = await request(app)
        .post(`/api/v1/bookings/${bookingId}/cancel`)
        .set('Cookie', adminCookie)
        .send({});
      expect(cancelled.status).toBe(200);

      const rebooked = await mk();
      expect(rebooked.status, JSON.stringify(rebooked.body)).toBe(200);
      createdBookingIds.push(BigInt(rebooked.body.data.id as number));
    });
  });

  describe('B5 标记未到（NO_SHOW）', () => {
    it('未来入住日不可标记 → 409；今日入住可标记并释放房量；重复标记 409', async () => {
      const type = await seedRoomType('N', { rooms: 1 });
      const guest = await seedGuest('N');

      const future = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(30),
        checkOutDate: d(32),
      });
      expect(future.status).toBe(200);
      const futureId = Number(future.body.data.id as number);
      createdBookingIds.push(BigInt(futureId));

      const tooEarly = await request(app)
        .post(`/api/v1/bookings/${futureId}/no-show`)
        .set('Cookie', adminCookie);
      expect(tooEarly.status).toBe(409);
      expect(tooEarly.body.error).toMatchObject({
        code: 'BOOKING_STATUS_INVALID',
        message: '未到入住日，暂不可标记未到',
      });

      // 今日入住的预订（1 房房型已被 future 占用？区间 [30,32) 与 [0,1) 不重叠，可创建）
      const todayBooking = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(0),
        checkOutDate: d(1),
        note: '今日到店',
      });
      expect(todayBooking.status, JSON.stringify(todayBooking.body)).toBe(200);
      const todayId = Number(todayBooking.body.data.id as number);
      createdBookingIds.push(BigInt(todayId));

      const marked = await request(app)
        .post(`/api/v1/bookings/${todayId}/no-show`)
        .set('Cookie', adminCookie);
      expect(marked.status).toBe(200);
      expect(marked.body.data.status).toBe('NO_SHOW');

      // 释放房量：同区间可再次预订
      const rebooked = await createBooking(adminCookie, {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: d(0),
        checkOutDate: d(1),
      });
      expect(rebooked.status).toBe(200);
      createdBookingIds.push(BigInt(rebooked.body.data.id as number));

      const again = await request(app)
        .post(`/api/v1/bookings/${todayId}/no-show`)
        .set('Cookie', adminCookie);
      expect(again.status).toBe(409);
      expect(again.body.error.message).toBe('仅已确认预订可标记未到');
    });

    it('历史（入住日已过）的 CONFIRMED 预订可标记未到', async () => {
      const type = await seedRoomType('H');
      const guest = await seedGuest('H');
      const seeded = await seedBookingDirect({
        roomTypeId: type.id,
        guestId: guest.id,
        checkInOffset: -3,
        checkOutOffset: -1,
      });

      const res = await request(app)
        .post(`/api/v1/bookings/${seeded.id}/no-show`)
        .set('Cookie', adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('NO_SHOW');
    });
  });
});
