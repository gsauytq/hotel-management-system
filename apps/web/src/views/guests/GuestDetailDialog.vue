<script setup lang="ts">
import type { GuestDetailDto } from '@hms/shared';
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { getGuest } from '@/api/guests';
import BookingStatusTag from '@/components/bookings/BookingStatusTag.vue';
import { ID_TYPE_LABELS } from '@/constants/guests';
import { toApiRequestError } from '@/utils/errors';
import { formatDateOnly, formatDateTime } from '@/utils/format';

const props = defineProps<{
  modelValue: boolean;
  guestId: number | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const router = useRouter();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const loading = ref(false);
const errorMessage = ref('');
const guest = ref<GuestDetailDto | null>(null);

async function loadDetail(): Promise<void> {
  if (props.guestId === null) return;
  loading.value = true;
  errorMessage.value = '';
  try {
    guest.value = await getGuest(props.guestId);
  } catch (error) {
    guest.value = null;
    errorMessage.value = toApiRequestError(error).message;
  } finally {
    loading.value = false;
  }
}

function openBooking(bookingId: number): void {
  visible.value = false;
  void router.push({ name: 'booking-detail', params: { id: bookingId } });
}

watch(
  () => [props.modelValue, props.guestId] as const,
  ([open]) => {
    if (open) {
      void loadDetail();
    } else {
      guest.value = null;
      errorMessage.value = '';
    }
  },
);
</script>

<template>
  <el-dialog v-model="visible" title="客人档案详情" width="min(700px, 94vw)">
    <div v-loading="loading" class="detail-body">
      <el-alert
        v-if="errorMessage !== ''"
        type="error"
        title="客人档案加载失败"
        :closable="false"
        show-icon
      >
        <span class="alert-body">
          <span>{{ errorMessage }}</span>
          <el-button size="small" @click="loadDetail">重试</el-button>
        </span>
      </el-alert>

      <template v-else-if="guest !== null">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="姓名">{{ guest.name }}</el-descriptions-item>
          <el-descriptions-item label="手机号">{{ guest.phone }}</el-descriptions-item>
          <el-descriptions-item label="证件类型">
            {{ ID_TYPE_LABELS[guest.idType] }}
          </el-descriptions-item>
          <el-descriptions-item label="证件号">
            {{ guest.idNumberMasked }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">
            {{ formatDateTime(guest.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="更新时间">
            {{ formatDateTime(guest.updatedAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">
            {{ guest.remark ?? '—' }}
          </el-descriptions-item>
        </el-descriptions>

        <p class="privacy-note">证件号仅显示服务端返回的掩码，前端不保存明文。</p>

        <h3 class="section-title">最近预订</h3>
        <el-table :data="guest.recentBookings" border>
          <el-table-column label="预订编号" width="100">
            <template #default="{ row }">#{{ row.id }}</template>
          </el-table-column>
          <el-table-column label="入住日期" width="120">
            <template #default="{ row }">{{ formatDateOnly(row.checkInDate) }}</template>
          </el-table-column>
          <el-table-column label="退房日期" width="120">
            <template #default="{ row }">{{ formatDateOnly(row.checkOutDate) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <BookingStatusTag :status="row.status" />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="{ row }">
              <el-button link type="primary" @click="openBooking(row.id)">查看</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无预订记录" />
          </template>
        </el-table>
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

.privacy-note {
  margin: 12px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.section-title {
  margin: 20px 0 12px;
  font-size: 15px;
  font-weight: 600;
}
</style>
