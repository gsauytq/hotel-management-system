import { describe, expect, it, vi } from 'vitest';

import type { GuestRecord, GuestsRepository } from '../src/modules/guests/guests.repository.js';
import { createGuestsService } from '../src/modules/guests/guests.service.js';
import { createGuestCrypto } from '../src/utils/crypto.js';

const crypto = createGuestCrypto({
  hmacKeyBase64: Buffer.alloc(32, 1).toString('base64'),
  cipherKeyBase64: Buffer.alloc(32, 2).toString('base64'),
});

const ID_NUMBER = '110101199001011234';
const MASKED = `1${'*'.repeat(16)}4`;

function createRepositoryMock() {
  return {
    list: vi.fn<GuestsRepository['list']>(),
    findById: vi.fn<GuestsRepository['findById']>(),
    findByIdentity: vi.fn<GuestsRepository['findByIdentity']>(),
    create: vi.fn<GuestsRepository['create']>(),
    update: vi.fn<GuestsRepository['update']>(),
    findRecentBookings: vi.fn<GuestsRepository['findRecentBookings']>(),
  };
}

function makeGuest(overrides: Partial<GuestRecord> = {}): GuestRecord {
  return {
    id: 9,
    name: '张三',
    phone: '13800138000',
    idType: 'ID_CARD',
    idNumberHash: crypto.hashIdNumber(ID_NUMBER),
    idNumberCipher: crypto.encryptIdNumber(ID_NUMBER),
    remark: 'VIP 常客',
    createdAt: new Date('2026-10-14T06:00:00.000Z'),
    updatedAt: new Date('2026-10-14T06:00:00.000Z'),
    ...overrides,
  };
}

function buildService() {
  const repository = createRepositoryMock();
  const service = createGuestsService({ repository, crypto });
  return { repository, service };
}

describe('guests.service（G1–G4）', () => {
  it('列表/创建响应只返回掩码证件号，绝无明文字段', async () => {
    const { repository, service } = buildService();
    repository.list.mockResolvedValue({ total: 1, items: [makeGuest()] });

    const result = await service.list({ page: 1, pageSize: 20, orderBy: [{ createdAt: 'desc' }] });
    expect(result.items[0]).toMatchObject({ id: 9, idNumberMasked: MASKED, remark: 'VIP 常客' });
    expect(JSON.stringify(result)).not.toContain(ID_NUMBER);
    expect(result.items[0]).not.toHaveProperty('idNumber');

    repository.create.mockResolvedValue(makeGuest({ id: 10 }));
    const created = await service.create({
      name: '张三',
      phone: '13800138000',
      idType: 'ID_CARD',
      idNumber: ID_NUMBER,
    });
    expect(created.idNumberMasked).toBe(MASKED);
    expect(JSON.stringify(created)).not.toContain(ID_NUMBER);

    // 落库参数：密文可解密、哈希确定、无明文
    const data = repository.create.mock.calls[0]?.[0];
    expect(data?.idNumberHash).toBe(crypto.hashIdNumber(ID_NUMBER));
    expect(crypto.decryptIdNumber(data?.idNumberCipher as Uint8Array)).toBe(ID_NUMBER);
    expect(JSON.stringify(data)).not.toContain(ID_NUMBER);
  });

  it('证件号重复 → 409 GUEST_EXISTS + existingGuestId；不同证件类型可复用同一号码', async () => {
    const { repository, service } = buildService();
    repository.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    repository.findByIdentity.mockResolvedValue(makeGuest({ id: 7 }));

    await expect(
      service.create({
        name: '张三',
        phone: '13800138000',
        idType: 'ID_CARD',
        idNumber: ID_NUMBER,
      }),
    ).rejects.toMatchObject({
      code: 'GUEST_EXISTS',
      status: 409,
      details: [{ field: 'idNumber', message: 'existingGuestId: 7' }],
    });
    expect(repository.findByIdentity).toHaveBeenCalledWith(
      'ID_CARD',
      crypto.hashIdNumber(ID_NUMBER),
    );

    // 不同 idType → 不同唯一键组合，允许创建（由仓储正常返回）
    repository.create.mockResolvedValueOnce(makeGuest({ id: 11, idType: 'PASSPORT' }));
    await expect(
      service.create({
        name: '张三',
        phone: '13800138000',
        idType: 'PASSPORT',
        idNumber: ID_NUMBER,
      }),
    ).resolves.toMatchObject({ idType: 'PASSPORT' });
  });

  it('G4：试图修改证件号 → 409（证件号不可修改）；可改姓名/手机/备注', async () => {
    const { repository, service } = buildService();
    repository.findById.mockResolvedValue(makeGuest());

    await expect(service.update(9, { idNumber: '110101199001019999' })).rejects.toMatchObject({
      code: 'GUEST_EXISTS',
      status: 409,
      message: '证件号不可修改，如需变更请新建档案',
    });
    expect(repository.update).not.toHaveBeenCalled();

    repository.update.mockResolvedValue(makeGuest({ name: '张三丰', phone: '13900139000' }));
    await expect(
      service.update(9, { name: '张三丰', phone: '13900139000' }),
    ).resolves.toMatchObject({ name: '张三丰', phone: '13900139000' });
  });

  it('G3 详情：含最近预订摘要（日期转 YYYY-MM-DD）；不存在 404', async () => {
    const { repository, service } = buildService();
    repository.findById.mockResolvedValue(makeGuest());
    repository.findRecentBookings.mockResolvedValue([
      {
        id: 301,
        checkInDate: new Date('2026-10-15T00:00:00.000Z'),
        checkOutDate: new Date('2026-10-17T00:00:00.000Z'),
        status: 'CONFIRMED',
      },
    ]);

    const detail = await service.getById(9);
    expect(detail).toMatchObject({
      id: 9,
      idNumberMasked: MASKED,
      updatedAt: '2026-10-14T06:00:00.000Z',
      recentBookings: [
        { id: 301, checkInDate: '2026-10-15', checkOutDate: '2026-10-17', status: 'CONFIRMED' },
      ],
    });
    expect(repository.findRecentBookings).toHaveBeenCalledWith(9, 10);

    repository.findById.mockResolvedValueOnce(null);
    await expect(service.getById(999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
