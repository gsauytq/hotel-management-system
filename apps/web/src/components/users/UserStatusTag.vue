<script setup lang="ts">
import type { UserStatus } from '@hms/shared';
import { computed } from 'vue';

import { USER_STATUS_LABELS, USER_STATUS_TAG_TYPES } from '@/constants/users';

const props = defineProps<{ status: UserStatus }>();

const label = computed(() => USER_STATUS_LABELS[props.status]);
const tagType = computed(() => USER_STATUS_TAG_TYPES[props.status]);
</script>

<template>
  <el-tag :type="tagType" disable-transitions>{{ label }}</el-tag>
</template>
