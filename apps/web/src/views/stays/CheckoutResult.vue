<script setup lang="ts">
import type { OrderDto, OrderSummaryDto } from '@hms/shared';
import { computed } from 'vue';

import {
  ORDER_ITEM_TYPE_LABELS,
  ORDER_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
} from '@/constants/stays';
import { formatDateTime, formatMoney } from '@/utils/format';

const props = withDefaults(
  defineProps<{
    order: OrderDto | null;
    summary?: OrderSummaryDto | null;
    orderError?: string;
  }>(),
  { summary: null, orderError: '' },
);

const emit = defineEmits<{ retry: [] }>();

const hasResult = computed(() => props.order !== null || props.summary !== null);
</script>

<template>
  <div v-if="hasResult" class="checkout-result">
    <el-alert
      v-if="orderError !== ''"
      class="result-alert"
      type="warning"
      title="账单明细加载失败"
      :closable="false"
      show-icon
    >
      <span class="result-alert-body">
        <span>{{ orderError }}。已根据服务端确认退房完成，可重试加载账单明细。</span>
        <el-button size="small" @click="emit('retry')">重试</el-button>
      </span>
    </el-alert>

    <template v-if="order !== null">
      <el-descriptions :column="2" border>
        <el-descriptions-item label="账单编号">#{{ order.id }}</el-descriptions-item>
        <el-descriptions-item label="入住记录">#{{ order.stayId }}</el-descriptions-item>
        <el-descriptions-item label="账单状态">
          {{ ORDER_STATUS_LABELS[order.status] }}
        </el-descriptions-item>
        <el-descriptions-item label="支付方式">
          {{ PAYMENT_METHOD_LABELS[order.paymentMethod] }}
        </el-descriptions-item>
        <el-descriptions-item label="总金额">
          {{ formatMoney(order.totalAmount) }}
        </el-descriptions-item>
        <el-descriptions-item label="押金">
          {{ formatMoney(order.depositAmount) }}
        </el-descriptions-item>
        <el-descriptions-item label="押金抵扣">
          {{ formatMoney(order.depositApplied) }}
        </el-descriptions-item>
        <el-descriptions-item label="实收金额">
          {{ formatMoney(order.paidAmount) }}
        </el-descriptions-item>
        <el-descriptions-item label="生成时间" :span="2">
          {{ formatDateTime(order.createdAt) }}
        </el-descriptions-item>
        <el-descriptions-item v-if="order.note !== null" label="备注" :span="2">
          {{ order.note }}
        </el-descriptions-item>
      </el-descriptions>

      <el-table :data="order.items" border class="result-items">
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            {{ ORDER_ITEM_TYPE_LABELS[row.type as keyof typeof ORDER_ITEM_TYPE_LABELS] }}
          </template>
        </el-table-column>
        <el-table-column prop="name" label="项目" min-width="200" />
        <el-table-column label="金额" width="140" align="right">
          <template #default="{ row }">{{ formatMoney(row.amount) }}</template>
        </el-table-column>
      </el-table>
    </template>

    <el-descriptions v-else-if="summary !== null" :column="2" border>
      <el-descriptions-item label="账单编号">#{{ summary.id }}</el-descriptions-item>
      <el-descriptions-item label="账单状态">
        {{ ORDER_STATUS_LABELS[summary.status] }}
      </el-descriptions-item>
      <el-descriptions-item label="支付方式">
        {{ PAYMENT_METHOD_LABELS[summary.paymentMethod] }}
      </el-descriptions-item>
      <el-descriptions-item label="总金额">
        {{ formatMoney(summary.totalAmount) }}
      </el-descriptions-item>
      <el-descriptions-item label="实收金额">
        {{ formatMoney(summary.paidAmount) }}
      </el-descriptions-item>
      <el-descriptions-item label="生成时间">
        {{ formatDateTime(summary.createdAt) }}
      </el-descriptions-item>
    </el-descriptions>
  </div>
</template>

<style scoped>
.checkout-result {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.result-alert {
  margin-bottom: 0;
}

.result-alert-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.result-items {
  margin-top: 4px;
}
</style>
