<script setup lang="ts">
import { changePasswordSchema } from '@hms/shared';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { changePassword } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';
import { extractFieldErrors, formatApiError, isApiRequestError } from '@/utils/errors';

interface ChangePasswordFormModel {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const router = useRouter();
const authStore = useAuthStore();
const formRef = ref<FormInstance>();
const submitting = ref(false);
const submitError = ref('');
const fieldErrors = ref<Record<string, string>>({});

const form = reactive<ChangePasswordFormModel>({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});

function validateConfirmPassword(
  _rule: unknown,
  value: unknown,
  callback: (error?: Error) => void,
): void {
  if (typeof value !== 'string' || value !== form.newPassword) {
    callback(new Error('两次输入的新密码不一致'));
    return;
  }
  callback();
}

const rules: FormRules<ChangePasswordFormModel> = {
  currentPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 10, message: '密码至少 10 个字符', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    { validator: validateConfirmPassword, trigger: 'blur' },
  ],
};

async function handleSubmit(): Promise<void> {
  const formInstance = formRef.value;
  if (formInstance === undefined || submitting.value) return;

  submitting.value = true;
  submitError.value = '';
  fieldErrors.value = {};

  try {
    if (form.newPassword !== form.confirmPassword) {
      submitError.value = '两次输入的新密码不一致';
      return;
    }

    const valid = await formInstance.validate().catch(() => false);
    if (!valid) return;

    const parsed = changePasswordSchema.safeParse({
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    });
    if (!parsed.success) {
      submitError.value = parsed.error.issues[0]?.message ?? '请检查输入内容';
      return;
    }

    await changePassword(parsed.data);
    authStore.clearSession();
    ElMessage.success('密码已修改，请使用新密码重新登录');
    await router.replace({ name: 'login' });
  } catch (error) {
    if (isApiRequestError(error)) {
      const fields = extractFieldErrors(error);
      fieldErrors.value = {
        ...(fields['currentPassword'] === undefined
          ? {}
          : { currentPassword: fields['currentPassword'].join('；') }),
        ...(fields['newPassword'] === undefined
          ? {}
          : { newPassword: fields['newPassword'].join('；') }),
      };
      submitError.value = error.details[0]?.message ?? formatApiError(error);
    } else {
      submitError.value = '修改密码失败，请稍后重试。';
    }
  } finally {
    submitting.value = false;
  }
}

async function handleCancel(): Promise<void> {
  await authStore.logout();
  await router.replace({ name: 'login' });
}
</script>

<template>
  <div class="change-password">
    <p class="change-password-intro">
      {{
        authStore.mustChangePassword
          ? '首次登录必须修改初始密码后才能继续使用系统。'
          : '修改密码后需要使用新密码重新登录。'
      }}
    </p>

    <el-alert
      v-if="submitError !== ''"
      class="change-password-alert"
      type="error"
      :title="submitError"
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
      <el-form-item label="当前密码" prop="currentPassword" :error="fieldErrors.currentPassword">
        <el-input
          v-model="form.currentPassword"
          type="password"
          show-password
          autocomplete="current-password"
        />
      </el-form-item>
      <el-form-item label="新密码" prop="newPassword" :error="fieldErrors.newPassword">
        <el-input
          v-model="form.newPassword"
          type="password"
          show-password
          autocomplete="new-password"
          placeholder="至少 10 位，包含字母与数字"
        />
      </el-form-item>
      <el-form-item label="确认新密码" prop="confirmPassword">
        <el-input
          v-model="form.confirmPassword"
          type="password"
          show-password
          autocomplete="new-password"
        />
      </el-form-item>

      <div class="change-password-actions">
        <el-button :disabled="submitting" @click="handleCancel">返回登录</el-button>
        <el-button type="primary" :loading="submitting" native-type="submit"> 确认修改 </el-button>
      </div>
    </el-form>
  </div>
</template>

<style scoped>
.change-password-intro {
  margin: 0 0 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.change-password-alert {
  margin-bottom: 16px;
}

.change-password-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
