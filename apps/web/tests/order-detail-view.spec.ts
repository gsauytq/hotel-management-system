import type { OrderDto } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/orders', () => ({
  listOrders: vi.fn(),
  getOrder: vi.fn(),
}));

import * as orderApi from '../src/api/orders';
import { ApiRequestError } from '../src/utils/errors';
import OrderDetailView from '../src/views/orders/OrderDetailView.vue';

const mockedGetOrder = vi.mocked(orderApi.getOrder);

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

async function mountView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/orders', name: 'orders', component: { template: '<div />' } },
      {
        path: '/orders/:id',
        name: 'order-detail',
        component: OrderDetailView,
        meta: { title: '账单详情' },
      },
      {
        path: '/stays/:id',
        name: 'stay-detail',
        component: { template: '<div />' },
        meta: { title: '入住详情' },
      },
    ],
  });
  await router.push('/orders/900');
  await router.isReady();

  const wrapper = mount(OrderDetailView, {
    global: { plugins: [pinia, router, ElementPlus] },
  });
  await flushPromises();
  return { wrapper, router };
}

function buttonTexts(wrapper: Awaited<ReturnType<typeof mountView>>['wrapper']): string[] {
  return wrapper.findAll('button').map((button) => button.text());
}

describe('OrderDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('展示服务端账单金额、费用明细与内部收银信息', async () => {
    mockedGetOrder.mockResolvedValue(order);
    const { wrapper } = await mountView();

    expect(mockedGetOrder).toHaveBeenCalledWith(900);
    expect(wrapper.text()).toContain('#900');
    expect(wrapper.text()).toContain('已支付');
    expect(wrapper.text()).toContain('微信支付');
    expect(wrapper.text()).toContain('614.00');
    expect(wrapper.text()).toContain('200.00');
    expect(wrapper.text()).toContain('414.00');
    expect(wrapper.text()).toContain('房费 2 晚 × 288.00');
    expect(wrapper.text()).toContain('迷你吧消费');
    expect(wrapper.text()).toContain('押金抵扣');
    expect(wrapper.text()).toContain('未接入第三方支付渠道');
    expect(wrapper.text()).toContain('无独立支付流水');
  });

  it('只读页面不提供支付、退款或修改账单按钮', async () => {
    mockedGetOrder.mockResolvedValue(order);
    const { wrapper } = await mountView();

    const texts = buttonTexts(wrapper);
    expect(texts).toContain('返回列表');
    expect(texts).toContain('查看入住记录');
    expect(texts.some((text) => /支付|退款|修改/.test(text))).toBe(false);
  });

  it('可跳转到关联入住记录', async () => {
    mockedGetOrder.mockResolvedValue(order);
    const { wrapper, router } = await mountView();

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '查看入住记录')
      ?.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('stay-detail');
    expect(router.currentRoute.value.params['id']).toBe('501');
  });

  it('详情加载失败显示错误并可重试', async () => {
    mockedGetOrder.mockRejectedValueOnce(
      new ApiRequestError({ status: 404, code: 'NOT_FOUND', message: '订单不存在' }),
    );
    const { wrapper } = await mountView();

    expect(wrapper.text()).toContain('账单详情加载失败');
    expect(wrapper.text()).toContain('订单不存在');

    mockedGetOrder.mockResolvedValueOnce(order);
    await wrapper.find('.el-result button:last-child').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('房费 2 晚 × 288.00');
  });
});
