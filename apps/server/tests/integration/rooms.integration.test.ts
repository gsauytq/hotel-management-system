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
import { createRoomTypesRepository } from '../../src/modules/room-types/room-types.repository.js';
import { createRoomTypesService } from '../../src/modules/room-types/room-types.service.js';
import { createRoomsRepository } from '../../src/modules/rooms/rooms.repository.js';
import { createRoomsService } from '../../src/modules/rooms/rooms.service.js';
import { createAuditLogger } from '../../src/utils/audit.js';
import { createLogger } from '../../src/utils/logger.js';
import { hashPassword } from '../../src/utils/password.js';
import { createFakeBookingsService } from '../support/fake-bookings.js';
import { createFakeGuestsService } from '../support/fake-guests.js';
import { createFakeOrdersService } from '../support/fake-orders.js';
import { createFakeUsersService } from '../support/fake-users.js';
import { createFakeStaysService } from '../support/fake-stays.js';

/**
 * 集成测试：Supertest + 真实 MySQL（开发计划 T-07）。
 * 默认不运行；执行方式：HMS_INTEGRATION=1 pnpm --filter @hms/server test
 * 测试数据以随机后缀命名并在结束后清理，不影响其他数据。
 */
const runIntegration =
  process.env['HMS_INTEGRATION'] === '1' && Boolean(process.env['DATABASE_URL']);

const suite = runIntegration ? describe : describe.skip;

suite('房型与客房管理集成测试（Supertest + 真实 MySQL）', () => {
  const password = 'Itest#Pass123';
  const runId = Date.now().toString(36).toUpperCase();
  const suffix = `${runId}${Math.floor(Math.random() * 46655)
    .toString(36)
    .toUpperCase()}`.replace(/[^A-Z0-9]/g, '');
  const usernamePrefix = `itest_rm_${runId.toLowerCase()}`;
  const typeCodePrefix = `IT${suffix}`;
  const roomNumberPrefix = `IT${suffix}`;

  const createdRoomTypeIds: bigint[] = [];
  const createdRoomIds: bigint[] = [];
  const createdStayIds: bigint[] = [];
  const createdGuestIds: bigint[] = [];

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
    const roomsService = createRoomsService({
      repository: createRoomsRepository(prisma),
      roomTypesService,
    });

    app = createApp({
      config,
      logger: silent,
      checkDatabase: () => createDatabasePing(prisma)(),
      authService,
      roomTypesService,
      roomsService,
      bookingsService: createFakeBookingsService(),
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
    // 清理顺序：stays（occupancy 级联）→ bookings → rooms → room_types → guests → users
    await prisma.stay.deleteMany({ where: { id: { in: createdStayIds } } });
    await prisma.booking.deleteMany({ where: { roomTypeId: { in: createdRoomTypeIds } } });
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
        displayName: '房型测试用户',
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
    overrides: { status?: 'ACTIVE' | 'ARCHIVED'; basePrice?: number } = {},
  ) {
    const roomType = await prisma.roomType.create({
      data: {
        code: `${typeCodePrefix}${tag}`,
        name: `测试房型${tag}`,
        basePrice: overrides.basePrice ?? 288,
        capacity: 2,
        status: overrides.status ?? 'ACTIVE',
      },
    });
    createdRoomTypeIds.push(roomType.id);
    return { id: Number(roomType.id), code: roomType.code };
  }

  async function seedRoom(roomTypeId: number, tag: string, status: RoomStatus = 'VACANT_DIRTY') {
    const room = await prisma.room.create({
      data: { roomNumber: `${roomNumberPrefix}${tag}`, roomTypeId, status },
    });
    createdRoomIds.push(room.id);
    return { id: Number(room.id), roomNumber: room.roomNumber };
  }

  async function seedGuest() {
    const guest = await prisma.guest.create({
      data: {
        name: '集成测试客人',
        phone: '13800138000',
        idType: 'ID_CARD',
        idNumberHash: randomBytes(32).toString('hex'),
        idNumberCipher: Buffer.from('test-cipher'),
      },
    });
    createdGuestIds.push(guest.id);
    return { id: Number(guest.id) };
  }

  async function seedStay(params: {
    roomId: number;
    roomTypeId: number;
    guestId: number;
    status?: 'CHECKED_IN' | 'CHECKED_OUT';
    checkInAt?: Date;
    expectedCheckOutDate?: Date;
  }) {
    const stay = await prisma.stay.create({
      data: {
        guestId: params.guestId,
        roomId: params.roomId,
        roomTypeId: params.roomTypeId,
        pricePerNight: 288,
        checkInAt: params.checkInAt ?? new Date('2026-10-13T14:02:11.000Z'),
        expectedCheckOutDate: params.expectedCheckOutDate ?? new Date('2026-10-15T00:00:00.000Z'),
        status: params.status ?? 'CHECKED_IN',
        createdBy: adminUserId,
      },
    });
    createdStayIds.push(stay.id);
    return { id: Number(stay.id) };
  }

  async function seedBooking(params: { roomTypeId: number; guestId: number }) {
    await prisma.booking.create({
      data: {
        guestId: params.guestId,
        roomTypeId: params.roomTypeId,
        checkInDate: new Date('2026-11-01T00:00:00.000Z'),
        checkOutDate: new Date('2026-11-03T00:00:00.000Z'),
        pricePerNight: 288,
        totalPrice: 576,
        status: 'CONFIRMED',
        createdBy: adminUserId,
      },
    });
  }

  describe('认证与权限（默认拒绝）', () => {
    it('未登录访问房型/客房接口 → 401 SESSION_EXPIRED', async () => {
      for (const path of [
        '/api/v1/room-types',
        '/api/v1/rooms',
        '/api/v1/rooms/available?roomTypeId=1&checkInDate=2026-11-01&checkOutDate=2026-11-02',
      ]) {
        const res = await request(app).get(path);
        expect(res.status, path).toBe(401);
        expect(res.body.error.code).toBe('SESSION_EXPIRED');
      }
    });

    it('RECEPTIONIST 调用管理端点 → 403 FORBIDDEN', async () => {
      const createType = await request(app)
        .post('/api/v1/room-types')
        .set('Cookie', receptionistCookie)
        .send({ code: `${typeCodePrefix}X`, name: 'X', basePrice: 1, capacity: 1 });
      expect(createType.status).toBe(403);
      expect(createType.body.error.code).toBe('FORBIDDEN');

      const createRoom = await request(app)
        .post('/api/v1/rooms')
        .set('Cookie', receptionistCookie)
        .send({ roomNumber: `${roomNumberPrefix}X`, roomTypeId: 1 });
      expect(createRoom.status).toBe(403);

      const patchType = await request(app)
        .patch('/api/v1/room-types/1')
        .set('Cookie', receptionistCookie)
        .send({ basePrice: 100 });
      expect(patchType.status).toBe(403);

      const archive = await request(app)
        .post('/api/v1/room-types/1/archive')
        .set('Cookie', receptionistCookie);
      expect(archive.status).toBe(403);
    });
  });

  describe('R1–R4 房型管理', () => {
    it('R2 创建：200 返回 DTO；重复 code → 409；非法价格/编码/未知字段 → 422', async () => {
      const code = `${typeCodePrefix}RT`;
      const created = await request(app)
        .post('/api/v1/room-types')
        .set('Cookie', adminCookie)
        .send({ code, name: '标准大床房', basePrice: 288, capacity: 2, description: '20㎡' });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      expect(created.body.data).toMatchObject({
        code,
        name: '标准大床房',
        basePrice: 288,
        capacity: 2,
        description: '20㎡',
        status: 'ACTIVE',
        roomCount: 0,
      });
      createdRoomTypeIds.push(BigInt(created.body.data.id as number));

      const duplicate = await request(app)
        .post('/api/v1/room-types')
        .set('Cookie', adminCookie)
        .send({ code, name: '重复', basePrice: 288, capacity: 2 });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('ROOM_TYPE_CODE_EXISTS');

      const negative = await request(app)
        .post('/api/v1/room-types')
        .set('Cookie', adminCookie)
        .send({ code: `${typeCodePrefix}NG`, name: '负数', basePrice: -1, capacity: 2 });
      expect(negative.status).toBe(422);
      expect(negative.body.error.code).toBe('VALIDATION_FAILED');

      const lowercase = await request(app)
        .post('/api/v1/room-types')
        .set('Cookie', adminCookie)
        .send({ code: 'dlx', name: '小写', basePrice: 288, capacity: 2 });
      expect(lowercase.status).toBe(422);

      const unknownField = await request(app)
        .post('/api/v1/room-types')
        .set('Cookie', adminCookie)
        .send({ code: `${typeCodePrefix}UF`, name: '未知', basePrice: 288, capacity: 2, foo: 1 });
      expect(unknownField.status).toBe(422);

      const badCapacity = await request(app)
        .post('/api/v1/room-types')
        .set('Cookie', adminCookie)
        .send({ code: `${typeCodePrefix}CP`, name: '容量', basePrice: 288, capacity: 21 });
      expect(badCapacity.status).toBe(422);
    });

    it('R1 列表：含 roomCount（未停用房）与 status 过滤；详情端点可用/404', async () => {
      const active = await seedRoomType('L');
      await seedRoom(active.id, 'L1', 'VACANT_DIRTY');
      await seedRoom(active.id, 'L2', 'DISABLED');
      const archived = await seedRoomType('AR', { status: 'ARCHIVED' });

      const list = await request(app)
        .get('/api/v1/room-types?status=ACTIVE')
        .set('Cookie', receptionistCookie);
      expect(list.status).toBe(200);
      const activeItem = (list.body.data.items as Array<{ id: number; roomCount: number }>).find(
        (item) => item.id === active.id,
      );
      expect(activeItem?.roomCount).toBe(1);
      expect(
        (list.body.data.items as Array<{ id: number }>).some((item) => item.id === archived.id),
      ).toBe(false);

      const archivedList = await request(app)
        .get('/api/v1/room-types?status=ARCHIVED')
        .set('Cookie', receptionistCookie);
      expect(
        (archivedList.body.data.items as Array<{ id: number }>).some(
          (item) => item.id === archived.id,
        ),
      ).toBe(true);

      const detail = await request(app)
        .get(`/api/v1/room-types/${active.id}`)
        .set('Cookie', receptionistCookie);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({ id: active.id, roomCount: 1 });

      const missing = await request(app)
        .get('/api/v1/room-types/999999')
        .set('Cookie', receptionistCookie);
      expect(missing.status).toBe(404);

      const badId = await request(app)
        .get('/api/v1/room-types/abc')
        .set('Cookie', receptionistCookie);
      expect(badId.status).toBe(422);
    });

    it('R3 修改：部分字段生效；不存在 404；code 等未知字段 422', async () => {
      const type = await seedRoomType('U');
      const updated = await request(app)
        .patch(`/api/v1/room-types/${type.id}`)
        .set('Cookie', adminCookie)
        .send({ name: '翻新房型', basePrice: 428 });
      expect(updated.status).toBe(200);
      expect(updated.body.data).toMatchObject({
        name: '翻新房型',
        basePrice: 428,
        code: type.code,
      });

      const forbiddenField = await request(app)
        .patch(`/api/v1/room-types/${type.id}`)
        .set('Cookie', adminCookie)
        .send({ code: 'NEWCODE' });
      expect(forbiddenField.status).toBe(422);

      const missing = await request(app)
        .patch('/api/v1/room-types/999999')
        .set('Cookie', adminCookie)
        .send({ basePrice: 100 });
      expect(missing.status).toBe(404);
    });

    it('R4 归档：被 CONFIRMED 预订或在住引用 → 409；干净房型成功归档且不可重复归档', async () => {
      const withBooking = await seedRoomType('B');
      const guest1 = await seedGuest();
      await seedBooking({ roomTypeId: withBooking.id, guestId: guest1.id });
      const blockedByBooking = await request(app)
        .post(`/api/v1/room-types/${withBooking.id}/archive`)
        .set('Cookie', adminCookie);
      expect(blockedByBooking.status).toBe(409);
      expect(blockedByBooking.body.error).toMatchObject({
        code: 'ROOM_TYPE_ARCHIVED',
        message: '该房型存在未完结预订或在住，不可归档',
      });

      const withStay = await seedRoomType('S');
      const room = await seedRoom(withStay.id, 'S1', 'OCCUPIED');
      const guest2 = await seedGuest();
      await seedStay({ roomId: room.id, roomTypeId: withStay.id, guestId: guest2.id });
      const blockedByStay = await request(app)
        .post(`/api/v1/room-types/${withStay.id}/archive`)
        .set('Cookie', adminCookie);
      expect(blockedByStay.status).toBe(409);

      const clean = await seedRoomType('C');
      await seedRoom(clean.id, 'C1');
      const archived = await request(app)
        .post(`/api/v1/room-types/${clean.id}/archive`)
        .set('Cookie', adminCookie);
      expect(archived.status).toBe(200);
      expect(archived.body.data).toMatchObject({ status: 'ARCHIVED', roomCount: 1 });

      const again = await request(app)
        .post(`/api/v1/room-types/${clean.id}/archive`)
        .set('Cookie', adminCookie);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ROOM_TYPE_ARCHIVED');

      const missing = await request(app)
        .post('/api/v1/room-types/999999/archive')
        .set('Cookie', adminCookie);
      expect(missing.status).toBe(404);
    });
  });

  describe('M1–M5 客房管理', () => {
    it('M3 创建：默认 VACANT_DIRTY；重复房号 409；房型不存在 404；归档房型 409', async () => {
      const type = await seedRoomType('R');
      const roomNumber = `${roomNumberPrefix}R1`;
      const created = await request(app)
        .post('/api/v1/rooms')
        .set('Cookie', adminCookie)
        .send({ roomNumber, roomTypeId: type.id, note: '无窗房' });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      expect(created.body.data).toMatchObject({
        roomNumber,
        roomTypeId: type.id,
        roomTypeName: '测试房型R',
        status: 'VACANT_DIRTY',
        note: '无窗房',
        currentStay: null,
      });
      createdRoomIds.push(BigInt(created.body.data.id as number));

      const duplicate = await request(app)
        .post('/api/v1/rooms')
        .set('Cookie', adminCookie)
        .send({ roomNumber, roomTypeId: type.id });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('ROOM_NUMBER_EXISTS');

      const missingType = await request(app)
        .post('/api/v1/rooms')
        .set('Cookie', adminCookie)
        .send({ roomNumber: `${roomNumberPrefix}R2`, roomTypeId: 999999 });
      expect(missingType.status).toBe(404);

      const archivedType = await seedRoomType('RX', { status: 'ARCHIVED' });
      const intoArchived = await request(app)
        .post('/api/v1/rooms')
        .set('Cookie', adminCookie)
        .send({ roomNumber: `${roomNumberPrefix}R3`, roomTypeId: archivedType.id });
      expect(intoArchived.status).toBe(409);
      expect(intoArchived.body.error.code).toBe('ROOM_TYPE_ARCHIVED');
    });

    it('M1 列表：分页/筛选/前缀查询/排序白名单；非法分页与排序注入 422', async () => {
      const type = await seedRoomType('M');
      await seedRoom(type.id, 'M1A', 'VACANT_DIRTY');
      await seedRoom(type.id, 'M1B', 'VACANT_CLEAN');
      await seedRoom(type.id, 'M1C', 'DISABLED');

      const page1 = await request(app)
        .get(`/api/v1/rooms?roomTypeId=${type.id}&page=1&pageSize=2&sort=roomNumber:asc`)
        .set('Cookie', receptionistCookie);
      expect(page1.status).toBe(200);
      expect(page1.body.data.pagination).toEqual({
        page: 1,
        pageSize: 2,
        total: 3,
        totalPages: 2,
      });
      expect((page1.body.data.items as Array<{ roomNumber: string }>)[0]?.roomNumber).toBe(
        `${roomNumberPrefix}M1A`,
      );

      const page2 = await request(app)
        .get(`/api/v1/rooms?roomTypeId=${type.id}&page=2&pageSize=2`)
        .set('Cookie', receptionistCookie);
      expect((page2.body.data.items as unknown[]).length).toBe(1);

      const statusFilter = await request(app)
        .get(`/api/v1/rooms?roomTypeId=${type.id}&status=VACANT_CLEAN`)
        .set('Cookie', receptionistCookie);
      expect(statusFilter.body.data.pagination.total).toBe(1);

      const prefixFilter = await request(app)
        .get(`/api/v1/rooms?roomNumber=${roomNumberPrefix}M1A`)
        .set('Cookie', receptionistCookie);
      expect(prefixFilter.body.data.pagination.total).toBe(1);
      expect((prefixFilter.body.data.items as Array<{ roomNumber: string }>)[0]?.roomNumber).toBe(
        `${roomNumberPrefix}M1A`,
      );

      const sorted = await request(app)
        .get(`/api/v1/rooms?roomTypeId=${type.id}&sort=status:desc`)
        .set('Cookie', receptionistCookie);
      expect((sorted.body.data.items as Array<{ status: string }>)[0]?.status).toBe('DISABLED');

      for (const query of [
        'page=0',
        'pageSize=101',
        'sort=id:asc',
        'sort=roomNumber:up',
        'sort=roomNumber;DROP+TABLE:asc',
      ]) {
        const res = await request(app)
          .get(`/api/v1/rooms?roomTypeId=${type.id}&${query}`)
          .set('Cookie', receptionistCookie);
        expect(res.status, query).toBe(422);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('M1 OCCUPIED 含在住摘要；GET /rooms/{id} 返回同一对象', async () => {
      const type = await seedRoomType('O');
      const room = await seedRoom(type.id, 'O1', 'OCCUPIED');
      const guest = await seedGuest();
      const stay = await seedStay({
        roomId: room.id,
        roomTypeId: type.id,
        guestId: guest.id,
        checkInAt: new Date('2026-10-13T14:02:11.000Z'),
        expectedCheckOutDate: new Date('2026-10-15T00:00:00.000Z'),
      });

      const list = await request(app)
        .get(`/api/v1/rooms?roomNumber=${room.roomNumber}`)
        .set('Cookie', receptionistCookie);
      const item = (list.body.data.items as Array<Record<string, unknown>>)[0];
      expect(item?.['currentStay']).toEqual({
        stayId: stay.id,
        guestName: '集成测试客人',
        checkInAt: '2026-10-13T14:02:11.000Z',
        expectedCheckOutDate: '2026-10-15',
      });

      const detail = await request(app)
        .get(`/api/v1/rooms/${room.id}`)
        .set('Cookie', receptionistCookie);
      expect(detail.status).toBe(200);
      expect(detail.body.data.currentStay).toEqual(item?.['currentStay']);

      const missing = await request(app)
        .get('/api/v1/rooms/999999')
        .set('Cookie', receptionistCookie);
      expect(missing.status).toBe(404);
    });

    it('M4 修改：换房型/房号生效；重复房号 409；OCCUPIED 仅可改 note', async () => {
      const type1 = await seedRoomType('P1');
      const type2 = await seedRoomType('P2');
      const room = await seedRoom(type1.id, 'P1', 'VACANT_DIRTY');

      const changed = await request(app)
        .patch(`/api/v1/rooms/${room.id}`)
        .set('Cookie', adminCookie)
        .send({ roomTypeId: type2.id, roomNumber: `${roomNumberPrefix}P1N`, note: '已装新风' });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect(changed.body.data).toMatchObject({
        roomTypeId: type2.id,
        roomTypeName: '测试房型P2',
        roomNumber: `${roomNumberPrefix}P1N`,
        note: '已装新风',
      });

      const other = await seedRoom(type1.id, 'P1B');
      const duplicate = await request(app)
        .patch(`/api/v1/rooms/${other.id}`)
        .set('Cookie', adminCookie)
        .send({ roomNumber: `${roomNumberPrefix}P1N` });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe('ROOM_NUMBER_EXISTS');

      const occupied = await seedRoom(type1.id, 'P1C', 'OCCUPIED');
      const changeTypeOnOccupied = await request(app)
        .patch(`/api/v1/rooms/${occupied.id}`)
        .set('Cookie', adminCookie)
        .send({ roomTypeId: type2.id });
      expect(changeTypeOnOccupied.status).toBe(409);
      expect(changeTypeOnOccupied.body.error).toMatchObject({
        code: 'ROOM_STATUS_INVALID',
        message: '在住房间不可修改房型或房号',
      });

      const noteOnly = await request(app)
        .patch(`/api/v1/rooms/${occupied.id}`)
        .set('Cookie', adminCookie)
        .send({ note: '在住备注' });
      expect(noteOnly.status).toBe(200);
      expect(noteOnly.body.data.note).toBe('在住备注');

      const unknownField = await request(app)
        .patch(`/api/v1/rooms/${room.id}`)
        .set('Cookie', adminCookie)
        .send({ status: 'VACANT_CLEAN' });
      expect(unknownField.status).toBe(422);
    });

    it('M5 房态：清洁完成前台可做；维修/停用仅 ADMIN；OCCUPIED 不可人工设置', async () => {
      const type = await seedRoomType('T');
      const dirty = await seedRoom(type.id, 'T1', 'VACANT_DIRTY');
      const clean = await seedRoom(type.id, 'T2', 'VACANT_CLEAN');
      const occupied = await seedRoom(type.id, 'T3', 'OCCUPIED');
      const disabled = await seedRoom(type.id, 'T4', 'DISABLED');

      const cleaned = await request(app)
        .patch(`/api/v1/rooms/${dirty.id}/status`)
        .set('Cookie', receptionistCookie)
        .send({ status: 'VACANT_CLEAN' });
      expect(cleaned.status).toBe(200);
      expect(cleaned.body.data.status).toBe('VACANT_CLEAN');

      const receptionistMaintenance = await request(app)
        .patch(`/api/v1/rooms/${clean.id}/status`)
        .set('Cookie', receptionistCookie)
        .send({ status: 'MAINTENANCE' });
      expect(receptionistMaintenance.status).toBe(403);
      expect(receptionistMaintenance.body.error.code).toBe('FORBIDDEN');

      const adminMaintenance = await request(app)
        .patch(`/api/v1/rooms/${clean.id}/status`)
        .set('Cookie', adminCookie)
        .send({ status: 'MAINTENANCE' });
      expect(adminMaintenance.status).toBe(200);

      const adminDisable = await request(app)
        .patch(`/api/v1/rooms/${clean.id}/status`)
        .set('Cookie', adminCookie)
        .send({ status: 'DISABLED' });
      expect(adminDisable.status).toBe(200);

      const receptionistReenable = await request(app)
        .patch(`/api/v1/rooms/${clean.id}/status`)
        .set('Cookie', receptionistCookie)
        .send({ status: 'VACANT_DIRTY' });
      expect(receptionistReenable.status).toBe(403);

      const adminReenable = await request(app)
        .patch(`/api/v1/rooms/${clean.id}/status`)
        .set('Cookie', adminCookie)
        .send({ status: 'VACANT_DIRTY' });
      expect(adminReenable.status).toBe(200);

      const manualOccupied = await request(app)
        .patch(`/api/v1/rooms/${disabled.id}/status`)
        .set('Cookie', adminCookie)
        .send({ status: 'OCCUPIED' });
      expect(manualOccupied.status).toBe(409);
      expect(manualOccupied.body.error.code).toBe('ROOM_STATUS_INVALID');

      const fromOccupied = await request(app)
        .patch(`/api/v1/rooms/${occupied.id}/status`)
        .set('Cookie', adminCookie)
        .send({ status: 'VACANT_DIRTY' });
      expect(fromOccupied.status).toBe(409);
      expect(fromOccupied.body.error.message).toContain('OCCUPIED');

      const invalidStatus = await request(app)
        .patch(`/api/v1/rooms/${dirty.id}/status`)
        .set('Cookie', adminCookie)
        .send({ status: 'CLEANING' });
      expect(invalidStatus.status).toBe(422);

      const missing = await request(app)
        .patch('/api/v1/rooms/999999/status')
        .set('Cookie', adminCookie)
        .send({ status: 'VACANT_CLEAN' });
      expect(missing.status).toBe(404);
    });

    it('M2 可分配房间：排除停用/维修；区间内占用排除、区间外包含；非法参数 422；无效房型 404', async () => {
      const type = await seedRoomType('A');
      const freeClean = await seedRoom(type.id, 'A1', 'VACANT_CLEAN');
      const freeDirty = await seedRoom(type.id, 'A2', 'VACANT_DIRTY');
      await seedRoom(type.id, 'A3', 'MAINTENANCE');
      await seedRoom(type.id, 'A4', 'DISABLED');
      const occupiedRoom = await seedRoom(type.id, 'A5', 'OCCUPIED');
      const guest = await seedGuest();
      const stay = await seedStay({
        roomId: occupiedRoom.id,
        roomTypeId: type.id,
        guestId: guest.id,
        checkInAt: new Date('2026-11-10T06:00:00.000Z'),
        expectedCheckOutDate: new Date('2026-11-13T00:00:00.000Z'),
      });
      // A6 虽为 VACANT_CLEAN，但区间内存在占用行 → 必须被排除（占用判定以 room_occupancy 为准）
      const occupiedCleanRoom = await seedRoom(type.id, 'A6', 'VACANT_CLEAN');
      const guest2 = await seedGuest();
      const stay2 = await seedStay({
        roomId: occupiedCleanRoom.id,
        roomTypeId: type.id,
        guestId: guest2.id,
        checkInAt: new Date('2026-11-10T06:00:00.000Z'),
        expectedCheckOutDate: new Date('2026-11-13T00:00:00.000Z'),
      });
      await prisma.roomOccupancy.createMany({
        data: ['2026-11-10', '2026-11-11', '2026-11-12'].flatMap((date) =>
          [stay.id, stay2.id].map((stayId) => ({
            stayId: BigInt(stayId),
            roomId: stayId === stay.id ? BigInt(occupiedRoom.id) : BigInt(occupiedCleanRoom.id),
            date: new Date(`${date}T00:00:00.000Z`),
          })),
        ),
      });

      const inRange = await request(app)
        .get(
          `/api/v1/rooms/available?roomTypeId=${type.id}&checkInDate=2026-11-10&checkOutDate=2026-11-12`,
        )
        .set('Cookie', receptionistCookie);
      expect(inRange.status, JSON.stringify(inRange.body)).toBe(200);
      const inRangeIds = (inRange.body.data.items as Array<{ id: number }>).map((item) => item.id);
      expect([...inRangeIds].sort((left, right) => left - right)).toEqual(
        [freeClean.id, freeDirty.id].sort((left, right) => left - right),
      );
      expect(inRangeIds).not.toContain(occupiedCleanRoom.id);

      const outOfRange = await request(app)
        .get(
          `/api/v1/rooms/available?roomTypeId=${type.id}&checkInDate=2026-11-20&checkOutDate=2026-11-22`,
        )
        .set('Cookie', receptionistCookie);
      const outOfRangeIds = (outOfRange.body.data.items as Array<{ id: number }>).map(
        (item) => item.id,
      );
      expect(outOfRangeIds).toContain(occupiedCleanRoom.id);
      expect(outOfRangeIds).not.toContain(occupiedRoom.id); // OCCUPIED 状态不参与分配

      const invalidDates = await request(app)
        .get(
          `/api/v1/rooms/available?roomTypeId=${type.id}&checkInDate=2026-11-12&checkOutDate=2026-11-12`,
        )
        .set('Cookie', receptionistCookie);
      expect(invalidDates.status).toBe(422);

      const missingType = await request(app)
        .get(
          '/api/v1/rooms/available?roomTypeId=999999&checkInDate=2026-11-10&checkOutDate=2026-11-12',
        )
        .set('Cookie', receptionistCookie);
      expect(missingType.status).toBe(404);

      const archivedType = await seedRoomType('AX', { status: 'ARCHIVED' });
      const archivedResult = await request(app)
        .get(
          `/api/v1/rooms/available?roomTypeId=${archivedType.id}&checkInDate=2026-11-10&checkOutDate=2026-11-12`,
        )
        .set('Cookie', receptionistCookie);
      expect(archivedResult.status).toBe(200);
      expect(archivedResult.body.data.items).toEqual([]);
    });
  });
});
