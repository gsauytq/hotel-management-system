<script setup lang="ts">
import { useRouter } from 'vue-router';

import { APP_NAME } from '@/constants/display';

const router = useRouter();

function goHome(): void {
  void router.replace('/rooms');
}
</script>

<template>
  <div class="not-found">
    <el-result icon="warning" title="404" :sub-title="`页面不存在 · ${APP_NAME}`">
      <template #extra>
        <el-button type="primary" @click="goHome">返回后台首页</el-button>
      </template>
    </el-result>
  </div>
</template>

<style scoped>
.not-found {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-bg-color-page);
}
</style>
