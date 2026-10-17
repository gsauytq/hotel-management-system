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
import { createOrdersRepository } from '../../src/modules/orders/orders.repository.js';
import { createOrdersService } from '../../src/modules/orders/orders.service.js';
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
import { createFakeUsersService } from '../support/fake-users.js';

/**
 * 集成测试：Supertest + 真实 MySQL（开发计划 T-11 账单读取/金额边界/防重）。
 * 默认不运行；执行方式：HMS_INTEGRATION=1 pnpm --filter @hms/server test
 */
const runIntegration =
  process.env['HMS_INTEGRATION'] === '1' && Boolean(process.env['DATABASE_URL']);

const suite = runIntegration ? describe : describe.skip;

function d(offset: number): string {
  const today = new Date(`${hotelToday()}T00:00:00.000Z`);
  return new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

suite('账单查询与金额边界集成测试（Supertest + 真实 MySQL）', () => {
  const password = 'Itest#Pass123';
  const runId = Date.now().toString(36).toUpperCase();
  const suffix = `${runId}${Math.floor(Math.random() * 46655)
    .toString(36)
    .toUpperCase()}`.replace(/[^A-Z0-9]/g, '');
  const usernamePrefix = `itest_od_${runId.toLowerCase()}`;
  const codePrefix = `OD${suffix}`;
  const roomPrefix = `OD${suffix}`;

  const createdStayIds: bigint[] = [];
  const createdBookingIds: bigint[] = [];
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
      ordersService: createOrdersService({
        repository: createOrdersRepository(prisma),
      }),
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
        displayName: '账单测试用户',
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

  async function seedGuest(tag: string) {
    const guest = await prisma.guest.create({
      data: {
        name: `账单集成${tag}${suffix}`,
        phone: '13800138000',
        idType: 'ID_CARD',
        idNumberHash: randomBytes(32).toString('hex'),
        idNumberCipher: Buffer.from('test-cipher'),
      },
    });
    createdGuestIds.push(guest.id);
    return { id: Number(guest.id), name: guest.name };
  }

  async function seedRoomType(tag: string, basePrice = 300) {
    const roomType = await prisma.roomType.create({
      data: {
        code: `${codePrefix}${tag}`,
        name: `账单测试房型${tag}`,
        basePrice,
        capacity: 2,
      },
    });
    createdRoomTypeIds.push(roomType.id);
    const room = await prisma.room.create({
      data: { roomNumber: `${roomPrefix}${tag}`, roomTypeId: roomType.id },
    });
    createdRoomIds.push(room.id);
    return { id: Number(roomType.id), roomId: Number(room.id) };
  }

  /** 完成一次「预订 → 入住 → 退房」，返回账单 id 与本次入住信息 */
  async function bookStayAndCheckout(params: {
    tag: string;
    pricePerNight: number;
    nights: number;
    depositAmount?: number;
    miscItems?: Array<{ name: string; amount: number }>;
    cookie?: string;
    paymentMethod?: string;
  }) {
    const type = await seedRoomType(params.tag, params.pricePerNight);
    const guest = await seedGuest(params.tag);
    const booking = await prisma.booking.create({
      data: {
        guestId: guest.id,
        roomTypeId: type.id,
        checkInDate: new Date(`${d(0)}T00:00:00.000Z`),
        checkOutDate: new Date(`${d(params.nights)}T00:00:00.000Z`),
        pricePerNight: params.pricePerNight,
        totalPrice: params.pricePerNight * params.nights,
        status: 'CONFIRMED',
        createdBy: adminUserId,
      },
    });
    createdBookingIds.push(booking.id);

    const cookie = params.cookie ?? adminCookie;
    const checkedIn = await request(app)
      .post(`/api/v1/bookings/${Number(booking.id)}/check-in`)
      .set('Cookie', cookie)
      .send({ roomId: type.roomId, depositAmount: params.depositAmount ?? 0 });
    expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(200);
    const stayId = Number(checkedIn.body.data.id as number);
    createdStayIds.push(BigInt(stayId));

    const checkout = await request(app)
      .post(`/api/v1/stays/${stayId}/checkout`)
      .set('Cookie', cookie)
      .send({
        paymentMethod: params.paymentMethod ?? 'CASH',
        miscItems: params.miscItems ?? [],
      });
    expect(checkout.status, JSON.stringify(checkout.body)).toBe(200);
    return { orderId: Number(checkout.body.data.id as number), stayId };
  }

  describe('认证与权限（订单查询：前台/管理员均可）', () => {
    it('未登录访问 /orders 与 /orders/{id} → 401 SESSION_EXPIRED', async () => {
      for (const pending of [
        request(app).get('/api/v1/orders'),
        request(app).get('/api/v1/orders/1'),
      ]) {
        const res = await pending;
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('SESSION_EXPIRED');
      }
    });

    it('RECEPTIONIST 可完成退房并查询账单', async () => {
      const { orderId, stayId } = await bookStayAndCheckout({
        tag: 'REC',
        pricePerNight: 100,
        nights: 1,
        cookie: receptionistCookie,
      });

      const detail = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Cookie', receptionistCookie);
      expect(detail.status).toBe(200);
      expect(detail.body.data.stayId).toBe(stayId);

      const list = await request(app)
        .get(`/api/v1/orders?stayId=${stayId}`)
        .set('Cookie', receptionistCookie);
      expect(list.status).toBe(200);
      expect(list.body.data.pagination.total).toBe(1);
    });
  });

  describe('O2 账单详情', () => {
    it('返回完整明细与押金抵扣；不存在 404；非法 id 422', async () => {
      const { orderId } = await bookStayAndCheckout({
        tag: 'DETAIL',
        pricePerNight: 288,
        nights: 2,
        depositAmount: 200,
        miscItems: [{ name: '迷你吧消费', amount: 38 }],
        paymentMethod: 'WECHAT',
      });

      const res = await request(app).get(`/api/v1/orders/${orderId}`).set('Cookie', adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: orderId,
        status: 'PAID',
        totalAmount: 614,
        depositAmount: 200,
        depositApplied: 200,
        paidAmount: 414,
        paymentMethod: 'WECHAT',
      });
      expect(res.body.data.items).toEqual([
        { type: 'ROOM_FEE', name: '房费 2 晚 × 288.00', amount: 576 },
        { type: 'MISC', name: '迷你吧消费', amount: 38 },
        { type: 'DEPOSIT_APPLIED', name: '押金抵扣', amount: 200 },
      ]);

      const missing = await request(app).get('/api/v1/orders/999999').set('Cookie', adminCookie);
      expect(missing.status).toBe(404);

      const invalid = await request(app).get('/api/v1/orders/abc').set('Cookie', adminCookie);
      expect(invalid.status).toBe(422);
    });
  });

  describe('O1 账单列表', () => {
    it('按入住记录/酒店本地日范围过滤；分页与排序白名单生效；注入 422', async () => {
      const first = await bookStayAndCheckout({ tag: 'LIST1', pricePerNight: 100, nights: 1 });
      const second = await bookStayAndCheckout({ tag: 'LIST2', pricePerNight: 120, nights: 1 });

      // stayId 过滤 + OrderListItem 字段
      const byStay = await request(app)
        .get(`/api/v1/orders?stayId=${first.stayId}`)
        .set('Cookie', adminCookie);
      expect(byStay.status).toBe(200);
      expect(byStay.body.data.items).toEqual([
        expect.objectContaining({
          id: first.orderId,
          stayId: first.stayId,
          guestName: expect.stringContaining('账单集成LIST1'),
          roomNumber: expect.stringContaining('OD'),
          totalAmount: 100,
          paidAmount: 100,
          paymentMethod: 'CASH',
          status: 'PAID',
        }),
      ]);

      // 酒店本地日范围：今天（含）能查到，明天（起）查不到
      const todayRange = await request(app)
        .get(`/api/v1/orders?createdFrom=${hotelToday()}&createdTo=${hotelToday()}&pageSize=100`)
        .set('Cookie', adminCookie);
      const todayIds = (todayRange.body.data.items as Array<{ id: number }>).map((item) => item.id);
      expect(todayIds).toContain(first.orderId);
      expect(todayIds).toContain(second.orderId);

      const tomorrowRange = await request(app)
        .get(`/api/v1/orders?createdFrom=${d(1)}&createdTo=${d(1)}&pageSize=100`)
        .set('Cookie', adminCookie);
      expect(
        (tomorrowRange.body.data.items as Array<{ id: number }>).map((item) => item.id),
      ).not.toContain(first.orderId);

      // 分页：pageSize=1 时 total ≥ 2 且每页 1 条
      const paged = await request(app)
        .get(
          `/api/v1/orders?createdFrom=${hotelToday()}&createdTo=${hotelToday()}&page=1&pageSize=1`,
        )
        .set('Cookie', adminCookie);
      expect(paged.body.data.items).toHaveLength(1);
      expect(paged.body.data.pagination.total).toBeGreaterThanOrEqual(2);
      expect(paged.body.data.pagination.totalPages).toBe(paged.body.data.pagination.total);

      // 排序白名单：createdAt 允许；其余字段与注入 422
      const sorted = await request(app)
        .get('/api/v1/orders?sort=createdAt:asc')
        .set('Cookie', adminCookie);
      expect(sorted.status).toBe(200);
      for (const query of ['sort=id:asc', 'sort=createdAt:up', 'page=0', 'pageSize=101']) {
        const res = await request(app).get(`/api/v1/orders?${query}`).set('Cookie', adminCookie);
        expect(res.status, query).toBe(422);
      }
    });
  });

  describe('金额边界（服务端 DECIMAL 精确计算）', () => {
    it('最小金额：房价 0.01 × 1 晚、押金 0 → 应付 0.01（无押金抵扣项）', async () => {
      const { orderId } = await bookStayAndCheckout({
        tag: 'MIN',
        pricePerNight: 0.01,
        nights: 1,
      });
      const res = await request(app).get(`/api/v1/orders/${orderId}`).set('Cookie', adminCookie);
      expect(res.body.data).toMatchObject({
        totalAmount: 0.01,
        depositAmount: 0,
        depositApplied: 0,
        paidAmount: 0.01,
      });
      expect(res.body.data.items).toEqual([
        { type: 'ROOM_FEE', name: '房费 1 晚 × 0.01', amount: 0.01 },
      ]);
    });

    it('押金等于总额 → 抵扣封顶、实收 0、含 DEPOSIT_APPLIED 明细', async () => {
      const { orderId } = await bookStayAndCheckout({
        tag: 'EXACT',
        pricePerNight: 50,
        nights: 1,
        depositAmount: 50,
      });
      const res = await request(app).get(`/api/v1/orders/${orderId}`).set('Cookie', adminCookie);
      expect(res.body.data).toMatchObject({
        totalAmount: 50,
        depositApplied: 50,
        paidAmount: 0,
      });
      expect(res.body.data.items).toEqual([
        { type: 'ROOM_FEE', name: '房费 1 晚 × 50.00', amount: 50 },
        { type: 'DEPOSIT_APPLIED', name: '押金抵扣', amount: 50 },
      ]);
    });

    it('两位小数累计不漂移：33.33 × 3 晚 + 0.01 = 100.00', async () => {
      const { orderId } = await bookStayAndCheckout({
        tag: 'ROUND',
        pricePerNight: 33.33,
        nights: 3,
        miscItems: [{ name: '瓶装水', amount: 0.01 }],
      });
      const res = await request(app).get(`/api/v1/orders/${orderId}`).set('Cookie', adminCookie);
      expect(res.body.data).toMatchObject({
        totalAmount: 100,
        paidAmount: 100,
      });
      expect(res.body.data.items[0]).toEqual({
        type: 'ROOM_FEE',
        name: '房费 3 晚 × 33.33',
        amount: 99.99,
      });
    });

    it('大额杂费边界 99999.99 精确保留', async () => {
      const { orderId } = await bookStayAndCheckout({
        tag: 'MAX',
        pricePerNight: 1,
        nights: 1,
        miscItems: [{ name: '会议室包场', amount: 99999.99 }],
      });
      const res = await request(app).get(`/api/v1/orders/${orderId}`).set('Cookie', adminCookie);
      expect(res.body.data).toMatchObject({
        totalAmount: 100000.99,
        paidAmount: 100000.99,
      });
    });

    it('客户端伪造最终金额（totalAmount 字段）→ 422（严格 schema）', async () => {
      const type = await seedRoomType('FORGE', 100);
      const guest = await seedGuest('FORGE');
      const booking = await prisma.booking.create({
        data: {
          guestId: guest.id,
          roomTypeId: type.id,
          checkInDate: new Date(`${d(0)}T00:00:00.000Z`),
          checkOutDate: new Date(`${d(1)}T00:00:00.000Z`),
          pricePerNight: 100,
          totalPrice: 100,
          createdBy: adminUserId,
        },
      });
      createdBookingIds.push(booking.id);
      const checkedIn = await request(app)
        .post(`/api/v1/bookings/${Number(booking.id)}/check-in`)
        .set('Cookie', adminCookie)
        .send({ roomId: type.roomId });
      const stayId = Number(checkedIn.body.data.id as number);
      createdStayIds.push(BigInt(stayId));

      const forged = await request(app)
        .post(`/api/v1/stays/${stayId}/checkout`)
        .set('Cookie', adminCookie)
        .send({ paymentMethod: 'CASH', totalAmount: 0.01 });
      expect(forged.status).toBe(422);

      // 校验失败不产生账单、不改状态
      expect(await prisma.order.count({ where: { stayId: BigInt(stayId) } })).toBe(0);
      const stay = await prisma.stay.findUniqueOrThrow({ where: { id: BigInt(stayId) } });
      expect(stay.status).toBe('CHECKED_IN');
    });
  });

  describe('防重复账单与事务回滚', () => {
    it('同一入住已有账单时退房失败 → 409，且不产生第二张账单、状态整体回滚', async () => {
      const type = await seedRoomType('DUP', 100);
      const guest = await seedGuest('DUP');
      const booking = await prisma.booking.create({
        data: {
          guestId: guest.id,
          roomTypeId: type.id,
          checkInDate: new Date(`${d(0)}T00:00:00.000Z`),
          checkOutDate: new Date(`${d(1)}T00:00:00.000Z`),
          pricePerNight: 100,
          totalPrice: 100,
          createdBy: adminUserId,
        },
      });
      createdBookingIds.push(booking.id);
      const checkedIn = await request(app)
        .post(`/api/v1/bookings/${Number(booking.id)}/check-in`)
        .set('Cookie', adminCookie)
        .send({ roomId: type.roomId });
      expect(checkedIn.status).toBe(200);
      const stayId = Number(checkedIn.body.data.id as number);
      createdStayIds.push(BigInt(stayId));

      // 预置一张已存在的账单（模拟并发/异常路径下的重复结算竞态）
      await prisma.order.create({
        data: {
          stayId: BigInt(stayId),
          totalAmount: 100,
          depositAmount: 0,
          depositApplied: 0,
          paidAmount: 100,
          paymentMethod: 'CASH',
          status: 'PAID',
          createdBy: BigInt(adminUserId),
        },
      });

      const res = await request(app)
        .post(`/api/v1/stays/${stayId}/checkout`)
        .set('Cookie', adminCookie)
        .send({ paymentMethod: 'CASH' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'STAY_STATUS_INVALID',
        message: '该入住记录已退房，不可重复结算',
      });

      // 事务整体回滚：账单唯一、入住仍在住、房态未变、占用未释放
      const [orderCount, stay, room, occupancyCount] = await Promise.all([
        prisma.order.count({ where: { stayId: BigInt(stayId) } }),
        prisma.stay.findUniqueOrThrow({ where: { id: BigInt(stayId) } }),
        prisma.room.findUniqueOrThrow({ where: { id: BigInt(type.roomId) } }),
        prisma.roomOccupancy.count({ where: { stayId: BigInt(stayId) } }),
      ]);
      expect(orderCount).toBe(1);
      expect(stay.status).toBe('CHECKED_IN');
      expect(stay.actualCheckOutAt).toBeNull();
      expect(room.status).toBe('OCCUPIED');
      expect(occupancyCount).toBeGreaterThan(0);
    });
  });
});
