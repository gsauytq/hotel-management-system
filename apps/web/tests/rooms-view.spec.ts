import type { RoomDto, RoomTypeDto } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/rooms', () => ({
  listRooms: vi.fn(),
  getRoom: vi.fn(),
  createRoom: vi.fn(),
  updateRoom: vi.fn(),
  updateRoomStatus: vi.fn(),
}));

vi.mock('../src/api/room-types', () => ({
  listRoomTypes: vi.fn(),
  getRoomType: vi.fn(),
  createRoomType: vi.fn(),
  updateRoomType: vi.fn(),
  archiveRoomType: vi.fn(),
}));

import * as roomApi from '../src/api/rooms';
import * as roomTypeApi from '../src/api/room-types';
import { vPermission } from '../src/directives/permission';
import { useAuthStore } from '../src/stores/auth';
import { ApiRequestError } from '../src/utils/errors';
import RoomsView from '../src/views/rooms/RoomsView.vue';

const mockedListRooms = vi.mocked(roomApi.listRooms);
const mockedListRoomTypes = vi.mocked(roomTypeApi.listRoomTypes);

const roomType: RoomTypeDto = {
  id: 1,
  code: 'STD',
  name: '标准大床房',
  basePrice: 288,
  capacity: 2,
  description: null,
  status: 'ACTIVE',
  roomCount: 2,
  createdAt: '2026-10-01T02:00:00.000Z',
  updatedAt: '2026-10-01T02:00:00.000Z',
};

const rooms: RoomDto[] = [
  {
    id: 1,
    roomNumber: '0801',
    roomTypeId: 1,
    roomTypeName: '标准大床房',
    status: 'VACANT_DIRTY',
    note: '无窗房',
    currentStay: null,
    createdAt: '2026-10-01T02:00:00.000Z',
    updatedAt: '2026-10-01T02:00:00.000Z',
  },
  {
    id: 2,
    roomNumber: '0802',
    roomTypeId: 1,
    roomTypeName: '标准大床房',
    status: 'OCCUPIED',
    note: null,
    currentStay: {
      stayId: 10,
      guestName: '张三',
      checkInAt: '2026-10-14T06:00:00.000Z',
      expectedCheckOutDate: '2026-10-16',
    },
    createdAt: '2026-10-01T02:00:00.000Z',
    updatedAt: '2026-10-14T06:00:00.000Z',
  },
];

async function mountView(role: 'ADMIN' | 'RECEPTIONIST') {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore();
  authStore.user = {
    id: role === 'ADMIN' ? 1 : 2,
    username: role === 'ADMIN' ? 'admin' : 'front01',
    displayName: role === 'ADMIN' ? '管理员' : '前台',
    role,
  };
  authStore.booted = true;

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/rooms',
        name: 'rooms',
        component: RoomsView,
        meta: { title: '房态看板', description: '查看客房并执行房态操作。' },
      },
    ],
  });
  await router.push('/rooms');
  await router.isReady();

  const wrapper = mount(RoomsView, {
    global: {
      plugins: [pinia, router, ElementPlus],
      directives: { permission: vPermission },
    },
  });
  await flushPromises();
  return wrapper;
}

function createButton(wrapper: Awaited<ReturnType<typeof mountView>>) {
  return wrapper.findAll('button').find((button) => button.text().includes('新建客房'));
}

describe('RoomsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListRoomTypes.mockResolvedValue({ items: [roomType] });
    mockedListRooms.mockResolvedValue({
      items: rooms,
      pagination: { page: 1, pageSize: 10, total: 2, totalPages: 1 },
    });
  });

  it('按契约参数加载客房并展示房态与在住摘要', async () => {
    const wrapper = await mountView('RECEPTIONIST');

    expect(mockedListRooms).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      sort: 'roomNumber:asc',
    });
    expect(wrapper.text()).toContain('0801');
    expect(wrapper.text()).toContain('空闲 · 待清洁');
    expect(wrapper.text()).toContain('在住');
    expect(wrapper.text()).toContain('张三');
    expect(wrapper.text()).toContain('2026-10-16 离店');
    expect(wrapper.text()).toContain('共 2 间');
  });

  it('RECEPTIONIST 不显示新建与编辑操作入口', async () => {
    const wrapper = await mountView('RECEPTIONIST');

    expect(createButton(wrapper)?.attributes('style')).toContain('display: none');
    const editButton = wrapper.findAll('button').find((button) => button.text() === '编辑');
    expect(editButton?.attributes('style')).toContain('display: none');
  });

  it('ADMIN 显示新建与编辑操作入口', async () => {
    const wrapper = await mountView('ADMIN');

    expect(createButton(wrapper)?.attributes('style') ?? '').not.toContain('display: none');
    const editButton = wrapper.findAll('button').find((button) => button.text() === '编辑');
    expect(editButton?.attributes('style') ?? '').not.toContain('display: none');
  });

  it('无数据显示空状态', async () => {
    mockedListRooms.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    });
    const wrapper = await mountView('ADMIN');

    expect(wrapper.text()).toContain('暂无客房数据');
  });

  it('加载失败显示错误并可重试', async () => {
    mockedListRooms.mockRejectedValueOnce(
      new ApiRequestError({ status: 500, message: '服务器内部错误', requestId: 'req-rooms' }),
    );
    const wrapper = await mountView('ADMIN');

    expect(wrapper.text()).toContain('客房列表加载失败');
    expect(wrapper.text()).toContain('服务器内部错误');

    mockedListRooms.mockResolvedValueOnce({
      items: rooms,
      pagination: { page: 1, pageSize: 10, total: 2, totalPages: 1 },
    });
    await wrapper.find('.el-result button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('0801');
    expect(wrapper.text()).not.toContain('客房列表加载失败');
  });
});
