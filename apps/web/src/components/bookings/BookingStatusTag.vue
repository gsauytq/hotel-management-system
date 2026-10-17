<script setup lang="ts">
import type { BookingStatus } from '@hms/shared';
import { computed } from 'vue';

import { BOOKING_STATUS_LABELS, BOOKING_STATUS_TAG_TYPES } from '@/constants/bookings';

const props = defineProps<{ status: BookingStatus }>();

const label = computed(() => BOOKING_STATUS_LABELS[props.status]);
const tagType = computed(() => BOOKING_STATUS_TAG_TYPES[props.status]);
</script>

<template>
  <el-tag :type="tagType" disable-transitions>{{ label }}</el-tag>
</template>
