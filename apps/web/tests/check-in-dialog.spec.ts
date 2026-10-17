import type { AvailableRoomDto, BookingDetailDto, StayDto } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus, { ElMessageBox } from 'element-plus';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/bookings', () => ({
  getBooking: vi.fn(),
  listBookings: vi.fn(),
  createBooking: vi.fn(),
  cancelBooking: vi.fn(),
  markBookingNoShow: vi.fn(),
}));

vi.mock('../src/api/rooms', () => ({
  listAvailableRooms: vi.fn(),
  listRooms: vi.fn(),
  getRoom: vi.fn(),
  createRoom: vi.fn(),
  updateRoom: vi.fn(),
  updateRoomStatus: vi.fn(),
}));

vi.mock('../src/api/stays', () => ({
  checkInBooking: vi.fn(),
  getStay: vi.fn(),
  listStays: vi.fn(),
  checkoutStay: vi.fn(),
}));

import * as bookingApi from '../src/api/bookings';
import * as roomApi from '../src/api/rooms';
import * as stayApi from '../src/api/stays';
import { hotelToday } from '../src/utils/hotel-date';
import CheckInDialog from '../src/views/stays/CheckInDialog.vue';

const mockedGetBooking = vi.mocked(bookingApi.getBooking);
const mockedListAvailable = vi.mocked(roomApi.listAvailableRooms);
const mockedCheckIn = vi.mocked(stayApi.checkInBooking);

function d(offset: number): string {
  const today = new Date(`${hotelToday()}T00:00:00.000Z`);
  return new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

function makeBooking(overrides: Partial<BookingDetailDto> = {}): BookingDetailDto {
  return {
    id: 301,
    guestId: 9,
    guestName: '张三',
    guestPhone: '13800138000',
    roomTypeId: 1,
    roomTypeName: '标准大床房',
    checkInDate: d(0),
    checkOutDate: d(2),
    roomCount: 1,
    pricePerNight: 288,
    totalPrice: 576,
    status: 'CONFIRMED',
    note: null,
    createdAt: '2026-10-15T06:00:00.000Z',
    updatedAt: '2026-10-15T06:00:00.000Z',
    stayId: null,
    cancelledAt: null,
    cancelReason: null,
    ...overrides,
  };
}

const availableRooms: AvailableRoomDto[] = [
  { id: 12, roomNumber: '0821', status: 'VACANT_CLEAN' },
  { id: 13, roomNumber: '0822', status: 'VACANT_DIRTY' },
];

const ElSelectStub = defineComponent({
  name: 'ElSelectStub',
  props: { modelValue: { type: [String, Number], default: undefined } },
  emits: ['update:modelValue', 'change'],
  template: '<div class="el-select-stub"><slot /></div>',
});

async function mountDialog() {
  const wrapper = mount(CheckInDialog, {
    props: { modelValue: false, bookingId: 301 },
    global: {
      plugins: [ElementPlus],
      stubs: { teleport: true, ElSelect: ElSelectStub, ElOption: true },
    },
  });
  await wrapper.setProps({ modelValue: true });
  await flushPromises();
  return wrapper;
}

function findButton(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(text));
}

describe('TC-UI-003 CheckInDialog 可用房加载与入住提交', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListAvailable.mockResolvedValue({ items: availableRooms } as never);
  });

  it('打开对话框按房型与入住区间加载可用房', async () => {
    mockedGetBooking.mockResolvedValue(makeBooking());
    const wrapper = await mountDialog();

    expect(mockedGetBooking).toHaveBeenCalledWith(301);
    expect(mockedListAvailable).toHaveBeenCalledWith({
      roomTypeId: 1,
      checkInDate: d(0),
      checkOutDate: d(2),
    });
    expect(wrapper.text()).toContain('张三');
    expect(wrapper.text()).toContain('标准大床房');
    expect(wrapper.text()).not.toContain('未到入住日');
    expect(findButton(wrapper, '确认入住')?.attributes('disabled')).toBeUndefined();
  });

  it('未到入住日的预订不请求可用房且禁止提交', async () => {
    mockedGetBooking.mockResolvedValue(makeBooking({ checkInDate: d(2), checkOutDate: d(4) }));
    const wrapper = await mountDialog();

    expect(mockedListAvailable).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('未到入住日，暂不可办理入住');
    expect(findButton(wrapper, '确认入住')?.attributes('disabled')).toBeDefined();
  });

  it('选择房间后提交：仅发送 roomId（价格由服务端按预订快照），成功后通知父组件', async () => {
    mockedGetBooking.mockResolvedValue(makeBooking());
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    const stay = {
      id: 501,
      bookingId: 301,
      guestId: 9,
      guestName: '张三',
      roomId: 12,
      roomNumber: '0821',
      roomTypeId: 1,
      roomTypeName: '标准大床房',
      pricePerNight: 288,
      checkInAt: '2026-10-17T06:00:00.000Z',
      expectedCheckOutDate: d(2),
      depositAmount: 0,
      status: 'CHECKED_IN',
      note: null,
      createdAt: '2026-10-17T06:00:00.000Z',
      updatedAt: '2026-10-17T06:00:00.000Z',
    } satisfies StayDto;
    mockedCheckIn.mockResolvedValue(stay);

    const wrapper = await mountDialog();
    const select = wrapper.findComponent(ElSelectStub);
    expect(select.exists()).toBe(true);
    select.vm.$emit('update:modelValue', 12);
    await flushPromises();

    findButton(wrapper, '确认入住')?.trigger('click');
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mockedCheckIn).toHaveBeenCalledTimes(1);
    expect(mockedCheckIn).toHaveBeenCalledWith(301, { roomId: 12 });
    expect(wrapper.emitted('checked-in')).toEqual([[501]]);
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false]);

    confirmSpy.mockRestore();
  });
});
