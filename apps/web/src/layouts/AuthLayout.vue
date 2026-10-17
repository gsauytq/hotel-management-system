<script setup lang="ts">
import { APP_NAME } from '@/constants/display';
</script>

<template>
  <div class="auth-layout">
    <el-card class="auth-card" shadow="never">
      <template #header>
        <div class="auth-title">{{ APP_NAME }}</div>
      </template>
      <router-view />
    </el-card>
    <p class="auth-footnote">内部管理后台 · 请勿共享账号</p>
  </div>
</template>

<style scoped>
.auth-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 16px;
  background: var(--el-bg-color-page);
}

.auth-card {
  width: min(380px, 100%);
}

.auth-title {
  font-size: 16px;
  font-weight: 600;
  text-align: center;
}

.auth-footnote {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
