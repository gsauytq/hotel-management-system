import type { GuestDto } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/guests', () => ({
  listGuests: vi.fn(),
  getGuest: vi.fn(),
  createGuest: vi.fn(),
  updateGuest: vi.fn(),
}));

import * as guestApi from '../src/api/guests';
import { ApiRequestError } from '../src/utils/errors';
import GuestsView from '../src/views/guests/GuestsView.vue';

const mockedListGuests = vi.mocked(guestApi.listGuests);

const guest: GuestDto = {
  id: 9,
  name: '张三',
  phone: '13800138000',
  idType: 'ID_CARD',
  idNumberMasked: '1***********4',
  remark: 'VIP',
  createdAt: '2026-10-01T02:00:00.000Z',
};

async function mountView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/guests',
        name: 'guests',
        component: GuestsView,
        meta: { title: '客人档案', description: '客人档案管理。' },
      },
      {
        path: '/bookings/:id',
        name: 'booking-detail',
        component: { template: '<div />' },
        meta: { title: '预订详情' },
      },
    ],
  });
  await router.push('/guests');
  await router.isReady();

  const wrapper = mount(GuestsView, {
    global: { plugins: [pinia, router, ElementPlus] },
  });
  await flushPromises();
  return wrapper;
}

describe('GuestsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListGuests.mockResolvedValue({
      items: [guest],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
  });

  it('加载客人档案并仅展示证件号掩码', async () => {
    const wrapper = await mountView();

    expect(mockedListGuests).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      sort: 'createdAt:desc',
    });
    expect(wrapper.text()).toContain('张三');
    expect(wrapper.text()).toContain('身份证');
    expect(wrapper.text()).toContain('1***********4');
    expect(wrapper.text()).toContain('新建客人档案');
  });

  it('无数据显示空状态', async () => {
    mockedListGuests.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('暂无客人档案');
  });

  it('加载失败显示错误并可重试', async () => {
    mockedListGuests.mockRejectedValueOnce(
      new ApiRequestError({ status: 500, message: '服务器内部错误', requestId: 'req-guest' }),
    );
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('客人档案加载失败');
    expect(wrapper.text()).toContain('服务器内部错误');

    mockedListGuests.mockResolvedValueOnce({
      items: [guest],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
    await wrapper.find('.el-result button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('张三');
  });
});
