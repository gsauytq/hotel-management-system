import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/bookings', () => ({
  listBookings: vi.fn(),
  getBooking: vi.fn(),
  createBooking: vi.fn(),
  cancelBooking: vi.fn(),
  markBookingNoShow: vi.fn(),
}));

vi.mock('../src/api/room-types', () => ({
  listRoomTypes: vi.fn().mockResolvedValue({ items: [] }),
  getRoomType: vi.fn(),
  createRoomType: vi.fn(),
  updateRoomType: vi.fn(),
  archiveRoomType: vi.fn(),
}));

vi.mock('../src/api/guests', () => ({
  listGuests: vi.fn().mockResolvedValue({
    items: [],
    pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
  }),
}));

import * as bookingApi from '../src/api/bookings';
import BookingCreateDialog from '../src/views/bookings/BookingCreateDialog.vue';

const mockedCreateBooking = vi.mocked(bookingApi.createBooking);

describe('BookingCreateDialog 表单校验', () => {
  it('空表单阻止提交且不调用创建接口', async () => {
    const wrapper = mount(BookingCreateDialog, {
      props: { modelValue: true },
      global: {
        plugins: [ElementPlus],
        stubs: {
          teleport: true,
          GuestPicker: true,
          ElSelect: { template: '<div><slot /></div>' },
          ElOption: { template: '<div />' },
          ElDatePicker: true,
        },
      },
    });
    await flushPromises();

    const submit = wrapper.findAll('button').find((button) => button.text().includes('创建预订'));
    await submit?.trigger('click');
    await flushPromises();

    expect(mockedCreateBooking).not.toHaveBeenCalled();
  });
});
