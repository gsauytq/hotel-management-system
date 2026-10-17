<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
</script>

<template>
  <div v-if="!authStore.booted" class="app-boot">
    <div class="app-boot__panel">
      <div class="app-boot__brand">HMS</div>
      <el-skeleton :rows="2" animated />
      <p class="app-boot__hint">正在检查登录状态…</p>
    </div>
  </div>
  <router-view v-else />
</template>

<style scoped>
.app-boot {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-bg-color-page);
}

.app-boot__panel {
  width: min(360px, calc(100vw - 32px));
}

.app-boot__brand {
  margin-bottom: 20px;
  text-align: center;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--el-color-primary);
}

.app-boot__hint {
  margin: 12px 0 0;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
