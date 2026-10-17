<script setup lang="ts">
import type { BookingDetailDto } from '@hms/shared';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { cancelBooking, getBooking, markBookingNoShow } from '@/api/bookings';
import BookingStatusTag from '@/components/bookings/BookingStatusTag.vue';
import PageContainer from '@/components/page/PageContainer.vue';
import { isApiRequestError, toApiRequestError } from '@/utils/errors';
import { formatDateTime, formatMoney } from '@/utils/format';
import { hotelToday } from '@/utils/hotel-date';

type ActionKind = 'cancel' | 'no-show' | null;

const route = useRoute();
const router = useRouter();

const bookingId = computed<number | null>(() => {
  const raw = route.params['id'];
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value > 0 ? value : null;
});

const loading = ref(false);
const loadError = ref('');
const booking = ref<BookingDetailDto | null>(null);
const actionLoading = ref<ActionKind>(null);
let loadSequence = 0;

const canCancel = computed(() => booking.value?.status === 'CONFIRMED');
const canNoShow = computed(
  () => booking.value?.status === 'CONFIRMED' && booking.value.checkInDate <= hotelToday(),
);
const noShowNotDue = computed(() => booking.value?.status === 'CONFIRMED' && !canNoShow.value);

async function loadBooking(): Promise<void> {
  const sequence = ++loadSequence;
  const id = bookingId.value;
  if (id === null) {
    loading.value = false;
    loadError.value = '无效的预订编号';
    booking.value = null;
    return;
  }

  loading.value = true;
  loadError.value = '';
  try {
    const detail = await getBooking(id);
    if (sequence !== loadSequence) return;
    booking.value = detail;
  } catch (error) {
    if (sequence !== loadSequence) return;
    booking.value = null;
    loadError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === loadSequence) {
      loading.value = false;
    }
  }
}

async function handleCancel(): Promise<void> {
  if (booking.value === null || actionLoading.value !== null) return;

  let reason: string | undefined;
  try {
    const result = await ElMessageBox.prompt('可选填写取消原因（最多 200 字）', '取消预订', {
      confirmButtonText: '确认取消',
      cancelButtonText: '返回',
      inputType: 'textarea',
      inputPlaceholder: '取消原因（可选）',
      inputValidator: (value: string) =>
        (value ?? '').length <= 200 || '取消原因不得超过 200 个字符',
      type: 'warning',
      autofocus: false,
    });
    reason = result.value.trim() === '' ? undefined : result.value.trim();
  } catch {
    return;
  }

  actionLoading.value = 'cancel';
  try {
    const updated = await cancelBooking(booking.value.id, { reason });
    booking.value = updated;
    ElMessage.success('预订已取消');
  } catch (error) {
    if (!isApiRequestError(error)) {
      ElMessage.error(error instanceof Error ? error.message : '取消预订失败');
    }
    if (isApiRequestError(error) && error.status === 409) {
      await loadBooking();
    }
  } finally {
    actionLoading.value = null;
  }
}

async function handleNoShow(): Promise<void> {
  if (booking.value === null || actionLoading.value !== null) return;

  try {
    await ElMessageBox.confirm(
      `确认将预订 #${booking.value.id} 标记为未到吗？该操作将释放房量。`,
      '标记未到',
      {
        type: 'warning',
        confirmButtonText: '标记未到',
        cancelButtonText: '返回',
        autofocus: false,
      },
    );
  } catch {
    return;
  }

  actionLoading.value = 'no-show';
  try {
    const updated = await markBookingNoShow(booking.value.id);
    booking.value = updated;
    ElMessage.success('预订已标记为未到');
  } catch (error) {
    if (!isApiRequestError(error)) {
      ElMessage.error(error instanceof Error ? error.message : '标记未到失败');
    }
    if (isApiRequestError(error) && error.status === 409) {
      await loadBooking();
    }
  } finally {
    actionLoading.value = null;
  }
}

function backToList(): void {
  void router.push({ name: 'bookings' });
}

watch(
  bookingId,
  () => {
    void loadBooking();
  },
  { immediate: true },
);
</script>

<template>
  <PageContainer>
    <template #actions>
      <el-button @click="backToList">返回列表</el-button>
      <el-button
        v-if="canCancel"
        type="danger"
        plain
        :loading="actionLoading === 'cancel'"
        :disabled="actionLoading !== null"
        @click="handleCancel"
      >
        取消预订
      </el-button>
      <el-button
        v-if="canNoShow"
        type="warning"
        plain
        :loading="actionLoading === 'no-show'"
        :disabled="actionLoading !== null"
        @click="handleNoShow"
      >
        标记未到
      </el-button>
    </template>

    <div v-if="loading" class="detail-loading">
      <el-skeleton :rows="6" animated />
    </div>

    <el-result
      v-else-if="loadError !== ''"
      icon="error"
      title="预订详情加载失败"
      :sub-title="loadError"
    >
      <template #extra>
        <el-button @click="backToList">返回列表</el-button>
        <el-button type="primary" @click="loadBooking">重试</el-button>
      </template>
    </el-result>

    <template v-else-if="booking !== null">
      <el-card shadow="never">
        <template #header>
          <div class="detail-header">
            <span>预订 #{{ booking.id }}</span>
            <BookingStatusTag :status="booking.status" />
          </div>
        </template>

        <el-descriptions :column="2" border>
          <el-descriptions-item label="客人">
            {{ booking.guestName }} · {{ booking.guestPhone }}
          </el-descriptions-item>
          <el-descriptions-item label="房型">{{ booking.roomTypeName }}</el-descriptions-item>
          <el-descriptions-item label="入住日期">{{ booking.checkInDate }}</el-descriptions-item>
          <el-descriptions-item label="退房日期">{{ booking.checkOutDate }}</el-descriptions-item>
          <el-descriptions-item label="房间数">{{ booking.roomCount }}</el-descriptions-item>
          <el-descriptions-item label="房价">
            {{ formatMoney(booking.pricePerNight) }} / 晚
          </el-descriptions-item>
          <el-descriptions-item label="总价">
            {{ formatMoney(booking.totalPrice) }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">
            {{ formatDateTime(booking.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="更新时间">
            {{ formatDateTime(booking.updatedAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="备注">{{ booking.note ?? '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="booking.stayId !== null" label="入住记录">
            #{{ booking.stayId }}
          </el-descriptions-item>
          <el-descriptions-item v-if="booking.cancelledAt !== null" label="取消时间">
            {{ formatDateTime(booking.cancelledAt) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="booking.cancelReason !== null" label="取消原因" :span="2">
            {{ booking.cancelReason }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-alert
        v-if="noShowNotDue"
        type="info"
        title="入住日未到，暂不可标记未到；到达入住日后可使用该操作。"
        :closable="false"
        show-icon
      />
    </template>
  </PageContainer>
</template>

<style scoped>
.detail-loading {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  padding: 20px;
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
</style>
