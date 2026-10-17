import type {
  AvailableRoomDto,
  CreateRoomRequest,
  Paginated,
  RoomDto,
  RoomStatus,
  UpdateRoomRequest,
  UpdateRoomStatusRequest,
} from '@hms/shared';

import { get, patch, post } from './request';

export interface RoomListQuery {
  page: number;
  pageSize: number;
  status?: RoomStatus;
  roomTypeId?: number;
  /** 房号前缀筛选（契约增量参数） */
  roomNumber?: string;
  sort?: string;
}

function toListParams(query: RoomListQuery): Record<string, unknown> {
  return {
    page: query.page,
    pageSize: query.pageSize,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.roomTypeId === undefined ? {} : { roomTypeId: query.roomTypeId }),
    ...(query.roomNumber === undefined || query.roomNumber === ''
      ? {}
      : { roomNumber: query.roomNumber }),
    ...(query.sort === undefined || query.sort === '' ? {} : { sort: query.sort }),
  };
}

/** M1 客房列表（分页、筛选、排序白名单见契约） */
export function listRooms(query: RoomListQuery): Promise<Paginated<RoomDto>> {
  return get<Paginated<RoomDto>>('/rooms', toListParams(query), { silent: true });
}

/** M6 客房详情 */
export function getRoom(id: number): Promise<RoomDto> {
  return get<RoomDto>(`/rooms/${id}`, undefined, { silent: true });
}

export interface AvailableRoomListQuery {
  roomTypeId: number;
  checkInDate: string;
  checkOutDate: string;
}

export interface AvailableRoomListResponse {
  items: AvailableRoomDto[];
}

/** M2 指定房型与日期区间的可分配房间 */
export function listAvailableRooms(
  query: AvailableRoomListQuery,
): Promise<AvailableRoomListResponse> {
  return get<AvailableRoomListResponse>(
    '/rooms/available',
    {
      roomTypeId: query.roomTypeId,
      checkInDate: query.checkInDate,
      checkOutDate: query.checkOutDate,
    },
    { silent: true },
  );
}

/** M3 创建客房（ADMIN） */
export function createRoom(payload: CreateRoomRequest): Promise<RoomDto> {
  return post<RoomDto>('/rooms', payload);
}

/** M4 更新客房（ADMIN；在住房仅允许 note） */
export function updateRoom(id: number, payload: UpdateRoomRequest): Promise<RoomDto> {
  return patch<RoomDto>(`/rooms/${id}`, payload);
}

/** M5 房态变更（状态机与 ADMIN 限制由后端裁决） */
export function updateRoomStatus(id: number, payload: UpdateRoomStatusRequest): Promise<RoomDto> {
  return patch<RoomDto>(`/rooms/${id}/status`, payload);
}
