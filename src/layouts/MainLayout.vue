<script setup>
import { ref, computed, onMounted, provide } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserInfo } from '../composables/useUserInfo.js'
import { clearAuth, getMenus, saveMenus, refreshPermissionsAndMenus, getUserInfo, getPermissions, saveAuth } from '../api/auth.js'
import { fetchAlarmPage } from '../api/warnings.js'
import { useMqtt } from '../composables/useMqtt.js'
import { fetchVisibleMenus } from '../api/menu.js'
import { updateProfile, changePassword } from '../api/profile.js'
import ManualControlModal from '../components/ManualControlModal.vue'

const route  = useRoute()
const router = useRouter()
const { realName, phone, email, roleName, permissions } = useUserInfo()

const showManual = ref(false)
const showUserInfo = ref(false)
const alarmCount = ref(0)

// ═══ 编辑资料/修改密码 ═══
const showEditProfile = ref(false)
const showChangePwd = ref(false)
const submitting = ref(false)
const editForm = ref({ realName: '', phone: '', email: '' })
const pwdForm = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })
const pwdError = ref('')

function openEditProfile() {
  const info = getUserInfo()
  editForm.value = {
    realName: info?.realName || '',
    phone: info?.phone || '',
    email: info?.email || '',
  }
  showEditProfile.value = true
}

async function handleSaveProfile() {
  submitting.value = true
  try {
    await updateProfile(editForm.value)
    // 更新本地缓存的用户信息
    const info = getUserInfo()
    if (info) {
      saveAuth(
        localStorage.getItem('smart_light_token') || sessionStorage.getItem('smart_light_token'),
        { ...info, ...editForm.value },
        !!localStorage.getItem('smart_light_token')
      )
    }
    showEditProfile.value = false
  } catch (e) {
    alert(e?.message || e?.msg || '保存失败')
  } finally {
    submitting.value = false
  }
}

function openChangePwd() {
  pwdForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
  pwdError.value = ''
  showChangePwd.value = true
}

async function handleChangePwd() {
  pwdError.value = ''
  if (!pwdForm.value.oldPassword || !pwdForm.value.newPassword) {
    pwdError.value = '请填写完整'
    return
  }
  if (pwdForm.value.newPassword.length < 6) {
    pwdError.value = '新密码长度不能少于6位'
    return
  }
  if (pwdForm.value.newPassword !== pwdForm.value.confirmPassword) {
    pwdError.value = '两次输入的新密码不一致'
    return
  }
  submitting.value = true
  try {
    await changePassword({
      oldPassword: pwdForm.value.oldPassword,
      newPassword: pwdForm.value.newPassword,
    })
    showChangePwd.value = false
    alert('密码修改成功')
  } catch (e) {
    pwdError.value = e?.message || e?.msg || '修改失败'
  } finally {
    submitting.value = false
  }
}

// ═══ 沉浸模式（侧边栏 + 顶栏收起） ═══
const sidebarCollapsed = ref(false)
const headerCollapsed = ref(false)
const isImmersive = computed(() => sidebarCollapsed.value && headerCollapsed.value)
function toggleImmersive() {
  if (isImmersive.value) {
    sidebarCollapsed.value = false
    headerCollapsed.value = false
  } else {
    sidebarCollapsed.value = true
    headerCollapsed.value = true
  }
}
provide('immersiveMode', { isImmersive, toggleImmersive })

// ═══ 动态导航菜单（遵循文档：登录后使用API返回的menus，刷新时请求/me）═══════════════════════════
const menus = ref([])
const loadingMenus = ref(true)
const expandedIds = ref(new Set())

// 兜底菜单数据（文档定义的完整菜单树）
const FALLBACK_MENUS = [
  { id: 1, name: '数字孪生', path: '/dashboard', icon: 'grid', sort: 1, children: [] },
  { id: 2, name: '设备管理', path: '/devices', icon: 'bulb', sort: 2, children: [] },
  { id: 3, name: '数据报表', path: '/analytics', icon: 'chart', sort: 3, children: [] },
  { id: 4, name: '能耗走势', path: '/energy', icon: 'energy', sort: 4, children: [] },
  { id: 5, name: '告警中心', path: '/warning', icon: 'warning', sort: 5, children: [] },
  { id: 13, name: '事件中心', path: '/events', icon: 'eye', sort: 6, children: [] },
  { id: 6, name: '策略配置', path: '/strategy', icon: 'strategy', sort: 7, children: [] },
  { id: 7, name: '智能助手', path: '/assistant', icon: 'robot', sort: 8, children: [] },
  { id: 8, name: '系统日志', path: '/logs', icon: 'history', sort: 9, children: [] },
  { id: 9, name: '用户管理', path: '/users', icon: 'user', sort: 10, children: [] },
  {
    id: 10, name: '系统管理', path: '/system', icon: 'setting', sort: 11, children: [
      { id: 11, name: '权限管理', path: '/system/permission', icon: '', sort: 1, children: [] },
      { id: 12, name: '菜单管理', path: '/system/menu', icon: '', sort: 2, children: [] },
      { id: 14, name: '分区管理', path: '/devices/area', icon: '', sort: 3, children: [] }
    ]
  }
]

async function loadMenus() {
  if (menus.value.length === 0) {
    loadingMenus.value = true
  }
  try {
    const res = await fetchVisibleMenus()

    let menuData = res
    if (res && typeof res === 'object' && 'data' in res) {
      menuData = res.data
    }

    if (menuData && Array.isArray(menuData) && menuData.length > 0) {
      menus.value = menuData.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      const inLocal = !!localStorage.getItem('smart_light_token')
      saveMenus(menus.value, inLocal)
    } else {
      const cached = getMenus()
      if (cached && cached.length > 0) {
        menus.value = cached.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      } else {
        menus.value = FALLBACK_MENUS
      }
    }
    filterAdminMenus()
    autoExpandMenus()
  } catch (error) {
    const cached = getMenus()
    if (cached && cached.length > 0) {
      menus.value = cached.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    } else {
      menus.value = FALLBACK_MENUS
    }
    filterAdminMenus()
    autoExpandMenus()
  } finally {
    loadingMenus.value = false
  }
}

const navItems = computed(() => {
  return menus.value
})

const activeNav = computed(() => {
  const currentPath = normalizePath(route.path)
  const items = flattenMenu(navItems.value)

  const exactMatch = items.find(item => normalizePath(item.path) === currentPath)
  if (exactMatch) return exactMatch.id

  const prefixMatch = items
    .filter(item => {
      const itemPath = normalizePath(item.path)
      return itemPath && itemPath !== '/' && currentPath.startsWith(`${itemPath}/`)
    })
    .sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length)[0]

  return prefixMatch?.id ?? null
})

function normalizePath(path) {
  if (!path) return ''
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

function flattenMenu(items) {
  const result = []
  function walk(list) {
    for (const item of list) {
      result.push(item)
      if (item.children && item.children.length > 0) walk(item.children)
    }
  }
  walk(items)
  return result
}

function hasActiveDescendant(item) {
  return item.children?.some(child => activeNav.value === child.id || hasActiveDescendant(child)) ?? false
}

function isMenuActive(item) {
  return activeNav.value === item.id || hasActiveDescendant(item)
}

function isExpanded(item) {
  if (expandedIds.value.has(item.id)) return true
  return isMenuActive(item)
}

function renderIcon(iconName) {
  const icons = {
    grid:        '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" fill="currentColor" opacity="0.85"/><rect x="14" y="3" width="7" height="7" rx="1" fill="currentColor" opacity="0.85"/><rect x="3" y="14" width="7" height="7" rx="1" fill="currentColor" opacity="0.85"/><rect x="14" y="14" width="7" height="7" rx="1" fill="currentColor" opacity="0.85"/></svg>',
    bulb:        '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7z" fill="currentColor" opacity="0.85"/><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1z" fill="currentColor" opacity="0.6"/></svg>',
    chart:       '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="12" width="4" height="9" rx="1" fill="currentColor" opacity="0.6"/><rect x="10" y="7" width="4" height="14" rx="1" fill="currentColor" opacity="0.8"/><rect x="17" y="3" width="4" height="18" rx="1" fill="currentColor"/></svg>',
    energy:      '<svg viewBox="0 0 24 24" fill="none"><path d="M3 20l3-6h3L6 4h2l6 10h-3l2 6H7l-4-8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="20" cy="18" r="2" stroke="currentColor" stroke-width="1.2"/><path d="M20 7v7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    warning:     '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2L2 20h20L12 2z" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="1.5"/><path d="M12 9v5M12 16.5v.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    strategy:    '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.64 5.64l2.12 2.12M16.24 16.24l2.12 2.12M5.64 18.36l2.12-2.12M16.24 7.76l2.12-2.12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    robot:       '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="8" width="16" height="12" rx="2" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="13" r="1.5" fill="currentColor"/><circle cx="15" cy="13" r="1.5" fill="currentColor"/><path d="M9 17h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 8V5M10 5h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    history:     '<svg viewBox="0 0 24 24" fill="none"><path d="M12 8v4l3 3M3 12a9 9 0 1 0 18 0A9 9 0 0 0 3 12z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    user:        '<svg viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    setting:     '<svg viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" fill="currentColor" opacity="0.4"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008.9 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 8.9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 008.9 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 8.9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="1.5"/></svg>',
    eye:         '<svg viewBox="0 0 24 24" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  }
  const fallbackIcon = '<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>'
  return iconName && icons[iconName] ? icons[iconName] : fallbackIcon
}

function logout() {
  clearAuth()
  router.push('/login')
}

function navigateTo(item) {
  if (item.children && item.children.length > 0) {
    if (expandedIds.value.has(item.id)) {
      expandedIds.value.delete(item.id)
    } else {
      expandedIds.value.add(item.id)
    }
    expandedIds.value = new Set(expandedIds.value)
    return
  }
  if (item.path) {
    router.push(item.path)
  }
}

function filterAdminMenus() {
  const user = getUserInfo()
  const userPerms = getPermissions()
  if (!user || user.roleCode !== 'SUPER_ADMIN') {
    const result = []
    for (const menu of menus.value) {
      if (menu.name === '系统管理' && menu.children) {
        // 对"系统管理"下的子菜单逐项做权限判断
        const keptChildren = menu.children.filter(child => {
          // 分区管理 → 根据 device_area 权限判断
          if (child.path === '/devices/area') {
            return userPerms.includes('device_area:read')
          }
          // 其他系统管理子菜单（权限管理、菜单管理等）仅管理员可见
          return false
        })
        if (keptChildren.length > 0) {
          result.push({ ...menu, children: keptChildren })
        }
      } else {
        result.push(menu)
      }
    }
    menus.value = result
  }
}

function autoExpandMenus() {
  const userPerms = getPermissions()
  const autoExpand = new Set()
  
  function checkItem(item) {
    if (item.children && item.children.length > 0) {
      const hasAccessibleChild = item.children.some(child => {
        if (!child.permissionCode || child.permissionCode === '') {
          return true
        }
        return userPerms.includes(child.permissionCode)
      })
      if (hasAccessibleChild) {
        autoExpand.add(item.id)
      }
      item.children.forEach(checkItem)
    }
  }
  
  menus.value.forEach(checkItem)
  // 保留用户手动展开的菜单，避免侧边栏切换路由后折叠
  for (const id of expandedIds.value) {
    autoExpand.add(id)
  }
  expandedIds.value = autoExpand
}

// 暴露刷新方法给子组件（菜单管理页面）
provide('reloadSidebarMenus', loadMenus)

const { subscribe: subscribeAlarm } = useMqtt()

async function refreshAlarmBadge() {
  try {
    const res = await fetchAlarmPage({ status: 'ACTIVE', pageNum: 1, pageSize: 1 })
    const d = res?.data
    alarmCount.value = d?.total ?? (Array.isArray(d) ? d.length : 0)
  } catch (_) { /* ignore */ }
}

onMounted(async () => {
  await refreshPermissionsAndMenus()
  await loadMenus()
  autoExpandMenus()
  // 只有有告警查看权限才拉取告警数量，避免触发 403 降级 Mock
  if (getPermissions().includes('alarm:read')) {
    refreshAlarmBadge()
  }
  subscribeAlarm('system/alarms', () => refreshAlarmBadge())
})

</script>

<template>
  <div class="main-layout" :class="{ immersive: isImmersive }">
    <aside class="sidebar" :class="{ collapsed: sidebarCollapsed }">
      <div class="sidebar-brand">
        <div class="brand-logo">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7z" fill="currentColor"/><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1z" fill="currentColor" opacity="0.7"/></svg>
        </div>
        <div class="brand-text">
          <span class="brand-title">智慧路灯管理</span>
          <span class="brand-sub">智能节能系统</span>
        </div>
      </div>

      <nav class="sidebar-nav">
        <template v-if="loadingMenus">
          <div class="nav-skeleton">
            <div class="skeleton-shimmer" style="height:18px; width:70%; margin:10px 12px;"></div>
            <div class="skeleton-shimmer" style="height:18px; width:55%; margin:10px 12px;"></div>
            <div class="skeleton-shimmer" style="height:18px; width:80%; margin:10px 12px;"></div>
            <div class="skeleton-shimmer" style="height:18px; width:45%; margin:10px 12px;"></div>
            <div class="skeleton-shimmer" style="height:18px; width:60%; margin:10px 12px;"></div>
          </div>
        </template>
        <template v-else>
          <template v-for="item in navItems" :key="item.id">
            <div v-if="item.children && item.children.length > 0" class="nav-group">
              <div
                class="nav-item nav-parent"
                :class="{ active: isMenuActive(item), expanded: isExpanded(item) }"
                @click="navigateTo(item)"
              >
                <span v-if="renderIcon(item.icon)" class="nav-icon" v-html="renderIcon(item.icon)"></span>
                <span class="nav-label">{{ item.name }}</span>
                <svg class="nav-arrow" :class="{ rotated: isExpanded(item) }" viewBox="0 0 24 24" fill="none" width="14" height="14">
                  <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </div>
              <div v-if="isExpanded(item)" class="nav-sub">
                <router-link
                  v-for="child in item.children"
                  :key="child.id"
                  :to="child.path"
                  class="nav-item nav-child"
                  :class="{ active: activeNav === child.id }"
                >
                  <span class="nav-dot"></span>
                  <span class="nav-label">{{ child.name }}</span>
                </router-link>
              </div>
            </div>
            <router-link
              v-else
              :to="item.path"
              class="nav-item"
              :class="{ active: activeNav === item.id }"
            >
              <span v-if="renderIcon(item.icon)" class="nav-icon" v-html="renderIcon(item.icon)"></span>
              <span class="nav-label">{{ item.name }}</span>
            </router-link>
          </template>
          <div v-if="navItems.length === 0" class="nav-empty">
            暂无可用菜单
          </div>
        </template>
      </nav>

      <div class="sidebar-user" @click="showUserInfo = true">
        <div class="user-avatar">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-2.67 0-8 1.34-8 4v1a1 1 0 001 1h14a1 1 0 001-1v-1c0-2.66-5.33-4-8-4z" fill="currentColor"/></svg>
        </div>
        <div class="user-info">
          <span class="user-name">{{ username }}</span>
          <span class="user-role">{{ roleName }}</span>
        </div>
      </div>
    </aside>

    <div class="main-body">
      <header class="top-bar" :class="{ collapsed: headerCollapsed }">
        <div class="top-bar-left">
          <span class="top-brand">智慧路灯节能系统</span>
          <nav class="top-nav">
            <router-link to="/dashboard" class="top-nav-link" :class="{ active: activeNav === 1 || activeNav === 3 }">实时监控</router-link>
            <router-link to="/analytics" class="top-nav-link" :class="{ active: activeNav === 3 }">能耗看板</router-link>
          </nav>
        </div>
        <div class="top-bar-right">
          <button class="manual-btn" @click="showManual = true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h10M4 18h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            手动控制
          </button>
          <button class="icon-btn" @click="$router.push('/warning')">
            <svg viewBox="0 0 24 24" fill="none"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <span class="badge-dot" v-if="alarmCount > 0">{{ alarmCount }}</span>
          </button>

        </div>
      </header>

      <main class="page-content">
        <RouterView v-slot="{ Component }">
          <Transition name="fade-page" mode="out-in">
            <KeepAlive :max="8">
              <component :is="Component" />
            </KeepAlive>
          </Transition>
        </RouterView>
      </main>
    </div>

    <ManualControlModal v-if="showManual" :initialDeviceId="route.params.id || ''" @close="showManual = false" />

    <!-- 用户基本信息弹窗 -->
    <Transition name="fade-up">
      <div v-if="showUserInfo" class="user-info-overlay" @click.self="showUserInfo = false">
        <div class="user-info-card" role="dialog" aria-modal="true" aria-labelledby="user-info-title">
          <button class="ui-close" type="button" aria-label="关闭用户信息" title="关闭" @click="showUserInfo = false">
            <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
          <div class="ui-header">
            <div class="ui-avatar">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-2.67 0-8 1.34-8 4v1a1 1 0 001 1h14a1 1 0 001-1v-1c0-2.66-5.33-4-8-4z" fill="currentColor"/></svg>
            </div>
            <div class="ui-title" id="user-info-title">用户信息</div>
          </div>
          <div class="ui-body">
            <div class="ui-row">
              <span class="ui-label">姓名</span>
              <span class="ui-value">{{ realName }}</span>
            </div>
            <div class="ui-row">
              <span class="ui-label">联系电话</span>
              <span class="ui-value">{{ phone }}</span>
            </div>
            <div class="ui-row">
              <span class="ui-label">邮箱</span>
              <span class="ui-value">{{ email || '未设置' }}</span>
            </div>
            <div class="ui-row">
              <span class="ui-label">角色</span>
              <span class="ui-value">{{ roleName }}</span>
            </div>
          </div>
          <div class="ui-footer">
            <button class="ui-btn-edit" type="button" @click="openEditProfile">
              编辑资料
            </button>
            <button class="ui-btn-pwd" type="button" @click="openChangePwd">
              修改密码
            </button>
            <button class="ui-logout-btn" type="button" @click="logout">
              <svg viewBox="0 0 24 24" fill="none"><path d="M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              退出登录
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 编辑资料弹窗 -->
    <Transition name="fade-up">
      <div v-if="showEditProfile" class="user-info-overlay" @click.self="showEditProfile = false">
        <div class="user-info-card edit-card" role="dialog" aria-modal="true">
          <button class="ui-close" type="button" @click="showEditProfile = false">
            <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
          <div class="ui-header">
            <div class="ui-avatar">
              <svg viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </div>
            <div class="ui-title">编辑资料</div>
          </div>
          <div class="ui-body edit-body">
            <div class="ef-row">
              <label class="ef-label">真实姓名</label>
              <input v-model="editForm.realName" class="ef-input" placeholder="请输入真实姓名" maxlength="20" />
            </div>
            <div class="ef-row">
              <label class="ef-label">手机号</label>
              <input v-model="editForm.phone" class="ef-input" placeholder="请输入手机号" maxlength="11" />
            </div>
            <div class="ef-row">
              <label class="ef-label">邮箱</label>
              <input v-model="editForm.email" class="ef-input" placeholder="请输入邮箱" maxlength="50" />
            </div>
          </div>
          <div class="ui-footer edit-footer">
            <button class="ui-btn-cancel" type="button" @click="showEditProfile = false">取消</button>
            <button class="ui-btn-save" type="button" :disabled="submitting" @click="handleSaveProfile">
              {{ submitting ? '保存中...' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 修改密码弹窗 -->
    <Transition name="fade-up">
      <div v-if="showChangePwd" class="user-info-overlay" @click.self="showChangePwd = false">
        <div class="user-info-card edit-card" role="dialog" aria-modal="true">
          <button class="ui-close" type="button" @click="showChangePwd = false">
            <svg viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
          <div class="ui-header">
            <div class="ui-avatar">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 7V5a3 3 0 116 0v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="4" y="11" width="16" height="10" rx="2" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="16" r="1.5" fill="currentColor"/><path d="M12 16v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </div>
            <div class="ui-title">修改密码</div>
          </div>
          <div class="ui-body edit-body">
            <div class="ef-row">
              <label class="ef-label">旧密码</label>
              <input v-model="pwdForm.oldPassword" class="ef-input" type="password" placeholder="请输入旧密码" maxlength="32" />
            </div>
            <div class="ef-row">
              <label class="ef-label">新密码</label>
              <input v-model="pwdForm.newPassword" class="ef-input" type="password" placeholder="至少6位" maxlength="32" />
            </div>
            <div class="ef-row">
              <label class="ef-label">确认新密码</label>
              <input v-model="pwdForm.confirmPassword" class="ef-input" type="password" placeholder="再次输入新密码" maxlength="32" />
            </div>
            <div v-if="pwdError" class="ef-error">{{ pwdError }}</div>
          </div>
          <div class="ui-footer edit-footer">
            <button class="ui-btn-cancel" type="button" @click="showChangePwd = false">取消</button>
            <button class="ui-btn-save" type="button" :disabled="submitting" @click="handleChangePwd">
              {{ submitting ? '修改中...' : '确认修改' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.main-layout {
  display: flex;
  width: 100%;
  height: 100%;
  background: #060e1f;
  overflow: hidden;
}

.sidebar {
  width: clamp(200px, calc(200px * var(--scale-ratio, 1)), 260px);
  min-width: clamp(200px, calc(200px * var(--scale-ratio, 1)), 260px);
  height: 100%;
  background: linear-gradient(180deg, #081428 0%, #060e1f 100%);
  border-right: 1px solid rgba(0, 120, 200, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  z-index: 10;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 16px 16px;
  border-bottom: 1px solid rgba(0, 120, 200, 0.1);
}
.brand-logo {
  width: 36px; height: 36px;
  background: linear-gradient(135deg, rgba(0, 150, 220, 0.3), rgba(0, 80, 160, 0.5));
  border: 1px solid rgba(77, 208, 225, 0.3);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.brand-logo svg { width: 20px; height: 20px; color: #4dd0e1; }
.brand-text { display: flex; flex-direction: column; }
.brand-title { font-size: clamp(13px, calc(13px * var(--scale-ratio, 1)), 16px); font-weight: 700; color: #e0f4ff; line-height: 1.3; }
.brand-sub { font-size: 10px; color: rgba(120, 180, 220, 0.6); margin-top: 1px; }

.sidebar-nav {
  flex: 1;
  padding: 12px 10px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-loading {
  text-align: center;
  padding: 20px;
  color: rgba(140, 190, 220, 0.4);
  font-size: 12px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  color: rgba(170, 210, 235, 0.82);
  text-decoration: none;
  font-size: clamp(13px, calc(13px * var(--scale-ratio, 1)), 15px);
  transition: all 0.2s ease;
  position: relative;
  user-select: none;
}
.nav-item:hover {
  background: rgba(0, 120, 200, 0.12);
  color: rgba(200, 230, 245, 0.95);
}
.nav-item.active {
  background: rgba(0, 150, 220, 0.18);
  color: #4dd0e1;
  border: 1px solid rgba(77, 208, 225, 0.2);
  box-shadow: inset 0 0 0 1px rgba(77, 208, 225, 0.15);
}
.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 20%;
  bottom: 20%;
  width: 3px;
  background: #4dd0e1;
  border-radius: 0 2px 2px 0;
}
.nav-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-icon :deep(svg) { width: 16px; height: 16px; }
.nav-label { flex: 1; min-width: 0; }

.nav-parent .nav-arrow {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  transition: transform 0.25s ease;
  opacity: 0.5;
}
.nav-parent .nav-arrow.rotated {
  transform: rotate(180deg);
}

.nav-sub {
  padding-left: 12px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.nav-child {
  padding: 8px 12px;
  font-size: 12px;
}
.nav-child .nav-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.4;
  flex-shrink: 0;
}
.nav-child.active .nav-dot {
  opacity: 1;
  box-shadow: 0 0 6px currentColor;
}

.nav-empty {
  text-align: center;
  padding: 40px 12px;
  color: rgba(140, 190, 220, 0.3);
  font-size: 12px;
}

.sidebar-user {
  padding: 12px 16px;
  border-top: 1px solid rgba(0, 120, 200, 0.1);
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
}
.sidebar-user:hover { background: rgba(0,120,200,0.08); }
.user-avatar {
  width: 32px; height: 32px;
  background: rgba(0, 120, 200, 0.25);
  border: 1px solid rgba(77, 208, 225, 0.3);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.user-avatar svg { width: 18px; height: 18px; color: #4dd0e1; }
.user-info { display: flex; flex-direction: column; flex: 1; }
.user-name { font-size: 12px; font-weight: 600; color: #d0eaf8; }
.user-role { font-size: 10px; color: rgba(120, 180, 210, 0.55); margin-top: 1px; }

.fade-up-enter-active, .fade-up-leave-active { transition: all 0.2s; }
.fade-up-enter-from, .fade-up-leave-to { opacity: 0; transform: translateY(6px); }

.main-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  background: #060e1f;
}

.top-bar {
  height: 56px;
  min-height: 56px;
  background: rgba(6, 14, 31, 0.95);
  border-bottom: 1px solid rgba(0, 120, 200, 0.15);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  backdrop-filter: blur(12px);
  z-index: 9;
}
.top-bar-left { display: flex; align-items: center; gap: 32px; }
.top-brand {
  font-size: 15px;
  font-weight: 700;
  color: #d0eaf8;
  letter-spacing: 1px;
  white-space: nowrap;
}
.top-nav { display: flex; gap: 4px; }
.top-nav-link {
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 13px;
  color: rgba(140, 190, 220, 0.7);
  text-decoration: none;
  transition: all 0.2s;
}
.top-nav-link:hover { color: #d0eaf8; background: rgba(0,120,200,0.1); }
.top-nav-link.active { color: #4dd0e1; background: rgba(0, 150, 220, 0.15); }

.top-bar-right { display: flex; align-items: center; gap: 8px; }
.manual-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  background: linear-gradient(135deg, #0077cc, #0099e6);
  border: none;
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  box-shadow: 0 2px 12px rgba(0, 150, 230, 0.3);
}
.manual-btn svg { width: 15px; height: 15px; }
.manual-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 18px rgba(0, 150, 230, 0.5); }

.icon-btn {
  width: 36px; height: 36px;
  background: rgba(0, 80, 140, 0.2);
  border: 1px solid rgba(0, 120, 200, 0.2);
  border-radius: 8px;
  color: rgba(140, 190, 220, 0.8);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: all 0.2s;
}
.icon-btn svg { width: 18px; height: 18px; }
.icon-btn:hover { background: rgba(0,120,200,0.25); color: #4dd0e1; }
.badge-dot {
  position: absolute;
  top: 4px; right: 4px;
  background: #e53935;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  min-width: 14px;
  height: 14px;
  border-radius: 7px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 2px;
  line-height: 1;
}

.page-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  background: #060e1f;
}

/* ── 沉浸模式：侧边栏 + 顶栏收起 ── */
.sidebar {
  transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              min-width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              border-width 0.35s;
}
.sidebar.collapsed {
  width: 0 !important;
  min-width: 0 !important;
  padding: 0;
  overflow: hidden;
  border-width: 0;
}

.top-bar {
  transition: height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              min-height 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              padding 0.35s, border-width 0.35s, opacity 0.35s;
}
.top-bar.collapsed {
  height: 0 !important;
  min-height: 0 !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  overflow: hidden;
  border-bottom-width: 0;
  opacity: 0;
  pointer-events: none;
}

/* ── 用户信息弹窗 ── */
.user-info-overlay {
  position: fixed;
  inset: 0;
  padding: 24px;
  background: rgba(2, 8, 18, 0.74);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.user-info-card {
  width: min(420px, 100%);
  background: rgba(255, 255, 255, 0.96) !important;
  border: 1px solid rgba(0, 141, 230, 0.18) !important;
  border-radius: 8px;
  box-shadow: 0 24px 70px rgba(8, 38, 66, 0.28), 0 1px 0 rgba(255, 255, 255, 0.9) inset !important;
  position: relative;
  overflow: hidden;
}
.user-info-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 3px;
  background: #35c7d8;
}
.ui-close {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: #60748a;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s, background 0.2s, border-color 0.2s;
}
.ui-close:hover {
  background: rgba(0, 141, 230, 0.08);
  border-color: rgba(0, 141, 230, 0.14);
  color: #0d1b2d;
}
.ui-close:focus-visible,
.ui-logout-btn:focus-visible {
  outline: 2px solid #35c7d8;
  outline-offset: 2px;
}
.ui-close svg { width: 17px; height: 17px; }
.ui-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
  padding: 28px 64px 22px 28px;
  border-bottom: 1px solid rgba(16, 126, 196, 0.12);
}
.ui-avatar {
  flex: 0 0 auto;
  width: 52px;
  height: 52px;
  background: rgba(22, 199, 232, 0.1);
  border: 1px solid rgba(22, 199, 232, 0.35);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 0 5px rgba(22, 199, 232, 0.05);
}
.ui-avatar svg { width: 25px; height: 25px; color: #35c7d8; }
.ui-title {
  font-size: 20px;
  line-height: 1.2;
  font-weight: 650;
  color: #0d1b2d;
  letter-spacing: 0;
}
.ui-body {
  padding: 24px 28px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.ui-row {
  display: flex;
  min-width: 0;
  min-height: 72px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  padding: 14px 16px;
  background: #f4f9fd;
  border: 1px solid rgba(16, 126, 196, 0.12);
  border-radius: 6px;
  transition: border-color 0.2s, background 0.2s;
}
.ui-row:hover {
  background: #edf8ff;
  border-color: rgba(0, 141, 230, 0.26);
}
.ui-label {
  font-size: 12px;
  line-height: 1;
  color: #60748a;
}
.ui-value {
  max-width: 100%;
  font-size: 14px;
  line-height: 1.35;
  font-weight: 600;
  color: #152a40;
  overflow-wrap: anywhere;
}
.ui-footer {
  padding: 0 28px 28px;
  display: flex;
  gap: 8px;
}
.ui-btn-edit,
.ui-btn-pwd {
  flex: 1;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid rgba(0, 141, 230, 0.24);
  background: rgba(0, 141, 230, 0.06);
  color: #1a5276;
}
.ui-btn-edit:hover,
.ui-btn-pwd:hover {
  background: rgba(0, 141, 230, 0.12);
  border-color: rgba(0, 141, 230, 0.4);
}
.ui-logout-btn {
  width: 100%;
  height: 46px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(229, 72, 77, 0.06);
  border: 1px solid rgba(229, 72, 77, 0.24);
  border-radius: 6px;
  color: #cf343b;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.2s, background 0.2s, border-color 0.2s, transform 0.2s;
}
.ui-logout-btn:hover {
  background: rgba(229, 72, 77, 0.12);
  border-color: rgba(229, 72, 77, 0.42);
  color: #b9272e;
  transform: translateY(-1px);
}
.ui-logout-btn svg { width: 18px; height: 18px; }

/* ═══ 编辑资料 / 修改密码表单 ═══ */
.edit-card { width: min(440px, 100%) !important; }
.edit-body {
  display: flex !important;
  flex-direction: column !important;
  gap: 16px !important;
}
.ef-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ef-label {
  font-size: 13px;
  font-weight: 600;
  color: #1a3d5c;
}
.ef-input {
  height: 40px;
  padding: 0 14px;
  border: 1px solid rgba(16, 126, 196, 0.2);
  border-radius: 6px;
  font-size: 14px;
  color: #152a40;
  background: #f8fbfe;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.ef-input:focus {
  border-color: #35c7d8;
  box-shadow: 0 0 0 3px rgba(53, 199, 216, 0.15);
}
.ef-error {
  font-size: 13px;
  color: #cf343b;
  background: rgba(229, 72, 77, 0.08);
  padding: 8px 12px;
  border-radius: 4px;
  margin-top: 4px;
}
.edit-footer {
  display: flex;
  gap: 10px;
  padding: 0 28px 28px;
}
.ui-btn-cancel,
.ui-btn-save {
  flex: 1;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}
.ui-btn-cancel {
  background: #f0f5fa;
  color: #3d5a73;
  border: 1px solid rgba(16, 126, 196, 0.14);
}
.ui-btn-cancel:hover { background: #e4eef7; }
.ui-btn-save {
  background: linear-gradient(135deg, #0077cc, #0099e6);
  color: #fff;
  box-shadow: 0 2px 10px rgba(0, 141, 230, 0.25);
}
.ui-btn-save:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0, 141, 230, 0.35); }
.ui-btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

@media (max-width: 420px) {
  .user-info-overlay { padding: 16px; }
  .ui-header { padding: 24px 56px 20px 22px; }
  .ui-body {
    grid-template-columns: 1fr;
    padding: 20px 22px;
  }
  .ui-row {
    min-height: 0;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .ui-value { text-align: right; }
  .ui-footer { padding: 0 22px 22px; }
}
</style>

<style>
/* 路由切换过渡动画 */
.fade-page-enter-active,
.fade-page-leave-active {
  transition: opacity 0.18s ease;
}
.fade-page-enter-from,
.fade-page-leave-to {
  opacity: 0;
}
</style>
