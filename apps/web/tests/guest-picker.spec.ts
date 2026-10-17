import type { GuestDto } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/guests', () => ({
  listGuests: vi.fn(),
}));

import * as guestApi from '../src/api/guests';
import { ApiRequestError } from '../src/utils/errors';
import GuestPicker from '../src/components/guests/GuestPicker.vue';

const mockedListGuests = vi.mocked(guestApi.listGuests);

/**
 * ElSelect 在 jsdom 中与远程搜索/选项更新组合时存在递归更新问题，
 * 使用受控 stub 观察 GuestPicker 的真实逻辑（请求参数、防抖、事件、错误恢复）。
 */
const ElSelectStub = defineComponent({
  name: 'ElSelectStub',
  props: {
    modelValue: { type: [String, Number], default: undefined },
    remoteMethod: { type: Function, default: undefined },
    loading: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'change', 'visible-change'],
  template: '<div class="el-select-stub"><slot /></div>',
});

const guest: GuestDto = {
  id: 9,
  name: '张三',
  phone: '13800138000',
  idType: 'ID_CARD',
  idNumberMasked: '1***********4',
  remark: 'VIP',
  createdAt: '2026-10-01T02:00:00.000Z',
};

function mountPicker() {
  return mount(GuestPicker, {
    props: { modelValue: undefined },
    global: {
      plugins: [ElementPlus],
      stubs: { teleport: true, ElSelect: ElSelectStub, ElOption: true },
    },
  });
}

describe('TC-UI-004 GuestPicker 远程搜索、选择与错误重试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListGuests.mockResolvedValue({
      items: [guest],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
  });

  it('首次展开时按契约参数加载客人，选中后回传 id', async () => {
    const wrapper = mountPicker();
    expect(mockedListGuests, '展开前不应预加载').not.toHaveBeenCalled();

    const select = wrapper.findComponent(ElSelectStub);
    expect(select.exists()).toBe(true);
    select.vm.$emit('visible-change', true);
    await flushPromises();

    expect(mockedListGuests).toHaveBeenCalledTimes(1);
    expect(mockedListGuests).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      sort: 'createdAt:desc',
    });

    select.vm.$emit('change', guest.id);
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')).toEqual([[9]]);

    select.vm.$emit('change', '');
    await flushPromises();
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([undefined]);
  });

  it('远程搜索 300ms 防抖：连续输入只发一次请求，携带最后关键字', async () => {
    const wrapper = mountPicker();
    const select = wrapper.findComponent(ElSelectStub);
    const remoteMethod = select.props('remoteMethod') as (query: string) => void;
    expect(typeof remoteMethod).toBe('function');

    remoteMethod('张');
    remoteMethod('张三');

    await new Promise((resolve) => setTimeout(resolve, 350));
    await flushPromises();

    expect(mockedListGuests).toHaveBeenCalledTimes(1);
    expect(mockedListGuests).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      keyword: '张三',
      sort: 'createdAt:desc',
    });
  });

  it('加载失败展示错误，重试后恢复', async () => {
    mockedListGuests.mockRejectedValueOnce(
      new ApiRequestError({ status: 500, message: '服务器内部错误' }),
    );
    const wrapper = mountPicker();
    const select = wrapper.findComponent(ElSelectStub);
    select.vm.$emit('visible-change', true);
    await flushPromises();

    expect(wrapper.text()).toContain('服务器内部错误');
    const retry = wrapper.findAll('button').find((button) => button.text().includes('重试'));
    expect(retry).toBeDefined();

    await retry?.trigger('click');
    await flushPromises();

    expect(mockedListGuests).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain('服务器内部错误');
  });
});
