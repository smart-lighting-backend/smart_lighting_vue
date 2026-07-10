<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import { fetchDeviceNodes, controlDevice, unlockDevice } from '../api/devices.js'
import { getControlHistory } from '../api/control.js'
import { useAutoRefresh } from '../composables/useAutoRefresh.js'
import {
  isManualModeActive,
  parseLatestData,
  resolveManualControlState,
} from '../utils/manualControlState.js'

const props = defineProps({
  initialDeviceId: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const MANUAL_CONTROL_STATE_EVENT = 'manual-control-state-change'
const MANUAL_LOCK_MINUTES = 30

const nodes = ref([])
const selectedNode = ref(null)
const power = ref(true)
const brightness = ref(75)
const hasChanges = ref(false)
const logs = ref([
  { time: '14:00:12', type: 'system', text: '系统初始化连接完成 ...' },
  { time: '14:01:05', text: '节点状态同步：在线，亮度 50%' },
])
const sending = ref(false)
const logsContainer = ref(null)
let stateRequestSeq = 0

function nodeDeviceId(node) {
  return node?.deviceId || node?.id
}

function applyResolvedState(state) {
  if (!state) return
  power.value = state.power
  brightness.value = state.brightness
}

async function fetchLatestControlRecord(node) {
  const id = nodeDeviceId(node)
  if (!id) return null
  try {
    const res = await getControlHistory(id, 1, 1)
    return res?.data?.list?.[0] || null
  } catch {
    return null
  }
}

async function applyDeviceState(node) {
  const seq = ++stateRequestSeq
  const latestRecord = await fetchLatestControlRecord(node)
  const state = resolveManualControlState(node, latestRecord, 75)
  if (seq !== stateRequestSeq) return
  applyResolvedState(state)
}

// 设备状态每 20 秒自动同步
useAutoRefresh(async () => {
  if (!nodes.value.length) return
  const r = await fetchDeviceNodes()
  const list = Array.isArray(r) ? r : (r.data || [])
  nodes.value = list
  if (selectedNode.value) {
    const updated = list.find(n => nodeDeviceId(n) === currentDeviceId())
    if (updated) {
      selectedNode.value = updated
      await applyDeviceState(updated)
    }
  }
}, { interval: 20000, isSensitive: () => sending.value })

onMounted(async () => {
  const res = await fetchDeviceNodes()
  const raw = Array.isArray(res) ? res : (res.data || [])
  nodes.value = raw
  if (nodes.value.length) {
    if (props.initialDeviceId) {
      const match = nodes.value.find(n => (n.deviceId || n.id) === props.initialDeviceId)
      selectedNode.value = match || nodes.value[0]
    } else {
      selectedNode.value = nodes.value[0]
    }
    await applyDeviceState(selectedNode.value)
  }
})

watch(selectedNode, (node) => {
  if (node) applyDeviceState(node)
})

const nodeDisplayName = computed(() => selectedNode.value
  ? `节点 #${selectedNode.value.deviceId || selectedNode.value.id}`
  : '未选择节点'
)

function addLog(text, type = '') {
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`
  logs.value.push({ time, type, text })
  setTimeout(() => {
    if (logsContainer.value) {
      logsContainer.value.scrollTop = logsContainer.value.scrollHeight
    }
  }, 50)
}

// 获取当前节点的 deviceId（后端接口使用业务编号）
function currentDeviceId() {
  return nodeDeviceId(selectedNode.value)
}

function manualActionValue(action, nextBrightness) {
  return action === 'DIMMING' ? `DIMMING(${nextBrightness})` : action
}

function markManualControlSuccess(action) {
  if (!selectedNode.value) return

  const nextBrightness = action === 'OFF'
    ? 0
    : action === 'ON'
      ? (brightness.value || 100)
      : brightness.value
  const nextAction = manualActionValue(action, nextBrightness)
  const manualExpireAt = new Date(Date.now() + MANUAL_LOCK_MINUTES * 60 * 1000).toISOString()
  const latestData = {
    ...(parseLatestData(selectedNode.value.latestData) || {}),
    action: nextAction,
    brightness: nextBrightness,
  }

  Object.assign(selectedNode.value, {
    manualMode: true,
    manualExpireAt,
    latestData: JSON.stringify(latestData),
  })
  applyResolvedState({ power: action !== 'OFF', brightness: nextBrightness })

  const id = currentDeviceId()
  if (typeof window !== 'undefined' && id) {
    window.dispatchEvent(new CustomEvent(MANUAL_CONTROL_STATE_EVENT, {
      detail: {
        deviceId: id,
        action: nextAction,
        brightness: nextBrightness,
        manualMode: true,
        manualExpireAt,
        issuedAt: new Date().toISOString(),
      },
    }))
  }
}

function closeModal() {
  emit('close')
}

async function togglePower() {
  if (!selectedNode.value) return
  power.value = !power.value
  hasChanges.value = true
  // 接口文档: action 为 ON / OFF / DIMMING
  const action = power.value ? 'ON' : 'OFF'
  addLog(`🔌 指令已下发：主路灯电源 ${action}`, 'cmd')
  sending.value = true
  try {
    await controlDevice(currentDeviceId(), { action })
    markManualControlSuccess(action)
    addLog(`✅ 节点响应：电源 ${action} 成功`)
  } catch (e) {
    addLog(`❌ 节点无响应：${e?.message || '请检查连接'}`, 'error')
  } finally {
    sending.value = false
  }
}

async function setBrightness() {
  if (!selectedNode.value) return
  hasChanges.value = true
  // 接口文档: DIMMING 指令必须提供 brightness(0-100)
  addLog(`🌟 指令已下发：设置亮度 ${brightness.value}%`, 'cmd')
  sending.value = true
  try {
    await controlDevice(currentDeviceId(), { action: 'DIMMING', brightness: brightness.value })
    markManualControlSuccess('DIMMING')
    addLog(`✅ 节点响应：亮度已设置为 ${brightness.value}%`)
  } catch (e) {
    addLog(`❌ 节点无响应：${e?.message || '指令超时'}`, 'error')
  } finally {
    sending.value = false
  }
}

async function syncStatus() {
  if (!selectedNode.value) return
  addLog('🔄 正在重新读取设备状态 ...')
  try {
    const res = await fetchDeviceNodes()
    const raw = Array.isArray(res) ? res : (res.data || [])
    const updated = raw.find(n => (n.deviceId || n.id) === currentDeviceId())
    if (updated) {
      selectedNode.value = updated
      await applyDeviceState(updated)
      addLog(`✅ 同步完成：电源 ${power.value ? 'ON' : 'OFF'}，亮度 ${brightness.value}%`)
    } else {
      addLog('⚠️ 未找到该设备的最新状态')
    }
  } catch (e) {
    addLog(`❌ 同步失败：${e?.message || '请检查连接'}`, 'error')
  }
}

const isManualMode = computed(() => {
  return isManualModeActive(selectedNode.value)
})

const manualExpireText = computed(() => {
  if (!selectedNode.value?.manualExpireAt) return ''
  const d = new Date(selectedNode.value.manualExpireAt)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
})

async function releaseManualLock() {
  if (!selectedNode.value) return
  hasChanges.value = true
  addLog('🔓 正在解除手动锁定 ...')
  try {
    await unlockDevice(currentDeviceId())
    if (selectedNode.value) {
      selectedNode.value.manualMode = false
      selectedNode.value.manualExpireAt = null
    }
    addLog('✅ 手动锁定已解除，设备恢复自动控制')
  } catch (e) {
    addLog(`❌ 解除锁定失败：${e?.message || '请检查连接'}`, 'error')
  }
}
</script>

<template>
  <div class="modal-overlay" @click.self="closeModal()">
    <div class="modal-panel">
      <!-- 关闭 -->
      <button class="modal-close" @click="closeModal()">
        <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>

      <!-- 节点信息头 -->
      <div class="panel-header">
        <div class="panel-header-left">
          <span class="panel-icon">
            <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" fill="currentColor" opacity="0.6"/><rect x="14" y="3" width="7" height="7" rx="1" fill="currentColor" opacity="0.6"/><rect x="3" y="14" width="7" height="7" rx="1" fill="currentColor" opacity="0.6"/><rect x="14" y="14" width="7" height="7" rx="1" fill="currentColor" opacity="0.6"/></svg>
          </span>
          <div>
            <div class="panel-title">{{ nodeDisplayName }}</div>
            <div class="panel-location">
              <svg viewBox="0 0 24 24" fill="none" width="12" height="12"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/></svg>
              {{ selectedNode?.location || '高新科技园南区主干道' }}
            </div>
          </div>
        </div>
        <div class="panel-brightness-display">
          <span class="brightness-value">{{ power ? brightness : 0 }}</span>
          <span class="brightness-unit">%</span>
        </div>
      </div>

      <!-- 节点选择 -->
      <div class="section" v-if="nodes.length > 0">
        <label class="section-label">选择节点</label>
        <select class="node-select" v-model="selectedNode">
          <option v-for="n in nodes" :key="n.deviceId || n.id" :value="n">{{ n.deviceId || n.id }} — {{ n.name }}</option>
        </select>
      </div>

      <!-- 在线状态标签 -->
      <div class="status-tag">
        <span class="dot" :class="selectedNode?.status === 1 ? 'online' : 'offline'"></span>
        {{ selectedNode?.status === 1 ? 'ONLINE' : 'OFFLINE' }}
      </div>

      <!-- 手动模式标识 -->
      <div v-if="isManualMode" class="manual-mode-banner">
        <div class="manual-mode-info">
          <span class="manual-icon">🔒</span>
          <span>手动控制模式 · {{ manualExpireText }} 恢复自动</span>
        </div>
        <button class="unlock-btn" @click="releaseManualLock">解除锁定</button>
      </div>

      <!-- 主路灯电源开关 -->
      <div class="section">
        <div class="section-label-row">
          <span>主路灯电源 (MAIN POWER)</span>
        </div>
        <div class="power-area">
          <button class="power-btn" :class="{ on: power, off: !power }" @click="togglePower" :disabled="sending">
            <svg class="power-icon" viewBox="0 0 24 24" fill="none">
              <path d="M12 3v9M6.34 5.34a8 8 0 1 0 11.32 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- 亮度调节 -->
      <div class="section">
        <div class="section-label-row">
          <span>亮度调节 (DIMMING)</span>
          <span class="pct-badge">{{ brightness }}%</span>
        </div>
        <div class="slider-wrap">
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            v-model="brightness"
            class="brightness-slider"
            :style="{ '--val': brightness + '%' }"
            :disabled="!power"
            @change="setBrightness"
          />
          <div class="slider-ticks">
            <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
          </div>
        </div>
      </div>

      <!-- 执行控制台 -->
      <div class="section">
        <div class="section-label-row">
          <span>执行控制台</span>
          <button class="clear-btn" @click="logs = []">清空</button>
        </div>
        <div class="console-box" ref="logsContainer">
          <div v-for="(log, i) in logs" :key="i" class="console-line" :class="log.type">
            <span class="console-time">[{{ log.time }}]</span>
            <span class="console-text">{{ log.text }}</span>
          </div>
          <div v-if="sending" class="console-line sending">
            <span class="console-time">[...]</span>
            <span class="console-text">等待节点响应 •••</span>
          </div>
        </div>
      </div>

      <!-- 强制同步按钮 -->
      <button class="sync-btn" @click="syncStatus" :disabled="sending">
        <svg viewBox="0 0 24 24" fill="none"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        强制同步状态
      </button>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-panel {
  width: 420px;
  max-width: calc(100vw - 32px);
  background: linear-gradient(160deg, #0a1e3a 0%, #071428 100%);
  border: 1px solid rgba(0, 150, 220, 0.25);
  border-radius: 16px;
  padding: 28px;
  position: relative;
  box-shadow: 0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,150,220,0.1) inset;
  animation: slideUp 0.25s ease;
}
@keyframes slideUp {
  from { opacity: 0; transform: translateY(24px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.modal-close {
  position: absolute;
  top: 16px; right: 16px;
  width: 28px; height: 28px;
  background: rgba(255,255,255,0.06);
  border: none;
  border-radius: 6px;
  color: rgba(150,200,230,0.7);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.modal-close:hover { background: rgba(255,255,255,0.12); color: #fff; }
.modal-close svg { width: 16px; height: 16px; }

/* Header */
.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}
.panel-header-left { display: flex; align-items: flex-start; gap: 12px; }
.panel-icon {
  width: 36px; height: 36px;
  background: rgba(0,150,220,0.15);
  border: 1px solid rgba(77,208,225,0.25);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.panel-icon svg { width: 18px; height: 18px; color: #4dd0e1; }
.panel-title { font-size: 16px; font-weight: 700; color: #e0f4ff; }
.panel-location {
  display: flex; align-items: center; gap: 4px;
  font-size: 11px; color: rgba(140,190,220,0.6); margin-top: 3px;
}
.panel-brightness-display {
  text-align: right;
}
.brightness-value { font-size: 36px; font-weight: 700; color: #4dd0e1; line-height: 1; }
.brightness-unit { font-size: 14px; color: rgba(100,180,220,0.7); }

.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  background: rgba(0, 200, 100, 0.1);
  border: 1px solid rgba(0, 200, 100, 0.3);
  border-radius: 20px;
  font-size: 11px;
  font-weight: 700;
  color: #4caf82;
  letter-spacing: 1px;
  margin-bottom: 20px;
}
.dot { width: 6px; height: 6px; border-radius: 50%; }
.dot.online { background: #4caf50; box-shadow: 0 0 6px #4caf50; animation: blink 2s infinite; }
.dot.offline { background: #888; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.4} }

/* Sections */
.section { margin-bottom: 20px; }
.section-label { font-size: 11px; color: rgba(140,190,220,0.6); letter-spacing: 0.5px; margin-bottom: 8px; display: block; }
.section-label-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: rgba(140,190,220,0.7); margin-bottom: 10px; }

.node-select {
  width: 100%;
  background: rgba(0,30,60,0.7);
  border: 1px solid rgba(0,120,180,0.3);
  border-radius: 8px;
  color: #d0eaf8;
  font-size: 13px;
  padding: 8px 12px;
  outline: none;
}

/* Power button */
.power-area { display: flex; justify-content: center; padding: 16px 0; }
.power-btn {
  width: 80px; height: 80px;
  border-radius: 12px;
  border: 2px solid rgba(0,120,180,0.3);
  background: rgba(0,30,60,0.6);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.3s;
  position: relative;
  overflow: hidden;
}
.power-btn.on {
  border-color: rgba(77,208,225,0.5);
  background: rgba(0,80,40,0.3);
  box-shadow: 0 0 24px rgba(77,208,100,0.3), inset 0 0 20px rgba(77,208,100,0.1);
}
.power-btn.on .power-icon { color: #4caf50; filter: drop-shadow(0 0 8px #4caf50); }
.power-btn.off { border-color: rgba(200,50,50,0.3); background: rgba(60,20,20,0.3); }
.power-btn.off .power-icon { color: rgba(200,80,80,0.7); }
.power-btn:hover:not(:disabled) { transform: scale(1.05); }
.power-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.power-icon { width: 32px; height: 32px; color: rgba(140,190,220,0.8); transition: all 0.3s; }

/* Slider */
.slider-wrap {}
.brightness-slider {
  width: 100%;
  -webkit-appearance: none;
  height: 4px;
  border-radius: 2px;
  background: linear-gradient(to right, #4dd0e1 0%, #4dd0e1 var(--val, 75%), rgba(0,80,140,0.4) var(--val, 75%));
  outline: none;
  cursor: pointer;
  accent-color: #4dd0e1;
}
.brightness-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px; height: 18px;
  border-radius: 50%;
  background: #4dd0e1;
  box-shadow: 0 0 10px rgba(77,208,225,0.7);
  cursor: pointer;
}
.brightness-slider:disabled { opacity: 0.4; cursor: not-allowed; }
.slider-ticks {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: rgba(100,160,200,0.5);
  margin-top: 6px;
}
.pct-badge {
  font-size: 13px;
  font-weight: 700;
  color: #4dd0e1;
}

/* Console */
.console-box {
  background: rgba(0,10,30,0.8);
  border: 1px solid rgba(0,100,160,0.2);
  border-radius: 8px;
  padding: 10px 12px;
  height: 130px;
  overflow-y: auto;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.console-line { display: flex; gap: 8px; line-height: 1.5; }
.console-time { color: rgba(77,208,225,0.5); white-space: nowrap; flex-shrink: 0; }
.console-text { color: rgba(180,220,240,0.8); }
.console-line.cmd .console-text { color: #4dd0e1; }
.console-line.system .console-text { color: rgba(140,180,210,0.6); }
.console-line.error .console-text { color: #ff7070; }
.console-line.sending .console-text { color: rgba(255,200,80,0.8); animation: pulse 1s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
.clear-btn {
  font-size: 11px; color: rgba(140,190,220,0.5); background: none; border: none; cursor: pointer;
  transition: color 0.2s;
}
.clear-btn:hover { color: rgba(140,190,220,0.9); }

/* Sync btn */
.sync-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  background: rgba(0, 80, 140, 0.2);
  border: 1px solid rgba(0, 120, 200, 0.3);
  border-radius: 8px;
  color: rgba(140, 190, 220, 0.8);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.sync-btn svg { width: 15px; height: 15px; }
.sync-btn:hover:not(:disabled) { background: rgba(0, 120, 200, 0.2); color: #4dd0e1; border-color: rgba(77,208,225,0.4); }
.sync-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.manual-mode-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(255, 160, 40, 0.1);
  border: 1px solid rgba(255, 160, 40, 0.3);
  border-radius: 8px;
  margin-bottom: 16px;
}
.manual-mode-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #ffa726;
}
.manual-icon { font-size: 14px; }
.unlock-btn {
  padding: 4px 12px;
  background: rgba(255, 160, 40, 0.15);
  border: 1px solid rgba(255, 160, 40, 0.4);
  border-radius: 6px;
  color: #ffa726;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
.unlock-btn:hover { background: rgba(255, 160, 40, 0.3); color: #ffcc80; }
</style>
