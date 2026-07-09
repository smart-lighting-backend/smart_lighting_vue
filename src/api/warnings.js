/**
 * api/warnings.js — 告警中心接口
 * 对齐接口文档：开发变更日志 v1.0.0 二、告警日志管理模块
 *
 * 接口列表:
 *   POST   /api/alarms/list            告警组合查询（分页）
 *   GET    /api/alarms/{id}            告警详情
 *   POST   /api/alarms                 新增告警
 *   PUT    /api/alarms/{id}            修改告警
 *   DELETE /api/alarms/{id}            删除告警
 *   PUT    /api/alarms/{id}/handle     处理确认
 *   GET    /api/alarms/stats           告警统计（按 level/type/status 分组）
 *   GET    /api/alarms/trend           告警趋势（按天）
 *   PUT    /api/alarms/batch/handle    批量处理
 *   DELETE /api/alarms/batch           批量删除
 *
 * 告警状态: ACTIVE | ACKNOWLEDGED | RECOVERED
 * 告警级别: CRITICAL | MAJOR | WARNING
 * 告警类型: OFFLINE | FAULT | HEALTH_LOW
 */
import request from './request.js'
import { reportMock } from '../utils/mockStore.js'

const EXPORT_PAGE_SIZE = 500

// ── 状态/级别/类型映射 ──────────────────────────────────────────────────────
export const ALARM_STATUS_MAP = {
  ACTIVE:       { label: '待处理', cls: 'pending' },
  ACKNOWLEDGED: { label: '处理中', cls: 'processing' },
  RECOVERED:    { label: '已解决', cls: 'resolved' },
}

export const ALARM_LEVEL_MAP = {
  CRITICAL: { label: '紧急', cls: 'critical' },
  MAJOR:    { label: '严重', cls: 'critical' },
  WARNING:  { label: '警告', cls: 'warning' },
}

export const ALARM_TYPE_MAP = {
  OFFLINE:     '离线',
  FAULT:       '故障',
  HEALTH_LOW:  '健康分过低',
}

// ── Mock 数据 ─────────────────────────────────────────────────────────────
const MOCK_ALARMS = [
  { id: 1, deviceId: 'SL-001', type: 'FAULT',      level: 'CRITICAL', status: 'ACTIVE',       reason: '传感器数据异常: illuminance=999.0, temperature=999.0',          startAt: '2026-07-09T14:32:05', recoverAt: null,                  handler: null },
  { id: 2, deviceId: 'SL-003', type: 'OFFLINE',    level: 'MAJOR',    status: 'ACKNOWLEDGED', reason: '心跳中断超过 5 分钟，最后心跳时间：2026-07-09 12:10:00',      startAt: '2026-07-09T12:15:22', recoverAt: null,                  handler: '张工' },
  { id: 3, deviceId: 'SL-005', type: 'HEALTH_LOW', level: 'WARNING',  status: 'ACTIVE',       reason: '健康分降至 32.00，低于阈值 60',                                 startAt: '2026-07-09T08:00:00', recoverAt: null,                  handler: null },
  { id: 4, deviceId: 'SL-006', type: 'FAULT',      level: 'CRITICAL', status: 'RECOVERED',    reason: '传感器数据异常: humidity=-99.0',                                startAt: '2026-07-08T22:08:33', recoverAt: '2026-07-08T23:00:00', handler: '李工' },
  { id: 5, deviceId: 'SL-007', type: 'OFFLINE',    level: 'MAJOR',    status: 'RECOVERED',    reason: '设备未上报心跳，判定为离线',                                    startAt: '2026-07-08T18:50:11', recoverAt: '2026-07-08T19:30:00', handler: 'system' },
  { id: 6, deviceId: 'SL-001', type: 'HEALTH_LOW', level: 'WARNING',  status: 'RECOVERED',    reason: '健康分降至 45.00，低于阈值 60',                                 startAt: '2026-07-07T10:00:00', recoverAt: '2026-07-07T12:00:00', handler: 'system' },
]

async function safeCall(apiFn, mockData, endpoint) {
  try {
    return await apiFn()
  } catch (e) {
    if (e?.bizCode) throw e
    if (endpoint) reportMock(endpoint)
    return { code: 200, msg: 'mock', data: mockData }
  }
}

// ── 告警组合查询（分页） POST /api/alarms/list ────────────────────────────
/**
 * 接口文档：POST /api/alarms/list
 * 支持 7 个筛选条件（deviceId LIKE、type/level/status 精确、startAtFrom/startAtTo、handler LIKE）
 *
 * @param {{
 *   pageNum?: number,
 *   pageSize?: number,
 *   deviceId?: string,
 *   type?: string,
 *   level?: string,
 *   status?: string,
 *   startAtFrom?: string,
 *   startAtTo?: string,
 *   handler?: string
 * }} params
 */
export function fetchAlarmPage(params = {}) {
  const body = {
    pageNum:  params.pageNum  || 1,
    pageSize: params.pageSize || 10,
  }
  if (params.deviceId  && params.deviceId  !== 'ALL') body.deviceId  = params.deviceId
  if (params.type      && params.type      !== 'ALL') body.type      = params.type
  if (params.level     && params.level     !== 'ALL') body.level     = params.level
  if (params.status    && params.status    !== 'ALL') body.status    = params.status
  if (params.startTime || params.startAtFrom)         body.startAtFrom = params.startTime || params.startAtFrom
  if (params.endTime   || params.startAtTo)           body.startAtTo   = params.endTime   || params.startAtTo
  if (params.handler)                                 body.handler   = params.handler

  // Mock 数据客户端过滤
  let list = [...MOCK_ALARMS]
  if (body.deviceId)  list = list.filter(a => a.deviceId.includes(body.deviceId))
  if (body.type)      list = list.filter(a => a.type    === body.type)
  if (body.level)     list = list.filter(a => a.level   === body.level)
  if (body.status)    list = list.filter(a => a.status  === body.status)
  if (body.handler)   list = list.filter(a => a.handler && a.handler.includes(body.handler))

  const total   = list.length
  const size    = body.pageSize
  const current = body.pageNum
  const start   = (current - 1) * size
  const paged   = list.slice(start, start + size)

  return safeCall(
    () => request.post('/api/alarms/list', body),
    { records: paged, total, size, current, pages: Math.ceil(total / size) },
    'POST /api/alarms/list'
  )
}

export async function fetchAlarmExportList(params = {}) {
  const allRecords = []
  let pageNum = 1
  let total = 0
  let pages = 1

  do {
    const res = await fetchAlarmPage({
      ...params,
      pageNum,
      pageSize: EXPORT_PAGE_SIZE,
    })
    const pageData = res.data || res || {}
    const records = Array.isArray(pageData.records) ? pageData.records : []

    if (pageNum === 1) {
      total = Number(pageData.total) || records.length
      pages = Number(pageData.pages) || Math.max(1, Math.ceil(total / EXPORT_PAGE_SIZE))
    }

    allRecords.push(...records)
    if (!records.length) {
      break
    }
    pageNum += 1
  } while (allRecords.length < total && pageNum <= pages)

  return allRecords
}

// ── 告警详情 GET /api/alarms/{id} ─────────────────────────────────────────
export function fetchAlarmDetail(id) {
  return safeCall(
    () => request.get(`/api/alarms/${id}`),
    MOCK_ALARMS.find(a => a.id === id) || MOCK_ALARMS[0],
    `GET /api/alarms/${id}`
  )
}

// ── 新增告警 POST /api/alarms ─────────────────────────────────────────────
export function createAlarm(data) {
  return safeCall(
    () => request.post('/api/alarms', data),
    { id: Date.now(), ...data, startAt: new Date().toISOString() },
    'POST /api/alarms'
  )
}

// ── 修改告警 PUT /api/alarms/{id} ─────────────────────────────────────────
export function updateAlarm(id, data) {
  return safeCall(
    () => request.put(`/api/alarms/${id}`, data),
    { id, ...data },
    `PUT /api/alarms/${id}`
  )
}

// ── 删除告警 DELETE /api/alarms/{id} ─────────────────────────────────────
export function deleteAlarm(id) {
  return safeCall(
    () => request.delete(`/api/alarms/${id}`),
    null,
    `DELETE /api/alarms/${id}`
  )
}

// ── 处理确认 PUT /api/alarms/{id}/handle ─────────────────────────────────
/**
 * @param {number} id  告警记录主键
 * @param {{ handler: string, remark?: string }} data
 */
export function handleAlarm(id, data) {
  return request.put(`/api/alarms/${id}/handle`, data)
}

// ── 告警统计 GET /api/alarms/stats ───────────────────────────────────────
/**
 * 返回按 level / type / status 分组的统计
 */
export function fetchAlarmStats() {
  const mockStats = {
    byLevel:  [
      { level: 'CRITICAL', count: 2 },
      { level: 'MAJOR',    count: 2 },
      { level: 'WARNING',  count: 2 },
    ],
    byType:   [
      { type: 'FAULT',      count: 2 },
      { type: 'OFFLINE',    count: 2 },
      { type: 'HEALTH_LOW', count: 2 },
    ],
    byStatus: [
      { status: 'ACTIVE',       count: 2 },
      { status: 'ACKNOWLEDGED', count: 1 },
      { status: 'RECOVERED',    count: 3 },
    ],
  }
  return safeCall(() => request.get('/api/alarms/stats'), mockStats, 'GET /api/alarms/stats')
}

// ── 告警趋势 GET /api/alarms/trend?days=7 ────────────────────────────────
/**
 * @param {number} days  天数，默认 7
 */
export function fetchAlarmTrend(days = 7) {
  const mockTrend = Array.from({ length: days }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (days - 1 - i))
    return {
      date:  d.toISOString().slice(0, 10),
      count: Math.round(Math.random() * 8),
    }
  })
  return safeCall(
    () => request.get('/api/alarms/trend', { params: { days } }),
    mockTrend,
    'GET /api/alarms/trend'
  )
}

// ── 批量处理 PUT /api/alarms/batch/handle ────────────────────────────────
/**
 * @param {{ ids: number[], handler: string, remark?: string }} data
 */
export function batchHandleAlarm(data) {
  return safeCall(
    () => request.put('/api/alarms/batch/handle', data),
    { updatedCount: data.ids?.length || 0 },
    'PUT /api/alarms/batch/handle'
  )
}

// ── 批量删除 DELETE /api/alarms/batch ────────────────────────────────────
/**
 * @param {{ ids: number[] }} data
 */
export function batchDeleteAlarm(data) {
  return safeCall(
    () => request.delete('/api/alarms/batch', { data }),
    { deletedCount: data.ids?.length || 0 },
    'DELETE /api/alarms/batch'
  )
}
