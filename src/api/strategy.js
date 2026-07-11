/**
 * api/strategy.js — 照明策略管理接口
 * 对齐接口文档：开发变更日志 v1.0.0 四、照明策略管理模块
 *
 * 接口列表:
 *   POST   /api/policies/list      分页条件查询策略列表
 *   GET    /api/policies/{id}      策略详情
 *   POST   /api/policies           新增策略
 *   PUT    /api/policies/{id}      更新策略
 *   DELETE /api/policies/{id}      删除策略
 *   PUT    /api/policies/{id}/toggle  启用/禁用策略
 *   GET    /api/policies/lux-threshold 查询光照阈值
 *   PUT    /api/policies/lux-threshold 更新光照阈值
 */
import request from './request.js'
import { reportMock } from '../utils/mockStore.js'

// ── Mock 数据 ─────────────────────────────────────────────────────────────
const MOCK_POLICIES = [
  {
    id: 1, name: '深夜节能模式',   group: '主干道节能组',
    startTime: '23:00', endTime: '05:00',
    enabled: true,  triggerCount: 243, lastTrigger: '2023-10-27T23:00:00',
    description: '深夜时段自动降低路灯亮度至 30%，节约能耗',
  },
  {
    id: 2, name: '雨雾增亮补偿',   group: '全域组',
    startTime: '00:00', endTime: '23:59',
    enabled: true,  triggerCount: 56,  lastTrigger: '2023-10-26T07:32:00',
    description: '检测到雨雾天气时自动提升亮度至 100%',
  },
  {
    id: 3, name: '节假日景观模式', group: '景观灯组',
    startTime: '18:00', endTime: '23:00',
    enabled: false, triggerCount: 12,  lastTrigger: '2023-10-01T18:00:00',
    description: '节假日开启景观灯彩色模式',
  },
  {
    id: 4, name: '交通高峰亮灯',   group: '主干道节能组',
    startTime: '07:00', endTime: '09:00',
    enabled: true,  triggerCount: 189, lastTrigger: '2023-10-27T07:00:00',
    description: '早晚高峰时段自动开启全部路灯',
  },
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

// ── 策略列表 GET /api/policies（返回全量列表，前端做客户端过滤与分页）───────
export function fetchStrategyList(query = { pageNum: 1, pageSize: 20 }) {
  const pageNum  = query.pageNum  || query.page  || 1
  const pageSize = query.pageSize || query.size  || 20

  return safeCall(
    async () => {
      const res = await request.get('/api/policies')
      // 后端返回 { code, msg, data: LightingPolicy[] }，res 已被拦截器解包为响应体
      // 取数组后做客户端过滤与分页，保持与分页接口一致的返回格式
      let list = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : [])

      // 客户端过滤
      if (query.name)       list = list.filter(p => (p.name || '').includes(query.name))
      if (query.policyType) list = list.filter(p => p.policyType === query.policyType)
      if (query.enabled !== undefined && query.enabled !== null) {
        list = list.filter(p => p.enabled === query.enabled)
      }
      if (query.priorityMin != null) list = list.filter(p => (p.priority ?? 100) >= query.priorityMin)
      if (query.priorityMax != null) list = list.filter(p => (p.priority ?? 100) <= query.priorityMax)

      const total = list.length
      const start = (pageNum - 1) * pageSize
      const paged = list.slice(start, start + pageSize)

      // 统一返回分页格式，供 Strategy.vue 直接使用
      return {
        code: 200,
        data: { records: paged, total, size: pageSize, current: pageNum, pages: Math.max(1, Math.ceil(total / pageSize)) },
      }
    },
    (() => {
      let list = [...MOCK_POLICIES]
      if (query.name)       list = list.filter(p => p.name.includes(query.name))
      if (query.policyType) list = list.filter(p => p.policyType === query.policyType)
      if (query.enabled !== undefined && query.enabled !== null) list = list.filter(p => p.enabled === query.enabled)
      const total = list.length
      const start = (pageNum - 1) * pageSize
      return { records: list.slice(start, start + pageSize), total, size: pageSize, current: pageNum, pages: Math.max(1, Math.ceil(total / pageSize)) }
    })(),
    'GET /api/policies'
  )
}

// ── 策略详情 GET /api/policies/{id} ───────────────────────────────────────
export function fetchStrategyDetail(id) {
  return safeCall(
    () => request.get(`/api/policies/${id}`),
    MOCK_POLICIES.find(p => p.id === id) || MOCK_POLICIES[0],
    `GET /api/policies/${id}`
  )
}

// ── 新增策略 POST /api/policies ───────────────────────────────────────────
export function createStrategy(data) {
  return safeCall(
    () => request.post('/api/policies', data),
    { id: Date.now(), enabled: true, triggerCount: 0, ...data },
    'POST /api/policies'
  )
}

// ── 更新策略 PUT /api/policies/{id} ───────────────────────────────────────
export function updateStrategy(id, data) {
  return safeCall(
    () => request.put(`/api/policies/${id}`, data),
    { id, ...data },
    `PUT /api/policies/${id}`
  )
}

// ── 删除策略 DELETE /api/policies/{id} ────────────────────────────────────
export function deleteStrategy(id) {
  return request.delete(`/api/policies/${id}`)
}

// ── 启用/禁用策略 PUT /api/policies/{id}/toggle ───────────────────────────
/**
 * 后端 toggle 接口会自动取反 enabled，不需要传 body，直接 PUT 即可。
 * @param {number} id
 * @param {boolean} enabled  当前期望状态（仅用于 Mock 降级的返回值）
 */
export function toggleStrategy(id, enabled) {
  return safeCall(
    () => request.put(`/api/policies/${id}/toggle`),
    { id, enabled },
    `PUT /api/policies/${id}/toggle`
  )
}

// ── 策略组列表 GET /api/policies/groups ──────────────────────────────────
export function fetchStrategyGroups() {
  return safeCall(
    () => request.get('/api/policies/groups'),
    ['主干道节能组', '景观灯组', '全域组', '园区灯组', '校区灯组'],
    'GET /api/policies/groups'
  )
}

// ── 查询光照阈值 GET /api/policies/lux-threshold ──────────────────────────
export function getLuxThreshold() {
  return safeCall(
    () => request.get('/api/policies/lux-threshold'),
    { policyId: 1, policyName: '光照联动自动开关', luxLt: 50, luxGt: 200, conditions: '{"lux_lt":50,"lux_gt":200}', enabled: true, priority: 1 },
    'GET /api/policies/lux-threshold'
  )
}

// ── 更新光照阈值 PUT /api/policies/lux-threshold ──────────────────────────
export function updateLuxThreshold(data) {
  return safeCall(
    () => request.put('/api/policies/lux-threshold', data),
    { policyId: 1, policyName: '光照联动自动开关', luxLt: data.luxLt, luxGt: data.luxGt, conditions: `{"lux_lt":${data.luxLt},"lux_gt":${data.luxGt}}`, enabled: true, priority: 1 },
    'PUT /api/policies/lux-threshold'
  )
}

// ── 策略执行历史 GET /api/policies/{id}/history ─────────────────────────
export function fetchStrategyHistory(id, days = 7) {
  return request.get(`/api/policies/${id}/history`, { params: { days } })
}

// ── 策略模拟测试 POST /api/policies/test ─────────────────────────────────

/** 本地条件评估（镜像 DecisionEngine.evaluateSingle 逻辑） */
function evalCondition(key, value, sensor) {
  if (value == null) return false
  switch (key) {
    case 'lux_lt': return sensor.illuminance != null && sensor.illuminance < Number(value)
    case 'lux_gt': return sensor.illuminance != null && sensor.illuminance > Number(value)
    case 'temp_lt': return sensor.temperature != null && sensor.temperature < Number(value)
    case 'temp_gt': return sensor.temperature != null && sensor.temperature > Number(value)
    case 'humidity_lt': return sensor.humidity != null && sensor.humidity < Number(value)
    case 'humidity_gt': return sensor.humidity != null && sensor.humidity > Number(value)
    case 'pir': return sensor.pir != null && sensor.pir === Number(value)
    case 'traffic_gt': return sensor.trafficFlow != null && sensor.trafficFlow > Number(value)
    case 'traffic_lt': return sensor.trafficFlow != null && sensor.trafficFlow < Number(value)
    case 'time_range': {
      if (!sensor._currentTime) return true // 无模拟时间时不评估
      const [start, end] = String(value).split('-')
      if (!start || !end) return false
      const t = sensor._currentTime
      if (start <= end) return t >= start && t <= end
      return t >= start || t <= end // 跨夜时段
    }
    default: return true // 跳过 group/startTime/extraActions 等元数据
  }
}

/** 本地策略评估（镜像 DecisionEngine.matchesCondition 逻辑） */
function localMatches(conditionsJson, sensor) {
  if (!conditionsJson) return false
  let conds
  try { conds = JSON.parse(conditionsJson) } catch { return false }
  for (const [key, value] of Object.entries(conds)) {
    if (!evalCondition(key, value, sensor)) return false
  }
  return true
}

export function testStrategy(data) {
  return safeCall(
    () => request.post('/api/policies/test', data),
    (() => {
      const sensor = {
        illuminance: data.illuminance,
        temperature: data.temperature,
        humidity: data.humidity,
        pir: data.pir,
        trafficFlow: data.trafficFlow,
        _currentTime: data.currentTime || null,
      }
      // 评估当前编辑的策略
      const matched = localMatches(data.conditions, sensor)
      const result = {
        matched,
        matchedPolicy: matched ? (data.name || '(当前编辑策略)') : null,
        matchedAction: matched ? data.action : null,
        allResults: MOCK_POLICIES.map(p => {
          const hit = p.conditions ? localMatches(p.conditions, sensor) : false
          return { policyId: p.id, policyName: p.name, hit, priority: 100 }
        }),
      }
      return result
    })(),
    'POST /api/policies/test'
  )
}
