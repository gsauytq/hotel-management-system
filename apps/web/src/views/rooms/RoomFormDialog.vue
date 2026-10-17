<script setup lang="ts">
import { createRoomSchema, updateRoomSchema, type RoomDto, type RoomTypeDto } from '@hms/shared';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { computed, nextTick, reactive, ref, watch } from 'vue';

import { createRoom, updateRoom } from '@/api/rooms';
import { isApiRequestError } from '@/utils/errors';

type FormMode = 'create' | 'edit';

interface RoomFormModel {
  roomNumber: string;
  roomTypeId: number | undefined;
  note: string;
}

const props = defineProps<{
  modelValue: boolean;
  mode: FormMode;
  room: RoomDto | null;
  roomTypes: RoomTypeDto[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const isEdit = computed(() => props.mode === 'edit');
const isOccupied = computed(() => isEdit.value && props.room?.status === 'OCCUPIED');
const dialogTitle = computed(() => (isEdit.value ? '编辑客房' : '新建客房'));

const formRef = ref<FormInstance>();
const submitting = ref(false);
const form = reactive<RoomFormModel>({
  roomNumber: '',
  roomTypeId: undefined,
  note: '',
});

const roomTypeOptions = computed(() => {
  if (!isEdit.value) {
    return props.roomTypes.filter((roomType) => roomType.status === 'ACTIVE');
  }
  return props.roomTypes;
});

function isRoomTypeDisabled(roomType: RoomTypeDto): boolean {
  if (!isEdit.value) return false;
  return roomType.status === 'ARCHIVED' && roomType.id !== props.room?.roomTypeId;
}

const rules: FormRules<RoomFormModel> = {
  roomNumber: [
    { required: true, message: '请输入房号', trigger: 'blur' },
    { max: 20, message: '房号不得超过 20 个字符', trigger: 'blur' },
  ],
  roomTypeId: [{ required: true, message: '请选择房型', trigger: 'change' }],
  note: [{ max: 200, message: '备注不得超过 200 个字符', trigger: 'blur' }],
};

function resetForm(): void {
  const source = isEdit.value ? props.room : null;
  form.roomNumber = source?.roomNumber ?? '';
  form.roomTypeId = source?.roomTypeId ?? undefined;
  form.note = source?.note ?? '';
  void nextTick(() => {
    formRef.value?.clearValidate();
  });
}

function handleBeforeClose(done: () => void): void {
  if (!submitting.value) done();
}

function firstIssueMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? '请检查输入内容';
}

async function handleSubmit(): Promise<void> {
  const formInstance = formRef.value;
  if (formInstance === undefined || submitting.value) return;

  submitting.value = true;
  try {
    const valid = await formInstance.validate().catch(() => false);
    if (!valid) return;

    const roomTypeId = form.roomTypeId;
    if (typeof roomTypeId !== 'number') {
      ElMessage.warning('请选择房型');
      return;
    }

    if (isEdit.value) {
      const room = props.room;
      if (room === null) return;
      const payload = isOccupied.value
        ? { note: form.note }
        : {
            roomNumber: form.roomNumber,
            roomTypeId,
            note: form.note,
          };
      const parsed = updateRoomSchema.safeParse(payload);
      if (!parsed.success) {
        ElMessage.warning(firstIssueMessage(parsed.error));
        return;
      }
      await updateRoom(room.id, parsed.data);
      ElMessage.success('客房信息已更新');
    } else {
      const parsed = createRoomSchema.safeParse({
        roomNumber: form.roomNumber,
        roomTypeId,
        note: form.note.trim() === '' ? undefined : form.note,
      });
      if (!parsed.success) {
        ElMessage.warning(firstIssueMessage(parsed.error));
        return;
      }
      await createRoom(parsed.data);
      ElMessage.success('客房创建成功');
    }

    visible.value = false;
    emit('saved');
  } catch (error) {
    if (!isApiRequestError(error)) {
      ElMessage.error(error instanceof Error ? error.message : '保存客房失败');
    }
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
      v-if="isOccupied"
      class="occupied-alert"
      type="warning"
      title="该房间处于在住状态，仅允许修改备注。"
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
      <el-form-item label="房号" prop="roomNumber">
        <el-input
          v-model="form.roomNumber"
          :disabled="isOccupied"
          placeholder="如 0821"
          maxlength="20"
        />
      </el-form-item>
      <el-form-item label="房型" prop="roomTypeId">
        <el-select
          v-model="form.roomTypeId"
          :disabled="isOccupied"
          placeholder="请选择房型"
          filterable
          class="form-select"
        >
          <el-option
            v-for="roomType in roomTypeOptions"
            :key="roomType.id"
            :label="`${roomType.name}（${roomType.code}）`"
            :value="roomType.id"
            :disabled="isRoomTypeDisabled(roomType)"
          >
            <span>{{ roomType.name }}（{{ roomType.code }}）</span>
            <el-tag v-if="roomType.status === 'ARCHIVED'" size="small" type="info">已归档</el-tag>
          </el-option>
        </el-select>
      </el-form-item>
      <el-form-item label="备注" prop="note">
        <el-input
          v-model="form.note"
          type="textarea"
          :rows="3"
          maxlength="200"
          show-word-limit
          placeholder="可选"
        />
      </el-form-item>
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
.occupied-alert {
  margin-bottom: 16px;
}

.form-select {
  width: 100%;
}
</style>
