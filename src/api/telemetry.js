/**
 * api/telemetry.js — 遥测数据接口
 *
 * 后端格式（TelemetryController）：
 *   GET /api/telemetry/latest/{deviceId}
 *     → data: { deviceId, data: { illuminance, temperature, ... }, lastHeartbeatAt }
 *   POST /api/telemetry/history
 *     → data: { records: [...], total, size, current, pages } (IPage)
 *
 * API 层负责将后端格式归一化为前端消费格式：
 *   fetchLatestTelemetry → data: { illuminance, temperature, humidity, pir, updateTime }
 *   fetchTelemetryHistory → data: { list: [...], total }
 */
import request from './request.js'
import { reportMock } from '../utils/mockStore.js'

// ── Mock 数据 ─────────────────────────────────────────────────────────────
const MOCK_LATEST = {
  'SL_001': { deviceId: 'SL_001', illuminance: 1256, temperature: 26.8, humidity: 45, pir: 1, updateTime: '2026-07-05 14:35:00' },
  'SL_002': { deviceId: 'SL_002', illuminance: 890,  temperature: 27.2, humidity: 42, pir: 0, updateTime: '2026-07-05 14:34:55' },
  'SL_003': { deviceId: 'SL_003', illuminance: 1520, temperature: 25.5, humidity: 48, pir: 1, updateTime: '2026-07-05 14:34:40' },
  'SL_004': { deviceId: 'SL_004', illuminance: 980,  temperature: 26.1, humidity: 44, pir: 0, updateTime: '2026-07-05 14:34:30' },
  'SL_005': { deviceId: 'SL_005', illuminance: 1100, temperature: 27.5, humidity: 40, pir: 1, updateTime: '2026-07-05 14:34:20' },
  'SL_006': { deviceId: 'SL_006', illuminance: 750,  temperature: 28.0, humidity: 38, pir: 0, updateTime: '2026-07-05 14:34:10' },
}

function genHistoryMock(deviceId, timeRange) {
  const now = new Date()
  const data = []
  const interval = timeRange === '24h' ? 3600000 : timeRange === '7d' ? 86400000 : 300000
  const count = timeRange === '24h' ? 24 : timeRange === '7d' ? 7 : 12

  for (let i = count - 1; i >= 0; i--) {
    const ts = new Date(now.getTime() - i * interval)
    const hour = ts.getHours()
    const base = 1000 + Math.random() * 600
    const lux = hour >= 6 && hour <= 18
      ? base + Math.sin((hour - 6) / 12 * Math.PI) * 800
      : base * 0.3 + Math.random() * 100

    const pad = (n) => String(n).padStart(2, '0')
    data.push({
      time: `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} ${pad(ts.getHours())}:${pad(ts.getMinutes())}:00`,
      illuminance: Math.round(lux),
      pir: Math.random() > 0.6 ? 1 : 0,
      temperature: Math.round((25 + Math.random() * 5) * 10) / 10,
      humidity: Math.round(40 + Math.random() * 10),
    })
  }
  return data
}

async function safeCall(apiFn, mockData, endpoint) {
  try {
    return await apiFn()
  } catch (e) {
    if (e?.bizCode) throw e
    if (endpoint) reportMock(endpoint)
    return { code: 200, msg: 'mock', data: mockData }
  }
}

// ── 最新遥测 GET /api/telemetry/latest/{deviceId} ────────────────────────
export function fetchLatestTelemetry(deviceId) {
  return safeCall(
    async () => {
      const res = await request.get(`/api/telemetry/latest/${deviceId}`)
      // 后端 data.data 为 latestData JSON 反序列化的遥测读数
      const tele = res.data?.data || {}
      return {
        code: 200,
        msg: 'success',
        data: {
          deviceId:   res.data?.deviceId || deviceId,
          illuminance: tele.illuminance ?? 0,
          temperature: tele.temperature ?? 0,
          humidity:    tele.humidity ?? 0,
          pir:         tele.pir ?? 0,
          updateTime:  res.data?.lastHeartbeatAt || tele.collectedAt || new Date().toISOString(),
        },
      }
    },
    MOCK_LATEST[deviceId] || { deviceId, illuminance: 0, temperature: 0, humidity: 0, pir: 0, updateTime: '--' },
    `GET /api/telemetry/latest/${deviceId}`
  )
}

// ── 历史遥测 POST /api/telemetry/history ─────────────────────────────────
function computeTimeRangeParams(timeRange) {
  const now = new Date()
  let from = new Date()
  switch (timeRange) {
    case '24h': from.setHours(from.getHours() - 24); break
    case '7d':  from.setDate(from.getDate() - 7); break
    case '30d': from.setDate(from.getDate() - 30); break
    default:    from.setHours(from.getHours() - 1); break  // 1h
  }
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return { collectedAtFrom: fmt(from), collectedAtTo: fmt(now) }
}

/**
 * 格式化时间戳为本地时间显示。
 * 后端和 EMQX 统一使用 UTC 时间（ZoneOffset.UTC / now_rfc3339），
 * 前端显示时转换为用户本地时区（北京时间 UTC+8）。
 */
function formatTime(collectedAt) {
  if (!collectedAt) return '--'
  // 数组格式（MySQL datetime，原样为 UTC）: [2026, 7, 8, 15, 30, 0]
  if (Array.isArray(collectedAt) && collectedAt.length >= 6) {
    const [y, m, d, h, min, s] = collectedAt
    // 构造 UTC 时间 → 转换为本地时区
    const utcDate = new Date(Date.UTC(y, m - 1, d, h, min, s))
    const l = utcDate.toLocaleString('zh-CN', { hour12: false })
    return l
  }
  // 字符串格式（TDengine / Jackson LocalDateTime），存储为 UTC
  const raw = String(collectedAt).replace('T', ' ').substring(0, 19)
  // 以 UTC 解析 → 转换为本地时区显示
  const utc = new Date(raw + 'Z')  // 加 Z 标记为 UTC
  if (isNaN(utc.getTime())) return raw  // 解析失败则原样返回
  return utc.toLocaleString('zh-CN', { hour12: false })
}

export function fetchTelemetryHistory(params) {
  const { deviceId, timeRange = '1h', size = 500 } = params
  const body = { deviceId, ...computeTimeRangeParams(timeRange), page: 1, size }
  console.log('[TelemetryHistory] Request:', JSON.stringify(body))
  return safeCall(
    async () => {
      const res = await request.post('/api/telemetry/history', body)
      const records = res.data?.records || []
      console.log('[TelemetryHistory] Response: total=' + (res.data?.total || 0) + ', records=' + records.length)
      if (records.length > 0) {
        console.log('[TelemetryHistory] Sample:', JSON.stringify({ time: formatTime(records[0].collectedAt), collectedAt: records[0].collectedAt }))
      } else {
        console.warn('[TelemetryHistory] Empty result for', deviceId, '— using mock')
        throw new Error('Empty telemetry history')
      }
      return {
        code: 200,
        msg: 'success',
        data: {
          list:  records.map(r => ({
            ...r,
            time: formatTime(r.collectedAt)
          })),
          total: res.data?.total || 0,
        }
      }
    },
    { list: genHistoryMock(deviceId, timeRange), total: 24 },
    'POST /api/telemetry/history'
  )
}
