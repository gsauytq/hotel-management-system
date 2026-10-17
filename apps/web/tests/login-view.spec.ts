import type { SessionUser } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/auth', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  fetchCurrentUser: vi.fn(),
}));

import * as authApi from '../src/api/auth';
import { ApiRequestError } from '../src/utils/errors';
import LoginView from '../src/views/login/LoginView.vue';

const adminUser: SessionUser = {
  id: 1,
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
};

const mockedLogin = vi.mocked(authApi.login);

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/rooms', name: 'rooms', component: { template: '<div />' } },
      { path: '/bookings', name: 'bookings', component: { template: '<div />' } },
    ],
  });
}

async function mountLogin(path: string) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createTestRouter();
  await router.push(path);
  await router.isReady();
  const wrapper = mount(LoginView, {
    global: { plugins: [pinia, router, ElementPlus] },
  });
  await flushPromises();
  return { wrapper, router };
}

async function fillCredentials(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('input[autocomplete="username"]').setValue('admin');
  await wrapper.find('input[autocomplete="current-password"]').setValue('secret');
}

describe('LoginView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染真实登录表单而非占位提示', async () => {
    const { wrapper } = await mountLogin('/login');

    expect(wrapper.text()).toContain('请使用员工账号登录后台');
    expect(wrapper.text()).not.toContain('尚未实现');
    expect(wrapper.find('input[autocomplete="username"]').exists()).toBe(true);
    expect(wrapper.find('input[autocomplete="current-password"]').exists()).toBe(true);
  });

  it('空表单提交不调用登录接口', async () => {
    const { wrapper } = await mountLogin('/login');

    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(mockedLogin).not.toHaveBeenCalled();
  });

  it('登录成功后跳转到安全的 redirect 地址', async () => {
    mockedLogin.mockResolvedValue(adminUser);
    const { wrapper, router } = await mountLogin('/login?redirect=/bookings');

    await fillCredentials(wrapper);
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/bookings');
    });
    expect(mockedLogin).toHaveBeenCalledWith({ username: 'admin', password: 'secret' });
  });

  it('错误凭据显示内联失败提示且不跳转', async () => {
    mockedLogin.mockRejectedValue(
      new ApiRequestError({
        status: 401,
        code: 'INVALID_CREDENTIALS',
        message: '用户名或密码错误',
      }),
    );
    const { wrapper, router } = await mountLogin('/login');

    await fillCredentials(wrapper);
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('登录失败');
    expect(wrapper.text()).toContain('用户名或密码错误');
    expect(router.currentRoute.value.path).toBe('/login');
  });

  it('账号锁定与网络异常使用不同提示分类', async () => {
    mockedLogin.mockRejectedValueOnce(
      new ApiRequestError({
        status: 423,
        code: 'ACCOUNT_LOCKED',
        message: '失败次数过多，账号已锁定，请 15 分钟后重试',
      }),
    );
    const first = await mountLogin('/login');
    await fillCredentials(first.wrapper);
    await first.wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(first.wrapper.text()).toContain('账号已锁定');

    mockedLogin.mockRejectedValueOnce(
      new ApiRequestError({ message: '网络异常，请稍后重试', isNetworkError: true }),
    );
    const second = await mountLogin('/login');
    await fillCredentials(second.wrapper);
    await second.wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(second.wrapper.text()).toContain('网络异常');
  });

  it('会话过期时显示重新登录提示', async () => {
    const { wrapper } = await mountLogin('/login?reason=expired');

    expect(wrapper.text()).toContain('登录状态已失效，请重新登录');
  });

  it('提交中重复提交只调用一次登录接口', async () => {
    let resolveLogin: ((user: SessionUser) => void) | undefined;
    mockedLogin.mockImplementation(
      () =>
        new Promise<SessionUser>((resolve) => {
          resolveLogin = resolve;
        }),
    );
    const { wrapper, router } = await mountLogin('/login');

    await fillCredentials(wrapper);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(mockedLogin).toHaveBeenCalledTimes(1);

    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(mockedLogin).toHaveBeenCalledTimes(1);

    resolveLogin?.(adminUser);
    await flushPromises();
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/rooms');
    });
  });
});
