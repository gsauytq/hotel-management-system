<script setup lang="ts">
import { ArrowDown, Expand, Fold, Lock, SwitchButton } from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { APP_NAME, APP_SHORT_NAME, ROLE_LABELS } from '@/constants/display';
import { buildMenuSections, getActiveMenuKey, getBreadcrumbs } from '@/router/menu';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';

const NARROW_BREAKPOINT = 1100;

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const uiStore = useUiStore();

const menuSections = computed(() =>
  authStore.user === null ? [] : buildMenuSections(authStore.user.role),
);
const breadcrumbs = computed(() => getBreadcrumbs(route, authStore.user?.role));
const activeMenu = computed(() => getActiveMenuKey(route));
const sidebarCollapsed = computed(() => uiStore.sidebarCollapsed);
const sidebarWidth = computed(() =>
  sidebarCollapsed.value ? 'var(--hms-sidebar-collapsed-width)' : 'var(--hms-sidebar-width)',
);

const userDisplayName = computed(() => authStore.user?.displayName ?? '未登录');
const userRoleLabel = computed(() =>
  authStore.user === null ? '' : ROLE_LABELS[authStore.user.role],
);
const userInitial = computed(() => userDisplayName.value.charAt(0));

let wasNarrow = false;

function handleResize(): void {
  const narrow = window.innerWidth < NARROW_BREAKPOINT;
  if (narrow && !wasNarrow) {
    uiStore.setSidebarCollapsed(true);
  }
  wasNarrow = narrow;
}

function toggleSidebar(): void {
  uiStore.toggleSidebar();
}

async function handleUserCommand(command: unknown): Promise<void> {
  if (command === 'change-password') {
    await router.push({ name: 'change-password' });
    return;
  }
  if (command !== 'logout') return;
  await authStore.logout();
  await router.replace({ name: 'login' });
}

onMounted(() => {
  wasNarrow = window.innerWidth < NARROW_BREAKPOINT;
  if (wasNarrow) {
    uiStore.setSidebarCollapsed(true);
  }
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
});
</script>

<template>
  <el-container class="layout">
    <el-aside :width="sidebarWidth" class="layout-aside">
      <div class="layout-brand" :title="APP_NAME">
        <span class="layout-brand__mark">{{ APP_SHORT_NAME }}</span>
        <span v-if="!sidebarCollapsed" class="layout-brand__name">酒店管理系统</span>
      </div>

      <el-scrollbar class="layout-menu-scroll">
        <el-menu
          :default-active="activeMenu"
          :collapse="sidebarCollapsed"
          :collapse-transition="false"
          router
          class="layout-menu"
        >
          <el-menu-item-group
            v-for="section in menuSections"
            :key="section.key"
            :title="section.label"
          >
            <el-menu-item v-for="item in section.items" :key="item.index" :index="item.index">
              <el-icon v-if="item.icon">
                <component :is="item.icon" />
              </el-icon>
              <template #title>{{ item.label }}</template>
            </el-menu-item>
          </el-menu-item-group>
        </el-menu>
      </el-scrollbar>

      <div v-if="!sidebarCollapsed" class="layout-aside__footer">v0.1.0 · 内部管理后台</div>
    </el-aside>

    <el-container class="layout-body">
      <el-header class="layout-header">
        <div class="layout-header__left">
          <el-button
            text
            class="layout-header__toggle"
            :aria-label="sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'"
            :title="sidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'"
            @click="toggleSidebar"
          >
            <el-icon :size="18">
              <Expand v-if="sidebarCollapsed" />
              <Fold v-else />
            </el-icon>
          </el-button>

          <el-breadcrumb class="layout-breadcrumb" separator="/">
            <el-breadcrumb-item
              v-for="(item, index) in breadcrumbs"
              :key="`${item.label}-${index}`"
              :to="item.to"
            >
              {{ item.label }}
            </el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <div class="layout-header__right">
          <el-dropdown trigger="click" @command="handleUserCommand">
            <button class="layout-user" type="button">
              <el-avatar :size="30" class="layout-user__avatar">{{ userInitial }}</el-avatar>
              <span class="layout-user__meta">
                <span class="layout-user__name">{{ userDisplayName }}</span>
                <span class="layout-user__role">{{ userRoleLabel }}</span>
              </span>
              <el-icon class="layout-user__arrow"><ArrowDown /></el-icon>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="change-password">
                  <el-icon><Lock /></el-icon>
                  修改密码
                </el-dropdown-item>
                <el-dropdown-item command="logout">
                  <el-icon><SwitchButton /></el-icon>
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="layout-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100vh;
  overflow: hidden;
}

.layout-aside {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color-light);
  transition: width 0.2s ease;
}

.layout-brand {
  height: var(--hms-header-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 12px;
  overflow: hidden;
  border-bottom: 1px solid var(--el-border-color-light);
  white-space: nowrap;
}

.layout-brand__mark {
  color: var(--el-color-primary);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.layout-brand__name {
  color: var(--el-text-color-primary);
  font-size: 14px;
  font-weight: 600;
}

.layout-menu-scroll {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.layout-menu {
  border-right: none;
}

.layout-menu :deep(.el-menu-item-group__title) {
  padding: 14px 20px 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

:deep(.layout-menu.el-menu--collapse .el-menu-item-group__title) {
  display: none;
}

.layout-aside__footer {
  flex-shrink: 0;
  padding: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  color: var(--el-text-color-placeholder);
  font-size: 11px;
  text-align: center;
}

.layout-body {
  min-width: 0;
  height: 100vh;
}

.layout-header {
  height: var(--hms-header-height);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 16px;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
}

.layout-header__left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.layout-header__toggle {
  flex-shrink: 0;
}

.layout-breadcrumb {
  min-width: 0;
  overflow: hidden;
}

.layout-breadcrumb :deep(.el-breadcrumb) {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.layout-header__right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.layout-user {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.layout-user:hover {
  background: var(--el-fill-color-light);
}

.layout-user__avatar {
  flex-shrink: 0;
  background: var(--el-color-primary);
  color: #ffffff;
  font-size: 13px;
}

.layout-user__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.25;
}

.layout-user__name {
  font-size: 13px;
  font-weight: 500;
}

.layout-user__role {
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.layout-user__arrow {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.layout-main {
  padding: 0;
  background: var(--el-bg-color-page);
  overflow-y: auto;
}

@media (max-width: 900px) {
  .layout-header {
    padding: 0 12px;
  }

  .layout-user__meta {
    display: none;
  }
}

@media (max-width: 640px) {
  .layout-breadcrumb {
    display: none;
  }
}
</style>
