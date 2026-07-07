<script setup>
import { ref, computed, watch, onUnmounted, nextTick } from 'vue'
import { useAMap } from '../composables/useAMap.js'
import { parseLocation } from '../utils/coordinate.js'
import { makeStreetlightIcon, makeFlashIcon, getDeviceColor, getAreaColor } from '../utils/streetlightIcon.js'

const props = defineProps({
  modelValue: { type: Object, default: () => ({ lng: '', lat: '' }) },
  visible: { type: Boolean, default: false },
  devices: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue', 'update:visible', 'confirm'])

const { AMap: AMapRef, loaded, loading, error, retry } = useAMap()
const mapContainerRef = ref(null)

const currentLng = ref('')
const currentLat = ref('')
const confirmMsg = ref('')

const searchDeviceId = ref('')
const addressInput = ref('')
const addressResults = ref([])
const searching = ref(false)

// 区域筛选
const selectedArea = ref('')
const areaOptions = computed(() => {
  const areas = [...new Set(props.devices.map(d => d.area).filter(Boolean))]
  return areas.sort()
})
const filteredDevices = computed(() => {
  if (!selectedArea.value) return props.devices
  return props.devices.filter(d => d.area === selectedArea.value)
})

const deviceOptions = computed(() =>
  filteredDevices.value.map(d => ({ value: d.deviceId, label: `${d.name || d.deviceId} (${d.deviceId})` }))
)

const areaLegend = computed(() => {
  const seen = {}
  return props.devices.reduce((acc, d) => {
    if (d.area && !seen[d.area]) {
      seen[d.area] = true
      acc.push({ name: d.area, color: getAreaColor(d.area) })
    }
    return acc
  }, [])
})

let map = null
let pinMarker = null
let origMarker = null
let deviceMarkers = []
let geocoder = null
let pulseTimer = null
let pulseOn = false
let searchPulseTimer = null
let searchPulseOn = false

function flashMarker(marker, color, w, h, on) {
  const fn = on ? makeFlashIcon : makeStreetlightIcon
  marker.setIcon(new AMapRef.value.Icon({
    image: fn(color, w, h),
    imageSize: new AMapRef.value.Size(w, h),
    size: new AMapRef.value.Size(w, h),
  }))
}

function updateCoords(lng, lat) {
  const a = Number(lng), b = Number(lat)
  if (isNaN(a) || isNaN(b)) return
  confirmMsg.value = ''
  currentLng.value = a.toFixed(6)
  currentLat.value = b.toFixed(6)
  placePin(a, b)
}

function placePin(lng, lat) {
  if (!map || !AMapRef.value) return
  if (pinMarker) {
    pinMarker.setPosition([lng, lat])
  } else {
    const html = `<div style="width:24px;height:34px;position:relative">
      <div style="position:absolute;bottom:0;left:50%;margin-left:-10px;width:20px;height:20px;background:#ff4444;border:2.5px solid #fff;border-radius:50%;box-shadow:0 2px 10px rgba(255,50,50,0.5);"></div>
      <div style="position:absolute;bottom:17px;left:50%;margin-left:-2px;width:4px;height:14px;background:#cc0000;border-radius:1px;"></div>
    </div>`
    pinMarker = new AMapRef.value.Marker({
      position: [lng, lat],
      content: html,
      anchor: 'bottom-center',
      zIndex: 300,
    })
    pinMarker.setMap(map)
  }
}

function placeOrigMarker(lng, lat) {
  if (!map || !AMapRef.value) return
  if (origMarker) origMarker.setMap(null)
  const html = `<div style="position:relative;width:32px;height:32px;display:flex;align-items:center;justify-content:center">
    <div class="orig-pulse-ring"></div>
    <div style="width:18px;height:18px;background:#ff1493;border:3px solid #fff;border-radius:50%;box-shadow:0 0 20px rgba(255,20,147,0.9),0 0 40px rgba(255,105,180,0.5);position:relative;z-index:2"></div>
    <div style="position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);color:#ff69b4;font-size:10px;padding:1px 5px;border-radius:3px;white-space:nowrap;font-weight:bold">原位</div>
  </div>`
  origMarker = new AMapRef.value.Marker({
    position: [lng, lat],
    content: html,
    anchor: "center",
    zIndex: 260,
  })
  origMarker.setMap(map)
}

function retryLoadMap() { retry() }

function onMapClick(e) {
  updateCoords(e.lnglat.getLng(), e.lnglat.getLat())
}

// ── 已有设备标记（路灯图标） ──
function addDeviceMarkers() {
  deviceMarkers.forEach(m => m.setMap(null))
  deviceMarkers = []

  filteredDevices.value.forEach(d => {
    const pos = parseLocation(d.location)
    if (!pos) return
    const color = getDeviceColor(d)
    const iconImage = makeStreetlightIcon(color, 30, 41)
    const m = new AMapRef.value.Marker({
      position: [pos.lng, pos.lat],
      icon: new AMapRef.value.Icon({
        image: iconImage,
        imageSize: new AMapRef.value.Size(30, 41),
        size: new AMapRef.value.Size(30, 41),
      }),
      anchor: 'bottom-center',
      zIndex: 100,
    })
    m.__deviceData = d
    m.on('click', () => {
      updateCoords(pos.lng, pos.lat)
      map.setZoomAndCenter(17, [pos.lng, pos.lat])
    })
    m.setMap(map)
    deviceMarkers.push(m)
  })

  // 选区分组后适配视野
  if (deviceMarkers.length > 0 && selectedArea.value) {
    map.setFitView(deviceMarkers)
  }

  // 闪烁动画 — 仅选中区域时启动
  clearInterval(pulseTimer)
  pulseOn = false
  if (deviceMarkers.length > 0 && selectedArea.value) {
    pulseTimer = setInterval(() => {
      pulseOn = !pulseOn
      deviceMarkers.forEach(m => {
        const d = m.__deviceData
        if (!d) return
        flashMarker(m, getDeviceColor(d), 30, 41, pulseOn)
      })
    }, 400)
  }
}

watch(selectedArea, () => { addDeviceMarkers() })

// ── 设备搜索 ──
function onDeviceSelect(deviceId) {
  // 清除上一次搜索闪烁
  clearInterval(searchPulseTimer)
  searchPulseOn = false

  if (!deviceId) {
    searchDeviceId.value = ''
    return
  }
  const d = props.devices.find(x => x.deviceId === deviceId)
  if (!d) return
  const pos = parseLocation(d.location)
  if (!pos) return
  updateCoords(pos.lng, pos.lat)
  map.setZoomAndCenter(17, [pos.lng, pos.lat])

  // 给搜到的设备加闪烁
  const marker = deviceMarkers.find(m => m.__deviceData?.deviceId === deviceId)
  if (marker) {
    const color = getDeviceColor(marker.__deviceData)
    searchPulseTimer = setInterval(() => {
      searchPulseOn = !searchPulseOn
      flashMarker(marker, color, 30, 41, searchPulseOn)
    }, 400)
  }
}

// ── 地址搜索 ──
let searchTimer = null
function onAddressInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(doAddressSearch, 400)
}
async function doAddressSearch() {
  const q = addressInput.value.trim()
  if (!q || q.length < 2) { addressResults.value = []; return }
  if (!geocoder && AMapRef.value) {
    await new Promise(resolve => {
      AMapRef.value.plugin('AMap.Geocoder', () => {
        geocoder = new AMapRef.value.Geocoder({ city: '全国' })
        resolve()
      })
    })
  }
  if (!geocoder) return
  searching.value = true
  geocoder.getLocation(q, (status, result) => {
    searching.value = false
    if (status === 'complete' && result.info === 'OK') {
      addressResults.value = result.geocodes.map(g => ({
        label: g.formattedAddress || g.name,
        lng: g.location.getLng(),
        lat: g.location.getLat(),
      }))
    } else {
      addressResults.value = []
    }
  })
}
function selectAddress(item) {
  updateCoords(item.lng, item.lat)
  map.setZoomAndCenter(17, [item.lng, item.lat])
  addressResults.value = []
  addressInput.value = ''
}

// ── 确认 / 取消 ──
function confirm() {
  if (!currentLng.value || !currentLat.value) {
    confirmMsg.value = '请在地图上点击选择设备安装位置'
    return
  }
  emit('update:modelValue', { lng: currentLng.value, lat: currentLat.value })
  emit('confirm', { lng: currentLng.value, lat: currentLat.value })
  emit('update:visible', false)
}
function cancel() { emit('update:visible', false) }

// ── 地图初始化 ──
function initMap() {
  if (!mapContainerRef.value || !AMapRef.value || map) return
  map = new AMapRef.value.Map(mapContainerRef.value, { mapStyle: 'amap://styles/whitesmoke', zoom: 5, center: [104, 35] })
  map.on('click', onMapClick)
  addDeviceMarkers()
  const iLng = parseFloat(props.modelValue.lng)
  const iLat = parseFloat(props.modelValue.lat)
  if (!isNaN(iLng) && !isNaN(iLat)) {
    placeOrigMarker(iLng, iLat)
    updateCoords(iLng, iLat)
    map.setZoomAndCenter(17, [iLng, iLat])
  }
}

watch(loaded, (ok) => { if (ok) nextTick(initMap) })
watch(() => props.visible, (v) => {
  if (v) {
    currentLng.value = props.modelValue.lng || ''
    currentLat.value = props.modelValue.lat || ''
    confirmMsg.value = ''
    addressInput.value = ''
    addressResults.value = []
    searchDeviceId.value = ''
    selectedArea.value = ''
    nextTick(() => { if (loaded.value) { initMap(); addDeviceMarkers() } })
  } else {
    clearInterval(pulseTimer)
    clearInterval(searchPulseTimer)
    if (pinMarker) { pinMarker.setMap(null); pinMarker = null }
    if (origMarker) { origMarker.setMap(null); origMarker = null }
    deviceMarkers.forEach(m => m.setMap(null))
    deviceMarkers = []
    if (map) { map.destroy(); map = null }
  }
})

onUnmounted(() => {
  clearInterval(pulseTimer)
  clearInterval(searchPulseTimer)
  deviceMarkers.forEach(m => m.setMap(null))
  deviceMarkers = []
  if (origMarker) { origMarker.setMap(null); origMarker = null }
  if (pinMarker) { pinMarker.setMap(null); pinMarker = null }
  if (map) { map.destroy(); map = null }
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="lp-overlay">
      <div class="lp-topbar">
        <span class="lp-title">地图选点 — 点击地图放置路灯位置</span>
        <div class="lp-search-group">
          <select v-if="areaOptions.length > 1" v-model="selectedArea" class="lp-area-select">
            <option value="">全部区域</option>
            <option v-for="a in areaOptions" :key="a" :value="a">{{ a }}</option>
          </select>
          <el-select
            v-model="searchDeviceId" filterable clearable
            placeholder="选择已有设备或搜索..." size="small" class="lp-device-select"
            popper-class="lp-device-popper"
            :teleported="false"
            @change="onDeviceSelect"
          >
            <el-option
              v-for="opt in deviceOptions" :key="opt.value"
              :label="opt.label" :value="opt.value"
            />
          </el-select>
          <div class="lp-addr-wrap">
            <input v-model="addressInput" class="lp-addr-input"
              placeholder="输入地址搜索，如 重庆市渝中区..." @input="onAddressInput" />
            <div v-if="addressResults.length" class="lp-addr-results">
              <div v-for="(item, i) in addressResults" :key="i" class="lp-addr-item" @click="selectAddress(item)">
                📍 {{ item.label }}
              </div>
            </div>
            <span v-if="searching" class="lp-searching">搜索中...</span>
          </div>
        </div>
        <div class="lp-top-actions">
          <button class="lp-btn-cancel" @click="cancel">取消</button>
          <button class="lp-btn-confirm" @click="confirm">确认选择</button>
        </div>
      </div>

      <div class="lp-map-wrap">
        <div v-if="!loaded" class="lp-loading">
          <span v-if="loading">地图加载中...</span>
          <template v-else-if="error">
            <span>{{ error }}</span>
            <button class="lp-retry-btn" @click="retryLoadMap">重试</button>
          </template>
        </div>
        <div ref="mapContainerRef" class="lp-map"></div>
      </div>

      <div class="lp-bottombar">
        <div class="lp-info">
          <svg viewBox="0 0 24 24" fill="none" width="18" height="18"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="#4dd0e1"/></svg>
          <template v-if="currentLng && currentLat">
            经度 <strong>{{ currentLng }}°E</strong> &nbsp; 纬度 <strong>{{ currentLat }}°N</strong>
          </template>
          <template v-else>点击地图放置标记，或搜索设备/地址定位</template>
        </div>
        <div class="lp-legend">
          <span class="lp-legend-item"><i style="background:#ff4444"></i> 新选点</span>
          <span class="lp-legend-item"><i style="background:#ff1493"></i> 原位</span>
          <span v-for="a in areaLegend" :key="a.name" class="lp-legend-item">
            <i :style="{ background: a.color, boxShadow: '0 0 6px ' + a.color }"></i> {{ a.name }}
          </span>
        </div>
        <div v-if="confirmMsg" class="lp-warn">{{ confirmMsg }}</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lp-overlay {
  position: fixed; inset: 0; z-index: 3000;
  display: flex; flex-direction: column;
  background: #060e1f;
}
.lp-topbar {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 20px; flex-shrink: 0;
  background: rgba(8,20,45,0.95);
  border-bottom: 1px solid rgba(0,120,200,0.2);
}
.lp-title { font-size: 15px; font-weight: 600; color: #d0eaf8; white-space: nowrap; }
.lp-search-group { display: flex; align-items: center; gap: 8px; flex: 1; }
.lp-area-select {
  height: 32px; padding: 0 8px; border-radius: 6px;
  border: 1px solid rgba(0,120,200,0.25);
  background: rgba(0,30,70,0.6); color: #d0eaf8;
  font-size: 13px; cursor: pointer; outline: none; min-width: 90px;
}
.lp-area-select:focus { border-color: rgba(77,208,225,0.5); }
.lp-device-select { width: 260px; }
.lp-device-select :deep(.el-input__wrapper) {
  background: rgba(0,30,70,0.6); border-color: rgba(0,120,200,0.25); box-shadow: none;
}
.lp-device-select :deep(.el-input__inner) { color: #d0eaf8; }
.lp-device-select :deep(.el-select-dropdown) {
  background: #0d1b33; border: 1px solid rgba(0,120,200,0.3);
}
.lp-device-select :deep(.el-select-dropdown__item) {
  color: #d0eaf8;
}
.lp-device-select :deep(.el-select-dropdown__item.hover),
.lp-device-select :deep(.el-select-dropdown__item:hover) {
  background: rgba(0,100,180,0.25);
}
.lp-device-select :deep(.el-select-dropdown__item.selected) {
  color: #4dd0e1; font-weight: 600;
}

.lp-addr-wrap { flex: 1; position: relative; }
.lp-addr-input {
  width: 100%; padding: 6px 12px;
  background: rgba(0,30,70,0.6); border: 1px solid rgba(0,120,200,0.25);
  border-radius: 6px; color: #d0eaf8; font-size: 13px; outline: none;
}
.lp-addr-input::placeholder { color: rgba(100,160,200,0.4); }
.lp-addr-input:focus { border-color: rgba(77,208,225,0.5); }
.lp-addr-results {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 20;
  background: #0d1b33; border: 1px solid rgba(0,120,200,0.3);
  border-radius: 6px; max-height: 200px; overflow-y: auto; margin-top: 4px;
}
.lp-addr-item {
  padding: 8px 12px; cursor: pointer; font-size: 13px; color: #d0eaf8;
}
.lp-addr-item:hover { background: rgba(0,100,180,0.2); }
.lp-searching { font-size: 12px; color: rgba(140,190,220,0.4); margin-top: 4px; display: block; }

.lp-top-actions { display: flex; gap: 8px; flex-shrink: 0; }
.lp-btn-cancel {
  padding: 8px 18px; border-radius: 6px; font-size: 13px;
  background: rgba(0,50,100,0.3); border: 1px solid rgba(0,100,160,0.3);
  color: rgba(180,210,230,0.7); cursor: pointer;
}
.lp-btn-cancel:hover { background: rgba(0,80,140,0.3); }
.lp-btn-confirm {
  padding: 8px 18px; border-radius: 6px; font-size: 13px;
  background: linear-gradient(135deg, #0077cc, #0099e6);
  border: none; color: #fff; cursor: pointer; font-weight: 500;
}
.lp-btn-confirm:hover { box-shadow: 0 2px 12px rgba(0,150,230,0.3); }

.lp-map-wrap { flex: 1; position: relative; }
.lp-map { width: 100%; height: 100%; }
.lp-loading {
  position: absolute; inset: 0; z-index: 2;
  display: flex; align-items: center; justify-content: center;
  background: rgba(8,20,45,0.6); color: rgba(140,190,220,0.6); font-size: 14px;
}

.lp-bottombar {
  padding: 10px 20px; flex-shrink: 0;
  background: rgba(8,20,45,0.95);
  border-top: 1px solid rgba(0,120,200,0.2);
  display: flex; align-items: center; gap: 20px;
}
.lp-info {
  display: flex; align-items: center; gap: 10px;
  font-size: 14px; color: rgba(180,210,240,0.7); flex: 1;
}
.lp-info strong { color: #4dd0e1; font-family: monospace; font-size: 15px; }

.lp-legend { display: flex; gap: 14px; flex-shrink: 0; flex-wrap: wrap; }
.lp-legend-item { font-size: 12px; color: rgba(140,190,220,0.55); display: flex; align-items: center; gap: 4px; }
.lp-legend-item i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.7); }

.lp-warn { color: #ef5350; font-size: 13px; flex-shrink: 0; }

.orig-pulse-ring {
  position: absolute; z-index: 1;
  width: 28px; height: 28px;
  border: 2.5px solid rgba(255,20,147,0.6);
  border-radius: 50%;
  animation: origPulse 1.6s ease-out infinite;
}
@keyframes origPulse {
  0%   { transform: scale(0.8); opacity: 1; }
  100% { transform: scale(2.0); opacity: 0; }
}

.lp-retry-btn {
  margin-top: 10px; padding: 5px 18px;
  background: rgba(0,120,200,0.25); border: 1px solid rgba(0,150,220,0.4);
  border-radius: 6px; color: #4dd0e1; cursor: pointer; font-size: 13px;
  transition: all 0.2s;
}
.lp-retry-btn:hover { background: rgba(0,120,200,0.4); border-color: #4dd0e1; }
</style>