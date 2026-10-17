import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

const SIDEBAR_STORAGE_KEY = 'hms.ui.sidebarCollapsed';

function readStoredCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** 纯界面状态（架构 §2.5）：侧边栏折叠持久化到 localStorage。 */
export const useUiStore = defineStore('ui', () => {
  const sidebarCollapsed = ref(readStoredCollapsed());

  function setSidebarCollapsed(collapsed: boolean): void {
    sidebarCollapsed.value = collapsed;
  }

  function toggleSidebar(): void {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  watch(sidebarCollapsed, (collapsed) => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    } catch {
      // localStorage 不可用（隐私模式等）时仅放弃持久化
    }
  });

  return { sidebarCollapsed, setSidebarCollapsed, toggleSidebar };
});
