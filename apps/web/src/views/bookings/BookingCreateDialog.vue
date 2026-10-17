<script setup lang="ts">
import { createBookingSchema, type BookingDto, type RoomTypeDto } from '@hms/shared';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { computed, nextTick, reactive, ref, watch } from 'vue';

import { createBooking } from '@/api/bookings';
import { listRoomTypes } from '@/api/room-types';
import GuestPicker from '@/components/guests/GuestPicker.vue';
import { isApiRequestError, toApiRequestError } from '@/utils/errors';
import { formatMoney } from '@/utils/format';
import { addDays, hotelToday, toLocalDateOnly } from '@/utils/hotel-date';

interface BookingFormModel {
  guestId: number | undefined;
  roomTypeId: number | undefined;
  checkInDate: string;
  checkOutDate: string;
  note: string;
}

const props = defineProps<{ modelValue: boolean }>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  created: [booking: BookingDto];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const formRef = ref<FormInstance>();
const submitting = ref(false);
const submitError = ref('');
const today = ref(hotelToday());

const roomTypes = ref<RoomTypeDto[]>([]);
const roomTypesLoading = ref(false);
const roomTypesError = ref('');

const form = reactive<BookingFormModel>({
  guestId: undefined,
  roomTypeId: undefined,
  checkInDate: '',
  checkOutDate: '',
  note: '',
});

const selectedRoomType = computed(
  () => roomTypes.value.find((roomType) => roomType.id === form.roomTypeId) ?? null,
);

const rules: FormRules<BookingFormModel> = {
  guestId: [{ required: true, message: '请选择客人', trigger: 'change' }],
  roomTypeId: [{ required: true, message: '请选择房型', trigger: 'change' }],
  checkInDate: [{ required: true, message: '请选择入住日期', trigger: 'change' }],
  checkOutDate: [{ required: true, message: '请选择退房日期', trigger: 'change' }],
  note: [{ max: 500, message: '备注不得超过 500 个字符', trigger: 'blur' }],
};

function disableCheckInDate(date: Date): boolean {
  return toLocalDateOnly(date) < today.value;
}

function disableCheckOutDate(date: Date): boolean {
  const minDate = form.checkInDate === '' ? today.value : form.checkInDate;
  return toLocalDateOnly(date) <= minDate;
}

function resetForm(): void {
  form.guestId = undefined;
  form.roomTypeId = undefined;
  form.checkInDate = '';
  form.checkOutDate = '';
  form.note = '';
  today.value = hotelToday();
  submitError.value = '';
  void nextTick(() => {
    formRef.value?.clearValidate();
  });
}

async function loadActiveRoomTypes(): Promise<void> {
  roomTypesLoading.value = true;
  roomTypesError.value = '';
  try {
    const response = await listRoomTypes({ status: 'ACTIVE' });
    roomTypes.value = response.items;
  } catch (error) {
    roomTypes.value = [];
    roomTypesError.value = toApiRequestError(error).message;
  } finally {
    roomTypesLoading.value = false;
  }
}

function handleBeforeClose(done: () => void): void {
  if (!submitting.value) done();
}

function firstIssueMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? '请检查输入内容';
}

function formatSubmitError(error: unknown): string {
  if (!isApiRequestError(error)) return '创建预订失败，请稍后重试。';
  const detail = error.details[0]?.message;
  if (detail !== undefined) return `${error.message}：${detail}`;
  if (error.requestId !== undefined) {
    return `${error.message}（请求编号：${error.requestId}）`;
  }
  return error.message;
}

async function handleSubmit(): Promise<void> {
  const formInstance = formRef.value;
  if (formInstance === undefined || submitting.value) return;

  submitting.value = true;
  submitError.value = '';
  try {
    const valid = await formInstance.validate().catch(() => false);
    if (!valid) return;

    const parsed = createBookingSchema.safeParse({
      guestId: form.guestId,
      roomTypeId: form.roomTypeId,
      checkInDate: form.checkInDate,
      checkOutDate: form.checkOutDate,
      note: form.note.trim() === '' ? undefined : form.note,
    });
    if (!parsed.success) {
      submitError.value = firstIssueMessage(parsed.error);
      return;
    }

    const currentHotelToday = hotelToday();
    if (parsed.data.checkInDate < currentHotelToday) {
      submitError.value = '入住日期不能早于酒店今日';
      return;
    }

    // 不提交 pricePerNight/totalPrice：房价快照与最终金额由服务端计算
    const booking = await createBooking(parsed.data);
    ElMessage.success(`预订 #${booking.id} 创建成功`);
    visible.value = false;
    emit('created', booking);
  } catch (error) {
    submitError.value = formatSubmitError(error);
  } finally {
    submitting.value = false;
  }
}

watch(
  () => form.checkInDate,
  (value) => {
    if (value !== '' && (form.checkOutDate === '' || form.checkOutDate <= value)) {
      form.checkOutDate = addDays(value, 1);
    }
  },
);

watch(
  form,
  () => {
    submitError.value = '';
  },
  { deep: true },
);

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      resetForm();
      void loadActiveRoomTypes();
    }
  },
);
</script>

<template>
  <el-dialog
    v-model="visible"
    title="创建预订"
    width="min(680px, 94vw)"
    :close-on-click-modal="false"
    :before-close="handleBeforeClose"
    :show-close="!submitting"
  >
    <el-alert
      v-if="roomTypesError !== ''"
      class="dialog-alert"
      type="error"
      title="启用房型加载失败"
      :closable="false"
      show-icon
    >
      <span class="dialog-alert-body">
        <span>{{ roomTypesError }}</span>
        <el-button size="small" @click="loadActiveRoomTypes">重试</el-button>
      </span>
    </el-alert>

    <el-alert
      v-if="submitError !== ''"
      class="dialog-alert"
      type="error"
      title="创建预订失败"
      :description="submitError"
      :closable="false"
      show-icon
    />

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      :disabled="submitting"
      label-position="top"
      @submit.prevent="handleSubmit"
    >
      <el-form-item label="客人" prop="guestId">
        <GuestPicker v-model="form.guestId" :disabled="submitting" />
      </el-form-item>

      <el-form-item label="房型" prop="roomTypeId">
        <el-select
          v-model="form.roomTypeId"
          placeholder="请选择启用房型"
          :loading="roomTypesLoading"
          filterable
          class="form-select"
        >
          <el-option
            v-for="roomType in roomTypes"
            :key="roomType.id"
            :value="roomType.id"
            :label="`${roomType.name}（${roomType.code}）`"
          />
        </el-select>
      </el-form-item>

      <div v-if="selectedRoomType !== null" class="room-type-hint">
        可住 {{ selectedRoomType.capacity }} 人 · 参考房价
        {{ formatMoney(selectedRoomType.basePrice) }} / 晚 · 房型房间数
        {{ selectedRoomType.roomCount }}。最终房价、总价与可售量以服务端创建结果为准。
      </div>

      <div class="date-grid">
        <el-form-item label="入住日期" prop="checkInDate">
          <el-date-picker
            v-model="form.checkInDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="入住日期"
            :disabled-date="disableCheckInDate"
            class="form-date"
          />
        </el-form-item>
        <el-form-item label="退房日期" prop="checkOutDate">
          <el-date-picker
            v-model="form.checkOutDate"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="退房日期"
            :disabled-date="disableCheckOutDate"
            class="form-date"
          />
        </el-form-item>
      </div>

      <el-form-item label="备注" prop="note">
        <el-input
          v-model="form.note"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          placeholder="可选，如高楼层、特殊需求"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="submitting" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit"> 创建预订 </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
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

.form-select,
.form-date {
  width: 100%;
}

.room-type-hint {
  margin: -8px 0 16px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.date-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 560px) {
  .date-grid {
    grid-template-columns: 1fr;
  }
}
</style>
