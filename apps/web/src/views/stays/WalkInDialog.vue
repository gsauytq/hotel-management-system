<script setup lang="ts">
import {
  createStaySchema,
  hasAtMostTwoDecimals,
  type AvailableRoomDto,
  type RoomTypeDto,
  type StayDto,
} from '@hms/shared';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { computed, nextTick, reactive, ref, watch } from 'vue';

import { listRoomTypes } from '@/api/room-types';
import { listAvailableRooms } from '@/api/rooms';
import { createWalkIn } from '@/api/stays';
import GuestPicker from '@/components/guests/GuestPicker.vue';
import { ROOM_STATUS_LABELS } from '@/constants/rooms';
import {
  extractFieldErrors,
  formatApiError,
  isApiRequestError,
  type ApiRequestError,
} from '@/utils/errors';
import { formatMoney } from '@/utils/format';
import { addDays, hotelToday, toLocalDateOnly } from '@/utils/hotel-date';

interface WalkInFormModel {
  guestId: number | undefined;
  roomTypeId: number | undefined;
  roomId: number | undefined;
  expectedCheckOutDate: string;
  pricePerNight: number | undefined;
  depositAmount: number | undefined;
  note: string;
}

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'walked-in': [stayId: number];
  'refresh-requested': [];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const formRef = ref<FormInstance>();
const form = reactive<WalkInFormModel>({
  guestId: undefined,
  roomTypeId: undefined,
  roomId: undefined,
  expectedCheckOutDate: '',
  pricePerNight: undefined,
  depositAmount: undefined,
  note: '',
});

const today = ref(hotelToday());
const roomTypes = ref<RoomTypeDto[]>([]);
const roomTypesLoading = ref(false);
const roomTypesError = ref('');

const rooms = ref<AvailableRoomDto[]>([]);
const roomsLoading = ref(false);
const roomsError = ref('');

const submitting = ref(false);
const uncertain = ref(false);
const submitError = ref('');
const fieldErrors = ref<Record<string, string>>({});

let roomTypesSequence = 0;
let roomsSequence = 0;

const selectedRoomType = computed(
  () => roomTypes.value.find((roomType) => roomType.id === form.roomTypeId) ?? null,
);

const canUseForm = computed(() => !submitting.value && !uncertain.value);

function validatePrice(_rule: unknown, value: unknown, callback: (error?: Error) => void): void {
  if (typeof value !== 'number' || value < 0.01 || value > 99999.99) {
    callback(new Error('房价须在 0.01–99999.99 之间'));
    return;
  }
  if (!hasAtMostTwoDecimals(value)) {
    callback(new Error('房价最多两位小数'));
    return;
  }
  callback();
}

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

const rules: FormRules<WalkInFormModel> = {
  guestId: [{ required: true, message: '请选择客人', trigger: 'change' }],
  roomTypeId: [{ required: true, message: '请选择房型', trigger: 'change' }],
  roomId: [{ required: true, message: '请选择可分配房间', trigger: 'change' }],
  expectedCheckOutDate: [{ required: true, message: '请选择预计离店日期', trigger: 'change' }],
  pricePerNight: [{ required: true, validator: validatePrice, trigger: 'change' }],
  depositAmount: [{ validator: validateDeposit, trigger: 'change' }],
  note: [{ max: 500, message: '备注不得超过 500 个字符', trigger: 'blur' }],
};

function disableDate(date: Date): boolean {
  return toLocalDateOnly(date) <= today.value;
}

function resetForm(): void {
  form.guestId = undefined;
  form.roomTypeId = undefined;
  form.roomId = undefined;
  form.pricePerNight = undefined;
  form.depositAmount = undefined;
  form.note = '';
  today.value = hotelToday();
  form.expectedCheckOutDate = addDays(today.value, 1);
  rooms.value = [];
  roomsError.value = '';
  submitError.value = '';
  fieldErrors.value = {};
  uncertain.value = false;
  void nextTick(() => {
    formRef.value?.clearValidate();
  });
}

async function loadRoomTypes(): Promise<void> {
  const sequence = ++roomTypesSequence;
  roomTypesLoading.value = true;
  roomTypesError.value = '';
  try {
    const response = await listRoomTypes({ status: 'ACTIVE' });
    if (sequence !== roomTypesSequence) return;
    roomTypes.value = response.items;
  } catch (error) {
    if (sequence !== roomTypesSequence) return;
    roomTypes.value = [];
    roomTypesError.value = formatApiError(error, '房型加载失败，请稍后重试。');
  } finally {
    if (sequence === roomTypesSequence) {
      roomTypesLoading.value = false;
    }
  }
}

async function loadAvailableRooms(): Promise<void> {
  if (form.roomTypeId === undefined) {
    rooms.value = [];
    roomsError.value = '';
    return;
  }
  today.value = hotelToday();
  const checkInDate: string = today.value;
  if (!form.expectedCheckOutDate || form.expectedCheckOutDate <= checkInDate) {
    rooms.value = [];
    roomsError.value = '';
    return;
  }

  const sequence = ++roomsSequence;
  roomsLoading.value = true;
  roomsError.value = '';
  try {
    const response = await listAvailableRooms({
      roomTypeId: form.roomTypeId,
      checkInDate,
      checkOutDate: form.expectedCheckOutDate,
    });
    if (sequence !== roomsSequence) return;
    rooms.value = response.items;
    if (form.roomId !== undefined && !response.items.some((room) => room.id === form.roomId)) {
      form.roomId = undefined;
    }
  } catch (error) {
    if (sequence !== roomsSequence) return;
    rooms.value = [];
    form.roomId = undefined;
    roomsError.value = formatApiError(error, '可分配房间加载失败，请稍后重试。');
  } finally {
    if (sequence === roomsSequence) {
      roomsLoading.value = false;
    }
  }
}

function handleRoomTypeChange(value: number | undefined): void {
  form.roomId = undefined;
  const roomType = roomTypes.value.find((item) => item.id === value) ?? null;
  form.pricePerNight =
    roomType !== null && roomType.basePrice >= 0.01 ? roomType.basePrice : undefined;
  void loadAvailableRooms();
}

function handleDateChange(): void {
  form.roomId = undefined;
  void loadAvailableRooms();
}

async function initialize(): Promise<void> {
  resetForm();
  await loadRoomTypes();
}

function handleBeforeClose(done: () => void): void {
  if (!submitting.value) done();
}

function formatSubmitError(error: ApiRequestError): string {
  const detail = error.details[0]?.message;
  if (detail !== undefined) return `${error.message}：${detail}`;
  if (error.requestId !== undefined) {
    return `${error.message}（请求编号：${error.requestId}）`;
  }
  return error.message;
}

function completeWalkIn(stay: StayDto): void {
  ElMessage.success(`入住办理成功，入住记录 #${stay.id}`);
  emit('walked-in', stay.id);
  visible.value = false;
}

async function handleSubmit(): Promise<void> {
  const formInstance = formRef.value;
  if (formInstance === undefined || !canUseForm.value) return;

  today.value = hotelToday();
  submitError.value = '';
  fieldErrors.value = {};

  if (!form.expectedCheckOutDate || form.expectedCheckOutDate <= today.value) {
    fieldErrors.value = { expectedCheckOutDate: '离店日期必须晚于今日（酒店本地日）' };
    return;
  }

  submitting.value = true;
  try {
    const valid = await formInstance.validate().catch(() => false);
    if (!valid) return;

    const parsed = createStaySchema.safeParse({
      guestId: form.guestId,
      roomId: form.roomId,
      pricePerNight: form.pricePerNight,
      expectedCheckOutDate: form.expectedCheckOutDate,
      depositAmount: form.depositAmount ?? undefined,
      note: form.note.trim() === '' ? undefined : form.note,
    });
    if (!parsed.success) {
      submitError.value = parsed.error.issues[0]?.message ?? '请检查输入内容';
      return;
    }

    const selectedRoom = rooms.value.find((room) => room.id === form.roomId);
    if (selectedRoom === undefined) {
      submitError.value = '所选房间已不可用，请重新选择';
      await loadAvailableRooms();
      return;
    }

    try {
      await ElMessageBox.confirm(
        `确认客人 #${form.guestId} 直接入住房间 ${selectedRoom.roomNumber}，预计 ${form.expectedCheckOutDate} 离店吗？`,
        '直接入住',
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

    const stay = await createWalkIn(parsed.data);
    completeWalkIn(stay);
  } catch (error) {
    if (isApiRequestError(error)) {
      if (error.status === 422) {
        const fields = extractFieldErrors(error);
        fieldErrors.value = Object.fromEntries(
          Object.entries(fields).map(([field, messages]) => [field, messages.join('；')]),
        );
        submitError.value = error.details[0]?.message ?? formatSubmitError(error);
        return;
      }

      if (error.status === 409) {
        submitError.value = formatSubmitError(error);
        await loadAvailableRooms();
        return;
      }

      if (error.isNetworkError || (error.status !== undefined && error.status >= 500)) {
        uncertain.value = true;
        submitError.value =
          '操作结果不确定：服务端可能已创建入住记录。已请求刷新列表，请关闭后核对，勿直接重复提交。';
        emit('refresh-requested');
        await loadAvailableRooms();
        return;
      }

      submitError.value = formatSubmitError(error);
      return;
    }

    submitError.value = '入住办理失败，请稍后重试。';
  } finally {
    submitting.value = false;
  }
}

function handleUncertainClose(): void {
  emit('refresh-requested');
  visible.value = false;
}

watch(visible, (open) => {
  if (open) {
    void initialize();
  }
});
</script>

<template>
  <el-dialog
    v-model="visible"
    title="直接入住（walk-in）"
    width="min(640px, 94vw)"
    :close-on-click-modal="false"
    :before-close="handleBeforeClose"
    :show-close="!submitting"
  >
    <el-alert
      class="dialog-alert"
      type="info"
      title="无预订入住；入住日固定为酒店今日，房价可覆盖房型基准价。"
      :closable="false"
      show-icon
    />

    <el-alert
      v-if="roomTypesError !== ''"
      class="dialog-alert"
      type="error"
      title="房型加载失败"
      :closable="false"
      show-icon
    >
      <span class="dialog-alert-body">
        <span>{{ roomTypesError }}</span>
        <el-button size="small" @click="loadRoomTypes">重试</el-button>
      </span>
    </el-alert>

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
        <el-button size="small" @click="loadAvailableRooms">重试</el-button>
      </span>
    </el-alert>

    <el-alert
      v-if="submitError !== ''"
      class="dialog-alert"
      :type="uncertain ? 'warning' : 'error'"
      :title="uncertain ? '入住结果不确定' : '入住办理失败'"
      :description="submitError"
      :closable="false"
      show-icon
    />

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      :disabled="!canUseForm"
      label-position="top"
      @submit.prevent="handleSubmit"
    >
      <el-form-item label="客人" prop="guestId" :error="fieldErrors.guestId">
        <GuestPicker v-model="form.guestId" :disabled="!canUseForm" />
      </el-form-item>

      <el-form-item label="房型" prop="roomTypeId" :error="fieldErrors.roomTypeId">
        <el-select
          v-model="form.roomTypeId"
          placeholder="请选择启用房型"
          :loading="roomTypesLoading"
          filterable
          class="form-select"
          @change="handleRoomTypeChange"
        >
          <el-option
            v-for="roomType in roomTypes"
            :key="roomType.id"
            :value="roomType.id"
            :label="`${roomType.name}（${roomType.code}）`"
          />
        </el-select>
        <div v-if="selectedRoomType !== null" class="form-hint">
          基准价 {{ formatMoney(selectedRoomType.basePrice) }} / 晚；房价可覆盖。
        </div>
        <div
          v-else-if="!roomTypesLoading && roomTypes.length === 0 && roomTypesError === ''"
          class="form-hint"
        >
          暂无启用房型，请先维护房型。
        </div>
      </el-form-item>

      <el-form-item
        label="预计离店日期"
        prop="expectedCheckOutDate"
        :error="fieldErrors.expectedCheckOutDate"
      >
        <el-date-picker
          v-model="form.expectedCheckOutDate"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="请选择预计离店日期"
          :disabled-date="disableDate"
          class="form-date"
          @change="handleDateChange"
        />
      </el-form-item>

      <el-form-item label="可分配房间" prop="roomId" :error="fieldErrors.roomId">
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
          当前房型与日期暂无可分配房间；若刚完成其他操作，请重试。
        </div>
      </el-form-item>

      <el-form-item label="房价（元/晚）" prop="pricePerNight" :error="fieldErrors.pricePerNight">
        <el-input-number
          v-model="form.pricePerNight"
          :min="0.01"
          :max="99999.99"
          :precision="2"
          :step="10"
          class="form-number"
        />
      </el-form-item>

      <el-form-item label="押金（可选）" prop="depositAmount" :error="fieldErrors.depositAmount">
        <el-input-number
          v-model="form.depositAmount"
          :min="0"
          :max="99999.99"
          :precision="2"
          :step="100"
          class="form-number"
        />
      </el-form-item>

      <el-form-item label="备注（可选）" prop="note" :error="fieldErrors.note">
        <el-input
          v-model="form.note"
          type="textarea"
          :rows="2"
          maxlength="500"
          show-word-limit
          placeholder="如深夜到店、特殊需求"
        />
      </el-form-item>

      <div class="dialog-actions">
        <el-button v-if="uncertain" type="primary" @click="handleUncertainClose">
          刷新列表并关闭
        </el-button>
        <template v-else>
          <el-button :disabled="submitting" @click="visible = false">取消</el-button>
          <el-button type="primary" :loading="submitting" @click="handleSubmit">
            确认入住
          </el-button>
        </template>
      </div>
    </el-form>
  </el-dialog>
</template>

<style scoped>
.dialog-alert {
  margin-bottom: 16px;
}

.dialog-alert-body {
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-select,
.form-date {
  width: 100%;
}

.form-number {
  width: 180px;
}

.form-hint {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
