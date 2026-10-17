import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import { createApp } from 'vue';

import 'element-plus/dist/index.css';
import './styles/index.css';
import App from './App.vue';
import { setUnauthorizedHandler } from './api/request';
import { vPermission } from './directives/permission';
import { installAuthGuards } from './router/guards';
import { router } from './router/index';
import { useAuthStore } from './stores/auth';

const pinia = createPinia();
const app = createApp(App);

app.use(pinia);
app.use(ElementPlus, { locale: zhCn });
app.directive('permission', vPermission);

const authStore = useAuthStore(pinia);

setUnauthorizedHandler(() => {
  authStore.clearSession();
  const currentRoute = router.currentRoute.value;
  if (currentRoute.name === 'login') return;
  void router.replace({
    name: 'login',
    query: { redirect: currentRoute.fullPath, reason: 'expired' },
  });
});

// 守卫依赖 Pinia 已激活；必须在 app.use(router) 触发首次导航前安装。
installAuthGuards(router);
app.use(router);

app.mount('#app');
