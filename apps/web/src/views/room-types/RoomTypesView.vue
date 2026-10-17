<script setup lang="ts">
import { ROOM_TYPE_STATUSES, type RoomTypeDto, type RoomTypeStatus } from '@hms/shared';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, ref } from 'vue';

import { archiveRoomType, listRoomTypes } from '@/api/room-types';
import FilterBar from '@/components/page/FilterBar.vue';
import PageContainer from '@/components/page/PageContainer.vue';
import TableCard from '@/components/page/TableCard.vue';
import { ROOM_TYPE_STATUS_LABELS, ROOM_TYPE_STATUS_TAG_TYPES } from '@/constants/rooms';
import { isApiRequestError, toApiRequestError } from '@/utils/errors';
import { formatDateTime, formatMoney } from '@/utils/format';

import RoomTypeDetailDialog from './RoomTypeDetailDialog.vue';
import RoomTypeFormDialog from './RoomTypeFormDialog.vue';

const statusOptions: Array<{ value: RoomTypeStatus | ''; label: string }> = [
  { value: '', label: '全部状态' },
  ...ROOM_TYPE_STATUSES.map((status) => ({
    value: status,
    label: ROOM_TYPE_STATUS_LABELS[status],
  })),
];

const statusFilter = ref<RoomTypeStatus | ''>('');
const page = ref(1);
const pageSize = ref(10);
const loading = ref(false);
const loadedOnce = ref(false);
const loadError = ref('');
const roomTypes = ref<RoomTypeDto[]>([]);
const archivingId = ref<number | null>(null);
let loadSequence = 0;

const total = computed(() => roomTypes.value.length);
const hasFilters = computed(() => statusFilter.value !== '');
const pagedRoomTypes = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return roomTypes.value.slice(start, start + pageSize.value);
});
const emptyDescription = computed(() =>
  hasFilters.value ? '当前筛选条件下暂无房型' : '暂无房型数据',
);

const formVisible = ref(false);
const formMode = ref<'create' | 'edit'>('create');
const editingRoomType = ref<RoomTypeDto | null>(null);

const detailVisible = ref(false);
const detailRoomTypeId = ref<number | null>(null);

function clampPage(): void {
  const totalPages = Math.max(1, Math.ceil(roomTypes.value.length / pageSize.value));
  if (page.value > totalPages) page.value = totalPages;
}

async function loadRoomTypes(): Promise<void> {
  const sequence = ++loadSequence;
  loading.value = true;
  loadError.value = '';
  try {
    const response = await listRoomTypes(
      statusFilter.value === '' ? {} : { status: statusFilter.value },
    );
    if (sequence !== loadSequence) return;
    roomTypes.value = response.items;
    loadedOnce.value = true;
    clampPage();
  } catch (error) {
    if (sequence !== loadSequence) return;
    loadError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === loadSequence) {
      loading.value = false;
    }
  }
}

function handleQuery(): void {
  page.value = 1;
  void loadRoomTypes();
}

function handleReset(): void {
  statusFilter.value = '';
  page.value = 1;
  void loadRoomTypes();
}

function handleSizeChange(size: number): void {
  pageSize.value = size;
  page.value = 1;
}

function openCreate(): void {
  formMode.value = 'create';
  editingRoomType.value = null;
  formVisible.value = true;
}

function openEdit(row: RoomTypeDto): void {
  formMode.value = 'edit';
  editingRoomType.value = row;
  formVisible.value = true;
}

function openDetail(row: RoomTypeDto): void {
  detailRoomTypeId.value = row.id;
  detailVisible.value = true;
}

function handleSaved(): void {
  void loadRoomTypes();
}

async function handleArchive(row: RoomTypeDto): Promise<void> {
  if (archivingId.value !== null) return;
  try {
    await ElMessageBox.confirm(
      `确定归档房型「${row.name}」吗？归档后将不可用于新预订。`,
      '归档房型',
      {
        type: 'warning',
        confirmButtonText: '归档',
        cancelButtonText: '取消',
        autofocus: false,
      },
    );
  } catch {
    return;
  }

  archivingId.value = row.id;
  try {
    await archiveRoomType(row.id);
    ElMessage.success('房型已归档');
    await loadRoomTypes();
  } catch (error) {
    if (!isApiRequestError(error)) {
      ElMessage.error(error instanceof Error ? error.message : '归档房型失败');
    }
  } finally {
    archivingId.value = null;
  }
}

onMounted(() => {
  void loadRoomTypes();
});
</script>

<template>
  <PageContainer>
    <template #actions>
      <el-button v-permission="'ADMIN'" type="primary" @click="openCreate">新建房型</el-button>
    </template>

    <FilterBar>
      <div class="filter-field">
        <span class="filter-label">状态</span>
        <el-select v-model="statusFilter" class="filter-select">
          <el-option
            v-for="option in statusOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>
      <template #actions>
        <el-button @click="handleReset">重置</el-button>
        <el-button type="primary" @click="handleQuery">查询</el-button>
      </template>
    </FilterBar>

    <TableCard>
      <template #toolbar>
        <span class="table-title">房型列表</span>
        <span class="table-meta">共 {{ total }} 个房型</span>
      </template>

      <div v-if="loading && !loadedOnce" class="table-loading">
        <el-skeleton :rows="5" animated />
      </div>

      <el-result
        v-else-if="loadError !== '' && !loadedOnce"
        icon="error"
        title="房型列表加载失败"
        :sub-title="loadError"
      >
        <template #extra>
          <el-button type="primary" @click="loadRoomTypes">重试</el-button>
        </template>
      </el-result>

      <template v-else>
        <el-alert
          v-if="loadError !== ''"
          class="table-error"
          type="error"
          title="刷新房型列表失败"
          :closable="false"
          show-icon
        >
          <span class="table-error-body">
            <span>{{ loadError }}</span>
            <el-button size="small" @click="loadRoomTypes">重试</el-button>
          </span>
        </el-alert>

        <el-table v-loading="loading" :data="pagedRoomTypes" row-key="id" border>
          <el-table-column prop="code" label="代码" width="110" />
          <el-table-column prop="name" label="房型名称" min-width="150" show-overflow-tooltip />
          <el-table-column label="基准房价" width="130" align="right">
            <template #default="{ row }">{{ formatMoney(row.basePrice) }}</template>
          </el-table-column>
          <el-table-column prop="capacity" label="可住人数" width="100" align="center" />
          <el-table-column prop="roomCount" label="房间数" width="90" align="center" />
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <el-tag
                :type="ROOM_TYPE_STATUS_TAG_TYPES[row.status as RoomTypeStatus]"
                disable-transitions
              >
                {{ ROOM_TYPE_STATUS_LABELS[row.status as RoomTypeStatus] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="更新时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="190" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDetail(row)">详情</el-button>
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button
                v-if="row.status === 'ACTIVE'"
                link
                type="danger"
                :loading="archivingId === row.id"
                :disabled="archivingId !== null"
                @click="handleArchive(row)"
              >
                归档
              </el-button>
            </template>
          </el-table-column>

          <template #empty>
            <el-empty :description="emptyDescription">
              <el-button v-if="hasFilters" @click="handleReset">清空筛选</el-button>
            </el-empty>
          </template>
        </el-table>
      </template>

      <template #footer>
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          background
          @size-change="handleSizeChange"
        />
      </template>
    </TableCard>

    <RoomTypeFormDialog
      v-model="formVisible"
      :mode="formMode"
      :room-type="editingRoomType"
      @saved="handleSaved"
    />
    <RoomTypeDetailDialog v-model="detailVisible" :room-type-id="detailRoomTypeId" />
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

.filter-select {
  width: 180px;
}

@media (max-width: 768px) {
  .filter-field {
    width: 100%;
  }

  .filter-select {
    width: 100%;
  }
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
</style>
