<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useAMap } from '../composables/useAMap.js'
import { parseLocation } from '../utils/coordinate.js'

const router = useRouter()
const { AMap: AMapRef, loaded, loading, error } = useAMap()

const props = defineProps({
  devices: { type: Array, default: () => [] },
  highlightDeviceId: { type: String, default: '' },
  selectedArea: { type: String, default: '' },
  height: { type: String, default: '360px' },
})

const emit = defineEmits(['marker-click', 'update:selectedArea'])

const wrapperRef = ref(null)
const mapContainerRef = ref(null)

let map = null
const markerMap = new Map()
let currentHighlight = null
let infoWindow = null
let resizeObserver = null

// 状态基础色（离线/停用/异常覆盖区域色）
const STATUS_COLORS = { 0: '#6b7f93', 1: null, 2: '#7b8794', 3: '#f59e0b' }
const LABELS = { 0: '停用', 1: '在线', 2: '离线', 3: '异常' }

// 区域调色板（按首次出现顺序分配）
const AREA_PALETTE = ['#4dd0e1','#5c6bc0','#4caf82','#ab47bc','#ff9800','#ef5350','#42a5f5','#66bb6a','#ffa726','#26c6da']
const areaColorMap = {}

function getAreaColor(area) {
  if (!area) return '#26a6da'
  if (!areaColorMap[area]) {
    const idx = Object.keys(areaColorMap).length % AREA_PALETTE.length
    areaColorMap[area] = AREA_PALETTE[idx]
  }
  return areaColorMap[area]
}

// 综合颜色：离线/停用 → 灰色；异常 → 橙色；在线 → 区域色
function getMarkerColor(device) {
  const s = device.status
  if (s === 0 || s === 2) return STATUS_COLORS[s]
  if (s === 3) return STATUS_COLORS[3]
  return getAreaColor(device.area)
}

const noLocationCount = computed(() =>
  props.devices.filter(d => !parseLocation(d.location)).length
)

const mapStats = computed(() => {
  const total = props.devices.length
  return {
    total,
    visible: total - noLocationCount.value,
    online: props.devices.filter(d => d.status === 1).length,
    warning: props.devices.filter(d => d.status === 3).length,
    offline: props.devices.filter(d => d.status === 2 || d.status === 0).length,
  }
})

// 区域列表（用于图例）
const areaLegend = computed(() => {
  return Object.keys(areaColorMap).map(area => ({
    name: area,
    color: areaColorMap[area],
  }))
})

// ── 区域分组选择 ──
const localArea = computed({
  get: () => props.selectedArea,
  set: (val) => emit('update:selectedArea', val),
})
const selectedAreaCount = computed(() => {
  if (!localArea.value) return 0
  return props.devices.filter(d => d.area === localArea.value).length
})
const areaOptions = computed(() => {
  const areas = [...new Set(props.devices.map(d => d.area).filter(Boolean))]
  return areas.sort()
})
let pulseTimer = null
let pulseOn = false

function selectArea(area) {
  clearInterval(pulseTimer)
  pulseOn = false
  if (!area) {
    markerMap.forEach((m) => {
      m.setIcon(getIcon(m.__deviceData, false))
      m.setzIndex(100)
    })
    if (markerMap.size > 0) {
      map.setFitView(Array.from(markerMap.values()), null, [60, 60, 60, 60], 400)
    }
    return
  }
  const areaMarkers = []
  markerMap.forEach((m) => {
    const d = m.__deviceData
    if (d.area === area) {
      m.setIcon(getIcon(d, true))
      m.setzIndex(200)
      areaMarkers.push(m)
    } else {
      m.setIcon(getDimmedIcon(d))
      m.setzIndex(40)
    }
  })
  if (areaMarkers.length > 0) {
    nextTick(() => map.setFitView(areaMarkers, null, [60, 60, 60, 60], 400))
  }
  pulseTimer = setInterval(() => {
    pulseOn = !pulseOn
    markerMap.forEach((m) => {
      const d = m.__deviceData
      if (d.area === area) {
        m.setIcon(pulseOn ? getFlashIcon(d) : getIcon(d, true))
      }
    })
  }, 400)
}

watch(localArea, (val) => { selectArea(val) })

function toGrayish(hex) {
  // 去饱和：让颜色偏灰，保持低透明度
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const gray = Math.round(r * 0.3 + g * 0.59 + b * 0.11)
  const gr = Math.round(gray * 0.7 + r * 0.3)
  const gg = Math.round(gray * 0.7 + g * 0.3)
  const gb = Math.round(gray * 0.7 + b * 0.3)
  return '#' + [gr, gg, gb].map(v => Math.min(255, v).toString(16).padStart(2, '0')).join('')
}

function getDimmedIcon(device) {
  const color = getMarkerColor(device)
  const baseHex = color.length >= 7 ? color.slice(0, 7) : color
  const grayHex = toGrayish(baseHex)
  return new AMapRef.value.Icon({
    image: makeIcon(grayHex + '55', 36, 50),
    imageSize: new AMapRef.value.Size(36, 50),
    size: new AMapRef.value.Size(36, 50),
  })
}

function getFlashIcon(device) {
  const color = getMarkerColor(device)
  const w = 60, h = 82
  return new AMapRef.value.Icon({
    image: makeFlashIcon(color, w, h),
    imageSize: new AMapRef.value.Size(w, h),
    size: new AMapRef.value.Size(w, h),
  })
}

// 闪烁版图标（同尺寸，叠加白光层 + 更亮光晕）
const flashIconCache = {}
function makeFlashIcon(color, w, h) {
  const k = `flash_${color}_${w}x${h}`
  if (flashIconCache[k]) return flashIconCache[k]
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  drawStreetlight(ctx, color, w, h)

  // 仅灯泡区域变亮（径向渐变，灯杆灯罩不变）
  const pad = Math.round(w * 0.12)
  const domeH = Math.round(h * 0.13)
  const domeY = pad + Math.round(h * 0.04)
  const domeCY = domeY + domeH
  const bulbCY = domeCY - Math.round(domeH * 0.2)
  const bulbR = Math.round(w * 0.18)

  const flash = ctx.createRadialGradient(w / 2, bulbCY, bulbR * 0.2, w / 2, bulbCY, bulbR * 1.6)
  flash.addColorStop(0, 'rgba(255,255,255,0.55)')
  flash.addColorStop(0.5, 'rgba(255,255,255,0.2)')
  flash.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = flash
  ctx.beginPath()
  ctx.arc(w / 2, bulbCY, bulbR * 1.6, 0, Math.PI * 2)
  ctx.fill()

  flashIconCache[k] = canvas.toDataURL('image/png')
  return flashIconCache[k]
}

function toBaseHex(color) {
  return color && color.length >= 7 ? color.slice(0, 7) : color
}

function drawStreetlight(ctx, color, w, h) {
  const base = toBaseHex(color)
  const cx = w / 2
  const pad = Math.round(w * 0.12)

  // 灯罩（圆顶）
  const domeW = Math.round(w * 0.38)
  const domeH = Math.round(h * 0.13)
  const domeY = pad + Math.round(h * 0.04)
  const domeCX = cx
  const domeCY = domeY + domeH

  // 灯泡在灯罩内
  const bulbR = Math.round(domeW * 0.48)
  const bulbCY = domeCY - Math.round(domeH * 0.2)

  // 灯杆
  const poleTop = domeCY + Math.round(domeH * 0.3)
  const poleBot = h - pad
  const poleW = Math.max(4, Math.round(w * 0.1))

  // ── 地面投影 ──
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.beginPath()
  ctx.ellipse(cx, poleBot, w * 0.28, Math.round(h * 0.02), 0, 0, Math.PI * 2)
  ctx.fill()

  // ── 光晕（灯泡下方大面积柔光） ──
  const glowCY = bulbCY + domeH * 0.5
  const glowR = w * 0.44
  const glow = ctx.createRadialGradient(cx, glowCY, bulbR * 0.3, cx, glowCY, glowR)
  glow.addColorStop(0, color)
  glow.addColorStop(0.25, base + 'cc')
  glow.addColorStop(0.55, base + '44')
  glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow
  ctx.beginPath(); ctx.arc(cx, glowCY, glowR, 0, Math.PI * 2); ctx.fill()

  // ── 灯杆（上粗下细，深灰金属感） ──
  const poleGrad = ctx.createLinearGradient(cx - poleW, 0, cx + poleW, 0)
  poleGrad.addColorStop(0, '#5d6d7e')
  poleGrad.addColorStop(0.3, '#aeb6bf')
  poleGrad.addColorStop(0.5, '#d5d8dc')
  poleGrad.addColorStop(0.7, '#aeb6bf')
  poleGrad.addColorStop(1, '#4a5568')
  ctx.fillStyle = poleGrad
  ctx.beginPath()
  ctx.moveTo(cx - poleW / 2, poleTop)
  ctx.lineTo(cx - poleW * 0.3, poleBot)
  ctx.quadraticCurveTo(cx, poleBot + 1, cx + poleW * 0.3, poleBot)
  ctx.lineTo(cx + poleW / 2, poleTop)
  ctx.closePath()
  ctx.fill()

  // ── 灯颈（连接杆） ──
  const neckW = Math.round(w * 0.06)
  const neckTop = domeCY + domeH * 0.6
  ctx.fillStyle = '#7f8c8d'
  ctx.fillRect(cx - neckW / 2, neckTop, neckW, poleTop - neckTop)

  // ── 灯臂（弧形小支架） ──
  ctx.strokeStyle = '#95a5a6'
  ctx.lineWidth = Math.max(1.5, w * 0.04)
  ctx.beginPath()
  ctx.moveTo(cx - domeW * 0.35, domeCY + domeH * 0.15)
  ctx.quadraticCurveTo(cx - domeW * 0.5, domeCY - domeH * 0.1, cx - domeW * 0.3, domeCY - domeH * 0.35)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx + domeW * 0.35, domeCY + domeH * 0.15)
  ctx.quadraticCurveTo(cx + domeW * 0.5, domeCY - domeH * 0.1, cx + domeW * 0.3, domeCY - domeH * 0.35)
  ctx.stroke()

  // ── 灯罩（半椭圆，挂在灯杆顶部） ──
  const domeGrad = ctx.createLinearGradient(0, domeY, 0, domeCY + domeH * 0.5)
  domeGrad.addColorStop(0, '#7f8c8d')
  domeGrad.addColorStop(0.4, '#bdc3c7')
  domeGrad.addColorStop(1, '#5d6d7e')
  ctx.fillStyle = domeGrad
  ctx.beginPath()
  ctx.ellipse(cx, domeCY, domeW / 2, domeH, 0, Math.PI, 0)
  ctx.fill()
  ctx.strokeStyle = '#4a5568'
  ctx.lineWidth = 1
  ctx.stroke()

  // ── 灯泡（暖白发光核心） ──
  const bulbGrad = ctx.createRadialGradient(cx, bulbCY, 0, cx, bulbCY, bulbR)
  bulbGrad.addColorStop(0, '#ffffff')
  bulbGrad.addColorStop(0.25, base + 'ff')
  bulbGrad.addColorStop(0.6, color)
  bulbGrad.addColorStop(1, base + '88')
  ctx.fillStyle = bulbGrad
  ctx.beginPath(); ctx.arc(cx, bulbCY, bulbR, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = Math.max(1, w * 0.03)
  ctx.stroke()
}

// ── Canvas 路灯图标 ──
const iconCache = {}

function makeIcon(color, w, h) {
  const k = `${color}_${w}x${h}`
  if (iconCache[k]) return iconCache[k]
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  drawStreetlight(ctx, color, w, h)
  iconCache[k] = canvas.toDataURL('image/png')
  return iconCache[k]
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x, y + h)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fill()
}

function getIcon(device, hl) {
  const color = getMarkerColor(device)
  const w = hl ? 60 : 44
  const h = hl ? 82 : 60
  return new AMapRef.value.Icon({
    image: makeIcon(color, w, h),
    imageSize: new AMapRef.value.Size(w, h),
    size: new AMapRef.value.Size(w, h),
  })
}

// ── 标记与聚合 ──
function addMarkers(AMap) {
  // 清理旧标记
  markerMap.forEach(m => { m.setMap(null); m.remove() })
  markerMap.clear()

  props.devices.forEach((d) => {
    const pos = parseLocation(d.location)
    if (!pos) return

    const sc = d.status === 0 ? '#6b7f93' : d.status === 1 ? '#10b981' : d.status === 2 ? '#6b7f93' : d.status === 3 ? '#f59e0b' : '#999'
    const marker = new AMap.Marker({
      position: [pos.lng, pos.lat],
      icon: getIcon(d, false),
      anchor: 'bottom-center',
      zIndex: 100,
      label: {
        content: `<div style="font-size:10px;color:#fff;background:${sc};padding:1px 6px;border-radius:3px;white-space:nowrap;font-weight:600">${LABELS[d.status]}</div>`,
        direction: 'bottom',
        offset: new AMap.Pixel(0, 16),
      },
    })

    marker.on('click', () => {
      emit('marker-click', d)
      highlightDevice(d.deviceId)
      openInfoWindow(d, pos)
    })

    marker.__deviceData = d
    markerMap.set(d.deviceId, marker)
    marker.setMap(map)
  })

  // 如果有分区选中，重新应用分区高亮和视野；否则恢复全局视野
  if (localArea.value) {
    selectArea(localArea.value)
  } else if (markerMap.size > 0) {
    map.setFitView(Array.from(markerMap.values()))
  }
}
function openInfoWindow(device, pos) {
  if (!infoWindow) return
  const color = getMarkerColor(device)
  const label = LABELS[device.status] || '未知'
  const did = device.deviceId
  infoWindow.setContent(`
    <div class="dm-iw">
      <div class="dm-iw-name">${device.name || did}</div>
      <div class="dm-iw-row"><span>状态</span><span style="color:${color}">${label}</span></div>
      <div class="dm-iw-row"><span>健康分</span><span>${device.healthScore ?? '--'}</span></div>
      <div class="dm-iw-row"><span>区域</span><span>${device.area || '--'}</span></div>
      <span class="dm-iw-link" onclick="window.__dmNav && window.__dmNav('${did}')">查看详情 →</span>
    </div>
  `)
  infoWindow.open(map, [pos.lng, pos.lat])
}

function highlightDevice(deviceId) {
  if (currentHighlight) {
    const prev = currentHighlight
    prev.setIcon(getIcon(prev.__deviceData, false))
    currentHighlight = null
  }
  if (!deviceId) return
  const marker = markerMap.get(deviceId)
  if (!marker) return
  currentHighlight = marker
  marker.setIcon(getIcon(marker.__deviceData, true))
  map.setZoomAndCenter(18, marker.getPosition())
}

function clearHighlight() { highlightDevice(null) }

function initMap() {
  if (!mapContainerRef.value || !AMapRef.value) return
  if (map) return

  map = new AMapRef.value.Map(mapContainerRef.value, {
    mapStyle: 'amap://styles/whitesmoke',
    zoom: 14,
    center: [106.5622, 29.5621],
    animateEnable: true,
    resizeEnable: true,
  })

  infoWindow = new AMapRef.value.InfoWindow({ offset: new AMapRef.value.Pixel(0, -40) })
  addMarkers(AMapRef.value)
}

// ── 监听 ──
watch(loaded, (ok) => { if (ok) nextTick(initMap) })

watch(() => props.devices, () => {
  if (map && AMapRef.value) addMarkers(AMapRef.value)
}, { deep: true })

watch(() => props.highlightDeviceId, (id) => {
  if (id) highlightDevice(id)
  else clearHighlight()
})

onMounted(() => {
  window.__dmNav = (id) => router.push(`/devices/${id}`)
  if (loaded.value) nextTick(initMap)
  if (wrapperRef.value) {
    resizeObserver = new ResizeObserver(() => { if (map) map.resize() })
    resizeObserver.observe(wrapperRef.value)
  }
})

onUnmounted(() => {
  clearInterval(pulseTimer)
  resizeObserver?.disconnect()
  if (map) { map.destroy(); map = null }
  markerMap.clear()
  currentHighlight = null
  delete window.__dmNav
})

defineExpose({ highlightDevice, clearHighlight, fitBounds: () => {} })
</script>

<template>
  <div ref="wrapperRef" class="dm-wrapper" :style="{ height }">
    <div class="dm-hud">
      <div class="dm-hud-title">
        <span class="dm-pulse-dot"></span>
        <span>LIGHT GRID</span>
      </div>
      <div class="dm-hud-stats">
        <span><b>{{ mapStats.visible }}</b> 点位</span>
        <span><b>{{ mapStats.online }}</b> 在线</span>
        <span><b>{{ mapStats.warning }}</b> 异常</span>
      </div>
      <select v-if="areaOptions.length > 1" v-model="localArea" class="dm-area-select">
        <option value="">全部区域</option>
        <option v-for="a in areaOptions" :key="a" :value="a">{{ a }}</option>
      </select>
      <span v-if="localArea" class="dm-area-count">{{ selectedAreaCount }} 台</span>
      <button v-if="localArea" class="dm-clear-btn" @click="localArea = ''">×</button>
    </div>
    <div v-if="!loaded" class="dm-overlay">
      <span v-if="loading">地图加载中...</span>
      <span v-else-if="error" class="dm-error">{{ error }}</span>
    </div>
    <div ref="mapContainerRef" class="dm-container"></div>
    <div v-if="noLocationCount > 0" class="dm-no-loc-hint">
      {{ noLocationCount }} 台设备无位置信息，未在地图上显示
    </div>
  </div>
</template>

<style>
.dm-iw {
  min-width: 176px;
  padding: 8px 10px;
  background: rgba(255,255,255,0.96);
  border: 1px solid rgba(0,141,230,0.18);
  border-radius: 8px;
  color: #1d3148;
  font-size: 12px;
  line-height: 1.9;
  box-shadow: 0 16px 34px rgba(30, 86, 130, 0.18);
  backdrop-filter: blur(16px);
}
.dm-iw-name {
  font-size: 14px; font-weight: 600; margin-bottom: 2px;
  color: #0d1b2d; border-bottom: 1px solid rgba(0,141,230,0.16); padding-bottom: 4px;
}
.dm-iw-row { display: flex; justify-content: space-between; gap: 14px; padding: 0 2px; }
.dm-iw-link { display: inline-block; margin-top: 6px; color: #006fc2; cursor: pointer; font-size: 12px; font-weight: 600; }
.dm-iw-link:hover { text-decoration: underline; color: #008de6; }
.amap-info-content {
  padding: 0 !important;
  background: transparent !important;
  border-radius: 8px !important;
  box-shadow: none !important;
}
.amap-info-close {
  top: 8px !important;
  right: 8px !important;
  color: #40566f !important;
}
</style>

<style scoped>
.dm-wrapper {
  position: relative;
  width: 100%;
  border-radius: 14px;
  overflow: hidden;
  background:
    linear-gradient(135deg, rgba(0,141,230,0.18), rgba(22,199,232,0.08)),
    #f8fcff;
  border: 1px solid rgba(0,141,230,0.2);
  box-shadow:
    0 22px 52px rgba(30, 86, 130, 0.16),
    inset 0 1px 0 rgba(255,255,255,0.95);
}
.dm-wrapper::before {
  content: "";
  position: absolute;
  inset: 12px;
  z-index: 3;
  pointer-events: none;
  border: 1px solid rgba(0,141,230,0.14);
  border-radius: 10px;
  box-shadow: inset 0 0 34px rgba(0,141,230,0.08);
}
.dm-wrapper::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background:
    linear-gradient(90deg, transparent, rgba(0,141,230,0.16), transparent) 0 0 / 100% 2px no-repeat,
    radial-gradient(circle at 18% 12%, rgba(22,199,232,0.12), transparent 28%),
    radial-gradient(circle at 78% 82%, rgba(0,141,230,0.12), transparent 30%);
  animation: dm-scan 5s ease-in-out infinite;
}
.dm-container {
  width: 100%;
  height: 100%;
  border-radius: 14px;
  overflow: hidden;
  filter: saturate(1.08) contrast(1.02);
}
.dm-overlay {
  position: absolute; inset: 0; z-index: 8;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.78);
  color: #40566f;
  font-size: 13px;
  backdrop-filter: blur(10px);
}
.dm-error { color: #ef5350; }
.dm-hud {
  position: absolute;
  top: 52px;
  left: 22px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 9px 12px;
  border: 1px solid rgba(0,141,230,0.2);
  border-radius: 8px;
  color: #0d1b2d;
  background: rgba(255,255,255,0.86);
  box-shadow: 0 12px 28px rgba(30,86,130,0.12);
  backdrop-filter: blur(14px) saturate(1.2);
}
.dm-hud-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 800;
  color: #006fc2;
}
.dm-pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 0 4px rgba(16,185,129,0.16), 0 0 16px rgba(16,185,129,0.65);
}
.dm-hud-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #40566f;
  font-size: 12px;
}
.dm-hud-stats b {
  color: #0d1b2d;
  font-size: 13px;
}
.dm-area-select {
  height: 30px; padding: 0 28px 0 10px;
  border-radius: 6px; border: 1px solid rgba(0,141,230,0.28);
  background: rgba(255,255,255,0.92);
  color: #0d1b2d; font-size: 12px; font-weight: 500;
  cursor: pointer; outline: none; min-width: 110px;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23006fc2'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.dm-area-select:hover { border-color: rgba(77,208,225,0.5); }
.dm-area-select:focus { border-color: rgba(77,208,225,0.6); box-shadow: 0 0 0 2px rgba(77,208,225,0.15); }
.dm-area-count {
  font-size: 12px; font-weight: 600; color: #006fc2;
  background: rgba(0,141,230,0.08); padding: 3px 10px; border-radius: 12px;
  white-space: nowrap;
}
.dm-clear-btn {
  width: 26px; height: 26px; border: 1px solid rgba(0,141,230,0.25);
  border-radius: 50%; background: rgba(255,255,255,0.9);
  color: #888; font-size: 15px; cursor: pointer; line-height: 22px;
  padding: 0; text-align: center; flex-shrink: 0;
  transition: all 0.15s;
}
.dm-clear-btn:hover { background: #fff; color: #ef5350; border-color: rgba(239,83,80,0.3); }
.dm-legend {
  position: absolute;
  right: 22px;
  bottom: 22px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid rgba(0,141,230,0.18);
  border-radius: 8px;
  background: rgba(255,255,255,0.86);
  box-shadow: 0 12px 28px rgba(30,86,130,0.12);
  backdrop-filter: blur(14px) saturate(1.2);
  flex-wrap: wrap;
  max-width: 60%;
}
.dm-legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #40566f;
  font-size: 12px;
  white-space: nowrap;
}
.dm-legend i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  box-shadow: 0 0 12px currentColor;
}
.dm-legend i.online { background: #10b981; color: #10b981; }
.dm-legend i.warning { background: #f59e0b; color: #f59e0b; }
.dm-legend i.offline { background: #7b8794; color: #7b8794; }
.dm-legend .dm-area-item i { width: 6px; height: 6px; }
.dm-no-loc-hint {
  position: absolute;
  left: 50%;
  bottom: 22px;
  z-index: 7;
  transform: translateX(-50%);
  padding: 7px 12px;
  text-align: center;
  font-size: 12px;
  color: #9a6500;
  background: rgba(255,248,229,0.92);
  border: 1px solid rgba(245,158,11,0.28);
  border-radius: 999px;
  box-shadow: 0 10px 24px rgba(154,101,0,0.12);
  backdrop-filter: blur(12px);
}
@keyframes dm-scan {
  0%, 100% { background-position: 0 18%, 0 0, 0 0; opacity: 0.85; }
  50% { background-position: 0 82%, 0 0, 0 0; opacity: 1; }
}

@media (max-width: 900px) {
  .dm-hud {
    right: 18px;
    flex-wrap: wrap;
  }
  .dm-legend {
    left: 18px;
    right: auto;
    flex-wrap: wrap;
    max-width: 90%;
  }
}
</style>
