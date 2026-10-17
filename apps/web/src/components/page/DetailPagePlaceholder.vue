<script setup lang="ts">
import PageContainer from './PageContainer.vue';

withDefaults(
  defineProps<{
    /** 后续任务计划实现的内容，仅用于占位展示 */
    planned?: string[];
  }>(),
  { planned: () => [] },
);
</script>

<template>
  <PageContainer>
    <el-card shadow="never">
      <el-empty description="详情页骨架已建立，业务功能待开发">
        <p v-if="planned.length > 0" class="detail-placeholder__planned">
          后续实现：{{ planned.join('、') }}
        </p>
      </el-empty>
    </el-card>
  </PageContainer>
</template>

<style scoped>
.detail-placeholder__planned {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
