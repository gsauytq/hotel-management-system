<script setup lang="ts">
import { useRouter } from 'vue-router';

import PageContainer from '@/components/page/PageContainer.vue';

const router = useRouter();

function goHome(): void {
  void router.replace('/rooms');
}
</script>

<template>
  <PageContainer>
    <el-result icon="warning" title="403" sub-title="当前账号无权访问该页面">
      <template #extra>
        <el-button type="primary" @click="goHome">返回首页</el-button>
      </template>
    </el-result>
  </PageContainer>
</template>
