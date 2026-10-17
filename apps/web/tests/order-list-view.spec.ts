import type { OrderSummaryDto } from '@hms/shared';
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
import OrderListView from '../src/views/orders/OrderListView.vue';

const mockedListOrders = vi.mocked(orderApi.listOrders);

const order: OrderSummaryDto = {
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

async function mountView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/orders',
        name: 'orders',
        component: OrderListView,
        meta: { title: '账单查询', description: '账单列表。' },
      },
      {
        path: '/orders/:id',
        name: 'order-detail',
        component: { template: '<div />' },
        meta: { title: '账单详情' },
      },
    ],
  });
  await router.push('/orders');
  await router.isReady();

  const wrapper = mount(OrderListView, {
    global: { plugins: [pinia, router, ElementPlus] },
  });
  await flushPromises();
  return { wrapper, router };
}

describe('OrderListView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListOrders.mockResolvedValue({
      items: [order],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
  });

  it('以默认分页参数加载并展示服务端金额、状态与内部收银提示', async () => {
    const { wrapper } = await mountView();

    expect(mockedListOrders).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      sort: 'createdAt:desc',
    });
    expect(wrapper.text()).toContain('#900');
    expect(wrapper.text()).toContain('张三');
    expect(wrapper.text()).toContain('0821');
    expect(wrapper.text()).toContain('614.00');
    expect(wrapper.text()).toContain('414.00');
    expect(wrapper.text()).toContain('已支付');
    expect(wrapper.text()).toContain('微信支付');
    expect(wrapper.text()).toContain('未接入第三方支付渠道');
    expect(wrapper.text()).toContain('不代表真实资金已完成支付');
  });

  it('无数据显示空状态', async () => {
    mockedListOrders.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    });
    const { wrapper } = await mountView();

    expect(wrapper.text()).toContain('暂无账单数据');
  });

  it('加载失败显示错误并可重试', async () => {
    mockedListOrders.mockRejectedValueOnce(
      new ApiRequestError({ status: 500, message: '服务器内部错误', requestId: 'req-orders' }),
    );
    const { wrapper } = await mountView();

    expect(wrapper.text()).toContain('账单列表加载失败');
    expect(wrapper.text()).toContain('服务器内部错误');

    mockedListOrders.mockResolvedValueOnce({
      items: [order],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
    await wrapper.find('.el-result button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('#900');
    expect(wrapper.text()).not.toContain('账单列表加载失败');
  });

  it('点击详情进入账单详情路由', async () => {
    const { wrapper, router } = await mountView();

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '详情')
      ?.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('order-detail');
    expect(router.currentRoute.value.params['id']).toBe('900');
  });
});
