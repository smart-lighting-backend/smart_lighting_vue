<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  ElTable,
  ElTableColumn,
  ElButton,
  ElInput,
  ElSelect,
  ElOption,
  ElDatePicker,
  ElTag,
  ElPagination,
  ElCard,
  ElRow,
  ElCol,
  ElMessage,
  ElMessageBox,
  ElNotification
} from 'element-plus';

import {
  Warning,
  CircleClose,
  InfoFilled,
  Clock,
  MapLocation,
  Search,
  Refresh,
  Delete
} from '@element-plus/icons-vue';

import {
  fetchAlarmList,
  getAlarmTypes,
  getAlarmLevels,
  getAlarmStatuses,
  deleteAlarm,
  batchDeleteAlarm
} from '../api/alarm';
import { useUserInfo } from '../composables/useUserInfo.js';

const { hasPerm } = useUserInfo();

const selectedIds = ref([]);

const router = useRouter();

const alarmList = ref([]);
const total = ref(0);
const loading = ref(false);

const searchForm = ref({
  deviceId: '',
  type: '',
  level: '',
  status: '',
  startTime: '',
  endTime: ''
});

const pagination = ref({
  page: 1,
  pageSize: 10
});

const alarmTypes = getAlarmTypes();
const alarmLevels = getAlarmLevels();
const alarmStatuses = getAlarmStatuses();

const levelConfig = {
  high: { color: 'danger', text: '严重', icon: Warning },
  medium: { color: 'warning', text: '中等', icon: CircleClose },
  low: { color: 'info', text: '轻微', icon: InfoFilled }
};

const statusConfig = {
  unhandled: { color: 'danger', text: '未处理' },
  processing: { color: 'warning', text: '处理中' },
  handled: { color: 'success', text: '已处理' }
};

const typeConfig = {
  offline: { color: 'danger', text: '设备离线' },
  health: { color: 'warning', text: '健康异常' },
  temperature: { color: 'danger', text: '温度异常' },
  humidity: { color: 'info', text: '湿度异常' },
  power: { color: 'danger', text: '供电异常' },
  illuminance: { color: 'warning', text: '光照异常' }
};

const unhandledCount = computed(() => {
  return alarmList.value.filter(item => item.status === 'unhandled').length;
});

async function loadAlarmList() {
  loading.value = true;
  try {
    const params = {
      page: pagination.value.page,
      pageSize: pagination.value.pageSize,
      ...searchForm.value
    };
    const response = await fetchAlarmList(params);
    if (response.code === 200) {
      alarmList.value = response.data.list;
      total.value = response.data.total;
    }
  } catch (error) {
    ElMessage.error('加载告警列表失败');
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  pagination.value.page = 1;
  loadAlarmList();
}

function handleReset() {
  searchForm.value = {
    deviceId: '',
    type: '',
    level: '',
    status: '',
    startTime: '',
    endTime: ''
  };
  pagination.value.page = 1;
  loadAlarmList();
}

function handlePageChange(page) {
  pagination.value.page = page;
  loadAlarmList();
}

function handlePageSizeChange(pageSize) {
  pagination.value.pageSize = pageSize;
  pagination.value.page = 1;
  loadAlarmList();
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(
      `确认删除告警 #${row.id} 吗？此操作不可恢复。`,
      '删除确认',
      { confirmButtonText: '确定删除', cancelButtonText: '取消', type: 'warning' }
    );
    const res = await deleteAlarm(row.id);
    if (res.code === 200) {
      ElNotification.success({ title: '删除成功', message: `告警 #${row.id} 已删除` });
      loadAlarmList();
    }
  } catch (err) {
    if (err !== 'cancel') ElNotification.error({ title: '删除失败', message: '' });
  }
}

async function handleBatchDelete() {
  if (!selectedIds.value.length) {
    ElMessage.warning('请先选择要删除的告警');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${selectedIds.value.length} 条告警？此操作不可恢复。`,
      '批量删除确认',
      { confirmButtonText: '确定删除', cancelButtonText: '取消', type: 'warning' }
    );
    await batchDeleteAlarm({ ids: selectedIds.value });
    ElNotification.success({ title: '批量删除成功', message: `已删除 ${selectedIds.value.length} 条告警` });
    selectedIds.value = [];
    loadAlarmList();
  } catch (err) {
    if (err !== 'cancel') ElNotification.error({ title: '批量删除失败', message: '' });
  }
}

function viewDetail(row) {
  router.push(`/alarm/detail/${row.id}`);
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(
      `确定要删除告警 "${row.id}" 吗？此操作不可恢复。`,
      '确认删除',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' }
    );
    const res = await deleteAlarm(row.id);
    if (res.code === 200) {
      ElMessage.success('删除成功');
      loadAlarmList();
    }
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error(err?.message || '删除失败');
    }
  }
}

onMounted(() => {
  loadAlarmList();
});
</script>

<template>
  <div class="alarm-list-container">
    <div class="page-header">
      <div class="header-info">
        <h2 class="page-title">告警日志</h2>
        <p class="page-desc">查看和管理设备告警记录</p>
      </div>
      <div class="header-stats">
        <div class="stat-item">
          <span class="stat-value">{{ total }}</span>
          <span class="stat-label">总告警</span>
        </div>
        <div class="stat-item warning">
          <span class="stat-value">{{ unhandledCount }}</span>
          <span class="stat-label">未处理</span>
        </div>
      </div>
    </div>

    <ElCard class="search-card">
      <ElRow :gutter="20">
        <ElCol :span="6">
          <div class="form-item">
            <label class="form-label">设备</label>
            <ElInput
              v-model="searchForm.deviceId"
              placeholder="设备ID或名称"
              clearable
            />
          </div>
        </ElCol>
        <ElCol :span="5">
          <div class="form-item">
            <label class="form-label">告警类型</label>
            <ElSelect v-model="searchForm.type" placeholder="全部" clearable>
              <ElOption
                v-for="type in alarmTypes"
                :key="type.value"
                :label="type.label"
                :value="type.value"
              />
            </ElSelect>
          </div>
        </ElCol>
        <ElCol :span="4">
          <div class="form-item">
            <label class="form-label">级别</label>
            <ElSelect v-model="searchForm.level" placeholder="全部" clearable>
              <ElOption
                v-for="level in alarmLevels"
                :key="level.value"
                :label="level.label"
                :value="level.value"
              />
            </ElSelect>
          </div>
        </ElCol>
        <ElCol :span="4">
          <div class="form-item">
            <label class="form-label">状态</label>
            <ElSelect v-model="searchForm.status" placeholder="全部" clearable>
              <ElOption
                v-for="status in alarmStatuses"
                :key="status.value"
                :label="status.label"
                :value="status.value"
              />
            </ElSelect>
          </div>
        </ElCol>
      </ElRow>
      <ElRow :gutter="20" style="margin-top: 16px;">
        <ElCol :span="10">
          <div class="form-item">
            <label class="form-label">时间范围</label>
            <div class="date-range">
              <ElDatePicker
                v-model="searchForm.startTime"
                type="datetime"
                placeholder="开始时间"
                format="YYYY-MM-DD HH:mm:ss"
                value-format="YYYY-MM-DD HH:mm:ss"
              />
              <span class="date-separator">至</span>
              <ElDatePicker
                v-model="searchForm.endTime"
                type="datetime"
                placeholder="结束时间"
                format="YYYY-MM-DD HH:mm:ss"
                value-format="YYYY-MM-DD HH:mm:ss"
              />
            </div>
          </div>
        </ElCol>
        <ElCol :span="14" class="action-col">
          <ElButton type="primary" @click="handleSearch" :icon="Search">
            搜索
          </ElButton>
          <ElButton @click="handleReset" :icon="Refresh">
            重置
          </ElButton>
          <ElButton
            v-if="hasPerm('alarm:delete')"
            type="danger"
            @click="handleBatchDelete"
            :icon="Delete"
            :disabled="!selectedIds.length"
          >
            批量删除
          </ElButton>
        </ElCol>
      </ElRow>
    </ElCard>

    <ElCard class="table-card">
      <ElTable
        :data="alarmList"
        v-loading="loading"
        style="width: 100%"
        row-class-name="clickable-row"
        @row-click="viewDetail"
        @selection-change="selectedIds = $event.map(r => r.id)"
        border
      >
        <ElTableColumn type="selection" width="45" />
        <ElTableColumn prop="id" label="告警ID" width="100">
          <template #default="scope">
            <span class="alarm-id">{{ scope.row.id }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="device_name" label="设备名称" width="180">
          <template #default="scope">
            <div class="device-info">
              <span class="device-name">{{ scope.row.device_name }}</span>
              <span class="device-id-small">{{ scope.row.device_id }}</span>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="region" label="区域" width="100">
          <template #default="scope">
            <span class="region-tag">
              <MapLocation style="margin-right: 4px;" />
              {{ scope.row.region }}
            </span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="type" label="告警类型" width="100">
          <template #default="scope">
            <ElTag :type="typeConfig[scope.row.type]?.color || 'info'">
              {{ typeConfig[scope.row.type]?.text || scope.row.type_label }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="level" label="级别" width="80">
          <template #default="scope">
            <div class="level-item">
              <component :is="levelConfig[scope.row.level]?.icon" />
              <ElTag :type="levelConfig[scope.row.level]?.color">
                {{ levelConfig[scope.row.level]?.text }}
              </ElTag>
            </div>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="message" label="告警信息" min-width="200" />
        <ElTableColumn prop="status" label="状态" width="80">
          <template #default="scope">
            <ElTag :type="statusConfig[scope.row.status]?.color">
              {{ statusConfig[scope.row.status]?.text }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="created_at" label="创建时间" width="180">
          <template #default="scope">
            <span class="time-item">
              <Clock style="margin-right: 4px;" />
              {{ scope.row.created_at }}
            </span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="180">
          <template #default="scope">
            <ElButton size="small" type="primary" @click.stop="viewDetail(scope.row)">
              详情
            </ElButton>
            <ElButton
              v-if="hasPerm('alarm:delete')"
              size="small"
              type="danger"
              :icon="Delete"
              @click.stop="handleDelete(scope.row)"
            />
          </template>
        </ElTableColumn>
      </ElTable>

      <div class="pagination-wrap">
        <ElPagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="handlePageChange"
          @size-change="handlePageSizeChange"
        />
      </div>
    </ElCard>
  </div>
</template>

<style scoped>
.alarm-list-container {
  padding: 24px;
  min-height: 100vh;
  background-color: #1a1a2e;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.header-info {
  display: flex;
  flex-direction: column;
}

.page-title {
  font-size: 28px;
  font-weight: 700;
  color: #ffffff;
  margin: 0;
}

.page-desc {
  font-size: 14px;
  color: #909399;
  margin: 8px 0 0 0;
}

.header-stats {
  display: flex;
  gap: 24px;
}

.stat-item {
  text-align: center;
  padding: 16px 24px;
  background: rgba(30, 30, 50, 0.8);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.stat-item.warning {
  border-color: rgba(250, 173, 20, 0.3);
}

.stat-value {
  display: block;
  font-size: 28px;
  font-weight: 700;
  color: #ffffff;
}

.stat-item.warning .stat-value {
  color: #e6a23c;
}

.stat-label {
  font-size: 12px;
  color: #909399;
}

.search-card {
  background: rgba(30, 30, 50, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 16px;
}

.form-item {
  display: flex;
  flex-direction: column;
}

.form-label {
  font-size: 13px;
  color: #909399;
  margin-bottom: 8px;
}

.date-range {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-separator {
  color: #909399;
}

.action-col {
  display: flex;
  justify-content: flex-end;
  align-items: flex-end;
  gap: 12px;
}

.table-card {
  background: rgba(30, 30, 50, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.clickable-row {
  cursor: pointer;
}

.clickable-row:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.alarm-id {
  font-family: monospace;
  color: #409eff;
}

.device-info {
  display: flex;
  flex-direction: column;
}

.device-name {
  font-weight: 500;
  color: #ffffff;
}

.device-id-small {
  font-size: 12px;
  color: #909399;
}

.region-tag {
  font-size: 12px;
  color: #909399;
}

.level-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.time-item {
  font-size: 13px;
  color: #909399;
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

@media (max-width: 1200px) {
  .page-header {
    flex-direction: column;
    gap: 16px;
  }

  .header-stats {
    justify-content: flex-start;
  }
}

@media (max-width: 768px) {
  .alarm-list-container {
    padding: 12px;
  }

  .header-stats {
    flex-wrap: wrap;
  }
}
</style>