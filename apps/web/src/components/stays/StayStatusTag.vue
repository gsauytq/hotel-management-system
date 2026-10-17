<script setup lang="ts">
import type { StayStatus } from '@hms/shared';
import { computed } from 'vue';

import { STAY_STATUS_LABELS, STAY_STATUS_TAG_TYPES } from '@/constants/stays';

const props = defineProps<{ status: StayStatus }>();

const label = computed(() => STAY_STATUS_LABELS[props.status]);
const tagType = computed(() => STAY_STATUS_TAG_TYPES[props.status]);
</script>

<template>
  <el-tag :type="tagType" disable-transitions>{{ label }}</el-tag>
</template>
