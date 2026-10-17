<script setup lang="ts">
import { BOOKING_STATUSES, type BookingDto, type BookingStatus } from '@hms/shared';
import { ElMessage } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { listBookings } from '@/api/bookings';
import BookingStatusTag from '@/components/bookings/BookingStatusTag.vue';
import FilterBar from '@/components/page/FilterBar.vue';
import PageContainer from '@/components/page/PageContainer.vue';
import TableCard from '@/components/page/TableCard.vue';
import { BOOKING_STATUS_LABELS } from '@/constants/bookings';
import { toApiRequestError } from '@/utils/errors';
import { formatDateTime, formatMoney } from '@/utils/format';

import BookingCreateDialog from './BookingCreateDialog.vue';

type DateRange = [string, string] | null;

interface BookingFilters {
  keyword: string;
  status: BookingStatus | '';
  checkInRange: DateRange;
  checkOutRange: DateRange;
  sort: string;
}

interface AppliedBookingQuery {
  page: number;
  pageSize: number;
  status: BookingStatus | undefined;
  keyword: string | undefined;
  checkInDateFrom: string | undefined;
  checkInDateTo: string | undefined;
  checkOutDateFrom: string | undefined;
  checkOutDateTo: string | undefined;
  sort: string;
}

const statusOptions: Array<{ value: BookingStatus | ''; label: string }> = [
  { value: '', label: '全部状态' },
  ...BOOKING_STATUSES.map((status) => ({
    value: status,
    label: BOOKING_STATUS_LABELS[status],
  })),
];

const sortOptions = [
  { value: 'createdAt:desc', label: '最近创建' },
  { value: 'checkInDate:asc', label: '入住日期升序' },
  { value: 'status:asc', label: '按状态' },
];

const router = useRouter();

const filters = reactive<BookingFilters>({
  keyword: '',
  status: '',
  checkInRange: null,
  checkOutRange: null,
  sort: 'createdAt:desc',
});

const query = reactive<AppliedBookingQuery>({
  page: 1,
  pageSize: 10,
  status: undefined,
  keyword: undefined,
  checkInDateFrom: undefined,
  checkInDateTo: undefined,
  checkOutDateFrom: undefined,
  checkOutDateTo: undefined,
  sort: 'createdAt:desc',
});

const bookings = ref<BookingDto[]>([]);
const total = ref(0);
const loading = ref(false);
const loadedOnce = ref(false);
const loadError = ref('');
let loadSequence = 0;

const bookingIdInput = ref('');
const createVisible = ref(false);

const hasAppliedFilters = computed(
  () =>
    query.status !== undefined ||
    query.keyword !== undefined ||
    query.checkInDateFrom !== undefined ||
    query.checkOutDateFrom !== undefined,
);
const emptyDescription = computed(() =>
  hasAppliedFilters.value ? '当前筛选条件下暂无预订' : '暂无预订数据',
);

async function loadBookings(): Promise<void> {
  const sequence = ++loadSequence;
  loading.value = true;
  loadError.value = '';
  let needsReload = false;
  try {
    const response = await listBookings({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.keyword === undefined ? {} : { keyword: query.keyword }),
      ...(query.checkInDateFrom === undefined ? {} : { checkInDateFrom: query.checkInDateFrom }),
      ...(query.checkInDateTo === undefined ? {} : { checkInDateTo: query.checkInDateTo }),
      ...(query.checkOutDateFrom === undefined ? {} : { checkOutDateFrom: query.checkOutDateFrom }),
      ...(query.checkOutDateTo === undefined ? {} : { checkOutDateTo: query.checkOutDateTo }),
      sort: query.sort,
    });
    if (sequence !== loadSequence) return;
    bookings.value = response.items;
    total.value = response.pagination.total;
    loadedOnce.value = true;

    if (response.pagination.totalPages > 0 && query.page > response.pagination.totalPages) {
      query.page = response.pagination.totalPages;
      needsReload = true;
    }
  } catch (error) {
    if (sequence !== loadSequence) return;
    loadError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === loadSequence) {
      loading.value = false;
      if (needsReload) {
        void loadBookings();
      }
    }
  }
}

function applyFilters(): void {
  const keyword = filters.keyword.trim();
  query.page = 1;
  query.status = filters.status === '' ? undefined : filters.status;
  query.keyword = keyword === '' ? undefined : keyword;
  query.checkInDateFrom = filters.checkInRange?.[0];
  query.checkInDateTo = filters.checkInRange?.[1];
  query.checkOutDateFrom = filters.checkOutRange?.[0];
  query.checkOutDateTo = filters.checkOutRange?.[1];
  query.sort = filters.sort;
  void loadBookings();
}

function resetFilters(): void {
  filters.keyword = '';
  filters.status = '';
  filters.checkInRange = null;
  filters.checkOutRange = null;
  filters.sort = 'createdAt:desc';
  applyFilters();
}

function handlePageChange(page: number): void {
  query.page = page;
  void loadBookings();
}

function handleSizeChange(size: number): void {
  query.pageSize = size;
  query.page = 1;
  void loadBookings();
}

function openCreate(): void {
  createVisible.value = true;
}

function handleCreated(): void {
  query.page = 1;
  void loadBookings();
}

function openDetail(row: BookingDto): void {
  void router.push({ name: 'booking-detail', params: { id: row.id } });
}

function openBookingById(): void {
  const raw = bookingIdInput.value.trim();
  if (!/^[1-9]\d*$/.test(raw)) {
    ElMessage.warning('请输入有效的预订编号');
    return;
  }
  void router.push({ name: 'booking-detail', params: { id: Number(raw) } });
}

onMounted(() => {
  void loadBookings();
});
</script>

<template>
  <PageContainer>
    <template #actions>
      <el-button type="primary" @click="openCreate">创建预订</el-button>
    </template>

    <FilterBar>
      <div class="filter-field">
        <span class="filter-label">客人</span>
        <el-input
          v-model="filters.keyword"
          placeholder="姓名或手机号前缀"
          maxlength="50"
          clearable
          class="filter-input"
          @keyup.enter="applyFilters"
        />
      </div>
      <div class="filter-field">
        <span class="filter-label">状态</span>
        <el-select v-model="filters.status" class="filter-select">
          <el-option
            v-for="option in statusOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>
      <div class="filter-field">
        <span class="filter-label">入住日期范围</span>
        <el-date-picker
          v-model="filters.checkInRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          unlink-panels
          class="filter-range"
        />
      </div>
      <div class="filter-field">
        <span class="filter-label">退房日期范围</span>
        <el-date-picker
          v-model="filters.checkOutRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          unlink-panels
          class="filter-range"
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
      <div class="filter-field">
        <span class="filter-label">编号直达</span>
        <el-input
          v-model="bookingIdInput"
          placeholder="预订编号"
          clearable
          class="filter-input filter-input--id"
          @keyup.enter="openBookingById"
        />
        <el-button @click="openBookingById">查看</el-button>
      </div>
      <template #actions>
        <el-button @click="resetFilters">重置</el-button>
        <el-button type="primary" @click="applyFilters">查询</el-button>
      </template>
    </FilterBar>

    <TableCard>
      <template #toolbar>
        <span class="table-title">预订列表</span>
        <span class="table-meta">共 {{ total }} 条</span>
      </template>

      <div v-if="loading && !loadedOnce" class="table-loading">
        <el-skeleton :rows="5" animated />
      </div>

      <el-result
        v-else-if="loadError !== '' && !loadedOnce"
        icon="error"
        title="预订列表加载失败"
        :sub-title="loadError"
      >
        <template #extra>
          <el-button type="primary" @click="loadBookings">重试</el-button>
        </template>
      </el-result>

      <template v-else>
        <el-alert
          v-if="loadError !== ''"
          class="table-error"
          type="error"
          title="刷新预订列表失败"
          :closable="false"
          show-icon
        >
          <span class="table-error-body">
            <span>{{ loadError }}</span>
            <el-button size="small" @click="loadBookings">重试</el-button>
          </span>
        </el-alert>

        <el-table v-loading="loading" :data="bookings" row-key="id" border>
          <el-table-column label="预订编号" width="100">
            <template #default="{ row }">#{{ row.id }}</template>
          </el-table-column>
          <el-table-column label="客人" min-width="160" show-overflow-tooltip>
            <template #default="{ row }"> {{ row.guestName }} · {{ row.guestPhone }} </template>
          </el-table-column>
          <el-table-column prop="roomTypeName" label="房型" min-width="140" show-overflow-tooltip />
          <el-table-column label="入住 / 退房" min-width="190">
            <template #default="{ row }"> {{ row.checkInDate }} → {{ row.checkOutDate }} </template>
          </el-table-column>
          <el-table-column label="房价 / 总价" width="150" align="right">
            <template #default="{ row }">
              <div>{{ formatMoney(row.pricePerNight) }} / 晚</div>
              <div class="total-price">{{ formatMoney(row.totalPrice) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <BookingStatusTag :status="row.status" />
            </template>
          </el-table-column>
          <el-table-column label="创建时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
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

    <BookingCreateDialog v-model="createVisible" @created="handleCreated" />
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

.filter-input {
  width: 160px;
}

.filter-input--id {
  width: 120px;
}

.filter-select {
  width: 150px;
}

.filter-range {
  width: 260px;
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

.total-price {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

@media (max-width: 768px) {
  .filter-field {
    width: 100%;
  }

  .filter-input,
  .filter-input--id,
  .filter-select,
  .filter-range {
    width: 100%;
  }
}
</style>
