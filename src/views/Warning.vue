<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchAlarmPage, fetchAlarmExportList, handleAlarm, ALARM_STATUS_MAP, ALARM_LEVEL_MAP, ALARM_TYPE_MAP } from '../api/warnings.js'
import { faultSimulate, offlineSimulate } from '../api/devices.js'
import { buildAlarmCsvContent, formatAlarmTime } from '../utils/alarmExport.js'
import { useAutoRefresh } from '../composables/useAutoRefresh.js'
import { useUserInfo } from '../composables/useUserInfo.js'
import { useMqtt } from '../composables/useMqtt.js'

const route = useRoute()

const alarms  = ref([])
const total   = ref(0)
const loading = ref(false)
const exporting = ref(false)

const filters = reactive({
  deviceId:  '',
  startTime: '',
  endTime:   '',
  type:      'ALL',
  level:     'ALL',
  status:    'ALL',
})
const currentPage = ref(1)
const pageSize    = 10

// 过滤选项（映射到后端枚举值）
const typeOptions  = [
  { label: '全部类型',   value: 'ALL' },
  { label: '离线',       value: 'OFFLINE' },
  { label: '故障',       value: 'FAULT' },
  { label: '健康分过低',  value: 'HEALTH_LOW' },
]
const levelOptions = [
  { label: '全部级别', value: 'ALL' },
  { label: '紧急',     value: 'CRITICAL' },
  { label: '严重',     value: 'MAJOR' },
  { label: '警告',     value: 'WARNING' },
]
const statusOptions = [
  { label: '全部状态',  value: 'ALL' },
  { label: '待处理',    value: 'ACTIVE' },
  { label: '处理中',    value: 'ACKNOWLEDGED' },
  { label: '已解决',    value: 'RECOVERED' },
]

const totalPages = computed(() => Math.ceil(total.value / pageSize))

async function loadData() {
  loading.value = true
  try {
    const res = await fetchAlarmPage({
      ...filters,
      pageNum:  currentPage.value,
      pageSize,
    })
    // 兼容 res.data.records 或直接 res.data
    const pageData = res.data || res
    alarms.value = pageData.records || []
    total.value  = pageData.total   || 0
  } finally {
    loading.value = false
  }
}

function doSearch() { currentPage.value = 1; loadData() }
function doReset() {
  filters.deviceId = ''; filters.startTime = ''; filters.endTime = ''
  filters.type = 'ALL'; filters.level = 'ALL'; filters.status = 'ALL'
  doSearch()
}
function goPage(p) {
  if (p < 1 || p > totalPages.value) return
  currentPage.value = p; loadData()
}

const pageNumbers = computed(() => {
  const t = totalPages.value
  if (t <= 7) return Array.from({ length: t }, (_, i) => i + 1)
  const cur = currentPage.value
  if (cur <= 4) return [1, 2, 3, 4, 5, '...', t]
  if (cur >= t - 3) return [1, '...', t - 4, t - 3, t - 2, t - 1, t]
  return [1, '...', cur - 1, cur, cur + 1, '...', t]
})

// 格式化时间显示
function formatTime(value) {
  return formatAlarmTime(value)
}

// 导出 CSV 报表
async function handleExport() {
  if (exporting.value) return
  exporting.value = true
  try {
    const data = await fetchAlarmExportList({ ...filters })
    if (!data.length) {
      ElMessage.warning('没有可导出的告警数据')
      return
    }

    const csvContent = buildAlarmCsvContent(data, {
      levelMap: ALARM_LEVEL_MAP,
      typeMap: ALARM_TYPE_MAP,
      statusMap: ALARM_STATUS_MAP,
    })

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `告警报表_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    ElMessage.success(`已导出 ${data.length} 条告警记录`)
  } catch (error) {
    ElMessage.error(error?.message || '导出告警数据失败')
  } finally {
    exporting.value = false
  }
}

// 告警类型中文显示
function typeLabel(type) {
  return ALARM_TYPE_MAP[type] || type || '--'
}

const { username } = useUserInfo()

const confirming = ref(new Set())
async function handleConfirm(alarm) {
  confirming.value.add(alarm.id)
  try {
    await handleAlarm(alarm.id, { handler: username.value, remark: '运维确认处理' })
    ElMessage.success(`已确认告警 #${alarm.id}`)
    loadData()
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e?.message || '确认失败')
  } finally {
    confirming.value.delete(alarm.id)
  }
}

const simulating = ref(false)
const offlining = ref(false)

async function simulateFault() {
  simulating.value = true
  try {
    const res = await faultSimulate()
    ElMessage.success(`故障模拟成功 — 已向 ${res.data.deviceId} (${res.data.deviceName}) 注入异常遥测数据，连续2条`)
    setTimeout(() => loadData(), 1500)
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e?.message || '故障模拟失败')
  } finally {
    simulating.value = false
  }
}

async function simulateOffline() {
  offlining.value = true
  try {
    const res = await offlineSimulate()
    ElMessage.success(`离线模拟成功 — ${res.data.deviceId} (${res.data.deviceName}) 已标记为离线，30s 内心跳恢复`)
    setTimeout(() => loadData(), 1500)
  } catch (e) {
    ElMessage.error(e?.response?.data?.message || e?.message || '离线模拟失败')
  } finally {
    offlining.value = false
  }
}

// URL 参数预设筛选（同步执行，在 setup 阶段而非 onMounted 中）
if (route.query.status && statusOptions.some(o => o.value === route.query.status)) {
  filters.status = route.query.status
}
if (route.query.type && typeOptions.some(o => o.value === route.query.type)) {
  filters.type = route.query.type
}

useAutoRefresh(loadData, {
  interval: 300000,
  isSensitive: () => exporting.value || filters.startTime || filters.endTime,
})

const { subscribe } = useMqtt()

onMounted(() => {
  loadData()
  subscribe('system/alarms', () => loadData())
})
</script>

<template>
  <div class="warning-page">
    <!-- 页头 -->
    <div class="page-header">
      <div>
        <h1 class="page-title">告警列表</h1>
        <p class="page-sub">实时监控全域设备状态，快速定位并处理异常事件。</p>
      </div>
      <div class="header-actions">
        <button class="fault-btn" :disabled="simulating" @click="simulateFault">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 9v2m0 4h.01M5.07 19H19a2 2 0 001.73-3L13.73 4.99a2 2 0 00-3.46 0L3.34 16A2 2 0 005.07 19z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          {{ simulating ? '注入中...' : '模拟故障' }}
        </button>
        <button class="offline-btn" :disabled="offlining" @click="simulateOffline">
          <svg viewBox="0 0 24 24" fill="none"><path d="M18.36 5.64a9 9 0 11-12.72 0M12 2v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          {{ offlining ? '标记中...' : '模拟离线' }}
        </button>
        <button class="export-btn" :disabled="exporting" @click="handleExport">
          <svg viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          {{ exporting ? '导出中...' : '导出报表' }}
        </button>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <div class="filter-group">
        <label>设备ID</label>
        <input v-model="filters.deviceId" class="filter-input" placeholder="输入设备编号" />
      </div>
      <div class="filter-group">
        <label>时间范围</label>
        <div class="date-range">
          <input v-model="filters.startTime" class="filter-input date-input" type="datetime-local" />
          <span class="dash">-</span>
          <input v-model="filters.endTime" class="filter-input date-input" type="datetime-local" />
        </div>
      </div>
      <div class="filter-group">
        <label>告警类型</label>
        <select v-model="filters.type" class="filter-select">
          <option v-for="o in typeOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="filter-group">
        <label>告警级别</label>
        <select v-model="filters.level" class="filter-select">
          <option v-for="o in levelOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="filter-group">
        <label>告警状态</label>
        <select v-model="filters.status" class="filter-select">
          <option v-for="o in statusOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="filter-actions">
        <button class="btn-search" @click="doSearch">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          查询
        </button>
        <button class="btn-reset" @click="doReset">
          <svg viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3 3v5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          重置
        </button>
      </div>
    </div>

    <!-- 表格 -->
    <div class="table-card">
      <div class="table-wrap">
        <table class="warn-table">
          <thead>
            <tr>
              <th>序号</th>
              <th>设备编号</th>
              <th>级别</th>
              <th>告警类型</th>
              <th>告警原因</th>
              <th>发生时间</th>
              <th>恢复时间</th>
              <th>状态</th>
              <th>处理人</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="10" class="loading-row">
                <div class="loading-spinner"></div> 加载中...
              </td>
            </tr>
            <tr v-else-if="!alarms.length">
              <td colspan="10" class="loading-row">暂无告警数据</td>
            </tr>
            <template v-else>
              <tr v-for="(a, index) in alarms" :key="a.id" class="table-row">
                <td class="td-seq">{{ total - (currentPage - 1) * pageSize - index }}</td>
                <td class="td-device">
                  <button class="device-link" @click="$router.push(`/devices/${a.deviceId}`)">{{ a.deviceId }}</button>
                </td>
                <td>
                  <span class="level-badge" :class="ALARM_LEVEL_MAP[a.level]?.cls">
                    {{ ALARM_LEVEL_MAP[a.level]?.label || a.level }}
                  </span>
                </td>
                <td class="td-type">{{ typeLabel(a.type) }}</td>
                <td class="td-reason">
                  <span :title="a.reason">{{ a.reason?.length > 22 ? a.reason.slice(0,22)+'...' : a.reason }}</span>
                </td>
                <td class="td-time">{{ formatTime(a.startAt) }}</td>
                <td class="td-time">{{ a.recoverAt ? formatTime(a.recoverAt) : '--' }}</td>
                <td>
                  <span class="status-text" :class="ALARM_STATUS_MAP[a.status]?.cls">
                    {{ ALARM_STATUS_MAP[a.status]?.label || a.status }}
                  </span>
                </td>
                <td class="td-handler">{{ a.handler || '--' }}</td>
                <td class="td-actions">
                  <button v-if="a.status === 'ACTIVE'" class="confirm-btn" :disabled="confirming.has(a.id)" @click="handleConfirm(a)">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    {{ confirming.has(a.id) ? '...' : '确认' }}
                  </button>
                  <button class="action-btn" @click="$router.push(`/devices/${a.deviceId}`)">
                    <svg viewBox="0 0 24 24" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/></svg>
                    查看
                  </button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- 分页 -->
      <div class="pagination-bar">
        <span class="total-text">共 {{ total }} 条告警记录</span>
        <div class="pagination">
          <button class="page-btn" :disabled="currentPage === 1" @click="goPage(currentPage - 1)">‹</button>
          <template v-for="p in pageNumbers" :key="p">
            <button v-if="p !== '...'" class="page-btn" :class="{ active: p === currentPage }" @click="goPage(p)">{{ p }}</button>
            <span v-else class="page-ellipsis">···</span>
          </template>
          <button class="page-btn" :disabled="currentPage === totalPages" @click="goPage(currentPage + 1)">›</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.warning-page { padding: 28px 28px 20px; min-height: 100%; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
.page-title { font-size: 22px; font-weight: 700; color: #e0f4ff; margin-bottom: 4px; }
.page-sub { font-size: 13px; color: rgba(140,190,220,0.6); }
.header-actions { display: flex; gap: 10px; }
.export-btn { display: flex; align-items: center; gap: 6px; padding: 8px 16px; background: rgba(0,80,140,0.25); border: 1px solid rgba(0,120,200,0.35); border-radius: 8px; color: rgba(140,200,230,0.9); font-size: 13px; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
.export-btn svg { width: 15px; height: 15px; }
.export-btn:hover { background: rgba(0,120,200,0.2); border-color: rgba(77,208,225,0.4); color: #4dd0e1; }
.export-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
.fault-btn { display: flex; align-items: center; gap: 6px; padding: 8px 16px; background: rgba(200,80,30,0.2); border: 1px solid rgba(220,100,50,0.35); border-radius: 8px; color: rgba(255,170,80,0.9); font-size: 13px; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
.fault-btn svg { width: 15px; height: 15px; }
.fault-btn:hover { background: rgba(200,80,30,0.3); border-color: rgba(255,150,60,0.5); color: #ffa040; box-shadow: 0 0 12px rgba(255,100,30,0.2); }
.fault-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }
.offline-btn { display: flex; align-items: center; gap: 6px; padding: 8px 16px; background: rgba(140,140,170,0.2); border: 1px solid rgba(150,150,200,0.35); border-radius: 8px; color: rgba(180,180,210,0.9); font-size: 13px; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
.offline-btn svg { width: 15px; height: 15px; }
.offline-btn:hover { background: rgba(140,140,170,0.3); border-color: rgba(170,170,220,0.5); color: #c0c0e0; box-shadow: 0 0 12px rgba(140,140,200,0.2); }
.offline-btn:disabled { opacity: 0.55; cursor: not-allowed; transform: none; }

/* Filter bar */
.filter-bar { background: rgba(8,20,45,0.8); border: 1px solid rgba(0,120,200,0.15); border-radius: 10px; padding: 16px 20px; display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
.filter-group { display: flex; flex-direction: column; gap: 6px; }
.filter-group label { font-size: 12px; color: rgba(140,190,220,0.65); }
.filter-input { height: 36px; min-width: 130px; background: rgba(0,20,50,0.7); border: 1px solid rgba(0,100,160,0.3); border-radius: 6px; color: #d0eaf8; font-size: 13px; padding: 0 10px; outline: none; transition: border-color 0.2s; }
.filter-input:focus { border-color: rgba(77,208,225,0.5); }
.filter-input::placeholder { color: rgba(100,160,200,0.4); }
.date-range { display: flex; align-items: center; gap: 6px; }
.date-input { min-width: 155px; }
.dash { color: rgba(140,190,220,0.5); }
.filter-select { height: 36px; min-width: 110px; background: rgba(0,20,50,0.7); border: 1px solid rgba(0,100,160,0.3); border-radius: 6px; color: #d0eaf8; font-size: 13px; padding: 0 10px; outline: none; cursor: pointer; appearance: auto; }
.filter-actions { display: flex; gap: 8px; margin-left: auto; }
.btn-search { display: flex; align-items: center; gap: 6px; padding: 0 18px; height: 36px; background: linear-gradient(135deg, #0077cc, #0099e6); border: none; border-radius: 6px; color: #fff; font-size: 13px; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 10px rgba(0,150,230,0.3); }
.btn-search svg { width: 14px; height: 14px; }
.btn-search:hover { box-shadow: 0 4px 16px rgba(0,150,230,0.5); transform: translateY(-1px); }
.btn-reset { display: flex; align-items: center; gap: 6px; padding: 0 16px; height: 36px; background: rgba(255,255,255,0.94) !important; border: 1px solid rgba(0,141,230,0.24) !important; border-radius: 6px; color: #006fc2 !important; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 8px 20px rgba(30,86,130,0.08) !important; }
.btn-reset svg { width: 14px; height: 14px; }
.btn-reset:hover { background: #ffffff !important; border-color: rgba(0,141,230,0.42) !important; color: #008de6 !important; transform: translateY(-1px); box-shadow: 0 12px 28px rgba(30,86,130,0.12) !important; }

/* Table */
.table-card { background: rgba(8,20,45,0.8); border: 1px solid rgba(0,120,200,0.15); border-radius: 10px; overflow: hidden; }
.table-wrap { overflow-x: auto; }
.warn-table { width: 100%; border-collapse: collapse; }
.warn-table th { padding: 12px 14px; text-align: left; font-size: 12px; color: rgba(140,190,220,0.6); font-weight: 500; background: rgba(0,30,70,0.5); border-bottom: 1px solid rgba(0,100,160,0.15); white-space: nowrap; }
.table-row td { padding: 13px 14px; font-size: 13px; color: rgba(180,220,240,0.85); border-bottom: 1px solid rgba(0,80,140,0.1); vertical-align: middle; }
.table-row:last-child td { border-bottom: none; }
.table-row:hover td { background: rgba(0,80,160,0.08); }
.loading-row { text-align: center; padding: 40px; color: rgba(140,190,220,0.5); font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.loading-spinner { width: 16px; height: 16px; border: 2px solid rgba(77,208,225,0.3); border-top-color: #4dd0e1; border-radius: 50%; animation: spin 0.8s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
.td-seq { font-size: 13px; color: rgba(140,190,220,0.6); white-space: nowrap; text-align: center; width: 60px; }
.td-device .device-link { background: none; border: none; color: rgba(77,208,225,0.9); font-size: 12px; font-family: monospace; cursor: pointer; text-decoration: underline; padding: 0; }
.td-device .device-link:hover { color: #4dd0e1; }
.td-type { white-space: nowrap; }
.td-reason { max-width: 200px; }
.td-time { white-space: nowrap; font-size: 13px; color: rgba(140,190,220,0.75); font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace; letter-spacing: 0.3px; }
.td-handler { white-space: nowrap; font-size: 12px; }
.level-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; }
.level-badge.critical { background: rgba(220,50,50,0.2); border: 1px solid rgba(220,80,80,0.4); color: #ff7070; }
.level-badge.warning  { background: rgba(240,160,30,0.15); border: 1px solid rgba(240,160,30,0.35); color: #ffa726; }
.level-badge.info     { background: rgba(0,180,100,0.15); border: 1px solid rgba(0,200,100,0.3); color: #4caf82; }
.status-text { font-size: 12px; font-weight: 500; }
.status-text.pending    { color: #ffa726; }
.status-text.processing { color: #4dd0e1; }
.status-text.resolved   { color: #66bb6a; }
.td-actions { display: flex; gap: 6px; }
.action-btn { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; background: rgba(0,80,140,0.2); border: 1px solid rgba(0,120,200,0.25); border-radius: 5px; color: rgba(77,208,225,0.9); font-size: 12px; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
.action-btn svg { width: 13px; height: 13px; }
.action-btn:hover { background: rgba(0,120,200,0.2); border-color: rgba(77,208,225,0.5); color: #4dd0e1; }
.confirm-btn { display: inline-flex; align-items: center; gap: 4px; padding: 5px 10px; background: rgba(0,180,100,0.15); border: 1px solid rgba(0,200,100,0.3); border-radius: 5px; color: rgba(76,175,130,0.9); font-size: 12px; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
.confirm-btn svg { width: 13px; height: 13px; }
.confirm-btn:hover { background: rgba(0,180,100,0.25); border-color: rgba(0,220,120,0.5); color: #66bb6a; }
.confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.pagination-bar { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-top: 1px solid rgba(0,80,140,0.15); }
.total-text { font-size: 13px; color: rgba(140,190,220,0.6); }
.pagination { display: flex; gap: 4px; align-items: center; }
.page-btn { min-width: 32px; height: 32px; padding: 0 6px; background: rgba(0,30,70,0.6); border: 1px solid rgba(0,100,160,0.2); border-radius: 6px; color: rgba(140,200,230,0.8); font-size: 13px; cursor: pointer; transition: all 0.2s; }
.page-btn:hover:not(:disabled) { background: rgba(0,100,200,0.2); border-color: rgba(77,208,225,0.4); color: #4dd0e1; }
.page-btn.active { background: rgba(0,120,220,0.3); border-color: rgba(77,208,225,0.5); color: #4dd0e1; font-weight: 700; }
.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.page-ellipsis { color: rgba(140,190,220,0.5); font-size: 13px; padding: 0 4px; }
</style>
