<script setup lang="ts">
import {
  ROLES,
  USER_STATUSES,
  type Role,
  type UserListItemDto,
  type UserStatus,
} from '@hms/shared';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';

import { listUsers, updateUser } from '@/api/users';
import FilterBar from '@/components/page/FilterBar.vue';
import PageContainer from '@/components/page/PageContainer.vue';
import TableCard from '@/components/page/TableCard.vue';
import UserStatusTag from '@/components/users/UserStatusTag.vue';
import { ROLE_LABELS } from '@/constants/display';
import { USER_SORT_OPTIONS, USER_STATUS_LABELS } from '@/constants/users';
import { useAuthStore } from '@/stores/auth';
import { formatApiError, toApiRequestError } from '@/utils/errors';
import { formatDateTime } from '@/utils/format';

import ResetPasswordDialog from './ResetPasswordDialog.vue';
import UserDetailDialog from './UserDetailDialog.vue';
import UserFormDialog from './UserFormDialog.vue';

interface UserFilters {
  keyword: string;
  role: Role | '';
  status: UserStatus | '';
  sort: string;
}

interface AppliedUserQuery {
  page: number;
  pageSize: number;
  keyword: string | undefined;
  role: Role | undefined;
  status: UserStatus | undefined;
  sort: string;
}

const authStore = useAuthStore();
const currentUserId = computed(() => authStore.user?.id);

const filters = reactive<UserFilters>({
  keyword: '',
  role: '',
  status: '',
  sort: 'createdAt:desc',
});

const query = reactive<AppliedUserQuery>({
  page: 1,
  pageSize: 10,
  keyword: undefined,
  role: undefined,
  status: undefined,
  sort: 'createdAt:desc',
});

const roleOptions = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));
const statusOptions: Array<{ value: UserStatus | ''; label: string }> = [
  { value: '', label: '全部状态' },
  ...USER_STATUSES.map((status) => ({
    value: status,
    label: USER_STATUS_LABELS[status],
  })),
];

const users = ref<UserListItemDto[]>([]);
const total = ref(0);
const loading = ref(false);
const loadedOnce = ref(false);
const loadError = ref('');
const statusUpdatingId = ref<number | null>(null);
let loadSequence = 0;

const formVisible = ref(false);
const formMode = ref<'create' | 'edit'>('create');
const editingUser = ref<UserListItemDto | null>(null);

const detailVisible = ref(false);
const detailUserId = ref<number | null>(null);

const resetVisible = ref(false);
const resetUser = ref<UserListItemDto | null>(null);

const hasAppliedFilters = computed(
  () => query.keyword !== undefined || query.role !== undefined || query.status !== undefined,
);
const emptyDescription = computed(() =>
  hasAppliedFilters.value ? '当前筛选条件下暂无员工' : '暂无员工数据',
);

async function loadUsers(): Promise<void> {
  const sequence = ++loadSequence;
  loading.value = true;
  loadError.value = '';
  let needsReload = false;
  try {
    const response = await listUsers({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.keyword === undefined ? {} : { keyword: query.keyword }),
      ...(query.role === undefined ? {} : { role: query.role }),
      ...(query.status === undefined ? {} : { status: query.status }),
      sort: query.sort,
    });
    if (sequence !== loadSequence) return;
    users.value = response.items;
    total.value = response.pagination.total;
    loadedOnce.value = true;
    if (response.pagination.totalPages > 0 && query.page > response.pagination.totalPages) {
      query.page = response.pagination.totalPages;
      needsReload = true;
    }
  } catch (error) {
    if (sequence !== loadSequence) return;
    users.value = [];
    loadError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === loadSequence) {
      loading.value = false;
      if (needsReload) void loadUsers();
    }
  }
}

function applyFilters(): void {
  const keyword = filters.keyword.trim();
  query.page = 1;
  query.keyword = keyword === '' ? undefined : keyword;
  query.role = filters.role === '' ? undefined : filters.role;
  query.status = filters.status === '' ? undefined : filters.status;
  query.sort = filters.sort;
  void loadUsers();
}

function resetFilters(): void {
  filters.keyword = '';
  filters.role = '';
  filters.status = '';
  filters.sort = 'createdAt:desc';
  applyFilters();
}

function handlePageChange(page: number): void {
  query.page = page;
  void loadUsers();
}

function handleSizeChange(size: number): void {
  query.pageSize = size;
  query.page = 1;
  void loadUsers();
}

function openCreate(): void {
  formMode.value = 'create';
  editingUser.value = null;
  formVisible.value = true;
}

function openEdit(row: UserListItemDto): void {
  formMode.value = 'edit';
  editingUser.value = row;
  formVisible.value = true;
}

function openDetail(row: UserListItemDto): void {
  detailUserId.value = row.id;
  detailVisible.value = true;
}

function openResetPassword(row: UserListItemDto): void {
  resetUser.value = row;
  resetVisible.value = true;
}

function handleSaved(): void {
  void loadUsers();
}

async function handleToggleStatus(row: UserListItemDto): Promise<void> {
  if (row.id === currentUserId.value || statusUpdatingId.value !== null) return;
  const nextStatus: UserStatus = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  const actionLabel = nextStatus === 'DISABLED' ? '停用' : '启用';

  try {
    await ElMessageBox.confirm(
      nextStatus === 'DISABLED'
        ? `确定停用员工「${row.displayName}」吗？停用后其所有会话将立即失效。`
        : `确定启用员工「${row.displayName}」吗？`,
      `${actionLabel}员工`,
      {
        type: 'warning',
        confirmButtonText: actionLabel,
        cancelButtonText: '取消',
        autofocus: false,
      },
    );
  } catch {
    return;
  }

  statusUpdatingId.value = row.id;
  try {
    await updateUser(row.id, { status: nextStatus });
    ElMessage.success(`员工已${actionLabel}`);
    await loadUsers();
  } catch (error) {
    ElMessage.error(formatApiError(error, `${actionLabel}员工失败`));
  } finally {
    statusUpdatingId.value = null;
  }
}

onMounted(() => {
  void loadUsers();
});
</script>

<template>
  <PageContainer>
    <template #actions>
      <el-button type="primary" @click="openCreate">新建员工</el-button>
    </template>

    <FilterBar>
      <div class="filter-field">
        <span class="filter-label">关键字</span>
        <el-input
          v-model="filters.keyword"
          placeholder="用户名或姓名"
          maxlength="50"
          clearable
          class="filter-input"
          @keyup.enter="applyFilters"
        />
      </div>
      <div class="filter-field">
        <span class="filter-label">角色</span>
        <el-select v-model="filters.role" class="filter-select">
          <el-option label="全部角色" value="" />
          <el-option
            v-for="option in roleOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
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
        <span class="filter-label">排序</span>
        <el-select v-model="filters.sort" class="filter-select">
          <el-option
            v-for="option in USER_SORT_OPTIONS"
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
        <span class="table-title">员工列表</span>
        <span class="table-meta">共 {{ total }} 名员工</span>
      </template>

      <div v-if="loading && !loadedOnce" class="table-loading">
        <el-skeleton :rows="4" animated />
      </div>

      <el-result
        v-else-if="loadError !== '' && !loadedOnce"
        icon="error"
        title="员工列表加载失败"
        :sub-title="loadError"
      >
        <template #extra>
          <el-button type="primary" @click="loadUsers">重试</el-button>
        </template>
      </el-result>

      <template v-else>
        <el-alert
          v-if="loadError !== ''"
          class="table-error"
          type="error"
          title="刷新员工列表失败"
          :closable="false"
          show-icon
        >
          <span class="table-error-body">
            <span>{{ loadError }}</span>
            <el-button size="small" @click="loadUsers">重试</el-button>
          </span>
        </el-alert>

        <el-table v-loading="loading" :data="users" row-key="id" border>
          <el-table-column prop="username" label="用户名" min-width="130" />
          <el-table-column prop="displayName" label="姓名" min-width="120" />
          <el-table-column label="角色" width="110">
            <template #default="{ row }">
              <el-tag :type="row.role === 'ADMIN' ? 'warning' : 'info'" disable-transitions>
                {{ ROLE_LABELS[row.role as keyof typeof ROLE_LABELS] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <UserStatusTag :status="row.status" />
            </template>
          </el-table-column>
          <el-table-column label="最后登录" width="170">
            <template #default="{ row }">{{ formatDateTime(row.lastLoginAt) }}</template>
          </el-table-column>
          <el-table-column label="创建时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="300" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openDetail(row)">详情</el-button>
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button
                v-if="row.id !== currentUserId"
                link
                :type="row.status === 'ACTIVE' ? 'danger' : 'success'"
                :loading="statusUpdatingId === row.id"
                :disabled="statusUpdatingId !== null"
                @click="handleToggleStatus(row)"
              >
                {{ row.status === 'ACTIVE' ? '停用' : '启用' }}
              </el-button>
              <el-button link type="warning" @click="openResetPassword(row)"> 重置密码 </el-button>
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

    <UserFormDialog
      v-model="formVisible"
      :mode="formMode"
      :user="editingUser"
      @saved="handleSaved"
    />
    <UserDetailDialog v-model="detailVisible" :user-id="detailUserId" />
    <ResetPasswordDialog v-model="resetVisible" :user="resetUser" @saved="handleSaved" />
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
  width: 180px;
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
