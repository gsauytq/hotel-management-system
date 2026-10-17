<script setup lang="ts">
import {
  createRoomTypeSchema,
  hasAtMostTwoDecimals,
  updateRoomTypeSchema,
  type RoomTypeDto,
} from '@hms/shared';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { computed, nextTick, reactive, ref, watch } from 'vue';

import { createRoomType, updateRoomType } from '@/api/room-types';
import { isApiRequestError } from '@/utils/errors';

type FormMode = 'create' | 'edit';

interface RoomTypeFormModel {
  code: string;
  name: string;
  basePrice: number | undefined;
  capacity: number | undefined;
  description: string;
}

const props = defineProps<{
  modelValue: boolean;
  mode: FormMode;
  roomType: RoomTypeDto | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const isEdit = computed(() => props.mode === 'edit');
const dialogTitle = computed(() => (isEdit.value ? '编辑房型' : '新建房型'));

const formRef = ref<FormInstance>();
const submitting = ref(false);
const form = reactive<RoomTypeFormModel>({
  code: '',
  name: '',
  basePrice: undefined,
  capacity: undefined,
  description: '',
});

function validatePrice(_rule: unknown, value: unknown, callback: (error?: Error) => void): void {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    callback(new Error('请输入基准房价'));
    return;
  }
  if (value < 0 || value > 99999.99) {
    callback(new Error('基准房价须在 0–99999.99 之间'));
    return;
  }
  if (!hasAtMostTwoDecimals(value)) {
    callback(new Error('基准房价最多两位小数'));
    return;
  }
  callback();
}

function validateCapacity(_rule: unknown, value: unknown, callback: (error?: Error) => void): void {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    callback(new Error('可住人数必须为整数'));
    return;
  }
  if (value < 1 || value > 20) {
    callback(new Error('可住人数须在 1–20 之间'));
    return;
  }
  callback();
}

const rules: FormRules<RoomTypeFormModel> = {
  code: [
    { required: true, message: '请输入房型代码', trigger: 'blur' },
    {
      pattern: /^[A-Z0-9]{2,20}$/,
      message: '房型代码须为 2-20 位大写字母或数字',
      trigger: 'blur',
    },
  ],
  name: [
    { required: true, message: '请输入房型名称', trigger: 'blur' },
    { max: 50, message: '房型名称不得超过 50 个字符', trigger: 'blur' },
  ],
  basePrice: [{ validator: validatePrice, trigger: 'change' }],
  capacity: [{ validator: validateCapacity, trigger: 'change' }],
  description: [{ max: 500, message: '描述不得超过 500 个字符', trigger: 'blur' }],
};

function resetForm(): void {
  const source = isEdit.value ? props.roomType : null;
  form.code = source?.code ?? '';
  form.name = source?.name ?? '';
  form.basePrice = source?.basePrice ?? undefined;
  form.capacity = source?.capacity ?? undefined;
  form.description = source?.description ?? '';
  void nextTick(() => {
    formRef.value?.clearValidate();
  });
}

function handleCodeInput(value: string): void {
  form.code = value.toUpperCase();
}

function handleBeforeClose(done: () => void): void {
  if (!submitting.value) done();
}

function firstIssueMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? '请检查输入内容';
}

async function handleSubmit(): Promise<void> {
  const formInstance = formRef.value;
  if (formInstance === undefined || submitting.value) return;

  submitting.value = true;
  try {
    const valid = await formInstance.validate().catch(() => false);
    if (!valid) return;

    const basePrice = form.basePrice;
    const capacity = form.capacity;
    if (typeof basePrice !== 'number') {
      ElMessage.warning('请输入基准房价');
      return;
    }
    if (typeof capacity !== 'number') {
      ElMessage.warning('请输入可住人数');
      return;
    }

    if (isEdit.value) {
      if (props.roomType === null) return;
      const parsed = updateRoomTypeSchema.safeParse({
        name: form.name,
        basePrice,
        capacity,
        description: form.description,
      });
      if (!parsed.success) {
        ElMessage.warning(firstIssueMessage(parsed.error));
        return;
      }
      await updateRoomType(props.roomType.id, parsed.data);
      ElMessage.success('房型已更新');
    } else {
      const parsed = createRoomTypeSchema.safeParse({
        code: form.code,
        name: form.name,
        basePrice,
        capacity,
        description: form.description,
      });
      if (!parsed.success) {
        ElMessage.warning(firstIssueMessage(parsed.error));
        return;
      }
      await createRoomType(parsed.data);
      ElMessage.success('房型创建成功');
    }

    visible.value = false;
    emit('saved');
  } catch (error) {
    if (!isApiRequestError(error)) {
      ElMessage.error(error instanceof Error ? error.message : '保存房型失败');
    }
  } finally {
    submitting.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) resetForm();
  },
);
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="dialogTitle"
    width="min(560px, 92vw)"
    :close-on-click-modal="false"
    :before-close="handleBeforeClose"
    :show-close="!submitting"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      :disabled="submitting"
      label-position="top"
      @submit.prevent="handleSubmit"
    >
      <el-form-item label="房型代码" prop="code">
        <el-input
          v-model="form.code"
          :disabled="isEdit"
          placeholder="如 DLX（2-20 位大写字母或数字）"
          maxlength="20"
          @input="handleCodeInput"
        />
        <div v-if="isEdit" class="form-hint">房型代码创建后不可修改</div>
      </el-form-item>
      <el-form-item label="房型名称" prop="name">
        <el-input v-model="form.name" placeholder="如 豪华大床房" maxlength="50" show-word-limit />
      </el-form-item>
      <el-form-item label="基准房价（元/晚）" prop="basePrice">
        <el-input-number
          v-model="form.basePrice"
          :min="0"
          :max="99999.99"
          :precision="2"
          :step="10"
          controls-position="right"
          placeholder="0.00"
          class="form-number"
        />
      </el-form-item>
      <el-form-item label="可住人数" prop="capacity">
        <el-input-number
          v-model="form.capacity"
          :min="1"
          :max="20"
          :step="1"
          step-strictly
          controls-position="right"
          placeholder="1-20"
          class="form-number"
        />
      </el-form-item>
      <el-form-item label="描述" prop="description">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          placeholder="可选，如面积、景观等信息"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="submitting" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">
        {{ isEdit ? '保存' : '创建' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form-hint {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.form-number {
  width: 100%;
}
</style>
