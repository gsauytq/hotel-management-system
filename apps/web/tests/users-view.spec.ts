import type { UserListItemDto } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/users', () => ({
  listUsers: vi.fn(),
  getUser: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetUserPassword: vi.fn(),
}));

import * as userApi from '../src/api/users';
import { useAuthStore } from '../src/stores/auth';
import { ApiRequestError } from '../src/utils/errors';
import UsersView from '../src/views/users/UsersView.vue';

const mockedListUsers = vi.mocked(userApi.listUsers);

const self: UserListItemDto = {
  id: 1,
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
  status: 'ACTIVE',
  lastLoginAt: '2026-10-17T04:00:00.000Z',
  createdAt: '2026-10-01T02:00:00.000Z',
};

const other: UserListItemDto = {
  id: 2,
  username: 'front01',
  displayName: '前台',
  role: 'RECEPTIONIST',
  status: 'ACTIVE',
  lastLoginAt: null,
  createdAt: '2026-10-02T02:00:00.000Z',
};

async function mountView() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore();
  authStore.user = {
    id: self.id,
    username: self.username,
    displayName: self.displayName,
    role: self.role,
    mustChangePassword: false,
  };
  authStore.booted = true;

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/users',
        name: 'users',
        component: UsersView,
        meta: { title: '员工管理', description: '员工账号管理。' },
      },
    ],
  });
  await router.push('/users');
  await router.isReady();

  const wrapper = mount(UsersView, {
    global: { plugins: [pinia, router, ElementPlus] },
  });
  await flushPromises();
  return wrapper;
}

function buttonsWithText(wrapper: Awaited<ReturnType<typeof mountView>>, text: string) {
  return wrapper.findAll('button').filter((button) => button.text() === text);
}

describe('UsersView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListUsers.mockResolvedValue({
      items: [self, other],
      pagination: { page: 1, pageSize: 10, total: 2, totalPages: 1 },
    });
  });

  it('加载员工并按契约显示角色、状态与创建入口', async () => {
    const wrapper = await mountView();

    expect(mockedListUsers).toHaveBeenCalledWith({
      page: 1,
      pageSize: 10,
      sort: 'createdAt:desc',
    });
    expect(wrapper.text()).toContain('admin');
    expect(wrapper.text()).toContain('管理员');
    expect(wrapper.text()).toContain('前台');
    expect(wrapper.text()).toContain('启用');
    expect(wrapper.text()).toContain('新建员工');
  });

  it('当前登录账号不显示停用/启用操作，其他员工显示', async () => {
    const wrapper = await mountView();

    // 仅 other（非当前账号）渲染一个“停用”操作
    expect(buttonsWithText(wrapper, '停用')).toHaveLength(1);
  });

  it('无数据显示空状态', async () => {
    mockedListUsers.mockResolvedValue({
      items: [],
      pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
    });
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('暂无员工数据');
  });

  it('加载失败显示错误并可重试', async () => {
    mockedListUsers.mockRejectedValueOnce(
      new ApiRequestError({ status: 403, code: 'FORBIDDEN', message: '无权限执行该操作' }),
    );
    const wrapper = await mountView();

    expect(wrapper.text()).toContain('员工列表加载失败');
    expect(wrapper.text()).toContain('无权限执行该操作');

    mockedListUsers.mockResolvedValueOnce({
      items: [self],
      pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
    await wrapper.find('.el-result button').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('admin');
  });
});
