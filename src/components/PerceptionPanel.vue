<script setup>
import { ref, watch } from 'vue'
import { ElCard, ElTag } from 'element-plus'
import { fetchDevicePerception } from '../api/devices.js'

const props = defineProps({
  deviceId: { type: String, required: true },
  telemetry: { type: Object, default: null },
})

const data = ref(null)

async function load() {
  if (!props.deviceId) return
  try {
    const res = await fetchDevicePerception(props.deviceId)
    if (res?.data) data.value = res.data
  } catch {
    data.value = null
  }
}

watch(() => props.deviceId, load, { immediate: true })

// 暴露 load 供父组件调用
defineExpose({ load })

function telItem(label, key, unit) {
  // 优先用父组件传入的实时遥测
  const t = props.telemetry || data.value?.telemetry
  const val = t?.[key] !== null && t?.[key] !== undefined ? t[key] : '--'
  return { label, value: val, unit }
}

function confColor(v) {
  if (v == null) return '#888'
  if (v >= 0.9) return '#4caf50'
  if (v >= 0.7) return '#ff9800'
  return '#f44336'
}

function alarmLevelTag(level) {
  return level === '严重' ? 'danger' : level === '警告' ? 'warning' : 'info'
}
</script>

<template>
  <ElCard v-if="data" class="perception-card">
    <div class="card-header">
      <h3>融合感知面板</h3>
      <span class="update-time">心跳: {{ data.lastHeartbeatAt || '--' }}</span>
    </div>

    <!-- 8 格环境感知 -->
    <div class="sensor-grid">
      <div class="sensor-cell">
        <div class="sc-icon">☀</div>
        <div class="sc-label">光照强度</div>
        <div class="sc-value">{{ telItem('光照', 'illuminance', 'Lux').value }}<span class="sc-unit"> Lux</span></div>
      </div>
      <div class="sensor-cell">
        <div class="sc-icon">🌡</div>
        <div class="sc-label">温度</div>
        <div class="sc-value">{{ telItem('温度', 'temperature', '°C').value }}<span class="sc-unit"> °C</span></div>
      </div>
      <div class="sensor-cell">
        <div class="sc-icon">💧</div>
        <div class="sc-label">湿度</div>
        <div class="sc-value">{{ telItem('湿度', 'humidity', '%').value }}<span class="sc-unit"> %</span></div>
      </div>
      <div class="sensor-cell">
        <div class="sc-icon">🛞</div>
        <div class="sc-label">PM2.5</div>
        <div class="sc-value">{{ telItem('PM2.5', 'pm25', 'μg/m³').value }}<span class="sc-unit"> μg/m³</span></div>
      </div>
      <div class="sensor-cell">
        <div class="sc-icon">🌫</div>
        <div class="sc-label">AQI</div>
        <div class="sc-value">{{ telItem('AQI', 'aqi', '').value }}</div>
      </div>
      <div class="sensor-cell">
        <div class="sc-icon">🚶</div>
        <div class="sc-label">人体红外</div>
        <div class="sc-value">
          <ElTag :type="data.telemetry?.pir === 1 ? 'success' : 'info'" size="small">
            {{ data.telemetry?.pir === 1 ? '有人' : '无人' }}
          </ElTag>
        </div>
      </div>
      <div class="sensor-cell">
        <div class="sc-icon">🚗</div>
        <div class="sc-label">车流量</div>
        <div class="sc-value">{{ telItem('车流量', 'trafficFlow', '/min').value }}<span class="sc-unit"> /min</span></div>
      </div>
      <div class="sensor-cell">
        <div class="sc-icon">❤</div>
        <div class="sc-label">健康评分</div>
        <div class="sc-value health-val" :class="{
          'is-good': data.healthScore >= 70,
          'is-bad': data.healthScore < 50
        }">{{ data.healthScore || '--' }}</div>
      </div>
    </div>

    <!-- 事件行 -->
    <div class="event-rows">
      <div class="event-row">
        <span class="er-icon">👁</span>
        <span class="er-label">视觉</span>
        <template v-if="data.latestVision">
          <ElTag type="warning" size="small">{{ data.latestVision.eventType }}</ElTag>
          <span class="er-meta">
            置信度 <b :style="{ color: confColor(data.latestVision.confidence) }">{{ (data.latestVision.confidence * 100).toFixed(0) }}%</b>
            · {{ data.latestVision.occurredAt || '' }}
          </span>
        </template>
        <span v-else class="er-empty">暂无视觉事件</span>
      </div>
      <div class="event-row">
        <span class="er-icon">🔊</span>
        <span class="er-label">语音</span>
        <template v-if="data.latestVoice">
          <ElTag :type="data.latestVoice.type === '警告' ? 'danger' : 'primary'" size="small">{{ data.latestVoice.type }}</ElTag>
          <span class="er-meta">{{ data.latestVoice.content }} · {{ data.latestVoice.occurredAt || '' }}</span>
        </template>
        <span v-else class="er-empty">暂无语音事件</span>
      </div>
      <div v-for="a in data.recentAlarms" :key="a.startAt" class="event-row">
        <span class="er-icon">⚠</span>
        <span class="er-label">告警</span>
        <ElTag :type="alarmLevelTag(a.level)" size="small">{{ a.type }}</ElTag>
        <span class="er-meta">
          {{ a.recoverAt ? '已恢复' : '未恢复' }}
          · {{ a.startAt || '' }}
          <template v-if="a.recoverAt"> → {{ a.recoverAt }}</template>
        </span>
      </div>
      <div v-if="data.recentAlarms?.length === 0" class="event-row">
        <span class="er-icon">⚠</span>
        <span class="er-label">告警</span>
        <span class="er-empty">暂无告警记录</span>
      </div>
    </div>
  </ElCard>
</template>

<style scoped>
.perception-card {
  margin-bottom: 24px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  overflow: hidden;
  backdrop-filter: blur(20px);
}
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.card-header h3 { font-size: 15px; color: rgba(200,220,240,0.9); }
.update-time { font-size: 11px; color: rgba(140,190,220,0.5); }

/* 8格传感器网格 */
.sensor-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
  margin-bottom: 18px;
}
.sensor-cell {
  background: rgba(0,30,70,0.4);
  border: 1px solid rgba(0,120,200,0.1);
  border-radius: 10px;
  padding: 14px 16px;
  text-align: center;
  transition: border-color 0.2s;
}
.sensor-cell:hover { border-color: rgba(77,208,225,0.2); }
.sc-icon { font-size: 20px; margin-bottom: 4px; }
.sc-label { font-size: 11px; color: rgba(140,190,220,0.5); margin-bottom: 4px; }
.sc-value { font-size: 18px; font-weight: 600; color: rgba(200,220,240,0.9); }
.sc-unit { font-size: 11px; color: rgba(140,190,220,0.4); }
.health-val { font-size: 22px !important; }
.health-val.is-good { color: #4caf50; }
.health-val.is-bad { color: #f44336; }

/* 事件行 */
.event-rows { display: flex; flex-direction: column; gap: 6px; }
.event-row {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px;
  background: rgba(0,30,70,0.3);
  border-radius: 6px;
  font-size: 12px;
}
.er-icon { font-size: 13px; }
.er-label { color: rgba(140,190,220,0.6); min-width: 24px; }
.er-meta { color: rgba(180,210,230,0.7); }
.er-empty { color: rgba(140,190,220,0.35); }

/* 亮色主题可读性修正 */
.perception-card {
  background: rgba(255, 255, 255, 0.94) !important;
  border: 1px solid rgba(0, 141, 230, 0.16) !important;
  border-radius: 8px !important;
  box-shadow: 0 18px 42px rgba(14, 70, 120, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.92) !important;
  color: #1d3148 !important;
}

.perception-card :deep(.el-card__body) {
  color: #1d3148 !important;
}

.card-header h3 {
  color: #0d1b2d !important;
  font-size: 17px;
  font-weight: 800;
}

.update-time {
  color: #31516f !important;
  background: rgba(248, 252, 255, 0.88);
  border: 1px solid rgba(16, 126, 196, 0.14);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
}

.sensor-cell,
.event-row {
  background: rgba(248, 252, 255, 0.88) !important;
  border: 1px solid rgba(16, 126, 196, 0.14) !important;
  border-radius: 8px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.sensor-cell:hover,
.event-row:hover {
  background: #ffffff !important;
  border-color: rgba(0, 141, 230, 0.28) !important;
  box-shadow: 0 14px 32px rgba(0, 126, 206, 0.10);
}

.sc-icon {
  color: #006fc2;
}

.sc-label,
.sc-unit,
.er-label,
.er-empty {
  color: #40566f !important;
  font-weight: 700;
}

.sc-value,
.er-meta {
  color: #1d3148 !important;
  font-weight: 800;
}

@media (max-width: 768px) {
  .sensor-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
