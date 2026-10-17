import type { Role } from '@hms/shared';

/**
 * 前端角色判断（仅用于菜单/路由 UX）。
 * 真正的权限边界始终由后端 requireAuth / requireRole 与服务层裁决（架构 §2.9）。
 */
export function isRoleAllowed(
  role: Role | null | undefined,
  allowedRoles: readonly Role[] | undefined,
): boolean {
  if (allowedRoles === undefined) return true;
  if (role === null || role === undefined) return false;
  return allowedRoles.includes(role);
}
