<script setup>
import { ref, watch, onMounted, onUnmounted, onActivated, onDeactivated, nextTick, inject } from 'vue'
import { useRouter } from 'vue-router'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as echarts from 'echarts'
import { fetchDashboardStats, fetchEnergyTrend, fetchDistrictData, triggerEnergyCalc, genTestData } from '../api/dashboard.js'
import { fetchAllDevicesForMap } from '../api/devices.js'
import { useAutoRefresh } from '../composables/useAutoRefresh.js'
import { useMqtt } from '../composables/useMqtt.js'
import { useCountUp } from '../composables/useCountUp.js'
import { withCache, invalidateCache } from '../utils/requestCache.js'
import DeviceMap from '../components/DeviceMap.vue'

const router = useRouter()

// ═══ 沉浸模式（来自 MainLayout） ═══
const immersive = inject('immersiveMode', null)
const isImmersive = immersive?.isImmersive ?? ref(false)
const toggleImmersive = immersive?.toggleImmersive ?? (() => {})

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

// ═══ MQTT ═══
const { subscribe } = useMqtt()

// ═══ 地图相关 ═══
const highlightDeviceId = ref('')
function onMapMarkerClick(device) { highlightDeviceId.value = device.deviceId }

// ═══ 能耗计算 ═══
const calcLoading = ref(false)
const genLoading = ref(false)

// ═══ ECharts ═══
const energyChartRef = ref(null)
const donutChartRef = ref(null)
let energyChart = null
let donutChart = null

// ═══ Three.js 3D 场景 ═══
const threeContainer = ref(null)
let threeDispose = null
const threeDevices = ref([])  // 3D 场景中的设备对象

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
      allDevices.value = Array.isArray(list) ? list : (list?.records || [])
    }).catch(() => {})
  } catch {}
}

async function softRefresh() {
  invalidateCache('dashboard:')
  await loadAllData()
}

async function refreshLiveData() {
  try {
    const s = await fetchDashboardStats()
    const newStats = s.data || {}
    if (newStats.totalDevices != null && newStats.totalDevices !== stats.value.totalDevices) {
      startTotal(newStats.totalDevices)
    }
    if (newStats.onlineRate != null && newStats.onlineRate !== stats.value.onlineRate) {
      startOnline(newStats.onlineRate)
    }
    stats.value = { ...stats.value, ...newStats }
    updateDonutChart()
  } catch {}
}

useAutoRefresh(refreshLiveData, { interval: 300000, immediateFirst: false })

subscribe('system/alarms', () => refreshLiveData())

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

// ═══ 能耗操作 ═══
async function handleCalcEnergy() {
  if (calcLoading.value) return
  calcLoading.value = true
  try {
    await triggerEnergyCalc()
    await softRefresh()
  } catch (e) {
    console.warn('计算失败:', e)
  } finally { calcLoading.value = false }
}

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
  const isEmpty = !data.labels || !data.current || data.current.length === 0 || data.current.every(v => v === 0)
  if (isEmpty) {
    const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
    data = { labels: hours, current: hours.map(() => rand(180, 420)), lastWeek: hours.map(() => rand(200, 450)) }
  }
  return {
    backgroundColor: 'transparent',
    grid: { top: 20, bottom: 30, left: 44, right: 16 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(4,20,50,0.96)', borderColor: 'rgba(77,208,225,0.4)', textStyle: { color: '#d0eaf8', fontSize: 12 } },
    legend: { top: 0, right: 0, textStyle: { color: 'rgba(140,190,220,0.7)', fontSize: 11 }, data: ['本日能耗', '上周同期'], itemWidth: 14, itemHeight: 8 },
    xAxis: {
      type: 'category', data: data.labels,
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
        name: '本日能耗', type: 'line', data: data.current, smooth: true, symbol: 'none',
        lineStyle: { color: '#4dd0e1', width: 2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(77,208,225,0.2)' }, { offset: 1, color: 'rgba(77,208,225,0.01)' }]) },
      },
      {
        name: '上周同期', type: 'line', data: data.lastWeek, smooth: true, symbol: 'none',
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
  if (!barChart) barChart = echarts.init(barChartRef.value)
  barChart.setOption(buildBarOption(data), true)
}

// ═══ Three.js 3D 场景 ═══
function initThreeScene() {
  if (!threeContainer.value) return

  const container = threeContainer.value
  const W = container.clientWidth
  const H = container.clientHeight

  // Scene
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x060e1f)
  scene.fog = new THREE.Fog(0x060e1f, 8, 40)

  // Camera
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100)
  camera.position.set(8, 7, 12)
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
  controls.autoRotateSpeed = 0.3
  controls.minDistance = 5
  controls.maxDistance = 25
  controls.maxPolarAngle = Math.PI / 2.2
  controls.target.set(0, 0, 0)

  // ── Lights ──
  const ambient = new THREE.AmbientLight(0x1a2a4a, 0.8)
  scene.add(ambient)

  const dirLight = new THREE.DirectionalLight(0x4dd0e1, 0.4)
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

  // ── Ground ──
  const groundGeo = new THREE.PlaneGeometry(30, 30)
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x0a1a2e, roughness: 0.9, metalness: 0.1 })
  const ground = new THREE.Mesh(groundGeo, groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  // Grid
  const gridHelper = new THREE.GridHelper(30, 24, 0x1a3a5a, 0x0a1a30)
  gridHelper.position.y = 0.01
  scene.add(gridHelper)

  // ── Roads (cross pattern) ──
  function addRoad(x, z, w, d) {
    const geo = new THREE.PlaneGeometry(w, d)
    const mat = new THREE.MeshStandardMaterial({ color: 0x151d2e, roughness: 0.85 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.02, z)
    mesh.receiveShadow = true
    scene.add(mesh)
  }
  addRoad(0, 0, 1.2, 30)   // 纵向
  addRoad(0, 0, 30, 1.2)   // 横向
  addRoad(-5, 0, 1.2, 30)
  addRoad(5, 0, 1.2, 30)
  addRoad(0, -5, 30, 1.2)
  addRoad(0, 5, 30, 1.2)

  // ── Streetlight 3D model ──
  function createStreetlight(x, z, color, status) {
    const group = new THREE.Group()

    // Pole
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 2.8, 8)
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.4, metalness: 0.7 })
    const pole = new THREE.Mesh(poleGeo, poleMat)
    pole.position.y = 1.4
    pole.castShadow = true
    group.add(pole)

    // Lamp arm
    const armGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6)
    const armMat = new THREE.MeshStandardMaterial({ color: 0x5a6a7a, roughness: 0.3, metalness: 0.6 })
    const arm = new THREE.Mesh(armGeo, armMat)
    arm.rotation.z = Math.PI / 2
    arm.position.set(0.25, 2.7, 0)
    group.add(arm)

    // Lamp housing
    const housingGeo = new THREE.CylinderGeometry(0.15, 0.18, 0.3, 8)
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x4a5a6a, roughness: 0.3, metalness: 0.5 })
    const housing = new THREE.Mesh(housingGeo, housingMat)
    housing.position.set(0.48, 2.6, 0)
    housing.castShadow = true
    group.add(housing)

    // Bulb glow sphere
    const bulbGeo = new THREE.SphereGeometry(0.08, 8, 8)
    const emissiveColor = color || 0x4dd0e1
    const bulbMat = new THREE.MeshStandardMaterial({ color: emissiveColor, emissive: emissiveColor, emissiveIntensity: status === 1 ? 2 : 0.3, roughness: 0.2 })
    const bulb = new THREE.Mesh(bulbGeo, bulbMat)
    bulb.position.set(0.48, 2.45, 0)
    group.add(bulb)

    // PointLight for online devices
    if (status === 1) {
      const ptLight = new THREE.PointLight(emissiveColor, 1.5, 3, 1)
      ptLight.position.copy(bulb.position)
      group.add(ptLight)
    } else if (status === 3) {
      // Alarm — red pulsing handled in animation loop
      const ptLight = new THREE.PointLight(0xef5350, 2, 3.5, 1)
      ptLight.position.copy(bulb.position)
      ptLight.name = 'alarmLight'
      group.add(ptLight)
    }

    group.position.set(x, 0, z)
    return group
  }

  // ── Place streetlights in grid ──
  const deviceObjects = []
  const gridSize = 5
  const spacing = 2.2
  const offset = (gridSize - 1) * spacing / 2

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const x = col * spacing - offset
      const z = row * spacing - offset
      // Randomize placement slightly
      const jx = x + (Math.random() - 0.5) * 0.6
      const jz = z + (Math.random() - 0.5) * 0.6
      // Random status weighted toward online
      const r = Math.random()
      const status = r < 0.78 ? 1 : r < 0.88 ? 2 : r < 0.95 ? 3 : 0
      const color = status === 1 ? 0x4dd0e1 : status === 3 ? 0xef5350 : 0x4a5a6a
      const sl = createStreetlight(jx, jz, color, status)
      sl.userData = { status, color, row, col }
      scene.add(sl)
      deviceObjects.push(sl)
    }
  }

  threeDevices.value = deviceObjects

  // ── Building blocks (decorative) ──
  for (let i = 0; i < 12; i++) {
    const bx = (Math.random() - 0.5) * 14
    const bz = (Math.random() - 0.5) * 14
    const bh = 0.6 + Math.random() * 2.5
    const bw = 0.5 + Math.random() * 1.2
    const bGeo = new THREE.BoxGeometry(bw, bh, bw)
    const bMat = new THREE.MeshStandardMaterial({ color: 0x0d1f33, roughness: 0.8, metalness: 0.2, transparent: true, opacity: 0.7 })
    const building = new THREE.Mesh(bGeo, bMat)
    building.position.set(bx, bh / 2, bz)
    building.receiveShadow = true
    building.castShadow = true
    scene.add(building)
  }

  // ── Particle ring ──
  const particlesGeo = new THREE.BufferGeometry()
  const particlesCount = 200
  const positions = new Float32Array(particlesCount * 3)
  for (let i = 0; i < particlesCount; i++) {
    const angle = (i / particlesCount) * Math.PI * 2
    const radius = 6.5 + Math.random() * 1.5
    const height = (Math.random() - 0.5) * 1.5
    positions[i * 3] = Math.cos(angle) * radius
    positions[i * 3 + 1] = height + 1.5
    positions[i * 3 + 2] = Math.sin(angle) * radius
  }
  particlesGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const particlesMat = new THREE.PointsMaterial({ color: 0x4dd0e1, size: 0.04, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
  const particles = new THREE.Points(particlesGeo, particlesMat)
  scene.add(particles)

  // ── Animation Loop ──
  let lastTime = performance.now()
  function animate() {
    requestAnimationFrame(animate)
    const now = performance.now()
    const dt = Math.min((now - lastTime) / 1000, 0.1) // cap delta to avoid spiral
    lastTime = now
    controls.update()

    // Particle ring rotation
    particles.rotation.y += dt * 0.15

    // Alarm light pulsing
    deviceObjects.forEach(sl => {
      if (sl.userData.status === 3) {
        const alarmLight = sl.children.find(c => c.name === 'alarmLight')
        if (alarmLight) {
          alarmLight.intensity = 1.2 + Math.sin(Date.now() * 0.008) * 0.8
        }
        // Pulse the bulb emissive for alarm devices
        const bulbMesh = sl.children.find(c => c.isMesh && c.material.emissive && c.material.emissive.getHex() !== 0x000000)
        if (bulbMesh) {
          bulbMesh.material.emissiveIntensity = 1.2 + Math.sin(Date.now() * 0.008) * 0.8
        }
      }
    })

    renderer.render(scene, camera)
  }
  animate()

  // ── Resize ──
  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth
    const h = container.clientHeight
    if (w === 0 || h === 0) return
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
  })
  resizeObserver.observe(container)

  // ── Click handler ──
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  function onClick(event) {
    const rect = renderer.domElement.getBoundingClientRect()
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(mouse, camera)
    const intersects = raycaster.intersectObjects(deviceObjects, true)
    if (intersects.length > 0) {
      let obj = intersects[0].object
      while (obj && !deviceObjects.includes(obj)) obj = obj.parent
      if (obj) {
        const d = obj.userData
        const statusLabels = { 0: '停用', 1: '在线', 2: '离线', 3: '告警' }
        alert(`路灯 #${d.row}-${d.col}\n状态: ${statusLabels[d.status] || '未知'}`)
      }
    }
  }
  renderer.domElement.addEventListener('click', onClick)

  threeDispose = () => {
    resizeObserver.disconnect()
    renderer.domElement.removeEventListener('click', onClick)
    controls.dispose()
    renderer.dispose()
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose())
        else obj.material.dispose()
      }
    })
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
  await loadAllData()
  await nextTick()
  initThreeScene()
  await nextTick()
  initEnergyChart({})
  initDonutChart()
  initBarChart(districts.value || [])
  window.addEventListener('resize', handleAllChartResize)
})

onActivated(() => {
  handleAllChartResize()
  if (!threeDispose && threeContainer.value && viewMode.value === '3d') {
    nextTick(initThreeScene)
  }
})

onDeactivated(() => {
  destroyThreeScene()
})

onUnmounted(() => {
  clearInterval(clockTimer)
  destroyThreeScene()
  window.removeEventListener('resize', handleAllChartResize)
  energyChart?.dispose()
  donutChart?.dispose()
  barChart?.dispose()
})

// ═══ 视图切换 ═══
function switchView(mode) {
  viewMode.value = mode
  if (mode === 'map') {
    destroyThreeScene()
  } else {
    nextTick(initThreeScene)
  }
}

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
            <div class="view-badge">
              <span class="view-badge-dot"></span>实时渲染
            </div>
            <button class="view-tab immersive-btn" @click="toggleImmersive" :title="isImmersive ? '退出沉浸模式' : '沉浸模式'">
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14">
                <path v-if="!isImmersive" d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path v-else d="M4 8V4h4m8 0h4v4M4 16v4h4m8-4v4h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>

          <!-- 3D 场景 -->
          <div v-show="viewMode === '3d'" ref="threeContainer" class="three-container"></div>

          <!-- 地图视图 -->
          <div v-show="viewMode === 'map'" class="map-container">
            <DeviceMap
              v-if="viewMode === 'map'"
              :devices="allDevices"
              :highlightDeviceId="highlightDeviceId"
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

        <!-- AI 边缘决策占位 -->
        <div class="panel panel-ai flex-1">
          <div class="panel-title"><span class="panel-title-dot"></span>AI边缘决策</div>
          <div class="ai-placeholder">
            <div class="ai-placeholder-icon">
              <svg viewBox="0 0 24 24" fill="none" width="32" height="32"><rect x="2" y="2" width="20" height="20" rx="3" stroke="currentColor" stroke-width="1.2"/><circle cx="9" cy="12" r="1.5" fill="currentColor" opacity="0.5"/><circle cx="15" cy="12" r="1.5" fill="currentColor" opacity="0.5"/><path d="M9 17h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/></svg>
            </div>
            <div class="ai-placeholder-text">AI边缘决策</div>
            <div class="ai-placeholder-hint">功能开发中...</div>
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
.panel-col-left { width: 22%; flex-shrink: 0; }
.panel-col-right { width: 22%; flex-shrink: 0; }
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
}
.three-container :deep(canvas) { display: block; }

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
</style>
