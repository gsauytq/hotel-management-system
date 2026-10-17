<script setup lang="ts">
import type { StayDetailDto } from '@hms/shared';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { getStay } from '@/api/stays';
import PageContainer from '@/components/page/PageContainer.vue';
import StayStatusTag from '@/components/stays/StayStatusTag.vue';
import { ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '@/constants/stays';
import { toApiRequestError } from '@/utils/errors';
import { formatDateOnly, formatDateTime, formatMoney } from '@/utils/format';

import CheckoutDialog from './CheckoutDialog.vue';

const route = useRoute();
const router = useRouter();

const stayId = computed<number | null>(() => {
  const raw = route.params['id'];
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value > 0 ? value : null;
});

const loading = ref(false);
const loadError = ref('');
const stay = ref<StayDetailDto | null>(null);
const checkoutVisible = ref(false);
let loadSequence = 0;

const canCheckout = computed(() => stay.value?.status === 'CHECKED_IN');

async function loadStay(): Promise<void> {
  const sequence = ++loadSequence;
  const id = stayId.value;
  if (id === null) {
    loading.value = false;
    loadError.value = '无效的入住记录编号';
    stay.value = null;
    return;
  }

  loading.value = true;
  loadError.value = '';
  try {
    const detail = await getStay(id);
    if (sequence !== loadSequence) return;
    stay.value = detail;
  } catch (error) {
    if (sequence !== loadSequence) return;
    stay.value = null;
    loadError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === loadSequence) {
      loading.value = false;
    }
  }
}

function backToList(): void {
  void router.push({ name: 'stays' });
}

function handleCheckedOut(): void {
  void loadStay();
}

watch(
  stayId,
  () => {
    void loadStay();
  },
  { immediate: true },
);
</script>

<template>
  <PageContainer>
    <template #actions>
      <el-button @click="backToList">返回列表</el-button>
      <el-button v-if="canCheckout" type="danger" plain @click="checkoutVisible = true">
        退房结算
      </el-button>
    </template>

    <div v-if="loading" class="detail-loading">
      <el-skeleton :rows="6" animated />
    </div>

    <el-result
      v-else-if="loadError !== ''"
      icon="error"
      title="入住详情加载失败"
      :sub-title="loadError"
    >
      <template #extra>
        <el-button @click="backToList">返回列表</el-button>
        <el-button type="primary" @click="loadStay">重试</el-button>
      </template>
    </el-result>

    <template v-else-if="stay !== null">
      <el-card shadow="never">
        <template #header>
          <div class="detail-header">
            <span>入住记录 #{{ stay.id }}</span>
            <StayStatusTag :status="stay.status" />
          </div>
        </template>

        <el-descriptions :column="2" border>
          <el-descriptions-item label="客人">{{ stay.guestName }}</el-descriptions-item>
          <el-descriptions-item label="房号 / 房型">
            {{ stay.roomNumber }} · {{ stay.roomTypeName }}
          </el-descriptions-item>
          <el-descriptions-item label="入住时间">
            {{ formatDateTime(stay.checkInAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="预计离店">
            {{ formatDateOnly(stay.expectedCheckOutDate) }}
          </el-descriptions-item>
          <el-descriptions-item label="实际退房时间">
            {{ formatDateTime(stay.actualCheckOutAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="房价">
            {{ formatMoney(stay.pricePerNight) }} / 晚
          </el-descriptions-item>
          <el-descriptions-item label="押金">
            {{ formatMoney(stay.depositAmount) }}
          </el-descriptions-item>
          <el-descriptions-item label="关联预订">
            {{ stay.bookingId === null ? '无（walk-in）' : `#${stay.bookingId}` }}
          </el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">
            {{ stay.note ?? '—' }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card shadow="never">
        <template #header>费用信息（服务端实时计算）</template>
        <el-descriptions :column="4" border>
          <el-descriptions-item label="预计晚数">
            {{ stay.currentCharges.nights }}
          </el-descriptions-item>
          <el-descriptions-item label="房费">
            {{ formatMoney(stay.currentCharges.roomFee) }}
          </el-descriptions-item>
          <el-descriptions-item label="杂费">
            {{ formatMoney(stay.currentCharges.miscTotal) }}
          </el-descriptions-item>
          <el-descriptions-item label="合计">
            {{ formatMoney(stay.currentCharges.total) }}
          </el-descriptions-item>
        </el-descriptions>
        <p class="fee-note">最终应收金额以退房结算时服务端生成的账单为准。</p>
      </el-card>

      <el-card v-if="stay.order !== null" shadow="never">
        <template #header>账单摘要</template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="账单编号">#{{ stay.order.id }}</el-descriptions-item>
          <el-descriptions-item label="账单状态">
            {{ ORDER_STATUS_LABELS[stay.order.status] }}
          </el-descriptions-item>
          <el-descriptions-item label="支付方式">
            {{ PAYMENT_METHOD_LABELS[stay.order.paymentMethod] }}
          </el-descriptions-item>
          <el-descriptions-item label="总金额">
            {{ formatMoney(stay.order.totalAmount) }}
          </el-descriptions-item>
          <el-descriptions-item label="实收金额">
            {{ formatMoney(stay.order.paidAmount) }}
          </el-descriptions-item>
          <el-descriptions-item label="生成时间">
            {{ formatDateTime(stay.order.createdAt) }}
          </el-descriptions-item>
        </el-descriptions>
      </el-card>
    </template>

    <CheckoutDialog v-model="checkoutVisible" :stay-id="stayId" @checked-out="handleCheckedOut" />
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

.fee-note {
  margin: 12px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
