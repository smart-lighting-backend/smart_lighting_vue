<script setup>
import { ref, onMounted } from 'vue'
import { fetchVisionEvents, fetchVoiceEvents } from '../api/events.js'
import { useAutoRefresh } from '../composables/useAutoRefresh.js'
import { useMqtt } from '../composables/useMqtt.js'
import { ElInput, ElSelect, ElOption, ElPagination, ElTag, ElMessage, ElNotification } from 'element-plus'
import { Search } from '@element-plus/icons-vue'

const activeTab = ref('vision')
const loading = ref(false)
const visionList = ref([])
const voiceList = ref([])
const visionTotal = ref(0)
const voiceTotal = ref(0)
const visionPage = ref(1)
const voicePage = ref(1)
const pageSize = ref(20)

// 筛选条件
const filterDeviceId = ref('')
const filterVisionType = ref('')
const filterVoiceType = ref('')

async function loadVisionEvents() {
  loading.value = true
  try {
    const res = await fetchVisionEvents({
      page: visionPage.value,
      size: pageSize.value,
      deviceId: filterDeviceId.value || undefined,
      eventType: filterVisionType.value || undefined,
    })
    if (res && res.data) {
      visionList.value = res.data.records || []
      visionTotal.value = res.data.total || 0
    }
  } catch (e) {
    ElNotification.error({ title: '加载视觉事件失败', message: e?.message || '' })
  } finally {
    loading.value = false
  }
}

async function loadVoiceEvents() {
  loading.value = true
  try {
    const res = await fetchVoiceEvents({
      page: voicePage.value,
      size: pageSize.value,
      deviceId: filterDeviceId.value || undefined,
      type: filterVoiceType.value || undefined,
    })
    if (res && res.data) {
      voiceList.value = res.data.records || []
      voiceTotal.value = res.data.total || 0
    }
  } catch (e) {
    ElNotification.error({ title: '加载语音事件失败', message: e?.message || '' })
  } finally {
    loading.value = false
  }
}

function switchTab(tab) {
  activeTab.value = tab
  if (tab === 'vision') loadVisionEvents()
  else loadVoiceEvents()
}

function handleSearch() {
  visionPage.value = 1
  voicePage.value = 1
  if (activeTab.value === 'vision') loadVisionEvents()
  else loadVoiceEvents()
}

function visionTypeTag(type) {
  const map = { '行人检测': 'warning', '车辆通行': 'success', '异常停车': 'danger', '危险场景': 'danger' }
  return map[type] || 'info'
}

function voiceTypeTag(type) {
  const map = { '警告': 'danger', '播报': 'primary', '广播': 'info' }
  return map[type] || 'info'
}

function confidenceColor(val) {
  if (val >= 0.9) return '#4caf50'
  if (val >= 0.7) return '#ff9800'
  return '#f44336'
}

function refreshActiveTab() {
  if (activeTab.value === 'vision') loadVisionEvents()
  else loadVoiceEvents()
}

const { subscribe } = useMqtt()

subscribe('streetlight/+/vision/event', (data) => {
  if (data.deviceId) {
    visionList.value.unshift(data)
    visionTotal.value++
    if (visionList.value.length > 50) visionList.value.length = 50
  }
})
subscribe('streetlight/+/voice/event', (data) => {
  if (data.deviceId) {
    voiceList.value.unshift(data)
    voiceTotal.value++
    if (voiceList.value.length > 50) voiceList.value.length = 50
  }
})

onMounted(() => {
  loadVisionEvents()
  useAutoRefresh(refreshActiveTab, { interval: 300000 })
})
</script>

<template>
  <div class="event-center-page">
    <div class="page-header">
      <div>
        <h1 class="page-title">事件中心</h1>
        <p class="page-sub">查看视觉识别事件与语音告警播报记录</p>
      </div>
    </div>

    <!-- Tab 切换 -->
    <div class="tab-bar">
      <button class="tab-btn" :class="{ active: activeTab === 'vision' }" @click="switchTab('vision')">
        👁 视觉事件
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'voice' }" @click="switchTab('voice')">
        🔊 语音事件
      </button>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <ElInput v-model="filterDeviceId" placeholder="设备编号" clearable style="width: 180px" />
      <template v-if="activeTab === 'vision'">
        <ElSelect v-model="filterVisionType" placeholder="事件类型" clearable style="width: 140px">
          <ElOption label="行人检测" value="行人检测" />
          <ElOption label="车辆通行" value="车辆通行" />
          <ElOption label="异常停车" value="异常停车" />
          <ElOption label="危险场景" value="危险场景" />
        </ElSelect>
      </template>
      <template v-else>
        <ElSelect v-model="filterVoiceType" placeholder="语音类型" clearable style="width: 140px">
          <ElOption label="播报" value="播报" />
          <ElOption label="广播" value="广播" />
          <ElOption label="警告" value="警告" />
        </ElSelect>
      </template>
      <button class="search-btn" @click="handleSearch"><el-icon><Search /></el-icon> 查询</button>
    </div>

    <!-- 视觉事件表格 -->
    <div v-if="activeTab === 'vision'" class="table-wrap">
      <div v-if="loading" class="loading-state">加载中...</div>
      <table v-else class="event-table">
        <thead>
          <tr>
            <th>设备编号</th>
            <th>事件类型</th>
            <th>置信度</th>
            <th>截图引用</th>
            <th>发生时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in visionList" :key="e.id">
            <td class="td-device">{{ e.deviceId }}</td>
            <td><ElTag :type="visionTypeTag(e.eventType)" size="small">{{ e.eventType }}</ElTag></td>
            <td>
              <div class="confidence-cell">
                <div class="confidence-bar">
                  <div class="confidence-fill" :style="{ width: (e.confidence * 100) + '%', background: confidenceColor(e.confidence) }"></div>
                </div>
                <span class="confidence-pct">{{ (e.confidence * 100).toFixed(0) }}%</span>
              </div>
            </td>
            <td class="td-snapshot">{{ e.snapshotRef || '--' }}</td>
            <td>{{ e.occurredAt || '--' }}</td>
          </tr>
          <tr v-if="visionList.length === 0">
            <td colspan="5" class="empty-cell">
                      <div class="empty-illust">
                        <svg viewBox="0 0 120 80" fill="none" width="100" height="66">
                          <rect x="20" y="15" width="80" height="50" rx="6" stroke="#b0cadd" stroke-width="1.2" fill="rgba(176,202,221,0.06)"/>
                          <circle cx="42" cy="33" r="6" stroke="#b0cadd" stroke-width="1" fill="rgba(176,202,221,0.1)"/>
                          <path d="M35-39l5 5 8-8" stroke="#b0cadd" stroke-width="1" stroke-linecap="round"/>
                          <rect x="56" y="29" width="30" height="4" rx="2" fill="rgba(176,202,221,0.2)"/>
                          <rect x="56" y="37" width="20" height="3" rx="1.5" fill="rgba(176,202,221,0.12)"/>
                          <path d="M34 55l-8-8M86 55l8-8" stroke="#b0cadd" stroke-width="0.8" stroke-linecap="round" opacity="0.4"/>
                        </svg>
                        <p>暂无视觉事件</p>
                      </div>
                    </td>
          </tr>
        </tbody>
      </table>
      <div class="pagination-wrap" v-if="visionTotal > 0">
        <ElPagination v-model:current-page="visionPage" v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]" background layout="total, sizes, prev, pager, next"
          :total="visionTotal" @size-change="loadVisionEvents" @current-change="loadVisionEvents" />
      </div>
    </div>

    <!-- 语音事件表格 -->
    <div v-if="activeTab === 'voice'" class="table-wrap">
      <div v-if="loading" class="loading-state">加载中...</div>
      <table v-else class="event-table">
        <thead>
          <tr>
            <th>设备编号</th>
            <th>类型</th>
            <th>播报内容</th>
            <th>来源</th>
            <th>发生时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in voiceList" :key="e.id">
            <td class="td-device">{{ e.deviceId }}</td>
            <td><ElTag :type="voiceTypeTag(e.type)" size="small">{{ e.type }}</ElTag></td>
            <td class="td-content">{{ e.content }}</td>
            <td>{{ e.source }}</td>
            <td>{{ e.occurredAt || '--' }}</td>
          </tr>
          <tr v-if="voiceList.length === 0">
            <td colspan="5" class="empty-cell">
                      <div class="empty-illust">
                        <svg viewBox="0 0 120 80" fill="none" width="100" height="66">
                          <rect x="10" y="20" width="100" height="40" rx="20" stroke="#b0cadd" stroke-width="1.2" fill="rgba(176,202,221,0.06)"/>
                          <path d="M35 30l-8 12h-6l-4 8h54" stroke="#b0cadd" stroke-width="1" stroke-linecap="round"/>
                          <circle cx="70" cy="40" r="3" fill="rgba(176,202,221,0.3)"/>
                          <path d="M48 44v8" stroke="#b0cadd" stroke-width="1.2" stroke-linecap="round"/>
                          <path d="M30 52l-6 6M90 52l6 6" stroke="#b0cadd" stroke-width="0.8" stroke-linecap="round" opacity="0.4"/>
                        </svg>
                        <p>暂无语音事件</p>
                      </div>
                    </td>
          </tr>
        </tbody>
      </table>
      <div class="pagination-wrap" v-if="voiceTotal > 0">
        <ElPagination v-model:current-page="voicePage" v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]" background layout="total, sizes, prev, pager, next"
          :total="voiceTotal" @size-change="loadVoiceEvents" @current-change="loadVoiceEvents" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.event-center-page { padding: 24px 28px; color: #1d3148; }
.page-title { font-size: 22px; font-weight: 800; color: #0d1b2d; margin-bottom: 4px; }
.page-sub { font-size: 13px; color: #40566f; font-weight: 500; }

/* Tabs */
.tab-bar { display: flex; gap: 6px; margin: 20px 0 16px; }
.tab-btn {
  padding: 9px 22px;
  background: rgba(255,255,255,0.9) !important;
  border: 1px solid rgba(0,141,230,0.16) !important;
  border-radius: 8px;
  color: #1d3148 !important;
  font-size: 14px; font-weight: 700; cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 8px 20px rgba(30,86,130,0.08) !important;
}
.tab-btn.active {
  background: linear-gradient(135deg, rgba(0,141,230,0.18), rgba(22,199,232,0.12)) !important;
  border-color: rgba(0,141,230,0.42) !important;
  color: #006fc2 !important;
  box-shadow: 0 14px 30px rgba(0,126,206,0.14) !important;
}
.tab-btn:hover:not(.active) { border-color: rgba(0,141,230,0.34) !important; color: #006fc2 !important; background: #ffffff !important; transform: translateY(-1px); }

/* Filter */
.filter-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px;
  background: rgba(255,255,255,0.94) !important;
  border: 1px solid rgba(0,141,230,0.16) !important;
  border-radius: 8px;
  margin-bottom: 16px;
  box-shadow: 0 18px 40px rgba(30,86,130,0.1), inset 0 1px 0 rgba(255,255,255,0.92) !important;
  backdrop-filter: blur(16px) saturate(1.12);
}
.filter-bar :deep(.el-input__wrapper),
.filter-bar :deep(.el-select__wrapper) {
  background: rgba(255,255,255,0.94) !important;
  border-color: rgba(0,141,230,0.18) !important;
  box-shadow: 0 0 0 1px rgba(0,141,230,0.14), inset 0 1px 0 rgba(255,255,255,0.92) !important;
}
.filter-bar :deep(.el-input__inner),
.filter-bar :deep(.el-select__selected-item),
.filter-bar :deep(.el-select__placeholder) {
  color: #0d1b2d !important;
  font-weight: 600;
}
.filter-bar :deep(.el-input__inner::placeholder) {
  color: #6f8194 !important;
}
.search-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 7px 16px;
  background: linear-gradient(135deg, #0094ff, #17c9df 56%, #4bd0a0) !important;
  border: 1px solid rgba(0,141,230,0.18) !important;
  border-radius: 6px;
  color: #ffffff !important;
  font-size: 13px; font-weight: 700; cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 10px 24px rgba(0,141,230,0.18) !important;
}
.search-btn:hover { transform: translateY(-1px); box-shadow: 0 14px 32px rgba(0,141,230,0.24) !important; }

/* Table */
.table-wrap {
  background: rgba(255,255,255,0.94) !important;
  border: 1px solid rgba(0,141,230,0.16) !important;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 18px 40px rgba(30,86,130,0.1), inset 0 1px 0 rgba(255,255,255,0.92) !important;
  backdrop-filter: blur(16px) saturate(1.12);
}
.loading-state { text-align: center; padding: 40px; color: #40566f; font-weight: 600; }
.event-table { width: 100%; border-collapse: collapse; }
.event-table th {
  text-align: left; padding: 12px 16px;
  font-size: 12px; font-weight: 800;
  color: #0d1b2d;
  background: linear-gradient(180deg, rgba(236,248,255,0.95), rgba(222,241,255,0.78));
  border-bottom: 1px solid rgba(16,126,196,0.14);
}
.event-table td {
  padding: 10px 16px;
  font-size: 13px; color: #1d3148;
  border-bottom: 1px solid rgba(16,126,196,0.1);
  font-weight: 500;
}
.event-table tbody tr:hover td { background: rgba(0,141,230,0.055); }
.td-device { font-weight: 800; color: #006fc2; }
.td-content { max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-snapshot { font-size: 11px; color: #40566f; font-weight: 600; }
.empty-cell { text-align: center; padding: 40px 16px; color: var(--text-faint); font-size: 13px; }
.empty-illust { display: flex; flex-direction: column; align-items: center; gap: 8px; }

/* Confidence bar */
.confidence-cell { display: flex; align-items: center; gap: 8px; }
.confidence-bar {
  width: 60px; height: 5px;
  background: rgba(96,116,138,0.18);
  border-radius: 3px; overflow: hidden;
}
.confidence-fill { height: 100%; border-radius: 3px; transition: width 0.3s; }
.confidence-pct { font-size: 12px; color: #40566f; font-weight: 700; }

/* Pagination */
.pagination-wrap { padding: 12px 16px; display: flex; justify-content: flex-end; }

@media (max-width: 900px) {
  .event-center-page { padding: 16px; }
  .filter-bar { flex-wrap: wrap; }
  .table-wrap { overflow-x: auto; }
}
</style>
