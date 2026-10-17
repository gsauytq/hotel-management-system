<script setup lang="ts">
import type { GuestDto } from '@hms/shared';
import { onBeforeUnmount, ref } from 'vue';

import { listGuests } from '@/api/guests';
import { toApiRequestError } from '@/utils/errors';

defineProps<{
  modelValue: number | undefined;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: number | undefined];
}>();

const guests = ref<GuestDto[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const loadedOnce = ref(false);
let loadSequence = 0;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

async function loadGuests(keyword: string): Promise<void> {
  const sequence = ++loadSequence;
  loading.value = true;
  errorMessage.value = '';
  try {
    const response = await listGuests({
      page: 1,
      pageSize: 20,
      ...(keyword.trim() === '' ? {} : { keyword: keyword.trim() }),
      sort: 'createdAt:desc',
    });
    if (sequence !== loadSequence) return;
    guests.value = response.items;
    loadedOnce.value = true;
  } catch (error) {
    if (sequence !== loadSequence) return;
    guests.value = [];
    errorMessage.value = toApiRequestError(error).message;
  } finally {
    if (sequence === loadSequence) {
      loading.value = false;
    }
  }
}

function handleRemoteSearch(query: string): void {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    void loadGuests(query);
  }, 300);
}

function handleVisibleChange(visible: boolean): void {
  if (visible && !loadedOnce.value) {
    void loadGuests('');
  }
}

function handleChange(value: unknown): void {
  emit('update:modelValue', typeof value === 'number' ? value : undefined);
}

function retry(): void {
  void loadGuests('');
}

onBeforeUnmount(() => {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
  }
});
</script>

<template>
  <div class="guest-picker">
    <el-select
      :model-value="modelValue"
      :disabled="disabled"
      :loading="loading"
      filterable
      remote
      clearable
      :remote-method="handleRemoteSearch"
      placeholder="搜索客人姓名或手机号"
      class="guest-picker__select"
      @visible-change="handleVisibleChange"
      @change="handleChange"
    >
      <el-option
        v-for="guest in guests"
        :key="guest.id"
        :value="guest.id"
        :label="`${guest.name} · ${guest.phone}`"
      >
        <span class="guest-option">
          <span class="guest-option__name">{{ guest.name }}</span>
          <span class="guest-option__phone">{{ guest.phone }}</span>
        </span>
      </el-option>
      <el-option v-if="!loading && guests.length === 0 && errorMessage === ''" disabled value="">
        暂无可选客人，请先创建客人档案
      </el-option>
    </el-select>
    <div v-if="errorMessage !== ''" class="guest-picker__error">
      <span>{{ errorMessage }}</span>
      <el-button link type="primary" @click="retry">重试</el-button>
    </div>
  </div>
</template>

<style scoped>
.guest-picker {
  width: 100%;
}

.guest-picker__select {
  width: 100%;
}

.guest-picker__error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  color: var(--el-color-danger);
  font-size: 12px;
}

.guest-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.guest-option__name {
  font-weight: 500;
}

.guest-option__phone {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
