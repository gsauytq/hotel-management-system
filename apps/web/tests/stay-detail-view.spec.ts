import type { StayDetailDto } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/stays', () => ({
  listStays: vi.fn(),
  getStay: vi.fn(),
  checkInBooking: vi.fn(),
  checkoutStay: vi.fn(),
}));

vi.mock('../src/api/orders', () => ({
  getOrder: vi.fn(),
}));

vi.mock('../src/api/bookings', () => ({
  listBookings: vi.fn(),
  getBooking: vi.fn(),
  createBooking: vi.fn(),
  cancelBooking: vi.fn(),
  markBookingNoShow: vi.fn(),
}));

vi.mock('../src/api/rooms', () => ({
  listRooms: vi.fn(),
  getRoom: vi.fn(),
  createRoom: vi.fn(),
  updateRoom: vi.fn(),
  updateRoomStatus: vi.fn(),
  listAvailableRooms: vi.fn(),
}));

import * as stayApi from '../src/api/stays';
import { ApiRequestError } from '../src/utils/errors';
import StayDetailView from '../src/views/stays/StayDetailView.vue';

const mockedGetStay = vi.mocked(stayApi.getStay);

const stay: StayDetailDto = {
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
  actualCheckOutAt: null,
  currentCharges: { roomFee: 576, miscTotal: 0, total: 576, nights: 2 },
  order: null,
};

async function mountView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/stays', name: 'stays', component: { template: '<div />' } },
      {
        path: '/stays/:id',
        name: 'stay-detail',
        component: StayDetailView,
        meta: { title: '入住详情' },
      },
    ],
  });
  await router.push('/stays/501');
  await router.isReady();

  const wrapper = mount(StayDetailView, {
    global: { plugins: [pinia, router, ElementPlus] },
  });
  await flushPromises();
  return wrapper;
}

function findButton(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(text));
}

describe('StayDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('展示服务端入住、费用与状态，并提供退房入口', async () => {
    mockedGetStay.mockResolvedValue(stay);
    const wrapper = await mountView();

    expect(mockedGetStay).toHaveBeenCalledWith(501);
    expect(wrapper.text()).toContain('张三');
    expect(wrapper.text()).toContain('0821');
    expect(wrapper.text()).toContain('在住');
    expect(wrapper.text()).toContain('2');
    expect(wrapper.text()).toContain('576.00');
    expect(findButton(wrapper, '退房结算')).toBeDefined();
  });

  it('已退房记录展示账单摘要且不显示退房入口', async () => {
    mockedGetStay.mockResolvedValue({
      ...stay,
      status: 'CHECKED_OUT',
      actualCheckOutAt: '2026-10-17T06:00:00.000Z',
      currentCharges: { roomFee: 576, miscTotal: 38, total: 614, nights: 2 },
      order: {
        id: 900,
        stayId: 501,
        guestName: '张三',
        roomNumber: '0821',
        totalAmount: 614,
        paidAmount: 414,
        paymentMethod: 'WECHAT',
        status: 'PAID',
        createdAt: '2026-10-17T06:00:00.000Z',
      },
    });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('已退房');
    expect(wrapper.text()).toContain('账单摘要');
    expect(wrapper.text()).toContain('#900');
    expect(wrapper.text()).toContain('414.00');
    expect(findButton(wrapper, '退房结算')).toBeUndefined();
  });

  it('详情加载失败显示错误并可重试', async () => {
    mockedGetStay.mockRejectedValueOnce(
      new ApiRequestError({ status: 404, code: 'NOT_FOUND', message: '入住记录不存在' }),
    );
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('入住详情加载失败');
    expect(wrapper.text()).toContain('入住记录不存在');

    mockedGetStay.mockResolvedValueOnce(stay);
    await wrapper.find('.el-result button:last-child').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('张三');
  });
});
