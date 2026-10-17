import { describe, expect, it, vi } from 'vitest';

import type { RoomRecord, RoomsRepository } from '../src/modules/rooms/rooms.repository.js';
import { createRoomsService } from '../src/modules/rooms/rooms.service.js';
import type { RoomTypesService } from '../src/modules/room-types/room-types.service.js';
import { ApiError } from '../src/shared/http/ApiError.js';

function createRepositoryMock() {
  return {
    list: vi.fn<RoomsRepository['list']>(),
    findById: vi.fn<RoomsRepository['findById']>(),
    create: vi.fn<RoomsRepository['create']>(),
    update: vi.fn<RoomsRepository['update']>(),
    updateStatus: vi.fn<RoomsRepository['updateStatus']>(),
    listAvailable: vi.fn<RoomsRepository['listAvailable']>(),
  };
}

function createRoomTypesServiceMock(): Pick<RoomTypesService, 'getById'> {
  return {
    getById: vi.fn<RoomTypesService['getById']>(),
  };
}

function makeRoom(overrides: Partial<RoomRecord> = {}): RoomRecord {
  return {
    id: 12,
    roomNumber: '0821',
    roomTypeId: 1,
    roomTypeName: '标准大床房',
    status: 'VACANT_DIRTY',
    note: null,
    currentStay: null,
    createdAt: new Date('2026-09-01T02:00:00.000Z'),
    updatedAt: new Date('2026-10-13T14:02:11.000Z'),
    ...overrides,
  };
}

function uniqueViolation(): Error {
  return Object.assign(new Error('Unique constraint failed on the fields: (`room_number`)'), {
    code: 'P2002',
  });
}

function buildService() {
  const repository = createRepositoryMock();
  const roomTypesService = createRoomTypesServiceMock();
  const service = createRoomsService({
    repository,
    roomTypesService: roomTypesService as RoomTypesService,
  });
  return { repository, roomTypesService, service };
}

describe('rooms.service 列表与详情（M1/M2）', () => {
  it('列表映射分页与 currentStay（日期仅格式化 expectedCheckOutDate）', async () => {
    const { repository, service } = buildService();
    repository.list.mockResolvedValue({
      total: 3,
      items: [
        makeRoom({
          status: 'OCCUPIED',
          currentStay: {
            stayId: 501,
            guestName: '张三',
            checkInAt: new Date('2026-10-13T14:02:11.000Z'),
            expectedCheckOutDate: new Date('2026-10-15T00:00:00.000Z'),
          },
        }),
        makeRoom({ id: 13, roomNumber: '0822' }),
      ],
    });

    const result = await service.list({
      page: 1,
      pageSize: 2,
      roomNumber: '08',
      orderBy: [{ roomNumber: 'asc' }],
    });

    expect(repository.list).toHaveBeenCalledWith({
      roomNumberPrefix: '08',
      page: 1,
      pageSize: 2,
      orderBy: [{ roomNumber: 'asc' }],
    });
    expect(result.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(result.items[0]?.currentStay).toEqual({
      stayId: 501,
      guestName: '张三',
      checkInAt: '2026-10-13T14:02:11.000Z',
      expectedCheckOutDate: '2026-10-15',
    });
    expect(result.items[1]?.currentStay).toBeNull();
  });

  it('详情不存在 → 404', async () => {
    const { repository, service } = buildService();
    repository.findById.mockResolvedValue(null);
    await expect(service.getById(999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('可分配房间：归档房型返回空列表（不查询）；有效房型查询区间', async () => {
    const { repository, roomTypesService, service } = buildService();
    const roomTypes = roomTypesService as { getById: ReturnType<typeof vi.fn> };

    roomTypes.getById.mockResolvedValueOnce({ id: 1, status: 'ARCHIVED' });
    await expect(
      service.listAvailable({
        roomTypeId: 1,
        checkInDate: '2026-10-14',
        checkOutDate: '2026-10-16',
      }),
    ).resolves.toEqual([]);
    expect(repository.listAvailable).not.toHaveBeenCalled();

    roomTypes.getById.mockResolvedValueOnce({ id: 1, status: 'ACTIVE' });
    repository.listAvailable.mockResolvedValue([
      { id: 13, roomNumber: '0823', status: 'VACANT_CLEAN' },
    ]);
    const available = await service.listAvailable({
      roomTypeId: 1,
      checkInDate: '2026-10-14',
      checkOutDate: '2026-10-16',
    });
    expect(available).toEqual([{ id: 13, roomNumber: '0823', status: 'VACANT_CLEAN' }]);
    expect(repository.listAvailable).toHaveBeenCalledWith({
      roomTypeId: 1,
      checkInDate: new Date('2026-10-14T00:00:00.000Z'),
      checkOutDate: new Date('2026-10-16T00:00:00.000Z'),
    });
  });
});

describe('rooms.service 创建与修改（M3/M4）', () => {
  it('创建：不存在房型 → 404；归档房型 → 409；房号重复 → 409', async () => {
    const { repository, service } = buildService();

    repository.create.mockResolvedValueOnce({ outcome: 'room_type_not_found' });
    await expect(service.create({ roomNumber: '0822', roomTypeId: 1 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    repository.create.mockResolvedValueOnce({ outcome: 'room_type_archived' });
    await expect(service.create({ roomNumber: '0822', roomTypeId: 1 })).rejects.toMatchObject({
      code: 'ROOM_TYPE_ARCHIVED',
    });

    repository.create.mockRejectedValueOnce(uniqueViolation());
    await expect(service.create({ roomNumber: '0822', roomTypeId: 1 })).rejects.toMatchObject({
      code: 'ROOM_NUMBER_EXISTS',
      status: 409,
    });
  });

  it('修改：空 PATCH 返回当前对象且不触发写操作', async () => {
    const { repository, service } = buildService();
    repository.findById.mockResolvedValue(makeRoom());

    const result = await service.update(12, {});
    expect(result.id).toBe(12);
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('修改：OCCUPIED 改房型/房号 → 409 ROOM_STATUS_INVALID', async () => {
    const { repository, service } = buildService();
    repository.update.mockResolvedValue({ outcome: 'occupied_restricted' });

    await expect(service.update(12, { roomNumber: '0901' })).rejects.toMatchObject({
      code: 'ROOM_STATUS_INVALID',
      message: '在住房间不可修改房型或房号',
    });
  });

  it('修改：并发改房型（room_changed）→ 409 且要求刷新重试', async () => {
    const { repository, service } = buildService();
    repository.update.mockResolvedValue({ outcome: 'room_changed' });

    await expect(service.update(12, { roomTypeId: 2 })).rejects.toMatchObject({
      code: 'ROOM_STATUS_INVALID',
      status: 409,
      message: '房间信息已变更，请刷新后重试',
    });
  });

  it('修改：房号重复 → 409；不存在 → 404；目标房型不存在 → 404', async () => {
    const { repository, service } = buildService();

    repository.update.mockRejectedValueOnce(uniqueViolation());
    await expect(service.update(12, { roomNumber: '0822' })).rejects.toMatchObject({
      code: 'ROOM_NUMBER_EXISTS',
    });

    repository.update.mockResolvedValueOnce({ outcome: 'not_found' });
    await expect(service.update(999, { note: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    repository.update.mockResolvedValueOnce({ outcome: 'room_type_not_found' });
    await expect(service.update(12, { roomTypeId: 99 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('rooms.service 房态变更（M5：状态机 + 角色）', () => {
  it('非法迁移：OCCUPIED 不可人工变更；不可人工设置为 OCCUPIED', async () => {
    const { repository, service } = buildService();
    repository.findById.mockResolvedValue(makeRoom({ status: 'VACANT_DIRTY' }));

    await expect(service.updateStatus(12, { status: 'OCCUPIED' }, 'ADMIN')).rejects.toMatchObject({
      code: 'ROOM_STATUS_INVALID',
      status: 409,
    });

    repository.findById.mockResolvedValue(makeRoom({ status: 'OCCUPIED' }));
    await expect(
      service.updateStatus(12, { status: 'VACANT_CLEAN' }, 'ADMIN'),
    ).rejects.toMatchObject({ code: 'ROOM_STATUS_INVALID', status: 409 });

    expect(repository.updateStatus).not.toHaveBeenCalled();
  });

  it('清洁完成（DIRTY→CLEAN）：前台即可', async () => {
    const { repository, service } = buildService();
    repository.findById.mockResolvedValue(makeRoom({ status: 'VACANT_DIRTY' }));
    repository.updateStatus.mockResolvedValue({
      outcome: 'updated',
      room: makeRoom({ status: 'VACANT_CLEAN' }),
    });

    const result = await service.updateStatus(12, { status: 'VACANT_CLEAN' }, 'RECEPTIONIST');
    expect(result.status).toBe('VACANT_CLEAN');
    expect(repository.updateStatus).toHaveBeenCalledWith(12, 1, 'VACANT_DIRTY', 'VACANT_CLEAN');
  });

  it('进入/退出维修与停用：前台 403，管理员放行', async () => {
    const { repository, service } = buildService();
    repository.findById.mockResolvedValue(makeRoom({ status: 'VACANT_CLEAN' }));

    await expect(
      service.updateStatus(12, { status: 'MAINTENANCE' }, 'RECEPTIONIST'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(repository.updateStatus).not.toHaveBeenCalled();

    repository.updateStatus.mockResolvedValue({
      outcome: 'updated',
      room: makeRoom({ status: 'MAINTENANCE' }),
    });
    await expect(
      service.updateStatus(12, { status: 'MAINTENANCE' }, 'ADMIN'),
    ).resolves.toMatchObject({ status: 'MAINTENANCE' });

    // 退出停用（DISABLED→DIRTY）同样仅 ADMIN
    repository.findById.mockResolvedValue(makeRoom({ status: 'DISABLED' }));
    await expect(
      service.updateStatus(12, { status: 'VACANT_DIRTY' }, 'RECEPTIONIST'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.updateStatus(12, { status: 'VACANT_DIRTY' }, 'ADMIN'),
    ).resolves.toMatchObject({ status: 'MAINTENANCE' });
  });

  it('并发冲突（状态已被修改）→ 409；房间不存在 → 404', async () => {
    const { repository, service } = buildService();
    repository.findById.mockResolvedValue(makeRoom({ status: 'VACANT_DIRTY' }));

    repository.updateStatus.mockResolvedValueOnce({ outcome: 'conflict' });
    await expect(
      service.updateStatus(12, { status: 'VACANT_CLEAN' }, 'RECEPTIONIST'),
    ).rejects.toMatchObject({ code: 'ROOM_STATUS_INVALID', status: 409 });

    repository.findById.mockResolvedValueOnce(null);
    await expect(
      service.updateStatus(999, { status: 'VACANT_CLEAN' }, 'RECEPTIONIST'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('可分配房间：无效房型（服务层 404）向上抛出', async () => {
    const { roomTypesService, service } = buildService();
    (roomTypesService.getById as ReturnType<typeof vi.fn>).mockRejectedValue(
      ApiError.notFound('房型不存在'),
    );
    await expect(
      service.listAvailable({
        roomTypeId: 99,
        checkInDate: '2026-10-14',
        checkOutDate: '2026-10-16',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
