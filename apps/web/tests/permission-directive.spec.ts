import type { Role } from '@hms/shared';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it } from 'vitest';

import { vPermission } from '../src/directives/permission';
import { useAuthStore } from '../src/stores/auth';

const PermissionDemo = defineComponent({
  template: `
    <div>
      <button v-permission="'ADMIN'" class="admin-action">管理员操作</button>
      <button v-permission="'RECEPTIONIST'" class="receptionist-action">前台操作</button>
      <button v-permission="['ADMIN', 'RECEPTIONIST']" class="shared-action">共享操作</button>
      <button v-permission="'UNKNOWN'" class="invalid-action">非法角色</button>
      <button class="public-action">所有角色</button>
    </div>
  `,
});

function mountDemo(role: Role) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore();
  authStore.user = {
    id: 1,
    username: 'user',
    displayName: '用户',
    role,
    mustChangePassword: false,
  };
  authStore.booted = true;

  return mount(PermissionDemo, {
    global: {
      plugins: [pinia],
      directives: { permission: vPermission },
    },
  });
}

function isHidden(wrapper: ReturnType<typeof mountDemo>, selector: string): boolean {
  return wrapper.find(selector).attributes('style')?.includes('display: none') ?? false;
}

describe('v-permission 指令（仅 UX，非后端授权）', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('ADMIN 仅看到管理员与共享操作', () => {
    const wrapper = mountDemo('ADMIN');

    expect(isHidden(wrapper, '.admin-action')).toBe(false);
    expect(isHidden(wrapper, '.shared-action')).toBe(false);
    expect(isHidden(wrapper, '.receptionist-action')).toBe(true);
    expect(isHidden(wrapper, '.invalid-action')).toBe(true);
    expect(isHidden(wrapper, '.public-action')).toBe(false);
  });

  it('RECEPTIONIST 仅看到前台与共享操作', () => {
    const wrapper = mountDemo('RECEPTIONIST');

    expect(isHidden(wrapper, '.admin-action')).toBe(true);
    expect(isHidden(wrapper, '.receptionist-action')).toBe(false);
    expect(isHidden(wrapper, '.shared-action')).toBe(false);
    expect(isHidden(wrapper, '.invalid-action')).toBe(true);
  });

  it('隐藏的操作入口带 aria-hidden，便于辅助技术忽略', () => {
    const wrapper = mountDemo('RECEPTIONIST');
    const adminAction = wrapper.find('.admin-action');

    expect(adminAction.attributes('style')).toContain('display: none');
    expect(adminAction.attributes('aria-hidden')).toBe('true');
  });
});
