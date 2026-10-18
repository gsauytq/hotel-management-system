import type { RoomTypeDto } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/room-types', () => ({
  listRoomTypes: vi.fn(),
  getRoomType: vi.fn(),
  createRoomType: vi.fn(),
  updateRoomType: vi.fn(),
  archiveRoomType: vi.fn(),
}));

import * as roomTypeApi from '../src/api/room-types';
import { vPermission } from '../src/directives/permission';
import { useAuthStore } from '../src/stores/auth';
import { ApiRequestError } from '../src/utils/errors';
import RoomTypesView from '../src/views/room-types/RoomTypesView.vue';

const mockedListRoomTypes = vi.mocked(roomTypeApi.listRoomTypes);

const roomTypes: RoomTypeDto[] = [
  {
    id: 1,
    code: 'STD',
    name: '标准大床房',
    basePrice: 288,
    capacity: 2,
    description: '高层城景',
    status: 'ACTIVE',
    roomCount: 5,
    createdAt: '2026-10-01T02:00:00.000Z',
    updatedAt: '2026-10-01T02:00:00.000Z',
  },
  {
    id: 2,
    code: 'OLD',
    name: '旧房型',
    basePrice: 199,
    capacity: 1,
    description: null,
    status: 'ARCHIVED',
    roomCount: 0,
    createdAt: '2026-09-01T02:00:00.000Z',
    updatedAt: '2026-09-02T02:00:00.000Z',
  },
];

async function mountView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore();
  authStore.user = {
    id: 1,
    username: 'admin',
    displayName: '管理员',
    role: 'ADMIN',
    mustChangePassword: false,
  };
  authStore.booted = true;

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/room-types',
        name: 'room-types',
        component: RoomTypesView,
        meta: { title: '房型管理', description: '维护房型、基准价格与归档状态。' },
      },
    ],
  });
  await router.push('/room-types');
  await router.isReady();

  const wrapper = mount(RoomTypesView, {
    global: {
      plugins: [pinia, router, ElementPlus],
      directives: { permission: vPermission },
    },
  });
  await flushPromises();
  return wrapper;
}

describe('RoomTypesView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('加载并展示真实接口返回的房型与状态', async () => {
    mockedListRoomTypes.mockResolvedValue({ items: roomTypes });
    const wrapper = await mountView();

    expect(mockedListRoomTypes).toHaveBeenCalledWith({});
    expect(wrapper.text()).toContain('标准大床房');
    expect(wrapper.text()).toContain('STD');
    expect(wrapper.text()).toContain('启用');
    expect(wrapper.text()).toContain('已归档');
    expect(wrapper.text()).toContain('共 2 个房型');
  });

  it('无数据显示空状态', async () => {
    mockedListRoomTypes.mockResolvedValue({ items: [] });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('暂无房型数据');
  });

  it('加载失败显示错误并可重试', async () => {
    mockedListRoomTypes.mockRejectedValueOnce(
      new ApiRequestError({ status: 500, message: '服务器内部错误', requestId: 'req-view' }),
    );
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('房型列表加载失败');
    expect(wrapper.text()).toContain('服务器内部错误');

    mockedListRoomTypes.mockResolvedValueOnce({ items: roomTypes });
    await wrapper.find('.el-result button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('标准大床房');
    expect(wrapper.text()).not.toContain('房型列表加载失败');
  });
});
