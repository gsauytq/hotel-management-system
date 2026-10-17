import type { CurrentUser, SessionUser } from '@hms/shared';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/auth', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  fetchCurrentUser: vi.fn(),
}));

import * as authApi from '../src/api/auth';
import { useAuthStore } from '../src/stores/auth';

const adminUser: SessionUser = {
  id: 1,
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
};

const currentUser: CurrentUser = { ...adminUser, status: 'ACTIVE' };

const mockedLogin = vi.mocked(authApi.login);
const mockedLogout = vi.mocked(authApi.logout);
const mockedFetchCurrentUser = vi.mocked(authApi.fetchCurrentUser);

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('初始为未登录、未 booted', () => {
    const store = useAuthStore();
    expect(store.user).toBeNull();
    expect(store.booted).toBe(false);
    expect(store.isAuthenticated).toBe(false);
  });

  it('login 成功后写入会话用户', async () => {
    mockedLogin.mockResolvedValue(adminUser);
    const store = useAuthStore();

    await store.login({ username: 'admin', password: 'secret' });

    expect(mockedLogin).toHaveBeenCalledWith({ username: 'admin', password: 'secret' });
    expect(store.user).toEqual(adminUser);
    expect(store.booted).toBe(true);
    expect(store.isAuthenticated).toBe(true);
  });

  it('login 失败时保持未登录状态', async () => {
    mockedLogin.mockRejectedValue(new Error('用户名或密码错误'));
    const store = useAuthStore();

    await expect(store.login({ username: 'admin', password: 'bad' })).rejects.toThrow(
      '用户名或密码错误',
    );
    expect(store.user).toBeNull();
    expect(store.booted).toBe(false);
  });

  it('fetchMe 成功后重建会话', async () => {
    mockedFetchCurrentUser.mockResolvedValue(currentUser);
    const store = useAuthStore();

    await store.fetchMe();

    expect(store.user).toEqual(currentUser);
    expect(store.booted).toBe(true);
  });

  it('fetchMe 失败时进入游客态且 booted', async () => {
    mockedFetchCurrentUser.mockRejectedValue(new Error('401'));
    const store = useAuthStore();

    await expect(store.fetchMe()).resolves.toBeUndefined();

    expect(store.user).toBeNull();
    expect(store.booted).toBe(true);
    expect(store.isAuthenticated).toBe(false);
  });

  it('logout 即使请求失败也清理本地状态', async () => {
    mockedFetchCurrentUser.mockResolvedValue(currentUser);
    const store = useAuthStore();
    await store.fetchMe();

    mockedLogout.mockRejectedValue(new Error('network'));
    await expect(store.logout()).resolves.toBeUndefined();

    expect(mockedLogout).toHaveBeenCalledTimes(1);
    expect(store.user).toBeNull();
    expect(store.booted).toBe(true);
  });

  it('clearSession 清空用户并标记 booted', () => {
    const store = useAuthStore();
    store.user = adminUser;

    store.clearSession();

    expect(store.user).toBeNull();
    expect(store.booted).toBe(true);
  });
});
