import type { BookingDto, StayDto } from '@hms/shared';
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

vi.mock('../src/api/stays', () => ({
  listStays: vi.fn(),
  getStay: vi.fn(),
  checkInBooking: vi.fn(),
  checkoutStay: vi.fn(),
}));

vi.mock('../src/api/orders', () => ({
  getOrder: vi.fn(),
}));

vi.mock('../src/api/rooms', () => ({
  listRooms: vi.fn(),
  getRoom: vi.fn(),
  createRoom: vi.fn(),
  updateRoom: vi.fn(),
  updateRoomStatus: vi.fn(),
  listAvailableRooms: vi.fn(),
}));

import * as bookingApi from '../src/api/bookings';
import * as stayApi from '../src/api/stays';
import { ApiRequestError } from '../src/utils/errors';
import { addDays, hotelToday } from '../src/utils/hotel-date';
import StayListView from '../src/views/stays/StayListView.vue';

const mockedListBookings = vi.mocked(bookingApi.listBookings);
const mockedListStays = vi.mocked(stayApi.listStays);

const pendingBooking: BookingDto = {
  id: 301,
  guestId: 9,
  guestName: '张三',
  guestPhone: '13800138000',
  roomTypeId: 1,
  roomTypeName: '标准大床房',
  checkInDate: '2026-10-17',
  checkOutDate: '2026-10-19',
  roomCount: 1,
  pricePerNight: 288,
  totalPrice: 576,
  status: 'CONFIRMED',
  note: null,
  createdAt: '2026-10-14T06:10:00.000Z',
  updatedAt: '2026-10-14T06:10:00.000Z',
};

const currentStay: StayDto = {
  id: 501,
  bookingId: 301,
  guestId: 9,
  guestName: '张三',
  roomId: 12,
  roomNumber: '0821',
  roomTypeId: 1,
  roomTypeName: '标准大床房',
  pricePerNight: 288,
  checkInAt: '2026-10-17T04:00:00.000Z',
  expectedCheckOutDate: '2026-10-19',
  depositAmount: 200,
  status: 'CHECKED_IN',
  note: null,
  createdAt: '2026-10-17T04:00:00.000Z',
  updatedAt: '2026-10-17T04:00:00.000Z',
};

async function mountView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/stays',
        name: 'stays',
        component: StayListView,
        meta: { title: '在住管理', description: '入住与退房。' },
      },
      {
        path: '/stays/:id',
        name: 'stay-detail',
        component: { template: '<div />' },
        meta: { title: '入住详情' },
      },
    ],
  });
  await router.push('/stays');
  await router.isReady();

  const wrapper = mount(StayListView, {
    global: { plugins: [pinia, router, ElementPlus] },
  });
  await flushPromises();
  return wrapper;
}

describe('StayListView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListBookings.mockResolvedValue({
      items: [pendingBooking],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
    mockedListStays.mockResolvedValue({
      items: [currentStay],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
  });

  it('默认加载待入住预订并展示入住入口', async () => {
    const wrapper = await mountView();

    expect(mockedListBookings).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      status: 'CONFIRMED',
      checkInDateTo: hotelToday(),
      checkOutDateFrom: addDays(hotelToday(), 1),
      sort: 'checkInDate:asc',
    });
    expect(wrapper.text()).toContain('待入住预订（1）');
    expect(wrapper.text()).toContain('张三');
    expect(wrapper.text()).toContain('办理入住');
  });

  it('加载在住记录并显示退房入口', async () => {
    const wrapper = await mountView();

    expect(mockedListStays).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      status: 'CHECKED_IN',
      sort: 'checkInAt:desc',
    });

    const stayTab = wrapper
      .findAll('.el-tabs__item')
      .find((tab) => tab.text().includes('在住 / 历史入住'));
    await stayTab?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('入住记录');
    expect(wrapper.text()).toContain('0821');
    expect(wrapper.text()).toContain('退房');
  });

  it('待入住预订加载失败显示错误并可重试', async () => {
    mockedListBookings.mockRejectedValueOnce(
      new ApiRequestError({ status: 500, message: '服务器内部错误', requestId: 'req-stay' }),
    );
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('待入住预订加载失败');
    expect(wrapper.text()).toContain('服务器内部错误');

    mockedListBookings.mockResolvedValueOnce({
      items: [pendingBooking],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
    await wrapper.find('.el-result button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('张三');
    expect(wrapper.text()).not.toContain('待入住预订加载失败');
  });
});
