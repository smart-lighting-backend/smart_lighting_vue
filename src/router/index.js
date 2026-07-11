/**
 * Vue Router 配置
 * - /login          公开路由
 * - /dashboard 等需要登录 → 使用 MainLayout 布局
 * - beforeEach 守卫：检查 Token 是否存在
 * - 登录后从 /me 刷新 permissions 和 menus
 */
import { createRouter, createWebHistory } from 'vue-router'
import { getToken, clearAuth, saveAuth, savePermissions, saveMenus, fetchCurrentUser, getUserInfo, getPermissions, getRoleLabel, isAuthFresh } from '../api/auth.js'

const routes = [
  {
    path: '/',
    redirect: '/login',
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { public: true },
  },
  // ── 登录后主布局 ─────────────────────────────────────────────────────────
  {
    path: '/',
    component: () => import('../layouts/MainLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('../views/Dashboard.vue'),
        meta: { title: '数字孪生', permission: 'dashboard:read' },
      },
      {
        path: 'devices',
        name: 'Devices',
        component: () => import('../views/Devices.vue'),
        meta: { title: '设备管理', permission: 'device:read' },
      },
      {
        path: 'devices/area',
        name: 'AreaManagement',
        component: () => import('../views/AreaManagement.vue'),
        meta: { title: '分区管理', adminOnly: true },
      },
      {
        path: 'devices/:id',
        name: 'DeviceDetail',
        component: () => import('../views/DeviceDetail.vue'),
        meta: { title: '设备详情', permission: 'device:read' },
      },
      {
        path: 'analytics',
        name: 'Analytics',
        component: () => import('../views/Analytics.vue'),
        meta: { title: '数据报表', permission: 'telemetry:read' },
      },
      {
        path: 'warning',
        name: 'Warning',
        component: () => import('../views/Warning.vue'),
        meta: { title: '告警中心', permission: 'alarm:read' },
      },
      {
        path: 'strategy',
        name: 'Strategy',
        component: () => import('../views/Strategy.vue'),
        meta: { title: '策略配置', permission: 'policy:read' },
      },
      {
        path: 'strategy/create',
        name: 'StrategyCreate',
        component: () => import('../views/StrategyCreate.vue'),
        meta: { title: '新建策略', permission: 'policy:create' },
      },
      {
        path: 'strategy/edit/:id',
        name: 'StrategyEdit',
        component: () => import('../views/StrategyCreate.vue'),
        meta: { title: '编辑策略', permission: 'policy:update' },
      },
      {
        path: 'assistant',
        name: 'AIAssistant',
        component: () => import('../views/AIAssistant.vue'),
        meta: { title: '智能助手', permission: 'assistant:read' },
      },
      {
        path: 'logs',
        name: 'SystemLog',
        component: () => import('../views/SystemLog.vue'),
        meta: { title: '系统日志', permission: 'audit:read' },
      },
      {
        path: 'users',
        name: 'UserManagement',
        component: () => import('../views/UserManagement.vue'),
        meta: { title: '用户管理', permission: 'user:read' },
      },
      // ── 系统管理子页面（仅超级管理员可访问）────────────────────────────────
      {
        path: 'system/permission',
        name: 'PermissionManagement',
        component: () => import('../views/PermissionManagement.vue'),
        meta: { title: '权限管理', adminOnly: true },
      },
      {
        path: 'system/menu',
        name: 'MenuManagement',
        component: () => import('../views/MenuManagement.vue'),
        meta: { title: '菜单管理', adminOnly: true },
      },
      {
        path: 'system/role',
        name: 'RoleManagement',
        component: () => import('../views/RoleManagement.vue'),
        meta: { title: '角色管理', adminOnly: true },
      },
      // ── 旧路由重定向 → 统一路径规范 ──────────────────────────────────────────
      {
        path: 'device/list',
        redirect: '/devices',
      },
      {
        path: 'device/detail/:id',
        redirect: to => `/devices/${to.params.id}`,
      },
      {
        path: 'alarm/list',
        redirect: '/warning',
      },
      {
        path: 'alarm/detail/:id',
        redirect: '/warning',
      },
      {
        path: 'energy',
        name: 'EnergyTrend',
        component: () => import('../views/EnergyTrend.vue'),
        meta: { title: '能耗走势', permission: 'energy:read' },
      },
      {
        path: 'events',
        name: 'EventCenter',
        component: () => import('../views/EventCenter.vue'),
        meta: { title: '事件中心', permission: 'events:read' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/login',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// ─── 导航守卫 ─────────────────────────────────────────────────────────────
let lastRefreshTime = 0
const REFRESH_INTERVAL = 30 * 1000 // 30 秒刷新一次权限

router.beforeEach(async (to, from) => {
  const token = getToken()

  if (to.meta.public) {
    return true
  }

  if (!token) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  const hasCachedUser = Boolean(getUserInfo())

  // 数据刚由注册/登录保存（35 秒内），跳过 /me 校验
  if (!hasCachedUser || (!isAuthFresh() && Date.now() - lastRefreshTime > REFRESH_INTERVAL)) {
    try {
      const res = await fetchCurrentUser()
      if (res?.data) {
        const { username, realName, phone, email, roleCode, permissions, menus } = res.data
        const inLocal = !!localStorage.getItem('smart_light_token')
        saveAuth(token, { username, realName, phone, email, roleCode, roleName: getRoleLabel(roleCode) }, inLocal)
        savePermissions(permissions || [], inLocal)
        saveMenus(menus || [], inLocal)
      }
      lastRefreshTime = Date.now()
    } catch (refreshErr) {
      // 网络不可用或服务器错误 → 静默使用缓存（与 Login.vue Mock 降级逻辑一致）
      const httpStatus   = refreshErr?.response?.status
      const isNetworkErr = !refreshErr?.response && !refreshErr?.bizCode
      const isServerErr  = httpStatus != null && httpStatus >= 500
      if (isNetworkErr || isServerErr) {
        if (!hasCachedUser) {
          clearAuth()
          return { path: '/login', query: { redirect: to.fullPath } }
        }
        console.warn('[Router] 刷新权限失败，使用缓存:', refreshErr?.message)
        lastRefreshTime = Date.now()  // 避免不断的重试
      } else {
        // 401 或业务错误 → 清除登录状态
        clearAuth()
        return { path: '/login', query: { redirect: to.fullPath } }
      }
    }
  }

  // 权限检查：路由声明了 permission 但用户没有对应权限 → 403
  if (to.meta.permission) {
    const perms = getPermissions()
    if (!perms || !perms.includes(to.meta.permission)) {
      console.warn('[Router] 缺少权限: ' + to.meta.permission + '，已重定向')
      return { path: '/dashboard' }
    }
  }

  // 管理员专属页面检查
  if (to.meta.adminOnly) {
    const user = getUserInfo()
    if (!user || user.roleCode !== 'SUPER_ADMIN') {
      console.warn('[Router] 非管理员尝试访问系统管理页面，已重定向')
      return { path: '/dashboard' }
    }
  }

  return true
})

export default router
