<script setup lang="ts">
import {
  checkInBookingSchema,
  hasAtMostTwoDecimals,
  type AvailableRoomDto,
  type BookingDetailDto,
} from '@hms/shared';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { computed, nextTick, reactive, ref, watch } from 'vue';

import { getBooking } from '@/api/bookings';
import { listAvailableRooms } from '@/api/rooms';
import { checkInBooking } from '@/api/stays';
import { ROOM_STATUS_LABELS } from '@/constants/rooms';
import { isApiRequestError, toApiRequestError } from '@/utils/errors';
import { formatDateOnly, formatMoney } from '@/utils/format';
import { hotelToday } from '@/utils/hotel-date';

import { reconcileCheckIn, shouldReconcileCheckInError } from './reconciliation';

interface CheckInFormModel {
  roomId: number | undefined;
  depositAmount: number | undefined;
}

const props = defineProps<{
  modelValue: boolean;
  bookingId: number | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'checked-in': [stayId: number];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const formRef = ref<FormInstance>();
const form = reactive<CheckInFormModel>({
  roomId: undefined,
  depositAmount: undefined,
});
const submitting = ref(false);
const submitError = ref('');

const detailLoading = ref(false);
const detailError = ref('');
const booking = ref<BookingDetailDto | null>(null);

const rooms = ref<AvailableRoomDto[]>([]);
const roomsLoading = ref(false);
const roomsError = ref('');

let detailSequence = 0;
let roomsSequence = 0;

const eligible = computed(() => {
  if (booking.value === null) return false;
  const today = hotelToday();
  return (
    booking.value.status === 'CONFIRMED' &&
    booking.value.checkInDate <= today &&
    booking.value.checkOutDate > today
  );
});

const ineligibleReason = computed(() => {
  if (booking.value === null) return '';
  if (booking.value.status !== 'CONFIRMED') {
    return '该预订不是“已确认”状态，无法办理入住';
  }
  const today = hotelToday();
  if (booking.value.checkInDate > today) return '未到入住日，暂不可办理入住';
  if (booking.value.checkOutDate <= today) {
    return '预订离店日期已到或已过，不可办理入住，请重新预订';
  }
  return '';
});

function validateDeposit(_rule: unknown, value: unknown, callback: (error?: Error) => void): void {
  if (value === undefined || value === null) {
    callback();
    return;
  }
  if (typeof value !== 'number' || value < 0 || value > 99999.99) {
    callback(new Error('押金须在 0–99999.99 之间'));
    return;
  }
  if (!hasAtMostTwoDecimals(value)) {
    callback(new Error('押金最多两位小数'));
    return;
  }
  callback();
}

const rules: FormRules<CheckInFormModel> = {
  roomId: [{ required: true, message: '请选择可分配房间', trigger: 'change' }],
  depositAmount: [{ validator: validateDeposit, trigger: 'change' }],
};

function resetForm(): void {
  form.roomId = undefined;
  form.depositAmount = undefined;
  submitError.value = '';
  void nextTick(() => {
    formRef.value?.clearValidate();
  });
}

async function loadAvailableRooms(detail: BookingDetailDto): Promise<void> {
  if (detail.status !== 'CONFIRMED') {
    rooms.value = [];
    roomsError.value = '';
    return;
  }
  const today = hotelToday();
  if (detail.checkInDate > today || detail.checkOutDate <= today) {
    rooms.value = [];
    roomsError.value = '';
    return;
  }

  const sequence = ++roomsSequence;
  roomsLoading.value = true;
  roomsError.value = '';
  try {
    const response = await listAvailableRooms({
      roomTypeId: detail.roomTypeId,
      checkInDate: today,
      checkOutDate: detail.checkOutDate,
    });
    if (sequence !== roomsSequence) return;
    rooms.value = response.items;
  } catch (error) {
    if (sequence !== roomsSequence) return;
    rooms.value = [];
    roomsError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === roomsSequence) {
      roomsLoading.value = false;
    }
  }
}

async function loadBookingDetail(): Promise<void> {
  const id = props.bookingId;
  if (id === null) {
    booking.value = null;
    detailError.value = '缺少预订编号';
    return;
  }

  const sequence = ++detailSequence;
  detailLoading.value = true;
  detailError.value = '';
  try {
    const detail = await getBooking(id);
    if (sequence !== detailSequence) return;
    booking.value = detail;
    await loadAvailableRooms(detail);
  } catch (error) {
    if (sequence !== detailSequence) return;
    booking.value = null;
    rooms.value = [];
    detailError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === detailSequence) {
      detailLoading.value = false;
    }
  }
}

function handleBeforeClose(done: () => void): void {
  if (!submitting.value) done();
}

function formatApiError(error: unknown): string {
  if (!isApiRequestError(error)) return '办理入住失败，请稍后重试。';
  const detail = error.details[0]?.message;
  if (detail !== undefined) return `${error.message}：${detail}`;
  if (error.requestId !== undefined) {
    return `${error.message}（请求编号：${error.requestId}）`;
  }
  return error.message;
}

function completeCheckIn(stayId: number, message: string): void {
  ElMessage.success(message);
  emit('checked-in', stayId);
  visible.value = false;
}

async function handleSubmit(): Promise<void> {
  const formInstance = formRef.value;
  const currentBooking = booking.value;
  if (formInstance === undefined || currentBooking === null || submitting.value) return;

  if (!eligible.value) {
    submitError.value = ineligibleReason.value;
    return;
  }

  submitting.value = true;
  submitError.value = '';
  try {
    const valid = await formInstance.validate().catch(() => false);
    if (!valid) return;

    const parsed = checkInBookingSchema.safeParse({
      roomId: form.roomId,
      depositAmount: form.depositAmount ?? undefined,
    });
    if (!parsed.success) {
      submitError.value = parsed.error.issues[0]?.message ?? '请检查输入内容';
      return;
    }

    const selectedRoom = rooms.value.find((room) => room.id === form.roomId);
    if (selectedRoom === undefined) {
      submitError.value = '所选房间已不可用，请重新选择';
      await loadAvailableRooms(currentBooking);
      return;
    }

    try {
      await ElMessageBox.confirm(
        `确认将预订 #${currentBooking.id}（${currentBooking.guestName}）入住至房间 ${selectedRoom.roomNumber} 吗？`,
        '办理入住',
        {
          type: 'warning',
          confirmButtonText: '确认入住',
          cancelButtonText: '返回',
          autofocus: false,
        },
      );
    } catch {
      return;
    }

    const stay = await checkInBooking(currentBooking.id, parsed.data);
    completeCheckIn(stay.id, `入住办理成功，入住记录 #${stay.id}`);
  } catch (error) {
    if (isApiRequestError(error)) {
      if (shouldReconcileCheckInError(error)) {
        const reconciliation = await reconcileCheckIn(currentBooking.id);
        if (reconciliation.confirmed && reconciliation.detail?.stayId != null) {
          completeCheckIn(reconciliation.detail.stayId, '入住已完成（已核对服务端状态）');
          return;
        }
        submitError.value = reconciliation.detail
          ? '操作结果不确定，服务端仍显示该预订未入住，请刷新后重试。'
          : '操作结果不确定，无法核对服务端状态，请刷新后重试。';
      } else {
        submitError.value = formatApiError(error);
      }
      await loadBookingDetail();
    } else {
      submitError.value = '办理入住失败，请稍后重试。';
    }
  } finally {
    submitting.value = false;
  }
}

watch(
  () => [props.modelValue, props.bookingId] as const,
  ([open]) => {
    if (open) {
      resetForm();
      void loadBookingDetail();
    } else {
      booking.value = null;
      rooms.value = [];
      detailError.value = '';
      roomsError.value = '';
    }
  },
);
</script>

<template>
  <el-dialog
    v-model="visible"
    title="办理入住"
    width="min(640px, 94vw)"
    :close-on-click-modal="false"
    :before-close="handleBeforeClose"
    :show-close="!submitting"
  >
    <div v-if="detailLoading" class="dialog-loading">
      <el-skeleton :rows="4" animated />
    </div>

    <el-alert
      v-else-if="detailError !== ''"
      type="error"
      title="预订加载失败"
      :closable="false"
      show-icon
    >
      <span class="dialog-alert-body">
        <span>{{ detailError }}</span>
        <el-button size="small" @click="loadBookingDetail">重试</el-button>
      </span>
    </el-alert>

    <template v-else-if="booking !== null">
      <el-descriptions :column="2" border class="booking-summary">
        <el-descriptions-item label="预订编号">#{{ booking.id }}</el-descriptions-item>
        <el-descriptions-item label="客人">{{ booking.guestName }}</el-descriptions-item>
        <el-descriptions-item label="房型">{{ booking.roomTypeName }}</el-descriptions-item>
        <el-descriptions-item label="房价">
          {{ formatMoney(booking.pricePerNight) }} / 晚
        </el-descriptions-item>
        <el-descriptions-item label="入住日期">{{ booking.checkInDate }}</el-descriptions-item>
        <el-descriptions-item label="预计离店">
          {{ formatDateOnly(booking.checkOutDate) }}
        </el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-if="!eligible && ineligibleReason !== ''"
        class="dialog-alert"
        type="warning"
        :title="ineligibleReason"
        :closable="false"
        show-icon
      />

      <el-alert
        v-if="roomsError !== ''"
        class="dialog-alert"
        type="error"
        title="可分配房间加载失败"
        :closable="false"
        show-icon
      >
        <span class="dialog-alert-body">
          <span>{{ roomsError }}</span>
          <el-button size="small" @click="loadBookingDetail">重试</el-button>
        </span>
      </el-alert>

      <el-alert
        v-if="submitError !== ''"
        class="dialog-alert"
        type="error"
        title="入住办理失败"
        :description="submitError"
        :closable="false"
        show-icon
      />

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        :disabled="submitting || !eligible"
        label-position="top"
        @submit.prevent="handleSubmit"
      >
        <el-form-item label="分配房间" prop="roomId">
          <el-select
            v-model="form.roomId"
            placeholder="请选择可分配房间"
            :loading="roomsLoading"
            filterable
            class="form-select"
          >
            <el-option
              v-for="room in rooms"
              :key="room.id"
              :value="room.id"
              :label="`${room.roomNumber}（${ROOM_STATUS_LABELS[room.status]}）`"
            />
          </el-select>
          <div v-if="!roomsLoading && rooms.length === 0 && roomsError === ''" class="form-hint">
            当前日期暂无可分配房间；若刚完成其他操作，请重试或联系管理员。
          </div>
        </el-form-item>

        <el-form-item label="押金（可选）" prop="depositAmount">
          <el-input-number
            v-model="form.depositAmount"
            :min="0"
            :max="99999.99"
            :precision="2"
            :step="100"
            controls-position="right"
            placeholder="0.00"
            class="form-number"
          />
        </el-form-item>
      </el-form>
    </template>

    <template #footer>
      <el-button :disabled="submitting" @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        :disabled="submitting || !eligible || booking === null"
        @click="handleSubmit"
      >
        确认入住
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-loading {
  min-height: 120px;
}

.booking-summary {
  margin-bottom: 16px;
}

.dialog-alert {
  margin-bottom: 16px;
}

.dialog-alert-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.form-select {
  width: 100%;
}

.form-number {
  width: 100%;
}

.form-hint {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}

:deep(.el-descriptions__label) {
  width: 110px;
}

:deep(.el-tag) {
  vertical-align: middle;
}
</style>
