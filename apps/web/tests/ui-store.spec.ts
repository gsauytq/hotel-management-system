import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { beforeEach, describe, expect, it } from 'vitest';

import { useUiStore } from '../src/stores/ui';

const STORAGE_KEY = 'hms.ui.sidebarCollapsed';

describe('useUiStore（侧边栏折叠）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setActivePinia(createPinia());
  });

  it('默认展开，切换后持久化折叠状态', async () => {
    const store = useUiStore();
    expect(store.sidebarCollapsed).toBe(false);

    store.toggleSidebar();
    await nextTick();

    expect(store.sidebarCollapsed).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('创建 Store 时读取已持久化的折叠状态', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    setActivePinia(createPinia());

    const store = useUiStore();

    expect(store.sidebarCollapsed).toBe(true);
  });
});
