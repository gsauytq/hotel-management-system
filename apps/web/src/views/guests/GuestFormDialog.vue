<script setup lang="ts">
import {
  ID_TYPES,
  createGuestSchema,
  updateGuestSchema,
  type GuestDto,
  type IdType,
} from '@hms/shared';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { computed, nextTick, reactive, ref, watch } from 'vue';

import { createGuest, updateGuest } from '@/api/guests';
import { ID_TYPE_LABELS } from '@/constants/guests';
import { formatApiError } from '@/utils/errors';

type FormMode = 'create' | 'edit';

interface GuestFormModel {
  name: string;
  phone: string;
  idType: IdType | undefined;
  idNumber: string;
  remark: string;
}

const props = defineProps<{
  modelValue: boolean;
  mode: FormMode;
  guest: GuestDto | null;
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
const dialogTitle = computed(() => (isEdit.value ? '编辑客人档案' : '新建客人档案'));

const formRef = ref<FormInstance>();
const submitting = ref(false);
const submitError = ref('');

const form = reactive<GuestFormModel>({
  name: '',
  phone: '',
  idType: undefined,
  idNumber: '',
  remark: '',
});

const idTypeOptions = ID_TYPES.map((idType) => ({
  value: idType,
  label: ID_TYPE_LABELS[idType],
}));

const rules: FormRules<GuestFormModel> = {
  name: [
    { required: true, message: '请输入客人姓名', trigger: 'blur' },
    { max: 100, message: '姓名不得超过 100 个字符', trigger: 'blur' },
  ],
  phone: [
    { required: true, message: '请输入手机号', trigger: 'blur' },
    {
      pattern: /^(?:1[3-9]\d{9}|\+?\d{6,20})$/,
      message: '手机号格式不正确',
      trigger: 'blur',
    },
  ],
  idType: [{ required: true, message: '请选择证件类型', trigger: 'change' }],
  idNumber: [
    { required: true, message: '请输入证件号', trigger: 'blur' },
    {
      pattern: /^[A-Za-z0-9]{5,30}$/,
      message: '证件号须为 5-30 位字母或数字',
      trigger: 'blur',
    },
  ],
  remark: [{ max: 500, message: '备注不得超过 500 个字符', trigger: 'blur' }],
};

function resetForm(): void {
  const source = isEdit.value ? props.guest : null;
  form.name = source?.name ?? '';
  form.phone = source?.phone ?? '';
  form.idType = source?.idType ?? undefined;
  form.idNumber = '';
  form.remark = source?.remark ?? '';
  submitError.value = '';
  void nextTick(() => {
    formRef.value?.clearValidate();
  });
}

function handleBeforeClose(done: () => void): void {
  if (!submitting.value) done();
}

async function handleSubmit(): Promise<void> {
  const formInstance = formRef.value;
  if (formInstance === undefined || submitting.value) return;

  submitting.value = true;
  submitError.value = '';
  try {
    const valid = await formInstance.validate().catch(() => false);
    if (!valid) return;

    if (isEdit.value) {
      const guest = props.guest;
      if (guest === null) return;
      const parsed = updateGuestSchema.safeParse({
        name: form.name,
        phone: form.phone,
        remark: form.remark,
      });
      if (!parsed.success) {
        submitError.value = parsed.error.issues[0]?.message ?? '请检查输入内容';
        return;
      }
      await updateGuest(guest.id, parsed.data);
      ElMessage.success('客人档案已更新');
    } else {
      const parsed = createGuestSchema.safeParse({
        name: form.name,
        phone: form.phone,
        idType: form.idType,
        idNumber: form.idNumber,
        remark: form.remark.trim() === '' ? undefined : form.remark,
      });
      if (!parsed.success) {
        submitError.value = parsed.error.issues[0]?.message ?? '请检查输入内容';
        return;
      }
      await createGuest(parsed.data);
      ElMessage.success('客人档案创建成功');
    }

    visible.value = false;
    emit('saved');
  } catch (error) {
    submitError.value = formatApiError(error, '保存客人档案失败，请稍后重试。');
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
    width="min(580px, 92vw)"
    :close-on-click-modal="false"
    :before-close="handleBeforeClose"
    :show-close="!submitting"
  >
    <el-alert
      v-if="submitError !== ''"
      class="dialog-alert"
      type="error"
      title="保存客人档案失败"
      :description="submitError"
      :closable="false"
      show-icon
    />

    <el-descriptions v-if="isEdit && guest !== null" :column="2" border class="identity-summary">
      <el-descriptions-item label="证件类型">
        {{ ID_TYPE_LABELS[guest.idType] }}
      </el-descriptions-item>
      <el-descriptions-item label="证件号">
        {{ guest.idNumberMasked }}
      </el-descriptions-item>
    </el-descriptions>

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      :disabled="submitting"
      label-position="top"
      @submit.prevent="handleSubmit"
    >
      <el-form-item label="姓名" prop="name">
        <el-input v-model="form.name" placeholder="客人姓名" maxlength="100" show-word-limit />
      </el-form-item>
      <el-form-item label="手机号" prop="phone">
        <el-input v-model="form.phone" placeholder="如 13800138000" maxlength="20" />
      </el-form-item>

      <template v-if="!isEdit">
        <el-form-item label="证件类型" prop="idType">
          <el-select v-model="form.idType" placeholder="请选择证件类型" class="form-select">
            <el-option
              v-for="option in idTypeOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="证件号" prop="idNumber">
          <el-input
            v-model="form.idNumber"
            type="password"
            show-password
            placeholder="5-30 位字母或数字"
            maxlength="30"
            autocomplete="off"
          />
          <div class="form-hint">证件号加密保存，创建后不可修改，列表仅展示掩码。</div>
        </el-form-item>
      </template>

      <el-form-item label="备注" prop="remark">
        <el-input
          v-model="form.remark"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          placeholder="可选"
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
.dialog-alert {
  margin-bottom: 16px;
}

.identity-summary {
  margin-bottom: 16px;
}

.form-select {
  width: 100%;
}

.form-hint {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
