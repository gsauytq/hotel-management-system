<script setup lang="ts">
import type { UserListItemDto } from '@hms/shared';
import { computed, ref, watch } from 'vue';

import { getUser } from '@/api/users';
import UserStatusTag from '@/components/users/UserStatusTag.vue';
import { ROLE_LABELS } from '@/constants/display';
import { toApiRequestError } from '@/utils/errors';
import { formatDateTime } from '@/utils/format';

const props = defineProps<{
  modelValue: boolean;
  userId: number | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const loading = ref(false);
const errorMessage = ref('');
const user = ref<UserListItemDto | null>(null);

async function loadDetail(): Promise<void> {
  if (props.userId === null) return;
  loading.value = true;
  errorMessage.value = '';
  try {
    user.value = await getUser(props.userId);
  } catch (error) {
    user.value = null;
    errorMessage.value = toApiRequestError(error).message;
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.modelValue, props.userId] as const,
  ([open]) => {
    if (open) {
      void loadDetail();
    } else {
      user.value = null;
      errorMessage.value = '';
    }
  },
);
</script>

<template>
  <el-dialog v-model="visible" title="员工详情" width="min(560px, 92vw)">
    <div v-loading="loading" class="detail-body">
      <el-alert
        v-if="errorMessage !== ''"
        type="error"
        title="员工详情加载失败"
        :closable="false"
        show-icon
      >
        <span class="alert-body">
          <span>{{ errorMessage }}</span>
          <el-button size="small" @click="loadDetail">重试</el-button>
        </span>
      </el-alert>

      <el-descriptions v-else-if="user !== null" :column="2" border>
        <el-descriptions-item label="员工 ID">{{ user.id }}</el-descriptions-item>
        <el-descriptions-item label="用户名">{{ user.username }}</el-descriptions-item>
        <el-descriptions-item label="姓名">{{ user.displayName }}</el-descriptions-item>
        <el-descriptions-item label="角色">{{ ROLE_LABELS[user.role] }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <UserStatusTag :status="user.status" />
        </el-descriptions-item>
        <el-descriptions-item label="最后登录">
          {{ formatDateTime(user.lastLoginAt) }}
        </el-descriptions-item>
        <el-descriptions-item label="创建时间" :span="2">
          {{ formatDateTime(user.createdAt) }}
        </el-descriptions-item>
      </el-descriptions>
    </div>
  </el-dialog>
</template>

<style scoped>
.detail-body {
  min-height: 100px;
}

.alert-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
</style>
