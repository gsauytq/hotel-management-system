<script setup lang="ts">
import FilterBar from './FilterBar.vue';
import PageContainer from './PageContainer.vue';
import TableCard from './TableCard.vue';

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
    <FilterBar>
      <span class="list-placeholder__filter-hint">
        筛选区域：业务任务接入查询条件后使用 FilterBar 统一布局
      </span>
      <template #actions>
        <el-button disabled>重置</el-button>
        <el-button type="primary" disabled>查询</el-button>
      </template>
    </FilterBar>

    <TableCard>
      <template #toolbar>
        <span class="list-placeholder__toolbar-title">数据列表</span>
        <div v-if="$slots.actions" class="list-placeholder__actions">
          <slot name="actions" />
        </div>
      </template>

      <el-empty description="页面骨架已建立，业务功能待开发">
        <p v-if="planned.length > 0" class="list-placeholder__planned">
          后续实现：{{ planned.join('、') }}
        </p>
      </el-empty>
    </TableCard>
  </PageContainer>
</template>

<style scoped>
.list-placeholder__filter-hint {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.list-placeholder__toolbar-title {
  font-weight: 600;
}

.list-placeholder__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.list-placeholder__planned {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
