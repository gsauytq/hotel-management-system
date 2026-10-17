import type { HealthStatus } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/system', () => ({
  fetchHealth: vi.fn(),
}));

import * as systemApi from '../src/api/system';
import { ApiRequestError } from '../src/utils/errors';
import DashboardView from '../src/views/dashboard/DashboardView.vue';

const mockedFetchHealth = vi.mocked(systemApi.fetchHealth);

async function mountView() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/dashboard',
        name: 'dashboard',
        component: DashboardView,
        meta: { title: '经营看板' },
      },
    ],
  });
  await router.push('/dashboard');
  await router.isReady();

  const wrapper = mount(DashboardView, {
    global: { plugins: [router, ElementPlus] },
  });
  await flushPromises();
  return wrapper;
}

describe('TC-UI-008b DashboardView 统计未接入状态', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('明确提示统计未接入且不渲染任何 Mock 指标数值', async () => {
    mockedFetchHealth.mockResolvedValue({ status: 'ok' } satisfies HealthStatus);
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('经营统计接口未提供');
    expect(wrapper.text()).toContain('统计接口与口径未批准');
    expect(wrapper.text()).toContain('待批准');
    expect(wrapper.text()).toContain('入住率');
    expect(wrapper.text(), '不得出现伪造的百分比/金额指标').not.toMatch(/\d+\.\d+(%|万|元)/);
    expect(wrapper.text()).toContain('正常');
  });

  it('健康检查失败展示错误状态，不误报正常', async () => {
    mockedFetchHealth.mockRejectedValue(
      new ApiRequestError({ status: 503, message: '服务不可用' }),
    );
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('健康检查失败');
    expect(wrapper.text()).toContain('服务不可用');
    expect(wrapper.text()).not.toContain('正常');
  });
});
