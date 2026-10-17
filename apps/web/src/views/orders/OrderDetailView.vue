<script setup lang="ts">
import type { OrderDto } from '@hms/shared';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { getOrder } from '@/api/orders';
import OrderStatusTag from '@/components/orders/OrderStatusTag.vue';
import PageContainer from '@/components/page/PageContainer.vue';
import { ORDER_ITEM_TYPE_LABELS, PAYMENT_METHOD_LABELS } from '@/constants/stays';
import { toApiRequestError } from '@/utils/errors';
import { formatDateTime, formatMoney } from '@/utils/format';

const route = useRoute();
const router = useRouter();

const orderId = computed<number | null>(() => {
  const raw = route.params['id'];
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value > 0 ? value : null;
});

const loading = ref(false);
const loadError = ref('');
const order = ref<OrderDto | null>(null);
let loadSequence = 0;

async function loadOrder(): Promise<void> {
  const sequence = ++loadSequence;
  const id = orderId.value;
  if (id === null) {
    loading.value = false;
    loadError.value = '无效的账单编号';
    order.value = null;
    return;
  }

  loading.value = true;
  loadError.value = '';
  try {
    const detail = await getOrder(id);
    if (sequence !== loadSequence) return;
    order.value = detail;
  } catch (error) {
    if (sequence !== loadSequence) return;
    order.value = null;
    loadError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === loadSequence) {
      loading.value = false;
    }
  }
}

function backToList(): void {
  void router.push({ name: 'orders' });
}

function openStay(): void {
  if (order.value === null) return;
  void router.push({ name: 'stay-detail', params: { id: order.value.stayId } });
}

watch(
  orderId,
  () => {
    void loadOrder();
  },
  { immediate: true },
);
</script>

<template>
  <PageContainer>
    <template #actions>
      <el-button @click="backToList">返回列表</el-button>
      <el-button v-if="order !== null" @click="openStay">查看入住记录</el-button>
    </template>

    <el-alert
      type="warning"
      title="账单只读。本系统未接入第三方支付渠道，支付方式与状态为前台收银内部落账记录，不代表真实资金已完成支付。"
      :closable="false"
      show-icon
    />

    <div v-if="loading" class="detail-loading">
      <el-skeleton :rows="6" animated />
    </div>

    <el-result
      v-else-if="loadError !== ''"
      icon="error"
      title="账单详情加载失败"
      :sub-title="loadError"
    >
      <template #extra>
        <el-button @click="backToList">返回列表</el-button>
        <el-button type="primary" @click="loadOrder">重试</el-button>
      </template>
    </el-result>

    <template v-else-if="order !== null">
      <el-card shadow="never">
        <template #header>
          <div class="detail-header">
            <span>账单 #{{ order.id }}</span>
            <OrderStatusTag :status="order.status" />
          </div>
        </template>

        <el-descriptions :column="2" border>
          <el-descriptions-item label="关联入住"> #{{ order.stayId }} </el-descriptions-item>
          <el-descriptions-item label="生成时间">
            {{ formatDateTime(order.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="更新时间">
            {{ formatDateTime(order.updatedAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="备注">{{ order.note ?? '—' }}</el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card shadow="never">
        <template #header>金额信息（服务端落账值）</template>
        <el-descriptions :column="4" border>
          <el-descriptions-item label="应付总额">
            {{ formatMoney(order.totalAmount) }}
          </el-descriptions-item>
          <el-descriptions-item label="押金登记">
            {{ formatMoney(order.depositAmount) }}
          </el-descriptions-item>
          <el-descriptions-item label="押金抵扣">
            {{ formatMoney(order.depositApplied) }}
          </el-descriptions-item>
          <el-descriptions-item label="实收金额">
            {{ formatMoney(order.paidAmount) }}
          </el-descriptions-item>
        </el-descriptions>
        <p class="amount-note">
          本账单无独立折扣字段；金额全部取服务端返回值，前端不重新计算或覆盖。
        </p>
      </el-card>

      <el-card shadow="never">
        <template #header>费用明细</template>
        <el-table :data="order.items" border>
          <el-table-column label="类型" width="120">
            <template #default="{ row }">
              {{ ORDER_ITEM_TYPE_LABELS[row.type as keyof typeof ORDER_ITEM_TYPE_LABELS] }}
            </template>
          </el-table-column>
          <el-table-column prop="name" label="项目" min-width="240" />
          <el-table-column label="金额" width="160" align="right">
            <template #default="{ row }">{{ formatMoney(row.amount) }}</template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无费用明细" />
          </template>
        </el-table>
      </el-card>

      <el-card shadow="never">
        <template #header>支付 / 收银信息（内部记录）</template>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="支付状态">
            <OrderStatusTag :status="order.status" />
          </el-descriptions-item>
          <el-descriptions-item label="支付方式">
            {{ PAYMENT_METHOD_LABELS[order.paymentMethod] }}
          </el-descriptions-item>
          <el-descriptions-item label="记录时间">
            {{ formatDateTime(order.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="支付流水">
            无独立支付流水（后端未提供支付记录实体）
          </el-descriptions-item>
        </el-descriptions>
        <p class="amount-note">
          本页面不提供支付、退款、修改账单等操作；所有账单由退房事务生成且只读。
        </p>
      </el-card>
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

.amount-note {
  margin: 12px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}
</style>
