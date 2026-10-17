import type { Router } from 'vue-router';

import { useAuthStore } from '@/stores/auth';

import { isRoleAllowed } from './access';
import { resolveSafeRedirect } from './redirect';

const DEFAULT_AUTHENTICATED_ROUTE = '/rooms';

/**
 * 安装认证与角色守卫。
 * - 首次导航：先 fetchMe 重建会话（ADR-002 刷新后重建）；
 * - 未登录访问受保护路由 → /login?redirect=...；
 * - 角色不符 → /403；
 * - 已登录访问登录页 → 安全 redirect 或默认首页。
 *
 * 前端角色守卫仅用于 UX，后端仍对每个受保护 API 独立鉴权（架构 §2.9）。
 */
export function installAuthGuards(router: Router): void {
  router.beforeEach(async (to) => {
    const authStore = useAuthStore();
    if (!authStore.booted) {
      await authStore.fetchMe();
    }

    if (to.meta.public === true) {
      if (to.name === 'login' && authStore.isAuthenticated) {
        return resolveSafeRedirect(to.query.redirect) ?? DEFAULT_AUTHENTICATED_ROUTE;
      }
      return true;
    }

    if (!authStore.isAuthenticated) {
      return {
        name: 'login',
        query: { redirect: to.fullPath },
      };
    }

    if (!isRoleAllowed(authStore.user?.role, to.meta.roles)) {
      return { name: 'forbidden' };
    }

    return true;
  });
}
