import type { RoomStatus } from '@hms/shared';
import {
  ADMIN_ONLY_ROOM_STATUSES,
  ROOM_STATUSES,
  ROOM_STATUS_MANUAL_TRANSITIONS,
} from '@hms/shared';
import { describe, expect, it } from 'vitest';

import type {
  AvailableRoomRecord,
  RoomRecord,
  RoomsRepository,
} from '../src/modules/rooms/rooms.repository.js';
import { createRoomsService } from '../src/modules/rooms/rooms.service.js';
import type { RoomTypesService } from '../src/modules/room-types/room-types.service.js';
import { ApiError } from '../src/shared/http/ApiError.js';

/**
 * TC-RM-013 房态迁移矩阵穷举（FR-RM-003 / NFR-CON-003）。
 *
 * 被测对象是 rooms.service 的真实状态机守卫（不是常量表本身）：
 * 对 5×5 全排列 × 两种角色逐一调用 service.updateStatus，断言：
 * - 非法迁移 → 409 ROOM_STATUS_INVALID
 * - 合法但涉及维修/停用 → 非 ADMIN 403 FORBIDDEN
 * - 合法且角色允许 → 仓库被调用并返回迁移后的真实房态
 *
 * 预期条目完全由 shared/states.ts 的 ROOM_STATUS_MANUAL_TRANSITIONS 与
 * ADMIN_ONLY_ROOM_STATUSES 推导（database-design §5.2），不额外假设规则。
 */

function makeRoom(status: RoomStatus): RoomRecord {
  return {
    id: 12,
    roomNumber: '0821',
    roomTypeId: 1,
    roomTypeName: '标准大床房',
    status,
    note: null,
    currentStay: null,
    createdAt: new Date('2026-09-01T02:00:00.000Z'),
    updatedAt: new Date('2026-10-13T14:02:11.000Z'),
  };
}

function buildService(initial: RoomStatus, updateCalls: RoomStatus[] = []) {
  let current = initial;

  const repository: RoomsRepository = {
    async list() {
      return { items: [], total: 0 };
    },
    async findById() {
      return makeRoom(current);
    },
    async create() {
      throw new Error('create 不应在状态矩阵用例中调用');
    },
    async update() {
      throw new Error('update 不应在状态矩阵用例中调用');
    },
    async updateStatus(_id, _roomTypeId, from, to) {
      if (current !== from) {
        return { outcome: 'conflict' };
      }
      current = to;
      updateCalls.push(to);
      return { outcome: 'updated', room: makeRoom(current) };
    },
    async listAvailable(): Promise<AvailableRoomRecord[]> {
      return [];
    },
  };

  const roomTypesService = {
    async getById() {
      throw new Error('getById 不应在状态矩阵用例中调用');
    },
  } as unknown as RoomTypesService;

  return {
    service: createRoomsService({ repository, roomTypesService }),
    updateCalls,
    currentStatus: () => current,
  };
}

function isLegal(from: RoomStatus, to: RoomStatus): boolean {
  return ROOM_STATUS_MANUAL_TRANSITIONS[from].includes(to);
}

function touchesAdminOnly(from: RoomStatus, to: RoomStatus): boolean {
  return ADMIN_ONLY_ROOM_STATUSES.includes(to) || ADMIN_ONLY_ROOM_STATUSES.includes(from);
}

async function captureError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('预期抛出 ApiError，但调用成功返回');
}

describe('TC-RM-013 房态迁移矩阵穷举（service 守卫 × 角色）', () => {
  it('5×5 全排列与状态机常量完全一致（合法 8 对 / 非法 17 对）', async () => {
    let legalCount = 0;
    let illegalCount = 0;

    for (const from of ROOM_STATUSES) {
      for (const to of ROOM_STATUSES) {
        const { service, updateCalls } = buildService(from);
        const legal = isLegal(from, to);

        if (legal) {
          legalCount += 1;
          const result = await service.updateStatus(12, { status: to }, 'ADMIN');
          expect(result.status, `${from} → ${to} 应被 ADMIN 允许`).toBe(to);
          expect(updateCalls, `${from} → ${to} 应落库`).toEqual([to]);
        } else {
          illegalCount += 1;
          const error = await captureError(service.updateStatus(12, { status: to }, 'ADMIN'));
          expect(error.status, `${from} → ${to} 非法迁移应为 409`).toBe(409);
          expect(error.code, `${from} → ${to} 非法迁移错误码`).toBe('ROOM_STATUS_INVALID');
          expect(updateCalls, `${from} → ${to} 非法迁移不得落库`).toEqual([]);
        }
      }
    }

    expect(legalCount).toBe(8);
    expect(illegalCount).toBe(17);
  });

  it('RECEPTIONIST：仅 VACANT_DIRTY → VACANT_CLEAN 允许，其余合法迁移一律 403', async () => {
    let allowed = 0;
    let forbidden = 0;

    for (const from of ROOM_STATUSES) {
      for (const to of ROOM_STATUSES) {
        if (!isLegal(from, to)) continue;

        const { service, updateCalls } = buildService(from);
        if (touchesAdminOnly(from, to)) {
          forbidden += 1;
          const error = await captureError(
            service.updateStatus(12, { status: to }, 'RECEPTIONIST'),
          );
          expect(error.status, `${from} → ${to} 应为 403`).toBe(403);
          expect(error.code).toBe('FORBIDDEN');
          expect(updateCalls, `${from} → ${to} 前台操作不得落库`).toEqual([]);
        } else {
          allowed += 1;
          const result = await service.updateStatus(12, { status: to }, 'RECEPTIONIST');
          expect(result.status).toBe(to);
          expect(updateCalls).toEqual([to]);
        }
      }
    }

    expect(allowed).toBe(1);
    expect(forbidden).toBe(7);
  });

  it('OCCUPIED 无任何人工迁移（含设置为 OCCUPIED 的尝试）', async () => {
    for (const to of ROOM_STATUSES) {
      const from = 'OCCUPIED';
      if (isLegal(from, to)) continue;

      const { service, updateCalls } = buildService(from);
      const error = await captureError(service.updateStatus(12, { status: to }, 'ADMIN'));
      expect(error.status).toBe(409);
      expect(error.code).toBe('ROOM_STATUS_INVALID');
      expect(updateCalls).toEqual([]);
    }

    for (const from of ROOM_STATUSES) {
      const { service, updateCalls } = buildService(from);
      const error = await captureError(service.updateStatus(12, { status: 'OCCUPIED' }, 'ADMIN'));
      expect(error.status, `${from} → OCCUPIED 必须 409`).toBe(409);
      expect(error.code).toBe('ROOM_STATUS_INVALID');
      expect(updateCalls).toEqual([]);
    }
  });
});
