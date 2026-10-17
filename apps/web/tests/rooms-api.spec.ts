import {
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import {
  archiveRoomType,
  createRoomType,
  getRoomType,
  listRoomTypes,
  updateRoomType,
} from '../src/api/room-types';
import { createRoom, getRoom, listRooms, updateRoom, updateRoomStatus } from '../src/api/rooms';
import { http } from '../src/api/request';

const originalAdapter = http.defaults.adapter;

function installReply(payload: unknown): InternalAxiosRequestConfig[] {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const response: AxiosResponse = {
      data: { data: payload },
      status: 200,
      statusText: 'OK',
      headers: new AxiosHeaders(),
      config,
    };
    return response;
  };
  http.defaults.adapter = adapter;
  return calls;
}

function sentBody(config: InternalAxiosRequestConfig | undefined): unknown {
  if (config?.data === undefined) return undefined;
  if (typeof config.data === 'string') return JSON.parse(config.data) as unknown;
  return config.data;
}

describe('房型 API 调用契约', () => {
  afterEach(() => {
    http.defaults.adapter = originalAdapter;
  });

  it('列表只发送 status；详情/创建/更新/归档路径与方法正确', async () => {
    let calls = installReply({ items: [] });
    await listRoomTypes({ status: 'ACTIVE' });
    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/room-types');
    expect(calls[0]?.params).toEqual({ status: 'ACTIVE' });

    calls = installReply({ items: [] });
    await listRoomTypes();
    expect(calls[0]?.params).toEqual({});

    calls = installReply({ id: 1 });
    await getRoomType(1);
    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/room-types/1');

    const createPayload = {
      code: 'DLX',
      name: '豪华大床房',
      basePrice: 388,
      capacity: 2,
      description: '高层城景',
    };
    calls = installReply({ id: 1 });
    await createRoomType(createPayload);
    expect(calls[0]?.method).toBe('post');
    expect(calls[0]?.url).toBe('/room-types');
    expect(sentBody(calls[0])).toEqual(createPayload);

    calls = installReply({ id: 1 });
    await updateRoomType(1, { name: '豪华大床房（翻新）', basePrice: 428 });
    expect(calls[0]?.method).toBe('patch');
    expect(calls[0]?.url).toBe('/room-types/1');
    expect(sentBody(calls[0])).toEqual({ name: '豪华大床房（翻新）', basePrice: 428 });

    calls = installReply({ id: 1 });
    await archiveRoomType(1);
    expect(calls[0]?.method).toBe('post');
    expect(calls[0]?.url).toBe('/room-types/1/archive');
  });
});

describe('客房 API 调用契约', () => {
  afterEach(() => {
    http.defaults.adapter = originalAdapter;
  });

  it('列表发送 page/pageSize/筛选/sort，并省略空条件', async () => {
    let calls = installReply({
      items: [],
      pagination: { page: 2, pageSize: 20, total: 0, totalPages: 0 },
    });
    await listRooms({
      page: 2,
      pageSize: 20,
      status: 'VACANT_DIRTY',
      roomTypeId: 3,
      roomNumber: '08',
      sort: 'roomNumber:asc',
    });
    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/rooms');
    expect(calls[0]?.params).toEqual({
      page: 2,
      pageSize: 20,
      status: 'VACANT_DIRTY',
      roomTypeId: 3,
      roomNumber: '08',
      sort: 'roomNumber:asc',
    });

    calls = installReply({
      items: [],
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    });
    await listRooms({ page: 1, pageSize: 10, roomNumber: '' });
    expect(calls[0]?.params).toEqual({ page: 1, pageSize: 10 });
  });

  it('详情/创建/更新/房态变更路径与方法正确', async () => {
    let calls = installReply({ id: 5 });
    await getRoom(5);
    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/rooms/5');

    const createPayload = { roomNumber: '0821', roomTypeId: 1, note: '无窗房' };
    calls = installReply({ id: 5 });
    await createRoom(createPayload);
    expect(calls[0]?.method).toBe('post');
    expect(calls[0]?.url).toBe('/rooms');
    expect(sentBody(calls[0])).toEqual(createPayload);

    calls = installReply({ id: 5 });
    await updateRoom(5, { roomNumber: '0822', note: '已装新风' });
    expect(calls[0]?.method).toBe('patch');
    expect(calls[0]?.url).toBe('/rooms/5');
    expect(sentBody(calls[0])).toEqual({ roomNumber: '0822', note: '已装新风' });

    calls = installReply({ id: 5 });
    await updateRoomStatus(5, { status: 'VACANT_CLEAN' });
    expect(calls[0]?.method).toBe('patch');
    expect(calls[0]?.url).toBe('/rooms/5/status');
    expect(sentBody(calls[0])).toEqual({ status: 'VACANT_CLEAN' });
  });
});
