import type { Role } from '@hms/shared';
import type { Component } from 'vue';
import type { RouteRecordRaw } from 'vue-router';

import {
  Calendar,
  DataAnalysis,
  DataBoard,
  House,
  OfficeBuilding,
  Setting,
  Tickets,
  User,
  UserFilled,
  Wallet,
} from '@element-plus/icons-vue';

export interface MenuGroupDefinition {
  label: string;
  order: number;
  icon: Component;
}

/**
 * 菜单分组是导航结构的唯一分组定义；路由只引用 key，不重复菜单名称。
 */
export const MENU_GROUPS = {
  overview: { label: '经营概览', order: 10, icon: DataAnalysis },
  rooms: { label: '客房管理', order: 20, icon: OfficeBuilding },
  guests: { label: '客户管理', order: 30, icon: User },
  reservations: { label: '预订与入住', order: 40, icon: Calendar },
  billing: { label: '账单管理', order: 50, icon: Wallet },
  system: { label: '系统管理', order: 60, icon: Setting },
} as const satisfies Record<string, MenuGroupDefinition>;

export type MenuGroupKey = keyof typeof MENU_GROUPS;

declare module 'vue-router' {
  interface RouteMeta {
    /** 无需登录即可访问（登录页、404） */
    public?: boolean;
    /** 页面标题 / 菜单名称 / 浏览器标题（唯一来源） */
    title?: string;
    /** 页面说明，由 PageContainer 自动读取 */
    description?: string;
    /** 允许访问的角色；缺省表示任意已登录用户 */
    roles?: Role[];
    /** 是否出现在侧边菜单 */
    menu?: boolean;
    /** 菜单分组 */
    menuGroup?: MenuGroupKey;
    /** 同组内排序 */
    menuOrder?: number;
    /** 菜单图标 */
    icon?: Component;
    /** 详情页高亮的菜单路径 */
    activeMenu?: string;
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    component: () => import('../layouts/AuthLayout.vue'),
    children: [
      {
        path: '',
        name: 'login',
        component: () => import('../views/login/LoginView.vue'),
        meta: { public: true, title: '登录' },
      },
    ],
  },
  {
    path: '/change-password',
    component: () => import('../layouts/AuthLayout.vue'),
    children: [
      {
        path: '',
        name: 'change-password',
        component: () => import('../views/login/ChangePasswordView.vue'),
        meta: { title: '修改密码' },
      },
    ],
  },
  {
    path: '/',
    component: () => import('../layouts/DefaultLayout.vue'),
    redirect: '/rooms',
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('../views/dashboard/DashboardView.vue'),
        meta: {
          title: '经营看板',
          description: '后端统计接口与口径未批准，当前不展示经营指标数据。',
          menu: true,
          menuGroup: 'overview',
          menuOrder: 10,
          icon: DataBoard,
        },
      },
      {
        path: 'rooms',
        name: 'rooms',
        component: () => import('../views/rooms/RoomsView.vue'),
        meta: {
          title: '房态看板',
          description: '查询客房、维护房号/房型/备注并执行房态操作。',
          menu: true,
          menuGroup: 'rooms',
          menuOrder: 10,
          icon: House,
        },
      },
      {
        path: 'room-types',
        name: 'room-types',
        component: () => import('../views/room-types/RoomTypesView.vue'),
        meta: {
          title: '房型管理',
          description: '维护房型、基准价格与归档状态。',
          menu: true,
          menuGroup: 'rooms',
          menuOrder: 20,
          icon: OfficeBuilding,
          roles: ['ADMIN'],
        },
      },
      {
        path: 'guests',
        name: 'guests',
        component: () => import('../views/guests/GuestsView.vue'),
        meta: {
          title: '客人档案',
          description: '查询与维护客人档案，证件号始终掩码展示。',
          menu: true,
          menuGroup: 'guests',
          menuOrder: 10,
          icon: User,
        },
      },
      {
        path: 'bookings',
        name: 'bookings',
        component: () => import('../views/bookings/BookingListView.vue'),
        meta: {
          title: '预订管理',
          description: '查询、创建、查看预订详情并执行取消/未到操作；入住时分配具体房间。',
          menu: true,
          menuGroup: 'reservations',
          menuOrder: 10,
          icon: Tickets,
        },
      },
      {
        path: 'bookings/:id',
        name: 'booking-detail',
        component: () => import('../views/bookings/BookingDetailView.vue'),
        meta: {
          title: '预订详情',
          description: '查看预订、价格、状态及取消/未到操作。',
          activeMenu: '/bookings',
        },
      },
      {
        path: 'stays',
        name: 'stays',
        component: () => import('../views/stays/StayListView.vue'),
        meta: {
          title: '在住管理',
          description: '查询待入住预订、办理入住、查看在住/历史记录并办理退房结算。',
          menu: true,
          menuGroup: 'reservations',
          menuOrder: 20,
          icon: Calendar,
        },
      },
      {
        path: 'stays/:id',
        name: 'stay-detail',
        component: () => import('../views/stays/StayDetailView.vue'),
        meta: {
          title: '入住详情',
          description: '查看入住时间、客房、费用累计与账单摘要，并办理退房结算。',
          activeMenu: '/stays',
        },
      },
      {
        path: 'orders',
        name: 'orders',
        component: () => import('../views/orders/OrderListView.vue'),
        meta: {
          title: '账单查询',
          description: '按账单日期与关联入住查询退房账单；账单只读，支付信息为内部收银记录。',
          menu: true,
          menuGroup: 'billing',
          menuOrder: 10,
          icon: Wallet,
        },
      },
      {
        path: 'orders/:id',
        name: 'order-detail',
        component: () => import('../views/orders/OrderDetailView.vue'),
        meta: {
          title: '账单详情',
          description: '查看服务端账单金额、费用明细与内部收银记录（只读）。',
          activeMenu: '/orders',
        },
      },
      {
        path: 'users',
        name: 'users',
        component: () => import('../views/users/UsersView.vue'),
        meta: {
          title: '员工管理',
          description: '维护员工账号、角色与启停状态。',
          menu: true,
          menuGroup: 'system',
          menuOrder: 10,
          icon: UserFilled,
          roles: ['ADMIN'],
        },
      },
      {
        path: '403',
        name: 'forbidden',
        component: () => import('../views/error/ForbiddenView.vue'),
        meta: { title: '无权限访问' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../views/error/NotFoundView.vue'),
    meta: { public: true, title: '页面不存在' },
  },
];
