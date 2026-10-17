import { ROLES, type Role } from '@hms/shared';
import type { Directive, DirectiveBinding } from 'vue';

import { isRoleAllowed } from '@/router/access';
import { useAuthStore } from '@/stores/auth';

export type PermissionBindingValue = Role | readonly Role[] | undefined;

const originalDisplay = new WeakMap<HTMLElement, string>();

function normalizeRoles(value: unknown): readonly Role[] {
  if (typeof value === 'string') {
    return (ROLES as readonly string[]).includes(value) ? [value as Role] : [];
  }
  if (Array.isArray(value)) {
    return value.filter(
      (item): item is Role =>
        typeof item === 'string' && (ROLES as readonly string[]).includes(item),
    );
  }
  return [];
}

function applyPermission(el: HTMLElement, binding: DirectiveBinding<PermissionBindingValue>): void {
  const authStore = useAuthStore();
  const allowed = isRoleAllowed(authStore.user?.role, normalizeRoles(binding.value));

  if (!originalDisplay.has(el)) {
    originalDisplay.set(el, el.style.display);
  }

  if (allowed) {
    el.style.display = originalDisplay.get(el) ?? '';
    el.removeAttribute('aria-hidden');
    return;
  }

  // 仅改变呈现：隐藏按钮不构成权限控制，后端仍必须独立鉴权（架构 §2.9）
  el.style.display = 'none';
  el.setAttribute('aria-hidden', 'true');
}

/**
 * 按钮/操作入口级权限指令（UX）。
 * 用法：v-permission="'ADMIN'" 或 v-permission="['ADMIN', 'RECEPTIONIST']"
 */
export const vPermission: Directive<HTMLElement, PermissionBindingValue> = {
  mounted(el, binding) {
    applyPermission(el, binding);
  },
  updated(el, binding) {
    applyPermission(el, binding);
  },
};

declare module 'vue' {
  interface GlobalDirectives {
    vPermission: typeof vPermission;
  }
}
