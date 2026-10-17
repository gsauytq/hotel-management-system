<script setup lang="ts">
import { resetPasswordSchema, type UserListItemDto } from '@hms/shared';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { computed, nextTick, reactive, ref, watch } from 'vue';

import { resetUserPassword } from '@/api/users';
import { formatApiError } from '@/utils/errors';

interface ResetPasswordFormModel {
  newPassword: string;
  confirmPassword: string;
}

const props = defineProps<{
  modelValue: boolean;
  user: UserListItemDto | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const formRef = ref<FormInstance>();
const submitting = ref(false);
const submitError = ref('');
const form = reactive<ResetPasswordFormModel>({ newPassword: '', confirmPassword: '' });

function validateConfirmPassword(
  _rule: unknown,
  value: unknown,
  callback: (error?: Error) => void,
): void {
  if (value !== form.newPassword) {
    callback(new Error('两次输入的密码不一致'));
    return;
  }
  callback();
}

const rules: FormRules<ResetPasswordFormModel> = {
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 10, message: '密码至少 10 个字符', trigger: 'blur' },
    { max: 72, message: '密码不得超过 72 个字符', trigger: 'blur' },
    {
      pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/,
      message: '密码必须同时包含字母与数字',
      trigger: 'blur',
    },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    { validator: validateConfirmPassword, trigger: 'blur' },
  ],
};

function resetForm(): void {
  form.newPassword = '';
  form.confirmPassword = '';
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
  const user = props.user;
  if (formInstance === undefined || user === null || submitting.value) return;

  submitting.value = true;
  submitError.value = '';
  try {
    const valid = await formInstance.validate().catch(() => false);
    if (!valid) return;

    if (form.newPassword.toLowerCase().includes(user.username.toLowerCase())) {
      submitError.value = '密码不得包含用户名';
      return;
    }

    const parsed = resetPasswordSchema.safeParse({ newPassword: form.newPassword });
    if (!parsed.success) {
      submitError.value = parsed.error.issues[0]?.message ?? '请检查输入内容';
      return;
    }

    await resetUserPassword(user.id, parsed.data);
    ElMessage.success('密码已重置，该员工所有会话已失效');
    visible.value = false;
    emit('saved');
  } catch (error) {
    submitError.value = formatApiError(error, '重置密码失败，请稍后重试。');
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
    title="重置员工密码"
    width="min(520px, 92vw)"
    :close-on-click-modal="false"
    :before-close="handleBeforeClose"
    :show-close="!submitting"
  >
    <el-alert
      class="dialog-alert"
      type="warning"
      :title="`重置后员工 ${user?.username ?? ''} 的所有会话将立即失效。`"
      :closable="false"
      show-icon
    />

    <el-alert
      v-if="submitError !== ''"
      class="dialog-alert"
      type="error"
      title="重置密码失败"
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
      <el-form-item label="新密码" prop="newPassword">
        <el-input
          v-model="form.newPassword"
          type="password"
          show-password
          placeholder="至少 10 位，包含字母与数字"
          autocomplete="new-password"
        />
      </el-form-item>
      <el-form-item label="确认新密码" prop="confirmPassword">
        <el-input
          v-model="form.confirmPassword"
          type="password"
          show-password
          placeholder="再次输入新密码"
          autocomplete="new-password"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="submitting" @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit"> 确认重置 </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-alert {
  margin-bottom: 16px;
}
</style>
