import type { AvailableRoomDto, RoomTypeDto, StayDto } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus, { ElMessageBox } from 'element-plus';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/stays', () => ({
  createWalkIn: vi.fn(),
}));

vi.mock('../src/api/room-types', () => ({
  listRoomTypes: vi.fn(),
}));

vi.mock('../src/api/rooms', () => ({
  listAvailableRooms: vi.fn(),
}));

import * as roomTypeApi from '../src/api/room-types';
import * as roomApi from '../src/api/rooms';
import * as stayApi from '../src/api/stays';
import { ApiRequestError } from '../src/utils/errors';
import { addDays, hotelToday } from '../src/utils/hotel-date';
import WalkInDialog from '../src/views/stays/WalkInDialog.vue';

const mockedCreateWalkIn = vi.mocked(stayApi.createWalkIn);
const mockedListRoomTypes = vi.mocked(roomTypeApi.listRoomTypes);
const mockedListAvailable = vi.mocked(roomApi.listAvailableRooms);

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

const availableRooms: AvailableRoomDto[] = [
  { id: 12, roomNumber: '0821', status: 'VACANT_CLEAN' },
  { id: 13, roomNumber: '0822', status: 'VACANT_DIRTY' },
];

const stay: StayDto = {
  id: 501,
  bookingId: null,
  guestId: 9,
  guestName: '张三',
  roomId: 12,
  roomNumber: '0821',
  roomTypeId: 1,
  roomTypeName: '标准大床房',
  pricePerNight: 288,
  checkInAt: '2026-10-18T04:00:00.000Z',
  expectedCheckOutDate: addDays(hotelToday(), 1),
  depositAmount: 0,
  status: 'CHECKED_IN',
  note: null,
  createdAt: '2026-10-18T04:00:00.000Z',
  updatedAt: '2026-10-18T04:00:00.000Z',
};

const ElSelectStub = defineComponent({
  name: 'ElSelectStub',
  props: { modelValue: { type: [String, Number], default: undefined } },
  emits: ['update:modelValue', 'change'],
  template: '<div class="el-select-stub"><slot /></div>',
});

const ElDatePickerStub = defineComponent({
  name: 'ElDatePickerStub',
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue', 'change'],
  template: '<div class="el-date-picker-stub" />',
});

const GuestPickerStub = defineComponent({
  name: 'GuestPickerStub',
  props: { modelValue: { type: Number, default: undefined }, disabled: Boolean },
  emits: ['update:modelValue'],
  template: '<div class="guest-picker-stub" />',
});

async function mountDialog() {
  const wrapper = mount(WalkInDialog, {
    props: { modelValue: false },
    global: {
      plugins: [ElementPlus],
      stubs: {
        teleport: true,
        ElSelect: ElSelectStub,
        ElOption: true,
        ElDatePicker: ElDatePickerStub,
        GuestPicker: GuestPickerStub,
      },
    },
  });
  await wrapper.setProps({ modelValue: true });
  await flushPromises();
  return wrapper;
}

function findButton(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(text));
}

async function selectGuest(wrapper: ReturnType<typeof mount>, guestId = 9) {
  wrapper.findComponent(GuestPickerStub).vm.$emit('update:modelValue', guestId);
  await flushPromises();
}

async function selectRoomType(wrapper: ReturnType<typeof mount>, roomTypeId = 1) {
  const selects = wrapper.findAllComponents(ElSelectStub);
  selects[0]?.vm.$emit('update:modelValue', roomTypeId);
  selects[0]?.vm.$emit('change', roomTypeId);
  await flushPromises();
}

async function selectRoom(wrapper: ReturnType<typeof mount>, roomId = 12) {
  const selects = wrapper.findAllComponents(ElSelectStub);
  selects[1]?.vm.$emit('update:modelValue', roomId);
  await flushPromises();
}

describe('WalkInDialog（S1 直接入住）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListRoomTypes.mockResolvedValue({ items: [roomType] });
    mockedListAvailable.mockResolvedValue({ items: availableRooms });
  });

  it('打开时加载启用房型，选择房型后按今日/明日加载可用房', async () => {
    const wrapper = await mountDialog();

    expect(mockedListRoomTypes).toHaveBeenCalledWith({ status: 'ACTIVE' });
    await selectRoomType(wrapper);
    expect(mockedListAvailable).toHaveBeenCalledWith({
      roomTypeId: 1,
      checkInDate: hotelToday(),
      checkOutDate: addDays(hotelToday(), 1),
    });
    expect(wrapper.text()).toContain('基准价');
  });

  it('空表单阻止提交，不调用创建接口', async () => {
    const wrapper = await mountDialog();
    findButton(wrapper, '确认入住')?.trigger('click');
    await flushPromises();

    expect(mockedCreateWalkIn).not.toHaveBeenCalled();
  });

  it('提交 S1 契约字段，成功后通知父组件并关闭', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    mockedCreateWalkIn.mockResolvedValue(stay);
    const wrapper = await mountDialog();

    await selectGuest(wrapper);
    await selectRoomType(wrapper);
    await selectRoom(wrapper);
    findButton(wrapper, '确认入住')?.trigger('click');
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mockedCreateWalkIn).toHaveBeenCalledTimes(1);
    const payload = mockedCreateWalkIn.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      guestId: 9,
      roomId: 12,
      pricePerNight: 288,
      expectedCheckOutDate: addDays(hotelToday(), 1),
    });
    expect(payload).not.toHaveProperty('roomTypeId');
    expect(payload).not.toHaveProperty('totalAmount');
    expect(wrapper.emitted('walked-in')).toEqual([[501]]);
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false]);

    confirmSpy.mockRestore();
  });

  it('409 冲突内联提示并刷新可用房', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    mockedCreateWalkIn.mockRejectedValue(
      new ApiRequestError({
        status: 409,
        code: 'ROOM_TYPE_SOLD_OUT',
        message: '该房型在所选日期区间内无可售房量',
      }),
    );
    const wrapper = await mountDialog();

    await selectGuest(wrapper);
    await selectRoomType(wrapper);
    await selectRoom(wrapper);
    findButton(wrapper, '确认入住')?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('无可售房量');
    expect(mockedListAvailable.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(wrapper.emitted('walked-in')).toBeUndefined();

    confirmSpy.mockRestore();
  });

  it('网络/超时结果不确定：禁止重复提交并请求刷新列表', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    mockedCreateWalkIn.mockRejectedValue(
      new ApiRequestError({ message: '请求超时，请稍后重试', isNetworkError: true }),
    );
    const wrapper = await mountDialog();

    await selectGuest(wrapper);
    await selectRoomType(wrapper);
    await selectRoom(wrapper);
    findButton(wrapper, '确认入住')?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('结果不确定');
    expect(wrapper.emitted('refresh-requested')).toHaveLength(1);
    expect(findButton(wrapper, '刷新列表并关闭')).toBeDefined();
    expect(findButton(wrapper, '确认入住')).toBeUndefined();

    confirmSpy.mockRestore();
  });

  it('提交中重复点击只调用一次创建接口', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    let resolveWalkIn!: (value: StayDto) => void;
    mockedCreateWalkIn.mockImplementation(
      () =>
        new Promise<StayDto>((resolve) => {
          resolveWalkIn = resolve;
        }),
    );
    const wrapper = await mountDialog();

    await selectGuest(wrapper);
    await selectRoomType(wrapper);
    await selectRoom(wrapper);
    const submit = findButton(wrapper, '确认入住');
    await submit?.trigger('click');
    await vi.waitFor(() => {
      expect(mockedCreateWalkIn).toHaveBeenCalledTimes(1);
    });

    const pending = findButton(wrapper, '确认入住');
    expect(pending?.attributes('disabled')).toBeDefined();
    await pending?.trigger('click');
    await pending?.trigger('click');
    await flushPromises();
    expect(mockedCreateWalkIn).toHaveBeenCalledTimes(1);

    resolveWalkIn(stay);
    await flushPromises();
    confirmSpy.mockRestore();
  });

  it('离店日期变化会清空房间并重新查询', async () => {
    const wrapper = await mountDialog();
    await selectRoomType(wrapper);
    await selectRoom(wrapper);
    expect(mockedListAvailable).toHaveBeenCalledTimes(1);

    const nextDate = addDays(hotelToday(), 2);
    const datePicker = wrapper.findComponent(ElDatePickerStub);
    datePicker.vm.$emit('update:modelValue', nextDate);
    datePicker.vm.$emit('change', nextDate);
    await flushPromises();

    expect(mockedListAvailable).toHaveBeenLastCalledWith({
      roomTypeId: 1,
      checkInDate: hotelToday(),
      checkOutDate: nextDate,
    });
  });
});
