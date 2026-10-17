import type { BookingDto } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/bookings', () => ({
  listBookings: vi.fn(),
  getBooking: vi.fn(),
  createBooking: vi.fn(),
  cancelBooking: vi.fn(),
  markBookingNoShow: vi.fn(),
}));

vi.mock('../src/api/room-types', () => ({
  listRoomTypes: vi.fn(),
  getRoomType: vi.fn(),
  createRoomType: vi.fn(),
  updateRoomType: vi.fn(),
  archiveRoomType: vi.fn(),
}));

vi.mock('../src/api/guests', () => ({
  listGuests: vi.fn(),
}));

import * as bookingApi from '../src/api/bookings';
import { ApiRequestError } from '../src/utils/errors';
import BookingListView from '../src/views/bookings/BookingListView.vue';

const mockedListBookings = vi.mocked(bookingApi.listBookings);

const booking: BookingDto = {
  id: 301,
  guestId: 9,
  guestName: '张三',
  guestPhone: '13800138000',
  roomTypeId: 1,
  roomTypeName: '标准大床房',
  checkInDate: '2026-10-15',
  checkOutDate: '2026-10-17',
  roomCount: 1,
  pricePerNight: 288,
  totalPrice: 576,
  status: 'CONFIRMED',
  note: null,
  createdAt: '2026-10-14T06:10:00.000Z',
  updatedAt: '2026-10-14T06:10:00.000Z',
};

async function mountView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/bookings',
        name: 'bookings',
        component: BookingListView,
        meta: { title: '预订管理', description: '查询与创建预订。' },
      },
      {
        path: '/bookings/:id',
        name: 'booking-detail',
        component: { template: '<div />' },
        meta: { title: '预订详情' },
      },
    ],
  });
  await router.push('/bookings');
  await router.isReady();

  const wrapper = mount(BookingListView, {
    global: { plugins: [pinia, router, ElementPlus] },
  });
  await flushPromises();
  return { wrapper, router };
}

describe('BookingListView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListBookings.mockResolvedValue({
      items: [booking],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
  });

  it('按契约默认参数加载并展示后端价格、状态与客人信息', async () => {
    const { wrapper } = await mountView();

    expect(mockedListBookings).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      sort: 'createdAt:desc',
    });
    expect(wrapper.text()).toContain('#301');
    expect(wrapper.text()).toContain('张三');
    expect(wrapper.text()).toContain('已确认');
    expect(wrapper.text()).toContain('288.00');
    expect(wrapper.text()).toContain('576.00');
    expect(wrapper.text()).toContain('共 1 条');
  });

  it('无数据显示空状态', async () => {
    mockedListBookings.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    });
    const { wrapper } = await mountView();

    expect(wrapper.text()).toContain('暂无预订数据');
  });

  it('加载失败显示错误并可重试', async () => {
    mockedListBookings.mockRejectedValueOnce(
      new ApiRequestError({ status: 500, message: '服务器内部错误', requestId: 'req-bk' }),
    );
    const { wrapper } = await mountView();

    expect(wrapper.text()).toContain('预订列表加载失败');
    expect(wrapper.text()).toContain('服务器内部错误');

    mockedListBookings.mockResolvedValueOnce({
      items: [booking],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
    await wrapper.find('.el-result button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('#301');
    expect(wrapper.text()).not.toContain('预订列表加载失败');
  });

  it('预订编号直达详情（列表接口无编号筛选参数）', async () => {
    const { wrapper, router } = await mountView();
    const idInput = wrapper.find('input[placeholder="预订编号"]');

    await idInput.setValue('301');
    const openButton = wrapper.findAll('button').find((button) => button.text() === '查看');
    await openButton?.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('booking-detail');
    expect(router.currentRoute.value.params['id']).toBe('301');
  });
});
