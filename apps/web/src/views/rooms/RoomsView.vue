<script setup lang="ts">
import { ROOM_STATUSES, type RoomDto, type RoomStatus, type RoomTypeDto } from '@hms/shared';
import { ArrowDown } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';

import { listRoomTypes } from '@/api/room-types';
import { listRooms, updateRoomStatus } from '@/api/rooms';
import FilterBar from '@/components/page/FilterBar.vue';
import PageContainer from '@/components/page/PageContainer.vue';
import TableCard from '@/components/page/TableCard.vue';
import RoomStatusTag from '@/components/rooms/RoomStatusTag.vue';
import { ROOM_STATUS_LABELS } from '@/constants/rooms';
import { useAuthStore } from '@/stores/auth';
import { isApiRequestError, toApiRequestError } from '@/utils/errors';
import { formatDateOnly, formatDateTime } from '@/utils/format';

import RoomDetailDialog from './RoomDetailDialog.vue';
import RoomFormDialog from './RoomFormDialog.vue';
import { getRoomStatusActions } from './room-status';

interface RoomFilters {
  status: RoomStatus | '';
  roomTypeId: number | undefined;
  roomNumber: string;
  sort: string;
}

interface AppliedRoomQuery {
  page: number;
  pageSize: number;
  status: RoomStatus | undefined;
  roomTypeId: number | undefined;
  roomNumber: string | undefined;
  sort: string;
}

const statusOptions: Array<{ value: RoomStatus | ''; label: string }> = [
  { value: '', label: '全部房态' },
  ...ROOM_STATUSES.map((status) => ({ value: status, label: ROOM_STATUS_LABELS[status] })),
];

const sortOptions = [
  { value: 'roomNumber:asc', label: '房号升序' },
  { value: 'roomNumber:desc', label: '房号降序' },
  { value: 'createdAt:desc', label: '最近创建' },
  { value: 'status:asc', label: '按房态' },
];

const authStore = useAuthStore();
const currentRole = computed(() => authStore.user?.role);

const filters = reactive<RoomFilters>({
  status: '',
  roomTypeId: undefined,
  roomNumber: '',
  sort: 'roomNumber:asc',
});

const query = reactive<AppliedRoomQuery>({
  page: 1,
  pageSize: 10,
  status: undefined,
  roomTypeId: undefined,
  roomNumber: undefined,
  sort: 'roomNumber:asc',
});

const rooms = ref<RoomDto[]>([]);
const total = ref(0);
const loading = ref(false);
const loadedOnce = ref(false);
const loadError = ref('');

const roomTypes = ref<RoomTypeDto[]>([]);
const roomTypesLoading = ref(false);
const roomTypesError = ref('');

const formVisible = ref(false);
const formMode = ref<'create' | 'edit'>('create');
const editingRoom = ref<RoomDto | null>(null);

const detailVisible = ref(false);
const detailRoomId = ref<number | null>(null);

const statusUpdatingId = ref<number | null>(null);
let roomsLoadSequence = 0;
let roomTypesLoadSequence = 0;

const hasAppliedFilters = computed(
  () =>
    query.status !== undefined || query.roomTypeId !== undefined || query.roomNumber !== undefined,
);
const emptyDescription = computed(() =>
  hasAppliedFilters.value ? '当前筛选条件下暂无客房' : '暂无客房数据',
);

async function loadRoomTypes(): Promise<void> {
  const sequence = ++roomTypesLoadSequence;
  roomTypesLoading.value = true;
  roomTypesError.value = '';
  try {
    const response = await listRoomTypes();
    if (sequence !== roomTypesLoadSequence) return;
    roomTypes.value = response.items;
  } catch (error) {
    if (sequence !== roomTypesLoadSequence) return;
    roomTypes.value = [];
    roomTypesError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === roomTypesLoadSequence) {
      roomTypesLoading.value = false;
    }
  }
}

async function loadRooms(): Promise<void> {
  const sequence = ++roomsLoadSequence;
  loading.value = true;
  loadError.value = '';
  let needsReload = false;
  try {
    const response = await listRooms({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.roomTypeId === undefined ? {} : { roomTypeId: query.roomTypeId }),
      ...(query.roomNumber === undefined ? {} : { roomNumber: query.roomNumber }),
      sort: query.sort,
    });
    if (sequence !== roomsLoadSequence) return;
    rooms.value = response.items;
    total.value = response.pagination.total;
    loadedOnce.value = true;

    if (response.pagination.totalPages > 0 && query.page > response.pagination.totalPages) {
      query.page = response.pagination.totalPages;
      needsReload = true;
    }
  } catch (error) {
    if (sequence !== roomsLoadSequence) return;
    loadError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === roomsLoadSequence) {
      loading.value = false;
      if (needsReload) {
        void loadRooms();
      }
    }
  }
}

function applyFilters(): void {
  const roomNumber = filters.roomNumber.trim();
  query.page = 1;
  query.status = filters.status === '' ? undefined : filters.status;
  query.roomTypeId = typeof filters.roomTypeId === 'number' ? filters.roomTypeId : undefined;
  query.roomNumber = roomNumber === '' ? undefined : roomNumber;
  query.sort = filters.sort;
  void loadRooms();
}

function resetFilters(): void {
  filters.status = '';
  filters.roomTypeId = undefined;
  filters.roomNumber = '';
  filters.sort = 'roomNumber:asc';
  applyFilters();
}

function handlePageChange(page: number): void {
  query.page = page;
  void loadRooms();
}

function handleSizeChange(size: number): void {
  query.pageSize = size;
  query.page = 1;
  void loadRooms();
}

function openCreate(): void {
  formMode.value = 'create';
  editingRoom.value = null;
  formVisible.value = true;
}

function openEdit(row: RoomDto): void {
  formMode.value = 'edit';
  editingRoom.value = row;
  formVisible.value = true;
}

function openDetail(row: RoomDto): void {
  detailRoomId.value = row.id;
  detailVisible.value = true;
}

function handleSaved(): void {
  void loadRooms();
}

function actionsFor(row: RoomDto) {
  return getRoomStatusActions(row.status, currentRole.value);
}

async function handleStatusCommand(row: RoomDto, command: unknown): Promise<void> {
  if (typeof command !== 'string') return;
  const action = actionsFor(row).find((candidate) => candidate.to === command);
  if (action === undefined) return;

  if (action.requiresConfirm) {
    try {
      await ElMessageBox.confirm(
        `确定将房间 ${row.roomNumber} 变更为「${ROOM_STATUS_LABELS[action.to]}」吗？`,
        '房态变更',
        {
          type: 'warning',
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          autofocus: false,
        },
      );
    } catch {
      return;
    }
  }

  statusUpdatingId.value = row.id;
  try {
    await updateRoomStatus(row.id, { status: action.to });
    ElMessage.success('房态已更新');
    await loadRooms();
  } catch (error) {
    if (!isApiRequestError(error)) {
      ElMessage.error(error instanceof Error ? error.message : '房态更新失败');
    }
    await loadRooms();
  } finally {
    statusUpdatingId.value = null;
  }
}

function staySummary(row: RoomDto): string {
  if (row.currentStay === null) return '—';
  return `${row.currentStay.guestName}（${formatDateOnly(row.currentStay.expectedCheckOutDate)} 离店）`;
}

onMounted(() => {
  void loadRoomTypes();
  void loadRooms();
});
</script>

<template>
  <PageContainer>
    <template #actions>
      <el-button v-permission="'ADMIN'" type="primary" @click="openCreate">新建客房</el-button>
    </template>

    <el-alert
      v-if="roomTypesError !== ''"
      type="warning"
      title="房型选项加载失败，房型筛选与新建/编辑表单可能不可用"
      :closable="false"
      show-icon
    >
      <span class="table-error-body">
        <span>{{ roomTypesError }}</span>
        <el-button size="small" :loading="roomTypesLoading" @click="loadRoomTypes">
          重试
        </el-button>
      </span>
    </el-alert>

    <FilterBar>
      <div class="filter-field">
        <span class="filter-label">房号前缀</span>
        <el-input
          v-model="filters.roomNumber"
          placeholder="如 08"
          maxlength="20"
          clearable
          class="filter-input"
          @keyup.enter="applyFilters"
        />
      </div>
      <div class="filter-field">
        <span class="filter-label">房型</span>
        <el-select
          v-model="filters.roomTypeId"
          placeholder="全部房型"
          clearable
          filterable
          :loading="roomTypesLoading"
          class="filter-select"
        >
          <el-option
            v-for="roomType in roomTypes"
            :key="roomType.id"
            :label="`${roomType.name}（${roomType.code}）`"
            :value="roomType.id"
          />
        </el-select>
      </div>
      <div class="filter-field">
        <span class="filter-label">房态</span>
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
        <span class="table-title">客房列表</span>
        <span class="table-meta">共 {{ total }} 间</span>
      </template>

      <div v-if="loading && !loadedOnce" class="table-loading">
        <el-skeleton :rows="5" animated />
      </div>

      <el-result
        v-else-if="loadError !== '' && !loadedOnce"
        icon="error"
        title="客房列表加载失败"
        :sub-title="loadError"
      >
        <template #extra>
          <el-button type="primary" @click="loadRooms">重试</el-button>
        </template>
      </el-result>

      <template v-else>
        <el-alert
          v-if="loadError !== ''"
          class="table-error"
          type="error"
          title="刷新客房列表失败"
          :closable="false"
          show-icon
        >
          <span class="table-error-body">
            <span>{{ loadError }}</span>
            <el-button size="small" @click="loadRooms">重试</el-button>
          </span>
        </el-alert>

        <el-table v-loading="loading" :data="rooms" row-key="id" border>
          <el-table-column prop="roomNumber" label="房号" width="100" />
          <el-table-column prop="roomTypeName" label="房型" min-width="140" show-overflow-tooltip />
          <el-table-column label="房态" width="130" align="center">
            <template #default="{ row }">
              <RoomStatusTag :status="row.status" />
            </template>
          </el-table-column>
          <el-table-column label="在住客人" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ staySummary(row) }}</template>
          </el-table-column>
          <el-table-column prop="note" label="备注" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ row.note ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="更新时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="260" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDetail(row)">详情</el-button>
              <el-button v-permission="'ADMIN'" link type="primary" @click="openEdit(row)">
                编辑
              </el-button>
              <el-dropdown
                v-if="actionsFor(row).length > 0"
                trigger="click"
                @command="handleStatusCommand(row, $event)"
              >
                <el-button
                  link
                  type="primary"
                  :loading="statusUpdatingId === row.id"
                  :disabled="statusUpdatingId !== null"
                >
                  房态操作
                  <el-icon class="dropdown-icon"><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item
                      v-for="action in actionsFor(row)"
                      :key="action.to"
                      :command="action.to"
                    >
                      {{ action.label }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <span v-else class="muted">无可用房态操作</span>
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

    <RoomFormDialog
      v-model="formVisible"
      :mode="formMode"
      :room="editingRoom"
      :room-types="roomTypes"
      @saved="handleSaved"
    />
    <RoomDetailDialog v-model="detailVisible" :room-id="detailRoomId" />
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
  width: 150px;
}

.filter-select {
  width: 180px;
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

.dropdown-icon {
  margin-left: 2px;
}

.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
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
