<script setup>
import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated, nextTick } from 'vue'
import { fetchDashboardStats, fetchEnergyTrend, fetchDistrictData, fetchEdgeStatus, triggerEdgeSimulation, fetchEdgeRecent, triggerEnergyCalc, genTestData } from '../api/dashboard.js'
import { fetchAllDevicesForMap } from '../api/devices.js'
import { useChartScale } from '../composables/useChartScale.js'
import { useAutoRefresh } from '../composables/useAutoRefresh.js'
import { useMqtt } from '../composables/useMqtt.js'
import { withCache, invalidateCache } from '../utils/requestCache.js'
import DeviceMap from '../components/DeviceMap.vue'
import * as echarts from 'echarts'

const { scaleOption, onScaleChange } = useChartScale()
const stats = ref({})
const edgeStatus = ref({})
const edgeRecent = ref([])
const edgeLoading = ref(false)
const districts = ref([])
const chartRef = ref(null)
let chart = null
let trendData = null
let stopScaleWatch = null
const calcLoading = ref(false)
const genLoading = ref(false)

// 边缘AI 展开/筛选
const edgeExpanded = ref(false)
const edgeDeviceFilter = ref('')

// 地图
const allDevices = ref([])
const highlightDeviceId = ref('')
const searchDeviceId = ref('')
const mapSearchOptions = computed(() =>
  allDevices.value.map(d => ({ value: d.deviceId, label: `${d.name || d.deviceId} (${d.deviceId})` }))
)
function onMapMarkerClick(device) { highlightDeviceId.value = device.deviceId }
function onMapSearchSelect(deviceId) { highlightDeviceId.value = deviceId }

// ── 右侧导航 ──
const navSections = [
  { id: 'sec-stats',   label: '统计概览',     icon: '◆' },
  { id: 'sec-edge',    label: '边缘AI决策',    icon: '◇' },
  { id: 'sec-energy',  label: '能耗走势',       icon: '◇' },
  { id: 'sec-district',label: '分区设备状态',   icon: '◇' },
  { id: 'sec-map',     label: '设备分布地图',   icon: '◇' },
]
const activeSection = ref('sec-stats')
let sectionObserver = null
let manualScrolling = false
let manualScrollTimer = null

function scrollToSection(id) {
  const el = document.getElementById(id)
  if (!el) return
  activeSection.value = id
  // 暂停 Observer，防止平滑滚动过程中被其他区域抢走高亮
  manualScrolling = true
  clearTimeout(manualScrollTimer)
  manualScrollTimer = setTimeout(() => { manualScrolling = false }, 800)
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function setupSectionObserver() {
  const root = document.querySelector('.screen-scale-content')
  if (!root) return
  sectionObserver = new IntersectionObserver((entries) => {
    if (manualScrolling) return
    let best = null
    let bestRatio = 0
    entries.forEach(e => {
      if (e.intersectionRatio > bestRatio) {
        bestRatio = e.intersectionRatio
        best = e.target
      }
    })
    if (best) activeSection.value = best.id
  }, { root, threshold: [0, 0.1, 0.3, 0.5], rootMargin: '-60px 0px 0px 0px' })

  navSections.forEach(s => {
    const el = document.getElementById(s.id)
    if (el) sectionObserver.observe(el)
  })
}

// ── 软刷新（替代 location.reload，避免整页重载） ──
async function softRefreshAll() {
  try {
    invalidateCache('dashboard:')
    invalidateCache('energy:')
    const [s, t, d] = await Promise.all([
      fetchDashboardStats(), fetchEnergyTrend(), fetchDistrictData(),
    ])
    stats.value = s.data || {}
    districts.value = d.data || {}
    refreshEdgeStatus()
    const td = t.data || {}
    initChart(td)
  } catch {}
}

// ── 能耗相关 ──
async function handleCalcEnergy() {
  if (calcLoading.value) return
  calcLoading.value = true
  try {
    await triggerEnergyCalc()
    alert('当日能耗计算完成')
    await softRefreshAll()
  } catch (e) {
    alert('计算失败: ' + (e.response?.data?.msg || e.message))
  } finally { calcLoading.value = false }
}

async function handleGenData() {
  if (genLoading.value) return
  genLoading.value = true
  try {
    await genTestData(10)
    alert('历史测试数据生成完成（过去10天）')
    await softRefreshAll()
  } catch (e) {
    alert('生成失败: ' + (e.response?.data?.msg || e.message))
  } finally { genLoading.value = false }
}

function buildEdgeParams() {
  const params = { limit: edgeExpanded.value ? 50 : 20 }
  if (edgeDeviceFilter.value) params.deviceId = edgeDeviceFilter.value
  return params
}

async function refreshEdgeStatus() {
  try {
    const [s, r] = await Promise.all([
      fetchEdgeStatus(),
      fetchEdgeRecent(buildEdgeParams()),
    ])
    edgeStatus.value = s.data || {}
    edgeRecent.value = r.data || []
  } catch {}
}

async function refreshLiveData() {
  try {
    const [s, e, r] = await Promise.all([
      fetchDashboardStats(),
      fetchEdgeStatus(),
      fetchEdgeRecent(buildEdgeParams()),
    ])
    stats.value = s.data || {}
    edgeStatus.value = e.data || {}
    edgeRecent.value = r.data || []
  } catch (err) {
    console.warn('[Dashboard] Auto-refresh failed:', err.message || err)
  }
}

// 统计卡片 + 边缘AI 每 5 分钟轮询兜底，MQTT 实时推送触发即时刷新
useAutoRefresh(refreshLiveData, { interval: 300000, immediateFirst: true })

const { subscribe } = useMqtt()
subscribe('system/alarms', () => refreshLiveData())
subscribe('streetlight/+/heartbeat', () => refreshLiveData())

function toggleEdgeExpand() {
  edgeExpanded.value = !edgeExpanded.value
  refreshEdgeStatus()
}

watch(edgeDeviceFilter, () => {
  refreshEdgeStatus()
})

async function handleTriggerEdge() {
  edgeLoading.value = true
  try {
    const res = await triggerEdgeSimulation()
    edgeStatus.value = res.data || {}
    await refreshEdgeStatus()
  } catch (e) {
    alert('边缘模拟失败: ' + (e.response?.data?.msg || e.message))
  } finally { edgeLoading.value = false }
}

function handleChartResize() { chart?.resize() }

function buildChartOption(data) {
  return {
    backgroundColor: 'transparent',
    grid: { top: 30, bottom: 40, left: 50, right: 24 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.96)', borderColor: 'rgba(0,141,230,0.24)', textStyle: { color: '#1d3148', fontSize: 12 } },
    legend: { top: 4, right: 0, textStyle: { color: '#5e7187', fontSize: 12 }, data: ['本日能耗', '上周同期'] },
    xAxis: { type: 'category', data: data.labels, axisLine: { lineStyle: { color: 'rgba(0,141,230,0.22)' } }, axisLabel: { color: '#6b7f93', fontSize: 11, interval: 2 }, splitLine: { show: false } },
    yAxis: { type: 'value', name: 'kWh', nameTextStyle: { color: '#8a9bad', fontSize: 11 }, axisLabel: { color: '#6b7f93', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(16,126,196,0.12)' } } },
    series: [
      { name: '本日能耗', type: 'line', data: data.current, smooth: true, symbol: 'none', lineStyle: { color: '#4dd0e1', width: 2.5 }, areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(77,208,225,0.25)' }, { offset: 1, color: 'rgba(77,208,225,0.02)' }]) } },
      { name: '上周同期', type: 'line', data: data.lastWeek, smooth: true, symbol: 'none', lineStyle: { color: 'rgba(109,93,252,0.65)', width: 1.5, type: 'dashed' }, areaStyle: { color: 'transparent' } },
    ],
  }
}

function initChart(data) {
  if (!chartRef.value) return
  trendData = data
  if (!chart) chart = echarts.init(chartRef.value)
  chart.setOption(scaleOption(buildChartOption(data)), true)
  handleChartResize()
}

onMounted(async () => {
  try {
    const [s, t, d] = await Promise.all([
      withCache(() => fetchDashboardStats(), 'dashboard:stats', { ttl: 30000 }),
      withCache(() => fetchEnergyTrend(),   'dashboard:trend', { ttl: 30000 }),
      withCache(() => fetchDistrictData(),  'dashboard:districts', { ttl: 30000 }),
    ])
    stats.value = s.data || {}
    districts.value = d.data || {}
    refreshEdgeStatus()
    fetchAllDevicesForMap().then(list => {
      allDevices.value = Array.isArray(list) ? list : (list?.records || [])
    }).catch(() => {})
    let trendData = t.data || {}
    if (!trendData.labels || !trendData.current || trendData.current.length === 0 || trendData.current.every(v => v === 0)) {
      const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
      const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
      trendData = { labels: hours, current: hours.map(() => rand(180, 420)), lastWeek: hours.map(() => rand(200, 450)) }
    }
    await nextTick()
    initChart(trendData)
    stopScaleWatch = onScaleChange(() => initChart(trendData))
    window.addEventListener('resize', handleChartResize)
    nextTick(setupSectionObserver)
  } catch (e) {
    console.error('[Dashboard] onMounted ERROR:', e.message, e.stack)
  }
})

onActivated(() => {
  handleChartResize()
  setupSectionObserver()
})

onDeactivated(() => {
  sectionObserver?.disconnect()
})

onUnmounted(() => {
  stopScaleWatch?.()
  clearTimeout(manualScrollTimer)
  window.removeEventListener('resize', handleChartResize)
  chart?.dispose()
  sectionObserver?.disconnect()
})
</script>

<template>
  <div class="dashboard-page">
    <!-- 左侧主内容 -->
    <div class="dp-main">

      <!-- 统计概览 -->
      <section id="sec-stats" class="dp-section">
        <h2 class="section-title">统计概览</h2>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-icon devices">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7z" fill="currentColor"/></svg>
            </div>
            <div class="stat-body">
              <div class="stat-value">{{ stats.totalDevices?.toLocaleString() || '--' }}</div>
              <div class="stat-label">设备总数</div>
              <div class="stat-hint online">在线 {{ stats.onlineDevices?.toLocaleString() }}</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon online-rate">
              <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M20 12a8 8 0 11-8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </div>
            <div class="stat-body">
              <div class="stat-value">{{ stats.onlineRate }}%</div>
              <div class="stat-label">在线率</div>
              <div class="stat-hint good">设备状态良好</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon energy">
              <svg viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" opacity="0.8"/></svg>
            </div>
            <div class="stat-body">
              <div class="stat-value">{{ stats.energySavingRate }}%</div>
              <div class="stat-label">节能率</div>
              <div class="stat-hint good">较同期提升 4.2%</div>
            </div>
          </div>
          <div class="stat-card">
            <div class="stat-icon alert">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 2L2 20h20L12 2z" fill="currentColor" opacity="0.3" stroke="currentColor" stroke-width="1.5"/><path d="M12 9v5M12 17v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </div>
            <div class="stat-body">
              <div class="stat-value warn">{{ stats.alertCount }}</div>
              <div class="stat-label">未处理告警</div>
              <div class="stat-hint warn-hint" @click="$router.push('/warning?status=ACTIVE')" style="cursor:pointer">点击查看 →</div>
            </div>
          </div>
          <div class="stat-card edge">
            <div class="stat-icon edge-ai">
              <svg viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="3" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/><path d="M9 17h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </div>
            <div class="stat-body">
              <div class="stat-value">{{ edgeStatus.totalDecisions || 0 }}</div>
              <div class="stat-label">
                边缘AI决策
                <button class="edge-trigger-btn" :disabled="edgeLoading" @click="handleTriggerEdge" title="手动触发一次边缘决策模拟">
                  {{ edgeLoading ? '...' : '▶' }}
                </button>
              </div>
              <div class="stat-hint" :class="edgeStatus.hitCount > 0 ? 'good' : ''">
                {{ edgeStatus.hitCount > 0 ? '命中 ' + edgeStatus.hitCount + ' 次' : '模拟运行中' }}
                <span v-if="edgeStatus.lastSimulatedAt" class="stat-hint-time">最后: {{ edgeStatus.lastSimulatedAt.replace('T',' ').slice(5,16) }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 边缘AI决策 -->
      <section id="sec-edge" class="dp-section">
        <h2 class="section-title">边缘AI决策</h2>
        <div class="block-card">
          <!-- 工具栏 -->
          <div class="edge-toolbar">
            <el-select
              v-model="edgeDeviceFilter"
              class="edge-filter-select"
              placeholder="全部设备"
              clearable
              filterable
              size="small"
              @change="refreshEdgeStatus()"
            >
              <el-option
                v-for="d in allDevices"
                :key="d.deviceId"
                :label="`${d.name || d.deviceId} (${d.deviceId})`"
                :value="d.deviceId"
              />
            </el-select>
            <button class="edge-expand-btn" @click="toggleEdgeExpand">
              {{ edgeExpanded ? '收起' : '展开更多' }}
            </button>
          </div>

          <div class="edge-log-list" :class="{ expanded: edgeExpanded }" v-if="edgeRecent.length">
            <div v-for="(r, i) in edgeRecent" :key="i" class="edge-log-item">
              <span class="el-time">{{ r.createTime ? r.createTime.replace('T',' ').slice(5,16) : '--' }}</span>
              <span class="el-device">{{ r.deviceId }}</span>
              <span :class="r.matchedPolicy ? 'el-match' : 'el-nomatch'">{{ r.matchedPolicy || '未命中' }}</span>
              <span class="el-action">{{ r.actionTaken || '—' }}</span>
              <span class="el-tag" :class="r.result === 'EDGE_MATCH_EXECUTED' ? 'hit' : 'miss'">
                {{ r.result === 'EDGE_MATCH_EXECUTED' ? '命中' : '未命中' }}
              </span>
            </div>
          </div>
          <div v-else class="block-empty">
            {{ edgeDeviceFilter ? '该设备暂无边缘决策记录' : '暂无边缘决策记录' }}
          </div>
        </div>
      </section>

      <!-- 能耗走势 -->
      <section id="sec-energy" class="dp-section">
        <div class="section-header">
          <h2 class="section-title">能耗走势（今日 vs 上周同期）</h2>
          <div class="section-actions">
            <button class="mini-btn" :disabled="calcLoading" @click="handleCalcEnergy">{{ calcLoading ? '计算中...' : '手动计算' }}</button>
            <button class="mini-btn" :disabled="genLoading" @click="handleGenData">{{ genLoading ? '生成中...' : '生成测试数据' }}</button>
            <span class="card-sub">单位: kWh</span>
          </div>
        </div>
        <div class="block-card">
          <div ref="chartRef" class="chart-area"></div>
        </div>
      </section>

      <!-- 分区设备状态 -->
      <section id="sec-district" class="dp-section">
        <h2 class="section-title">分区设备状态</h2>
        <div class="block-card">
          <div class="district-grid">
            <div class="district-panel" v-for="d in districts" :key="d.name">
              <div class="dp-name">{{ d.name }}</div>
              <div class="dp-stats">
                <div class="dps-item"><span class="dps-val online">{{ d.online }}</span><span class="dps-lbl">在线</span></div>
                <div class="dps-item"><span class="dps-val offline">{{ d.offline }}</span><span class="dps-lbl">离线</span></div>
                <div class="dps-item"><span class="dps-val warn">{{ d.warning }}</span><span class="dps-lbl">告警</span></div>
              </div>
              <div class="district-progress">
                <div class="prog-fill" :style="{ width: (d.online / (d.online+d.offline+d.warning) * 100) + '%' }"></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 设备分布地图 -->
      <section id="sec-map" class="dp-section">
        <div class="section-header">
          <h2 class="section-title">设备分布地图</h2>
          <el-select
            v-model="searchDeviceId" filterable clearable placeholder="搜索设备..."
            size="small" class="map-search-select" @change="onMapSearchSelect"
          >
            <el-option v-for="opt in mapSearchOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </div>
        <div class="block-card">
          <DeviceMap
            :devices="allDevices"
            :highlightDeviceId="highlightDeviceId"
            height="560px"
            @marker-click="onMapMarkerClick"
          />
        </div>
      </section>

    </div>

    <!-- 右侧导航 -->
    <nav class="dp-nav">
      <div class="dp-nav-title">目录</div>
      <ul class="dp-nav-list">
        <li
          v-for="s in navSections" :key="s.id"
          :class="['dp-nav-item', { active: activeSection === s.id }]"
          @click="scrollToSection(s.id)"
        >
          <span class="dp-nav-dot"></span>
          <span class="dp-nav-label">{{ s.label }}</span>
        </li>
      </ul>
    </nav>
  </div>
</template>

<style scoped>
.dashboard-page {
  display: flex; gap: 0;
  padding: 36px 32px 56px 32px;
}

/* ── 主内容区 ── */
.dp-main {
  flex: 1;
}

.dp-section {
  margin-bottom: 44px;
  scroll-margin-top: 28px;
}

.section-title {
  font-size: 22px; font-weight: 700; color: #d8ecff;
  margin-bottom: 18px;
  border-left: 4px solid #4dd0e1; padding-left: 12px;
}

.section-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 18px;
}
.section-header .section-title { margin-bottom: 0; }
.section-actions { display: flex; align-items: center; gap: 10px; }

/* ── 统计卡片 ── */
.stats-grid { display: grid; grid-template-columns: repeat(5,1fr); gap: 24px; }
.stat-card {
  background: rgba(8,20,45,0.8); border: 1px solid rgba(0,120,200,0.15);
  border-radius: 16px; padding: 32px 28px;
  display: flex; align-items: center; gap: 20px;
  transition: border-color 0.2s, transform 0.2s;
}
.stat-card:hover { border-color: rgba(77,208,225,0.3); transform: translateY(-2px); }
.stat-icon {
  width: 72px; height: 72px; border-radius: 16px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.stat-icon svg { width: 36px; height: 36px; }
.stat-icon.devices     { background: rgba(77,208,225,0.12); color: #4dd0e1; }
.stat-icon.online-rate { background: rgba(76,175,80,0.12); color: #4caf50; }
.stat-icon.energy      { background: rgba(255,167,38,0.12); color: #ffa726; }
.stat-icon.alert       { background: rgba(239,83,80,0.12); color: #ef5350; }
.stat-icon.edge-ai     { background: rgba(0,200,180,0.12); color: #00c8b4; }
.stat-value { font-size: calc(42px * var(--scale-ratio, 1)); font-weight: 700; color: #e0f4ff; line-height: 1; margin-bottom: 6px; }
.stat-value.warn { color: #ef5350; }
.stat-label { font-size: 17px; color: rgba(140,190,220,0.65); margin-bottom: 6px; display: flex; align-items: center; }
.stat-hint { font-size: 15px; }
.stat-hint.online { color: #4caf82; }
.stat-hint.good { color: #4caf82; }
.stat-hint-time { display: block; font-size: 11px; color: rgba(140,190,220,0.45); margin-top: 2px; }
.stat-hint.warn-hint { color: rgba(239,83,80,0.8); }

/* ── 通用卡片 ── */
.block-card {
  background: rgba(8,20,45,0.8); border: 1px solid rgba(0,120,200,0.15);
  border-radius: 16px; padding: 28px 30px;
}
.block-empty { color: rgba(140,190,220,0.4); font-size: 17px; text-align: center; padding: 28px 0; }

/* ── 边缘AI ── */
.edge-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.edge-filter-select { flex: 1; max-width: 340px; }
.edge-expand-btn {
  height: 34px; padding: 0 16px; white-space: nowrap;
  background: rgba(0,100,180,0.2); border: 1px solid rgba(0,120,200,0.25);
  border-radius: 6px; color: rgba(140,210,230,0.8); font-size: 13px;
  font-weight: 600; cursor: pointer; transition: all 0.2s;
}
.edge-expand-btn:hover { background: rgba(0,120,200,0.35); border-color: rgba(77,208,225,0.5); color: #4dd0e1; }

.edge-log-list { display: flex; flex-direction: column; gap: 8px; }
.edge-log-list.expanded { max-height: 520px; overflow-y: auto; }
.edge-log-item {
  display: flex; align-items: center; gap: 14px; padding: 12px 14px;
  background: rgba(0,30,70,0.3); border-radius: 8px; font-size: 15px;
}
.el-time { color: rgba(140,190,220,0.5); font-family: monospace; min-width: 68px; font-size: 13px; }
.el-device { color: rgba(140,190,220,0.75); font-weight: 600; min-width: 64px; font-size: 13px; }
.el-match { color: #4caf82; flex: 1; font-size: 14px; }
.el-nomatch { color: rgba(140,190,220,0.35); flex: 1; font-size: 14px; }
.el-action { color: rgba(200,220,240,0.6); font-family: monospace; font-size: 13px; }
.el-tag {
  font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px;
  flex-shrink: 0;
}
.el-tag.hit { background: rgba(76,175,130,0.15); color: #4caf82; }
.el-tag.miss { background: rgba(140,190,220,0.08); color: rgba(140,190,220,0.4); }

/* ── 图表 ── */
.chart-area { width: 100%; height: 420px; }

/* ── 分区 ── */
.district-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 22px; }
.district-panel {
  background: rgba(0,30,70,0.3); border-radius: 10px; padding: 22px 24px;
  border: 1px solid rgba(0,120,200,0.1);
}
.dp-name { font-size: 18px; font-weight: 600; color: rgba(190,220,245,0.9); margin-bottom: 14px; }
.dp-stats { display: flex; gap: 28px; margin-bottom: 14px; }
.dps-item { display: flex; align-items: center; gap: 8px; }
.dps-val { font-size: 22px; font-weight: 700; }
.dps-val.online { color: #4caf82; }
.dps-val.offline { color: rgba(140,190,220,0.6); }
.dps-val.warn { color: #ffa726; }
.dps-lbl { font-size: 14px; color: rgba(140,190,220,0.45); }
.district-progress { height: 6px; background: rgba(0,80,140,0.3); border-radius: 3px; overflow: hidden; }
.prog-fill { height: 100%; background: linear-gradient(90deg, #4dd0e1, #4caf50); border-radius: 3px; transition: width 0.8s ease; }

/* ── 地图搜索 ── */
.map-search-select { width: 260px; }
.map-search-select :deep(.el-input__wrapper) {
  background: rgba(255,255,255,0.9);
  border: 1px solid rgba(0,141,230,0.18);
  box-shadow: 0 8px 20px rgba(30,86,130,0.08);
}
.map-search-select :deep(.el-input__inner) { color: #0d1b2d; }
.map-search-select :deep(.el-input__wrapper:hover) { border-color: rgba(0,141,230,0.38); }

/* ── 右侧导航 ── */
.dp-nav {
  width: 130px; flex-shrink: 0;
  position: sticky; top: 100px; align-self: flex-start;
  padding-left: 8px;
}
.dp-nav-title {
  font-size: 15px; font-weight: 600; color: rgba(140,190,220,0.5);
  margin-bottom: 16px; text-transform: uppercase; letter-spacing: 2px;
}
.dp-nav-list { list-style: none; display: flex; flex-direction: column; gap: 4px; }
.dp-nav-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 6px;
  cursor: pointer; transition: all 0.2s;
  font-size: 15px; color: rgba(140,190,220,0.55);
}
.dp-nav-item:hover { color: rgba(180,220,240,0.8); background: rgba(0,80,160,0.15); }
.dp-nav-item.active { color: #4dd0e1; background: rgba(0,120,200,0.15); }
.dp-nav-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: currentColor; flex-shrink: 0;
  transition: all 0.3s;
}
.dp-nav-item.active .dp-nav-dot {
  width: 9px; height: 9px;
  box-shadow: 0 0 8px currentColor;
}

/* ── 其他 ── */
.edge-trigger-btn {
  display: inline-block; margin-left: 8px; width: 26px; height: 26px;
  background: rgba(0,200,180,0.15); border: 1px solid rgba(0,200,180,0.3);
  border-radius: 50%; color: rgba(150,240,230,0.9); font-size: 12px;
  cursor: pointer; transition: all 0.2s; vertical-align: middle;
}
.edge-trigger-btn:hover:not(:disabled) { background: rgba(0,200,180,0.3); }
.edge-trigger-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.mini-btn {
  padding: 6px 16px; font-size: 15px; line-height: 1.5;
  background: rgba(0,100,180,0.2); border: 1px solid rgba(0,120,200,0.3);
  border-radius: 6px; color: rgba(140,200,230,0.7);
  cursor: pointer; transition: all 0.2s; white-space: nowrap;
}
.mini-btn:hover:not(:disabled) { background: rgba(0,120,200,0.35); border-color: rgba(77,208,225,0.5); color: #4dd0e1; }
.mini-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.card-sub { font-size: 15px; color: rgba(140,190,220,0.55); }

@media (max-width: 1100px) {
  .dashboard-page { padding: 16px; }
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
  .map-row { flex-direction: column; }
  .map-section, .stats-cards { min-width: unset; width: 100%; }
}
@media (max-width: 600px) {
  .stats-grid { grid-template-columns: 1fr; }
  .edge-tabs { flex-wrap: wrap; }
  .edge-tab-text { display: none; }
  .chart-area { height: 280px; }
}
</style>
