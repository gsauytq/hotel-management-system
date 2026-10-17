import type { BookingDetailDto } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus, { ElMessageBox } from 'element-plus';
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

import * as bookingApi from '../src/api/bookings';
import { ApiRequestError } from '../src/utils/errors';
import { addDays, hotelToday } from '../src/utils/hotel-date';
import BookingDetailView from '../src/views/bookings/BookingDetailView.vue';

const mockedGetBooking = vi.mocked(bookingApi.getBooking);
const mockedCancelBooking = vi.mocked(bookingApi.cancelBooking);

function makeBooking(overrides: Partial<BookingDetailDto> = {}): BookingDetailDto {
  const today = hotelToday();
  return {
    id: 301,
    guestId: 9,
    guestName: '张三',
    guestPhone: '13800138000',
    roomTypeId: 1,
    roomTypeName: '标准大床房',
    checkInDate: today,
    checkOutDate: addDays(today, 2),
    roomCount: 1,
    pricePerNight: 288,
    totalPrice: 576,
    status: 'CONFIRMED',
    note: '高楼层',
    createdAt: '2026-10-14T06:10:00.000Z',
    updatedAt: '2026-10-14T06:10:00.000Z',
    stayId: null,
    cancelledAt: null,
    cancelReason: null,
    ...overrides,
  };
}

async function mountDetail() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/bookings', name: 'bookings', component: { template: '<div />' } },
      {
        path: '/bookings/:id',
        name: 'booking-detail',
        component: BookingDetailView,
        meta: { title: '预订详情' },
      },
    ],
  });
  await router.push('/bookings/301');
  await router.isReady();

  const wrapper = mount(BookingDetailView, {
    global: { plugins: [pinia, router, ElementPlus] },
  });
  await flushPromises();
  return { wrapper, router };
}

function findButton(wrapper: Awaited<ReturnType<typeof mountDetail>>['wrapper'], text: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(text));
}

describe('BookingDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('展示服务端返回的客人、价格、金额与状态', async () => {
    mockedGetBooking.mockResolvedValue(makeBooking());
    const { wrapper } = await mountDetail();

    expect(mockedGetBooking).toHaveBeenCalledWith(301);
    expect(wrapper.text()).toContain('张三');
    expect(wrapper.text()).toContain('标准大床房');
    expect(wrapper.text()).toContain('288.00');
    expect(wrapper.text()).toContain('576.00');
    expect(wrapper.text()).toContain('已确认');
    expect(findButton(wrapper, '取消预订')).toBeDefined();
    expect(findButton(wrapper, '标记未到')).toBeDefined();
  });

  it('非 CONFIRMED 状态不显示取消/未到操作', async () => {
    mockedGetBooking.mockResolvedValue(
      makeBooking({ status: 'CANCELLED', cancelledAt: '2026-10-15T02:00:00.000Z' }),
    );
    const { wrapper } = await mountDetail();

    expect(wrapper.text()).toContain('已取消');
    expect(findButton(wrapper, '取消预订')).toBeUndefined();
    expect(findButton(wrapper, '标记未到')).toBeUndefined();
  });

  it('未来入住日的 CONFIRMED 预订不显示标记未到', async () => {
    mockedGetBooking.mockResolvedValue(
      makeBooking({
        checkInDate: addDays(hotelToday(), 3),
        checkOutDate: addDays(hotelToday(), 5),
      }),
    );
    const { wrapper } = await mountDetail();

    expect(findButton(wrapper, '取消预订')).toBeDefined();
    expect(findButton(wrapper, '标记未到')).toBeUndefined();
    expect(wrapper.text()).toContain('入住日未到');
  });

  it('取消预订调用真实接口并展示服务端返回的新状态', async () => {
    mockedGetBooking.mockResolvedValue(makeBooking());
    mockedCancelBooking.mockResolvedValue(
      makeBooking({
        status: 'CANCELLED',
        cancelledAt: '2026-10-15T02:00:00.000Z',
        cancelReason: '客人行程变更',
      }),
    );
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({
      value: '客人行程变更',
      action: 'confirm',
    } as never);

    const { wrapper } = await mountDetail();
    await findButton(wrapper, '取消预订')?.trigger('click');
    await flushPromises();

    expect(mockedCancelBooking).toHaveBeenCalledWith(301, { reason: '客人行程变更' });
    expect(wrapper.text()).toContain('已取消');
    expect(wrapper.text()).toContain('客人行程变更');
    expect(findButton(wrapper, '取消预订')).toBeUndefined();
  });

  it('详情加载失败显示错误并可重试', async () => {
    mockedGetBooking.mockRejectedValueOnce(
      new ApiRequestError({ status: 404, code: 'NOT_FOUND', message: '预订不存在' }),
    );
    const { wrapper } = await mountDetail();

    expect(wrapper.text()).toContain('预订详情加载失败');
    expect(wrapper.text()).toContain('预订不存在');

    mockedGetBooking.mockResolvedValueOnce(makeBooking());
    await wrapper.find('.el-result button:last-child').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('张三');
  });
});
