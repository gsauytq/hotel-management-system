<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const props = defineProps<{
  /** 缺省使用当前路由 meta.title */
  title?: string;
  /** 缺省使用当前路由 meta.description */
  description?: string;
}>();

const route = useRoute();

const pageTitle = computed(() => props.title ?? route.meta.title ?? '');
const pageDescription = computed(() => props.description ?? route.meta.description ?? '');
</script>

<template>
  <section class="page-container">
    <header v-if="pageTitle !== '' || $slots.actions" class="page-container__header">
      <div class="page-container__heading">
        <h1 v-if="pageTitle !== ''" class="page-container__title">{{ pageTitle }}</h1>
        <p v-if="pageDescription !== ''" class="page-container__description">
          {{ pageDescription }}
        </p>
      </div>
      <div v-if="$slots.actions" class="page-container__actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="page-container__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.page-container {
  width: 100%;
  max-width: 1600px;
  margin: 0 auto;
  padding: var(--hms-page-padding);
  display: flex;
  flex-direction: column;
  gap: var(--hms-page-gap);
}

.page-container__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.page-container__heading {
  min-width: 0;
}

.page-container__title {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
}

.page-container__description {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.page-container__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.page-container__body {
  display: flex;
  flex-direction: column;
  gap: var(--hms-page-gap);
  min-width: 0;
}
</style>
