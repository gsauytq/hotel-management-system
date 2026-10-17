import { describe, expect, it } from 'vitest';

import { getRoomStatusActions } from '../src/views/rooms/room-status';

function targets(from: Parameters<typeof getRoomStatusActions>[0], role: 'ADMIN' | 'RECEPTIONIST') {
  return getRoomStatusActions(from, role).map((action) => action.to);
}

describe('getRoomStatusActions', () => {
  it('RECEPTIONIST 仅能执行 VACANT_DIRTY → VACANT_CLEAN', () => {
    expect(targets('VACANT_DIRTY', 'RECEPTIONIST')).toEqual(['VACANT_CLEAN']);
    expect(targets('VACANT_CLEAN', 'RECEPTIONIST')).toEqual([]);
    expect(targets('MAINTENANCE', 'RECEPTIONIST')).toEqual([]);
    expect(targets('DISABLED', 'RECEPTIONIST')).toEqual([]);
  });

  it('ADMIN 可执行共享状态机中的全部人工迁移', () => {
    expect(targets('VACANT_CLEAN', 'ADMIN')).toEqual(['MAINTENANCE', 'DISABLED']);
    expect(targets('VACANT_DIRTY', 'ADMIN')).toEqual(['VACANT_CLEAN', 'MAINTENANCE', 'DISABLED']);
    expect(targets('MAINTENANCE', 'ADMIN')).toEqual(['VACANT_DIRTY', 'DISABLED']);
    expect(targets('DISABLED', 'ADMIN')).toEqual(['VACANT_DIRTY']);
  });

  it('OCCUPIED 不提供人工房态操作', () => {
    expect(targets('OCCUPIED', 'ADMIN')).toEqual([]);
    expect(targets('OCCUPIED', 'RECEPTIONIST')).toEqual([]);
  });

  it('停用与维修操作需要二次确认', () => {
    const actions = getRoomStatusActions('VACANT_CLEAN', 'ADMIN');

    expect(actions.find((action) => action.to === 'MAINTENANCE')?.requiresConfirm).toBe(true);
    expect(actions.find((action) => action.to === 'DISABLED')?.requiresConfirm).toBe(true);
    expect(getRoomStatusActions('VACANT_DIRTY', 'RECEPTIONIST')[0]?.requiresConfirm).toBe(false);
  });
});
