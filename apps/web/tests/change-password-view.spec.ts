import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/auth', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  fetchCurrentUser: vi.fn(),
  changePassword: vi.fn(),
}));

import * as authApi from '../src/api/auth';
import { useAuthStore } from '../src/stores/auth';
import { ApiRequestError } from '../src/utils/errors';
import ChangePasswordView from '../src/views/login/ChangePasswordView.vue';

const mockedChangePassword = vi.mocked(authApi.changePassword);
const mockedLogout = vi.mocked(authApi.logout);

async function mountView(mustChangePassword = true) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useAuthStore();
  store.user = {
    id: 1,
    username: 'admin',
    displayName: '管理员',
    role: 'ADMIN',
    mustChangePassword,
  };
  store.booted = true;

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: { template: '<div />' } },
      { path: '/change-password', name: 'change-password', component: ChangePasswordView },
      { path: '/rooms', name: 'rooms', component: { template: '<div />' } },
    ],
  });
  await router.push('/change-password');
  await router.isReady();

  const wrapper = mount(ChangePasswordView, {
    global: { plugins: [pinia, router, ElementPlus] },
  });
  await flushPromises();
  return { wrapper, router, store };
}

async function fillForm(
  wrapper: ReturnType<typeof mount>,
  currentPassword: string,
  newPassword: string,
  confirmPassword = newPassword,
) {
  await wrapper.find('input[autocomplete="current-password"]').setValue(currentPassword);
  const newInputs = wrapper.findAll('input[autocomplete="new-password"]');
  await newInputs[0]?.setValue(newPassword);
  await newInputs[1]?.setValue(confirmPassword);
  await wrapper.find('form').trigger('submit');
  await flushPromises();
}

describe('ChangePasswordView（A-20 B）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLogout.mockResolvedValue({ ok: true });
  });

  it('首次登录显示强制改密提示', async () => {
    const { wrapper } = await mountView(true);
    expect(wrapper.text()).toContain('首次登录必须修改初始密码');
  });

  it('两次新密码不一致时阻止提交', async () => {
    const { wrapper } = await mountView(true);
    await fillForm(wrapper, 'Old#Pass123', 'New#Pass123', 'Mismatch#123');
    expect(mockedChangePassword).not.toHaveBeenCalled();
  });

  it('提交成功：调用改密接口、清理会话并跳转登录', async () => {
    mockedChangePassword.mockResolvedValue({ ok: true });
    const { wrapper, router, store } = await mountView(true);

    await fillForm(wrapper, 'Old#Pass123', 'New#Pass123');

    expect(mockedChangePassword).toHaveBeenCalledWith({
      currentPassword: 'Old#Pass123',
      newPassword: 'New#Pass123',
    });
    expect(store.user).toBeNull();
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('login');
    });
  });

  it('当前密码错误显示字段级错误且不清理会话', async () => {
    mockedChangePassword.mockRejectedValue(
      new ApiRequestError({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: '当前密码不正确',
        details: [{ field: 'currentPassword', message: '当前密码不正确' }],
      }),
    );
    const { wrapper, store } = await mountView(true);

    await fillForm(wrapper, 'Wrong#Pass123', 'New#Pass123');

    expect(wrapper.text()).toContain('当前密码不正确');
    expect(store.user).not.toBeNull();
  });
});
