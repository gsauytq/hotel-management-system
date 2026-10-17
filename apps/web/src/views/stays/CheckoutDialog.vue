<script setup lang="ts">
import {
  PAYMENT_METHODS,
  checkoutStaySchema,
  type OrderDto,
  type OrderSummaryDto,
  type PaymentMethod,
  type StayDetailDto,
} from '@hms/shared';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { computed, nextTick, reactive, ref, watch } from 'vue';

import { getOrder } from '@/api/orders';
import { checkoutStay, getStay } from '@/api/stays';
import { PAYMENT_METHOD_LABELS } from '@/constants/stays';
import { isApiRequestError, toApiRequestError, type ApiRequestError } from '@/utils/errors';
import { formatDateOnly, formatDateTime, formatMoney } from '@/utils/format';

import CheckoutResult from './CheckoutResult.vue';
import { reconcileCheckout } from './reconciliation';

interface CheckoutFormModel {
  paymentMethod: PaymentMethod | undefined;
  note: string;
}

interface MiscItemForm {
  key: number;
  name: string;
  amount: number | undefined;
}

const props = defineProps<{
  modelValue: boolean;
  stayId: number | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'checked-out': [];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const formRef = ref<FormInstance>();
const form = reactive<CheckoutFormModel>({ paymentMethod: undefined, note: '' });
const miscItems = ref<MiscItemForm[]>([]);
let miscKey = 0;
const submitting = ref(false);
const submitError = ref('');

const loading = ref(false);
const loadError = ref('');
const stay = ref<StayDetailDto | null>(null);

const orderResult = ref<OrderDto | null>(null);
const orderSummary = ref<OrderSummaryDto | null>(null);
const orderLoadError = ref('');
let emitted = false;
let staySequence = 0;

const paymentOptions = PAYMENT_METHODS.map((method) => ({
  value: method,
  label: PAYMENT_METHOD_LABELS[method],
}));

const isCheckedIn = computed(() => stay.value?.status === 'CHECKED_IN');
const hasResult = computed(() => orderResult.value !== null || orderSummary.value !== null);

const rules: FormRules<CheckoutFormModel> = {
  paymentMethod: [{ required: true, message: '请选择支付方式', trigger: 'change' }],
};

function resetForm(): void {
  form.paymentMethod = undefined;
  form.note = '';
  miscItems.value = [];
  miscKey = 0;
  submitError.value = '';
  orderResult.value = null;
  orderSummary.value = null;
  orderLoadError.value = '';
  emitted = false;
  void nextTick(() => {
    formRef.value?.clearValidate();
  });
}

function addMiscItem(): void {
  if (miscItems.value.length >= 20) return;
  miscItems.value.push({ key: ++miscKey, name: '', amount: undefined });
}

function removeMiscItem(index: number): void {
  miscItems.value.splice(index, 1);
}

async function loadOrder(orderId: number): Promise<void> {
  orderLoadError.value = '';
  try {
    orderResult.value = await getOrder(orderId);
  } catch (error) {
    orderResult.value = null;
    orderLoadError.value = toApiRequestError(error).message;
  }
}

async function loadStay(): Promise<void> {
  const id = props.stayId;
  if (id === null) {
    loading.value = false;
    stay.value = null;
    loadError.value = '缺少入住记录编号';
    return;
  }

  const sequence = ++staySequence;
  loading.value = true;
  loadError.value = '';
  try {
    const detail = await getStay(id);
    if (sequence !== staySequence) return;
    stay.value = detail;
    if (detail.status === 'CHECKED_OUT' && detail.order !== null) {
      orderSummary.value = detail.order;
      await loadOrder(detail.order.id);
    }
  } catch (error) {
    if (sequence !== staySequence) return;
    stay.value = null;
    loadError.value = toApiRequestError(error).message;
  } finally {
    if (sequence === staySequence) {
      loading.value = false;
    }
  }
}

function handleBeforeClose(done: () => void): void {
  if (!submitting.value) done();
}

function formatApiError(error: unknown): string {
  if (!isApiRequestError(error)) return '退房结算失败，请稍后重试。';
  const detail = error.details[0]?.message;
  if (detail !== undefined) return `${error.message}：${detail}`;
  if (error.requestId !== undefined) {
    return `${error.message}（请求编号：${error.requestId}）`;
  }
  return error.message;
}

function shouldReconcile(error: ApiRequestError): boolean {
  return (
    error.isNetworkError ||
    (error.status !== undefined && error.status >= 500) ||
    error.code === 'STAY_STATUS_INVALID'
  );
}

function notifyCheckedOut(): void {
  if (emitted) return;
  emitted = true;
  emit('checked-out');
}

function collectMiscItems():
  { items: Array<{ name: string; amount: number }> } | { error: string } {
  const items: Array<{ name: string; amount: number }> = [];
  for (const row of miscItems.value) {
    const name = row.name.trim();
    const amount = row.amount;
    if (name === '' && (amount === undefined || amount === null)) continue;
    if (name === '') return { error: '请填写杂费名称' };
    if (typeof amount !== 'number') return { error: '请填写杂费金额' };
    items.push({ name, amount });
  }
  return { items };
}

async function handleSubmit(): Promise<void> {
  const formInstance = formRef.value;
  const currentStay = stay.value;
  if (formInstance === undefined || currentStay === null || submitting.value) return;

  if (currentStay.status !== 'CHECKED_IN') {
    submitError.value = '该入住记录已退房，不可重复结算';
    return;
  }

  submitting.value = true;
  submitError.value = '';
  try {
    const valid = await formInstance.validate().catch(() => false);
    if (!valid) return;

    const collected = collectMiscItems();
    if ('error' in collected) {
      submitError.value = collected.error;
      return;
    }

    const parsed = checkoutStaySchema.safeParse({
      paymentMethod: form.paymentMethod,
      miscItems: collected.items,
      note: form.note.trim() === '' ? undefined : form.note,
    });
    if (!parsed.success) {
      submitError.value = parsed.error.issues[0]?.message ?? '请检查输入内容';
      return;
    }

    try {
      await ElMessageBox.confirm(
        '确认退房并生成账单吗？最终金额以服务端结算结果为准。',
        '退房结算',
        {
          type: 'warning',
          confirmButtonText: '确认退房',
          cancelButtonText: '返回',
          autofocus: false,
        },
      );
    } catch {
      return;
    }

    const order = await checkoutStay(currentStay.id, parsed.data);
    orderResult.value = order;
    orderSummary.value = null;
    orderLoadError.value = '';
    ElMessage.success('退房结算成功');
    notifyCheckedOut();
  } catch (error) {
    if (isApiRequestError(error)) {
      if (shouldReconcile(error)) {
        const reconciliation = await reconcileCheckout(currentStay.id);
        if (reconciliation.completed) {
          if (reconciliation.stay !== null) {
            stay.value = reconciliation.stay;
            orderSummary.value = reconciliation.stay.order;
          }
          orderResult.value = reconciliation.order;
          orderLoadError.value = reconciliation.orderError ?? '';
          if (orderResult.value === null && orderSummary.value === null) {
            submitError.value = '退房已完成，但服务端未返回账单信息，请刷新详情核对。';
          }
          ElMessage.success('退房已完成（已核对服务端状态）');
          notifyCheckedOut();
        } else if (reconciliation.stay !== null) {
          stay.value = reconciliation.stay;
          submitError.value = '操作结果不确定，服务端仍显示该入住记录在住，请刷新后重试。';
        } else {
          submitError.value = '操作结果不确定，无法核对服务端状态，请刷新后重试。';
        }
      } else {
        submitError.value = formatApiError(error);
      }
    } else {
      submitError.value = '退房结算失败，请稍后重试。';
    }
  } finally {
    submitting.value = false;
  }
}

function retryLoadOrder(): void {
  const orderId = orderResult.value?.id ?? orderSummary.value?.id;
  if (orderId !== undefined) {
    void loadOrder(orderId);
  }
}

watch(
  () => [props.modelValue, props.stayId] as const,
  ([open]) => {
    if (open) {
      resetForm();
      void loadStay();
    } else {
      stay.value = null;
      loadError.value = '';
    }
  },
);
</script>

<template>
  <el-dialog
    v-model="visible"
    title="退房结算"
    width="min(760px, 96vw)"
    :close-on-click-modal="false"
    :before-close="handleBeforeClose"
    :show-close="!submitting"
  >
    <div v-if="loading" class="dialog-loading">
      <el-skeleton :rows="5" animated />
    </div>

    <el-alert
      v-else-if="loadError !== ''"
      type="error"
      title="入住记录加载失败"
      :closable="false"
      show-icon
    >
      <span class="dialog-alert-body">
        <span>{{ loadError }}</span>
        <el-button size="small" @click="loadStay">重试</el-button>
      </span>
    </el-alert>

    <template v-else-if="stay !== null">
      <template v-if="hasResult">
        <CheckoutResult
          :order="orderResult"
          :summary="orderSummary"
          :order-error="orderLoadError"
          @retry="retryLoadOrder"
        />
      </template>

      <template v-else>
        <el-descriptions :column="2" border class="stay-summary">
          <el-descriptions-item label="入住记录">#{{ stay.id }}</el-descriptions-item>
          <el-descriptions-item label="客人">{{ stay.guestName }}</el-descriptions-item>
          <el-descriptions-item label="房号">{{ stay.roomNumber }}</el-descriptions-item>
          <el-descriptions-item label="房型">{{ stay.roomTypeName }}</el-descriptions-item>
          <el-descriptions-item label="入住时间">
            {{ formatDateTime(stay.checkInAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="预计离店">
            {{ formatDateOnly(stay.expectedCheckOutDate) }}
          </el-descriptions-item>
          <el-descriptions-item label="房价">
            {{ formatMoney(stay.pricePerNight) }} / 晚
          </el-descriptions-item>
          <el-descriptions-item label="押金">
            {{ formatMoney(stay.depositAmount) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-descriptions :column="4" border class="stay-summary">
          <el-descriptions-item label="预计晚数">
            {{ stay.currentCharges.nights }}
          </el-descriptions-item>
          <el-descriptions-item label="房费">
            {{ formatMoney(stay.currentCharges.roomFee) }}
          </el-descriptions-item>
          <el-descriptions-item label="在住杂费">
            {{ formatMoney(stay.currentCharges.miscTotal) }}
          </el-descriptions-item>
          <el-descriptions-item label="参考合计">
            {{ formatMoney(stay.currentCharges.total) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-alert
          v-if="!isCheckedIn"
          class="dialog-alert"
          type="warning"
          title="该入住记录当前不可退房"
          :closable="false"
          show-icon
        />

        <el-alert
          v-if="submitError !== ''"
          class="dialog-alert"
          type="error"
          title="退房结算失败"
          :description="submitError"
          :closable="false"
          show-icon
        />

        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          :disabled="submitting || !isCheckedIn"
          label-position="top"
          @submit.prevent="handleSubmit"
        >
          <el-form-item label="支付方式" prop="paymentMethod">
            <el-select
              v-model="form.paymentMethod"
              placeholder="请选择支付方式"
              class="form-select"
            >
              <el-option
                v-for="option in paymentOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
          </el-form-item>

          <div class="misc-section">
            <div class="misc-header">
              <span class="misc-title">杂费（可选，最多 20 项）</span>
              <el-button :disabled="submitting || miscItems.length >= 20" @click="addMiscItem">
                添加杂费
              </el-button>
            </div>

            <div v-if="miscItems.length === 0" class="misc-empty">暂无杂费</div>

            <div v-for="(item, index) in miscItems" :key="item.key" class="misc-row">
              <el-input
                v-model="item.name"
                placeholder="杂费名称"
                maxlength="100"
                class="misc-name"
              />
              <el-input-number
                v-model="item.amount"
                :min="0.01"
                :max="99999.99"
                :precision="2"
                :step="10"
                controls-position="right"
                placeholder="金额"
                class="misc-amount"
              />
              <el-button type="danger" plain :disabled="submitting" @click="removeMiscItem(index)">
                删除
              </el-button>
            </div>
          </div>

          <el-form-item label="退房备注" prop="note">
            <el-input
              v-model="form.note"
              type="textarea"
              :rows="2"
              maxlength="500"
              show-word-limit
              placeholder="可选"
            />
          </el-form-item>
        </el-form>
      </template>
    </template>

    <template #footer>
      <template v-if="hasResult">
        <el-button type="primary" @click="visible = false">完成</el-button>
      </template>
      <template v-else>
        <el-button :disabled="submitting" @click="visible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="submitting"
          :disabled="submitting || !isCheckedIn || stay === null"
          @click="handleSubmit"
        >
          确认退房
        </el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-loading {
  min-height: 120px;
}

.stay-summary {
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

.misc-section {
  margin-bottom: 16px;
}

.misc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.misc-title {
  font-size: 14px;
  color: var(--el-text-color-regular);
}

.misc-empty {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.misc-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px auto;
  gap: 12px;
  align-items: center;
  margin-bottom: 8px;
}

.misc-name,
.misc-amount {
  width: 100%;
}

@media (max-width: 640px) {
  .misc-row {
    grid-template-columns: 1fr;
  }
}
</style>
