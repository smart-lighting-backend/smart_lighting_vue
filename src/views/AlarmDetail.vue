<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ElCard,
  ElRow,
  ElCol,
  ElTag,
  ElButton,
  ElTable,
  ElTableColumn,
  ElDivider,
  ElInput,
  ElMessageBox,
  ElMessage,
  ElNotification
} from 'element-plus';
import {
  ArrowLeft,
  Warning,
  CircleClose,
  InfoFilled,
  MapLocation,
  Clock,
  Monitor,
  CircleCheck,
  Loading,
  Document,
  Delete
} from '@element-plus/icons-vue';
import { fetchAlarmDetail, updateAlarmStatus, getAlarmStatuses, deleteAlarm } from '../api/alarm';
import { useUserInfo } from '../composables/useUserInfo.js';

const { hasPerm } = useUserInfo();

const route = useRoute();
const router = useRouter();

const alarmDetail = ref(null);
const loading = ref(false);

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

const alarmStatuses = getAlarmStatuses();
const handleRemark = ref('');

async function loadAlarmDetail() {
  const alarmId = route.params.id;
  loading.value = true;
  try {
    const response = await fetchAlarmDetail(alarmId);
    if (response.code === 200) {
      alarmDetail.value = response.data;
    } else {
      ElMessage.error(response.message);
    }
  } catch (error) {
    ElMessage.error('加载告警详情失败');
  } finally {
    loading.value = false;
  }
}

function goBack() {
  router.push('/alarm/list');
}

async function handleStatusChange(status) {
  const alarmId = route.params.id;
  const currentStatus = alarmDetail.value?.status;
  
  if (currentStatus === status) {
    ElNotification.info({ title: '状态提示', message: '当前状态已是该值' });
    return;
  }

  let confirmMessage = '';
  if (status === 'processing') {
    confirmMessage = '确认开始处理此告警？';
  } else if (status === 'handled') {
    confirmMessage = '确认此告警已处理完成？';
  }

  try {
    await ElMessageBox.confirm(confirmMessage, '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    });

    const response = await updateAlarmStatus(alarmId, status, handleRemark.value);
    if (response.code === 200) {
      ElNotification.success({ title: '操作成功', message: `告警状态已更新为 ${status}` });
      handleRemark.value = '';
      loadAlarmDetail();
    }
  } catch (error) {
    if (error !== 'cancel') {
      ElNotification.error({ title: '操作失败', message: '' });
    }
  }
}

async function handleDeleteAlarm() {
  try {
    await ElMessageBox.confirm(
      `确认删除此告警 #${alarmDetail.value.id} 吗？此操作不可恢复。`,
      '删除确认',
      { confirmButtonText: '确定删除', cancelButtonText: '取消', type: 'warning' }
    );
    const res = await deleteAlarm(alarmDetail.value.id);
    if (res.code === 200) {
      ElNotification.success({ title: '告警已删除', message: `告警 #${alarmDetail.value.id} 已删除` });
      router.push('/alarm/list');
    }
  } catch (err) {
    if (err !== 'cancel') ElNotification.error({ title: '删除失败', message: '' });
  }
}

onMounted(() => {
  loadAlarmDetail();
});
</script>

<template>
  <div class="alarm-detail-container">
    <div class="breadcrumb-bar">
      <ElButton @click="goBack" :icon="ArrowLeft" class="back-btn">
        返回告警列表
      </ElButton>
    </div>

    <div v-if="alarmDetail" class="content-area">
      <ElCard class="info-card">
        <div class="card-header">
          <div class="alarm-title">
            <component :is="levelConfig[alarmDetail.level]?.icon" class="level-icon" />
            <h2 class="title-text">{{ alarmDetail.type_label }}</h2>
            <ElTag :type="levelConfig[alarmDetail.level]?.color" class="level-tag">
              {{ levelConfig[alarmDetail.level]?.text }}
            </ElTag>
          </div>
          <div class="alarm-id">
            {{ alarmDetail.id }}
          </div>
        </div>

        <ElDivider />

        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">设备名称</span>
            <span class="info-value">{{ alarmDetail.device_name }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">设备ID</span>
            <span class="info-value">{{ alarmDetail.device_id }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">区域</span>
            <span class="info-value">
              <MapLocation style="margin-right: 6px;" />
              {{ alarmDetail.region }}
            </span>
          </div>
          <div class="info-item">
            <span class="info-label">告警类型</span>
            <ElTag :type="typeConfig[alarmDetail.type]?.color">
              {{ typeConfig[alarmDetail.type]?.text }}
            </ElTag>
          </div>
          <div class="info-item">
            <span class="info-label">告警级别</span>
            <ElTag :type="levelConfig[alarmDetail.level]?.color">
              {{ levelConfig[alarmDetail.level]?.text }}
            </ElTag>
          </div>
          <div class="info-item">
            <span class="info-label">当前状态</span>
            <ElTag :type="statusConfig[alarmDetail.status]?.color">
              {{ statusConfig[alarmDetail.status]?.text }}
            </ElTag>
          </div>
          <div class="info-item">
            <span class="info-label">创建时间</span>
            <span class="info-value">
              <Clock style="margin-right: 6px;" />
              {{ alarmDetail.created_at }}
            </span>
          </div>
          <div class="info-item">
            <span class="info-label">更新时间</span>
            <span class="info-value">
              <Clock style="margin-right: 6px;" />
              {{ alarmDetail.updated_at }}
            </span>
          </div>
        </div>

        <ElDivider />

        <div class="message-section">
          <h3 class="section-title">
            <Document style="margin-right: 8px;" />
            告警描述
          </h3>
          <p class="message-content">{{ alarmDetail.message }}</p>
        </div>
      </ElCard>

      <ElCard class="device-card" v-if="alarmDetail.device_info">
        <h3 class="section-title">
          <Server style="margin-right: 8px;" />
          关联设备信息
        </h3>
        <ElRow :gutter="20">
          <ElCol :span="6">
            <div class="device-info-item">
              <span class="info-label">设备名称</span>
              <span class="info-value">{{ alarmDetail.device_info.name }}</span>
            </div>
          </ElCol>
          <ElCol :span="6">
            <div class="device-info-item">
              <span class="info-label">设备状态</span>
              <ElTag :type="alarmDetail.device_info.status === 1 ? 'success' : 'danger'">
                {{ alarmDetail.device_info.status === 1 ? '在线' : '离线' }}
              </ElTag>
            </div>
          </ElCol>
          <ElCol :span="6">
            <div class="device-info-item">
              <span class="info-label">健康评分</span>
              <span class="info-value">{{ alarmDetail.device_info.health_score }}分</span>
            </div>
          </ElCol>
          <ElCol :span="6">
            <div class="device-info-item">
              <span class="info-label">固件版本</span>
              <span class="info-value">{{ alarmDetail.device_info.firmware_version }}</span>
            </div>
          </ElCol>
          <ElCol :span="6">
            <div class="device-info-item">
              <span class="info-label">IP地址</span>
              <span class="info-value">{{ alarmDetail.device_info.ip_address }}</span>
            </div>
          </ElCol>
          <ElCol :span="6">
            <div class="device-info-item">
              <span class="info-label">安装时间</span>
              <span class="info-value">{{ alarmDetail.device_info.install_time }}</span>
            </div>
          </ElCol>
          <ElCol :span="12">
            <div class="device-info-item">
              <span class="info-label">坐标位置</span>
              <span class="info-value">{{ alarmDetail.device_info.coordinates }}</span>
            </div>
          </ElCol>
        </ElRow>
      </ElCard>

      <ElCard class="log-card" v-if="alarmDetail.handle_log && alarmDetail.handle_log.length > 0">
        <h3 class="section-title">
          <CircleCheck style="margin-right: 8px;" />
          处理日志
        </h3>
        <ElTable :data="alarmDetail.handle_log" style="width: 100%" border>
          <ElTableColumn prop="time" label="时间" width="180" />
          <ElTableColumn prop="action" label="操作" width="120" />
          <ElTableColumn prop="operator" label="操作人" width="100" />
          <ElTableColumn prop="remark" label="备注" />
        </ElTable>
      </ElCard>

      <ElCard class="action-card">
        <h3 class="section-title">处理操作</h3>
        <div class="action-form">
          <ElInput
            v-model="handleRemark"
            type="textarea"
            :rows="3"
            placeholder="请输入处理备注（可选）"
            class="remark-input"
          />
          <div class="action-buttons">
            <ElButton
              v-if="hasPerm('alarm:handle') && alarmDetail.status !== 'processing'"
              type="warning"
              @click="handleStatusChange('processing')"
              :icon="Loading"
            >
              开始处理
            </ElButton>
            <ElButton
              v-if="hasPerm('alarm:handle') && alarmDetail.status !== 'handled'"
              type="success"
              @click="handleStatusChange('handled')"
              :icon="CircleCheck"
            >
              处理完成
            </ElButton>
            <ElButton
               v-if="hasPerm('alarm:delete')"
               type="danger"
               plain
               @click="handleDeleteAlarm"
               :icon="Delete"
             >
               删除告警
             </ElButton>
          </div>
        </div>
      </ElCard>
    </div>
  </div>
</template>

<style scoped>
.alarm-detail-container {
  padding: 24px;
  min-height: 100vh;
  background-color: #1a1a2e;
}

.breadcrumb-bar {
  display: flex;
  align-items: center;
  margin-bottom: 20px;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 8px;
}

.content-area {
  max-width: 1200px;
}

.info-card {
  background: rgba(30, 30, 50, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 24px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.alarm-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.level-icon {
  font-size: 28px;
  color: #e6a23c;
}

.title-text {
  font-size: 24px;
  font-weight: 600;
  color: #ffffff;
  margin: 0;
}

.level-tag {
  font-size: 14px;
}

.alarm-id {
  font-family: monospace;
  font-size: 14px;
  color: #409eff;
  padding: 8px 16px;
  background: rgba(64, 158, 255, 0.1);
  border-radius: 4px;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-label {
  font-size: 13px;
  color: #909399;
}

.info-value {
  font-size: 16px;
  color: #ffffff;
}

.message-section {
  margin-top: 16px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #ffffff;
  margin: 0 0 12px 0;
}

.message-content {
  font-size: 15px;
  color: #e0e0e0;
  line-height: 1.8;
  background: rgba(0, 0, 0, 0.2);
  padding: 16px;
  border-radius: 6px;
  margin: 0;
}

.device-card {
  background: rgba(30, 30, 50, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 24px;
}

.device-info-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.log-card {
  background: rgba(30, 30, 50, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.05);
  margin-bottom: 24px;
}

.action-card {
  background: rgba(30, 30, 50, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.action-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.remark-input {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.action-buttons {
  display: flex;
  gap: 12px;
}

@media (max-width: 1200px) {
  .info-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 768px) {
  .alarm-detail-container {
    padding: 12px;
  }

  .info-grid {
    grid-template-columns: 1fr;
  }

  .card-header {
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
  }

  .action-buttons {
    flex-direction: column;
  }
}
</style>