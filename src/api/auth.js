/**
 * 认证相关 API
 * 接口文档 V1.0 — 用户登录与鉴权（谭佩）
 *
 * POST /api/auth/login   → 登录，返回 { token, username, roleCode }
 * GET  /api/auth/me      → 获取当前用户信息 / 校验 Token
 */
import { shallowRef } from 'vue'
import request from './request.js'

const TOKEN_KEY       = 'smart_light_token'
const USER_KEY        = 'smart_light_user'
const PERMISSIONS_KEY = 'smart_light_permissions'
const MENUS_KEY       = 'smart_light_menus'
const AUTH_FRESH_KEY  = 'smart_light_auth_fresh'  // 标记认证数据是刚保存的

// 响应式权限版本计数器 —— 每次 permissions 变更时递增，
// useUserInfo 中的 computed 依赖此值，从而触发组件重新渲染
const _permVersion = shallowRef(0)
export function getPermVersionRef() {
  return _permVersion
}

// ────────────────────────── 登录 / 登出 ──────────────────────────────────

/**
 * 用户登录
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ code, msg, data: { token, username, roleCode } }>}
 */
export function login(username, password) {
  return request.post('/api/auth/login', { username, password })
}

/** 用户自助注册 */
export function registerUser(data) {
  return request.post('/api/auth/register', data)
}

/**
 * 获取当前登录用户信息 / 校验 Token 有效性
 * @returns {Promise<{ code, msg, data: { token, username, roleCode } }>}
 */
export function fetchCurrentUser() {
  return request.get('/api/auth/me')
}

// ────────────────────────── Token 工具函数 ───────────────────────────────

/**
 * 保存认证信息
 * @param {string} token
 * @param {{ username: string, realName?: string, department?: string, phone?: string, roleCode: string, roleName?: string }} userInfo
 * @param {boolean} remember  true → localStorage（持久），false → sessionStorage
 */
export function saveAuth(token, userInfo, remember = false) {
  const storage = remember ? localStorage : sessionStorage
  storage.setItem(TOKEN_KEY, token)
  storage.setItem(USER_KEY, JSON.stringify(userInfo))
}

/**
 * 保存权限列表
 * @param {string[]} permissions 权限编码数组
 * @param {boolean} persist 是否持久化（与 token 保持一致）
 */
export function savePermissions(permissions, persist = false) {
  const storage = persist ? localStorage : sessionStorage
  storage.setItem(PERMISSIONS_KEY, JSON.stringify(permissions || []))
  _permVersion.value++  // 递增版本号，Vue  reactivity 自动通知所有使用方
}

/**
 * 获取本地缓存的权限列表
 * @returns {string[]}
 */
export function getPermissions() {
  const raw = sessionStorage.getItem(PERMISSIONS_KEY) || localStorage.getItem(PERMISSIONS_KEY)
  try { return raw ? JSON.parse(raw) : [] } catch { return [] }
}

/**
 * 保存菜单树
 * @param {object[]} menus 菜单树形数据
 * @param {boolean} persist 是否持久化
 */
export function saveMenus(menus, persist = false) {
  const storage = persist ? localStorage : sessionStorage
  storage.setItem(MENUS_KEY, JSON.stringify(menus || []))
}

/**
 * 获取本地缓存的菜单树
 * @returns {object[]}
 */
export function getMenus() {
  const raw = sessionStorage.getItem(MENUS_KEY) || localStorage.getItem(MENUS_KEY)
  try { return raw ? JSON.parse(raw) : [] } catch { return [] }
}

/**
 * 获取 Token（优先 sessionStorage，再 localStorage）
 */
export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY)
}

/**
 * 获取本地缓存的用户信息
 */
export function getUserInfo() {
  const raw = sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY)
  try { return raw ? JSON.parse(raw) : null } catch { return null }
}

/**
 * 清除所有认证信息（双 storage 都清）
 */
export function clearAuth() {
  ;[localStorage, sessionStorage].forEach(s => {
    s.removeItem(TOKEN_KEY)
    s.removeItem(USER_KEY)
    s.removeItem(PERMISSIONS_KEY)
    s.removeItem(MENUS_KEY)
    s.removeItem(AUTH_FRESH_KEY)
  })
}

/**
 * 标记认证数据为刚保存的（注册/登录后调用，让导航守卫跳过 /me 校验）
 */
export function markAuthFresh() {
  sessionStorage.setItem(AUTH_FRESH_KEY, String(Date.now()))
}

/**
 * 检查认证数据是否是刚保存的（30 秒内）
 */
export function isAuthFresh() {
  const ts = sessionStorage.getItem(AUTH_FRESH_KEY) || localStorage.getItem(AUTH_FRESH_KEY)
  return ts && (Date.now() - Number(ts) < 35000)
}

/**
 * 是否已登录（仅判断 token 存在）
 */
export function isLoggedIn() {
  return !!getToken()
}

/**
 * 判断是否为 Mock 登录返回的 Token
 */
export function isMockAuthToken(token) {
  return typeof token === 'string' && token.startsWith('mock-token-dev-')
}

// ────────────────────────── 角色工具 ─────────────────────────────────────

/** 角色编码 → 中文名映射 */
export const ROLE_LABELS = {
  SUPER_ADMIN: '系统管理员',
  MUNICIPAL:   '市政人员',
  MAINTENANCE: '路灯管理员',
  EMERGENCY:   '安全应急员',
}

export function getRoleLabel(roleCode) {
  return ROLE_LABELS[roleCode] || roleCode || '未知角色'
}

/**
 * 检查当前用户是否拥有指定权限
 * @param {string} permissionCode 权限编码，如 "device:create"
 * @returns {boolean}
 */
export function hasPermission(permissionCode) {
  return getPermissions().includes(permissionCode)
}

/**
 * 从 /me 接口刷新 permissions 和 menus
 */
export async function refreshPermissionsAndMenus() {
  try {
    const res = await fetchCurrentUser()
    if (res?.data) {
      const { permissions, menus } = res.data
      const inLocal = !!localStorage.getItem('smart_light_token')
      savePermissions(permissions || [], inLocal)
      saveMenus(menus || [], inLocal)
      return { permissions: permissions || [], menus: menus || [] }
    }
  } catch {
    // 静默失败，使用本地缓存
  }
  return { permissions: getPermissions(), menus: getMenus() }
}
