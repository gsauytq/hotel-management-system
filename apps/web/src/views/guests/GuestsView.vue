<script setup lang="ts">
import type { GuestDto } from '@hms/shared';
import { computed, onMounted, reactive, ref } from 'vue';

import { listGuests } from '@/api/guests';
import FilterBar from '@/components/page/FilterBar.vue';
import PageContainer from '@/components/page/PageContainer.vue';
import TableCard from '@/components/page/TableCard.vue';
import { GUEST_SORT_LABELS, ID_TYPE_LABELS } from '@/constants/guests';
import { toApiRequestError } from '@/utils/errors';
import { formatDateTime } from '@/utils/format';

import GuestDetailDialog from './GuestDetailDialog.vue';
import GuestFormDialog from './GuestFormDialog.vue';

interface GuestFilters {
  keyword: string;
  sort: string;
}

interface AppliedGuestQuery {
  page: number;
  pageSize: number;
  keyword: string | undefined;
  sort: string;
}

const filters = reactive<GuestFilters>({ keyword: '', sort: 'createdAt:desc' });
const query = reactive<AppliedGuestQuery>({
  page: 1,
  pageSize: 10,
  keyword: undefined,
  sort: 'createdAt:desc',
});

const sortOptions = Object.entries(GUEST_SORT_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const guests = ref<GuestDto[]>([]);
const total = ref(0);
const loading = ref(false);
const loadedOnce = ref(false);
const loadError = ref('');
let loadSequence = 0;

const formVisible = ref(false);
const formMode = ref<'create' | 'edit'>('create');
const editingGuest = ref<GuestDto | null>(null);

const detailVisible = ref(false);
const detailGuestId = ref<number | null>(null);

const hasAppliedFilters = computed(() => query.keyword !== undefined);
const emptyDescription = computed(() =>
  hasAppliedFilters.value ? '当前筛选条件下暂无客人档案' : '暂无客人档案',
);

async function loadGuests(): Promise<void> {
  const sequence = ++loadSequence;
  loading.value = true;
  loadError.value = '';
  let needsReload = false;
  try {
    const response = await listGuests({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.keyword === undefined ? {} : { keyword: query.keyword }),
      sort: query.sort,
    });
    if (sequence !== loadSequence) return;
    guests.value = response.items;
    total.value = response.pagination.total;
    loadedOnce.value = true;
    if (response.pagination.totalPages > 0 && query.page > response.pagination.totalPages) {
      query.page = response.pagination.totalPages;
      needsReload = true;
    }
  } catch (error) {
    if (sequence !== loadSequence) return;
    guests.value = [];
    loadError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === loadSequence) {
      loading.value = false;
      if (needsReload) void loadGuests();
    }
  }
}

function applyFilters(): void {
  const keyword = filters.keyword.trim();
  query.page = 1;
  query.keyword = keyword === '' ? undefined : keyword;
  query.sort = filters.sort;
  void loadGuests();
}

function resetFilters(): void {
  filters.keyword = '';
  filters.sort = 'createdAt:desc';
  applyFilters();
}

function handlePageChange(page: number): void {
  query.page = page;
  void loadGuests();
}

function handleSizeChange(size: number): void {
  query.pageSize = size;
  query.page = 1;
  void loadGuests();
}

function openCreate(): void {
  formMode.value = 'create';
  editingGuest.value = null;
  formVisible.value = true;
}

function openEdit(row: GuestDto): void {
  formMode.value = 'edit';
  editingGuest.value = row;
  formVisible.value = true;
}

function openDetail(row: GuestDto): void {
  detailGuestId.value = row.id;
  detailVisible.value = true;
}

function handleSaved(): void {
  void loadGuests();
}

onMounted(() => {
  void loadGuests();
});
</script>

<template>
  <PageContainer>
    <template #actions>
      <el-button type="primary" @click="openCreate">新建客人档案</el-button>
    </template>

    <FilterBar>
      <div class="filter-field">
        <span class="filter-label">关键字</span>
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
        <span class="table-title">客人档案</span>
        <span class="table-meta">共 {{ total }} 条</span>
      </template>

      <div v-if="loading && !loadedOnce" class="table-loading">
        <el-skeleton :rows="4" animated />
      </div>

      <el-result
        v-else-if="loadError !== '' && !loadedOnce"
        icon="error"
        title="客人档案加载失败"
        :sub-title="loadError"
      >
        <template #extra>
          <el-button type="primary" @click="loadGuests">重试</el-button>
        </template>
      </el-result>

      <template v-else>
        <el-alert
          v-if="loadError !== ''"
          class="table-error"
          type="error"
          title="刷新客人档案失败"
          :closable="false"
          show-icon
        >
          <span class="table-error-body">
            <span>{{ loadError }}</span>
            <el-button size="small" @click="loadGuests">重试</el-button>
          </span>
        </el-alert>

        <el-table v-loading="loading" :data="guests" row-key="id" border>
          <el-table-column prop="name" label="姓名" min-width="120" />
          <el-table-column prop="phone" label="手机号" width="150" />
          <el-table-column label="证件类型" width="120">
            <template #default="{ row }">
              {{ ID_TYPE_LABELS[row.idType as keyof typeof ID_TYPE_LABELS] }}
            </template>
          </el-table-column>
          <el-table-column prop="idNumberMasked" label="证件号（掩码）" width="150" />
          <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">{{ row.remark ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="创建时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDetail(row)">详情</el-button>
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
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

    <GuestFormDialog
      v-model="formVisible"
      :mode="formMode"
      :guest="editingGuest"
      @saved="handleSaved"
    />
    <GuestDetailDialog v-model="detailVisible" :guest-id="detailGuestId" />
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
  width: 200px;
}

.filter-select {
  width: 150px;
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

  .filter-input,
  .filter-select {
    width: 100%;
  }
}
</style>
