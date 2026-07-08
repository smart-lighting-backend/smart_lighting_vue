/**
 * api/dashboard.js — 首页/数字孪生统计数据
 */
import request from './request.js'
import { reportMock } from '../utils/mockStore.js'

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

const MOCK_STATS = {
  totalDevices: 1248,
  onlineDevices: 1186,
  onlineRate: 95.0,
  energySavingRate: 32.5,
  alertCount: 3,
  todayEnergy: 4286.5,
}

function genEnergyTrend() {
  const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}:00`)
  return {
    labels: hours,
    current:  hours.map(() => rand(180, 420)),
    lastWeek: hours.map(() => rand(200, 450)),
  }
}

function genDistrictData() {
  return [
    { name: '高新区', online: 386, offline: 12, warning: 2 },
    { name: '创业园区', online: 201, offline: 8, warning: 1 },
    { name: '市中心', online: 312, offline: 5, warning: 0 },
    { name: '工业园', online: 187, offline: 9, warning: 0 },
    { name: '学院路段', online: 100, offline: 2, warning: 0 },
  ]
}

async function safeCall(apiFn, mockData, endpoint) {
  try { return await apiFn() }
  catch {
    if (endpoint) reportMock(endpoint)
    return { code: 200, msg: 'mock', data: mockData }
  }
}

export function fetchDashboardStats() {
  return safeCall(() => request.get('/api/dashboard/stats'), MOCK_STATS, 'GET /api/dashboard/stats')
}

export function fetchEnergyTrend() {
  return safeCall(() => request.get('/api/dashboard/energy-trend'), genEnergyTrend(), 'GET /api/dashboard/energy-trend')
}

export function fetchDistrictData() {
  return safeCall(() => request.get('/api/dashboard/districts'), genDistrictData(), 'GET /api/dashboard/districts')
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
