<script setup>
import { ref, watch, onMounted, onUnmounted, onActivated, onDeactivated, nextTick, inject, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as echarts from 'echarts'
import { fetchDashboardStats, fetchEnergyTrend, fetchDistrictData, triggerEnergyCalc, genTestData, fetchEdgeRecent, triggerEdgeSimulation } from '../api/dashboard.js'
import { fetchAllDevicesForMap, controlDevice } from '../api/devices.js'

import { useCountUp } from '../composables/useCountUp.js'
import { useAutoRefresh } from '../composables/useAutoRefresh.js'
import { withCache, invalidateCache } from '../utils/requestCache.js'
import { parseLatestData } from '../utils/manualControlState.js'
import { getControlState, setControlState } from '../utils/controlStateStore.js'
import { useControlSync } from '../composables/useControlSync.js'
import DeviceMap from '../components/DeviceMap.vue'

const router = useRouter()

// ═══ 沉浸模式（来自 MainLayout） ═══
const immersive = inject('immersiveMode', null)
const isImmersive = immersive?.isImmersive ?? ref(false)
const toggleImmersive = immersive?.toggleImmersive ?? (() => {})

// ═══ 3D 点击弹窗 + 悬停 ═══
const popupDevice = ref(null)
const hoveredDevice = ref(null)
const hoverTooltipStyle = ref({})
const controlLoading = ref(false)
let controlGeneration = 0            // 异步校准代际计数器（取消过期回调）
function showDevicePopup(device) {
  let brightness = 100
  // 1) Custom brightness from 3D userData (most recent)
  if (device._customBrightness != null) {
    brightness = device._customBrightness
  } else if (device.lightState === 'off') {
    brightness = 0
  } else if (device.latestData) {
    try {
      const ld = typeof device.latestData === 'string' ? JSON.parse(device.latestData) : device.latestData
      if (ld?.brightness != null) brightness = ld.brightness
    } catch (_) { /* ignore */ }
  }
  popupDevice.value = { ...device, _brightness: brightness }
}
function dismissPopup() { popupDevice.value = null }
function goToDeviceDetail(deviceId) {
  router.push(`/devices/${deviceId}?from=dashboard`)
}
async function handlePopupControl(action, brightness) {
  if (controlLoading.value || !popupDevice.value) return
  const did = popupDevice.value.deviceId
  controlLoading.value = true
  const gen = ++controlGeneration  // 记录本次代际，用于取消过期异步回调
  try {
    await controlDevice(did, { action, brightness })
    const bVal = action === 'OFF' ? 0 : (brightness || 100)
    // 乐观更新弹窗显示
    if (action === 'ON') { popupDevice.value._brightness = 100; popupDevice.value.lightState = 'on' }
    else if (action === 'OFF') { popupDevice.value._brightness = 0; popupDevice.value.lightState = 'off' }
    else if (action === 'DIMMING') { popupDevice.value._brightness = brightness; popupDevice.value.lightState = 'on' }
    // 写入控制状态缓存
    setControlState(did, action, bVal)
    // 立即更新 3D 场景（乐观更新，不等 API 轮询）
    if (applyDeviceBrightness3D) applyDeviceBrightness3D(did, bVal)
    // 异步拉取全量数据做增量校准（不阻塞 UI 反馈）
    fetchAllDevicesForMap().then(list => {
      // 过期回调直接丢弃，避免竟态覆盖
      if (gen !== controlGeneration) return
      const devs = Array.isArray(list) ? list : (list?.data || list?.records || [])
      if (devs.length > 0) {
        allDevices.value = devs
        if (syncDevices3D) syncDevices3D(devs)
      }
    }).catch(() => {})
    ElMessage.success(action === 'ON' ? '已开灯' : action === 'OFF' ? '已关灯' : `亮度已调至 ${brightness}%`)
  } catch (e) { console.error('[popup] control error:', e) }
  finally { controlLoading.value = false }
}

// ═══ 视图切换 ═══
const viewMode = ref('3d')  // '3d' | 'map'

// ═══ 数据状态 ═══
const stats = ref({})
const districts = ref([])
const allDevices = ref([])
const currentTime = ref('')
let clockTimer = null

// ═══ 数字滚动 ═══
const { display: dispTotal, start: startTotal } = useCountUp({ suffix: '' })
const { display: dispOnline, start: startOnline } = useCountUp({ suffix: '%', decimals: 1 })
const { display: dispSaving, start: startSaving } = useCountUp({ suffix: '%', decimals: 1 })
const { display: dispEnergy, start: startEnergy } = useCountUp({ suffix: ' kWh', decimals: 1 })

// ═══ 地图相关 ═══
const selectedArea = ref('')
const highlightDeviceId = ref('')
function onMapMarkerClick(device) {
  highlightDeviceId.value = device.deviceId
  selectedArea.value = ''
}

// 分区列表（从设备数据中提取，供 3D 搜索使用）
const areaOptions = computed(() => {
  const areas = [...new Set(allDevices.value.map(d => d.area).filter(Boolean))]
  return areas.sort().map(a => ({ label: a, value: a }))
})

function onAreaSelect(areaName) {
  selectedArea.value = areaName || ''
  if (areaName && viewMode.value === '3d') {
    flyToArea3D?.(areaName)
  }
}

// ═══ 能耗计算 ═══
const calcLoading = ref(false)
const genLoading = ref(false)

async function handleCalcEnergy() {
  if (calcLoading.value) return
  calcLoading.value = true
  try {
    await triggerEnergyCalc()
    await softRefresh()
    ElMessage.success('当日能耗计算已完成')
  } catch (e) {
    console.warn('计算失败:', e)
  } finally { calcLoading.value = false }
}

let autoCalcDone = false
async function autoCalcEnergyIfFirst() {
  if (autoCalcDone) return
  autoCalcDone = true
  try {
    await triggerEnergyCalc()
  } catch (_) { /* 静默失败 */ }
}

// ═══ AI 边缘决策 ═══
const edgeRecords = ref([])
const edgeLoading = ref(false)
async function loadEdgeRecent() {
  try {
    const res = await fetchEdgeRecent({ limit: 20 })
    const data = res?.data || res
    edgeRecords.value = Array.isArray(data) ? data : (data?.records || [])
  } catch (_) { /* ignore */ }
}
async function handleTriggerEdge() {
  if (edgeLoading.value) return
  edgeLoading.value = true
  try {
    await triggerEdgeSimulation()
    await loadEdgeRecent()
  } catch (_) { /* ignore */ }
  finally { edgeLoading.value = false }
}

const energyChartRef = ref(null)
const donutChartRef = ref(null)
let energyChart = null
let donutChart = null

// ═══ Three.js 3D 场景 ═══
const threeContainer = ref(null)
let threeDispose = null
const threeDeviceStats = ref({ count: 0, online: 0, alarm: 0 })  // 3D 场景设备统计
let syncDevices3D = null  // 外部可调用的设备同步函数
let rebuildScene3D = null  // 外部可调用的全量重建设备函数
let flyToArea3D = null     // 外部可调用的相机飞行函数
let highlight3D = null     // 外部可调用的设备高亮函数
let highlightArea3D = null // 外部可调用的区域高亮函数
let setDeviceLight3D = null // 外部可调用的设备亮度函数
let applyDeviceBrightness3D = null // 外部可调用的设备亮度增量更新（不重建mesh）
let flyToOverview3D = null          // 外部可调用的俯瞰视角
let initialMountDone = false       // 首次挂载是否完成（防止 onActivated 竞态）

// ═══ 跨标签页控制同步 ═══
const { onControlChange } = useControlSync()

// ═══ 数据加载 ═══
async function loadAllData() {
  try {
    const [s, t, d] = await Promise.all([
      withCache(() => fetchDashboardStats(), 'dashboard:stats', { ttl: 30000 }),
      withCache(() => fetchEnergyTrend(), 'dashboard:trend', { ttl: 30000 }),
      withCache(() => fetchDistrictData(), 'dashboard:districts', { ttl: 30000 }),
    ])
    stats.value = s.data || {}
    districts.value = d.data || {}
    initEnergyChart(t.data || {})

    startTotal(stats.value.totalDevices || 0)
    startOnline(stats.value.onlineRate || 0)
    startSaving(stats.value.energySavingRate || 0)
    startEnergy(stats.value.todayEnergy || 0)

    fetchAllDevicesForMap().then(list => {
      const devs = Array.isArray(list) ? list : (list?.data || list?.records || [])
      allDevices.value = devs
    }).catch(() => {})
  } catch {}
}

async function softRefresh() {
  invalidateCache('dashboard:')
  await loadAllData()
}

// MQTT 订阅保留（基础设施，供其他组件使用），但 Dashboard 已改用软轮询
// 设备状态同步由 15s 软轮询 + 3D 增量更新处理

// ═══ 时钟 ═══
function updateClock() {
  const now = new Date()
  currentTime.value = now.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
}
clockTimer = setInterval(updateClock, 1000)
updateClock()

async function handleGenData() {
  if (genLoading.value) return
  genLoading.value = true
  try {
    await genTestData(10)
    await softRefresh()
  } catch (e) {
    console.warn('生成失败:', e)
  } finally { genLoading.value = false }
}

// ═══ ECharts 能耗图 ═══
function buildEnergyOption(data) {
  const hours = data.labels || Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
  const cur = data.current || hours.map(() => 0)
  const prev = data.lastWeek || hours.map(() => 0)
  return {
    backgroundColor: 'transparent',
    grid: { top: 20, bottom: 30, left: 44, right: 16 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(4,20,50,0.96)', borderColor: 'rgba(77,208,225,0.4)', textStyle: { color: '#d0eaf8', fontSize: 12 } },
    legend: { top: 0, right: 0, textStyle: { color: 'rgba(140,190,220,0.7)', fontSize: 11 }, data: ['本日能耗', '上周同期'], itemWidth: 14, itemHeight: 8 },
    xAxis: {
      type: 'category', data: hours,
      axisLine: { lineStyle: { color: 'rgba(77,208,225,0.2)' } },
      axisLabel: { color: 'rgba(160,210,240,0.65)', fontSize: 10, interval: 3 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', name: 'kWh', nameTextStyle: { color: 'rgba(160,210,240,0.6)', fontSize: 10 },
      axisLabel: { color: 'rgba(160,210,240,0.65)', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(77,208,225,0.08)' } },
    },
    series: [
      {
        name: '本日能耗', type: 'line', data: cur, smooth: true, symbol: 'none',
        lineStyle: { color: '#4dd0e1', width: 2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(77,208,225,0.2)' }, { offset: 1, color: 'rgba(77,208,225,0.01)' }]) },
      },
      {
        name: '上周同期', type: 'line', data: prev, smooth: true, symbol: 'none',
        lineStyle: { color: 'rgba(109,93,252,0.5)', width: 1, type: 'dashed' },
      },
    ],
  }
}

function initEnergyChart(data) {
  if (!energyChartRef.value) return
  if (!energyChart) energyChart = echarts.init(energyChartRef.value)
  energyChart.setOption(buildEnergyOption(data), true)
}

// ═══ ECharts 环形图 ═══
function buildDonutOption() {
  const online = stats.value.onlineDevices || 0
  const total = stats.value.totalDevices || 1
  const rate = total > 0 ? Math.round((online / total) * 100) : 0
  return {
    backgroundColor: 'transparent',
    series: [{
      type: 'pie', radius: ['62%', '82%'], center: ['50%', '50%'],
      emphasis: { scale: false }, silent: true,
      labelLine: { show: false },
      label: { show: true, position: 'center', formatter: `{b|${rate}%}\n{c|在线率}`, rich: { b: { fontSize: 24, fontWeight: 'bold', color: '#4dd0e1', lineHeight: 30 }, c: { fontSize: 11, color: 'rgba(180,220,240,0.65)', lineHeight: 18 } } },
      data: [
        { value: online, itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: '#4dd0e1' }, { offset: 1, color: '#008de6' }]) } },
        { value: total - online, itemStyle: { color: 'rgba(255,255,255,0.06)' } },
      ],
    }],
  }
}

function initDonutChart() {
  if (!donutChartRef.value) return
  if (!donutChart) donutChart = echarts.init(donutChartRef.value)
  donutChart.setOption(buildDonutOption(), true)
}

function updateDonutChart() {
  if (donutChart) donutChart.setOption(buildDonutOption(), true)
}

// ═══ 分区能耗排名图 ═══
const barChartRef = ref(null)
let barChart = null

function buildBarOption(data) {
  // 按在线数量升序（ECharts 从下往上渲染，最大值在顶部=排名第1）
  const sorted = [...data].sort((a, b) => a.online - b.online)
  const names = sorted.map(d => d.name)
  const values = sorted.map(d => d.online)
  return {
    backgroundColor: 'transparent',
    grid: { top: 4, bottom: 4, left: 56, right: 16 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(4,20,50,0.96)', borderColor: 'rgba(77,208,225,0.4)', textStyle: { color: '#d0eaf8', fontSize: 12 }, formatter: p => `${p[0].name}：${p[0].value} 台在线` },
    xAxis: { type: 'value', show: false },
    yAxis: { type: 'category', data: names, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: 'rgba(160,210,240,0.7)', fontSize: 11, width: 56, overflow: 'truncate' } },
    series: [{
      type: 'bar', data: values, barWidth: 10,
      itemStyle: {
        borderRadius: [0, 3, 3, 0],
        color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: 'rgba(77,208,225,0.3)' }, { offset: 1, color: '#4dd0e1' }]),
      },
      label: { show: true, position: 'right', color: 'rgba(160,210,240,0.7)', fontSize: 10, formatter: '{c}' },
    }],
  }
}

function initBarChart(data) {
  if (!barChartRef.value) return
  if (!barChart) {
    barChart = echarts.init(barChartRef.value)
    barChart.on('click', (params) => {
      if (params.name) {
        selectedArea.value = params.name
        if (viewMode.value !== '3d') {
          viewMode.value = '3d'
          nextTick(() => flyToArea3D?.(params.name))
        } else {
          flyToArea3D?.(params.name)
        }
      }
    })
  }
  barChart.setOption(buildBarOption(data), true)
}

// ═══ Three.js 3D 场景 ═══
function initThreeScene(preloadedDevices) {
  if (!threeContainer.value) return
  // 清理旧场景，防止重复调用创建多个渲染器
  if (threeDispose) { threeDispose(); threeDispose = null }
  console.log('[3D] initThreeScene called, preloadedDevices:', preloadedDevices?.length || 0)

  const container = threeContainer.value
  const W = container.clientWidth
  const H = container.clientHeight

  // Scene
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0a1628)
  scene.fog = new THREE.Fog(0x0a1628, 40, 130)

  // Camera
  const camera = new THREE.PerspectiveCamera(65, W / H, 0.1, 100)
  camera.position.set(10, 11, 20)
  camera.lookAt(0, 0, 0)

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(W, H)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  container.appendChild(renderer.domElement)

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.5
  controls.minDistance = 5
  controls.maxDistance = 100
  controls.maxPolarAngle = Math.PI / 2.2
  controls.target.set(0, 0, 0)

  // ── Lights ──
  const ambient = new THREE.AmbientLight(0x2a3a5a, 1.2)
  scene.add(ambient)

  const dirLight = new THREE.DirectionalLight(0x4dd0e1, 0.7)
  dirLight.position.set(10, 15, 5)
  dirLight.castShadow = true
  dirLight.shadow.mapSize.set(1024, 1024)
  dirLight.shadow.camera.near = 0.5
  dirLight.shadow.camera.far = 60
  dirLight.shadow.camera.left = -15
  dirLight.shadow.camera.right = 15
  dirLight.shadow.camera.top = 15
  dirLight.shadow.camera.bottom = -15
  scene.add(dirLight)

  // ══════════════════════════════════════════════════════════════
  // Ground + Glow Rings
  // ══════════════════════════════════════════════════════════════
  const groundGeo = new THREE.PlaneGeometry(50, 50)
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x102030, roughness: 0.6, metalness: 0.2 })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.05
  ground.receiveShadow = true
  scene.add(ground)

  // Subtle dot grid on ground for depth perception
  const dotsGeo = new THREE.BufferGeometry()
  const dotsCount = 600
  const dotsArr = new Float32Array(dotsCount * 3)
  for (let i = 0; i < dotsCount; i++) {
    dotsArr[i * 3] = (Math.random() - 0.5) * 40
    dotsArr[i * 3 + 1] = 0.02
    dotsArr[i * 3 + 2] = (Math.random() - 0.5) * 40
  }
  dotsGeo.setAttribute('position', new THREE.BufferAttribute(dotsArr, 3))
  const dotsMat = new THREE.PointsMaterial({ color: 0x2a4a6a, size: 0.08, transparent: true, opacity: 0.5, depthWrite: false })
  const dots = new THREE.Points(dotsGeo, dotsMat)
  scene.add(dots)


  // ══════════════════════════════════════════════════════════════
  // Hex base + glow helpers
  // ══════════════════════════════════════════════════════════════
  function createHexBase(color, status) {
    const geo = new THREE.CylinderGeometry(0.5, 0.55, 0.15, 6)
    const on = status === 1 || status === 3
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.2, metalness: 0.8, emissive: on ? color : 0x000000, emissiveIntensity: status === 3 ? 1.0 : status === 1 ? 0.8 : 0 })
    const base = new THREE.Mesh(geo, mat)
    base.position.y = 0.07
    base.castShadow = true
    base.receiveShadow = true
    base.name = 'hexBase'
    return base
  }

  function createBaseGlow(color, status) {
    const geo = new THREE.RingGeometry(0.5, 0.75, 32)
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: status === 3 ? 0.6 : status === 1 ? 0.5 : 0.05, depthWrite: false })
    const glow = new THREE.Mesh(geo, mat)
    glow.rotation.x = -Math.PI / 2
    glow.position.y = 0.02
    glow.name = 'baseGlow'
    return glow
  }

  // ══════════════════════════════════════════════════════════════
  // Streetlight 3D model (scaled up 2x for visibility)
  // ══════════════════════════════════════════════════════════════
  // lightState: 'on' | 'off' | 'alarm'
  function createStreetlight(baseColor, ringColor, status, lightState) {
    const group = new THREE.Group()

    const base = createHexBase(baseColor, status)
    group.add(base)
    group.add(createBaseGlow(ringColor, status))

    // Pole
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 4, 8)
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a6a7a, roughness: 0.3, metalness: 0.9 })
    const pole = new THREE.Mesh(poleGeo, poleMat)
    pole.position.y = 2
    pole.castShadow = true
    group.add(pole)

    // Lamp arm
    const armGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6)
    const armMat = new THREE.MeshStandardMaterial({ color: 0x7a8a9a, roughness: 0.25, metalness: 0.7 })
    const arm = new THREE.Mesh(armGeo, armMat)
    arm.rotation.z = Math.PI / 2
    arm.position.set(0.35, 3.8, 0)
    group.add(arm)

    // Lamp housing
    const housingGeo = new THREE.CylinderGeometry(0.2, 0.25, 0.45, 8)
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x6a7a8a, roughness: 0.25, metalness: 0.6 })
    const housing = new THREE.Mesh(housingGeo, housingMat)
    housing.position.set(0.65, 3.65, 0)
    housing.castShadow = true
    group.add(housing)

    // Bulb — driven by lightState
    const bulbCfg = lightState === 'alarm' ? BULB_ALARM : lightState === 'on' ? BULB_ON : BULB_OFF
    const bulbGeo = new THREE.SphereGeometry(0.15, 16, 16)
    const bulbMat = new THREE.MeshStandardMaterial({ color: bulbCfg.color, emissive: bulbCfg.emissive > 0 ? bulbCfg.color : 0x000000, emissiveIntensity: bulbCfg.emissive, roughness: 0.08 })
    const bulb = new THREE.Mesh(bulbGeo, bulbMat)
    bulb.position.set(0.65, 3.4, 0)
    bulb.name = 'bulb'
    group.add(bulb)

    // PointLight — driven by lightState
    const ptColor = lightState === 'alarm' ? 0xef5350 : lightState === 'on' ? 0xfff8e7 : 0x000000
    const ptLight = new THREE.PointLight(ptColor, lightState === 'off' ? 0 : 8, 14, 0.5)
    ptLight.position.copy(bulb.position)
    ptLight.name = 'ptLight'
    group.add(ptLight)

    // Ground light disk — driven by lightState
    const diskGeo = new THREE.CircleGeometry(0.7, 24)
    const diskColor = lightState === 'alarm' ? 0xef5350 : lightState === 'on' ? 0xfff8e7 : 0x000000
    const diskMat = new THREE.MeshBasicMaterial({ color: diskColor, transparent: true, opacity: bulbCfg.diskOpacity, depthWrite: false })
    const disk = new THREE.Mesh(diskGeo, diskMat)
    disk.rotation.x = -Math.PI / 2
    disk.position.y = 0.04
    disk.name = 'lightDisk'
    group.add(disk)

    // Light beam cone — only when ON
    if (lightState === 'on') {
      const beamGeo = new THREE.CylinderGeometry(0.05, 0.45, 3.3, 16, 1, true)
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff8e7, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide })
      const beam = new THREE.Mesh(beamGeo, beamMat)
      beam.position.set(0.65, 1.75, 0)
      beam.name = 'beam'
      group.add(beam)
    }

    return group
  }

  // ══════════════════════════════════════════════════════════════
  // Color maps
  // ══════════════════════════════════════════════════════════════
  const deviceObjectMap = new Map()
  const areaGroups = new Map()
  let layoutLock = false  // 防止 layoutDevices 并发重入
  const areaPlatformMap = new Map()
  let connectionLines = []
  let areaMarkerRings = []
  let blockObjects = []   // 城市布局元素（道路、建筑、标线）
  // Camera fly-to state
  let flyTarget = null
  let flyStartPos = null
  let flyStartLookAt = null
  let flyStartTime = 0
  const FLY_DURATION = 800

  const STATUS_3D  = { 1: 0x4dd0e1, 2: 0x708090, 3: 0xef5350, 0: 0x404050 }  // hex base
  const RING_3D    = { 1: 0x4dd0e1, 2: 0xff4444, 3: 0xef5350, 0: 0x404050 }  // bottom ring: offline=RED
  const BULB_ON    = { color: 0xffffff, emissive: 12, diskOpacity: 0.45 }       // light ON (增强俯瞰可见度)
  const BULB_OFF   = { color: 0x111111, emissive: 0, diskOpacity: 0 }           // light OFF
  const BULB_ALARM = { color: 0xef5350, emissive: 2.5, diskOpacity: 0.22 }      // alarm

  // 区域高亮动画预分配颜色对象（避免每帧 GC）
  const AREA_PULSE_COL_LO = new THREE.Color(0x1a4a6a)  // 暗蓝
  const AREA_PULSE_COL_HI = new THREE.Color(0x4dd0e1)  // 亮青
  const AREA_PULSE_COL_TMP = new THREE.Color()          // 临时插值结果

  // Determine light state: controlStateStore > latestData.action > illuminance > default
  function getLightState(device) {
    const s = device.status != null ? device.status : 2
    if (s === 3) return 'alarm'
    if (s !== 1) return 'off'
    // 0) 控制状态缓存（最近一次控制指令，比 API latestData 更实时）
    const cached = getControlState(device.deviceId)
    if (cached && (Date.now() - cached.time < 120000)) {
      return (cached.action === 'OFF' || cached.brightness === 0) ? 'off' : 'on'
    }
    // 1) latestData.action (from API — the authoritative source)
    const data = parseLatestData(device.latestData)
    if (data?.action) {
      if (data.action === 'OFF' || data.brightness === 0) return 'off'
      return 'on'
    }
    // 2) Illuminance guess
    if (data?.illuminance != null) {
      return data.illuminance > 80 ? 'on' : 'off'
    }
    // 3) Default: online with no data → ON
    return 'on'
  }

  // Apply light state to a device's visual elements
  function applyLightState(entry, ls) {
    const bulbCfg = ls === 'alarm' ? BULB_ALARM : ls === 'on' ? BULB_ON : BULB_OFF
    const bulbCol = new THREE.Color(bulbCfg.color)
    if (entry.bulb) {
      entry.bulb.material.color.set(bulbCol)
      entry.bulb.material.emissive.set(bulbCfg.emissive > 0 ? bulbCol : new THREE.Color(0x000000))
      entry.bulb.material.emissiveIntensity = bulbCfg.emissive
    }
    const ptCol = ls === 'alarm' ? 0xef5350 : ls === 'on' ? 0xfff8e7 : 0x000000
    if (entry.ptLight) { entry.ptLight.color.setHex(ptCol); entry.ptLight.intensity = ls === 'off' ? 0 : 8 }
    const dkCol = ls === 'alarm' ? 0xef5350 : ls === 'on' ? 0xfff8e7 : 0x000000
    if (entry.disk) { entry.disk.material.color.setHex(dkCol); entry.disk.material.opacity = bulbCfg.diskOpacity }

    let beam = entry.group.children.find(c => c.name === 'beam')
    if (ls === 'on' && !beam) {
      const beamGeo = new THREE.CylinderGeometry(0.05, 0.45, 3.3, 16, 1, true)
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff8e7, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide })
      beam = new THREE.Mesh(beamGeo, beamMat)
      beam.position.set(0.65, 1.75, 0)
      beam.name = 'beam'
      entry.group.add(beam)
    } else if (ls !== 'on' && beam) {
      beam.geometry.dispose(); beam.material.dispose(); entry.group.remove(beam)
    }
  }

  function clearConnections() {
    connectionLines.forEach(l => { l.geometry.dispose(); scene.remove(l) })
    connectionLines = []
  }

  function drawConnections() {
    clearConnections()
    const mat = new THREE.LineBasicMaterial({ color: 0x4dd0e1, transparent: true, opacity: 0.28, depthWrite: false, linewidth: 1 })
    areaGroups.forEach((info) => {
      const ids = info.deviceIds.filter(id => deviceObjectMap.has(id))
      if (ids.length < 2) return
      // Star topology: connect each to area center point
      const cx = info.center.x, cz = info.center.z
      ids.forEach(id => {
        const entry = deviceObjectMap.get(id)
        if (!entry) return
        const p = entry.group.position
        const pts = [new THREE.Vector3(p.x, 0.06, p.z), new THREE.Vector3(cx, 0.06, cz)]
        const geo = new THREE.BufferGeometry().setFromPoints(pts)
        const line = new THREE.Line(geo, mat)
        scene.add(line)
        connectionLines.push(line)
      })
    })
  }

  function makeTextSprite(text) {
    const canvas = document.createElement('canvas')
    canvas.width = 256; canvas.height = 64
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = 'rgba(0,0,0,0)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.font = 'bold 28px "Microsoft YaHei", sans-serif'
    ctx.fillStyle = '#4dd0e1'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 128, 32)
    const tex = new THREE.CanvasTexture(canvas)
    tex.minFilter = THREE.LinearFilter
    const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
    const sprite = new THREE.Sprite(spriteMat)
    sprite.scale.set(4, 1, 1)
    return sprite
  }

  const areaPlatforms = []
  const areaLabelSprites = []
  const PLATFORM_COLORS = [0x142d4a, 0x0e2440, 0x122d4f, 0x0d2244, 0x152e52, 0x102548, 0x132c4e, 0x0c2040, 0x162f54, 0x112646]

  function updateAreaMarkers() {
    areaMarkerRings.forEach(r => { r.geometry.dispose(); r.material.dispose(); scene.remove(r) })
    areaMarkerRings = []
    areaLabelSprites.forEach(s => { if (s.material.map) s.material.map.dispose(); s.material.dispose(); scene.remove(s) })
    areaLabelSprites.length = 0
    areaPlatforms.forEach(p => { p.geometry.dispose(); p.material.dispose(); scene.remove(p) })
    areaPlatforms.length = 0
    areaPlatformMap.clear()

    areaGroups.forEach((info, name) => {
      const rad = info.platformRadius || 1.0

      // Hexagonal platform base
      const pfGeo = new THREE.CylinderGeometry(rad + 0.3, rad + 0.45, 0.08, 6)
      const pfCol = PLATFORM_COLORS[info.areaIndex % PLATFORM_COLORS.length]
      const pfMat = new THREE.MeshStandardMaterial({ color: pfCol, roughness: 0.35, metalness: 0.35, emissive: pfCol, emissiveIntensity: 0.3, transparent: true, opacity: 0.55 })
      const platform = new THREE.Mesh(pfGeo, pfMat)
      platform.position.set(info.center.x, 0.04, info.center.z)
      platform.receiveShadow = true
      platform.userData = { areaName: name, isPlatform: true }
      scene.add(platform)
      areaPlatforms.push(platform)
      areaPlatformMap.set(name, platform)

      // Hex edge border
      const edgeGeo = new THREE.RingGeometry(rad + 0.25, rad + 0.35, 6)
      const edgeMat = new THREE.MeshBasicMaterial({ color: 0x3377aa, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false })
      const edge = new THREE.Mesh(edgeGeo, edgeMat)
      edge.rotation.x = -Math.PI / 2
      edge.position.set(info.center.x, 0.085, info.center.z)
      scene.add(edge)
      areaMarkerRings.push(edge)

      // Label
      const label = makeTextSprite(name)
      label.position.set(info.center.x, 1.4, info.center.z)
      label.scale.set(5, 1.3, 1)
      scene.add(label)
      areaLabelSprites.push(label)
    })
  }

  // ══════════════════════════════════════════════════════════════
  // Layout: 城市街道布局（网格化街区）
  // ══════════════════════════════════════════════════════════════
  function disposeObj(obj) {
    scene.remove(obj)
    if (obj.geometry) obj.geometry.dispose()
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose())
      else obj.material.dispose()
    }
  }

  function layoutDevices(devices) {
    if (layoutLock) { console.log('[3D] layoutDevices skipped (locked)'); return }
    layoutLock = true
    console.log('[3D] layoutDevices start:', devices?.length, 'devices, deviceObjectMap:', deviceObjectMap.size)

    // ── 销毁旧对象 ──
    deviceObjectMap.forEach(entry => { scene.remove(entry.group); entry.group.traverse(c => disposeObj(c)) })
    deviceObjectMap.clear()
    areaGroups.clear()
    if (highlightRing) { scene.remove(highlightRing); highlightRing.geometry.dispose(); highlightRing.material.dispose(); highlightRing = null }
    blockObjects.forEach(obj => disposeObj(obj))
    blockObjects = []
    connectionLines.forEach(l => { l.geometry.dispose(); scene.remove(l) })
    connectionLines = []
    areaMarkerRings.forEach(r => disposeObj(r))
    areaMarkerRings = []
    areaLabelSprites.forEach(s => { scene.remove(s); if (s.material?.map) s.material.map.dispose(); s.material.dispose() })
    areaLabelSprites.length = 0
    areaPlatforms.forEach(p => disposeObj(p))
    areaPlatforms.length = 0
    areaPlatformMap.clear()

    if (!devices || devices.length === 0) { layoutLock = false; return }

    // ── 材料预分配 ──
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x333840, roughness: 0.85, metalness: 0.1 })
    const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x3a3e46, roughness: 0.7, metalness: 0.05 })
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x151d28, roughness: 0.9, metalness: 0.1 })
    const buildMatDark = new THREE.MeshStandardMaterial({ color: 0x1e2a36, roughness: 0.35, metalness: 0.4, emissive: 0x060a10, emissiveIntensity: 0.25 })
    const buildMatLit = new THREE.MeshStandardMaterial({ color: 0x253242, roughness: 0.35, metalness: 0.4, emissive: 0x0c1520, emissiveIntensity: 0.45 })
    const dashMat = new THREE.MeshBasicMaterial({ color: 0x8899aa, transparent: true, opacity: 0.5, depthWrite: false })
    const interMat = new THREE.MeshBasicMaterial({ color: 0x4dd0e1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide })

    // ── 分组 ──
    const areaMap = new Map()
    devices.forEach(d => {
      const area = d.area || '默认区域'
      if (!areaMap.has(area)) areaMap.set(area, [])
      areaMap.get(area).push(d)
    })

    // 获取所有区域名（包含空区域）
    const allAreaNames = [...new Set([...areaMap.keys()])].sort()
    const areaCount = allAreaNames.length
    const COLS = Math.max(2, Math.ceil(Math.sqrt(areaCount * 1.4)))
    const BLOCK = 22    // 街区中心距
    const CELL = 17     // 街区内可用尺寸
    const ROAD_W = 2.4  // 道路宽度
    const BLDG_D = 1.0  // 建筑厚度
    const SW = 0.4      // 人行道宽度

    const roadGeo = new THREE.PlaneGeometry(ROAD_W, CELL - 1.5)
    const swGeo = new THREE.PlaneGeometry(SW, CELL - 1.5)
    const groundGeo = new THREE.PlaneGeometry(CELL, CELL)

    function simpleHash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0; return Math.abs(h) }

    allAreaNames.forEach((areaName, idx) => {
      const row = Math.floor(idx / COLS)
      const col = idx % COLS
      const cx = (col - (COLS - 1) / 2) * BLOCK
      const cz = (row - (Math.max(0, areaCount - 1) / COLS / 2)) * BLOCK

      const areaDevices = areaMap.get(areaName) || []
      const n = areaDevices.length

      // ── 地面 ──
      const ground = new THREE.Mesh(groundGeo, groundMat)
      ground.rotation.x = -Math.PI / 2; ground.position.set(cx, 0.01, cz)
      ground.receiveShadow = true; ground.userData = { areaName, isPlatform: true }
      scene.add(ground); areaPlatforms.push(ground); areaPlatformMap.set(areaName, ground); blockObjects.push(ground)

      // ── 道路 ──
      const road = new THREE.Mesh(roadGeo, roadMat)
      road.rotation.x = -Math.PI / 2; road.position.set(cx, 0.025, cz)
      road.receiveShadow = true
      scene.add(road); blockObjects.push(road)

      // ── 人行道 ──
      for (let s = -1; s <= 1; s += 2) {
        const swMesh = new THREE.Mesh(swGeo, sidewalkMat)
        swMesh.rotation.x = -Math.PI / 2; swMesh.position.set(cx + s * (ROAD_W / 2 + SW / 2), 0.02, cz)
        swMesh.receiveShadow = true
        scene.add(swMesh); blockObjects.push(swMesh)
      }

      // ── 虚线标线 ──
      for (let dz = -CELL / 2 + 1.5; dz < CELL / 2; dz += 1.8) {
        const dGeo = new THREE.PlaneGeometry(0.07, 0.7)
        const dash = new THREE.Mesh(dGeo, dashMat)
        dash.rotation.x = -Math.PI / 2; dash.position.set(cx, 0.031, cz + dz)
        scene.add(dash); blockObjects.push(dash)
      }

      // ── 建筑 ──
      const buildCount = Math.max(4, Math.min(14, n * 2 + 2))
      const buildSpacing = (CELL - 2.5) / buildCount
      const buildMat = n > 0 ? buildMatLit : buildMatDark

      for (let s = -1; s <= 1; s += 2) {
        const bx = cx + s * (ROAD_W / 2 + SW + BLDG_D / 2)
        for (let b = 0; b < buildCount; b++) {
          const bz = cz - CELL / 2 + 1.5 + b * buildSpacing
          const seed = simpleHash(areaName + s + b)
          const bw = buildSpacing * (0.55 + (seed % 40) / 100)
          const bh = 2.0 + (seed % 70) / 100 * 5.0
          const bGeo = new THREE.BoxGeometry(BLDG_D, bh, bw)
          const bldg = new THREE.Mesh(bGeo, buildMat)
          bldg.position.set(bx, bh / 2, bz)
          bldg.castShadow = true; bldg.receiveShadow = true
          scene.add(bldg); blockObjects.push(bldg)
        }
      }

      // ── 路灯 ──
      if (n > 0) {
        const lightSpacing = Math.max(2.2, (CELL - 2.5) / Math.max(1, n))
        const startZ = cz - (n - 1) * lightSpacing / 2
        areaDevices.forEach((d, i) => {
          const side = i % 2 === 0 ? 1 : -1
          const lx = cx + side * (ROAD_W / 2 + 0.12)
          const lz = startZ + i * lightSpacing
          const s = d.status != null ? d.status : 2
          const ls = getLightState(d)
          const baseColor = STATUS_3D[s] || 0x4a5a6a
          const ringColor = RING_3D[s] || 0x4a5a6a
          const group = createStreetlight(baseColor, ringColor, s, ls)
          group.position.set(lx, 0, lz)
          group.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2
          group.userData = { deviceId: d.deviceId, deviceName: d.name, area: areaName, status: s, lightState: ls }
          scene.add(group)
          deviceObjectMap.set(d.deviceId, {
            group,
            base: group.children.find(c => c.name === 'hexBase'),
            baseGlow: group.children.find(c => c.name === 'baseGlow'),
            bulb: group.children.find(c => c.name === 'bulb'),
            ptLight: group.children.find(c => c.name === 'ptLight'),
            disk: group.children.find(c => c.name === 'lightDisk'),
            beam: group.children.find(c => c.name === 'beam'),
          })
        })
      }

      // ── 路牌（悬浮在道路中央上方）──
      const label = makeTextSprite(areaName)
      label.position.set(cx, 1.6, cz)
      label.scale.set(5.5, 1.4, 1)
      scene.add(label); areaLabelSprites.push(label)

      // ── 路口标记 ──
      const interGeo = new THREE.CircleGeometry(0.45, 16)
      const inter = new THREE.Mesh(interGeo, interMat)
      inter.rotation.x = -Math.PI / 2; inter.position.set(cx, 0.035, cz)
      inter.userData = { areaName, isIntersection: true }
      scene.add(inter); areaMarkerRings.push(inter); blockObjects.push(inter)

      areaGroups.set(areaName, {
        center: { x: cx, z: cz },
        deviceIds: areaDevices.map(d => d.deviceId),
        platformRadius: CELL / 2,
        areaIndex: idx,
      })
    })

    threeDeviceStats.value = {
      count: devices.length,
      online: devices.filter(d => d.status === 1).length,
      alarm: devices.filter(d => d.status === 3).length,
    }
    if (selectedArea.value) { applyAreaHighlight(selectedArea.value) }
    console.log('[3D] layoutDevices done, deviceObjectMap:', deviceObjectMap.size, 'areaGroups:', areaGroups.size)

    // 自适应相机：覆盖整个城市
    const gridW = COLS * BLOCK
    const gridD = Math.ceil(areaCount / COLS) * BLOCK
    const viewDist = Math.max(gridW, gridD, 20) * 0.55
    camera.position.set(viewDist * 0.5, viewDist * 0.7, viewDist * 0.7)
    controls.target.set(0, 0, 0)
    controls.update()

    layoutLock = false
  }

  // ══════════════════════════════════════════════════════════════
  // syncDevices: diff-based add/remove/status update
  // ══════════════════════════════════════════════════════════════
  function syncDevices(newDevices) {
    if (!newDevices || newDevices.length === 0) return

    const newIds = new Set(newDevices.map(d => d.deviceId))
    const oldIds = new Set(deviceObjectMap.keys())

    // Remove deleted
    for (const id of oldIds) {
      if (!newIds.has(id)) {
        const entry = deviceObjectMap.get(id)
        scene.remove(entry.group)
        entry.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) { if (Array.isArray(c.material)) c.material.forEach(m => m.dispose()); else c.material.dispose() } })
        deviceObjectMap.delete(id)
      }
    }

    // Check if re-layout needed (new devices or area change)
    let needRelayout = false
    for (const d of newDevices) {
      if (!deviceObjectMap.has(d.deviceId)) {
        console.log('[3D] syncDevices: needRelayout — new device:', d.deviceId)
        needRelayout = true; break
      }
      const ex = deviceObjectMap.get(d.deviceId)
      const apiArea = d.area || '默认区域'
      if (ex.group.userData.area !== apiArea) {
        console.log('[3D] syncDevices: needRelayout — area changed:', d.deviceId, ex.group.userData.area, '→', apiArea)
        needRelayout = true; break
      }
    }

    if (needRelayout) {
      layoutDevices(newDevices)
      return
    }

    // Status-only update
    for (const d of newDevices) {
      const entry = deviceObjectMap.get(d.deviceId)
      if (!entry) continue
      const s = d.status != null ? d.status : 2
      const ls = getLightState(d)
      entry.group.userData.status = s
      entry.group.userData.lightState = ls
      const e = s === 1 || s === 3
      const baseHex  = new THREE.Color(STATUS_3D[s] || 0x4a5a6a)
      const ringHex  = new THREE.Color(RING_3D[s] || 0x4a5a6a)
      if (entry.base)  { entry.base.material.color.set(baseHex); entry.base.material.emissive.set(e ? baseHex : new THREE.Color(0x000000)); entry.base.material.emissiveIntensity = s === 3 ? 1.0 : s === 1 ? 0.8 : 0 }
      if (entry.baseGlow) { entry.baseGlow.material.color.set(ringHex); entry.baseGlow.material.opacity = s === 3 ? 0.6 : s === 1 ? 0.5 : s === 2 ? 0.35 : 0.05 }
      // Bulb / light / disk / beam — driven by lightState
      applyLightState(entry, ls)
      // 自定义亮度仅在 API 状态一致时保留微调值，否则清除
      if (entry.group.userData._customBrightness != null) {
        const b = entry.group.userData._customBrightness
        const isCustomOff = b === 0
        if ((ls === 'off' && isCustomOff) || (ls === 'on' && !isCustomOff)) {
          // 状态一致：仅微调亮度强度
          const factor = b / 100
          if (entry.ptLight) entry.ptLight.intensity = isCustomOff ? 0 : 8 * factor
          if (entry.disk) entry.disk.material.opacity = isCustomOff ? 0 : 0.45 * factor
          if (entry.bulb) entry.bulb.material.emissiveIntensity = isCustomOff ? 0 : 12 * factor
          if (entry.base) { entry.base.material.emissiveIntensity = isCustomOff ? 0 : 1.0; entry.base.material.opacity = isCustomOff ? 0.25 : 1.0 }
          if (entry.baseGlow) { entry.baseGlow.material.opacity = isCustomOff ? 0 : 0.6 }
        } else {
          // API 状态已变化，清除过期自定义亮度
          delete entry.group.userData._customBrightness
        }
      }
    }

    // Re-apply area highlight after status updates
    if (selectedArea.value) { applyAreaHighlight(selectedArea.value) }

    threeDeviceStats.value = {
      count: newDevices.length,
      online: newDevices.filter(d => d.status === 1).length,
      alarm: newDevices.filter(d => d.status === 3).length,
    }
  }

  // 从 latestData 同步所有设备的灯光状态（无需额外 API 调用）
  function syncLightStates(devices) {
    const devMap = new Map(devices.map(d => [d.deviceId, d]))
    deviceObjectMap.forEach((entry, id) => {
      const d = devMap.get(id)
      if (!d) return
      const ls = getLightState(d)
      if (ls !== entry.group.userData.lightState) {
        entry.group.userData.lightState = ls
        applyLightState(entry, ls)
      }
    })
  }

  // Camera fly-to helpers
  function startFly(targetPos, targetLookAt) {
    controls.autoRotate = false
    flyStartPos = camera.position.clone()
    flyStartLookAt = controls.target.clone()
    flyTarget = { pos: targetPos.clone(), lookAt: targetLookAt.clone() }
    flyStartTime = performance.now()
  }
  function flyToArea(areaName) {
    const info = areaGroups.get(areaName)
    if (!info) { console.warn('[3D] flyToArea: area not found:', areaName, 'available:', [...areaGroups.keys()]); return }
    console.log('[3D] flyToArea:', areaName)
    const targetPos = new THREE.Vector3(info.center.x + 5, 8, info.center.z + 8)
    const targetLookAt = new THREE.Vector3(info.center.x, 0, info.center.z)
    startFly(targetPos, targetLookAt)
  }
  function flyToDevice(deviceId) {
    const entry = deviceObjectMap.get(deviceId)
    if (!entry) return
    const p = entry.group.position
    const targetPos = new THREE.Vector3(p.x + 2, p.y + 3, p.z + 3)
    const targetLookAt = new THREE.Vector3(p.x, p.y + 1, p.z)
    startFly(targetPos, targetLookAt)
  }
  // Module-level flyToArea wrapper (for bar chart click)
  flyToArea3D = (areaName) => { flyToArea(areaName) }

  // Device highlight ring (3D white glow)
  let highlightRing = null
  function highlightDevice3D(deviceId) {
    if (highlightRing) {
      scene.remove(highlightRing)
      highlightRing.geometry.dispose()
      highlightRing.material.dispose()
      highlightRing = null
    }
    if (!deviceId) return
    const entry = deviceObjectMap.get(deviceId)
    if (!entry) return
    const pos = entry.group.position
    const ringGeo = new THREE.TorusGeometry(0.55, 0.05, 16, 24)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false })
    highlightRing = new THREE.Mesh(ringGeo, ringMat)
    highlightRing.rotation.x = -Math.PI / 2
    highlightRing.position.set(pos.x, 0.08, pos.z)
    highlightRing.name = 'highlightRing'
    scene.add(highlightRing)
  }
  highlight3D = (id) => { highlightDevice3D(id) }

  // Device light control (brightness → 3D bulb + base intensity)
  function applyDeviceBrightness(deviceId, brightness) {
    const entry = deviceObjectMap.get(deviceId)
    if (!entry) { console.warn('[3D] device not found:', deviceId); return }
    const pct = Math.max(0, Math.min(100, brightness))
    entry.group.userData._customBrightness = pct
    const isOff = pct === 0
    entry.group.userData.lightState = isOff ? 'off' : 'on'
    applyLightState(entry, isOff ? 'off' : 'on')
    // Scale pointlight/disk/bulb by brightness
    const factor = pct / 100
    if (entry.ptLight) { entry.ptLight.intensity = isOff ? 0 : 8 * factor }
    if (entry.disk) { entry.disk.material.opacity = isOff ? 0 : 0.45 * factor }
    if (entry.bulb) { entry.bulb.material.emissiveIntensity = isOff ? 0 : 12 * factor }
    // Also dim base hex when off (user-visible feedback)
    if (entry.base) {
      entry.base.material.emissiveIntensity = isOff ? 0 : 1.0
      entry.base.material.opacity = isOff ? 0.25 : 1.0
    }
    if (entry.baseGlow) {
      entry.baseGlow.material.opacity = isOff ? 0 : 0.6
    }
    console.log('[3D] applyDeviceBrightness:', deviceId, '→', pct + '%', 'isOff:', isOff,
      'bulb.emissiveIntensity:', entry.bulb?.material.emissiveIntensity,
      'ptLight.intensity:', entry.ptLight?.intensity,
      'disk.opacity:', entry.disk?.material.opacity)
    // 强制渲染一帧，确保材质变更立即可见
    if (viewMode.value === '3d') renderer.render(scene, camera)
  }
  applyDeviceBrightness3D = (deviceId, brightness) => applyDeviceBrightness(deviceId, brightness)

  // 订阅跨标签页控制变更 → 立即更新 3D 场景
  let unsubControl = onControlChange((deviceId, action, brightness) => {
    const bVal = action === 'OFF' ? 0 : (brightness != null ? brightness : 100)
    applyDeviceBrightness(deviceId, bVal)
  })

  // 订阅同窗口 ManualControlModal 控制变更 → 立即更新 3D 场景
  function onManualStateChange(e) {
    const { deviceId, action, brightness } = e.detail || {}
    if (!deviceId || !action) return
    const bVal = action === 'OFF' ? 0 : (brightness != null ? brightness : 100)
    setControlState(deviceId, action, bVal)
    applyDeviceBrightness(deviceId, bVal)
  }
  window.addEventListener('manual-control-state-change', onManualStateChange)

  // Replace single device: destroy old → create new with correct state
  // deviceData (optional): fresh API device object including latestData
  function replaceSingleDevice(deviceId, brightness, deviceData) {
    const oldEntry = deviceObjectMap.get(deviceId)
    if (!oldEntry) { console.warn('[3D] replaceDevice: not found:', deviceId); return }
    const pos = oldEntry.group.position.clone()
    const area = oldEntry.group.userData.area
    // Dispose old
    scene.remove(oldEntry.group)
    oldEntry.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) { if (Array.isArray(c.material)) c.material.forEach(m => m.dispose()); else c.material.dispose() } })
    deviceObjectMap.delete(deviceId)
    // Use fresh deviceData if provided, else construct from old userData
    const d = deviceData || { deviceId, name: oldEntry.group.userData.deviceName || deviceId, area, status: oldEntry.group.userData.status }
    const s = d.status != null ? d.status : 2
    const ls = getLightState(d)
    const baseColor = STATUS_3D[s] || 0x4a5a6a
    const ringColor = RING_3D[s] || 0x4a5a6a
    const group = createStreetlight(baseColor, ringColor, s, ls)
    group.position.copy(pos)
    group.userData = { deviceId, deviceName: d.name || deviceId, area, status: s, lightState: ls, _customBrightness: brightness }
    scene.add(group)
    deviceObjectMap.set(deviceId, {
      group,
      base: group.children.find(c => c.name === 'hexBase'),
      baseGlow: group.children.find(c => c.name === 'baseGlow'),
      bulb: group.children.find(c => c.name === 'bulb'),
      ptLight: group.children.find(c => c.name === 'ptLight'),
      disk: group.children.find(c => c.name === 'lightDisk'),
      beam: group.children.find(c => c.name === 'beam'),
    })

    // Post-creation brightness adjustments
    const newEntry = deviceObjectMap.get(deviceId)
    if (!newEntry) return
    if (ls === 'off') {
      if (newEntry.base?.material) { newEntry.base.material.emissiveIntensity = 0; newEntry.base.material.opacity = 0.25 }
      if (newEntry.baseGlow) newEntry.baseGlow.material.opacity = 0
      if (newEntry.ptLight) newEntry.ptLight.intensity = 0
    } else if (brightness != null && brightness >= 0 && brightness < 100) {
      const factor = brightness / 100
      if (newEntry.ptLight) newEntry.ptLight.intensity = 8 * factor
      if (newEntry.disk) newEntry.disk.material.opacity = 0.45 * factor
      if (newEntry.bulb) newEntry.bulb.material.emissiveIntensity = 12 * factor
    }
    // Force immediate render
    if (viewMode.value === '3d') renderer.render(scene, camera)
  }
  setDeviceLight3D = (deviceId, brightness) => { replaceSingleDevice(deviceId, brightness) }

  // Area highlight: dim non-selected areas, boost selected area
  function applyAreaHighlight(areaName) {
    deviceObjectMap.forEach((entry) => {
      const isSelected = areaName && entry.group.userData.area === areaName
      if (areaName && !isSelected) {
        // 非选中区域：大幅度压暗
        if (entry.base) {
          entry.base.material.emissiveIntensity = 0
          entry.base.material.opacity = 0.15
          entry.base.material.color.set(0x1a2a3a)
        }
        if (entry.baseGlow) entry.baseGlow.material.opacity = 0
        if (entry.bulb) { entry.bulb.material.emissiveIntensity = 0; entry.bulb.material.color.set(0x1a1a1a) }
        if (entry.ptLight) { entry.ptLight.intensity = 0; entry.ptLight.color.setHex(0x000000) }
        if (entry.disk) entry.disk.material.opacity = 0
        // 移除光束
        const beam = entry.group.children.find(c => c.name === 'beam')
        if (beam) { beam.geometry.dispose(); beam.material.dispose(); entry.group.remove(beam) }
      } else {
        // 选中区域或无筛选：恢复正常
        const ls = entry.group.userData.lightState
        applyLightState(entry, ls)
        // 选中区域设备底座额外提亮
        if (areaName && isSelected && entry.base) {
          entry.base.material.emissiveIntensity = entry.group.userData.status === 3 ? 1.5 : 1.4
          entry.base.material.opacity = 1.0
        }
        if (areaName && isSelected && entry.baseGlow) {
          entry.baseGlow.material.opacity = entry.group.userData.status === 3 ? 0.9 : 0.75
        }
        // Re-apply custom brightness (including base)
        if (entry.group.userData._customBrightness != null) {
          const b = entry.group.userData._customBrightness
          const isOff = b === 0
          if (entry.base) { entry.base.material.emissiveIntensity = isOff ? 0 : (areaName && isSelected ? 1.4 : 1.0); entry.base.material.opacity = isOff ? 0.25 : 1.0 }
          if (entry.baseGlow) { entry.baseGlow.material.opacity = isOff ? 0 : (areaName && isSelected ? 0.75 : 0.6) }
          if (!isOff && ls === 'on') {
            const factor = b / 100
            if (entry.ptLight) entry.ptLight.intensity = 8 * factor
            if (entry.disk) entry.disk.material.opacity = 0.45 * factor
            if (entry.bulb) entry.bulb.material.emissiveIntensity = 12 * factor
          }
        }
      }
    })
    // 区域平台：选中高亮，未选中暗化
    areaPlatformMap.forEach((plat, name) => {
      if (areaName && name === areaName) {
        plat.material.emissiveIntensity = 1.2
        plat.material.opacity = 0.9
        plat.material.color.set(0x1a4a6a)
      } else {
        plat.material.emissiveIntensity = 0.1
        plat.material.opacity = areaName ? 0.12 : 0.55
        plat.material.color.set(0x0a1528)
      }
    })
    // 强制渲染
    if (viewMode.value === '3d') renderer.render(scene, camera)
  }
  highlightArea3D = (areaName) => { applyAreaHighlight(areaName) }

  // 设备同步：优先增量 diff 更新，首次/重排时走全量 layout
  syncDevices3D = (devs) => {
    syncDevices(devs)
  }
  // 全量重建设备（控制指令后使用）
  rebuildScene3D = (devs) => {
    layoutDevices(devs)
  }
  // 俯瞰视角：相机飞到城市正上方
  flyToOverview3D = () => {
    const gridW = areaGroups.size > 0 ? Math.ceil(Math.sqrt([...areaGroups.keys()].length * 1.4)) * 22 : 40
    const h = Math.max(gridW * 0.65, 25)
    startFly(new THREE.Vector3(0, h, h * 0.15), new THREE.Vector3(0, 0, 0))
  }

  // Scene self-loads devices: 有预加载数据则同步使用，否则异步拉取
  if (preloadedDevices && preloadedDevices.length > 0) {
    layoutDevices(preloadedDevices)
  } else {
    fetchAllDevicesForMap().then(raw => {
      const devs = Array.isArray(raw) ? raw : (raw?.data || raw?.records || [])
      if (devs.length > 0) {
        if (deviceObjectMap.size === 0) {
          layoutDevices(devs)
        } else {
          syncDevices(devs)
        }
      }
    }).catch((e) => { console.warn('3D设备加载失败:', e) })
  }

  // ══════════════════════════════════════════════════════════════
  // Particles (3-layer)
  // ══════════════════════════════════════════════════════════════
  const particlesGroup = new THREE.Group()
  for (let ring = 0; ring < 3; ring++) {
    const pGeo = new THREE.BufferGeometry()
    const n = 90
    const arr = new Float32Array(n * 3)
    const r = 10 + ring * 2.5
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 1.2
      const rr = r + (Math.random() - 0.5) * 1.2
      arr[i * 3] = Math.cos(a) * rr
      arr[i * 3 + 1] = 0.5 + ring * 0.6 + (Math.random() - 0.5) * 0.8
      arr[i * 3 + 2] = Math.sin(a) * rr
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    const pMat = new THREE.PointsMaterial({ color: 0x4dd0e1, size: 0.055, transparent: true, opacity: 0.4 - ring * 0.08, blending: THREE.AdditiveBlending, depthWrite: false })
    particlesGroup.add(new THREE.Points(pGeo, pMat))
  }
  scene.add(particlesGroup)

  // ══════════════════════════════════════════════════════════════
  // Animation loop
  // ══════════════════════════════════════════════════════════════
  let animating = true
  let lastTime = performance.now()
  function animate() {
    if (!animating) return
    requestAnimationFrame(animate)
    if (viewMode.value !== '3d') return
    const now = performance.now()
    const dt = Math.min((now - lastTime) / 1000, 0.1)
    lastTime = now
    controls.update()

    // Camera fly-to animation (ease-out cubic)
    if (flyTarget) {
      const elapsed = now - flyStartTime
      const t = Math.min(elapsed / FLY_DURATION, 1.0)
      const ease = 1 - Math.pow(1 - t, 3)
      camera.position.lerpVectors(flyStartPos, flyTarget.pos, ease)
      controls.target.lerpVectors(flyStartLookAt, flyTarget.lookAt, ease)
      if (t >= 1.0) { flyTarget = null; controls.autoRotate = true }
    }

    particlesGroup.children.forEach((p, i) => {
      p.rotation.y += dt * (0.12 + i * 0.04) * (i % 2 === 0 ? 1 : -0.7)
    })

    // Alarm pulsing
    deviceObjectMap.forEach(entry => {
      if (entry.group.userData.status === 3) {
        const wave = 1.2 + Math.sin(Date.now() * 0.008) * 1.3
        if (entry.ptLight) entry.ptLight.intensity = wave
        if (entry.bulb) entry.bulb.material.emissiveIntensity = 1.2 + Math.sin(Date.now() * 0.008) * 1.5
        if (entry.base) entry.base.material.emissiveIntensity = 0.4 + Math.sin(Date.now() * 0.008) * 0.35
        if (entry.baseGlow) entry.baseGlow.material.opacity = 0.3 + Math.sin(Date.now() * 0.008) * 0.25
      }
    })

    // 选中区域底座呼吸闪烁
    if (selectedArea.value) {
      const t = Date.now() * 0.005
      const selWave = 0.25 + Math.sin(t) * 0.75          // 0.25 ~ 1.0 光环
      const emissiveWave = 0.6 + Math.sin(t) * 0.9       // 0.6 ~ 1.5 底座发光强度
      const lerp = 0.3 + Math.sin(t) * 0.7               // 颜色插值因子
      AREA_PULSE_COL_TMP.lerpColors(AREA_PULSE_COL_LO, AREA_PULSE_COL_HI, lerp)
      deviceObjectMap.forEach(entry => {
        if (entry.group.userData.area === selectedArea.value) {
          if (entry.baseGlow) entry.baseGlow.material.opacity = selWave
          if (entry.base && entry.group.userData.status !== 3) {
            entry.base.material.emissiveIntensity = emissiveWave
            entry.base.material.emissive.copy(AREA_PULSE_COL_TMP)
          }
        }
      })
    }

    // Highlight ring pulse
    if (highlightRing) {
      const s = 0.85 + Math.sin(Date.now() * 0.006) * 0.15
      highlightRing.scale.set(s, s, 1)
      highlightRing.material.opacity = 0.4 + Math.sin(Date.now() * 0.006) * 0.3
    }

    renderer.render(scene, camera)
  }
  animate()

  // ══════════════════════════════════════════════════════════════
  // Resize
  // ══════════════════════════════════════════════════════════════
  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth
    const h = container.clientHeight
    if (w === 0 || h === 0) return
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  })
  resizeObserver.observe(container)

  // ══════════════════════════════════════════════════════════════
  // Click handler
  // ══════════════════════════════════════════════════════════════
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  function onClick(event) {
    const rect = renderer.domElement.getBoundingClientRect()
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(mouse, camera)

    // 1) Check area platforms first
    const platMeshes = [...areaPlatformMap.values()]
    const platIntersects = raycaster.intersectObjects(platMeshes)
    if (platIntersects.length > 0) {
      const areaName = platIntersects[0].object.userData?.areaName
      if (areaName) {
        flyToArea(areaName)
        dismissPopup()
        return
      }
    }

    // 2) Check device groups
    const allGroups = [...deviceObjectMap.values()].map(e => e.group)
    const intersects = raycaster.intersectObjects(allGroups, true)
    if (intersects.length > 0) {
      let obj = intersects[0].object
      while (obj && !allGroups.includes(obj)) obj = obj.parent
      if (obj) {
        const d = obj.userData
        if (d.deviceId) {
          showDevicePopup(d)
          highlightDeviceId.value = d.deviceId
          selectedArea.value = ''
          flyToDevice(d.deviceId)
        }
      } else {
        dismissPopup()
      }
    }
  }
  renderer.domElement.addEventListener('click', onClick)

  // Hover detection
  function onMouseMove(event) {
    const rect = renderer.domElement.getBoundingClientRect()
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(mouse, camera)

    // Check area platform hover (cursor pointer)
    const platMeshes = [...areaPlatformMap.values()]
    const platIntersects = raycaster.intersectObjects(platMeshes)
    if (platIntersects.length > 0) {
      renderer.domElement.style.cursor = 'pointer'
      hoveredDevice.value = null
      return
    }

    const allGroups = [...deviceObjectMap.values()].map(e => e.group)
    const intersects = raycaster.intersectObjects(allGroups, true)
    if (intersects.length > 0) {
      let obj = intersects[0].object
      while (obj && !allGroups.includes(obj)) obj = obj.parent
      if (obj) {
        const d = obj.userData
        hoveredDevice.value = { name: d.deviceName || d.deviceId, area: d.area, status: d.status }
        hoverTooltipStyle.value = { left: (event.clientX + 16) + 'px', top: (event.clientY - 10) + 'px' }
        renderer.domElement.style.cursor = 'pointer'
        return
      }
    }
    hoveredDevice.value = null
    renderer.domElement.style.cursor = 'default'
  }
  renderer.domElement.addEventListener('mousemove', onMouseMove)

  // ══════════════════════════════════════════════════════════════
  // Dispose
  // ══════════════════════════════════════════════════════════════
  threeDispose = () => {
    animating = false
    resizeObserver.disconnect()
    renderer.domElement.removeEventListener('click', onClick)
    renderer.domElement.removeEventListener('mousemove', onMouseMove)
    controls.dispose()
    renderer.dispose()
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose())
        else obj.material.dispose()
      }
    })
    deviceObjectMap.clear()
    areaGroups.clear()
    areaPlatformMap.clear()
    areaLabelSprites.forEach(s => { if (s.material.map) s.material.map.dispose(); s.material.dispose() })
    areaLabelSprites.length = 0
    areaPlatforms.forEach(p => { p.geometry.dispose(); p.material.dispose() })
    areaPlatforms.length = 0
    syncDevices3D = null
    rebuildScene3D = null
    flyToArea3D = null
    highlight3D = null
    highlightArea3D = null
    setDeviceLight3D = null
    applyDeviceBrightness3D = null
    flyToOverview3D = null
    if (unsubControl) { unsubControl(); unsubControl = null }
    window.removeEventListener('manual-control-state-change', onManualStateChange)
    if (highlightRing) { highlightRing.geometry.dispose(); highlightRing.material.dispose(); highlightRing = null }
    if (container.contains(renderer.domElement)) {
      container.removeChild(renderer.domElement)
    }
  }
}

function destroyThreeScene() {
  threeDispose?.()
  threeDispose = null
}

// ═══ 响应图表 resize ═══
function handleAllChartResize() {
  energyChart?.resize()
  donutChart?.resize()
  barChart?.resize()
}

// ═══ 虚构告警数据（配合右上告警列表展示） ═══
const mockAlerts = ref([
  { type: '设备离线', device: 'SL-0012', area: '创业园区', time: '14:32' },
  { type: '亮灯异常', device: 'SL-0089', area: '高新区', time: '14:28' },
  { type: '功率超限', device: 'SL-0234', area: '工业园', time: '14:15' },
])

// ═══ 底部信息 ═══
const tickerMessages = ref([
  '系统通知：2026年度第二季度节能报告已生成',
  '最新事件：SL-0238 设备上线',
  '系统通知：边缘AI决策引擎运行正常',
  '告警提醒：SL-0012 离线超过30分钟',
])

// ═══ Lifecycle ═══
onMounted(async () => {
  // 登录后首次进入自动计算当日能耗（与数据加载并行，避免阻塞页面渲染）
  await Promise.all([autoCalcEnergyIfFirst(), loadAllData()])
  await nextTick()
  initThreeScene(allDevices.value.length > 0 ? allDevices.value : null)
  initialMountDone = true
  await nextTick()
  initDonutChart()
  initBarChart(districts.value || [])
  window.addEventListener('resize', handleAllChartResize)
  // 加载边缘AI决策记录
  loadEdgeRecent()
  // 启动多层软轮询（设备15s、统计60s、趋势5min）
  startStatsPolling()
  startTrendPolling()
  // 首次设备轮询延迟5s，给3D场景初始化留出时间
  setTimeout(() => { pollDeviceStatus() }, 5000)
})

// ═══ 多层软轮询（替代 location.reload，保留 UI 状态） ═══

// Tier 1: 设备状态 — 15s 高频，增量更新 3D 场景
async function pollDeviceStatus() {
  try {
    const list = await fetchAllDevicesForMap()
    const devs = Array.isArray(list) ? list : (list?.data || list?.records || [])
    if (devs.length > 0) {
      allDevices.value = devs
      if (syncDevices3D) syncDevices3D(devs)
    }
  } catch (_) { /* silent */ }
}

// Tier 2: 仪表盘统计+图表 — 60s 中频
let statsTimer = null
function startStatsPolling() {
  stopStatsPolling()
  statsTimer = setInterval(async () => {
    if (document.hidden) return
    await softRefresh()
    if (barChart && districts.value?.length) {
      barChart.setOption(buildBarOption(districts.value), true)
    }
    updateDonutChart()
  }, 60000)
}
function stopStatsPolling() {
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null }
}

// Tier 3: 能耗趋势 — 5min 低频
let trendTimer = null
function startTrendPolling() {
  stopTrendPolling()
  trendTimer = setInterval(async () => {
    if (document.hidden) return
    try {
      const t = await withCache(() => fetchEnergyTrend(), 'dashboard:trend', { ttl: 0 })
      initEnergyChart(t.data || {})
    } catch (_) { /* silent */ }
  }, 300000)
}
function stopTrendPolling() {
  if (trendTimer) { clearInterval(trendTimer); trendTimer = null }
}

const devicePoller = useAutoRefresh(pollDeviceStatus, { interval: 15000, immediateFirst: false })

onActivated(() => {
  handleAllChartResize()
  if (!initialMountDone) {
    // 首次挂载阶段，onMounted 会处理 3D 场景初始化
    startStatsPolling()
    startTrendPolling()
    return
  }
  if (!threeDispose && threeContainer.value && viewMode.value === '3d') {
    nextTick(() => initThreeScene())
  }
  startStatsPolling()
  startTrendPolling()
})

onDeactivated(() => {
  stopStatsPolling()
  stopTrendPolling()
  destroyThreeScene()
})

onUnmounted(() => {
  clearInterval(clockTimer)
  stopStatsPolling()
  stopTrendPolling()
  devicePoller.stop()
  destroyThreeScene()
  window.removeEventListener('resize', handleAllChartResize)
  energyChart?.dispose()
  donutChart?.dispose()
  barChart?.dispose()
})

// ═══ 视图切换 ═══
function switchView(mode) {
  viewMode.value = mode
}

// 切换到地图时触发 AMap 重绘（v-show 切换后容器尺寸可能变化）
watch(viewMode, (mode) => {
  if (mode === 'map') {
    nextTick(() => { window.dispatchEvent(new Event('resize')) })
  }
})

// ═══ Watch districts ═══
watch(districts, (data) => {
  if (data && data.length && barChart) {
    barChart.setOption(buildBarOption(data), true)
  } else if (data && data.length) {
    nextTick(() => initBarChart(data))
  }
})

watch(() => stats.value.onlineDevices, () => {
  updateDonutChart()
})

// 跨视图设备高亮同步（3D ↔ 地图）
watch(highlightDeviceId, (id) => {
  highlight3D?.(id)
})

// 区域选择 → 3D 视觉联动
watch(selectedArea, (area) => {
  highlightArea3D?.(area)
})

</script>

<template>
  <div class="cockpit">
    <!-- ═══════ 顶部标题栏 ═══════ -->
    <header class="cockpit-header">
      <div class="header-left">
        <div class="header-logo">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
        </div>
        <span class="header-title">智慧路灯数字孪生驾驶舱</span>
        <span class="header-subtitle">SMART LIGHTING DIGITAL TWIN COCKPIT</span>
      </div>
      <div class="header-center">
        <div class="header-line"></div>
      </div>
      <div class="header-right">
        <div class="header-info-item">
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/><path d="M12 6v6l4 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <span>{{ currentTime }}</span>
        </div>
        <div class="header-info-item">
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7z" fill="currentColor"/></svg>
          <span>设备 {{ stats.totalDevices?.toLocaleString() || '--' }}</span>
        </div>
        <div class="header-info-item online">
          <span class="header-dot"></span>
          <span>在线 {{ stats.onlineRate || '--' }}%</span>
        </div>
      </div>
    </header>

    <!-- ═══════ 主体三栏 ═══════ -->
    <div class="cockpit-body">
      <!-- ── 左栏 ── -->
      <div class="panel-col panel-col-left">
        <!-- 统计面板 -->
        <div class="panel panel-stats">
          <div class="panel-title"><span class="panel-title-dot"></span>核心指标</div>
          <div class="stats-cards">
            <div class="stat-card card-devices">
              <div class="stat-icon s-devices">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7z" fill="currentColor"/></svg>
              </div>
              <div class="stat-body">
                <div class="stat-value val-devices">{{ dispTotal }}</div>
                <div class="stat-label">设备总数</div>
              </div>
            </div>
            <div class="stat-card card-online">
              <div class="stat-icon s-online">
                <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M20 12a8 8 0 11-8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              </div>
              <div class="stat-body">
                <div class="stat-value val-online">{{ dispOnline }}</div>
                <div class="stat-label">在线率</div>
              </div>
            </div>
            <div class="stat-card card-saving">
              <div class="stat-icon s-saving">
                <svg viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" opacity="0.8"/></svg>
              </div>
              <div class="stat-body">
                <div class="stat-value val-saving">{{ dispSaving }}</div>
                <div class="stat-label">节能率</div>
              </div>
            </div>
            <div class="stat-card card-energy">
              <div class="stat-icon s-energy">
                <svg viewBox="0 0 24 24" fill="none"><path d="M3 20l3-6h3L6 4h2l6 10h-3l2 6H7l-4-8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
              <div class="stat-body">
                <div class="stat-value val-energy">{{ dispEnergy }}</div>
                <div class="stat-label">今日能耗</div>
              </div>
            </div>
          </div>

          <!-- 告警数 -->
          <div class="alert-mini" v-if="stats.alertCount > 0" @click="$router.push('/warning')">
            <span class="alert-mini-badge">{{ stats.alertCount }}</span>
            <span class="alert-mini-text">未处理告警 — 点击查看</span>
          </div>
        </div>

        <!-- 能耗趋势面板 -->
        <div class="panel panel-chart flex-1">
          <div class="panel-title">
            <span class="panel-title-dot"></span>能耗走势
            <span class="panel-actions">
              <button class="action-btn" :disabled="calcLoading" @click="handleCalcEnergy">{{ calcLoading ? '计算中...' : '计算' }}</button>
              <button class="action-btn" :disabled="genLoading" @click="handleGenData">{{ genLoading ? '生成中...' : '数据' }}</button>
            </span>
          </div>
          <div ref="energyChartRef" class="chart-box"></div>
        </div>

        <!-- 分区排名面板 -->
        <div class="panel panel-bar">
          <div class="panel-title"><span class="panel-title-dot"></span>分区在线排名</div>
          <div ref="barChartRef" class="chart-box chart-bar-box"></div>
        </div>
      </div>

      <!-- ── 中间核心区 ── -->
      <div class="panel-col panel-col-center">
        <div class="panel panel-center flex-1">
          <!-- 视图切换工具条 -->
          <div class="view-toolbar">
            <div class="view-tabs">
              <button :class="['view-tab', { active: viewMode === '3d' }]" @click="switchView('3d')">
                <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><rect x="2" y="2" width="20" height="20" rx="3" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>
                3D 数字孪生
              </button>
              <button :class="['view-tab', { active: viewMode === 'map' }]" @click="switchView('map')">
                <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3V7z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                设备地图
              </button>
            </div>
            <div class="view-area-search">
              <el-select
                v-model="selectedArea"
                placeholder="搜索分区..."
                clearable
                filterable
                size="small"
                :options="areaOptions"
                @change="onAreaSelect"
                popper-class="area-search-popper"
                style="width: 160px"
              >
                <template #prefix>
                  <svg viewBox="0 0 24 24" fill="none" width="12" height="12" style="margin-right: 2px">
                    <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.5"/>
                    <path d="M16.5 16.5L21 21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                </template>
              </el-select>
            </div>
            <div class="view-badge">
              <span class="view-badge-dot"></span>实时渲染
            </div>
            <button class="view-tab overview-btn" @click="flyToOverview3D?.()" title="俯瞰全城">
              <svg viewBox="0 0 24 24" fill="none" width="13" height="13">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              </svg>
            </button>
            <button class="view-tab immersive-btn" @click="toggleImmersive" :title="isImmersive ? '退出沉浸模式' : '沉浸模式'">
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
                <path v-if="!isImmersive" d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path v-else d="M4 8V4h4m8 0h4v4M4 16v4h4m8-4v4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>

          <!-- 3D 场景 -->
          <div v-show="viewMode === '3d'" ref="threeContainer" class="three-container">
            <!-- Hover tooltip -->
            <div v-if="hoveredDevice" class="three-hover-tip" :style="hoverTooltipStyle">
              {{ hoveredDevice.name }} · {{ hoveredDevice.area }}
            </div>
            <!-- Click popup -->
            <Transition name="popup-fade">
              <div v-if="popupDevice" class="three-popup" @click.stop>
                <div class="three-popup-name">{{ popupDevice.deviceName || popupDevice.deviceId }}</div>
                <div class="three-popup-row"><span>区域</span><span>{{ popupDevice.area || '--' }}</span></div>
                <div class="three-popup-row"><span>状态</span><span :class="'popup-status-' + popupDevice.status">{{ {0:'停用',1:'在线',2:'离线',3:'告警'}[popupDevice.status] || '未知' }}</span></div>
                <div class="three-popup-row"><span>亮度</span><span>{{ popupDevice._brightness }}%</span></div>
                <div class="three-popup-controls">
                  <button class="popup-ctrl-btn on" :disabled="controlLoading || popupDevice._brightness >= 100" @click="handlePopupControl('ON')">开灯</button>
                  <button class="popup-ctrl-btn off" :disabled="controlLoading || popupDevice._brightness <= 0" @click="handlePopupControl('OFF')">关灯</button>
                  <input type="range" min="10" max="100" step="10" :value="popupDevice._brightness"
                    class="popup-brightness" @input="handlePopupControl('DIMMING', Number($event.target.value))"
                    :disabled="controlLoading || popupDevice._brightness <= 0" title="亮度调节" />
                </div>
                <button class="three-popup-btn" @click="goToDeviceDetail(popupDevice.deviceId)">查看详情 →</button>
              </div>
            </Transition>
          </div>

          <!-- 地图视图 -->
          <div v-show="viewMode === 'map'" class="map-container">
            <DeviceMap
              :devices="allDevices"
              :highlightDeviceId="highlightDeviceId"
              v-model:selectedArea="selectedArea"
              height="100%"
              @marker-click="onMapMarkerClick"
            />
          </div>
        </div>
      </div>

      <!-- ── 右栏 ── -->
      <div class="panel-col panel-col-right">
        <!-- 设备实时状态 -->
        <div class="panel panel-donut">
          <div class="panel-title"><span class="panel-title-dot"></span>设备实时状态</div>
          <div class="donut-row">
            <div ref="donutChartRef" class="donut-chart"></div>
            <div class="status-legend">
              <div class="status-item online"><span class="status-dot"></span><span>在线</span><b>{{ stats.onlineDevices || '--' }}</b></div>
              <div class="status-item offline"><span class="status-dot"></span><span>离线</span><b>{{ Math.max(0, (stats.totalDevices || 0) - (stats.onlineDevices || 0)) }}</b></div>
              <div class="status-item alarm"><span class="status-dot"></span><span>告警</span><b>{{ stats.alertCount || 0 }}</b></div>
            </div>
          </div>
        </div>

        <!-- 最新告警 -->
        <div class="panel panel-alerts">
          <div class="panel-title"><span class="panel-title-dot"></span>最新告警</div>
          <div class="alert-list">
            <div class="alert-item" v-for="(a, i) in mockAlerts" :key="i">
              <span class="alert-item-type">{{ a.type }}</span>
              <span class="alert-item-device">{{ a.device }}</span>
              <span class="alert-item-area">{{ a.area }}</span>
              <span class="alert-item-time">{{ a.time }}</span>
            </div>
          </div>
          <div class="panel-footer-link" @click="$router.push('/warning')">
            告警中心 →
          </div>
        </div>

        <!-- AI 边缘决策 -->
        <div class="panel panel-ai flex-1">
          <div class="panel-title">
            <span class="panel-title-dot"></span>AI边缘决策
            <span class="panel-actions">
              <button class="action-btn" :disabled="edgeLoading" @click="handleTriggerEdge">{{ edgeLoading ? '执行中...' : '触发' }}</button>
            </span>
          </div>
          <div class="edge-list" v-if="edgeRecords.length > 0">
            <div class="edge-item" v-for="(r, i) in edgeRecords" :key="i">
              <div class="edge-item-top">
                <span class="edge-device">{{ r.deviceId }}</span>
                <span class="edge-result" :class="{ hit: r.result?.includes('EXECUTED') }">{{ r.result?.includes('EXECUTED') ? '命中' : '未命中' }}</span>
              </div>
              <div class="edge-item-mid">{{ r.matchedPolicy || '无匹配策略' }} → {{ r.actionTaken || '—' }}</div>
              <div class="edge-item-time">{{ r.createTime?.slice(0, 16)?.replace('T', ' ') || '' }}</div>
            </div>
          </div>
          <div class="ai-placeholder" v-else>
            <div class="ai-placeholder-icon">
              <svg viewBox="0 0 24 24" fill="none" width="32" height="32"><rect x="2" y="2" width="20" height="20" rx="3" stroke="currentColor" stroke-width="1.2"/><circle cx="9" cy="12" r="1.5" fill="currentColor" opacity="0.5"/><circle cx="15" cy="12" r="1.5" fill="currentColor" opacity="0.5"/><path d="M9 17h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/></svg>
            </div>
            <div class="ai-placeholder-text">暂无边缘决策记录</div>
            <div class="ai-placeholder-hint">点击"触发"执行一次模拟</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════ 底部滚动信息条 ═══════ -->
    <footer class="cockpit-footer">
      <div class="ticker-wrap">
        <div class="ticker-content">
          <span v-for="(msg, i) in tickerMessages" :key="i" class="ticker-item">
            <span class="ticker-sep">▶</span> {{ msg }}
          </span>
          <!-- Duplicate for seamless loop -->
          <span v-for="(msg, i) in tickerMessages" :key="'dup-'+i" class="ticker-item">
            <span class="ticker-sep">▶</span> {{ msg }}
          </span>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════════════════════════════
   COCKPIT LAYOUT
   ═══════════════════════════════════════════════════════════════════════ */
.cockpit {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #060e1f;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  /* Override global light-theme CSS variables for the dark cockpit */
  --text-soft: rgba(140,190,220,0.6);
  --text: rgba(180,220,240,0.8);
  --text-strong: #d0eaf8;
  --text-faint: rgba(140,190,220,0.35);
  --primary-dark: #4dd0e1;
  --primary: #4dd0e1;
  --surface: rgba(8,24,52,0.9);
  --surface-solid: #081834;
  --surface-muted: rgba(6,14,31,0.85);
  --line: rgba(77,208,225,0.12);
  --line-strong: rgba(77,208,225,0.25);
}

/* ── Header ── */
.cockpit-header {
  height: 52px;
  min-height: 52px;
  display: flex;
  align-items: center;
  padding: 0 24px;
  background: linear-gradient(180deg, rgba(8,24,52,0.98), rgba(8,24,52,0.9));
  border-bottom: 1px solid rgba(77,208,225,0.12);
  position: relative;
  z-index: 20;
}
.cockpit-header::after {
  content: '';
  position: absolute;
  bottom: 0; left: 10%; right: 10%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(77,208,225,0.4), transparent);
  animation: headerGlow 3s ease-in-out infinite;
}
@keyframes headerGlow {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.header-logo {
  width: 30px; height: 30px;
  background: linear-gradient(135deg, rgba(0,150,220,0.3), rgba(0,80,160,0.5));
  border: 1px solid rgba(77,208,225,0.3);
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
}
.header-logo svg { width: 18px; height: 18px; color: #4dd0e1; }
.header-title {
  font-size: 16px; font-weight: 700; color: #d0eaf8;
  letter-spacing: 2px; white-space: nowrap;
}
.header-subtitle {
  font-size: 9px; color: rgba(140,190,220,0.35);
  letter-spacing: 2px; white-space: nowrap;
  margin-left: 6px;
}

.header-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 20px;
}
.header-line {
  height: 1px;
  width: 100%;
  background: linear-gradient(90deg, transparent, rgba(77,208,225,0.1), transparent);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-shrink: 0;
}
.header-info-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: rgba(140,190,220,0.6);
  white-space: nowrap;
}
.header-info-item svg { color: rgba(140,190,220,0.3); flex-shrink: 0; }
.header-info-item.online { color: #4caf82; }
.header-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #4caf82;
  box-shadow: 0 0 6px #4caf82;
}

/* ── Body ── */
.cockpit-body {
  flex: 1;
  display: flex;
  gap: 10px;
  padding: 10px 14px;
  overflow: hidden;
  min-height: 0;
  background: #060e1f; /* 覆盖 body 白色背景透过 gap */
}

.panel-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.panel-col-left { width: 19%; flex-shrink: 0; }
.panel-col-right { width: 19%; flex-shrink: 0; }
.panel-col-center { flex: 1; }
.flex-1 { flex: 1; min-height: 0; }

/* ── Panel base ── */
.panel {
  background: rgba(8,24,52,0.7);
  border: 1px solid rgba(77,208,225,0.1);
  border-radius: 6px;
  position: relative;
  padding: 14px 16px;
  overflow: hidden;
  box-shadow:
    0 1px 0 0 rgba(77,208,225,0.06) inset,
    0 -1px 0 0 rgba(77,208,225,0.06) inset;
}
/* Corner decorations — top-left + top-right */
.panel::before,
.panel::after {
  content: '';
  position: absolute;
  width: 12px; height: 12px;
  pointer-events: none;
  z-index: 2;
}
.panel::before {
  top: 0; left: 0;
  border-top: 1px solid rgba(77,208,225,0.35);
  border-left: 1px solid rgba(77,208,225,0.35);
}
.panel::after {
  top: 0; right: 0;
  border-top: 1px solid rgba(77,208,225,0.35);
  border-right: 1px solid rgba(77,208,225,0.35);
}

.panel-title {
  font-size: 13px; font-weight: 600; color: #d0eaf8;
  margin-bottom: 10px;
  display: flex; align-items: center; gap: 8px;
}
.panel-title-dot {
  width: 6px; height: 6px;
  background: #4dd0e1;
  border-radius: 1px;
  box-shadow: 0 0 6px rgba(77,208,225,0.6);
  flex-shrink: 0;
}
.panel-actions {
  margin-left: auto;
  display: flex; gap: 6px;
}
.action-btn {
  padding: 3px 12px; font-size: 10px;
  background: rgba(255,255,255,0.88); border: 1px solid rgba(77,208,225,0.3);
  border-radius: 3px; color: #1d3148; font-weight: 600;
  cursor: pointer; transition: all 0.2s; white-space: nowrap;
}
.action-btn:hover:not(:disabled) { background: #fff; color: #006fc2; border-color: #4dd0e1; }
.action-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.panel-footer-link {
  text-align: right; font-size: 10px; color: rgba(77,208,225,0.5);
  cursor: pointer; margin-top: 8px; transition: color 0.2s;
}
.panel-footer-link:hover { color: #4dd0e1; }

/* ── Stats cards ── */
.stats-cards {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 8px; margin-bottom: 10px;
}
.stat-card {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  background: rgba(0,40,80,0.25); border: 1px solid rgba(77,208,225,0.06);
  border-radius: 4px;
  transition: border-color 0.2s, transform 0.2s, background 0.2s;
}
.stat-card:hover { transform: translateY(-1px); }
.stat-card.card-devices:hover { border-color: rgba(77,208,225,0.25); background: rgba(77,208,225,0.06); }
.stat-card.card-online:hover { border-color: rgba(76,175,80,0.25); background: rgba(76,175,80,0.06); }
.stat-card.card-saving:hover { border-color: rgba(255,167,38,0.25); background: rgba(255,167,38,0.06); }
.stat-card.card-energy:hover { border-color: rgba(0,200,180,0.25); background: rgba(0,200,180,0.06); }
.stat-icon {
  width: 38px; height: 38px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.stat-icon svg { width: 20px; height: 20px; }
.stat-icon.s-devices { background: rgba(77,208,225,0.18) !important; color: #4dd0e1; }
.stat-icon.s-online { background: rgba(76,175,80,0.18) !important; color: #4caf82; }
.stat-icon.s-saving { background: rgba(255,167,38,0.18) !important; color: #ffa726; }
.stat-icon.s-energy { background: rgba(0,200,180,0.18) !important; color: #00c8b4; }
.stat-value {
  font-size: 22px; font-weight: 800;
  line-height: 1.1; font-family: 'Courier New', Consolas, monospace;
  color: var(--primary-dark) !important; /* safe fallback via overridden var */
}
.stat-value.val-devices { color: #4dd0e1 !important; }
.stat-value.val-online { color: #4caf82 !important; }
.stat-value.val-saving { color: #ffa726 !important; }
.stat-value.val-energy { color: #00c8b4 !important; }
.stat-label {
  font-size: 10px; color: var(--text-soft) !important;
  margin-top: 2px;
}
.alert-mini {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  background: rgba(239,83,80,0.08); border: 1px solid rgba(239,83,80,0.15);
  border-radius: 4px; cursor: pointer; transition: background 0.2s;
}
.alert-mini:hover { background: rgba(239,83,80,0.15); }
.alert-mini-badge {
  background: #ef5350; color: #fff; font-size: 10px; font-weight: 700;
  min-width: 18px; height: 18px; border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
}
.alert-mini-text { font-size: 10px; color: rgba(239,83,80,0.7); }

/* ── Charts ── */
.panel-chart {
  display: flex;
  flex-direction: column;
}
.panel-chart .panel-title {
  flex-shrink: 0;
}
.chart-box { width: 100%; height: 170px; background: transparent; }
.panel-chart .chart-box {
  flex: 1;
  min-height: 180px;
  height: auto;
}
.chart-bar-box { height: 160px; background: transparent; }

/* ── Donut panel ── */
.donut-row { display: flex; align-items: center; gap: 10px; }
.donut-chart { width: 110px; height: 110px; flex-shrink: 0; background: transparent; }
.status-legend { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.status-item {
  display: flex; align-items: center; gap: 6px;
  font-size: 10px; color: rgba(140,190,220,0.55);
}
.status-item b { margin-left: auto; color: #d0eaf8; font-size: 13px; }
.status-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
}
.status-item.online .status-dot { background: #4dd0e1; box-shadow: 0 0 6px #4dd0e1; }
.status-item.offline .status-dot { background: #6b7f93; }
.status-item.alarm .status-dot { background: #ef5350; box-shadow: 0 0 6px #ef5350; }

/* ── Alerts ── */
.alert-list { display: flex; flex-direction: column; gap: 4px; }
.alert-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  background: rgba(239,83,80,0.04); border-left: 2px solid rgba(239,83,80,0.3);
  border-radius: 0 3px 3px 0; font-size: 10px;
  transition: background 0.2s;
}
.alert-item:hover { background: rgba(239,83,80,0.08); }
.alert-item-type { color: #ef5350; font-weight: 600; min-width: 50px; }
.alert-item-device { color: rgba(200,220,240,0.7); }
.alert-item-area { color: rgba(140,190,220,0.4); flex: 1; text-align: right; }
.alert-item-time { color: rgba(140,190,220,0.3); font-family: monospace; min-width: 32px; text-align: right; }

/* ── AI Placeholder ── */
.ai-placeholder {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; height: 100%; min-height: 100px;
  gap: 8px;
}
.ai-placeholder-icon {
  width: 48px; height: 48px;
  background: rgba(0,200,180,0.06); border: 1px solid rgba(0,200,180,0.12);
  border-radius: 10px; display: flex; align-items: center; justify-content: center;
  color: rgba(0,200,180,0.3);
}
.ai-placeholder-text {
  font-size: 13px; color: rgba(140,190,220,0.35); font-weight: 600;
}
.ai-placeholder-hint {
  font-size: 10px; color: rgba(140,190,220,0.18);
}

/* ── Edge AI Decision List ── */
.edge-list {
  flex: 1; overflow-y: auto; padding: 0 8px 8px;
}
.edge-list::-webkit-scrollbar { width: 3px; }
.edge-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
.edge-item {
  padding: 6px 8px; margin-bottom: 4px;
  background: rgba(0,200,180,0.03); border: 1px solid rgba(0,200,180,0.06);
  border-radius: 4px;
}
.edge-item-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; }
.edge-device { font-size: 11px; color: rgba(180,210,240,0.8); font-weight: 600; font-family: monospace; }
.edge-result { font-size: 10px; padding: 1px 5px; border-radius: 2px; background: rgba(255,100,100,0.15); color: rgba(255,140,140,0.7); }
.edge-result.hit { background: rgba(0,200,180,0.15); color: rgba(0,220,200,0.7); }
.edge-item-mid { font-size: 11px; color: rgba(140,190,220,0.45); margin-bottom: 1px; }
.edge-item-time { font-size: 10px; color: rgba(140,190,220,0.25); font-family: monospace; }

/* ── Center panel ── */
.panel-center {
  position: relative;
  padding: 0;
}
.view-toolbar {
  position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
  z-index: 5; display: flex; align-items: center; gap: 12px;
  background: rgba(8,24,52,0.92); border: 1px solid rgba(77,208,225,0.15);
  border-radius: 6px; padding: 4px 6px;
}
.view-tabs { display: flex; gap: 2px; }
.view-tab {
  padding: 5px 12px; border: none; border-radius: 3px;
  background: transparent; color: rgba(140,190,220,0.5);
  font-size: 11px; font-weight: 500; cursor: pointer;
  display: flex; align-items: center; gap: 5px;
  transition: all 0.2s; white-space: nowrap;
}
.view-tab:hover { color: rgba(180,220,240,0.8); background: rgba(0,100,180,0.12); }
.view-tab.active { color: #4dd0e1; background: rgba(0,120,200,0.18); }
.view-badge {
  display: flex; align-items: center; gap: 5px;
  font-size: 9px; color: rgba(76,175,130,0.6); white-space: nowrap;
}
.view-badge-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #4caf82; box-shadow: 0 0 5px #4caf82;
}
.immersive-btn {
  padding: 5px 10px;
  margin-left: 4px;
  border-left: 1px solid rgba(77,208,225,0.12);
}

.three-container {
  width: 100%; height: 100%;
  overflow: hidden;
  border-radius: 6px;
  position: relative;
}
.three-container :deep(canvas) { display: block; }

/* ── Hover tooltip ── */
.three-hover-tip {
  position: fixed;
  background: rgba(8, 24, 52, 0.92);
  border: 1px solid rgba(77, 208, 225, 0.25);
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  color: #d0eaf8;
  pointer-events: none;
  z-index: 9;
  white-space: nowrap;
}

/* ── 3D click popup (fixed at top-center) ── */
.three-popup {
  position: absolute;
  top: 54px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(8, 24, 52, 0.96);
  border: 1px solid rgba(77, 208, 225, 0.35);
  border-radius: 8px;
  padding: 12px 16px;
  min-width: 200px;
  z-index: 10;
  pointer-events: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
}
.three-popup-name {
  font-size: 14px; font-weight: 700; color: #d0eaf8;
  margin-bottom: 6px; border-bottom: 1px solid rgba(77,208,225,0.15); padding-bottom: 4px;
}
.three-popup-row {
  display: flex; justify-content: space-between; gap: 12px;
  font-size: 11px; color: rgba(140,190,220,0.6); margin: 2px 0;
}
.three-popup-row span:last-child { color: rgba(200,230,245,0.85); }
.popup-status-1 { color: #4caf82 !important; }
.popup-status-3 { color: #ef5350 !important; }
.popup-status-2, .popup-status-0 { color: rgba(140,190,220,0.5) !important; }
.three-popup-controls { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.popup-ctrl-btn {
  padding: 4px 10px; border-radius: 4px; border: 1px solid rgba(77,208,225,0.3);
  background: rgba(0,150,220,0.15); color: #d0eaf8; font-size: 11px;
  cursor: pointer; transition: all 0.15s;
}
.popup-ctrl-btn.on { border-color: rgba(76,175,130,0.4); }
.popup-ctrl-btn.on:hover { background: rgba(76,175,130,0.3); }
.popup-ctrl-btn.off { border-color: rgba(239,83,80,0.4); }
.popup-ctrl-btn.off:hover { background: rgba(239,83,80,0.3); }
.popup-ctrl-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.popup-brightness {
  width: 60px; height: 4px; accent-color: #4dd0e1;
  cursor: pointer; flex: 1; min-width: 50px;
}
.popup-brightness:disabled { opacity: 0.4; cursor: not-allowed; }
.three-popup-btn {
  display: block; width: 100%; margin-top: 8px; padding: 6px 0;
  background: rgba(0, 150, 220, 0.2); border: 1px solid rgba(77, 208, 225, 0.3);
  border-radius: 4px; color: #4dd0e1; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.2s;
}
.three-popup-btn:hover { background: rgba(0, 150, 220, 0.35); }

.popup-fade-enter-active, .popup-fade-leave-active { transition: opacity 0.15s; }
.popup-fade-enter-from, .popup-fade-leave-to { opacity: 0; }

.map-container {
  width: 100%; height: 100%;
  overflow: hidden;
  border-radius: 6px;
}

/* ── Footer ticker ── */
.cockpit-footer {
  height: 32px; min-height: 32px;
  background: rgba(8,24,52,0.9);
  border-top: 1px solid rgba(77,208,225,0.1);
  display: flex; align-items: center;
  overflow: hidden;
  padding: 0 14px;
}
.ticker-wrap {
  width: 100%;
  overflow: hidden;
  position: relative;
}
.ticker-content {
  display: inline-flex;
  gap: 32px;
  white-space: nowrap;
  animation: tickerScroll 30s linear infinite;
}
.ticker-item {
  font-size: 10px; color: rgba(140,190,220,0.45);
  white-space: nowrap;
}
.ticker-sep {
  color: rgba(77,208,225,0.3);
  margin-right: 6px;
}
@keyframes tickerScroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

/* ── Responsive fallbacks ── */
@media (max-width: 1400px) {
  .panel-col-left, .panel-col-right { width: 24%; }
  .stat-value { font-size: 18px; }
}
@media (max-width: 1100px) {
  .cockpit-body { flex-direction: column; overflow-y: auto; }
  .panel-col-left, .panel-col-right { width: 100%; }
  .panel-col-center { min-height: 400px; }
  .three-container { min-height: 400px; }
  .header-subtitle { display: none; }
}

/* ── 分区搜索下拉 ── */
.view-area-search :deep(.el-select) { --el-fill-color-blank: rgba(8,24,52,0.6); }
.view-area-search :deep(.el-input__wrapper) {
  background: rgba(8,28,58,0.7); border-color: rgba(77,208,225,0.2);
  box-shadow: none; padding: 2px 8px;
}
.view-area-search :deep(.el-input__wrapper:hover) { border-color: rgba(77,208,225,0.4); }
.view-area-search :deep(.el-input__inner) {
  color: rgba(180,220,240,0.8); font-size: 11px; font-weight: 500;
}
.view-area-search :deep(.el-input__inner::placeholder) { color: rgba(140,190,220,0.35); }
.view-area-search :deep(.el-select__caret) { color: rgba(77,208,225,0.5); }

/* 下拉面板暗色主题 */
.area-search-popper {
  background: rgba(6,20,44,0.97) !important;
  border: 1px solid rgba(77,208,225,0.2) !important;
  backdrop-filter: blur(10px);
}
.area-search-popper .el-select-dropdown__item {
  color: rgba(180,220,240,0.7); font-size: 12px;
}
.area-search-popper .el-select-dropdown__item.hover,
.area-search-popper .el-select-dropdown__item:hover {
  background: rgba(0,120,200,0.2); color: #4dd0e1;
}
.area-search-popper .el-select-dropdown__item.selected {
  color: #4dd0e1; background: rgba(0,120,200,0.15); font-weight: 600;
}
.area-search-popper .el-popper__arrow::before {
  background: rgba(6,20,44,0.97); border-color: rgba(77,208,225,0.2);
}
</style>
