<script setup lang="ts">
import type { RoomStatus } from '@hms/shared';
import { computed } from 'vue';

import { ROOM_STATUS_LABELS, ROOM_STATUS_TAG_TYPES } from '@/constants/rooms';

const props = defineProps<{ status: RoomStatus }>();

const label = computed(() => ROOM_STATUS_LABELS[props.status]);
const tagType = computed(() => ROOM_STATUS_TAG_TYPES[props.status]);
</script>

<template>
  <el-tag :type="tagType" disable-transitions>{{ label }}</el-tag>
</template>
