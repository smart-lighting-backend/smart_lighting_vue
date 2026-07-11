/**
 * 管理员模块（用户/角色/权限/菜单）Mock 数据与降级工具
 * 当后端不可用时，为管理系统提供本地 Mock 数据，保证 UI 可交互。
 */
import { reportMock } from '../utils/mockStore.js'

// ── 通用降级调用封装 ───────────────────────────────────────────────────────

export async function adminSafeCall(apiFn, fallback, endpoint) {
  try {
    return await apiFn()
  } catch (e) {
    if (e?.bizCode) throw e
    if (endpoint) reportMock(endpoint)
    const data = typeof fallback === 'function' ? fallback() : fallback
    return { code: 200, msg: 'mock', data }
  }
}

// ── 权限 Mock 数据 ─────────────────────────────────────────────────────────

export const MOCK_PERMISSIONS = [
  { id: 1,  parentId: null, name: '仪表盘',         code: 'dashboard:read',    type: 'menu', sort: 1 },
  { id: 2,  parentId: null, name: '设备管理',       code: 'device:read',       type: 'menu', sort: 2 },
  { id: 3,  parentId: 2,    name: '设备新增',       code: 'device:create',     type: 'button', sort: 1 },
  { id: 4,  parentId: 2,    name: '设备编辑',       code: 'device:update',     type: 'button', sort: 2 },
  { id: 5,  parentId: 2,    name: '设备删除',       code: 'device:delete',     type: 'button', sort: 3 },
  { id: 6,  parentId: null, name: '数据报表',       code: 'telemetry:read',    type: 'menu', sort: 3 },
  { id: 7,  parentId: null, name: '能耗走势',       code: 'energy:read',       type: 'menu', sort: 4 },
  { id: 8,  parentId: null, name: '告警中心',       code: 'alarm:read',        type: 'menu', sort: 5 },
  { id: 9,  parentId: 8,    name: '告警确认',       code: 'alarm:confirm',     type: 'button', sort: 1 },
  { id: 10, parentId: null, name: '事件中心',       code: 'events:read',       type: 'menu', sort: 6 },
  { id: 11, parentId: null, name: '策略配置',       code: 'policy:read',       type: 'menu', sort: 7 },
  { id: 12, parentId: 11,   name: '策略创建',       code: 'policy:create',     type: 'button', sort: 1 },
  { id: 13, parentId: 11,   name: '策略编辑',       code: 'policy:update',     type: 'button', sort: 2 },
  { id: 14, parentId: 11,   name: '策略删除',       code: 'policy:delete',     type: 'button', sort: 3 },
  { id: 15, parentId: null, name: '智能助手',       code: 'assistant:read',    type: 'menu', sort: 8 },
  { id: 16, parentId: null, name: '系统日志',       code: 'audit:read',        type: 'menu', sort: 9 },
  { id: 17, parentId: null, name: '用户管理',       code: 'user:read',         type: 'menu', sort: 10 },
  { id: 18, parentId: 17,   name: '用户新增',       code: 'user:create',       type: 'button', sort: 1 },
  { id: 19, parentId: 17,   name: '用户编辑',       code: 'user:update',       type: 'button', sort: 2 },
  { id: 20, parentId: 17,   name: '用户删除',       code: 'user:delete',       type: 'button', sort: 3 },
  { id: 21, parentId: null, name: '系统管理',       code: 'system:admin',      type: 'menu', sort: 11 },
  { id: 22, parentId: 21,   name: '权限管理',       code: 'permission:admin',  type: 'menu', sort: 1 },
  { id: 23, parentId: 21,   name: '菜单管理',       code: 'menu:admin',        type: 'menu', sort: 2 },
  { id: 24, parentId: 21,   name: '角色管理',       code: 'role:admin',        type: 'menu', sort: 3 },
  { id: 25, parentId: 21,   name: '分区管理',       code: 'area:admin',        type: 'menu', sort: 4 },
]

// ── 角色 Mock 数据 ─────────────────────────────────────────────────────────

const MOCK_ROLES = [
  { id: 1, name: '系统管理员', roleCode: 'SUPER_ADMIN',  description: '拥有所有权限，可管理系统配置' },
  { id: 2, name: '市政人员',   roleCode: 'MUNICIPAL',    description: '查看和分析市政数据' },
  { id: 3, name: '路灯管理员', roleCode: 'MAINTENANCE',  description: '管理路灯设备与策略' },
  { id: 4, name: '安全应急员', roleCode: 'EMERGENCY',    description: '处理告警与突发事件' },
]

// 每个角色的权限 ID 集合
const ROLE_PERMISSIONS = {
  SUPER_ADMIN: MOCK_PERMISSIONS.map(p => p.id),
  MUNICIPAL:   [1, 2, 6, 7, 8, 9, 10, 15, 16],
  MAINTENANCE: [1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15],
  EMERGENCY:   [1, 2, 8, 9, 10, 11, 15],
}

let nextRoleId = 100

export function getMockRoles() {
  return MOCK_ROLES.map(r => ({
    ...r,
    permissionIds: ROLE_PERMISSIONS[r.roleCode] || [],
  }))
}

export function getMockRoleById(id) {
  const role = MOCK_ROLES.find(r => r.id === Number(id))
  if (!role) return null
  return { ...role, permissionIds: ROLE_PERMISSIONS[role.roleCode] || [] }
}

export function setMockRolePermissions(id, permissionIds) {
  const role = MOCK_ROLES.find(r => r.id === Number(id))
  if (role) {
    ROLE_PERMISSIONS[role.roleCode] = permissionIds
  }
  return { success: true }
}

// ── 菜单 Mock 数据 ─────────────────────────────────────────────────────────

const MOCK_MENUS = [
  { id: 1,  parentId: null, name: '数字孪生', path: '/dashboard',          icon: 'grid',     sort: 1,  visible: true },
  { id: 2,  parentId: null, name: '设备管理', path: '/devices',            icon: 'bulb',     sort: 2,  visible: true },
  { id: 3,  parentId: null, name: '数据报表', path: '/analytics',          icon: 'chart',    sort: 3,  visible: true },
  { id: 4,  parentId: null, name: '能耗走势', path: '/energy',             icon: 'energy',   sort: 4,  visible: true },
  { id: 5,  parentId: null, name: '告警中心', path: '/warning',            icon: 'warning',  sort: 5,  visible: true },
  { id: 13, parentId: null, name: '事件中心', path: '/events',             icon: 'eye',      sort: 6,  visible: true },
  { id: 6,  parentId: null, name: '策略配置', path: '/strategy',           icon: 'strategy', sort: 7,  visible: true },
  { id: 7,  parentId: null, name: '智能助手', path: '/assistant',          icon: 'robot',    sort: 8,  visible: true },
  { id: 8,  parentId: null, name: '系统日志', path: '/logs',               icon: 'history',  sort: 9,  visible: true },
  { id: 9,  parentId: null, name: '用户管理', path: '/users',              icon: 'user',     sort: 10, visible: true },
  { id: 10, parentId: null, name: '系统管理', path: '/system',             icon: 'setting',  sort: 11, visible: true },
  { id: 11, parentId: 10,   name: '权限管理', path: '/system/permission',  icon: '',         sort: 1,  visible: true },
  { id: 12, parentId: 10,   name: '菜单管理', path: '/system/menu',        icon: '',         sort: 2,  visible: true },
  { id: 14, parentId: 10,   name: '角色管理', path: '/system/role',        icon: '',         sort: 3,  visible: true },
  { id: 15, parentId: 10,   name: '分区管理', path: '/devices/area',       icon: '',         sort: 4,  visible: true },
]

export function getMockMenuList() {
  return MOCK_MENUS.map(m => ({ ...m }))
}

export function buildMockMenuTree(parentId = null) {
  return MOCK_MENUS
    .filter(m => (m.parentId ?? null) === parentId)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map(m => ({
      id: m.id,
      name: m.name,
      path: m.path,
      icon: m.icon,
      sort: m.sort,
      children: buildMockMenuTree(m.id),
    }))
}

export function updateMockMenu(id, data) {
  const menu = MOCK_MENUS.find(m => m.id === Number(id))
  if (menu) Object.assign(menu, data)
  return { ...menu }
}

// ── 用户 Mock 数据 ─────────────────────────────────────────────────────────

const MOCK_USERS = [
  { id: 1,  username: 'admin',      realName: '系统管理员',  email: 'admin@smartlight.com',      phone: '13800000001', roleId: 1, roleCode: 'SUPER_ADMIN',  roleName: '系统管理员', enabled: true,  createTime: '2024-01-01T00:00:00' },
  { id: 2,  username: 'municipal',  realName: '张市政',      email: 'zhang@smartlight.com',      phone: '13800000002', roleId: 2, roleCode: 'MUNICIPAL',    roleName: '市政人员',   enabled: true,  createTime: '2024-01-15T08:30:00' },
  { id: 3,  username: 'maintainer', realName: '李路灯',      email: 'li@smartlight.com',         phone: '13800000003', roleId: 3, roleCode: 'MAINTENANCE',  roleName: '路灯管理员', enabled: true,  createTime: '2024-02-01T09:00:00' },
  { id: 4,  username: 'emergency',  realName: '王应急',      email: 'wang@smartlight.com',       phone: '13800000004', roleId: 4, roleCode: 'EMERGENCY',    roleName: '安全应急员', enabled: true,  createTime: '2024-03-01T10:00:00' },
  { id: 5,  username: 'disabled01', realName: '赵停用',      email: 'zhao@smartlight.com',       phone: '13800000005', roleId: 3, roleCode: 'MAINTENANCE',  roleName: '路灯管理员', enabled: false, createTime: '2024-03-15T14:00:00' },
]

let nextUserId = 100

export function buildMockUserPage(query = {}) {
  const pageNum = query.page || query.pageNum || 1
  const pageSize = query.size || query.pageSize || 10

  let list = [...MOCK_USERS]
  if (query.username) list = list.filter(u => u.username.includes(query.username))
  if (query.realName) list = list.filter(u => u.realName.includes(query.realName))
  if (query.roleId != null) list = list.filter(u => u.roleId === query.roleId)

  const total = list.length
  const start = (pageNum - 1) * pageSize
  return {
    records: list.slice(start, start + pageSize),
    total,
    size: pageSize,
    current: pageNum,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

export function createMockUser(data) {
  const user = {
    id: nextUserId++,
    username: data.username || '',
    realName: data.realName || '',
    email: data.email || '',
    phone: data.phone || '',
    roleId: data.roleId ?? null,
    roleCode: data.roleCode || '',
    roleName: data.roleName || '',
    enabled: true,
    createTime: new Date().toISOString(),
  }
  MOCK_USERS.push(user)
  return { success: true, id: user.id }
}

export function updateMockUser(id, data) {
  const user = MOCK_USERS.find(u => u.id === Number(id))
  if (user) Object.assign(user, data)
  return { ...user }
}

export function deleteMockUser(id) {
  const idx = MOCK_USERS.findIndex(u => u.id === Number(id))
  if (idx >= 0) MOCK_USERS.splice(idx, 1)
  return { success: true }
}

export function batchDeleteMockUsers(ids) {
  ids.forEach(id => {
    const idx = MOCK_USERS.findIndex(u => u.id === Number(id))
    if (idx >= 0) MOCK_USERS.splice(idx, 1)
  })
  return { success: true }
}
