import type {
  CreateGuestRequest,
  GuestDetailDto,
  GuestDto,
  Paginated,
  UpdateGuestRequest,
} from '@hms/shared';

import { get, patch, post } from './request';

export interface GuestListQuery {
  page: number;
  pageSize: number;
  keyword?: string;
  phone?: string;
  sort?: string;
}

function toGuestListParams(query: GuestListQuery): Record<string, unknown> {
  return {
    page: query.page,
    pageSize: query.pageSize,
    ...(query.keyword === undefined || query.keyword === '' ? {} : { keyword: query.keyword }),
    ...(query.phone === undefined || query.phone === '' ? {} : { phone: query.phone }),
    ...(query.sort === undefined || query.sort === '' ? {} : { sort: query.sort }),
  };
}

/** G1 客人列表（登录角色） */
export function listGuests(query: GuestListQuery): Promise<Paginated<GuestDto>> {
  return get<Paginated<GuestDto>>('/guests', toGuestListParams(query), { silent: true });
}

/** G3 客人详情（证件号掩码 + 最近预订摘要） */
export function getGuest(id: number): Promise<GuestDetailDto> {
  return get<GuestDetailDto>(`/guests/${id}`, undefined, { silent: true });
}

/** G2 创建客人（证件号 AES-GCM 加密存储） */
export function createGuest(payload: CreateGuestRequest): Promise<GuestDto> {
  return post<GuestDto>('/guests', payload, { silent: true });
}

/** G4 更新客人（证件号不可修改） */
export function updateGuest(id: number, payload: UpdateGuestRequest): Promise<GuestDto> {
  return patch<GuestDto>(`/guests/${id}`, payload, { silent: true });
}
