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
import { createGuestsRepository } from '../../src/modules/guests/guests.repository.js';
import { createGuestsService } from '../../src/modules/guests/guests.service.js';
import { createAuditLogger } from '../../src/utils/audit.js';
import { createGuestCrypto } from '../../src/utils/crypto.js';
import { createLogger } from '../../src/utils/logger.js';
import { hashPassword } from '../../src/utils/password.js';
import { createFakeBookingsService } from '../support/fake-bookings.js';
import { createFakeOrdersService } from '../support/fake-orders.js';
import { createFakeRoomTypesService, createFakeRoomsService } from '../support/fake-rooms.js';
import { createFakeStaysService } from '../support/fake-stays.js';
import { createFakeUsersService } from '../support/fake-users.js';

const runIntegration =
  process.env['HMS_INTEGRATION'] === '1' && Boolean(process.env['DATABASE_URL']);

const suite = runIntegration ? describe : describe.skip;

suite('客人档案集成测试（Supertest + 真实 MySQL）', () => {
  const password = 'Itest#Pass123';
  const runId = Date.now().toString(36);
  const usernamePrefix = `itest_gs_${runId}`;

  const createdGuestIds: bigint[] = [];
  const createdBookingIds: bigint[] = [];
  const createdRoomTypeIds: bigint[] = [];

  let config: AppConfig;
  let prisma: PrismaClient;
  let app: Express;
  let adminUserId: number;
  let userCookie: string;
  let crypto: ReturnType<typeof createGuestCrypto>;

  beforeAll(async () => {
    config = loadEnv(process.env);
    prisma = createPrismaClient(config);
    const silent = createLogger({ nodeEnv: 'test', logLevel: 'silent' });
    const authService: AuthService = createAuthService({
      repository: createAuthRepository(prisma),
      audit: createAuditLogger(silent),
      sessionTtlHours: config.sessionTtlHours,
    });
    crypto = createGuestCrypto({
      hmacKeyBase64: config.guestIdHmacKey,
      cipherKeyBase64: config.guestIdCipherKey,
    });

    const user = await prisma.user.create({
      data: {
        username: `${usernamePrefix}_user`,
        passwordHash: await hashPassword(password),
        displayName: '客人测试前台',
        role: 'RECEPTIONIST',
      },
    });
    adminUserId = Number(user.id);

    app = createApp({
      config,
      logger: silent,
      checkDatabase: () => createDatabasePing(prisma)(),
      authService,
      roomTypesService: createFakeRoomTypesService(),
      roomsService: createFakeRoomsService(),
      bookingsService: createFakeBookingsService(),
      staysService: createFakeStaysService(),
      ordersService: createFakeOrdersService(),
      usersService: createFakeUsersService(),
      guestsService: createGuestsService({
        repository: createGuestsRepository(prisma),
        crypto,
      }),
    });

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    userCookie = (login.headers['set-cookie']?.[0] ?? '').split(';')[0] ?? '';
  });

  afterAll(async () => {
    await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
    await prisma.guest.deleteMany({ where: { id: { in: createdGuestIds } } });
    await prisma.roomType.deleteMany({ where: { id: { in: createdRoomTypeIds } } });
    await prisma.user.deleteMany({ where: { username: { startsWith: usernamePrefix } } });
    await prisma.$disconnect();
  });

  async function createGuest(body: Record<string, unknown>) {
    return request(app).post('/api/v1/guests').set('Cookie', userCookie).send(body);
  }

  describe('认证与权限（登录角色均可）', () => {
    it('未登录访问 G1–G4 → 401 SESSION_EXPIRED', async () => {
      const requests = [
        request(app).get('/api/v1/guests'),
        request(app).post('/api/v1/guests').send({}),
        request(app).get('/api/v1/guests/1'),
        request(app).patch('/api/v1/guests/1').send({}),
      ];
      for (const pending of requests) {
        const res = await pending;
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('SESSION_EXPIRED');
      }
    });
  });

  describe('G2 创建与加密存储', () => {
    it('创建成功返回掩码证件号；库中无明文（密文布局 iv12+tag16+密文，HMAC 64hex）', async () => {
      const idNumber = '110101199001011234';
      const res = await createGuest({
        name: '张三',
        phone: '13800138000',
        idType: 'ID_CARD',
        idNumber,
        remark: 'VIP 常客',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const guestId = Number(res.body.data.id as number);
      createdGuestIds.push(BigInt(guestId));
      expect(res.body.data).toMatchObject({
        id: guestId,
        name: '张三',
        phone: '13800138000',
        idType: 'ID_CARD',
        idNumberMasked: `1${'*'.repeat(16)}4`,
        remark: 'VIP 常客',
      });
      expect(JSON.stringify(res.body)).not.toContain(idNumber);
      expect(res.body.data).not.toHaveProperty('idNumber');

      const row = await prisma.guest.findUniqueOrThrow({ where: { id: BigInt(guestId) } });
      const cipher = Buffer.from(row.idNumberCipher);
      expect(cipher.includes(Buffer.from(idNumber))).toBe(false);
      expect(cipher.length).toBe(12 + 16 + Buffer.byteLength(idNumber));
      expect(row.idNumberHash).toBe(crypto.hashIdNumber(idNumber));
      expect(crypto.decryptIdNumber(row.idNumberCipher)).toBe(idNumber);
    });

    it('重复证件号 → 409 GUEST_EXISTS（含 existingGuestId）；不同证件类型可复用号码；非法输入 422', async () => {
      const idNumber = 'P1234567';
      const first = await createGuest({
        name: '李四',
        phone: '+8613800138000',
        idType: 'PASSPORT',
        idNumber,
      });
      expect(first.status).toBe(200);
      createdGuestIds.push(BigInt(first.body.data.id as number));

      const duplicate = await createGuest({
        name: '李四重复',
        phone: '13900139000',
        idType: 'PASSPORT',
        idNumber,
      });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error).toMatchObject({
        code: 'GUEST_EXISTS',
        message: '该证件号已有客人档案',
        details: [{ field: 'idNumber', message: `existingGuestId: ${first.body.data.id}` }],
      });
      expect(JSON.stringify(duplicate.body)).not.toContain(idNumber);

      const otherType = await createGuest({
        name: '李四护照',
        phone: '13900139000',
        idType: 'ID_CARD',
        idNumber,
      });
      expect(otherType.status).toBe(200);
      createdGuestIds.push(BigInt(otherType.body.data.id as number));

      for (const body of [
        { name: 'x', phone: '123', idType: 'ID_CARD', idNumber: 'ABCDE12345' },
        { name: '', phone: '13800138000', idType: 'ID_CARD', idNumber: 'ABCDE12345' },
        { name: 'x', phone: '13800138000', idType: 'DRIVER', idNumber: 'ABCDE12345' },
        { name: 'x', phone: '13800138000', idType: 'ID_CARD', idNumber: 'abc' },
        {
          name: 'x',
          phone: '13800138000',
          idType: 'ID_CARD',
          idNumber: 'ABCDE12345',
          status: 'ACTIVE',
        },
      ]) {
        const res = await createGuest(body);
        expect(res.status, JSON.stringify(body)).toBe(422);
      }
    });
  });

  describe('G1 列表与 G3 详情', () => {
    it('列表：keyword（姓名模糊/手机前缀）与 phone 前缀过滤、分页、排序白名单、证件恒掩码', async () => {
      const name = `关键字客人${runId}`;
      const created = await createGuest({
        name,
        phone: '13711112222',
        idType: 'ID_CARD',
        idNumber: `K${randomBytes(6).toString('hex').toUpperCase()}`,
      });
      expect(created.status).toBe(200);
      createdGuestIds.push(BigInt(created.body.data.id as number));

      const byName = await request(app)
        .get(`/api/v1/guests?keyword=${encodeURIComponent(name)}`)
        .set('Cookie', userCookie);
      expect(byName.status).toBe(200);
      expect(byName.body.data.pagination.total).toBe(1);
      expect(byName.body.data.items[0].name).toBe(name);
      expect(byName.body.data.items[0].idNumberMasked).toMatch(/^K\*+[0-9A-F]$/);

      const byPhone = await request(app)
        .get('/api/v1/guests?phone=137111')
        .set('Cookie', userCookie);
      expect(
        (byPhone.body.data.items as Array<{ phone: string }>).every((item) =>
          item.phone.startsWith('137111'),
        ),
      ).toBe(true);

      const byKeywordPhone = await request(app)
        .get('/api/v1/guests?keyword=1371111')
        .set('Cookie', userCookie);
      expect(
        (byKeywordPhone.body.data.items as Array<{ phone: string }>).every((item) =>
          item.phone.startsWith('1371111'),
        ),
      ).toBe(true);

      const sorted = await request(app)
        .get('/api/v1/guests?sort=name:asc&pageSize=100')
        .set('Cookie', userCookie);
      expect(sorted.status).toBe(200);

      for (const query of ['sort=id:asc', 'sort=name:up', 'page=0', 'pageSize=101']) {
        const res = await request(app).get(`/api/v1/guests?${query}`).set('Cookie', userCookie);
        expect(res.status, query).toBe(422);
      }
    });

    it('详情含最近预订摘要（日期 YYYY-MM-DD）；不存在 404；非法 id 422', async () => {
      const idNumber = `D${randomBytes(6).toString('hex').toUpperCase()}`;
      const created = await createGuest({
        name: '详情客人',
        phone: '13600136000',
        idType: 'ID_CARD',
        idNumber,
      });
      const guestId = Number(created.body.data.id as number);
      createdGuestIds.push(BigInt(guestId));

      const roomType = await prisma.roomType.create({
        data: {
          code: `GS${randomBytes(4).toString('hex').toUpperCase()}`,
          name: '客人测试房型',
          basePrice: 100,
          capacity: 2,
        },
      });
      createdRoomTypeIds.push(roomType.id);
      const booking = await prisma.booking.create({
        data: {
          guestId: BigInt(guestId),
          roomTypeId: roomType.id,
          checkInDate: new Date('2026-11-01T00:00:00.000Z'),
          checkOutDate: new Date('2026-11-03T00:00:00.000Z'),
          pricePerNight: 100,
          totalPrice: 200,
          createdBy: BigInt(adminUserId),
        },
      });
      createdBookingIds.push(booking.id);

      const detail = await request(app).get(`/api/v1/guests/${guestId}`).set('Cookie', userCookie);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({
        id: guestId,
        recentBookings: [
          {
            id: Number(booking.id),
            checkInDate: '2026-11-01',
            checkOutDate: '2026-11-03',
            status: 'CONFIRMED',
          },
        ],
      });
      expect(JSON.stringify(detail.body)).not.toContain(idNumber);

      const missing = await request(app).get('/api/v1/guests/999999').set('Cookie', userCookie);
      expect(missing.status).toBe(404);

      const invalid = await request(app).get('/api/v1/guests/abc').set('Cookie', userCookie);
      expect(invalid.status).toBe(422);
    });
  });

  describe('G4 更新', () => {
    it('可改姓名/手机/备注；修改证件号或证件类型 → 409；不存在 404；非法输入 422', async () => {
      const created = await createGuest({
        name: '待更新客人',
        phone: '13500135000',
        idType: 'ID_CARD',
        idNumber: `U${randomBytes(6).toString('hex').toUpperCase()}`,
      });
      const guestId = Number(created.body.data.id as number);
      createdGuestIds.push(BigInt(guestId));

      const updated = await request(app)
        .patch(`/api/v1/guests/${guestId}`)
        .set('Cookie', userCookie)
        .send({ name: '已更新客人', phone: '13900139000', remark: '已更新联系方式' });
      expect(updated.status).toBe(200);
      expect(updated.body.data).toMatchObject({
        id: guestId,
        name: '已更新客人',
        phone: '13900139000',
        remark: '已更新联系方式',
      });

      const changeIdNumber = await request(app)
        .patch(`/api/v1/guests/${guestId}`)
        .set('Cookie', userCookie)
        .send({ idNumber: '110101199001019999' });
      expect(changeIdNumber.status).toBe(409);
      expect(changeIdNumber.body.error).toMatchObject({
        code: 'GUEST_EXISTS',
        message: '证件号不可修改，如需变更请新建档案',
      });

      const changeIdType = await request(app)
        .patch(`/api/v1/guests/${guestId}`)
        .set('Cookie', userCookie)
        .send({ idType: 'PASSPORT' });
      expect(changeIdType.status).toBe(409);

      const badPhone = await request(app)
        .patch(`/api/v1/guests/${guestId}`)
        .set('Cookie', userCookie)
        .send({ phone: '123' });
      expect(badPhone.status).toBe(422);

      const unknownField = await request(app)
        .patch(`/api/v1/guests/${guestId}`)
        .set('Cookie', userCookie)
        .send({ status: 'ACTIVE' });
      expect(unknownField.status).toBe(422);

      const missing = await request(app)
        .patch('/api/v1/guests/999999')
        .set('Cookie', userCookie)
        .send({ phone: '13900139000' });
      expect(missing.status).toBe(404);
    });
  });
});
