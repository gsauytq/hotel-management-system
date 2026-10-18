import type { Role } from '@hms/shared';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DefaultLayout from '../src/layouts/DefaultLayout.vue';
import { routes } from '../src/router/routes';
import { useAuthStore } from '../src/stores/auth';
import { useUiStore } from '../src/stores/ui';

async function mountLayout(role: Role, path = '/rooms') {
  const pinia = createPinia();
  setActivePinia(pinia);
  const authStore = useAuthStore();
  authStore.user = {
    id: role === 'ADMIN' ? 1 : 2,
    username: role === 'ADMIN' ? 'admin' : 'front01',
    displayName: role === 'ADMIN' ? '管理员' : '前台',
    role,
    mustChangePassword: false,
  };
  authStore.booted = true;

  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(path);
  await router.isReady();

  const wrapper = mount(DefaultLayout, {
    global: {
      plugins: [pinia, router, ElementPlus],
      stubs: { RouterView: true },
    },
  });
  return { wrapper, authStore, pinia, router };
}

describe('DefaultLayout', () => {
  beforeEach(() => {
    // 宽屏下默认展开，确保菜单文字可断言
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1440);
    window.localStorage.clear();
  });

  it('ADMIN 显示完整菜单与用户信息', async () => {
    const { wrapper } = await mountLayout('ADMIN');

    expect(wrapper.text()).toContain('员工管理');
    expect(wrapper.text()).toContain('房型管理');
    expect(wrapper.text()).toContain('管理员');
    await wrapper.find('.layout-user').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('退出登录');
  });

  it('RECEPTIONIST 不显示 ADMIN 专属菜单', async () => {
    const { wrapper } = await mountLayout('RECEPTIONIST');

    expect(wrapper.text()).toContain('房态看板');
    expect(wrapper.text()).not.toContain('员工管理');
    expect(wrapper.text()).not.toContain('房型管理');
    expect(wrapper.text()).toContain('前台');
  });

  it('侧边栏折叠按钮可切换并保持页面可渲染', async () => {
    const { wrapper } = await mountLayout('ADMIN');
    const uiStore = useUiStore();
    const initial = uiStore.sidebarCollapsed;

    await wrapper
      .find('button[aria-label="展开侧边栏"], button[aria-label="折叠侧边栏"]')
      .trigger('click');

    expect(uiStore.sidebarCollapsed).toBe(!initial);
    expect(wrapper.find('.layout-main').exists()).toBe(true);
  });
});
