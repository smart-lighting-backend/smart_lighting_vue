<script setup>
import { ref, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { controlDevice } from '../api/devices.js'
import { parseLatestData } from '../utils/manualControlState.js'

const props = defineProps({
  devices: { type: Array, required: true },
  applyBrightness3D: { type: Function, default: null },
})

const emit = defineEmits(['close'])

const visible = ref(false)
const expandedAreas = ref(new Set())
const selectedDevices = ref(new Set())
const batchLoading = ref(false)

// 分区 + 设备树
const areaTree = computed(() => {
  const map = new Map()
  props.devices.forEach(d => {
    const area = d.area || '默认区域'
    if (!map.has(area)) map.set(area, [])
    map.get(area).push(d)
  })
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([area, devs]) => ({
      name: area,
      devices: devs.map(d => {
        const ld = parseLatestData(d.latestData)
        const isOn = ld?.action ? (ld.action !== 'OFF' && ld.brightness !== 0) : (d.status === 1)
        return {
          deviceId: d.deviceId,
          name: d.name || d.deviceId,
          status: d.status,
          isOn,
        }
      }),
    }))
})

const selectedCount = computed(() => selectedDevices.value.size)

function toggleArea(areaName) {
  if (expandedAreas.value.has(areaName)) {
    expandedAreas.value.delete(areaName)
  } else {
    expandedAreas.value.add(areaName)
  }
  // trigger reactivity
  expandedAreas.value = new Set(expandedAreas.value)
}

function isAreaFullySelected(area) {
  return area.devices.every(d => selectedDevices.value.has(d.deviceId))
}

function isAreaPartiallySelected(area) {
  return area.devices.some(d => selectedDevices.value.has(d.deviceId)) && !isAreaFullySelected(area)
}

function toggleAreaSelect(area) {
  if (isAreaFullySelected(area)) {
    area.devices.forEach(d => selectedDevices.value.delete(d.deviceId))
  } else {
    area.devices.forEach(d => selectedDevices.value.add(d.deviceId))
  }
  selectedDevices.value = new Set(selectedDevices.value)
}

function toggleDevice(deviceId) {
  if (selectedDevices.value.has(deviceId)) {
    selectedDevices.value.delete(deviceId)
  } else {
    selectedDevices.value.add(deviceId)
  }
  selectedDevices.value = new Set(selectedDevices.value)
}

function toggleAll() {
  if (selectedDevices.value.size > 0) {
    selectedDevices.value = new Set()
  } else {
    props.devices.forEach(d => selectedDevices.value.add(d.deviceId))
    selectedDevices.value = new Set(selectedDevices.value)
  }
}

async function batchControl(action) {
  if (batchLoading.value || selectedDevices.value.size === 0) return
  batchLoading.value = true
  const ids = [...selectedDevices.value]
  let ok = 0
  for (const deviceId of ids) {
    try {
      await controlDevice(deviceId, { action })
      if (props.applyBrightness3D) {
        const bVal = action === 'OFF' ? 0 : 100
        props.applyBrightness3D(deviceId, bVal)
      }
      ok++
    } catch (e) {
      console.warn('[batch] control failed:', deviceId, e)
    }
  }
  batchLoading.value = false
  ElMessage.success(`${action === 'ON' ? '开灯' : '关灯'}完成：${ok}/${ids.length} 台`)
}

function open() {
  visible.value = true
  selectedDevices.value = new Set()
  expandedAreas.value = new Set()
}

defineExpose({ open })
</script>

<template>
  <Transition name="panel-slide">
    <div v-if="visible" class="batch-panel">
      <div class="batch-header">
        <span class="batch-title">
          <svg viewBox="0 0 24 24" fill="none" width="15" height="15"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
          批量控制
        </span>
        <button class="batch-close" @click="visible = false">
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M6 6l12 12M6 18L18 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>

      <div class="batch-body">
        <!-- 全选/全不选 -->
        <label class="batch-select-all" @click.stop="toggleAll()">
          <span class="batch-check" :class="{ on: selectedCount > 0, half: selectedCount > 0 && selectedCount < devices.length }"></span>
          <span>全部设备 ({{ devices.length }} 台)</span>
          <span v-if="selectedCount > 0" class="batch-count">已选 {{ selectedCount }} 台</span>
        </label>

        <!-- 分区列表 -->
        <div v-for="area in areaTree" :key="area.name" class="batch-area">
          <div class="batch-area-header" @click="toggleArea(area.name)">
            <svg :class="['batch-arrow', { open: expandedAreas.has(area.name) }]" viewBox="0 0 24 24" fill="none" width="12" height="12">
              <path d="M8 4l8 8-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="batch-check" :class="{ on: isAreaFullySelected(area), half: isAreaPartiallySelected(area) }" @click.stop="toggleAreaSelect(area)"></span>
            <span class="batch-area-name">{{ area.name }}</span>
            <span class="batch-area-count">({{ area.devices.length }})</span>
          </div>

          <div v-show="expandedAreas.has(area.name)" class="batch-devices">
            <label v-for="d in area.devices" :key="d.deviceId" class="batch-device" @click.stop="toggleDevice(d.deviceId)">
              <span class="batch-check" :class="{ on: selectedDevices.has(d.deviceId) }"></span>
              <span class="batch-device-name">{{ d.name }}</span>
              <span class="batch-device-id">{{ d.deviceId }}</span>
              <span :class="['batch-device-state', d.isOn ? 'on' : 'off']">{{ d.isOn ? '开灯' : '关灯' }}</span>
            </label>
          </div>
        </div>

        <div v-if="areaTree.length === 0" class="batch-empty">暂无设备数据</div>
      </div>

      <!-- 底部操作栏 -->
      <div class="batch-footer">
        <span class="batch-footer-info">已选 {{ selectedCount }} / {{ devices.length }} 台</span>
        <button class="batch-btn on" :disabled="batchLoading || selectedCount === 0" @click="batchControl('ON')">
          <svg viewBox="0 0 24 24" fill="none" width="13" height="13"><path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7z" fill="currentColor"/></svg>
          {{ batchLoading ? '执行中...' : '全部开灯' }}
        </button>
        <button class="batch-btn off" :disabled="batchLoading || selectedCount === 0" @click="batchControl('OFF')">
          <svg viewBox="0 0 24 24" fill="none" width="13" height="13"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" fill="currentColor"/></svg>
          {{ batchLoading ? '执行中...' : '全部关灯' }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.batch-panel {
  position: absolute; top: 54px; right: 8px; z-index: 20;
  width: 296px; max-height: calc(100% - 80px);
  background: rgba(6, 18, 40, 0.97);
  border: 1px solid rgba(77, 208, 225, 0.18);
  border-radius: 8px;
  display: flex; flex-direction: column;
  backdrop-filter: blur(12px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.batch-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(77, 208, 225, 0.1);
}
.batch-title {
  display: flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 600; color: #4dd0e1;
}
.batch-close {
  background: none; border: none; color: rgba(140, 190, 220, 0.5);
  cursor: pointer; padding: 2px; border-radius: 3px;
}
.batch-close:hover { color: rgba(220, 230, 240, 0.8); background: rgba(255,255,255,0.06); }
.batch-body {
  flex: 1; overflow-y: auto; padding: 8px 0;
}
.batch-body::-webkit-scrollbar { width: 3px; }
.batch-body::-webkit-scrollbar-thumb { background: rgba(77, 208, 225, 0.15); border-radius: 2px; }

.batch-select-all {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 14px; cursor: pointer;
  font-size: 12px; color: rgba(180, 220, 240, 0.7);
  border-bottom: 1px solid rgba(77, 208, 225, 0.06);
}
.batch-select-all:hover { background: rgba(0, 120, 200, 0.08); }
.batch-count { margin-left: auto; font-size: 11px; color: #4dd0e1; }

.batch-area { border-bottom: 1px solid rgba(77, 208, 225, 0.04); }
.batch-area-header {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 14px; cursor: pointer;
  font-size: 12px; color: rgba(160, 210, 240, 0.75);
}
.batch-area-header:hover { background: rgba(0, 120, 200, 0.06); }
.batch-arrow { transition: transform 0.2s; color: rgba(140, 190, 220, 0.4); }
.batch-arrow.open { transform: rotate(90deg); }
.batch-area-name { font-weight: 500; }
.batch-area-count { font-size: 10px; color: rgba(140, 190, 220, 0.4); }

.batch-devices { padding: 0 0 2px 0; }
.batch-device {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 14px 5px 34px; cursor: pointer;
  font-size: 11px; color: rgba(140, 190, 220, 0.6);
}
.batch-device:hover { background: rgba(0, 120, 200, 0.06); color: rgba(180, 220, 240, 0.8); }
.batch-device-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.batch-device-id { font-size: 10px; color: rgba(140, 190, 220, 0.3); }
.batch-device-state { font-size: 10px; font-weight: 500; }
.batch-device-state.on { color: #4caf82; }
.batch-device-state.off { color: rgba(140, 190, 220, 0.35); }

.batch-check {
  width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0;
  border: 1.5px solid rgba(77, 208, 225, 0.25);
  background: transparent;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.batch-check.on {
  background: rgba(77, 208, 225, 0.25); border-color: #4dd0e1;
}
.batch-check.on::after { content: '✓'; font-size: 10px; color: #4dd0e1; line-height: 1; }
.batch-check.half {
  background: rgba(77, 208, 225, 0.1); border-color: rgba(77, 208, 225, 0.4);
}
.batch-check.half::after { content: '−'; font-size: 12px; color: rgba(77, 208, 225, 0.6); line-height: 1; }

.batch-empty { padding: 30px 14px; text-align: center; font-size: 12px; color: rgba(140, 190, 220, 0.3); }

.batch-footer {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid rgba(77, 208, 225, 0.1);
}
.batch-footer-info { font-size: 10px; color: rgba(140, 190, 220, 0.4); flex: 1; }
.batch-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 12px; border: none; border-radius: 4px;
  font-size: 11px; font-weight: 500; cursor: pointer;
  transition: all 0.2s;
}
.batch-btn.on {
  background: rgba(76, 175, 80, 0.15); color: #81c784;
  border: 1px solid rgba(76, 175, 80, 0.25);
}
.batch-btn.on:hover:not(:disabled) { background: rgba(76, 175, 80, 0.25); }
.batch-btn.off {
  background: rgba(239, 83, 80, 0.12); color: #e57373;
  border: 1px solid rgba(239, 83, 80, 0.2);
}
.batch-btn.off:hover:not(:disabled) { background: rgba(239, 83, 80, 0.2); }
.batch-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.panel-slide-enter-active, .panel-slide-leave-active {
  transition: all 0.25s ease;
}
.panel-slide-enter-from, .panel-slide-leave-to {
  opacity: 0; transform: translateX(20px);
}
</style>
