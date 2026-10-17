import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it } from 'vitest';

import {
  buildMenuSections,
  getActiveMenuKey,
  getBreadcrumbs,
  type MenuSection,
} from '../src/router/menu';
import { routes } from '../src/router/routes';

const router = createRouter({ history: createMemoryHistory(), routes });

function flattenIndexes(sections: MenuSection[]): string[] {
  return sections.flatMap((section) => section.items.map((item) => item.index));
}

describe('菜单与面包屑（由路由 meta 派生）', () => {
  it('按批准的分组顺序生成完整菜单', () => {
    const sections = buildMenuSections('ADMIN');

    expect(sections.map((section) => section.label)).toEqual([
      '经营概览',
      '客房管理',
      '客户管理',
      '预订与入住',
      '账单管理',
      '系统管理',
    ]);
    expect(flattenIndexes(sections)).toEqual([
      '/dashboard',
      '/rooms',
      '/room-types',
      '/guests',
      '/bookings',
      '/stays',
      '/orders',
      '/users',
    ]);
  });

  it('按角色过滤 ADMIN 专属菜单（前端仅 UX，后端仍鉴权）', () => {
    const receptionistIndexes = flattenIndexes(buildMenuSections('RECEPTIONIST'));

    expect(receptionistIndexes).toContain('/rooms');
    expect(receptionistIndexes).toContain('/bookings');
    expect(receptionistIndexes).not.toContain('/room-types');
    expect(receptionistIndexes).not.toContain('/users');
  });

  it('菜单名称与对应路由 meta.title 一致', () => {
    for (const section of buildMenuSections('ADMIN')) {
      for (const item of section.items) {
        const resolved = router.resolve(item.index);
        expect(resolved.meta.title).toBe(item.label);
        expect(resolved.meta.menu).toBe(true);
        expect(resolved.meta.menuGroup).toBe(section.key);
      }
    }
  });

  it('列表页面包屑为“分组 / 页面”', () => {
    const breadcrumbs = getBreadcrumbs(router.resolve('/bookings'), 'RECEPTIONIST');

    expect(breadcrumbs.map((item) => item.label)).toEqual(['预订与入住', '预订管理']);
  });

  it('详情页面包屑包含父级链接并保持菜单高亮', () => {
    const detailRoute = router.resolve('/bookings/42');

    expect(getActiveMenuKey(detailRoute)).toBe('/bookings');
    const breadcrumbs = getBreadcrumbs(detailRoute, 'RECEPTIONIST');
    expect(breadcrumbs.map((item) => item.label)).toEqual(['预订与入住', '预订管理', '预订详情']);
    expect(breadcrumbs[1]?.to).toBe('/bookings');
  });

  it('经营看板与未知路由有稳定面包屑', () => {
    expect(getBreadcrumbs(router.resolve('/dashboard'), 'ADMIN').map((item) => item.label)).toEqual(
      ['经营概览', '经营看板'],
    );
    expect(
      getBreadcrumbs(router.resolve('/missing-page'), 'ADMIN').map((item) => item.label),
    ).toEqual(['页面不存在']);
  });
});
