<script setup lang="ts">
import type { OrderStatus } from '@hms/shared';
import { computed } from 'vue';

import { ORDER_STATUS_LABELS } from '@/constants/stays';

const props = defineProps<{ status: OrderStatus }>();

const label = computed(() => ORDER_STATUS_LABELS[props.status]);
const tagType = computed(() => (props.status === 'PAID' ? 'success' : 'warning'));
</script>

<template>
  <el-tag :type="tagType" disable-transitions>{{ label }}</el-tag>
</template>
