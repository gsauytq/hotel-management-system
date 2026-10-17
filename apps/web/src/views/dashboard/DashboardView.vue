<script setup lang="ts">
import type { HealthStatus } from '@hms/shared';
import { onMounted, ref } from 'vue';

import { API_BASE_URL, REQUEST_TIMEOUT_MS } from '@/api/request';
import { fetchHealth } from '@/api/system';
import PageContainer from '@/components/page/PageContainer.vue';
import { toApiRequestError } from '@/utils/errors';

const health = ref<HealthStatus | null>(null);
const healthLoading = ref(false);
const healthError = ref('');

const plannedMetrics = [
  { label: '入住率', note: '统计区间、分子/分母口径待批准' },
  { label: '客房数量', note: '是否排除维修/停用房待批准' },
  { label: '预订量', note: '按创建时间或入住日、是否剔除取消待批准' },
  { label: '收入', note: '实收/应收、押金抵扣与统计日期口径待批准' },
];

async function loadHealth(): Promise<void> {
  healthLoading.value = true;
  healthError.value = '';
  try {
    health.value = await fetchHealth();
  } catch (error) {
    health.value = null;
    healthError.value = toApiRequestError(error).message;
  } finally {
    healthLoading.value = false;
  }
}

onMounted(() => {
  void loadHealth();
});
</script>

<template>
  <PageContainer>
    <el-alert
      type="warning"
      title="经营统计接口未提供，本页不展示统计数据"
      description="已批准设计将统计看板列为 V2 范围外（Q-04/A-02），当前后端无 /statistics 端点、无统计表/字段，口径亦未批准。为避免误导，本页不使用 Mock 数据，也不通过前端拼接业务明细推算指标。"
      :closable="false"
      show-icon
    />

    <div class="dashboard-grid">
      <el-card shadow="never">
        <template #header>经营看板（未接入）</template>
        <el-empty description="统计接口与口径未批准，暂无可展示数据">
          <p class="dashboard-hint">
            页面目录与路由已预留；接入前必须先完成统计口径评审、数据库/契约变更与后端接口实现。
          </p>
        </el-empty>

        <el-descriptions :column="1" border>
          <el-descriptions-item
            v-for="metric in plannedMetrics"
            :key="metric.label"
            :label="metric.label"
          >
            <el-tag type="info" size="small">待批准</el-tag>
            <span class="metric-note">{{ metric.note }}</span>
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="dashboard-card-header">
            <span>系统连通性（非经营指标）</span>
            <el-button size="small" :loading="healthLoading" @click="loadHealth">
              重新检查
            </el-button>
          </div>
        </template>

        <el-skeleton v-if="healthLoading" :rows="3" animated />
        <el-alert
          v-else-if="healthError !== ''"
          type="error"
          :closable="false"
          show-icon
          :title="`健康检查失败：${healthError}`"
        />
        <el-descriptions v-else :column="1" border>
          <el-descriptions-item label="应用与数据库">
            <el-tag :type="health?.status === 'ok' ? 'success' : 'danger'">
              {{ health?.status === 'ok' ? '正常' : '异常' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="API 基础路径">{{ API_BASE_URL }}</el-descriptions-item>
          <el-descriptions-item label="请求超时">{{ REQUEST_TIMEOUT_MS }} ms</el-descriptions-item>
        </el-descriptions>
      </el-card>
    </div>
  </PageContainer>
</template>

<style scoped>
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--hms-page-gap);
}

.dashboard-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dashboard-hint {
  margin: 0 0 16px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.metric-note {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
