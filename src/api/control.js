/**
 * api/control.js — 远程控制接口
 *
 * 职责：
 * - turn_on / turn_off / dim → 走后端 ControlController（safeCall 降级 Mock）
 * - flash / restart → 后端不支持，纯 Mock
 * - 控制历史 → 走后端 control_command 表查询（safeCall 降级 Mock）
 *
 * 命令映射：
 *   前端命令        后端动作
 *   turn_on   →    ON
 *   turn_off  →    OFF
 *   dim       →    DIMMING
 *   flash     →    不支持（纯 Mock）
 *   restart   →    不支持（纯 Mock）
 */
import request from './request.js'
import { reportMock } from '../utils/mockStore.js'

// ── 常量定义 ─────────────────────────────────────────────────────────────
const ACTION_MAP = { turn_on: 'ON', turn_off: 'OFF', dim: 'DIMMING' }
const REVERSE_ACTION_MAP = { ON: 'turn_on', OFF: 'turn_off', DIMMING: 'dim' }
const COMMAND_LABELS = {
  turn_on: '开灯', turn_off: '关灯', dim: '调光', flash: '闪烁', restart: '重启',
}
const STATUS_MAP = { SENT: 'success', SUCCESS: 'success', FAILED: 'failed' }
const STATUS_LABELS = {
  SENT: '已下发', SUCCESS: '执行成功', FAILED: '执行失败',
  success: '执行成功', failed: '执行失败',
}
const COMMAND_MESSAGES = {
  turn_on: '开灯指令已下发', turn_off: '关灯指令已下发', dim: '调光指令已下发',
  flash: '闪烁指令已下发', restart: '重启指令已下发',
}
const COMMAND_FEEDBACK = {
  turn_on: '设备已响应，灯光已开启',
  turn_off: '设备已响应，灯光已关闭',
  dim: (p) => `设备已响应，亮度已调整为 ${p.brightness}%`,
  flash: '设备已响应，灯光开始闪烁',
  restart: '设备已响应，正在重启...',
}

// ── Mock 数据 ───────────────────────────────────────────────────────────
let mockIdCounter = 6

function pad(n) { return String(n).padStart(2, '0') }
function pad3(n) { return String(n).padStart(3, '0') }

function nowStr() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function buildMockResponse(deviceId, command, params) {
  const fbMsg = typeof COMMAND_FEEDBACK[command] === 'function'
    ? COMMAND_FEEDBACK[command](params)
    : (COMMAND_FEEDBACK[command] || '指令已执行')
  const ts = nowStr()
  return {
    code: 200,
    message: COMMAND_MESSAGES[command] || '指令已下发',
    data: {
      deviceId, command, params,
      feedback: { status: 'success', message: fbMsg, executed_at: ts },
    },
  }
}

const MOCK_HISTORY = [
  { id: 'CTL001', device_id: 'SL_001', command: 'turn_on',  command_label: '开灯',   params: {},                    status: 'success', status_label: '执行成功', message: '设备已响应，灯光已开启',        created_at: '2026-07-02 14:30:00', executed_at: '2026-07-02 14:30:05' },
  { id: 'CTL002', device_id: 'SL_001', command: 'dim',      command_label: '调光',   params: { brightness: 75 },    status: 'success', status_label: '执行成功', message: '设备已响应，亮度已调整为 75%', created_at: '2026-07-02 14:25:00', executed_at: '2026-07-02 14:25:03' },
  { id: 'CTL003', device_id: 'SL_001', command: 'turn_off', command_label: '关灯',   params: {},                    status: 'success', status_label: '执行成功', message: '设备已响应，灯光已关闭',        created_at: '2026-07-02 10:00:00', executed_at: '2026-07-02 10:00:04' },
  { id: 'CTL004', device_id: 'SL_001', command: 'restart',  command_label: '重启',   params: {},                    status: 'success', status_label: '执行成功', message: '设备已响应，正在重启...',        created_at: '2026-07-01 18:00:00', executed_at: '2026-07-01 18:00:06' },
  { id: 'CTL005', device_id: 'SL_001', command: 'flash',    command_label: '闪烁',   params: {},                    status: 'success', status_label: '执行成功', message: '设备已响应，灯光开始闪烁',        created_at: '2026-07-01 16:30:00', executed_at: '2026-07-01 16:30:02' },
]

// ── 工具函数 ────────────────────────────────────────────────────────────
function formatBackendTime(time) {
  if (!time) return ''
  if (typeof time === 'string') return time.replace('T', ' ')
  return String(time)
}

function adaptBackendHistory(cmd) {
  const command = REVERSE_ACTION_MAP[cmd.action] || (cmd.action ? cmd.action.toLowerCase() : 'unknown')
  return {
    id: `CTL${pad3(cmd.id)}`,
    device_id: cmd.deviceId,
    command,
    command_label: COMMAND_LABELS[command] || cmd.action,
    params: cmd.brightness != null ? { brightness: cmd.brightness } : {},
    status: STATUS_MAP[cmd.status] || 'sent',
    status_label: STATUS_LABELS[cmd.status] || '已下发',
    message: cmd.resultDetail || '指令已下发',
    created_at: formatBackendTime(cmd.issuedAt),
    executed_at: formatBackendTime(cmd.ackAt),
  }
}

async function safeCall(apiFn, mockData, endpoint) {
  try {
    return await apiFn()
  } catch (e) {
    if (e?.bizCode) throw e
    if (endpoint) reportMock(endpoint)
    return mockData
  }
}

// ── 发送控制指令 ────────────────────────────────────────────────────────
export async function sendControlCommand(deviceId, command, params = {}) {
  // flash / restart 后端不支持，走纯 Mock
  if (command === 'flash' || command === 'restart') {
    const result = buildMockResponse(deviceId, command, params)
    MOCK_HISTORY.unshift({
      id: `CTL${pad3(mockIdCounter++)}`,
      device_id: deviceId,
      command,
      command_label: COMMAND_LABELS[command],
      params: { ...params },
      status: 'success',
      status_label: '执行成功',
      message: result.data.feedback.message,
      created_at: result.data.feedback.executed_at,
      executed_at: result.data.feedback.executed_at,
    })
    return result
  }

  return safeCall(
    async () => {
      const action = ACTION_MAP[command]
      if (!action) return { code: 400, message: '未知指令', data: null }

      const body = { action }
      if (command === 'dim' && params.brightness != null) {
        body.brightness = params.brightness
      }

      let res
      try {
        res = await request.post(`/api/devices/${deviceId}/control`, body)
      } catch (e) {
        // 业务错误（如设备不存在、无效指令）→ 返回给调用方处理
        if (e?.bizCode) {
          return { code: e.bizCode, message: e.message, data: null }
        }
        throw e // 网络错误，让 safeCall 降级 Mock
      }

      const ts = nowStr()
      const fbMsg = typeof COMMAND_FEEDBACK[command] === 'function'
        ? COMMAND_FEEDBACK[command](params)
        : COMMAND_FEEDBACK[command]

      return {
        code: 200,
        message: COMMAND_MESSAGES[command],
        data: {
          deviceId, command, params,
          feedback: { status: 'SENT', message: fbMsg, executed_at: ts },
        },
      }
    },
    buildMockResponse(deviceId, command, params),
    `POST /api/devices/${deviceId}/control`,
  )
}

// ── 查询控制历史 ────────────────────────────────────────────────────────
export async function getControlHistory(deviceId, page = 1, pageSize = 10) {
  return safeCall(
    async () => {
      let res
      try {
        res = await request.get(`/api/devices/${deviceId}/control-history`, {
          params: { page, size: pageSize },
        })
      } catch (e) {
        if (e?.bizCode) {
          return { code: e.bizCode, message: e.message, data: { list: [], total: 0 } }
        }
        throw e
      }

      const records = (res.data?.records || []).map(adaptBackendHistory)
      return {
        code: 200,
        message: 'success',
        data: { list: records, total: res.data?.total || 0, page, pageSize },
      }
    },
    (() => {
      const filtered = MOCK_HISTORY.filter(h => h.device_id === deviceId)
      const start = (page - 1) * pageSize
      return {
        code: 200,
        message: 'success',
        data: { list: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize },
      }
    })(),
    `GET /api/devices/${deviceId}/control-history`,
  )
}
