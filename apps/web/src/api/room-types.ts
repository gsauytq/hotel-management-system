import type {
  CreateRoomTypeRequest,
  RoomTypeDto,
  RoomTypeStatus,
  UpdateRoomTypeRequest,
} from '@hms/shared';

import { get, patch, post } from './request';

export interface RoomTypeListQuery {
  status?: RoomTypeStatus;
}

export interface RoomTypeListResponse {
  items: RoomTypeDto[];
}

function toListParams(query: RoomTypeListQuery): Record<string, unknown> {
  return query.status === undefined ? {} : { status: query.status };
}

/** R1 房型列表：契约不支持分页/排序参数，页面分页在客户端完成 */
export function listRoomTypes(query: RoomTypeListQuery = {}): Promise<RoomTypeListResponse> {
  return get<RoomTypeListResponse>('/room-types', toListParams(query), { silent: true });
}

/** R5 房型详情 */
export function getRoomType(id: number): Promise<RoomTypeDto> {
  return get<RoomTypeDto>(`/room-types/${id}`, undefined, { silent: true });
}

/** R2 创建房型（ADMIN） */
export function createRoomType(payload: CreateRoomTypeRequest): Promise<RoomTypeDto> {
  return post<RoomTypeDto>('/room-types', payload);
}

/** R3 更新房型（ADMIN；code 不可修改） */
export function updateRoomType(id: number, payload: UpdateRoomTypeRequest): Promise<RoomTypeDto> {
  return patch<RoomTypeDto>(`/room-types/${id}`, payload);
}

/** R4 归档房型（ADMIN；后端校验未完结预订/在住） */
export function archiveRoomType(id: number): Promise<RoomTypeDto> {
  return post<RoomTypeDto>(`/room-types/${id}/archive`);
}
