<script setup lang="ts">
import { loginRequestSchema } from '@hms/shared';
import type { FormInstance, FormRules } from 'element-plus';
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { resolveSafeRedirect } from '@/router/redirect';
import { useAuthStore } from '@/stores/auth';
import { describeLoginError, type LoginErrorPresentation } from '@/utils/auth-errors';

const authStore = useAuthStore();
const route = useRoute();
const router = useRouter();
const formRef = ref<FormInstance>();
const submitting = ref(false);
const loginError = ref<LoginErrorPresentation | null>(null);

const sessionExpired = computed(() => route.query.reason === 'expired');

const form = reactive({ username: '', password: '' });

const rules: FormRules<typeof form> = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    {
      pattern: /^[a-zA-Z0-9_]{3,50}$/,
      message: '用户名须为 3-50 位字母、数字或下划线',
      trigger: 'blur',
    },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 1, max: 72, message: '密码长度须为 1-72 位', trigger: 'blur' },
  ],
};

watch(form, () => {
  loginError.value = null;
});

async function handleSubmit(): Promise<void> {
  const formInstance = formRef.value;
  if (formInstance === undefined || submitting.value) return;

  submitting.value = true;
  loginError.value = null;

  try {
    const valid = await formInstance.validate().catch(() => false);
    if (!valid) return;

    // 提交前使用共享 zod schema 复核（架构 §2.6，与服务端同一份契约）
    const parsed = loginRequestSchema.safeParse({
      username: form.username,
      password: form.password,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      loginError.value = {
        title: '输入有误',
        message: issue?.message ?? '请检查输入内容。',
      };
      return;
    }

    await authStore.login(parsed.data);
    if (authStore.mustChangePassword) {
      await router.replace({ name: 'change-password' });
      return;
    }
    const redirect = resolveSafeRedirect(route.query.redirect);
    await router.replace(redirect ?? '/rooms');
  } catch (error) {
    loginError.value = describeLoginError(error);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login">
    <p class="login-intro">请使用员工账号登录后台</p>

    <el-alert
      v-if="sessionExpired"
      class="login-alert"
      type="warning"
      title="登录状态已失效，请重新登录"
      :closable="false"
      show-icon
    />

    <el-alert
      v-if="loginError !== null"
      class="login-alert"
      type="error"
      :title="loginError.title"
      :description="loginError.message"
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
      <el-form-item label="用户名" prop="username">
        <el-input
          v-model="form.username"
          placeholder="请输入用户名"
          autocomplete="username"
          autofocus
        />
      </el-form-item>
      <el-form-item label="密码" prop="password">
        <el-input
          v-model="form.password"
          type="password"
          show-password
          autocomplete="current-password"
        />
      </el-form-item>
      <el-button
        class="login-submit"
        type="primary"
        native-type="submit"
        :loading="submitting"
        :disabled="submitting"
      >
        {{ submitting ? '登录中…' : '登录' }}
      </el-button>
    </el-form>
    <p class="login-hint">连续 5 次登录失败将锁定账号 15 分钟</p>
  </div>
</template>

<style scoped>
.login-intro {
  margin: 0 0 16px;
  color: var(--el-text-color-regular);
  font-size: 14px;
}

.login-alert {
  margin-bottom: 16px;
}

.login-submit {
  width: 100%;
}

.login-hint {
  margin: 16px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  text-align: center;
}
</style>
