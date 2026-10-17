import type { OrderDto, OrderSummaryDto } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { describe, expect, it } from 'vitest';

import CheckoutResult from '../src/views/stays/CheckoutResult.vue';

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
  note: '客人无异议',
  createdAt: '2026-10-17T04:30:00.000Z',
  updatedAt: '2026-10-17T04:30:00.000Z',
};

const summary: OrderSummaryDto = {
  id: 900,
  stayId: 501,
  guestName: '张三',
  roomNumber: '0821',
  totalAmount: 614,
  paidAmount: 414,
  paymentMethod: 'WECHAT',
  status: 'PAID',
  createdAt: '2026-10-17T04:30:00.000Z',
};

describe('CheckoutResult', () => {
  it('完整展示后端返回的账单明细与金额', async () => {
    const wrapper = mount(CheckoutResult, {
      props: { order },
      global: { plugins: [ElementPlus] },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('#900');
    expect(wrapper.text()).toContain('已支付');
    expect(wrapper.text()).toContain('微信支付');
    expect(wrapper.text()).toContain('614.00');
    expect(wrapper.text()).toContain('200.00');
    expect(wrapper.text()).toContain('414.00');
    expect(wrapper.text()).toContain('房费 2 晚 × 288.00');
    expect(wrapper.text()).toContain('迷你吧消费');
    expect(wrapper.text()).toContain('押金抵扣');
  });

  it('账单明细加载失败时展示服务端摘要并支持重试', async () => {
    const wrapper = mount(CheckoutResult, {
      props: { order: null, summary, orderError: '账单服务异常' },
      global: { plugins: [ElementPlus] },
    });

    expect(wrapper.text()).toContain('账单明细加载失败');
    expect(wrapper.text()).toContain('账单服务异常');
    expect(wrapper.text()).toContain('#900');
    expect(wrapper.text()).toContain('414.00');

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '重试')
      ?.trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });
});
