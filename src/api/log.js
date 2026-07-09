import request from './request.js'
import { reportMock } from '../utils/mockStore.js'

const MOCK_LOGS = [
  { id: 1,  operator: 'admin', action: 'LOGIN',         targetType: 'SYSTEM',    targetId: null,  detail: '登录成功-角色:SUPER_ADMIN',           result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 2 * 3600000).toISOString() },
  { id: 2,  operator: 'admin', action: 'LOGIN',         targetType: 'SYSTEM',    targetId: null,  detail: '登录失败-密码错误',                   result: 'FAIL',    ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 3 * 3600000).toISOString() },
  { id: 3,  operator: 'admin', action: 'DEVICE_CREATE', targetType: 'DEVICE',    targetId: '7',   detail: '新增设备-SL_007',                     result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 4 * 3600000).toISOString() },
  { id: 4,  operator: 'admin', action: 'DEVICE_UPDATE', targetType: 'DEVICE',    targetId: 'SL_003', detail: '更新设备-图书馆-01',               result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 5 * 3600000).toISOString() },
  { id: 5,  operator: 'admin', action: 'DEVICE_DELETE', targetType: 'DEVICE',    targetId: 'SL_006', detail: '删除设备-北门-01',                 result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 6 * 3600000).toISOString() },
  { id: 6,  operator: 'admin', action: 'CONTROL',       targetType: 'DEVICE',    targetId: 'SL_001', detail: '手动控制-ON',                       result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 1 * 3600000).toISOString() },
  { id: 7,  operator: 'admin', action: 'CONTROL',       targetType: 'DEVICE',    targetId: 'SL_002', detail: '手动控制-DIMMING(70)',               result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 1.5 * 3600000).toISOString() },
  { id: 8,  operator: 'admin', action: 'THRESHOLD_SET',  targetType: 'THRESHOLD', targetId: '1',   detail: '设置光照阈值-lux_lt=50,lux_gt=200',  result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 8 * 3600000).toISOString() },
  { id: 9,  operator: 'admin', action: 'POLICY_CREATE', targetType: 'POLICY',    targetId: '3',   detail: '新增策略-深夜节能调光',               result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 24 * 3600000).toISOString() },
  { id: 10, operator: 'admin', action: 'POLICY_TOGGLE', targetType: 'POLICY',    targetId: '2',   detail: '禁用策略-光照联动自动开关',           result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 12 * 3600000).toISOString() },
  { id: 11, operator: 'admin', action: 'ALARM_CREATE', targetType: 'ALARM',     targetId: '4',   detail: '新增告警-OFFLINE:心跳中断超过360秒',  result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 0.5 * 3600000).toISOString() },
  { id: 12, operator: 'admin', action: 'ALARM_HANDLE', targetType: 'ALARM',     targetId: '4',   detail: '处理告警-OFFLINE:心跳中断超过360秒',  result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 0.25 * 3600000).toISOString() },
  { id: 13, operator: 'admin', action: 'USER_CREATE',  targetType: 'USER',      targetId: '2',   detail: '新增用户-zhang',                      result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 48 * 3600000).toISOString() },
  { id: 14, operator: 'admin', action: 'USER_UPDATE',  targetType: 'USER',      targetId: '2',   detail: '更新用户-zhang',                      result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 24 * 3600000).toISOString() },
  { id: 15, operator: 'admin', action: 'ROLE_CREATE',  targetType: 'ROLE',      targetId: '2',   detail: '新增角色-市政人员',                   result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 72 * 3600000).toISOString() },
  { id: 16, operator: 'admin', action: 'ROLE_PERMISSION', targetType: 'ROLE',   targetId: '2',   detail: '分配权限-市政人员: 8项权限',          result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 72 * 3600000).toISOString() },
  { id: 17, operator: 'admin', action: 'PERM_CREATE',  targetType: 'PERMISSION', targetId: '5',  detail: '新增权限-能耗查看',                   result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 96 * 3600000).toISOString() },
  { id: 18, operator: 'admin', action: 'PERM_DELETE',  targetType: 'PERMISSION', targetId: '6',  detail: '删除权限-旧版告警配置',               result: 'SUCCESS', ipAddress: '192.168.1.100', operatedAt: new Date(Date.now() - 96 * 3600000).toISOString() },
]

function mapLog(log) {
  let level = 'info'
  if (log.result === 'FAIL' || log.result === 'ERROR') level = 'error'
  else if (log.action && (log.action.includes('告警') || log.action.includes('ALARM'))) level = 'warn'

  let time = '--'
  if (log.operatedAt) {
    if (typeof log.operatedAt === 'string') {
      time = log.operatedAt.replace('T', ' ')
    } else if (Array.isArray(log.operatedAt)) {
      const [y, m, d, h, mi, s] = log.operatedAt
      time = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')} ${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    }
  }

  return {
    id: log.id,
    time,
    level,
    user: log.operator || '系统',
    action: `[${log.targetType || 'SYSTEM'}] ${log.detail || log.action}`,
    _raw: log,
  }
}

function mockFilter(page, size, filters) {
  let list = [...MOCK_LOGS]
  if (filters.operator)   list = list.filter(l => l.operator.includes(filters.operator))
  if (filters.action)     list = list.filter(l => l.action === filters.action)
  if (filters.targetType) list = list.filter(l => l.targetType === filters.targetType)
  if (filters.result)     list = list.filter(l => l.result === filters.result)
  if (filters.dateFrom)   list = list.filter(l => new Date(l.operatedAt) >= new Date(filters.dateFrom))
  if (filters.dateTo)     list = list.filter(l => new Date(l.operatedAt) <= new Date(filters.dateTo))

  list.sort((a, b) => new Date(b.operatedAt) - new Date(a.operatedAt))
  const total = list.length
  const start = (page - 1) * size
  const paged = list.slice(start, start + size)
  return { records: paged, total, page, size }
}

export async function getSystemLogs(page = 1, size = 50, filters = {}) {
  const params = { page, size }
  if (filters.operator)   params.operator   = filters.operator
  if (filters.action)     params.action     = filters.action
  if (filters.targetType) params.targetType = filters.targetType
  if (filters.result)     params.result     = filters.result
  if (filters.dateFrom)   params.dateFrom   = filters.dateFrom
  if (filters.dateTo)     params.dateTo     = filters.dateTo

  try {
    const res = await request.get('/api/logs/system', { params })

    if (res && res.code === 200 && res.data) {
      const records = res.data.records || res.data.list || []
      const list = records.map(mapLog)
      return { code: 200, data: { list, total: res.data.total || list.length, page, size } }
    }
    throw new Error(res?.msg || '系统日志接口返回异常')
  } catch {
    reportMock('GET /api/logs/system')
    const mock = mockFilter(page, size, filters)
    return { code: 200, msg: 'mock', data: { list: mock.records.map(mapLog), total: mock.total, page, size } }
  }
}
