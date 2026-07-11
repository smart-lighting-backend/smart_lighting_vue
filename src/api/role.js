/**
 * 角色管理 API
 *
 * GET    /api/roles                → 角色列表
 * GET    /api/roles/{id}           → 角色详情
 * POST   /api/roles                → 新增
 * PUT    /api/roles/{id}           → 修改
 * DELETE /api/roles/{id}           → 删除
 * PUT    /api/roles/{id}/permissions → 分配角色权限
 * GET    /api/roles/permissions    → 权限选项
 */
import request from './request.js'
import { adminSafeCall, getMockRoleById, getMockRoles, MOCK_PERMISSIONS, setMockRolePermissions } from './adminMock.js'

/** 角色列表 */
export function fetchRoleList() {
  return adminSafeCall(
    () => request.get('/api/roles'),
    () => getMockRoles(),
    'GET /api/roles'
  )
}

/** 角色详情 */
export function fetchRoleById(id) {
  return adminSafeCall(
    () => request.get(`/api/roles/${id}`),
    () => getMockRoleById(id),
    `GET /api/roles/${id}`
  )
}

/** 新增角色 */
export function createRole(data) {
  return request.post('/api/roles', data)
}

/** 修改角色 */
export function updateRole(id, data) {
  return request.put(`/api/roles/${id}`, data)
}

/** 删除角色 */
export function deleteRole(id) {
  return request.delete(`/api/roles/${id}`)
}

/** 分配角色权限（权限 ID 列表） */
export function assignRolePermissions(id, permissionIds) {
  return adminSafeCall(
    () => request.put(`/api/roles/${id}/permissions`, { permissionIds }),
    () => setMockRolePermissions(id, permissionIds),
    `PUT /api/roles/${id}/permissions`
  )
}

export function fetchRolePermissions() {
  return adminSafeCall(
    () => request.get('/api/roles/permissions'),
    () => MOCK_PERMISSIONS,
    'GET /api/roles/permissions'
  )
}
