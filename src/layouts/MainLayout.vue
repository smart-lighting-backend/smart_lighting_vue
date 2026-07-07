<script setup>
import { ref, computed, onMounted, provide } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserInfo } from '../composables/useUserInfo.js'
import { clearAuth, getMenus, saveMenus, refreshPermissionsAndMenus, getUserInfo, getPermissions } from '../api/auth.js'
import { fetchAlarmPage } from '../api/warnings.js'
import { useAutoRefresh } from '../composables/useAutoRefresh.js'
import { fetchVisibleMenus } from '../api/menu.js'
import ManualControlModal from '../components/ManualControlModal.vue'

const route  = useRoute()
const router = useRouter()
const { username, roleName, permissions } = useUserInfo()

const showManual = ref(false)
const showUserMenu = ref(false)
const alarmCount = ref(0)

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
    console.log('[Menu] Loading menus...')
    const res = await fetchVisibleMenus()
    console.log('[Menu] API response:', JSON.stringify(res, null, 2))
    
    let menuData = res
    if (res && typeof res === 'object' && 'data' in res) {
      menuData = res.data
    }
    
    if (menuData && Array.isArray(menuData) && menuData.length > 0) {
      console.log('[Menu] Using API data, count:', menuData.length)
      menus.value = menuData.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      const inLocal = !!localStorage.getItem('smart_light_token')
      saveMenus(menus.value, inLocal)
    } else {
      const cached = getMenus()
      console.log('[Menu] API data empty, trying cache:', cached?.length || 0)
      if (cached && cached.length > 0) {
        menus.value = cached.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      } else {
        console.log('[Menu] Cache empty, using fallback menus')
        menus.value = FALLBACK_MENUS
      }
    }
    console.log('[Menu] Final menus:', JSON.stringify(menus.value, null, 2))
    filterAdminMenus()
    autoExpandMenus()
  } catch (error) {
    console.warn('[Menu] Failed to fetch menus from API, using cache or fallback', error)
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
  if (!user || user.roleCode !== 'SUPER_ADMIN') {
    menus.value = menus.value.filter(item => item.name !== '系统管理')
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

onMounted(async () => {
  await refreshPermissionsAndMenus()
  await loadMenus()
  autoExpandMenus()
  // 告警角标自动刷新
  fetchAlarmPage({ status: 'ACTIVE', pageNum: 1, pageSize: 1 }).then(res => {
    const d = res?.data
    alarmCount.value = d?.total ?? (Array.isArray(d) ? d.length : 0)
  }).catch(() => {})
  useAutoRefresh(() => {
    fetchAlarmPage({ status: 'ACTIVE', pageNum: 1, pageSize: 1 }).then(res => {
      const d = res?.data
      alarmCount.value = d?.total ?? (Array.isArray(d) ? d.length : 0)
    }).catch(() => {})
  }, { interval: 45000 })
})

</script>

<template>
  <div class="main-layout">
    <aside class="sidebar">
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
          <div class="nav-loading">加载菜单中...</div>
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

      <div class="sidebar-user" @click="showUserMenu = !showUserMenu">
        <div class="user-avatar">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-2.67 0-8 1.34-8 4v1a1 1 0 001 1h14a1 1 0 001-1v-1c0-2.66-5.33-4-8-4z" fill="currentColor"/></svg>
        </div>
        <div class="user-info">
          <span class="user-name">{{ username }}</span>
          <span class="user-role">{{ roleName }}</span>
        </div>
        <transition name="fade-up">
          <div v-if="showUserMenu" class="user-menu">
            <div class="user-menu-item" @click.stop="logout">
              <svg viewBox="0 0 24 24" fill="none"><path d="M16 17l5-5-5-5M21 12H9M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              退出登录
            </div>
          </div>
        </transition>
      </div>
    </aside>

    <div class="main-body">
      <header class="top-bar">
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

    <ManualControlModal v-if="showManual" @close="showManual = false" />
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
  color: rgba(140, 190, 220, 0.7);
  text-decoration: none;
  font-size: clamp(13px, calc(13px * var(--scale-ratio, 1)), 15px);
  transition: all 0.2s ease;
  position: relative;
  user-select: none;
}
.nav-item:hover {
  background: rgba(0, 120, 200, 0.12);
  color: rgba(180, 220, 240, 0.9);
}
.nav-item.active {
  background: rgba(0, 150, 220, 0.18);
  color: #4dd0e1;
  border: 1px solid rgba(77, 208, 225, 0.2);
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

.user-menu {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 10px; right: 10px;
  background: rgba(4, 20, 50, 0.96);
  border: 1px solid rgba(0, 120, 180, 0.4);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  backdrop-filter: blur(16px);
  z-index: 100;
}
.user-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  font-size: 13px;
  color: rgba(180, 220, 240, 0.85);
  cursor: pointer;
  transition: background 0.2s;
}
.user-menu-item svg { width: 16px; height: 16px; }
.user-menu-item:hover { background: rgba(0,150,220,0.15); color: #4dd0e1; }

.fade-up-enter-active, .fade-up-leave-active { transition: all 0.2s; }
.fade-up-enter-from, .fade-up-leave-to { opacity: 0; transform: translateY(6px); }

.main-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
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
