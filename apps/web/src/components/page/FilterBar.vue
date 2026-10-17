<template>
  <el-card shadow="never" class="filter-bar">
    <div class="filter-bar__content">
      <div class="filter-bar__fields">
        <slot />
      </div>
      <div v-if="$slots.actions" class="filter-bar__actions">
        <slot name="actions" />
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.filter-bar :deep(.el-card__body) {
  padding: 16px;
}

.filter-bar__content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.filter-bar__fields {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}

.filter-bar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
