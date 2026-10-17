import type { Role } from '@hms/shared';
import type { Component } from 'vue';
import type { RouteMeta, RouteRecordRaw } from 'vue-router';

import { isRoleAllowed } from './access';
import { MENU_GROUPS, routes, type MenuGroupKey } from './routes';

export interface MenuItem {
  index: string;
  label: string;
  icon: Component | undefined;
  roles: readonly Role[] | undefined;
}

export interface MenuSection {
  key: MenuGroupKey;
  label: string;
  icon: Component;
  items: MenuItem[];
}

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

interface CollectedMenuItem extends MenuItem {
  group: MenuGroupKey;
  order: number;
}

export interface RouteLike {
  path: string;
  meta: RouteMeta;
}

function resolveChildPath(parentPath: string, childPath: string): string {
  if (childPath.startsWith('/')) return childPath;
  if (childPath === '') return parentPath;
  return parentPath === '/' ? `/${childPath}` : `${parentPath}/${childPath}`;
}

function collectMenuItems(
  records: readonly RouteRecordRaw[],
  parentPath: string,
  output: CollectedMenuItem[],
): void {
  for (const record of records) {
    const fullPath = resolveChildPath(parentPath, record.path);
    const meta = record.meta;
    if (meta?.menu === true && typeof meta.title === 'string' && meta.menuGroup !== undefined) {
      output.push({
        index: fullPath,
        label: meta.title,
        icon: meta.icon,
        roles: meta.roles,
        group: meta.menuGroup,
        order: meta.menuOrder ?? 0,
      });
    }
    if (record.children !== undefined) {
      collectMenuItems(record.children, fullPath, output);
    }
  }
}

/**
 * 从路由配置派生当前角色可见的菜单。
 * 菜单名称、图标、分组、顺序、角色限制全部来自路由 meta，不另建菜单常量。
 */
export function buildMenuSections(role: Role | null | undefined): MenuSection[] {
  const collected: CollectedMenuItem[] = [];
  collectMenuItems(routes, '', collected);

  return (Object.keys(MENU_GROUPS) as MenuGroupKey[])
    .sort((a, b) => MENU_GROUPS[a].order - MENU_GROUPS[b].order)
    .map((key) => {
      const group = MENU_GROUPS[key];
      const items = collected
        .filter((item) => item.group === key && isRoleAllowed(role, item.roles))
        .sort((a, b) => a.order - b.order)
        .map<MenuItem>((item) => ({
          index: item.index,
          label: item.label,
          icon: item.icon,
          roles: item.roles,
        }));

      return {
        key,
        label: group.label,
        icon: group.icon,
        items,
      };
    })
    .filter((section) => section.items.length > 0);
}

/** 详情页通过 meta.activeMenu 保持所属菜单高亮 */
export function getActiveMenuKey(route: RouteLike): string {
  const activeMenu = route.meta.activeMenu;
  return typeof activeMenu === 'string' ? activeMenu : route.path;
}

/**
 * 由当前路由与菜单配置生成面包屑：
 * 分组 → 列表页 → 详情页（含列表页返回链接）。
 */
export function getBreadcrumbs(route: RouteLike, role: Role | null | undefined): BreadcrumbItem[] {
  const activeKey = getActiveMenuKey(route);
  const sections = buildMenuSections(role);

  for (const section of sections) {
    const item = section.items.find((candidate) => candidate.index === activeKey);
    if (item === undefined) continue;

    const breadcrumbs: BreadcrumbItem[] = [{ label: section.label }];
    const isCurrentPage = route.path === item.index;
    breadcrumbs.push(isCurrentPage ? { label: item.label } : { label: item.label, to: item.index });

    if (!isCurrentPage && typeof route.meta.title === 'string') {
      breadcrumbs.push({ label: route.meta.title });
    }
    return breadcrumbs;
  }

  return typeof route.meta.title === 'string' ? [{ label: route.meta.title }] : [];
}
