<script setup lang="ts">
import type { RoomTypeDto } from '@hms/shared';
import { computed, ref, watch } from 'vue';

import { getRoomType } from '@/api/room-types';
import { ROOM_TYPE_STATUS_LABELS, ROOM_TYPE_STATUS_TAG_TYPES } from '@/constants/rooms';
import { toApiRequestError } from '@/utils/errors';
import { formatDateTime, formatMoney } from '@/utils/format';

const props = defineProps<{
  modelValue: boolean;
  roomTypeId: number | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const loading = ref(false);
const errorMessage = ref('');
const detail = ref<RoomTypeDto | null>(null);

async function loadDetail(): Promise<void> {
  if (props.roomTypeId === null) return;
  loading.value = true;
  errorMessage.value = '';
  try {
    detail.value = await getRoomType(props.roomTypeId);
  } catch (error) {
    detail.value = null;
    errorMessage.value = toApiRequestError(error).message;
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.modelValue, props.roomTypeId] as const,
  ([open]) => {
    if (open) {
      void loadDetail();
    } else {
      detail.value = null;
      errorMessage.value = '';
    }
  },
);
</script>

<template>
  <el-dialog v-model="visible" title="房型详情" width="min(600px, 92vw)">
    <div v-loading="loading" class="detail-body">
      <el-alert
        v-if="errorMessage !== ''"
        type="error"
        title="房型详情加载失败"
        :closable="false"
        show-icon
      >
        <span class="alert-body">
          <span>{{ errorMessage }}</span>
          <el-button size="small" @click="loadDetail">重试</el-button>
        </span>
      </el-alert>

      <el-descriptions v-else-if="detail !== null" :column="2" border>
        <el-descriptions-item label="房型代码">{{ detail.code }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="ROOM_TYPE_STATUS_TAG_TYPES[detail.status]" disable-transitions>
            {{ ROOM_TYPE_STATUS_LABELS[detail.status] }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="房型名称">{{ detail.name }}</el-descriptions-item>
        <el-descriptions-item label="基准房价">
          {{ formatMoney(detail.basePrice) }} / 晚
        </el-descriptions-item>
        <el-descriptions-item label="可住人数">{{ detail.capacity }} 人</el-descriptions-item>
        <el-descriptions-item label="未停用房间数">{{ detail.roomCount }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">
          {{ formatDateTime(detail.createdAt) }}
        </el-descriptions-item>
        <el-descriptions-item label="更新时间">
          {{ formatDateTime(detail.updatedAt) }}
        </el-descriptions-item>
        <el-descriptions-item label="描述" :span="2">
          {{ detail.description ?? '—' }}
        </el-descriptions-item>
      </el-descriptions>
    </div>
  </el-dialog>
</template>

<style scoped>
.detail-body {
  min-height: 120px;
}

.alert-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
