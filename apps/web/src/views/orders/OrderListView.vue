<script setup lang="ts">
import type { OrderSummaryDto } from '@hms/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { listOrders } from '@/api/orders';
import OrderStatusTag from '@/components/orders/OrderStatusTag.vue';
import FilterBar from '@/components/page/FilterBar.vue';
import PageContainer from '@/components/page/PageContainer.vue';
import TableCard from '@/components/page/TableCard.vue';
import { PAYMENT_METHOD_LABELS } from '@/constants/stays';
import { toApiRequestError } from '@/utils/errors';
import { formatDateTime, formatMoney } from '@/utils/format';

type DateRange = [string, string] | null;

interface OrderFilters {
  stayId: number | undefined;
  createdRange: DateRange;
  sort: string;
}

interface AppliedOrderQuery {
  page: number;
  pageSize: number;
  stayId: number | undefined;
  createdFrom: string | undefined;
  createdTo: string | undefined;
  sort: string;
}

const router = useRouter();

const filters = reactive<OrderFilters>({
  stayId: undefined,
  createdRange: null,
  sort: 'createdAt:desc',
});

const query = reactive<AppliedOrderQuery>({
  page: 1,
  pageSize: 10,
  stayId: undefined,
  createdFrom: undefined,
  createdTo: undefined,
  sort: 'createdAt:desc',
});

const sortOptions = [
  { value: 'createdAt:desc', label: '最近生成' },
  { value: 'createdAt:asc', label: '最早生成' },
];

const orders = ref<OrderSummaryDto[]>([]);
const total = ref(0);
const loading = ref(false);
const loadedOnce = ref(false);
const loadError = ref('');
let loadSequence = 0;

const hasAppliedFilters = computed(
  () => query.stayId !== undefined || query.createdFrom !== undefined,
);
const emptyDescription = computed(() =>
  hasAppliedFilters.value ? '当前筛选条件下暂无账单' : '暂无账单数据',
);

async function loadOrders(): Promise<void> {
  const sequence = ++loadSequence;
  loading.value = true;
  loadError.value = '';
  let needsReload = false;
  try {
    const response = await listOrders({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.stayId === undefined ? {} : { stayId: query.stayId }),
      ...(query.createdFrom === undefined ? {} : { createdFrom: query.createdFrom }),
      ...(query.createdTo === undefined ? {} : { createdTo: query.createdTo }),
      sort: query.sort,
    });
    if (sequence !== loadSequence) return;
    orders.value = response.items;
    total.value = response.pagination.total;
    loadedOnce.value = true;
    if (response.pagination.totalPages > 0 && query.page > response.pagination.totalPages) {
      query.page = response.pagination.totalPages;
      needsReload = true;
    }
  } catch (error) {
    if (sequence !== loadSequence) return;
    orders.value = [];
    loadError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === loadSequence) {
      loading.value = false;
      if (needsReload) void loadOrders();
    }
  }
}

function applyFilters(): void {
  query.page = 1;
  query.stayId = typeof filters.stayId === 'number' ? filters.stayId : undefined;
  query.createdFrom = filters.createdRange?.[0];
  query.createdTo = filters.createdRange?.[1];
  query.sort = filters.sort;
  void loadOrders();
}

function resetFilters(): void {
  filters.stayId = undefined;
  filters.createdRange = null;
  filters.sort = 'createdAt:desc';
  applyFilters();
}

function handlePageChange(page: number): void {
  query.page = page;
  void loadOrders();
}

function handleSizeChange(size: number): void {
  query.pageSize = size;
  query.page = 1;
  void loadOrders();
}

function openDetail(row: OrderSummaryDto): void {
  void router.push({ name: 'order-detail', params: { id: row.id } });
}

onMounted(() => {
  void loadOrders();
});
</script>

<template>
  <PageContainer>
    <template #actions>
      <el-button :loading="loading" @click="loadOrders">刷新</el-button>
    </template>

    <el-alert
      type="warning"
      title="账单为只读记录。本系统未接入第三方支付渠道，账单状态与支付方式为前台收银内部落账记录，不代表真实资金已完成支付。"
      :closable="false"
      show-icon
    />

    <FilterBar>
      <div class="filter-field">
        <span class="filter-label">账单日期</span>
        <el-date-picker
          v-model="filters.createdRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          unlink-panels
          class="filter-range"
        />
      </div>
      <div class="filter-field">
        <span class="filter-label">关联入住编号</span>
        <el-input-number
          v-model="filters.stayId"
          :min="1"
          :step="1"
          :controls="false"
          placeholder="如 501"
          class="filter-number"
        />
      </div>
      <div class="filter-field">
        <span class="filter-label">排序</span>
        <el-select v-model="filters.sort" class="filter-select">
          <el-option
            v-for="option in sortOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>
      <template #actions>
        <el-button @click="resetFilters">重置</el-button>
        <el-button type="primary" @click="applyFilters">查询</el-button>
      </template>
    </FilterBar>

    <TableCard>
      <template #toolbar>
        <span class="table-title">账单列表</span>
        <span class="table-meta">共 {{ total }} 条</span>
      </template>

      <div v-if="loading && !loadedOnce" class="table-loading">
        <el-skeleton :rows="4" animated />
      </div>

      <el-result
        v-else-if="loadError !== '' && !loadedOnce"
        icon="error"
        title="账单列表加载失败"
        :sub-title="loadError"
      >
        <template #extra>
          <el-button type="primary" @click="loadOrders">重试</el-button>
        </template>
      </el-result>

      <template v-else>
        <el-alert
          v-if="loadError !== ''"
          class="table-error"
          type="error"
          title="刷新账单列表失败"
          :closable="false"
          show-icon
        >
          <span class="table-error-body">
            <span>{{ loadError }}</span>
            <el-button size="small" @click="loadOrders">重试</el-button>
          </span>
        </el-alert>

        <el-table v-loading="loading" :data="orders" row-key="id" border>
          <el-table-column label="账单编号" width="100">
            <template #default="{ row }">#{{ row.id }}</template>
          </el-table-column>
          <el-table-column label="入住记录" width="100">
            <template #default="{ row }">#{{ row.stayId }}</template>
          </el-table-column>
          <el-table-column label="客人" min-width="130" show-overflow-tooltip>
            <template #default="{ row }">{{ row.guestName }}</template>
          </el-table-column>
          <el-table-column label="房号" width="100">
            <template #default="{ row }">{{ row.roomNumber }}</template>
          </el-table-column>
          <el-table-column label="应付总额" width="130" align="right">
            <template #default="{ row }">{{ formatMoney(row.totalAmount) }}</template>
          </el-table-column>
          <el-table-column label="实收金额" width="130" align="right">
            <template #default="{ row }">{{ formatMoney(row.paidAmount) }}</template>
          </el-table-column>
          <el-table-column label="支付方式" width="120">
            <template #default="{ row }">
              {{ PAYMENT_METHOD_LABELS[row.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] }}
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <OrderStatusTag :status="row.status" />
            </template>
          </el-table-column>
          <el-table-column label="生成时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="90" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            </template>
          </el-table-column>

          <template #empty>
            <el-empty :description="emptyDescription">
              <el-button v-if="hasAppliedFilters" @click="resetFilters">清空筛选</el-button>
            </el-empty>
          </template>
        </el-table>
      </template>

      <template #footer>
        <el-pagination
          :current-page="query.page"
          :page-size="query.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="handlePageChange"
          @size-change="handleSizeChange"
        />
      </template>
    </TableCard>
  </PageContainer>
</template>

<style scoped>
.filter-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-label {
  flex-shrink: 0;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.filter-range {
  width: 260px;
}

.filter-number {
  width: 130px;
}

.filter-select {
  width: 130px;
}

.table-title {
  font-weight: 600;
}

.table-meta {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.table-loading {
  padding: 16px;
}

.table-error {
  margin: 12px 16px;
}

.table-error-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

@media (max-width: 768px) {
  .filter-field {
    width: 100%;
  }

  .filter-range,
  .filter-number,
  .filter-select {
    width: 100%;
  }
}
</style>
