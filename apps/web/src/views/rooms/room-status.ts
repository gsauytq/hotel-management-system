import {
  ADMIN_ONLY_ROOM_STATUSES,
  ROOM_STATUS_MANUAL_TRANSITIONS,
  type Role,
  type RoomStatus,
} from '@hms/shared';

import { ROOM_STATUS_ACTION_LABELS } from '@/constants/rooms';

export interface RoomStatusAction {
  to: RoomStatus;
  label: string;
  requiresConfirm: boolean;
}

/**
 * 根据共享状态机常量与角色生成可显示的房态操作入口。
 * 后端仍会独立校验迁移合法性与 ADMIN 限制（architecture §2.9）。
 */
export function getRoomStatusActions(
  from: RoomStatus,
  role: Role | null | undefined,
): RoomStatusAction[] {
  return ROOM_STATUS_MANUAL_TRANSITIONS[from]
    .filter((to) => {
      const touchesAdminOnly =
        ADMIN_ONLY_ROOM_STATUSES.includes(to) || ADMIN_ONLY_ROOM_STATUSES.includes(from);
      return !touchesAdminOnly || role === 'ADMIN';
    })
    .map((to) => ({
      to,
      label: ROOM_STATUS_ACTION_LABELS[to],
      requiresConfirm: to === 'MAINTENANCE' || to === 'DISABLED',
    }));
}
