import request from './request.js'
import {
  adminSafeCall,
  batchDeleteMockUsers,
  buildMockUserPage,
  createMockUser,
  deleteMockUser,
  getMockRoles,
  updateMockUser,
} from './adminMock.js'

/**
 * 获取用户列表（分页、组合查询）
 */
export async function fetchUserList(query = {}) {
  const res = await adminSafeCall(
    () => request.post('/api/users/list', query),
    () => buildMockUserPage(query),
    'POST /api/users/list'
  )
  return res.data
}

/**
 * 获取单个用户详情
 */
export async function fetchUserDetail(id) {
  const res = await adminSafeCall(
    () => request.get(`/api/users/${id}`),
    () => buildMockUserPage({ page: 1, size: 1000 }).records.find(user => Number(user.id) === Number(id)) || null,
    `GET /api/users/${id}`
  )
  return res.data
}

/**
 * 新增用户
 */
export async function createUser(data) {
  return adminSafeCall(
    () => request.post('/api/users', data),
    () => createMockUser(data),
    'POST /api/users'
  )
}

/**
 * 更新用户
 */
export async function updateUser(id, data) {
  return adminSafeCall(
    () => request.put(`/api/users/${id}`, data),
    () => updateMockUser(id, data),
    `PUT /api/users/${id}`
  )
}

/**
 * 停用用户
 */
export async function disableUser(id) {
  return adminSafeCall(
    () => request.put(`/api/users/${id}/disable`),
    () => updateMockUser(id, { enabled: false }),
    `PUT /api/users/${id}/disable`
  )
}

/**
 * 物理删除用户
 */
export async function deleteUser(id) {
  return adminSafeCall(
    () => request.delete(`/api/users/${id}`),
    () => deleteMockUser(id),
    `DELETE /api/users/${id}`
  )
}

/**
 * 获取所有角色列表
 */
export async function fetchAllRoles() {
  const res = await adminSafeCall(
    () => request.get('/api/users/roles'),
    () => getMockRoles(),
    'GET /api/users/roles'
  )
  return res.data
}

/**
 * 批量删除用户
 */
export async function batchDeleteUsers(ids) {
  return adminSafeCall(
    () => request.delete('/api/users/batch', { data: ids }),
    () => batchDeleteMockUsers(ids),
    'DELETE /api/users/batch'
  )
}

/**
 * 导出用户数据（返回 Blob）
 */
export async function exportUsers(query = {}) {
  try {
    const res = await request.post('/api/users/export', query, { responseType: 'blob' })
    return res
  } catch (error) {
    throw error
  }
}
