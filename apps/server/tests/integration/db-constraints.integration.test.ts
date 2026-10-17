import 'dotenv/config';

import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnv, type AppConfig } from '../../src/config/env.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaClient } from '../../src/lib/prisma.js';
import { hotelToday } from '../../src/utils/hotel-date.js';

/**
 * TC-DB-001~003（database-design §2/§3/§4/§7；NFR-CON-002）
 * + TC-CON-003（ADR-006 数据库层兜底）。
 *
 * 直接对真实 MySQL 元数据与约束行为断言：
 * - 7 个唯一键真实存在且列顺序正确（迁移漂移即失败）
 * - CHECK 约束按迁移 SQL 落库
 * - 关键索引存在
 * - 绕过应用层直接插入冲突行时，数据库必须拒绝（P2002 / Duplicate entry）
 *
 * 默认不运行；执行：HMS_INTEGRATION=1 vitest run。仅创建 itest_ 前缀数据并清理。
 */
const runIntegration =
  process.env['HMS_INTEGRATION'] === '1' && Boolean(process.env['DATABASE_URL']);

const suite = runIntegration ? describe : describe.skip;

suite('数据库结构与约束（information_schema + 冲突插入）', () => {
  const runId = Date.now().toString(36).toUpperCase();
  const suffix = `${runId}${Math.floor(Math.random() * 46655)
    .toString(36)
    .toUpperCase()}`.replace(/[^A-Z0-9]/g, '');
  const usernamePrefix = `itest_db_${runId.toLowerCase()}`;
  const codePrefix = `DB${suffix}`;
  const roomPrefix = `DB${suffix}`;

  let config: AppConfig;
  let prisma: PrismaClient;

  let userId: bigint;
  let roomTypeId: bigint;
  let roomId: bigint;
  let guestAId: bigint;
  let guestBId: bigint;
  let bookingAId: bigint;
  let bookingBId: bigint;
  let stay1Id: bigint;
  let stay2Id: bigint;

  beforeAll(async () => {
    config = loadEnv(process.env);
    prisma = createPrismaClient(config);

    const user = await prisma.user.create({
      data: {
        username: `${usernamePrefix}_u`,
        passwordHash: '$2b$12$test.hash.not.used.for.login.only.for.fk',
        displayName: '约束测试用户',
        role: 'ADMIN',
      },
    });
    userId = user.id;

    const roomType = await prisma.roomType.create({
      data: { code: `${codePrefix}A`, name: '约束测试房型', basePrice: 300, capacity: 2 },
    });
    roomTypeId = roomType.id;

    const room = await prisma.room.create({
      data: { roomNumber: `${roomPrefix}A1`, roomTypeId },
    });
    roomId = room.id;

    const guestA = await prisma.guest.create({
      data: {
        name: `约束客人A${suffix}`,
        phone: '13800138000',
        idType: 'ID_CARD',
        idNumberHash: randomBytes(32).toString('hex'),
        idNumberCipher: Buffer.from('test-cipher'),
      },
    });
    guestAId = guestA.id;

    const guestB = await prisma.guest.create({
      data: {
        name: `约束客人B${suffix}`,
        phone: '13900139000',
        idType: 'ID_CARD',
        idNumberHash: randomBytes(32).toString('hex'),
        idNumberCipher: Buffer.from('test-cipher'),
      },
    });
    guestBId = guestB.id;

    const checkIn = new Date(`${d(70)}T00:00:00.000Z`);
    const checkOut = new Date(`${d(72)}T00:00:00.000Z`);
    const bookingA = await prisma.booking.create({
      data: {
        guestId: guestAId,
        roomTypeId,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        pricePerNight: 300,
        totalPrice: 600,
        status: 'CONFIRMED',
        createdBy: userId,
      },
    });
    bookingAId = bookingA.id;
    const bookingB = await prisma.booking.create({
      data: {
        guestId: guestBId,
        roomTypeId,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        pricePerNight: 300,
        totalPrice: 600,
        status: 'CONFIRMED',
        createdBy: userId,
      },
    });
    bookingBId = bookingB.id;

    const stay1 = await prisma.stay.create({
      data: {
        guestId: guestAId,
        roomId,
        roomTypeId,
        pricePerNight: 300,
        checkInAt: new Date(),
        expectedCheckOutDate: new Date(`${d(75)}T00:00:00.000Z`),
        createdBy: userId,
      },
    });
    stay1Id = stay1.id;

    const stay2 = await prisma.stay.create({
      data: {
        bookingId: bookingAId,
        guestId: guestAId,
        roomId,
        roomTypeId,
        pricePerNight: 300,
        checkInAt: new Date(),
        expectedCheckOutDate: new Date(`${d(75)}T00:00:00.000Z`),
        createdBy: userId,
      },
    });
    stay2Id = stay2.id;
  });

  afterAll(async () => {
    const stayIds = [stay1Id, stay2Id].filter((id): id is bigint => id !== undefined);
    if (stayIds.length > 0) {
      await prisma.order.deleteMany({ where: { stayId: { in: stayIds } } });
      await prisma.stay.deleteMany({ where: { id: { in: stayIds } } });
    }
    if (bookingAId !== undefined && bookingBId !== undefined) {
      await prisma.booking.deleteMany({ where: { id: { in: [bookingAId, bookingBId] } } });
    }
    if (roomId !== undefined) await prisma.room.deleteMany({ where: { id: roomId } });
    if (roomTypeId !== undefined) await prisma.roomType.deleteMany({ where: { id: roomTypeId } });
    if (guestAId !== undefined && guestBId !== undefined) {
      await prisma.guest.deleteMany({ where: { id: { in: [guestAId, guestBId] } } });
    }
    await prisma.user.deleteMany({ where: { username: { startsWith: usernamePrefix } } });
    await prisma.$disconnect();
  });

  function d(offset: number): string {
    const today = new Date(`${hotelToday()}T00:00:00.000Z`);
    return new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  }

  it('TC-DB-001：7 个唯一键存在且列顺序与设计一致', async () => {
    const rows = await prisma.$queryRaw<
      Array<{ TABLE_NAME: string; INDEX_NAME: string; COLUMNS: string | null }>
    >`
      SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLUMNS
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND NON_UNIQUE = 0
        AND INDEX_NAME <> 'PRIMARY'
      GROUP BY TABLE_NAME, INDEX_NAME
    `;

    const actual = new Map(
      rows
        .filter((row) => row.INDEX_NAME.startsWith('uq_'))
        .map((row) => [row.INDEX_NAME, String(row.COLUMNS ?? '')]),
    );

    expect(Object.fromEntries(actual)).toMatchObject({
      uq_users_username: 'username',
      uq_room_types_code: 'code',
      uq_rooms_room_number: 'room_number',
      uq_guests_id_number: 'id_type,id_number_hash',
      uq_bookings_booking_stay: 'booking_id',
      uq_occupancy_room_date: 'room_id,date',
      uq_orders_stay: 'stay_id',
    });
    expect(actual.size, '不应出现设计外的 uq_ 唯一键').toBe(7);
  });

  it('TC-DB-002：CHECK 约束按迁移 SQL 落库（CURDATE 规则除外，由服务层覆盖）', async () => {
    const rows = await prisma.$queryRaw<Array<{ CONSTRAINT_NAME: string; CHECK_CLAUSE: string }>>`
      SELECT CONSTRAINT_NAME, CHECK_CLAUSE
      FROM information_schema.CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
    `;
    const byName = new Map(rows.map((row) => [row.CONSTRAINT_NAME, row.CHECK_CLAUSE]));

    for (const name of [
      'chk_room_types_base_price',
      'chk_room_types_capacity',
      'chk_bookings_date_order',
      'chk_stays_check_out_after_check_in',
      'chk_order_items_amount_positive',
    ]) {
      expect(byName.has(name), `缺少 CHECK 约束 ${name}`).toBe(true);
    }

    expect(byName.get('chk_room_types_base_price')).toMatch(/base_price/i);
    expect(byName.get('chk_room_types_capacity')).toMatch(/capacity/i);
    expect(byName.get('chk_bookings_date_order')).toMatch(/check_out_date.*check_in_date/i);
    expect(byName.get('chk_stays_check_out_after_check_in')).toMatch(
      /expected_check_out_date.*check_in_at/i,
    );
    expect(byName.get('chk_order_items_amount_positive')).toMatch(/amount/i);
  });

  it('TC-DB-003：关键查询索引存在（占用表由唯一键兼作查询索引）', async () => {
    const rows = await prisma.$queryRaw<Array<{ INDEX_NAME: string }>>`
      SELECT DISTINCT INDEX_NAME
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
    `;
    const names = new Set(rows.map((row) => row.INDEX_NAME));

    for (const required of [
      'idx_sessions_expires',
      'idx_sessions_user',
      'idx_rooms_type',
      'idx_guests_name',
      'idx_guests_phone',
      'idx_bookings_capacity',
      'idx_bookings_guest',
      'idx_bookings_checkin',
      'idx_stays_room',
      'idx_stays_guest',
      'idx_stays_status_checkout',
      'idx_orders_created',
      'idx_items_order',
    ]) {
      expect(names.has(required), `缺少索引 ${required}`).toBe(true);
    }

    // database-design §4：idx_occupancy_room_date 即唯一键 uq_occupancy_room_date（兼作查询）
    const occupancyIndexes = await prisma.$queryRaw<
      Array<{ INDEX_NAME: string; COLUMNS: string | null }>
    >`
      SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLUMNS
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'room_occupancy'
        AND NON_UNIQUE = 0
      GROUP BY INDEX_NAME
    `;
    expect(
      occupancyIndexes.some((row) => String(row.COLUMNS ?? '') === 'room_id,date'),
      'room_occupancy 必须存在 (room_id, date) 查询索引（唯一键兼任）',
    ).toBe(true);
  });

  async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught, '预期数据库唯一约束拒绝插入，但插入成功').toBeDefined();
    expect((caught as { code?: string }).code, 'Prisma 唯一冲突应映射为 P2002').toBe('P2002');
    expect(String((caught as Error).message)).toMatch(/Unique constraint|Duplicate entry/i);
  }

  it('TC-CON-003：绕过应用直插重复占用/重复账单/重复入住均被数据库拒绝', async () => {
    // 基线：为 stay1 写入一条占用与一张账单
    await prisma.roomOccupancy.create({
      data: { stayId: stay1Id, roomId, date: new Date(`${d(60)}T00:00:00.000Z`) },
    });
    await prisma.order.create({
      data: {
        stayId: stay1Id,
        totalAmount: 300,
        depositAmount: 0,
        depositApplied: 0,
        paidAmount: 300,
        paymentMethod: 'CASH',
        status: 'PAID',
        createdBy: userId,
      },
    });

    // ① 同房同日重复占用（uq_occupancy_room_date）
    await expectUniqueViolation(
      prisma.roomOccupancy.create({
        data: { stayId: stay2Id, roomId, date: new Date(`${d(60)}T00:00:00.000Z`) },
      }),
    );

    // ② 同一入住重复账单（uq_orders_stay）
    await expectUniqueViolation(
      prisma.order.create({
        data: {
          stayId: stay1Id,
          totalAmount: 300,
          depositAmount: 0,
          depositApplied: 0,
          paidAmount: 300,
          paymentMethod: 'WECHAT',
          status: 'PAID',
          createdBy: userId,
        },
      }),
    );

    // ③ 同一预订重复入住（uq_bookings_booking_stay）
    await expectUniqueViolation(
      prisma.stay.create({
        data: {
          bookingId: bookingAId,
          guestId: guestBId,
          roomId,
          roomTypeId,
          pricePerNight: 300,
          checkInAt: new Date(),
          expectedCheckOutDate: new Date(`${d(75)}T00:00:00.000Z`),
          createdBy: userId,
        },
      }),
    );

    // 失败插入不得留下任何行
    expect(await prisma.roomOccupancy.count({ where: { stayId: stay1Id } })).toBe(1);
    expect(await prisma.roomOccupancy.count({ where: { stayId: stay2Id } })).toBe(0);
    expect(await prisma.order.count({ where: { stayId: stay1Id } })).toBe(1);
    expect(await prisma.stay.count({ where: { bookingId: bookingAId } })).toBe(1);
    expect(await prisma.stay.count({ where: { bookingId: bookingBId } })).toBe(0);
  });
});
