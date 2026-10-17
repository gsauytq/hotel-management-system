import type { CurrentUser } from '@hms/shared';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/auth', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  fetchCurrentUser: vi.fn(),
}));

import * as authApi from '../src/api/auth';
import { installAuthGuards } from '../src/router/guards';
import { resolveSafeRedirect } from '../src/router/redirect';

const stub = { template: '<div />' };

/** 守卫单测使用轻量路由，避免加载真实页面组件导致超时 */
const guardTestRoutes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: stub, meta: { public: true, title: '登录' } },
  {
    path: '/',
    component: stub,
    children: [
      { path: 'rooms', name: 'rooms', component: stub, meta: { title: '房态看板' } },
      { path: 'bookings', name: 'bookings', component: stub, meta: { title: '预订管理' } },
      {
        path: 'users',
        name: 'users',
        component: stub,
        meta: { title: '员工管理', roles: ['ADMIN'] },
      },
      { path: '403', name: 'forbidden', component: stub, meta: { title: '无权限访问' } },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: stub,
    meta: { public: true, title: '页面不存在' },
  },
];

const receptionist: CurrentUser = {
  id: 2,
  username: 'front01',
  displayName: '前台',
  role: 'RECEPTIONIST',
  status: 'ACTIVE',
};

const admin: CurrentUser = {
  id: 1,
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
  status: 'ACTIVE',
};

const mockedFetchCurrentUser = vi.mocked(authApi.fetchCurrentUser);

function createGuardedRouter() {
  const router = createRouter({ history: createMemoryHistory(), routes: guardTestRoutes });
  installAuthGuards(router);
  return router;
}

describe('认证与角色守卫', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('未登录访问受保护路由跳转登录并携带 redirect', async () => {
    mockedFetchCurrentUser.mockRejectedValue(new Error('401'));
    const router = createGuardedRouter();

    await router.push('/rooms');

    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/rooms');
  });

  it('RECEPTIONIST 访问 ADMIN 路由跳转 403', async () => {
    mockedFetchCurrentUser.mockResolvedValue(receptionist);
    const router = createGuardedRouter();

    await router.push('/users');

    expect(router.currentRoute.value.name).toBe('forbidden');
  });

  it('ADMIN 可以访问员工管理路由', async () => {
    mockedFetchCurrentUser.mockResolvedValue(admin);
    const router = createGuardedRouter();

    await router.push('/users');

    expect(router.currentRoute.value.name).toBe('users');
  });

  it('已登录访问登录页时跳转安全 redirect 或默认首页', async () => {
    mockedFetchCurrentUser.mockResolvedValue(admin);
    const firstRouter = createGuardedRouter();

    await firstRouter.push('/login?redirect=/bookings');
    expect(firstRouter.currentRoute.value.path).toBe('/bookings');

    setActivePinia(createPinia());
    const secondRouter = createGuardedRouter();
    await secondRouter.push('/login?redirect=https://evil.example');
    expect(secondRouter.currentRoute.value.path).toBe('/rooms');
  });

  it('resolveSafeRedirect 拒绝外部地址与登录页自跳转', () => {
    expect(resolveSafeRedirect('/bookings')).toBe('/bookings');
    expect(resolveSafeRedirect('/bookings/1?tab=detail')).toBe('/bookings/1?tab=detail');
    expect(resolveSafeRedirect('https://evil.example')).toBeNull();
    expect(resolveSafeRedirect('//evil.example')).toBeNull();
    expect(resolveSafeRedirect('/login')).toBeNull();
    expect(resolveSafeRedirect('/login?redirect=/rooms')).toBeNull();
    expect(resolveSafeRedirect(undefined)).toBeNull();
  });
});
