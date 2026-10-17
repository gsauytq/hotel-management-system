<template>
  <el-card shadow="never" class="table-card">
    <template v-if="$slots.toolbar" #header>
      <div class="table-card__toolbar">
        <slot name="toolbar" />
      </div>
    </template>

    <div class="table-card__body">
      <slot />
    </div>

    <template v-if="$slots.footer" #footer>
      <div class="table-card__footer">
        <slot name="footer" />
      </div>
    </template>
  </el-card>
</template>

<style scoped>
.table-card :deep(.el-card__header) {
  padding: 12px 16px;
}

.table-card :deep(.el-card__body) {
  padding: 0;
}

.table-card :deep(.el-card__footer) {
  padding: 12px 16px;
}

.table-card__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.table-card__body {
  overflow-x: auto;
}

.table-card__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
</style>
