<script setup lang="ts">
import { STAY_STATUSES, type BookingDto, type StayDto, type StayStatus } from '@hms/shared';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { listBookings } from '@/api/bookings';
import { listStays } from '@/api/stays';
import BookingStatusTag from '@/components/bookings/BookingStatusTag.vue';
import FilterBar from '@/components/page/FilterBar.vue';
import PageContainer from '@/components/page/PageContainer.vue';
import TableCard from '@/components/page/TableCard.vue';
import StayStatusTag from '@/components/stays/StayStatusTag.vue';
import { STAY_STATUS_LABELS } from '@/constants/stays';
import { toApiRequestError } from '@/utils/errors';
import { formatDateOnly, formatDateTime, formatMoney } from '@/utils/format';
import { addDays, hotelToday } from '@/utils/hotel-date';

import CheckInDialog from './CheckInDialog.vue';
import CheckoutDialog from './CheckoutDialog.vue';
import WalkInDialog from './WalkInDialog.vue';

type ActiveTab = 'pending' | 'stays';

const router = useRouter();
const activeTab = ref<ActiveTab>('pending');

const pendingKeyword = ref('');
const pendingPage = ref(1);
const pendingPageSize = ref(10);
const pendingBookings = ref<BookingDto[]>([]);
const pendingTotal = ref(0);
const pendingLoading = ref(false);
const pendingLoadedOnce = ref(false);
const pendingError = ref('');
let pendingSequence = 0;

const stayStatusFilter = ref<StayStatus | ''>('CHECKED_IN');
const stayKeyword = ref('');
const staySort = ref('checkInAt:desc');
const staysPage = ref(1);
const staysPageSize = ref(10);
const stays = ref<StayDto[]>([]);
const staysTotal = ref(0);
const staysLoading = ref(false);
const staysLoadedOnce = ref(false);
const staysError = ref('');
let staysSequence = 0;

const checkInVisible = ref(false);
const checkInBookingId = ref<number | null>(null);
const checkoutVisible = ref(false);
const checkoutStayId = ref<number | null>(null);
const walkInVisible = ref(false);

const statusOptions: Array<{ value: StayStatus | ''; label: string }> = [
  { value: '', label: '全部状态' },
  ...STAY_STATUSES.map((status) => ({
    value: status,
    label: STAY_STATUS_LABELS[status],
  })),
];

const staySortOptions = [
  { value: 'checkInAt:desc', label: '最近入住' },
  { value: 'expectedCheckOutDate:asc', label: '预计离店升序' },
  { value: 'status:asc', label: '按状态' },
];

const pendingTabLabel = computed(() => `待入住预订（${pendingTotal.value}）`);
const staysTabLabel = computed(() => `在住 / 历史入住（${staysTotal.value}）`);

async function loadPendingBookings(): Promise<void> {
  const sequence = ++pendingSequence;
  pendingLoading.value = true;
  pendingError.value = '';
  let needsReload = false;
  try {
    const today = hotelToday();
    const keyword = pendingKeyword.value.trim();
    const response = await listBookings({
      page: pendingPage.value,
      pageSize: pendingPageSize.value,
      status: 'CONFIRMED',
      checkInDateTo: today,
      checkOutDateFrom: addDays(today, 1),
      ...(keyword === '' ? {} : { keyword }),
      sort: 'checkInDate:asc',
    });
    if (sequence !== pendingSequence) return;
    pendingBookings.value = response.items;
    pendingTotal.value = response.pagination.total;
    pendingLoadedOnce.value = true;
    if (response.pagination.totalPages > 0 && pendingPage.value > response.pagination.totalPages) {
      pendingPage.value = response.pagination.totalPages;
      needsReload = true;
    }
  } catch (error) {
    if (sequence !== pendingSequence) return;
    pendingBookings.value = [];
    pendingError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === pendingSequence) {
      pendingLoading.value = false;
      if (needsReload) void loadPendingBookings();
    }
  }
}

async function loadStays(): Promise<void> {
  const sequence = ++staysSequence;
  staysLoading.value = true;
  staysError.value = '';
  let needsReload = false;
  try {
    const keyword = stayKeyword.value.trim();
    const response = await listStays({
      page: staysPage.value,
      pageSize: staysPageSize.value,
      ...(stayStatusFilter.value === '' ? {} : { status: stayStatusFilter.value }),
      ...(keyword === '' ? {} : { keyword }),
      sort: staySort.value,
    });
    if (sequence !== staysSequence) return;
    stays.value = response.items;
    staysTotal.value = response.pagination.total;
    staysLoadedOnce.value = true;
    if (response.pagination.totalPages > 0 && staysPage.value > response.pagination.totalPages) {
      staysPage.value = response.pagination.totalPages;
      needsReload = true;
    }
  } catch (error) {
    if (sequence !== staysSequence) return;
    stays.value = [];
    staysError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === staysSequence) {
      staysLoading.value = false;
      if (needsReload) void loadStays();
    }
  }
}

function applyPendingFilters(): void {
  pendingPage.value = 1;
  void loadPendingBookings();
}

function resetPendingFilters(): void {
  pendingKeyword.value = '';
  pendingPage.value = 1;
  void loadPendingBookings();
}

function handlePendingPageChange(page: number): void {
  pendingPage.value = page;
  void loadPendingBookings();
}

function handlePendingSizeChange(size: number): void {
  pendingPageSize.value = size;
  pendingPage.value = 1;
  void loadPendingBookings();
}

function applyStayFilters(): void {
  staysPage.value = 1;
  void loadStays();
}

function resetStayFilters(): void {
  stayStatusFilter.value = 'CHECKED_IN';
  stayKeyword.value = '';
  staySort.value = 'checkInAt:desc';
  staysPage.value = 1;
  void loadStays();
}

function handleStayPageChange(page: number): void {
  staysPage.value = page;
  void loadStays();
}

function handleStaySizeChange(size: number): void {
  staysPageSize.value = size;
  staysPage.value = 1;
  void loadStays();
}

function refreshActiveTab(): void {
  if (activeTab.value === 'pending') {
    void loadPendingBookings();
  } else {
    void loadStays();
  }
}

function openCheckIn(row: BookingDto): void {
  checkInBookingId.value = row.id;
  checkInVisible.value = true;
}

function handleCheckedIn(): void {
  activeTab.value = 'stays';
  stayStatusFilter.value = 'CHECKED_IN';
  stayKeyword.value = '';
  staySort.value = 'checkInAt:desc';
  staysPage.value = 1;
  void loadPendingBookings();
  void loadStays();
}

function openCheckout(row: StayDto): void {
  checkoutStayId.value = row.id;
  checkoutVisible.value = true;
}

function handleCheckedOut(): void {
  void loadStays();
}

function handleWalkedIn(): void {
  handleCheckedIn();
}

function handleWalkInRefresh(): void {
  void loadPendingBookings();
  void loadStays();
}

function openStayDetail(row: StayDto): void {
  void router.push({ name: 'stay-detail', params: { id: row.id } });
}

onMounted(() => {
  void loadPendingBookings();
  void loadStays();
});
</script>

<template>
  <PageContainer>
    <template #actions>
      <el-button type="primary" @click="walkInVisible = true">直接入住</el-button>
      <el-button
        :loading="activeTab === 'pending' ? pendingLoading : staysLoading"
        @click="refreshActiveTab"
      >
        刷新
      </el-button>
    </template>

    <el-tabs v-model="activeTab">
      <el-tab-pane :label="pendingTabLabel" name="pending">
        <el-alert
          class="tab-note"
          type="info"
          title="仅显示入住日 ≤ 酒店今日且离店日 > 今日的已确认预订。入住时需选择可分配房间。"
          :closable="false"
          show-icon
        />

        <FilterBar>
          <div class="filter-field">
            <span class="filter-label">客人</span>
            <el-input
              v-model="pendingKeyword"
              placeholder="姓名或手机号前缀"
              maxlength="50"
              clearable
              class="filter-input"
              @keyup.enter="applyPendingFilters"
            />
          </div>
          <template #actions>
            <el-button @click="resetPendingFilters">重置</el-button>
            <el-button type="primary" @click="applyPendingFilters">查询</el-button>
          </template>
        </FilterBar>

        <TableCard>
          <template #toolbar>
            <span class="table-title">待入住预订</span>
            <span class="table-meta">共 {{ pendingTotal }} 条</span>
          </template>

          <div v-if="pendingLoading && !pendingLoadedOnce" class="table-loading">
            <el-skeleton :rows="4" animated />
          </div>

          <el-result
            v-else-if="pendingError !== '' && !pendingLoadedOnce"
            icon="error"
            title="待入住预订加载失败"
            :sub-title="pendingError"
          >
            <template #extra>
              <el-button type="primary" @click="loadPendingBookings">重试</el-button>
            </template>
          </el-result>

          <template v-else>
            <el-alert
              v-if="pendingError !== ''"
              class="table-error"
              type="error"
              title="刷新待入住预订失败"
              :closable="false"
              show-icon
            >
              <span class="table-error-body">
                <span>{{ pendingError }}</span>
                <el-button size="small" @click="loadPendingBookings">重试</el-button>
              </span>
            </el-alert>

            <el-table v-loading="pendingLoading" :data="pendingBookings" row-key="id" border>
              <el-table-column label="预订编号" width="100">
                <template #default="{ row }">#{{ row.id }}</template>
              </el-table-column>
              <el-table-column label="客人" min-width="150" show-overflow-tooltip>
                <template #default="{ row }"> {{ row.guestName }} · {{ row.guestPhone }} </template>
              </el-table-column>
              <el-table-column
                prop="roomTypeName"
                label="房型"
                min-width="140"
                show-overflow-tooltip
              />
              <el-table-column label="入住 / 离店" min-width="180">
                <template #default="{ row }">
                  {{ row.checkInDate }} → {{ row.checkOutDate }}
                </template>
              </el-table-column>
              <el-table-column label="房价 / 总价" width="140" align="right">
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
              <el-table-column label="操作" width="120" fixed="right">
                <template #default="{ row }">
                  <el-button type="primary" link @click="openCheckIn(row)"> 办理入住 </el-button>
                </template>
              </el-table-column>

              <template #empty>
                <el-empty description="暂无待入住预订" />
              </template>
            </el-table>
          </template>

          <template #footer>
            <el-pagination
              :current-page="pendingPage"
              :page-size="pendingPageSize"
              :total="pendingTotal"
              :page-sizes="[10, 20, 50]"
              layout="total, sizes, prev, pager, next"
              background
              @current-change="handlePendingPageChange"
              @size-change="handlePendingSizeChange"
            />
          </template>
        </TableCard>
      </el-tab-pane>

      <el-tab-pane :label="staysTabLabel" name="stays">
        <FilterBar>
          <div class="filter-field">
            <span class="filter-label">状态</span>
            <el-select v-model="stayStatusFilter" class="filter-select">
              <el-option
                v-for="option in statusOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </div>
          <div class="filter-field">
            <span class="filter-label">客人</span>
            <el-input
              v-model="stayKeyword"
              placeholder="姓名或手机号前缀"
              maxlength="50"
              clearable
              class="filter-input"
              @keyup.enter="applyStayFilters"
            />
          </div>
          <div class="filter-field">
            <span class="filter-label">排序</span>
            <el-select v-model="staySort" class="filter-select">
              <el-option
                v-for="option in staySortOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </div>
          <template #actions>
            <el-button @click="resetStayFilters">重置</el-button>
            <el-button type="primary" @click="applyStayFilters">查询</el-button>
          </template>
        </FilterBar>

        <TableCard>
          <template #toolbar>
            <span class="table-title">入住记录</span>
            <span class="table-meta">共 {{ staysTotal }} 条</span>
          </template>

          <div v-if="staysLoading && !staysLoadedOnce" class="table-loading">
            <el-skeleton :rows="4" animated />
          </div>

          <el-result
            v-else-if="staysError !== '' && !staysLoadedOnce"
            icon="error"
            title="入住记录加载失败"
            :sub-title="staysError"
          >
            <template #extra>
              <el-button type="primary" @click="loadStays">重试</el-button>
            </template>
          </el-result>

          <template v-else>
            <el-alert
              v-if="staysError !== ''"
              class="table-error"
              type="error"
              title="刷新入住记录失败"
              :closable="false"
              show-icon
            >
              <span class="table-error-body">
                <span>{{ staysError }}</span>
                <el-button size="small" @click="loadStays">重试</el-button>
              </span>
            </el-alert>

            <el-table v-loading="staysLoading" :data="stays" row-key="id" border>
              <el-table-column label="入住编号" width="100">
                <template #default="{ row }">#{{ row.id }}</template>
              </el-table-column>
              <el-table-column label="客人" min-width="130" show-overflow-tooltip>
                <template #default="{ row }">{{ row.guestName }}</template>
              </el-table-column>
              <el-table-column label="房号 / 房型" min-width="150" show-overflow-tooltip>
                <template #default="{ row }">
                  {{ row.roomNumber }} · {{ row.roomTypeName }}
                </template>
              </el-table-column>
              <el-table-column label="入住时间" width="170">
                <template #default="{ row }">{{ formatDateTime(row.checkInAt) }}</template>
              </el-table-column>
              <el-table-column label="预计离店" width="120">
                <template #default="{ row }">
                  {{ formatDateOnly(row.expectedCheckOutDate) }}
                </template>
              </el-table-column>
              <el-table-column label="押金" width="110" align="right">
                <template #default="{ row }">{{ formatMoney(row.depositAmount) }}</template>
              </el-table-column>
              <el-table-column label="状态" width="100" align="center">
                <template #default="{ row }">
                  <StayStatusTag :status="row.status" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="150" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openStayDetail(row)">详情</el-button>
                  <el-button
                    v-if="row.status === 'CHECKED_IN'"
                    link
                    type="danger"
                    @click="openCheckout(row)"
                  >
                    退房
                  </el-button>
                </template>
              </el-table-column>

              <template #empty>
                <el-empty
                  :description="
                    stayStatusFilter === '' ? '暂无入住记录' : '当前筛选条件下暂无入住记录'
                  "
                />
              </template>
            </el-table>
          </template>

          <template #footer>
            <el-pagination
              :current-page="staysPage"
              :page-size="staysPageSize"
              :total="staysTotal"
              :page-sizes="[10, 20, 50]"
              layout="total, sizes, prev, pager, next"
              background
              @current-change="handleStayPageChange"
              @size-change="handleStaySizeChange"
            />
          </template>
        </TableCard>
      </el-tab-pane>
    </el-tabs>

    <CheckInDialog
      v-model="checkInVisible"
      :booking-id="checkInBookingId"
      @checked-in="handleCheckedIn"
    />
    <CheckoutDialog
      v-model="checkoutVisible"
      :stay-id="checkoutStayId"
      @checked-out="handleCheckedOut"
    />
    <WalkInDialog
      v-model="walkInVisible"
      @walked-in="handleWalkedIn"
      @refresh-requested="handleWalkInRefresh"
    />
  </PageContainer>
</template>

<style scoped>
.tab-note {
  margin-bottom: 16px;
}

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

.total-price {
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
