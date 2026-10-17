import { describe, expect, it, vi } from 'vitest';

import type {
  RoomTypeRecord,
  RoomTypesRepository,
} from '../src/modules/room-types/room-types.repository.js';
import { createRoomTypesService } from '../src/modules/room-types/room-types.service.js';
import { ApiError } from '../src/shared/http/ApiError.js';

function createRepositoryMock() {
  return {
    list: vi.fn<RoomTypesRepository['list']>(),
    findById: vi.fn<RoomTypesRepository['findById']>(),
    create: vi.fn<RoomTypesRepository['create']>(),
    update: vi.fn<RoomTypesRepository['update']>(),
    archive: vi.fn<RoomTypesRepository['archive']>(),
  };
}

function makeRecord(overrides: Partial<RoomTypeRecord> = {}): RoomTypeRecord {
  return {
    id: 1,
    code: 'STD',
    name: '标准大床房',
    basePrice: 288,
    capacity: 2,
    description: null,
    status: 'ACTIVE',
    roomCount: 12,
    createdAt: new Date('2026-09-01T02:00:00.000Z'),
    updatedAt: new Date('2026-09-02T02:00:00.000Z'),
    ...overrides,
  };
}

function uniqueViolation(): Error {
  return Object.assign(new Error('Unique constraint failed on the fields: (`code`)'), {
    code: 'P2002',
  });
}

describe('roomTypes.service（R1–R4 业务规则）', () => {
  it('列表映射为 DTO（金额为 number、时间为 ISO、含 roomCount）', async () => {
    const repository = createRepositoryMock();
    repository.list.mockResolvedValue([makeRecord()]);
    const service = createRoomTypesService({ repository });

    const items = await service.list({ status: 'ACTIVE' });
    expect(repository.list).toHaveBeenCalledWith({ status: 'ACTIVE' });
    expect(items[0]).toEqual({
      id: 1,
      code: 'STD',
      name: '标准大床房',
      basePrice: 288,
      capacity: 2,
      description: null,
      status: 'ACTIVE',
      roomCount: 12,
      createdAt: '2026-09-01T02:00:00.000Z',
      updatedAt: '2026-09-02T02:00:00.000Z',
    });
  });

  it('创建成功返回 DTO；唯一约束冲突（含并发竞态）→ 409 ROOM_TYPE_CODE_EXISTS', async () => {
    const repository = createRepositoryMock();
    repository.create.mockResolvedValueOnce(makeRecord({ roomCount: 0 }));
    const service = createRoomTypesService({ repository });

    const created = await service.create({
      code: 'STD',
      name: '标准大床房',
      basePrice: 288,
      capacity: 2,
    });
    expect(created.code).toBe('STD');

    repository.create.mockRejectedValueOnce(uniqueViolation());
    await expect(
      service.create({ code: 'STD', name: '标准大床房', basePrice: 288, capacity: 2 }),
    ).rejects.toMatchObject({ code: 'ROOM_TYPE_CODE_EXISTS', status: 409 });
  });

  it('详情/修改不存在 → 404', async () => {
    const repository = createRepositoryMock();
    repository.findById.mockResolvedValue(null);
    repository.update.mockResolvedValue(null);
    const service = createRoomTypesService({ repository });

    await expect(service.getById(999)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(service.update(999, { basePrice: 100 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('归档成功 → 返回 ARCHIVED 对象', async () => {
    const repository = createRepositoryMock();
    repository.archive.mockResolvedValue({
      outcome: 'archived',
      roomType: makeRecord({ status: 'ARCHIVED' }),
    });
    const service = createRoomTypesService({ repository });

    const archived = await service.archive(1);
    expect(archived.status).toBe('ARCHIVED');
  });

  it('存在 CONFIRMED 预订或 CHECKED_IN 在住 → 409 ROOM_TYPE_ARCHIVED（不物理删除）', async () => {
    const repository = createRepositoryMock();
    repository.archive.mockResolvedValue({
      outcome: 'referenced',
      confirmedBookings: 2,
      checkedInStays: 1,
    });
    const service = createRoomTypesService({ repository });

    await expect(service.archive(1)).rejects.toMatchObject({
      code: 'ROOM_TYPE_ARCHIVED',
      status: 409,
      message: '该房型存在未完结预订或在住，不可归档',
    });
  });

  it('已归档再次归档 → 409；不存在 → 404', async () => {
    const repository = createRepositoryMock();
    const service = createRoomTypesService({ repository });

    repository.archive.mockResolvedValueOnce({ outcome: 'already_archived' });
    await expect(service.archive(1)).rejects.toMatchObject({ code: 'ROOM_TYPE_ARCHIVED' });

    repository.archive.mockResolvedValueOnce({ outcome: 'not_found' });
    await expect(service.archive(999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('非唯一约束错误原样上抛（交由 errorHandler 兜底 500）', async () => {
    const repository = createRepositoryMock();
    repository.create.mockRejectedValue(new Error('connection lost'));
    const service = createRoomTypesService({ repository });

    await expect(
      service.create({ code: 'STD', name: '标准', basePrice: 1, capacity: 1 }),
    ).rejects.toThrowError('connection lost');
  });

  it('ApiError 识别：P2002 翻译不影响其他 ApiError', () => {
    expect(ApiError.conflict('ROOM_TYPE_CODE_EXISTS', 'x')).toMatchObject({ status: 409 });
  });
});
