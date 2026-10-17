import 'dotenv/config';

import { randomBytes } from 'node:crypto';

import type { Express } from 'express';
import request, { type Response as SupertestResponse } from 'supertest';
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
 * 审查 A-1 回归：房量必须按「已确认预订 + 在住（CHECKED_IN）」合并视角计算
 * （database-design §2.4/§6.1，FR-BK-001）。
 *
 * 修复前复现：
 * - 变体①：1 房房型先有未来 CONFIRMED 预订，walk-in 以覆盖该区间的入住成功 → 预订不可履行；
 * - 变体②（纯顺序）：预订入住后状态翻 CHECKED_IN 退出计数，同区间新预订仍可售 → 超售。
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

suite('审查 A-1：合并视角房量（Supertest + 真实 MySQL）', () => {
  const password = 'Itest#Pass123';
  const runId = Date.now().toString(36).toUpperCase();
  const suffix = `${runId}${Math.floor(Math.random() * 46655)
    .toString(36)
    .toUpperCase()}`.replace(/[^A-Z0-9]/g, '');
  const usernamePrefix = `itest_mc_${runId.toLowerCase()}`;
  const codePrefix = `MC${suffix}`;
  const roomPrefix = `MC${suffix}`;

  const createdBookingIds: bigint[] = [];
  const createdStayIds: bigint[] = [];
  const createdGuestIds: bigint[] = [];
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
        displayName: '合并房量测试管理员',
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
    // 清理按“归属前缀/外键关系”兜底：即使某用例在断言失败前产生了未被 track 的数据
    // （例如本应 409 却返回 200 的预订），也不会因 FK RESTRICT 中断清理而污染后续测试。
    const stays = await prisma.stay.findMany({
      where: {
        OR: [
          { roomTypeId: { in: createdRoomTypeIds } },
          { guestId: { in: createdGuestIds } },
          { id: { in: createdStayIds } },
        ],
      },
      select: { id: true },
    });
    const stayIds = stays.map((stay) => stay.id);
    await prisma.order.deleteMany({ where: { stayId: { in: stayIds } } });
    await prisma.stay.deleteMany({ where: { id: { in: stayIds } } });
    await prisma.booking.deleteMany({
      where: {
        OR: [
          { roomTypeId: { in: createdRoomTypeIds } },
          { guestId: { in: createdGuestIds } },
          { id: { in: createdBookingIds } },
        ],
      },
    });
    await prisma.room.deleteMany({ where: { roomTypeId: { in: createdRoomTypeIds } } });
    await prisma.roomType.deleteMany({ where: { id: { in: createdRoomTypeIds } } });
    await prisma.guest.deleteMany({ where: { id: { in: createdGuestIds } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: usernamePrefix } } });
    await prisma.$disconnect();
  });

  async function seedRoomType(tag: string, rooms: number) {
    const roomType = await prisma.roomType.create({
      data: {
        code: `${codePrefix}${tag}`,
        name: `合并房量测试房型${tag}`,
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
      roomIds.push(Number(room.id));
    }
    return { id: Number(roomType.id), roomIds };
  }

  async function seedGuest(tag: string) {
    const guest = await prisma.guest.create({
      data: {
        name: `合并房量客人${tag}${suffix}`,
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

  function walkIn(guestId: number, roomId: number, checkOutOffset: number) {
    return request(app)
      .post('/api/v1/stays')
      .set('Cookie', adminCookie)
      .send({
        guestId,
        roomId,
        pricePerNight: 300,
        expectedCheckOutDate: d(checkOutOffset),
        depositAmount: 0,
      });
  }

  function checkIn(bookingId: number, roomId: number) {
    return request(app)
      .post(`/api/v1/bookings/${bookingId}/check-in`)
      .set('Cookie', adminCookie)
      .send({ roomId, depositAmount: 0 });
  }

  function trackBooking(res: SupertestResponse): number {
    const id = res.body.data.id as number;
    createdBookingIds.push(BigInt(id));
    return id;
  }

  function trackStay(res: SupertestResponse): number {
    const id = res.body.data.id as number;
    createdStayIds.push(BigInt(id));
    return id;
  }

  it('变体②（纯顺序）：预订入住后（CHECKED_IN）同区间不得再售', async () => {
    const type = await seedRoomType('A', 1);
    const guestA = await seedGuest('AA');
    const guestB = await seedGuest('AB');

    const a = await createBooking(guestA.id, type.id, 0, 5);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    trackBooking(a);

    const checkedIn = await checkIn(a.body.data.id as number, type.roomIds[0]!);
    expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(200);
    trackStay(checkedIn);
    expect(checkedIn.body.data.status).toBe('CHECKED_IN');

    // 修复前：计数只含 CONFIRMED，A 已退出计数 → B 被错误接受（超售）
    const b = await createBooking(guestB.id, type.id, 2, 4);
    expect(b.status, JSON.stringify(b.body)).toBe(409);
    expect(b.body.error.code).toBe('ROOM_TYPE_SOLD_OUT');

    expect(
      await prisma.booking.count({
        where: { roomTypeId: BigInt(type.id), status: 'CONFIRMED' },
      }),
    ).toBe(0); // A 已 CHECKED_IN、B 被拒绝 → 该房型无 CONFIRMED 预订
    expect(
      await prisma.stay.count({ where: { roomTypeId: BigInt(type.id), status: 'CHECKED_IN' } }),
    ).toBe(1); // 仅在住的 A，被拒绝的 B 未产生任何入住
    expect(await prisma.booking.count({ where: { roomTypeId: BigInt(type.id) } })).toBe(1); // 全量预订数：仅 A
  });

  it('变体①：walk-in 不得挤占未来 CONFIRMED 预订的房量', async () => {
    const type = await seedRoomType('B', 1);
    const guestBooking = await seedGuest('BB');
    const guestWalkIn = await seedGuest('BW');

    const booking = await createBooking(guestBooking.id, type.id, 5, 7);
    expect(booking.status, JSON.stringify(booking.body)).toBe(200);
    trackBooking(booking);

    // 修复前：walk-in 仅校验房间状态/占用行，跨越预订区间仍成功（200）
    const walkInRes = await walkIn(guestWalkIn.id, type.roomIds[0]!, 8);
    expect(walkInRes.status, JSON.stringify(walkInRes.body)).toBe(409);
    expect(walkInRes.body.error.code).toBe('ROOM_TYPE_SOLD_OUT');

    expect(await prisma.stay.count({ where: { roomId: BigInt(type.roomIds[0]!) } })).toBe(0);
    const roomRow = await prisma.room.findUniqueOrThrow({
      where: { id: BigInt(type.roomIds[0]!) },
    });
    expect(roomRow.status).toBe('VACANT_DIRTY'); // 被拒绝的 walk-in 未改动房态
  });

  it('在住后新预订不得再售其在住区间', async () => {
    const type = await seedRoomType('C', 1);
    const guestWalkIn = await seedGuest('CW');
    const guestBooking = await seedGuest('CB');

    const walkInRes = await walkIn(guestWalkIn.id, type.roomIds[0]!, 5);
    expect(walkInRes.status, JSON.stringify(walkInRes.body)).toBe(200);
    trackStay(walkInRes);

    const booking = await createBooking(guestBooking.id, type.id, 2, 4);
    expect(booking.status, JSON.stringify(booking.body)).toBe(409);
    expect(booking.body.error.code).toBe('ROOM_TYPE_SOLD_OUT');

    expect(await prisma.booking.count({ where: { roomTypeId: BigInt(type.id) } })).toBe(0); // 被拒绝的预订未落库
    expect(
      await prisma.stay.count({ where: { roomTypeId: BigInt(type.id), status: 'CHECKED_IN' } }),
    ).toBe(1); // 仅在住的 walk-in
  });

  it('非重叠区间不受影响：预订离店后 walk-in 仍可入住', async () => {
    const type = await seedRoomType('D', 1);
    const guestBooking = await seedGuest('DB');
    const guestWalkIn = await seedGuest('DW');

    const booking = await createBooking(guestBooking.id, type.id, 5, 7);
    expect(booking.status, JSON.stringify(booking.body)).toBe(200);
    trackBooking(booking);

    // 入住区间 [today, d+3) 与预订 [d+5, d+7) 无重叠 → 允许
    const walkInRes = await walkIn(guestWalkIn.id, type.roomIds[0]!, 3);
    expect(walkInRes.status, JSON.stringify(walkInRes.body)).toBe(200);
    trackStay(walkInRes);
  });

  it('2 房房型容量边界：预订 + 在住 + 新预订 = 3 时拒绝新预订', async () => {
    const type = await seedRoomType('E', 2);
    const guestBooking1 = await seedGuest('EB1');
    const guestWalkIn = await seedGuest('EW');
    const guestBooking2 = await seedGuest('EB2');

    const booking1 = await createBooking(guestBooking1.id, type.id, 5, 7);
    expect(booking1.status, JSON.stringify(booking1.body)).toBe(200);
    trackBooking(booking1);

    // 1 CONFIRMED + 0 在住 + 1 = 2 ≤ 2 → 允许
    const walkInRes = await walkIn(guestWalkIn.id, type.roomIds[0]!, 8);
    expect(walkInRes.status, JSON.stringify(walkInRes.body)).toBe(200);
    trackStay(walkInRes);

    // 1 CONFIRMED + 1 在住 + 1 = 3 > 2 → 拒绝
    const booking2 = await createBooking(guestBooking2.id, type.id, 5, 7);
    expect(booking2.status, JSON.stringify(booking2.body)).toBe(409);
    expect(booking2.body.error.code).toBe('ROOM_TYPE_SOLD_OUT');

    expect(
      await prisma.booking.count({
        where: { roomTypeId: BigInt(type.id), status: 'CONFIRMED' },
      }),
    ).toBe(1); // 仅 booking1；被拒绝的 booking2 未落库
    expect(
      await prisma.stay.count({ where: { roomTypeId: BigInt(type.id), status: 'CHECKED_IN' } }),
    ).toBe(1);
  });

  it('区间边界（左闭右开）：walk-in 离店日 = 预订入住日允许；重叠 1 晚则拒绝', async () => {
    const type = await seedRoomType('G', 2);
    const guestBooking = await seedGuest('GB');
    const guestBoundary = await seedGuest('GW1');
    const guestOverlap = await seedGuest('GW2');

    const booking = await createBooking(guestBooking.id, type.id, 5, 7);
    expect(booking.status, JSON.stringify(booking.body)).toBe(200);
    trackBooking(booking);

    // [today, d+5) 与预订 [d+5, d+7) 相邻不相交 → 2 房：1 预订 + 1 入住 = 2 ≤ 2 允许
    const boundary = await walkIn(guestBoundary.id, type.roomIds[0]!, 5);
    expect(boundary.status, JSON.stringify(boundary.body)).toBe(200);
    trackStay(boundary);

    // [today, d+6) 与该预订重叠 1 晚 → 1 预订 + 1 在住 + 1 = 3 > 2，拒绝
    const overlap = await walkIn(guestOverlap.id, type.roomIds[1]!, 6);
    expect(overlap.status, JSON.stringify(overlap.body)).toBe(409);
    expect(overlap.body.error.code).toBe('ROOM_TYPE_SOLD_OUT');
    expect(await prisma.stay.count({ where: { roomId: BigInt(type.roomIds[1]!) } })).toBe(0);
  });

  it('区间边界（预订侧）：walk-in 离店日 = 新预订入住日允许；重叠 1 晚则拒绝', async () => {
    const type = await seedRoomType('H', 1);
    const guestWalkIn = await seedGuest('HW');
    const guestOverlap = await seedGuest('HO');
    const guestBoundary = await seedGuest('HB');

    // 在住 [today, d+5)
    const walkInRes = await walkIn(guestWalkIn.id, type.roomIds[0]!, 5);
    expect(walkInRes.status, JSON.stringify(walkInRes.body)).toBe(200);
    trackStay(walkInRes);

    // 预订 [d+4, d+7) 与在住重叠 1 晚 → 1 在住 + 1 = 2 > 1，拒绝
    const overlap = await createBooking(guestOverlap.id, type.id, 4, 7);
    expect(overlap.status, JSON.stringify(overlap.body)).toBe(409);
    expect(overlap.body.error.code).toBe('ROOM_TYPE_SOLD_OUT');
    expect(await prisma.booking.count({ where: { roomTypeId: BigInt(type.id) } })).toBe(0); // 被拒绝的预订未落库

    // 预订 [d+5, d+7) 与在住相邻不相交 → 允许
    const boundary = await createBooking(guestBoundary.id, type.id, 5, 7);
    expect(boundary.status, JSON.stringify(boundary.body)).toBe(200);
    trackBooking(boundary);
  });

  it('并发：walk-in 与新预订竞争最后 1 间可售房时串行化，仅一个成功', async () => {
    const type = await seedRoomType('F', 2);
    const guestBase = await seedGuest('FB');
    const guestWalkIn = await seedGuest('FW');
    const guestBooking = await seedGuest('FN');

    const base = await createBooking(guestBase.id, type.id, 5, 7);
    expect(base.status, JSON.stringify(base.body)).toBe(200);
    trackBooking(base);

    const [walkInRes, bookingRes] = await Promise.all([
      walkIn(guestWalkIn.id, type.roomIds[0]!, 8),
      createBooking(guestBooking.id, type.id, 5, 7),
    ]);

    const statuses = [walkInRes.status, bookingRes.status];
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    const rejected = walkInRes.status === 200 ? bookingRes : walkInRes;
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(409);
    expect(rejected.body.error.code).toBe('ROOM_TYPE_SOLD_OUT');

    if (walkInRes.status === 200) trackStay(walkInRes);
    if (bookingRes.status === 200) trackBooking(bookingRes);

    const confirmed = await prisma.booking.count({
      where: {
        roomTypeId: BigInt(type.id),
        status: 'CONFIRMED',
        checkInDate: { lt: new Date(`${d(7)}T00:00:00.000Z`) },
        checkOutDate: { gt: new Date(`${d(5)}T00:00:00.000Z`) },
      },
    });
    const inHouse = await prisma.stay.count({
      where: {
        roomTypeId: BigInt(type.id),
        status: 'CHECKED_IN',
        expectedCheckOutDate: { gt: new Date(`${d(5)}T00:00:00.000Z`) },
      },
    });
    expect(confirmed + inHouse).toBe(2);
  });
});
