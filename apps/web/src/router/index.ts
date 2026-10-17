import { createRouter, createWebHistory } from 'vue-router';

import { APP_NAME } from '@/constants/display';

import { routes } from './routes';

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.afterEach((to) => {
  const title = to.meta.title;
  document.title = title === undefined ? APP_NAME : `${title} · ${APP_NAME}`;
});
