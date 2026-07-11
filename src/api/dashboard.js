import request from './request.js'
import { reportMock } from '../utils/mockStore.js'
import { getMockDeviceSnapshot } from './devices.js'

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function buildMockStats() {
  const devices = getMockDeviceSnapshot()
  const totalDevices = devices.length
  const onlineDevices = devices.filter(d => d.status === 1 && d.enabled !== false).length
  const alertCount = devices.filter(d => d.status === 3).length
  const onlineRate = totalDevices
    ? Number(((onlineDevices / totalDevices) * 100).toFixed(1))
    : 0

  return {
    totalDevices,
    onlineDevices,
    onlineRate,
    energySavingRate: 32.5,
    alertCount,
    todayEnergy: 4286.5,
  }
}

function genEnergyTrend() {
  const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
  return {
    labels: hours,
    current: hours.map(() => rand(180, 420)),
    lastWeek: hours.map(() => rand(200, 450)),
  }
}

function genDistrictData() {
  const groups = new Map()

  getMockDeviceSnapshot().forEach(device => {
    const name = device.area || '未分配'
    const current = groups.get(name) || { name, online: 0, offline: 0, warning: 0, disabled: 0 }

    if (device.enabled === false || device.status === 0) current.disabled += 1
    else if (device.status === 1) current.online += 1
    else if (device.status === 3) current.warning += 1
    else current.offline += 1

    groups.set(name, current)
  })

  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

async function safeCall(apiFn, mockData, endpoint) {
  try {
    return await apiFn()
  } catch {
    if (endpoint) reportMock(endpoint)
    const data = typeof mockData === 'function' ? mockData() : mockData
    return { code: 200, msg: 'mock', data }
  }
}

export function fetchDashboardStats() {
  return safeCall(() => request.get('/api/dashboard/stats'), buildMockStats, 'GET /api/dashboard/stats')
}

export function fetchEnergyTrend() {
  return safeCall(() => request.get('/api/dashboard/energy-trend'), genEnergyTrend, 'GET /api/dashboard/energy-trend')
}

export function fetchDistrictData() {
  return safeCall(() => request.get('/api/dashboard/districts'), genDistrictData, 'GET /api/dashboard/districts')
}

export function triggerEnergyCalc() {
  return request.post('/api/dashboard/energy/calc', null, { timeout: 120000 })
}

export function genTestData(days = 30) {
  return request.post('/api/dashboard/energy/gen-test-data', null, { params: { days }, timeout: 120000 })
}

export function fetchYearlyStats(year) {
  return request.get('/api/dashboard/energy/yearly-stats', { params: { year } })
}

export function fetchMonthlyEnergy(year) {
  return request.get('/api/dashboard/energy/monthly', { params: { year } })
}

export function fetchDistrictEnergy(year) {
  return request.get('/api/dashboard/energy/district', { params: { year } })
}

export function fetchEdgeStatus() {
  return safeCall(
    () => request.get('/api/dashboard/edge-status'),
    { totalDecisions: 0, hitCount: 0, lastSimulatedAt: null, enabled: true },
    'GET /api/dashboard/edge-status'
  )
}

export function triggerEdgeSimulation() {
  return request.post('/api/dashboard/edge/trigger', null, { timeout: 30000 })
}

export function fetchEdgeRecent(params = {}) {
  return safeCall(
    () => request.get('/api/dashboard/edge/recent', { params }),
    [],
    'GET /api/dashboard/edge/recent'
  )
}
