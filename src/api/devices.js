/**
 * api/devices.js — 设备管理相关接口
 * 对齐接口文档：开发变更日志 v1.0.0 三、设备管理模块 + 设备管理CRUD接口开发日志
 *
 * 接口列表:
 *   POST   /api/devices/list            设备组合查询（分页，8个筛选条件）
 *   GET    /api/devices/{deviceId}      查询设备详情
 *   POST   /api/devices                 新增设备
 *   PUT    /api/devices/{deviceId}      修改设备
 *   DELETE /api/devices/{deviceId}      删除设备（逻辑删除）
 *   GET    /api/telemetry/latest/{deviceId}   最新遥测数据
 *   POST   /api/telemetry/history             历史遥测数据
 *   GET    /api/devices/statistics/status     状态统计
 *   GET    /api/devices/statistics/area-status 区域状态统计
 *   POST   /api/devices/{deviceId}/control   手动控制
 *   PUT    /api/devices/batch-area            批量绑定/解绑设备区域
 *   PUT    /api/devices/batch-disable         批量停用设备
 *   PUT    /api/devices/batch-enable          批量启用设备
 *   DELETE /api/devices/batch                 批量删除设备
 *
 * 设备状态: 0 停用 | 1 在线 | 2 离线 | 3 异常
 */
import request from './request.js'
import mockStore, { reportMock } from '../utils/mockStore.js'

// ── 状态映射工具 ───────────────────────────────────────────────────────────
export const STATUS_MAP = {
  0: { label: '停用', cls: 'disabled', color: '#888' },
  1: { label: '在线', cls: 'online',   color: '#4caf50' },
  2: { label: '离线', cls: 'offline',  color: '#9e9e9e' },
  3: { label: '异常', cls: 'warning',  color: '#ffa726' },
}
export const STATUS_QUERY_MAP = { '全部': undefined, '在线': 1, '离线': 2, '异常': 3, '停用': 0 }

// ── Mock 数据 ──────────────────────────────────────────────────────────────
const MOCK_DEVICES = [
  { id: 1, deviceId: 'SL-001', name: '南门-01',     area: 'A区', areaId: 7,  location: '106.5622,29.5621', status: 1, healthScore: 98.50, topicPrefix: 'streetlight', lastHeartbeatAt: '2026-07-02T09:18:06', enabled: true, deleted: false },
  { id: 2, deviceId: 'SL-002', name: '东门-02',     area: 'A区', areaId: 8,  location: '106.5630,29.5630', status: 1, healthScore: 85.00, topicPrefix: 'streetlight', lastHeartbeatAt: '2026-07-02T09:17:30', enabled: true, deleted: false },
  { id: 3, deviceId: 'SL-003', name: '创业大道-01', area: 'B区', areaId: 9,  location: '106.5700,29.5700', status: 2, healthScore: 32.00, topicPrefix: 'streetlight', lastHeartbeatAt: '2026-07-01T22:10:00', enabled: true, deleted: false },
  { id: 4, deviceId: 'SL-004', name: '人民广场-01', area: 'C区', areaId: 11, location: '106.5660,29.5660', status: 1, healthScore: 78.00, topicPrefix: 'streetlight', lastHeartbeatAt: '2026-07-02T09:15:00', enabled: true, deleted: false },
  { id: 5, deviceId: 'SL-005', name: '工业园-01',   area: 'D区', areaId: null, location: '106.5800,29.5800', status: 1, healthScore: 88.00, topicPrefix: 'streetlight', lastHeartbeatAt: '2026-07-02T09:16:00', enabled: true, deleted: false },
  { id: 6, deviceId: 'SL-006', name: '学院路-01',   area: 'E区', areaId: null, location: '106.5900,29.5900', status: 1, healthScore: 95.00, topicPrefix: 'streetlight', lastHeartbeatAt: '2026-07-02T09:14:00', enabled: true, deleted: false },
]

const MOCK_DEVICE_STORAGE_KEY = 'smart_light_mock_devices'

function loadMockDevices() {
  if (typeof localStorage === 'undefined') {
    return MOCK_DEVICES.map(device => ({ ...device }))
  }

  try {
    const raw = localStorage.getItem(MOCK_DEVICE_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) return parsed
  } catch (error) {
    console.warn('读取设备 Mock 缓存失败', error)
  }

  return MOCK_DEVICES.map(device => ({ ...device }))
}

const mockDevices = loadMockDevices()

function persistMockDevices() {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(MOCK_DEVICE_STORAGE_KEY, JSON.stringify(mockDevices))
  } catch (error) {
    console.warn('保存设备 Mock 缓存失败', error)
  }
}

const MOCK_TELEMETRY = {
  'SL-001': { id: 1, deviceId: 'SL-001', illuminance: 1256, temperature: 26.8, humidity: 45, pm25: 18, aqi: 45, pir: 1, trafficFlow: 128, collectedAt: '2026-07-05T14:35:00' },
  'SL-002': { id: 2, deviceId: 'SL-002', illuminance: 890,  temperature: 27.2, humidity: 42, pm25: 22, aqi: 55, pir: 0, trafficFlow: 95,  collectedAt: '2026-07-05T14:34:55' },
  'SL-003': { id: 3, deviceId: 'SL-003', illuminance: 1520, temperature: 25.5, humidity: 48, pm25: 35, aqi: 72, pir: 1, trafficFlow: 156, collectedAt: '2026-07-05T14:34:40' },
  'SL-004': { id: 4, deviceId: 'SL-004', illuminance: 980,  temperature: 26.1, humidity: 44, pm25: 30, aqi: 80, pir: 0, trafficFlow: 56,  collectedAt: '2026-07-05T14:34:30' },
  'SL-005': { id: 5, deviceId: 'SL-005', illuminance: 1100, temperature: 27.5, humidity: 40, pm25: 15, aqi: 38, pir: 1, trafficFlow: 178, collectedAt: '2026-07-05T14:34:20' },
  'SL-006': { id: 6, deviceId: 'SL-006', illuminance: 750,  temperature: 28.0, humidity: 38, pm25: 10, aqi: 30, pir: 0, trafficFlow: 42,  collectedAt: '2026-07-05T14:34:10' },
}

async function safeCall(apiFn, mockData, endpoint) {
  try {
    return await apiFn()
  } catch (e) {
    // 业务错误（后端返回 code != 200）继续抛出，其他错误（网络/404/500）降级 Mock
    if (e?.bizCode) throw e
    if (endpoint) reportMock(endpoint)
    const data = typeof mockData === 'function' ? mockData() : mockData
    return { code: 200, msg: 'mock', data }
  }
}

function activeMockDevices() {
  return mockDevices.filter(d => !d.deleted)
}

function deviceListUsesMock() {
  return Boolean(
    mockStore.details['POST /api/devices/list'] ||
    mockStore.details['POST /api/devices/list (light)'] ||
    mockStore.details['POST /api/devices/list (nodes)']
  )
}

function applyMockCreate(data) {
  const next = {
    id: Date.now(),
    deleted: false,
    status: 1,
    healthScore: 100.00,
    topicPrefix: 'streetlight',
    enabled: true,
    ...data,
  }
  const idx = mockDevices.findIndex(d => d.deviceId === next.deviceId)
  if (idx === -1) {
    mockDevices.unshift(next)
  } else {
    mockDevices.splice(idx, 1, { ...mockDevices[idx], ...next, deleted: false })
  }
  persistMockDevices()
  return next
}

function applyMockUpdate(deviceId, data) {
  const idx = mockDevices.findIndex(d => d.deviceId === deviceId)
  const next = {
    ...(idx === -1 ? { id: Date.now(), deviceId, deleted: false } : mockDevices[idx]),
    ...data,
  }
  if (idx === -1) {
    mockDevices.unshift(next)
  } else {
    mockDevices.splice(idx, 1, next)
  }
  persistMockDevices()
  return next
}

function applyMockDelete(deviceId) {
  const idx = mockDevices.findIndex(d => d.deviceId === deviceId)
  if (idx !== -1) {
    mockDevices.splice(idx, 1, {
      ...mockDevices[idx],
      deleted: true,
      enabled: false,
      status: 0,
    })
    persistMockDevices()
  }
  return null
}

function applyMockBatchDisable(deviceIds = []) {
  const idSet = new Set(deviceIds.map(id => String(id)))
  const updated = []

  mockDevices.forEach((device, index) => {
    if (!idSet.has(String(device.id))) return

    const next = {
      ...device,
      enabled: false,
      status: 0,
    }
    mockDevices.splice(index, 1, next)
    updated.push(next)
  })

  persistMockDevices()
  return { total: deviceIds.length, success: updated.length, failed: deviceIds.length - updated.length }
}

function applyMockBatchEnable(deviceIds = []) {
  const idSet = new Set(deviceIds.map(id => String(id)))
  const updated = []

  mockDevices.forEach((device, index) => {
    if (!idSet.has(String(device.id))) return

    const next = {
      ...device,
      enabled: true,
      status: 2,
    }
    mockDevices.splice(index, 1, next)
    updated.push(next)
  })

  persistMockDevices()
  return { total: deviceIds.length, success: updated.length, failed: deviceIds.length - updated.length }
}

function applyMockBatchDelete(deviceIds = []) {
  const idSet = new Set(deviceIds.map(id => String(id)))
  let success = 0

  mockDevices.forEach((device, index) => {
    if (!idSet.has(String(device.id))) return

    mockDevices.splice(index, 1, {
      ...device,
      deleted: true,
      enabled: false,
      status: 0,
    })
    success += 1
  })

  persistMockDevices()
  return { total: deviceIds.length, success, failed: deviceIds.length - success }
}

function applyMockBatchArea(deviceIds = [], areaId, areaName = '') {
  const idSet = new Set(deviceIds.map(id => String(id)))
  const nextAreaId = areaId === undefined ? null : areaId
  const nextAreaName = nextAreaId === null ? '' : (areaName || `区域ID: ${nextAreaId}`)
  const updated = []

  mockDevices.forEach((device, index) => {
    if (!idSet.has(String(device.id))) return

    const next = {
      ...device,
      areaId: nextAreaId,
      area: nextAreaName,
    }
    mockDevices.splice(index, 1, next)
    updated.push(next)
  })

  persistMockDevices()
  return updated
}

// ── 设备组合查询（分页）POST /api/devices/list ────────────────────────────
/**
 * 接口文档：POST /api/devices/list
 * 支持 8 个筛选条件:
 *   deviceId 精确 | name LIKE | area 精确 | location LIKE
 *   status 精确 | enabled 精确 | healthScoreMin >= | healthScoreMax <=
 *
 * @param {{
 *   pageNum?: number,
 *   pageSize?: number,
 *   keyword?: string,
 *   deviceId?: string,
 *   name?: string,
 *   area?: string,
 *   location?: string,
 *   status?: number,
 *   enabled?: boolean,
 *   healthScoreMin?: number,
 *   healthScoreMax?: number
 * }} params
 */
export function fetchDevicePage(params = {}) {
  const body = {
    pageNum:  params.pageNum  || 1,
    pageSize: params.pageSize || 10,
  }
  // keyword 同时匹配 deviceId/name/location（前端传 keyword，后端对应 name LIKE）
  if (params.keyword)           body.name          = params.keyword
  if (params.deviceId)          body.deviceId      = params.deviceId
  if (params.name)              body.name          = params.name
  if (params.area)              body.area          = params.area
  if (params.areaId !== undefined && params.areaId !== null) body.areaId = params.areaId
  if (params.location)          body.location      = params.location
  if (params.status !== undefined && params.status !== null) body.status = params.status
  if (params.enabled !== undefined && params.enabled !== null) body.enabled = params.enabled
  if (params.healthScoreMin !== undefined) body.healthScoreMin = params.healthScoreMin
  if (params.healthScoreMax !== undefined) body.healthScoreMax = params.healthScoreMax

  // Mock 数据客户端过滤
  let list = activeMockDevices()
  if (params.keyword) {
    const kw = params.keyword.toLowerCase()
    list = list.filter(d =>
      d.deviceId.toLowerCase().includes(kw) ||
      d.name.toLowerCase().includes(kw) ||
      d.location.toLowerCase().includes(kw)
    )
  }
  if (body.area)    list = list.filter(d => d.area === body.area)
  if (body.areaId)  list = list.filter(d => d.areaId === body.areaId)
  if (body.status !== undefined) list = list.filter(d => d.status === body.status)
  if (body.enabled !== undefined) list = list.filter(d => d.enabled === body.enabled)

  const total   = list.length
  const size    = body.pageSize
  const current = body.pageNum
  const start   = (current - 1) * size
  const paged   = list.slice(start, start + size)

  return safeCall(
    () => request.post('/api/devices/list', body),
    { records: paged, total, size, current, pages: Math.ceil(total / size) },
    'POST /api/devices/list'
  )
}

// ── 兼容旧接口：fetchDeviceList（某些页面可能仍使用） ─────────────────────
/**
 * 轻量版列表查询，供 Dashboard 等简单场景使用
 * @param {{ area?: string, status?: number }} params
 */
export async function fetchDeviceList(params = {}) {
  const body = {}
  const pageNum = params.pageNum || 1
  const pageSize = params.pageSize || 100
  if (params.area !== undefined && params.area !== null)    body.area   = params.area
  if (params.areaId !== undefined && params.areaId !== null) body.areaId = params.areaId
  if (params.status !== undefined && params.status !== null) body.status = params.status
  if (params.keyword)                                        body.name   = params.keyword
  // areaIds 后端不支持，仅用于 Mock 和客户端过滤
  const areaIds = params.areaIds

  let mockList = activeMockDevices()
  if (params.keyword) {
    const kw = params.keyword.toLowerCase()
    mockList = mockList.filter(d =>
      d.deviceId.toLowerCase().includes(kw) ||
      d.name.toLowerCase().includes(kw) ||
      (d.location || '').toLowerCase().includes(kw)
    )
  }
  if (body.area)   mockList = mockList.filter(d => d.area   === body.area)
  if (body.areaId) mockList = mockList.filter(d => d.areaId === body.areaId)
  if (areaIds?.length) {
    const idSet = new Set(areaIds.map(v => typeof v === 'number' ? v : Number(v)))
    mockList = mockList.filter(d => idSet.has(d.areaId))
  }
  if (body.status !== undefined) mockList = mockList.filter(d => d.status === body.status)

  const res = await safeCall(
    () => request.post('/api/devices/list', { pageNum, pageSize, ...body }),
    mockList,
    'POST /api/devices/list (light)'
  )
  // 兼容后端分页格式 { records: [...] } 和直接返回数组
  let result = []
  if (res?.data?.records) result = res.data.records
  else if (Array.isArray(res)) result = res
  else if (Array.isArray(res?.data)) result = res.data
  else result = res || []

  // 客户端侧按 areaIds 过滤（后端不支持 areaIds 字段）
  if (areaIds?.length) {
    const idSet = new Set(areaIds.map(v => typeof v === 'number' ? v : Number(v)))
    result = result.filter(d => idSet.has(d.areaId))
  }

  return result
}

// ── 地图标注：全量设备（精简查询） ─────────────────────────────────────────
/**
 * 为地图组件获取全量设备数据，不传筛选条件，pageSize 上调至 10000。
 * @returns {Promise<Array>} 设备数组
 */
export async function fetchAllDevicesForMap() {
  const mockList = activeMockDevices()
  const res = await safeCall(
    () => request.post('/api/devices/list', { pageNum: 1, pageSize: 10000 }),
    mockList,
    'POST /api/devices/list (map)'
  )
  if (res?.data?.records) return res.data.records
  if (Array.isArray(res?.data)) return res.data
  if (Array.isArray(res)) return res
  return res || []
}

// ── 设备详情 GET /api/devices/{deviceId} ─────────────────────────────────
/**
 * @param {string} deviceId  例如 'SL-001'
 */
export function fetchDeviceDetail(deviceId) {
  return safeCall(
    () => request.get(`/api/devices/${deviceId}`),
    activeMockDevices().find(d => d.deviceId === deviceId) || activeMockDevices()[0],
    `GET /api/devices/${deviceId}`
  )
}

// ── 融合感知面板 ─────────────────────────────────────────────────
export function fetchDevicePerception(deviceId) {
  return safeCall(
    () => request.get(`/api/devices/${deviceId}/perception`),
    (() => {
      const device = activeMockDevices().find(d => d.deviceId === deviceId) || activeMockDevices()[0]
      const telemetry = MOCK_TELEMETRY[deviceId] || {
        deviceId, illuminance: 0, temperature: 0, humidity: 0, pm25: 0, aqi: 0, pir: 0, trafficFlow: 0, collectedAt: new Date().toISOString()
      }
      return {
        deviceId: device.deviceId,
        deviceName: device.name,
        status: device.status,
        lastHeartbeatAt: device.lastHeartbeatAt,
        healthScore: device.healthScore,
        telemetry,
        latestVision: null,
        latestVoice: null,
        recentAlarms: [],
      }
    })(),
    `GET /api/devices/${deviceId}/perception`
  )
}

// ── 批量新增设备 POST /api/devices/batch ─────────────────────────────────
export function batchCreateDevices(devices) {
  return request.post('/api/devices/batch', devices)
}

// ── 新增设备 POST /api/devices ────────────────────────────────────────────
/**
 * @param {{
 *   deviceId: string,
 *   name?: string,
 *   area?: string,
 *   location?: string,
 *   status?: number,
 *   healthScore?: number,
 *   topicPrefix?: string,
 *   enabled?: boolean
 * }} data
 */
export function createDevice(data) {
  return safeCall(
    () => request.post('/api/devices', data),
    () => applyMockCreate(data),
    'POST /api/devices'
  )
}

// ── 修改设备 PUT /api/devices/{deviceId} ─────────────────────────────────
/**
 * @param {string} deviceId
 * @param {{
 *   name?: string,
 *   area?: string,
 *   location?: string,
 *   status?: number,
 *   healthScore?: number,
 *   topicPrefix?: string,
 *   enabled?: boolean
 * }} data
 */
export function updateDevice(deviceId, data) {
  return safeCall(
    () => request.put(`/api/devices/${deviceId}`, data),
    () => applyMockUpdate(deviceId, data),
    `PUT /api/devices/${deviceId}`
  )
}

// ── 删除设备（逻辑删除）DELETE /api/devices/{deviceId} ───────────────────
/**
 * @param {string} deviceId
 */
export function deleteDevice(deviceId) {
  return request.delete(`/api/devices/${deviceId}`).catch(error => {
    if (error?.bizCode || !deviceListUsesMock()) throw error
    reportMock(`DELETE /api/devices/${deviceId}`)
    return { code: 200, msg: 'mock', data: applyMockDelete(deviceId) }
  })
}

// ── 批量停用设备 PUT /api/devices/batch-disable ─────────────────────────
/**
 * @param {{ deviceIds: number[] }} data
 */
export function batchDisableDevices(data) {
  const payload = { deviceIds: data.deviceIds }
  return safeCall(
    () => request.put('/api/devices/batch-disable', payload),
    () => applyMockBatchDisable(data.deviceIds),
    'PUT /api/devices/batch-disable'
  )
}

// ── 批量启用设备 PUT /api/devices/batch-enable ──────────────────────────
/**
 * @param {{ deviceIds: number[] }} data
 */
export function batchEnableDevices(data) {
  const payload = { deviceIds: data.deviceIds }
  return safeCall(
    () => request.put('/api/devices/batch-enable', payload),
    () => applyMockBatchEnable(data.deviceIds),
    'PUT /api/devices/batch-enable'
  )
}

// ── 批量删除设备 DELETE /api/devices/batch ──────────────────────────────
/**
 * @param {{ deviceIds: number[] }} data
 */
export function batchDeleteDevices(data) {
  const payload = { deviceIds: data.deviceIds }
  return safeCall(
    () => request.delete('/api/devices/batch', { data: payload }),
    () => applyMockBatchDelete(data.deviceIds),
    'DELETE /api/devices/batch'
  )
}

// ── 最新遥测数据 GET /api/telemetry/latest/{deviceId} ────────────────────
/**
 * @param {string} deviceId
 */
export function fetchLatestTelemetry(deviceId) {
  return safeCall(
    () => request.get(`/api/telemetry/latest/${deviceId}`),
    MOCK_TELEMETRY[deviceId] || {      deviceId,
      illuminance: Math.round(Math.random() * 500 + 10),
      temperature: +(Math.random() * 20 + 25).toFixed(1),
      humidity:    Math.round(Math.random() * 50 + 30),
      pm25:        Math.round(Math.random() * 80 + 5),
      aqi:         Math.round(Math.random() * 100 + 10),
      pir:         Math.round(Math.random()),
      trafficFlow: Math.round(Math.random() * 200),
      collectedAt: new Date().toISOString(),
    },
    `GET /api/telemetry/latest/${deviceId}`
  )
}

// ── 历史遥测数据 POST /api/telemetry/history ─────────────────────────────
/**
 * @param {{ deviceId: string, startTime: string, endTime: string }} params
 */
export function fetchTelemetryHistory(params) {
  const mock = Array.from({ length: 24 }, (_, i) => ({
    deviceId:    params.deviceId,
    illuminance: Math.round(Math.random() * 500 + 10),
    temperature: +(Math.random() * 20 + 25).toFixed(1),
    humidity:    Math.round(Math.random() * 50 + 30),
    pm25:        Math.round(Math.random() * 80 + 5),
    trafficFlow: Math.round(Math.random() * 200),
    collectedAt: new Date(Date.now() - (23 - i) * 3600000).toISOString(),
  }))
  return safeCall(
    () => request.post('/api/telemetry/history', params),
    mock,
    'POST /api/telemetry/history'
  )
}

// ── 状态统计 GET /api/devices/statistics/status ───────────────────────────
export function fetchStatusStatistics(area) {
  const params = area ? { area } : {}
  return safeCall(
    () => request.get('/api/devices/statistics/status', { params }),
    [{ status: 1, count: 4 }, { status: 2, count: 1 }, { status: 3, count: 1 }],
    'GET /api/devices/statistics/status'
  )
}

// ── 区域状态统计 GET /api/devices/statistics/area-status ──────────────────
export function fetchAreaStatusStatistics() {
  return safeCall(
    () => request.get('/api/devices/statistics/area-status'),
    [
      { area: 'A区', status: 1, count: 2 },
      { area: 'B区', status: 2, count: 1 },
      { area: 'C区', status: 1, count: 1 },
      { area: 'D区', status: 1, count: 1 },
      { area: 'E区', status: 1, count: 1 },
    ],
    'GET /api/devices/statistics/area-status'
  )
}

// ── 手动控制设备 POST /api/devices/{deviceId}/control ─────────────────────
/**
 * @param {string} deviceId
 * @param {{ action: 'ON'|'OFF'|'DIMMING', brightness?: number }} payload
 */
export function controlDevice(deviceId, payload) {
  return safeCall(
    () => request.post(`/api/devices/${deviceId}/control`, payload),
    { code: 200, msg: 'mock', data: { id: Date.now(), deviceId, ...payload, status: 'SENT', source: 'MANUAL', issuedAt: new Date().toISOString() } },
    `POST /api/devices/${deviceId}/control`
  )
}

// ── 解除手动锁定 DELETE /api/devices/{deviceId}/manual-lock ──────────────
export function unlockDevice(deviceId) {
  return request.delete(`/api/devices/${deviceId}/manual-lock`)
}

// ── 批量分配设备区域 PUT /api/devices/batch-area ─────────────────────────
/**
 * 批量修改设备的所属区域。
 * @param {{ deviceIds: number[], areaId: number|null, areaName?: string }} data
 *   - deviceIds  设备数据库 ID 列表（必填）
 *   - areaId     目标区域 ID（传 null 清除区域关联）
 *   - areaName   区域名称/路径，仅前端 Mock 回填展示用
 */
export function batchDeviceArea(data) {
  const payload = {
    deviceIds: data.deviceIds,
    areaId: data.areaId,
  }
  return safeCall(
    () => request.put('/api/devices/batch-area', payload),
    () => applyMockBatchArea(data.deviceIds, data.areaId, data.areaName),
    'PUT /api/devices/batch-area'
  )
}

// ── 节点列表（手动控制弹窗用） ─────────────────────────────────────────────
export async function fetchDeviceNodes() {
  const mockNodes = activeMockDevices().map(d => ({
    deviceId: d.deviceId,
    name:     d.name,
    location: d.area + ' ' + d.location,
    status:   d.status,
    latestData: d.latestData,
    manualMode: d.manualMode || false,
    manualExpireAt: d.manualExpireAt || null,
  }))
  const res = await safeCall(
    () => request.post('/api/devices/list', { pageNum: 1, pageSize: 100 }),
    mockNodes,
    'POST /api/devices/list (nodes)'
  )
  // 兼容后端分页格式 { records: [...] } 和直接返回数组
  if (res?.data?.records) return res.data.records
  if (Array.isArray(res)) return res
  if (Array.isArray(res?.data)) return res.data
  return res || []
}

// ── 设备健康评分 ──────────────────────────────────────────────

/** 根据存储的 healthScore 构造 Mock 健康详情（维度加权应与 score 一致） */
function buildMockHealth(deviceId) {
  const device = activeMockDevices().find(d => d.deviceId === deviceId) || activeMockDevices()[0]
  const score = Math.round(device.healthScore)
  const level = score >= 90 ? '优秀' : score >= 70 ? '良好' : score >= 50 ? '一般' : score >= 30 ? '较差' : '危险'
  const color = score >= 80 ? '#4caf50' : score >= 60 ? '#ffa726' : '#ef5350'
  // 四个维度：离线频次(30%) / 通信质量(25%) / 指令响应率(25%) / 传感器状态(20%)
  let offlineScore = Math.min(100, Math.max(10, score + (Math.random() * 20 - 10)))
  let commScore = Math.min(100, Math.max(10, score + (Math.random() * 20 - 10)))
  let respScore = Math.min(100, Math.max(10, score + (Math.random() * 20 - 10)))
  let sensorScore = Math.min(100, Math.max(10, score + (Math.random() * 20 - 10)))
  // 调整使加权平均接近 score
  const adjust = (score - (0.30 * offlineScore + 0.25 * commScore + 0.25 * respScore + 0.20 * sensorScore)) / 4
  offlineScore = Math.round(offlineScore + adjust)
  commScore = Math.round(commScore + adjust)
  respScore = Math.round(respScore + adjust)
  sensorScore = Math.round(sensorScore + adjust)
  return {
    deviceId,
    deviceName: device.name,
    overallScore: score,
    level,
    levelColor: color,
    dimensions: [
      { name: '离线频次', score: offlineScore, weight: '30%', reason: offlineScore < 90 ? '近7天存在离线记录' : null },
      { name: '通信质量', score: commScore, weight: '25%', reason: commScore < 90 ? '遥测上报间隔波动' : null },
      { name: '指令响应率', score: respScore, weight: '25%', reason: respScore < 90 ? '部分指令未确认' : null },
      { name: '传感器状态', score: sensorScore, weight: '20%', reason: sensorScore < 90 ? '部分传感器读数异常' : null },
    ],
    suggestion: score >= 90 ? '设备状态极佳' : score >= 70 ? '设备总体健康，建议定期巡检' : score >= 50 ? '关注设备运行状况，建议安排检查' : '设备健康度较低，建议尽快安排维修',
    evaluatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
  }
}

export function fetchDeviceHealth(deviceId) {
  return safeCall(
    () => request.get(`/api/devices/${deviceId}/health`),
    buildMockHealth(deviceId),
    `GET /api/devices/${deviceId}/health`
  )
}

export function fetchHealthSummary() {
  return safeCall(
    () => request.get('/api/devices/health/summary'),
    (() => {
      const list = activeMockDevices().map(d => ({
        deviceId: d.deviceId,
        name: d.name,
        score: Math.round(d.healthScore),
        level: d.healthScore >= 90 ? '优秀' : d.healthScore >= 70 ? '良好' : d.healthScore >= 50 ? '一般' : d.healthScore >= 30 ? '较差' : '危险',
      }))
      const scores = list.map(l => l.score)
      const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
      return {
        totalDevices: activeMockDevices().length,
        healthyCount: list.filter(l => l.score >= 70).length,
        warningCount: list.filter(l => l.score >= 50 && l.score < 70).length,
        criticalCount: list.filter(l => l.score < 50).length,
        averageScore: avg,
        list,
      }
    })(),
    'GET /api/devices/health/summary'
  )
}

