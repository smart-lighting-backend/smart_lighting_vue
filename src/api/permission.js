/**
 * 权限管理 API
 *
 * GET    /api/permissions/tree    → 权限树（可选 roleId 参数）
 * GET    /api/permissions         → 扁平列表
 * GET    /api/permissions/{id}    → 详情
 * POST   /api/permissions         → 新增
 * PUT    /api/permissions/{id}    → 修改
 * DELETE /api/permissions/{id}    → 删除
 */
import request from './request.js'
import { adminSafeCall, MOCK_PERMISSIONS } from './adminMock.js'

/**
 * 权限树（可选 roleId 参数）
 * @param {number} [roleId] 传入后返回的树节点会标记 checked
 */
export function fetchPermissionTree(roleId) {
  const params = roleId ? { roleId } : {}
  return adminSafeCall(
    () => request.get('/api/permissions/tree', { params }),
    () => buildPermissionTree(roleId),
    'GET /api/permissions/tree'
  )
}

/** 扁平列表 */
export function fetchPermissionList() {
  return adminSafeCall(
    () => request.get('/api/permissions'),
    () => MOCK_PERMISSIONS,
    'GET /api/permissions'
  )
}

/** 详情 */
export function fetchPermissionById(id) {
  return adminSafeCall(
    () => request.get(`/api/permissions/${id}`),
    () => MOCK_PERMISSIONS.find(permission => Number(permission.id) === Number(id)) || null,
    `GET /api/permissions/${id}`
  )
}

/** 新增权限 */
export function createPermission(data) {
  return request.post('/api/permissions', data)
}

/** 修改权限 */
export function updatePermission(id, data) {
  return request.put(`/api/permissions/${id}`, data)
}

/** 删除权限 */
export function deletePermission(id) {
  return request.delete(`/api/permissions/${id}`)
}

function buildPermissionTree(roleId) {
  const checkedIds = new Set()
  if (roleId) {
    MOCK_PERMISSIONS.forEach(permission => checkedIds.add(permission.id))
  }

  const build = (parentId = null) => MOCK_PERMISSIONS
    .filter(permission => (permission.parentId ?? null) === parentId)
    .map(permission => ({
      ...permission,
      checked: checkedIds.has(permission.id),
      children: build(permission.id),
    }))

  return build(null)
}
