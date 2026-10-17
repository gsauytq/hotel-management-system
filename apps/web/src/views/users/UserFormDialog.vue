<script setup lang="ts">
import {
  ROLES,
  createUserSchema,
  updateUserSchema,
  type Role,
  type UserListItemDto,
} from '@hms/shared';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { computed, nextTick, reactive, ref, watch } from 'vue';

import { createUser, updateUser } from '@/api/users';
import { ROLE_LABELS } from '@/constants/display';
import { useAuthStore } from '@/stores/auth';
import { formatApiError } from '@/utils/errors';

type FormMode = 'create' | 'edit';

interface UserFormModel {
  username: string;
  password: string;
  confirmPassword: string;
  displayName: string;
  role: Role | undefined;
}

const props = defineProps<{
  modelValue: boolean;
  mode: FormMode;
  user: UserListItemDto | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [];
}>();

const authStore = useAuthStore();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const isEdit = computed(() => props.mode === 'edit');
const isSelf = computed(() => props.user !== null && props.user.id === authStore.user?.id);
const dialogTitle = computed(() => (isEdit.value ? '编辑员工' : '新建员工'));

const formRef = ref<FormInstance>();
const submitting = ref(false);
const submitError = ref('');

const form = reactive<UserFormModel>({
  username: '',
  password: '',
  confirmPassword: '',
  displayName: '',
  role: undefined,
});

const roleOptions = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

function validateConfirmPassword(
  _rule: unknown,
  value: unknown,
  callback: (error?: Error) => void,
): void {
  if (value !== form.password) {
    callback(new Error('两次输入的密码不一致'));
    return;
  }
  callback();
}

const rules: FormRules<UserFormModel> = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    {
      pattern: /^[a-zA-Z0-9_]{3,50}$/,
      message: '用户名须为 3-50 位字母、数字或下划线',
      trigger: 'blur',
    },
  ],
  password: [
    { required: true, message: '请输入初始密码', trigger: 'blur' },
    { min: 10, message: '密码至少 10 个字符', trigger: 'blur' },
    { max: 72, message: '密码不得超过 72 个字符', trigger: 'blur' },
    {
      pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/,
      message: '密码必须同时包含字母与数字',
      trigger: 'blur',
    },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    { validator: validateConfirmPassword, trigger: 'blur' },
  ],
  displayName: [
    { required: true, message: '请输入姓名', trigger: 'blur' },
    { max: 50, message: '姓名不得超过 50 个字符', trigger: 'blur' },
  ],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
};

function resetForm(): void {
  const source = isEdit.value ? props.user : null;
  form.username = source?.username ?? '';
  form.password = '';
  form.confirmPassword = '';
  form.displayName = source?.displayName ?? '';
  form.role = source?.role;
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
      const user = props.user;
      if (user === null) return;
      const parsed = updateUserSchema.safeParse({
        displayName: form.displayName,
        ...(isSelf.value ? {} : { role: form.role }),
      });
      if (!parsed.success) {
        submitError.value = parsed.error.issues[0]?.message ?? '请检查输入内容';
        return;
      }
      await updateUser(user.id, parsed.data);
      ElMessage.success('员工信息已更新');
    } else {
      if (form.password.toLowerCase().includes(form.username.toLowerCase())) {
        submitError.value = '密码不得包含用户名';
        return;
      }
      const parsed = createUserSchema.safeParse({
        username: form.username,
        password: form.password,
        displayName: form.displayName,
        role: form.role,
      });
      if (!parsed.success) {
        submitError.value = parsed.error.issues[0]?.message ?? '请检查输入内容';
        return;
      }
      await createUser(parsed.data);
      ElMessage.success('员工创建成功');
    }

    visible.value = false;
    emit('saved');
  } catch (error) {
    submitError.value = formatApiError(error, '保存员工失败，请稍后重试。');
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
    <el-alert
      v-if="submitError !== ''"
      class="dialog-alert"
      type="error"
      title="保存员工失败"
      :description="submitError"
      :closable="false"
      show-icon
    />

    <el-alert
      v-if="isSelf"
      class="dialog-alert"
      type="info"
      title="当前登录账号不可在此修改自己的角色。"
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
          :disabled="isEdit"
          placeholder="3-50 位字母、数字或下划线"
          maxlength="50"
          autocomplete="username"
        />
        <div v-if="isEdit" class="form-hint">用户名创建后不可修改</div>
      </el-form-item>

      <template v-if="!isEdit">
        <el-form-item label="初始密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="至少 10 位，包含字母与数字"
            autocomplete="new-password"
          />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            show-password
            placeholder="再次输入初始密码"
            autocomplete="new-password"
          />
        </el-form-item>
      </template>

      <el-form-item label="姓名" prop="displayName">
        <el-input
          v-model="form.displayName"
          placeholder="员工姓名"
          maxlength="50"
          show-word-limit
        />
      </el-form-item>

      <el-form-item label="角色" prop="role">
        <el-select
          v-model="form.role"
          :disabled="isSelf"
          placeholder="请选择角色"
          class="form-select"
        >
          <el-option
            v-for="option in roleOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>

      <p class="form-hint">停用/启用通过员工列表操作；停用会立即使该员工所有会话失效。</p>
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

.form-select {
  width: 100%;
}

.form-hint {
  margin: 4px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
</style>
