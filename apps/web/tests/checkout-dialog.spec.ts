import type { OrderDto, StayDetailDto } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus, { ElInput, ElInputNumber, ElMessageBox } from 'element-plus';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/stays', () => ({
  getStay: vi.fn(),
  checkoutStay: vi.fn(),
}));

vi.mock('../src/api/orders', () => ({
  getOrder: vi.fn(),
}));

import * as stayApi from '../src/api/stays';
import CheckoutDialog from '../src/views/stays/CheckoutDialog.vue';

const mockedGetStay = vi.mocked(stayApi.getStay);
const mockedCheckout = vi.mocked(stayApi.checkoutStay);

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

const order: OrderDto = {
  id: 900,
  stayId: 501,
  status: 'PAID',
  items: [
    { type: 'ROOM_FEE', name: '房费 2 晚 × 288.00', amount: 576 },
    { type: 'MISC', name: '迷你吧消费', amount: 38 },
    { type: 'DEPOSIT_APPLIED', name: '押金抵扣', amount: 200 },
  ],
  totalAmount: 614,
  depositAmount: 200,
  depositApplied: 200,
  paidAmount: 414,
  paymentMethod: 'WECHAT',
  note: null,
  createdAt: '2026-10-17T06:00:00.000Z',
  updatedAt: '2026-10-17T06:00:00.000Z',
};

/**
 * Element Plus ElSelect 在 jsdom 中随表单 disabled 切换会触发递归更新，
 * 按项目既有表单测试惯例使用受控 stub；支付方式的真实契约由 L2 集成测试覆盖。
 */
const ElSelectStub = defineComponent({
  name: 'ElSelectStub',
  props: { modelValue: { type: [String, Number], default: undefined } },
  emits: ['update:modelValue', 'change'],
  template: '<div class="el-select-stub"><slot /></div>',
});

async function mountDialog() {
  const wrapper = mount(CheckoutDialog, {
    props: { modelValue: false, stayId: 501 },
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

function setPaymentMethod(wrapper: ReturnType<typeof mount>, method: string): void {
  const select = wrapper.findComponent(ElSelectStub);
  expect(select.exists(), '支付方式选择器应存在').toBe(true);
  select.vm.$emit('update:modelValue', method);
}

async function addMiscItem(
  wrapper: ReturnType<typeof mount>,
  name: string,
  amount: number,
): Promise<void> {
  findButton(wrapper, '添加杂费')?.trigger('click');
  await flushPromises();
  const row = wrapper.find('.misc-row');
  expect(row.exists(), '杂费行应渲染').toBe(true);
  row.findComponent(ElInput).vm.$emit('update:modelValue', name);
  row.findComponent(ElInputNumber).vm.$emit('update:modelValue', amount);
  await flushPromises();
}

describe('TC-UI-002 CheckoutDialog 费用展示、杂费录入与提交载荷', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetStay.mockResolvedValue(stay);
  });

  it('展示服务端在住金额与押金（不在前端自行计算最终金额）', async () => {
    const wrapper = await mountDialog();

    expect(mockedGetStay).toHaveBeenCalledWith(501);
    expect(wrapper.text()).toContain('张三');
    expect(wrapper.text()).toContain('0821');
    expect(wrapper.text()).toContain('288.00');
    expect(wrapper.text()).toContain('200.00');
    expect(wrapper.text()).toContain('576.00');
    expect(wrapper.text()).toContain('预计晚数');
  });

  it('杂费行可增删，最多 20 项', async () => {
    const wrapper = await mountDialog();
    const addButton = findButton(wrapper, '添加杂费');
    expect(addButton).toBeDefined();

    for (let index = 0; index < 25; index += 1) {
      addButton?.trigger('click');
    }
    await flushPromises();

    expect(wrapper.findAll('.misc-row')).toHaveLength(20);
    expect(addButton?.attributes('disabled')).toBeDefined();

    findButton(wrapper, '删除')?.trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.misc-row')).toHaveLength(19);
  });

  it('提交仅发送契约字段（服务端计算金额），成功后展示服务端账单结果', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    mockedCheckout.mockResolvedValue(order);
    const wrapper = await mountDialog();

    setPaymentMethod(wrapper, 'WECHAT');
    await addMiscItem(wrapper, '迷你吧消费', 38);
    await flushPromises();

    findButton(wrapper, '确认退房')?.trigger('click');
    await flushPromises();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mockedCheckout).toHaveBeenCalledTimes(1);
    const [stayId, payload] = mockedCheckout.mock.calls[0]!;
    expect(stayId).toBe(501);
    expect(payload).toMatchObject({
      paymentMethod: 'WECHAT',
      miscItems: [{ name: '迷你吧消费', amount: 38 }],
    });
    expect(payload, '不得把客户端拼装的金额发送给服务端').not.toHaveProperty('totalAmount');
    expect(payload).not.toHaveProperty('depositApplied');

    expect(wrapper.text()).toContain('账单编号');
    expect(wrapper.text()).toContain('614.00');
    expect(wrapper.text()).toContain('414.00');

    confirmSpy.mockRestore();
  });

  it('提交中按钮 loading/禁用，重复点击不会重复发起退房请求', async () => {
    const confirmSpy = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never);
    let resolveCheckout!: (value: OrderDto) => void;
    mockedCheckout.mockImplementation(
      () =>
        new Promise<OrderDto>((resolve) => {
          resolveCheckout = resolve;
        }),
    );
    const wrapper = await mountDialog();

    setPaymentMethod(wrapper, 'CASH');
    await flushPromises();

    const submit = findButton(wrapper, '确认退房');
    expect(submit).toBeDefined();
    await submit?.trigger('click');

    await vi.waitFor(() => {
      expect(mockedCheckout).toHaveBeenCalledTimes(1);
    });

    const pendingButton = findButton(wrapper, '确认退房');
    expect(pendingButton?.attributes('disabled'), '提交中按钮必须禁用').toBeDefined();
    expect(pendingButton?.classes().join(' ')).toContain('is-loading');

    await pendingButton?.trigger('click');
    await pendingButton?.trigger('click');
    await flushPromises();
    expect(mockedCheckout, '提交中重复点击不得再次请求').toHaveBeenCalledTimes(1);

    resolveCheckout(order);
    await flushPromises();
    expect(wrapper.text()).toContain('账单编号');

    confirmSpy.mockRestore();
  });
});
