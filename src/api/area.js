/**
 * 设备分区管理 API
 *
 * GET    /api/device-areas         → 区域平铺列表
 * GET    /api/device-areas/tree    → 区域树形结构
 * GET    /api/device-areas/{id}    → 查询单个区域
 * POST   /api/device-areas         → 新增区域
 * PUT    /api/device-areas/{id}    → 更新区域
 * DELETE /api/device-areas/{id}    → 删除区域（有子区域或设备引用时拒绝）
 */
import request from './request.js'

/** 区域平铺列表 */
export function fetchAreaList() {
  return request.get('/api/device-areas')
}

/** 区域树形结构 */
export function fetchAreaTree() {
  return request.get('/api/device-areas/tree')
}

/** 查询单个区域 */
export function fetchAreaById(id) {
  return request.get(`/api/device-areas/${id}`)
}

/** 新增区域 */
export function createArea(data) {
  return request.post('/api/device-areas', data)
}

/** 更新区域 */
export function updateArea(id, data) {
  return request.put(`/api/device-areas/${id}`, data)
}

/** 删除区域 */
export function deleteArea(id) {
  return request.delete(`/api/device-areas/${id}`)
}

/** 批量按名称创建区域（幂等） */
export function batchCreateAreas(names) {
  return request.post('/api/device-areas/batch', names)
}
