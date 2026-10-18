import type { UserListItemDto } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/users', () => ({
  listUsers: vi.fn(),
  getUser: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetUserPassword: vi.fn(),
}));

vi.mock('../src/api/guests', () => ({
  listGuests: vi.fn(),
  getGuest: vi.fn(),
  createGuest: vi.fn(),
  updateGuest: vi.fn(),
}));

import * as guestApi from '../src/api/guests';
import * as userApi from '../src/api/users';
import { useAuthStore } from '../src/stores/auth';
import GuestFormDialog from '../src/views/guests/GuestFormDialog.vue';
import UserFormDialog from '../src/views/users/UserFormDialog.vue';

const mockedCreateUser = vi.mocked(userApi.createUser);
const mockedCreateGuest = vi.mocked(guestApi.createGuest);

const self: UserListItemDto = {
  id: 1,
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN',
  status: 'ACTIVE',
  lastLoginAt: null,
  createdAt: '2026-10-01T02:00:00.000Z',
};

function findButton(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((button) => button.text() === text);
}

describe('员工/客人表单校验', () => {
  it('员工空表单阻止提交且不调用创建接口', async () => {
    const wrapper = mount(UserFormDialog, {
      props: { modelValue: true, mode: 'create', user: null },
      global: {
        plugins: [ElementPlus, createPinia()],
        stubs: {
          teleport: true,
          ElSelect: { template: '<div><slot /></div>' },
          ElOption: { template: '<div />' },
        },
      },
    });
    await flushPromises();

    await findButton(wrapper, '创建')?.trigger('click');
    await flushPromises();

    expect(mockedCreateUser).not.toHaveBeenCalled();
  });

  it('编辑自己的员工表单明确禁止修改角色', async () => {
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

    const wrapper = mount(UserFormDialog, {
      props: { modelValue: true, mode: 'edit', user: self },
      global: {
        plugins: [ElementPlus, pinia],
        stubs: {
          teleport: true,
          ElSelect: { template: '<div><slot /></div>' },
          ElOption: { template: '<div />' },
        },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('当前登录账号不可在此修改自己的角色');
  });

  it('客人空表单阻止提交且不调用创建接口', async () => {
    const wrapper = mount(GuestFormDialog, {
      props: { modelValue: true, mode: 'create', guest: null },
      global: {
        plugins: [ElementPlus],
        stubs: {
          teleport: true,
          ElSelect: { template: '<div><slot /></div>' },
          ElOption: { template: '<div />' },
        },
      },
    });
    await flushPromises();

    await findButton(wrapper, '创建')?.trigger('click');
    await flushPromises();

    expect(mockedCreateGuest).not.toHaveBeenCalled();
  });
});
