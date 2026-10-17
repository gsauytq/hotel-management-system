<script setup lang="ts">
import type { RoomDto } from '@hms/shared';
import { computed, ref, watch } from 'vue';

import { getRoom } from '@/api/rooms';
import RoomStatusTag from '@/components/rooms/RoomStatusTag.vue';
import { toApiRequestError } from '@/utils/errors';
import { formatDateOnly, formatDateTime } from '@/utils/format';

const props = defineProps<{
  modelValue: boolean;
  roomId: number | null;
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
const detail = ref<RoomDto | null>(null);

async function loadDetail(): Promise<void> {
  if (props.roomId === null) return;
  loading.value = true;
  errorMessage.value = '';
  try {
    detail.value = await getRoom(props.roomId);
  } catch (error) {
    detail.value = null;
    errorMessage.value = toApiRequestError(error).message;
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.modelValue, props.roomId] as const,
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
  <el-dialog v-model="visible" title="客房详情" width="min(620px, 92vw)">
    <div v-loading="loading" class="detail-body">
      <el-alert
        v-if="errorMessage !== ''"
        type="error"
        title="客房详情加载失败"
        :closable="false"
        show-icon
      >
        <span class="alert-body">
          <span>{{ errorMessage }}</span>
          <el-button size="small" @click="loadDetail">重试</el-button>
        </span>
      </el-alert>

      <template v-else-if="detail !== null">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="房号">{{ detail.roomNumber }}</el-descriptions-item>
          <el-descriptions-item label="房型">{{ detail.roomTypeName }}</el-descriptions-item>
          <el-descriptions-item label="房态">
            <RoomStatusTag :status="detail.status" />
          </el-descriptions-item>
          <el-descriptions-item label="备注">{{ detail.note ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">
            {{ formatDateTime(detail.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="更新时间">
            {{ formatDateTime(detail.updatedAt) }}
          </el-descriptions-item>
        </el-descriptions>

        <div v-if="detail.currentStay !== null" class="stay-section">
          <h3 class="stay-title">在住信息</h3>
          <el-descriptions :column="2" border>
            <el-descriptions-item label="入住记录">
              #{{ detail.currentStay.stayId }}
            </el-descriptions-item>
            <el-descriptions-item label="客人">
              {{ detail.currentStay.guestName }}
            </el-descriptions-item>
            <el-descriptions-item label="入住时间">
              {{ formatDateTime(detail.currentStay.checkInAt) }}
            </el-descriptions-item>
            <el-descriptions-item label="预计离店">
              {{ formatDateOnly(detail.currentStay.expectedCheckOutDate) }}
            </el-descriptions-item>
          </el-descriptions>
        </div>
      </template>
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

.stay-section {
  margin-top: 20px;
}

.stay-title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
}
</style>
