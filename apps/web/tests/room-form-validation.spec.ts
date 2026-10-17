import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/room-types', () => ({
  listRoomTypes: vi.fn(),
  getRoomType: vi.fn(),
  createRoomType: vi.fn(),
  updateRoomType: vi.fn(),
  archiveRoomType: vi.fn(),
}));

vi.mock('../src/api/rooms', () => ({
  listRooms: vi.fn(),
  getRoom: vi.fn(),
  createRoom: vi.fn(),
  updateRoom: vi.fn(),
  updateRoomStatus: vi.fn(),
}));

import * as roomTypeApi from '../src/api/room-types';
import * as roomApi from '../src/api/rooms';
import RoomFormDialog from '../src/views/rooms/RoomFormDialog.vue';
import RoomTypeFormDialog from '../src/views/room-types/RoomTypeFormDialog.vue';

const mockedCreateRoomType = vi.mocked(roomTypeApi.createRoomType);
const mockedCreateRoom = vi.mocked(roomApi.createRoom);

function findButton(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(label));
}

describe('房型/客房表单校验', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('房型为空时阻止提交且不调用创建接口', async () => {
    const wrapper = mount(RoomTypeFormDialog, {
      props: { modelValue: true, mode: 'create', roomType: null },
      global: { plugins: [ElementPlus], stubs: { teleport: true } },
    });
    await flushPromises();

    await findButton(wrapper, '创建')?.trigger('click');
    await flushPromises();

    expect(mockedCreateRoomType).not.toHaveBeenCalled();
  });

  it('客房为空时阻止提交且不调用创建接口', async () => {
    const wrapper = mount(RoomFormDialog, {
      props: { modelValue: true, mode: 'create', room: null, roomTypes: [] },
      global: {
        plugins: [ElementPlus],
        stubs: {
          teleport: true,
          ElSelect: { template: '<div><slot /></div>' },
          ElOption: { template: '<div />' },
        },
      },
    });
    await flushPromises();

    await findButton(wrapper, '创建')?.trigger('click');
    await flushPromises();

    expect(mockedCreateRoom).not.toHaveBeenCalled();
  });
});
