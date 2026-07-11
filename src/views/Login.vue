<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { login, registerUser, saveAuth, savePermissions, saveMenus, getRoleLabel, markAuthFresh } from '../api/auth.js'
import { fetchRoleList } from '../api/role.js'

const router = useRouter()
const route = useRoute()

// ─── 模式：'login' | 'register' ─────────────────────────────────────────
const mode = ref('login')
const isLogin = computed(() => mode.value === 'login')

function switchMode(m) {
  mode.value = m
  errorMsg.value = ''
  registerError.value = ''
}

// ─── 登录表单 ────────────────────────────────────────────────────────────
const form = reactive({
  username: '',
  password: '',
  remember: false,
})

// ─── 注册表单 ────────────────────────────────────────────────────────────
const registerForm = reactive({
  username: '',
  password: '',
  confirmPassword: '',
  realName: '',
  phone: '',
  roleId: null,
})
const registerError = ref('')
const registerLoading = ref(false)
const roleList = ref([])
const roleDropdownOpen = ref(false)
const BACKEND_OFFLINE_KEY = 'smart_light_backend_offline'
const backendOffline = ref(sessionStorage.getItem(BACKEND_OFFLINE_KEY) === '1')
const DEFAULT_REGISTER_ROLES = [
  { id: 2, name: '市政人员', roleCode: 'MUNICIPAL' },
  { id: 3, name: '路灯管理员', roleCode: 'MAINTENANCE' },
  { id: 4, name: '安全/应急人员', roleCode: 'EMERGENCY' },
]

function markBackendOffline() {
  if (!import.meta.env.DEV) return
  backendOffline.value = true
  sessionStorage.setItem(BACKEND_OFFLINE_KEY, '1')
}

function markBackendOnline() {
  backendOffline.value = false
  sessionStorage.removeItem(BACKEND_OFFLINE_KEY)
}

function isBackendUnavailableError(err) {
  const httpStatus = err?.response?.status
  const code = err?.code || ''
  const message = err?.message || ''
  return (
    (!err?.response && !err?.bizCode) ||
    (httpStatus != null && httpStatus >= 500) ||
    ['ERR_NETWORK', 'ECONNABORTED', 'ECONNREFUSED'].includes(code) ||
    /ECONNREFUSED|Network Error|timeout|proxy error/i.test(message)
  )
}

async function loadRoles() {
  if (backendOffline.value) {
    roleList.value = roleList.value.length ? roleList.value : DEFAULT_REGISTER_ROLES
  }
  // 先加载缓存（上次登录时保存的），让下拉框即时有数据
  const cached = localStorage.getItem('smart_light_register_roles')
  if (cached) {
    try {
      const parsed = JSON.parse(cached)
      if (Array.isArray(parsed) && parsed.length > 0) {
        roleList.value = parsed
      }
    } catch { /* 缓存损坏忽略 */ }
  }
  // 再从 API 获取最新角色列表
  try {
    const res = await fetchRoleList()
    let roles = []
    const raw = res?.data
    if (Array.isArray(raw)) {
      roles = raw
    } else if (raw?.records && Array.isArray(raw.records)) {
      roles = raw.records
    } else if (raw?.list && Array.isArray(raw.list)) {
      roles = raw.list
    } else if (Array.isArray(res)) {
      roles = res
    } else if (res?.rows && Array.isArray(res.rows)) {
      roles = res.rows
    }
    const filtered = roles.filter(r => {
      const code = r?.roleCode || r?.code || ''
      return code !== 'SUPER_ADMIN'
    })
    if (filtered.length > 0) {
      markBackendOnline()
      roleList.value = filtered
      localStorage.setItem('smart_light_register_roles', JSON.stringify(filtered))
      return
    }
  } catch (err) {
    if (isBackendUnavailableError(err)) markBackendOffline()
    // API 调用失败，走下面的兜底
  }
  // 兜底：无缓存也无 API 数据时用默认值
  if (!cached) {
    roleList.value = DEFAULT_REGISTER_ROLES
  }
}

function selectRole(role) {
  registerForm.roleId = role.id
  roleDropdownOpen.value = false
}

const selectedRoleName = computed(() => {
  if (!registerForm.roleId) return ''
  const r = roleList.value.find(r => r.id === registerForm.roleId)
  return r ? (r.name || r.roleCode) : ''
})

function validateRegister() {
  if (!/^[a-zA-Z0-9_]{4,20}$/.test(registerForm.username)) return '用户名只能包含字母、数字和下划线（4-20位）'
  if (!registerForm.password || registerForm.password.length < 8) return '密码至少 8 位'
  if (registerForm.password !== registerForm.confirmPassword) return '两次密码输入不一致'
  if (!registerForm.roleId) return '请选择角色'
  return ''
}

async function handleRegister() {
  registerError.value = ''
  const err = validateRegister()
  if (err) { registerError.value = err; return }
  registerLoading.value = true
  try {
    // 清除可能残留的旧 Token，确保注册请求不携带 Authorization 头
    ;[localStorage, sessionStorage].forEach(s => {
      s.removeItem('smart_light_token')
    })
    const payload = {
      username: registerForm.username,
      password: registerForm.password,
      roleId: registerForm.roleId,
    }
    if (registerForm.realName) payload.realName = registerForm.realName
    if (registerForm.phone) payload.phone = registerForm.phone
    await registerUser(payload)
    // 注册成功 → 返回登录页，不自动登录
    // 清空注册表单
    registerForm.username = ''
    registerForm.password = ''
    registerForm.confirmPassword = ''
    registerForm.realName = ''
    registerForm.phone = ''
    registerForm.roleId = null
    // 切换到登录模式并显示成功提示
    switchMode('login')
    errorMsg.value = '注册成功，请使用新账号登录'
  } catch (err) {
    registerError.value = err?.message || '注册失败，请稍后重试'
  } finally {
    registerLoading.value = false
  }
}

// ─── 模式切换：进入注册模式时自动加载角色列表 ────────────────────────────
watch(mode, (m) => {
  if (m === 'register') loadRoles()
})

// ─── UI 状态 ───────────────────────────────────────────────────────────────
const loading  = ref(false)
const showPwd  = ref(false)
const showRegPwd = ref(false)
const showRegConfirmPwd = ref(false)
const errorMsg = ref('')

// ─── 粒子画布动画（优化版）───────────────────────────────────────────────────
const canvasRef = ref(null)
let animId = null

function initCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  let running = true

  // ① 窗口大小变化时 debounce 重绘，避免频繁 resize 触发重排
  let resizeTimer
  const resize = () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
    }, 120)
  }
  resize()
  window.addEventListener('resize', resize)

  // ② 页面不可见时暂停动画，释放 GPU
  const onVisibility = () => {
    running = !document.hidden
    if (running) draw()
  }
  document.addEventListener('visibilitychange', onVisibility)

  const PARTICLE_COUNT = 60  // 80→60，人眼无感知但减少 25% 计算量
  const particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    x:   Math.random() * canvas.width,
    y:   Math.random() * canvas.height,
    r:   Math.random() * 1.8 + 0.4,
    vx:  (Math.random() - 0.5) * 0.4,
    vy:  (Math.random() - 0.5) * 0.4,
    a:   Math.random() * 0.6 + 0.2,
  }))

  const draw = () => {
    if (!running) return  // 页面隐藏时不循环
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy
      if (p.x < 0) p.x = canvas.width
      if (p.x > canvas.width) p.x = 0
      if (p.y < 0) p.y = canvas.height
      if (p.y > canvas.height) p.y = 0

      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(100, 200, 255, ${p.a})`
      ctx.fill()
    })

    // ③ 连线阈值降低 120→100，减少 stroke 调用
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x
        const dy = particles[i].y - particles[j].y
        if (dx > 100 || dy > 100) continue  // 先做粗略判断，跳过过远的对
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 100) {
          ctx.beginPath()
          ctx.moveTo(particles[i].x, particles[i].y)
          ctx.lineTo(particles[j].x, particles[j].y)
          ctx.strokeStyle = `rgba(50, 150, 230, ${0.15 * (1 - dist / 100)})`
          ctx.lineWidth = 0.5
          ctx.stroke()
        }
      }
    }

    animId = requestAnimationFrame(draw)
  }
  draw()

  return () => {
    running = false
    cancelAnimationFrame(animId)
    window.removeEventListener('resize', resize)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

// ─── 生命周期 ──────────────────────────────────────────────────────────────
let cleanupCanvas = null
onMounted(async () => {
  cleanupCanvas = initCanvas()

  // ═══ 从数据库获取角色列表 ══════════════════════════
  // GET /api/roles 已是公开接口，无需 Token 即可获取数据库真实角色数据
  loadRoles()

  // 清除残留认证信息
  ;[localStorage, sessionStorage].forEach(s => {
    s.removeItem('smart_light_token')
    s.removeItem('smart_light_user')
  })

  if (route.query.disabled === '1') {
    errorMsg.value = route.query.msg
      ? decodeURIComponent(route.query.msg)
      : '账号已停用，请联系管理员'
  } else if (route.query.register === '1') {
    switchMode('register')
  }
})
onUnmounted(() => { cleanupCanvas?.() })

// ─── Mock 降级（后端不可用时自动触发，对接真实接口后无需改动） ──────────────
const MOCK_PERMISSIONS = [
  'dashboard', 'dashboard:read',
  'device', 'device:read', 'device:create', 'device:update', 'device:delete', 'device:control',
  'device_area', 'device_area:read', 'device_area:create', 'device_area:update', 'device_area:delete',
  'telemetry', 'telemetry:read',
  'energy', 'energy:read',
  'alarm', 'alarm:read', 'alarm:handle', 'alarm:delete',
  'policy', 'policy:read', 'policy:create', 'policy:update', 'policy:delete',
  'assistant', 'assistant:read',
  'audit', 'audit:read',
  'user', 'user:read', 'user:create', 'user:update', 'user:delete',
  'permission', 'permission:read', 'permission:create', 'permission:update', 'permission:delete',
  'menu', 'menu:read', 'menu:create', 'menu:update', 'menu:delete',
  'role', 'role:read', 'role:create', 'role:update', 'role:delete', 'role:assign'
]

const MOCK_MENUS = [
  { id: 1, name: '数字孪生', path: '/dashboard', icon: 'grid', sort: 1, children: [] },
  { id: 2, name: '设备管理', path: '/devices', icon: 'bulb', sort: 2, children: [] },
  { id: 3, name: '数据报表', path: '/analytics', icon: 'chart', sort: 3, children: [] },
  { id: 4, name: '能耗走势', path: '/energy', icon: 'energy', sort: 4, children: [] },
  { id: 5, name: '告警中心', path: '/warning', icon: 'warning', sort: 5, children: [] },
  { id: 6, name: '策略配置', path: '/strategy', icon: 'strategy', sort: 6, children: [] },
  { id: 7, name: '智能助手', path: '/assistant', icon: 'robot', sort: 7, children: [] },
  { id: 8, name: '系统日志', path: '/logs', icon: 'history', sort: 8, children: [] },
  { id: 9, name: '用户管理', path: '/users', icon: 'user', sort: 9, children: [] },
  {
    id: 10, name: '系统管理', path: '/system', icon: 'setting', sort: 10, children: [
      { id: 11, name: '权限管理', path: '/system/permission', icon: '', sort: 1, children: [] },
      { id: 12, name: '菜单管理', path: '/system/menu', icon: '', sort: 2, children: [] }
    ]
  }
]

function mockLogin(username) {
  return {
    token: `mock-token-dev-${Date.now()}`,
    userInfo: {
      username,
      realName: '系统管理员',
      phone: '13800000001',
      email: 'admin@example.com',
      roleCode: 'SUPER_ADMIN',
      roleName: '系统管理员（Mock）',
    },
    permissions: MOCK_PERMISSIONS,
    menus: MOCK_MENUS,
  }
}

// ─── 登录逻辑（对齐接口文档 V1.0）─────────────────────────────────────────
// 响应格式: { code: 200, msg: 'success', data: { token, username, roleCode } }
async function handleLogin() {
  errorMsg.value = ''
  if (!form.username.trim()) { errorMsg.value = '请输入用户名'; return }
  if (!form.password)        { errorMsg.value = '请输入密码';   return }

  loading.value = true
  try {
    let token, userInfo
    let usedMock = false

    try {
      // 始终优先尝试真实后端，避免一次离线后被 sessionStorage 固定在 Mock 登录。
      const res = await login(form.username, form.password)
      markBackendOnline()
      token    = res.data.token
      userInfo = {
        username: res.data.username,
        realName: res.data.realName,
        phone: res.data.phone,
        email: res.data.email,
        roleCode: res.data.roleCode,
        roleName: res.data.roleName || getRoleLabel(res.data.roleCode),
      }
      if (!token) throw new Error('未收到有效 Token')
      savePermissions(res.data.permissions || [], form.remember)
      saveMenus(res.data.menus || [], form.remember)
    } catch (apiErr) {
      // ② 判断"后端不可用"：网络连接失败 或 服务器 5xx 错误 → Mock 降级
      //    业务错误（401 密码错误、400 参数错误）→ 直接抛出显示给用户
      if (isBackendUnavailableError(apiErr)) {
        markBackendOffline()
        console.warn('[Login] 后端不可用，使用 Mock 降级登录', apiErr?.message)
        usedMock = true
        const mock = mockLogin(form.username)
        token    = mock.token
        userInfo = mock.userInfo
        // Mock 也保存权限和菜单
        savePermissions(mock.permissions || [], form.remember)
        saveMenus(mock.menus || [], form.remember)
      } else {
        throw apiErr
      }
    }

    saveAuth(token, userInfo, form.remember)
    markAuthFresh()
    // 登录后获取最新角色列表并缓存，供下次注册时使用
    if (!usedMock) fetchRoleList().then(res => {
      let roles = []
      const raw = res?.data
      if (Array.isArray(raw)) roles = raw
      else if (raw?.records && Array.isArray(raw.records)) roles = raw.records
      else if (raw?.list && Array.isArray(raw.list)) roles = raw.list
      else if (Array.isArray(res)) roles = res
      const filtered = roles.filter(r => (r?.roleCode || r?.code || '') !== 'SUPER_ADMIN')
      if (filtered.length > 0) localStorage.setItem('smart_light_register_roles', JSON.stringify(filtered))
    }).catch(err => {
      if (isBackendUnavailableError(err)) markBackendOffline()
    })
    const redirect = route.query.redirect || '/dashboard'
    router.push(redirect)
  } catch (err) {
    // err.message 来自 request.js 业务错误拦截 或 后端 HTTP 错误
    errorMsg.value = err?.message || '用户名或密码错误，请重试'
  } finally {
    loading.value = false
  }
}

function handleKeydown(e) {
  if (e.key === 'Enter') {
    if (isLogin.value) handleLogin()
    else handleRegister()
  }
}
</script>

<template>
  <div class="login-page" @keydown="handleKeydown">
    <!-- 粒子背景画布 -->
    <canvas ref="canvasRef" class="bg-canvas" />

    <!-- 背景光晕装饰 -->
    <div class="bg-glow glow-1" />
    <div class="bg-glow glow-2" />
    <div class="bg-glow glow-3" />

    <!-- 扫描线动画 -->
    <div class="scan-line" />

    <!-- 主体内容 -->
    <div class="login-wrapper">
      <!-- Logo 区域 -->
      <div class="brand-area">
        <div class="logo-box">
          <svg class="logo-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7z" fill="currentColor" opacity="0.9"/>
            <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1z" fill="currentColor" opacity="0.7"/>
          </svg>
          <div class="logo-ring" />
        </div>
        <h1 class="brand-title">智慧路灯节能系统</h1>
        <p class="brand-sub">城市级智能照明控制终端</p>
        <div class="brand-watermark">SMART CITY LOGIN</div>
      </div>

      <!-- 登录卡片 -->
      <div class="login-card" :class="{ 'register-card': !isLogin }">
        <!-- 卡片内部光效 -->
        <div class="card-shimmer" />

        <!-- ═════ 登录表单 ═════ -->
        <template v-if="isLogin">
          <!-- 用户名 -->
          <div class="form-group">
            <label class="form-label">用户名</label>
            <div class="input-wrap" :class="{ 'has-value': form.username }">
              <span class="input-icon">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-2.67 0-8 1.34-8 4v1a1 1 0 001 1h14a1 1 0 001-1v-1c0-2.66-5.33-4-8-4z" fill="currentColor"/></svg>
              </span>
              <input
                id="login-username"
                v-model="form.username"
                type="text"
                class="form-input"
                placeholder="请输入管理员账号"
                autocomplete="username"
              />
            </div>
          </div>

          <!-- 密码 -->
          <div class="form-group">
            <label class="form-label">密码</label>
            <div class="input-wrap" :class="{ 'has-value': form.password }">
              <span class="input-icon">
                <svg viewBox="0 0 24 24" fill="none"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" fill="currentColor"/></svg>
              </span>
              <input
                id="login-password"
                v-model="form.password"
                :type="showPwd ? 'text' : 'password'"
                class="form-input"
                placeholder="请输入密码"
                autocomplete="current-password"
              />
              <button class="toggle-pwd" type="button" @click="showPwd = !showPwd">
                <svg v-if="!showPwd" viewBox="0 0 24 24" fill="none"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" fill="currentColor"/></svg>
                <svg v-else viewBox="0 0 24 24" fill="none"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" fill="currentColor"/></svg>
              </button>
            </div>
          </div>

          <!-- 角色由后端 Token 返回，此处不需要选择框 -->

          <!-- 记住账号 & 忘记密码 -->
          <div class="form-row">
            <label class="checkbox-label">
              <input id="login-remember" v-model="form.remember" type="checkbox" class="checkbox-input" />
              <span class="checkbox-custom" />
              <span class="checkbox-text">记住账号</span>
            </label>
            <a href="#" class="forgot-link">忘记密码?</a>
          </div>

          <!-- 错误提示 -->
          <transition name="fade">
            <div v-if="errorMsg" class="error-tip">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/></svg>
              {{ errorMsg }}
            </div>
          </transition>

          <!-- 登录按钮 -->
          <button
            id="login-submit"
            class="login-btn"
            :class="{ loading }"
            :disabled="loading"
            type="button"
            @click="handleLogin"
          >
            <span v-if="!loading" class="btn-text">登&ensp;录</span>
            <span v-else class="btn-spinner" />
          </button>

          <!-- 切换注册 -->
          <div class="switch-link">
            还没有账号？
            <span class="switch-btn" @click="switchMode('register')">注册账号</span>
          </div>
        </template>

        <!-- ═════ 注册表单 ═════ -->
        <template v-else>
          <!-- 用户名 -->
          <div class="form-group">
            <label class="form-label">用户名</label>
            <div class="input-wrap" :class="{ 'has-value': registerForm.username }">
              <span class="input-icon">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-2.67 0-8 1.34-8 4v1a1 1 0 001 1h14a1 1 0 001-1v-1c0-2.66-5.33-4-8-4z" fill="currentColor"/></svg>
              </span>
              <input
                v-model="registerForm.username"
                type="text"
                class="form-input"
                placeholder="4-20位字母、数字或下划线"
                maxlength="20"
              />
            </div>
          </div>

          <!-- 密码 -->
          <div class="form-group">
            <label class="form-label">密码</label>
            <div class="input-wrap" :class="{ 'has-value': registerForm.password }">
              <span class="input-icon">
                <svg viewBox="0 0 24 24" fill="none"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" fill="currentColor"/></svg>
              </span>
              <input
                v-model="registerForm.password"
                :type="showRegPwd ? 'text' : 'password'"
                class="form-input"
                placeholder="至少 8 位密码"
              />
              <button class="toggle-pwd" type="button" @click="showRegPwd = !showRegPwd">
                <svg v-if="!showRegPwd" viewBox="0 0 24 24" fill="none"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" fill="currentColor"/></svg>
                <svg v-else viewBox="0 0 24 24" fill="none"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" fill="currentColor"/></svg>
              </button>
            </div>
          </div>

          <!-- 确认密码 -->
          <div class="form-group">
            <label class="form-label">确认密码</label>
            <div class="input-wrap" :class="{ 'has-value': registerForm.confirmPassword }">
              <span class="input-icon">
                <svg viewBox="0 0 24 24" fill="none"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" fill="currentColor"/></svg>
              </span>
              <input
                v-model="registerForm.confirmPassword"
                :type="showRegConfirmPwd ? 'text' : 'password'"
                class="form-input"
                placeholder="再次输入密码"
              />
              <button class="toggle-pwd" type="button" @click="showRegConfirmPwd = !showRegConfirmPwd">
                <svg v-if="!showRegConfirmPwd" viewBox="0 0 24 24" fill="none"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" fill="currentColor"/></svg>
                <svg v-else viewBox="0 0 24 24" fill="none"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" fill="currentColor"/></svg>
              </button>
            </div>
          </div>

          <!-- 真实姓名（选填） -->
          <div class="form-group">
            <label class="form-label">真实姓名</label>
            <div class="input-wrap" :class="{ 'has-value': registerForm.realName }">
              <span class="input-icon">
                <svg viewBox="0 0 24 24" fill="none"><path d="M12 12c2.7 0 4-1.8 4-4s-1.3-4-4-4-4 1.8-4 4 1.3 4 4 4zm0 2c-2.67 0-8 1.34-8 4v1a1 1 0 001 1h14a1 1 0 001-1v-1c0-2.66-5.33-4-8-4z" fill="currentColor"/></svg>
              </span>
              <input
                v-model="registerForm.realName"
                type="text"
                class="form-input"
                placeholder="真实姓名（选填）"
                maxlength="20"
              />
            </div>
          </div>

          <!-- 手机号（选填） -->
          <div class="form-group">
            <label class="form-label">手机号</label>
            <div class="input-wrap" :class="{ 'has-value': registerForm.phone }">
              <span class="input-icon">
                <svg viewBox="0 0 24 24" fill="none"><path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z" fill="currentColor"/></svg>
              </span>
              <input
                v-model="registerForm.phone"
                type="text"
                class="form-input"
                placeholder="手机号（选填）"
                maxlength="11"
              />
            </div>
          </div>

          <!-- 角色选择（自定义下拉） -->
          <div class="form-group">
            <label class="form-label">角色</label>
            <div class="select-wrap" @click="roleDropdownOpen = !roleDropdownOpen">
              <span class="input-icon">
                <svg viewBox="0 0 24 24" fill="none"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" fill="currentColor"/></svg>
              </span>
              <span class="select-value" :class="{ placeholder: !registerForm.roleId }">
                {{ selectedRoleName || '请选择角色' }}
              </span>
              <span class="select-arrow" :class="{ open: roleDropdownOpen }">
                <svg viewBox="0 0 24 24" fill="none"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" fill="currentColor"/></svg>
              </span>
            </div>
            <transition name="dropdown">
              <div v-if="roleDropdownOpen" class="dropdown-list" @click.stop>
                <div v-if="roleList.length === 0" class="dropdown-item empty-hint">暂无可用角色</div>
                <div
                  v-for="r in roleList"
                  :key="r.id"
                  class="dropdown-item"
                  :class="{ active: r.id === registerForm.roleId }"
                  @click="selectRole(r)"
                >
                  {{ r.name || r.roleCode }}
                </div>
              </div>
            </transition>
          </div>

          <!-- 注册错误提示 -->
          <transition name="fade">
            <div v-if="registerError" class="error-tip">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/></svg>
              {{ registerError }}
            </div>
          </transition>

          <!-- 注册按钮 -->
          <button
            class="login-btn"
            :class="{ loading: registerLoading }"
            :disabled="registerLoading"
            type="button"
            @click="handleRegister"
          >
            <span v-if="!registerLoading" class="btn-text">注&ensp;册</span>
            <span v-else class="btn-spinner" />
          </button>

          <!-- 切换登录 -->
          <div class="switch-link">
            已有账号？
            <span class="switch-btn" @click="switchMode('login')">去登录</span>
          </div>
        </template>


      </div>
    </div>
  </div>
</template>

<style scoped>
/* ─── 全局重置 ─────────────────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ─── 背景页面 ─────────────────────────────────────────────────────────────── */
.login-page {
  position: relative;
  width: 100vw;
  height: 100vh;
  background: #020d1a;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.bg-canvas {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

/* 光晕 */
.bg-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
  z-index: 0;
}
.glow-1 {
  width: 600px; height: 600px;
  background: radial-gradient(circle, rgba(0, 80, 160, 0.35) 0%, transparent 70%);
  top: -150px; left: -150px;
  will-change: transform;
}
.glow-2 {
  width: 500px; height: 500px;
  background: radial-gradient(circle, rgba(0, 150, 255, 0.2) 0%, transparent 70%);
  bottom: -100px; right: -100px;
  will-change: transform;
}
.glow-3 {
  width: 400px; height: 400px;
  background: radial-gradient(circle, rgba(0, 60, 120, 0.3) 0%, transparent 70%);
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  will-change: transform;
}

/* 扫描线 */
.scan-line {
  position: absolute;
  left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(0, 180, 255, 0.4), transparent);
  animation: scan 6s linear infinite;
  z-index: 1;
  pointer-events: none;
}
@keyframes scan {
  0%   { top: -2px; opacity: 0; }
  5%   { opacity: 1; }
  95%  { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}

/* ─── 主包装 ────────────────────────────────────────────────────────────────── */
.login-wrapper {
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  width: 100%;
  max-width: 480px;
  padding: 0 20px;
}

/* ─── 品牌区域 ──────────────────────────────────────────────────────────────── */
.brand-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 8px;
}

.logo-box {
  position: relative;
  width: 64px; height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
}
.logo-icon {
  width: 36px; height: 36px;
  color: #4dd0e1;
  filter: drop-shadow(0 0 12px rgba(77, 208, 225, 0.8));
  z-index: 2;
  animation: pulse-glow 3s ease-in-out infinite;
}
.logo-ring {
  position: absolute;
  inset: 0;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(0, 150, 200, 0.3), rgba(0, 80, 160, 0.5));
  border: 1px solid rgba(77, 208, 225, 0.4);
  backdrop-filter: blur(8px);
  box-shadow: 0 0 20px rgba(77, 208, 225, 0.3), inset 0 1px 0 rgba(255,255,255,0.1);
}
@keyframes pulse-glow {
  0%, 100% { filter: drop-shadow(0 0 10px rgba(77, 208, 225, 0.7)); }
  50%       { filter: drop-shadow(0 0 20px rgba(77, 208, 225, 1)); }
}

.brand-title {
  font-size: 36px;
  font-weight: 700;
  background: linear-gradient(135deg, #e0f7ff 20%, #4dd0e1 60%, #0288d1 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: 4px;
  text-shadow: none;
  margin-bottom: 8px;
}
.brand-sub {
  font-size: 13px;
  color: rgba(150, 210, 240, 0.75);
  letter-spacing: 2px;
  margin-bottom: 6px;
}
.brand-watermark {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 6px;
  color: rgba(0, 150, 220, 0.12);
  user-select: none;
  margin-bottom: 4px;
}

/* ─── 登录卡片 ──────────────────────────────────────────────────────────────── */
.login-card {
  position: relative;
  width: 100%;
  background: rgba(5, 20, 45, 0.65);
  border: 1px solid rgba(0, 150, 220, 0.25);
  border-radius: 16px;
  padding: 32px 36px 24px;
  backdrop-filter: blur(20px);
  box-shadow:
    0 8px 40px rgba(0, 0, 0, 0.5),
    0 0 0 1px rgba(0, 150, 220, 0.1) inset,
    0 1px 0 rgba(255, 255, 255, 0.08) inset;
  overflow: hidden;
}

/* 卡片顶部光泽 */
.card-shimmer {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(77, 208, 225, 0.6), transparent);
}

/* ─── 表单组 ─────────────────────────────────────────────────────────────────── */
.form-group {
  position: relative;
  margin-bottom: 18px;
}
.form-label {
  display: block;
  font-size: 13px;
  color: rgba(150, 210, 240, 0.8);
  margin-bottom: 8px;
  letter-spacing: 0.5px;
}

/* ─── 输入框 ─────────────────────────────────────────────────────────────────── */
.input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.input-icon {
  position: absolute;
  left: 14px;
  width: 18px; height: 18px;
  color: rgba(77, 208, 225, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  transition: color 0.3s;
}
.input-icon svg { width: 100%; height: 100%; }

.form-input {
  width: 100%;
  height: 48px;
  padding: 0 44px 0 44px;
  background: rgba(0, 30, 60, 0.6);
  border: 1px solid rgba(0, 120, 180, 0.35);
  border-radius: 8px;
  color: #e0f4ff;
  font-size: 14px;
  letter-spacing: 0.5px;
  outline: none;
  transition: all 0.3s ease;
}
.form-input::placeholder { color: rgba(100, 170, 210, 0.45); }
.form-input:focus {
  border-color: rgba(77, 208, 225, 0.7);
  background: rgba(0, 40, 80, 0.7);
  box-shadow: 0 0 0 3px rgba(77, 208, 225, 0.12), 0 0 12px rgba(77, 208, 225, 0.15);
}
.input-wrap:focus-within .input-icon { color: rgba(77, 208, 225, 0.9); }

/* 密码显隐按钮 */
.toggle-pwd {
  position: absolute;
  right: 12px;
  width: 20px; height: 20px;
  background: none;
  border: none;
  cursor: pointer;
  color: rgba(77, 208, 225, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s;
}
.toggle-pwd:hover { color: rgba(77, 208, 225, 0.9); }
.toggle-pwd svg { width: 18px; height: 18px; }

/* ─── 角色选择 ──────────────────────────────────────────────────────────────── */
.select-wrap {
  position: relative;
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 44px 0 44px;
  background: rgba(0, 30, 60, 0.6);
  border: 1px solid rgba(0, 120, 180, 0.35);
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
  transition: all 0.3s ease;
  color: #e0f4ff;
  font-size: 14px;
}
.select-wrap:hover {
  border-color: rgba(77, 208, 225, 0.7);
  background: rgba(0, 40, 80, 0.7);
}
.select-value { flex: 1; }
.select-arrow {
  position: absolute;
  right: 12px;
  width: 20px; height: 20px;
  color: rgba(77, 208, 225, 0.6);
  transition: transform 0.25s ease;
  display: flex; align-items: center;
}
.select-arrow.open { transform: rotate(180deg); }
.select-arrow svg { width: 20px; height: 20px; }

.dropdown-list {
  position: absolute;
  top: calc(100% + 4px);
  left: 0; right: 0;
  background: rgba(4, 20, 50, 0.95);
  border: 1px solid rgba(0, 120, 180, 0.4);
  border-radius: 8px;
  overflow: hidden;
  z-index: 100;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(16px);
}
.dropdown-item {
  padding: 12px 16px;
  font-size: 14px;
  color: rgba(180, 220, 240, 0.85);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.dropdown-item:hover, .dropdown-item.active {
  background: rgba(0, 150, 220, 0.2);
  color: #4dd0e1;
}
.dropdown-item.empty-hint {
  color: rgba(150, 180, 200, 0.5);
  cursor: default;
  text-align: center;
  font-size: 13px;
}
.dropdown-item.empty-hint:hover {
  background: transparent;
  color: rgba(150, 180, 200, 0.5);
}

/* 下拉动画 */
.dropdown-enter-active, .dropdown-leave-active { transition: all 0.2s ease; }
.dropdown-enter-from, .dropdown-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ─── 记住账号行 ─────────────────────────────────────────────────────────────── */
.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}
.checkbox-input { display: none; }
.checkbox-custom {
  width: 16px; height: 16px;
  border: 1px solid rgba(0, 120, 180, 0.6);
  border-radius: 3px;
  background: rgba(0, 30, 60, 0.6);
  position: relative;
  transition: all 0.2s;
  flex-shrink: 0;
}
.checkbox-input:checked + .checkbox-custom {
  background: rgba(0, 150, 220, 0.4);
  border-color: #4dd0e1;
}
.checkbox-input:checked + .checkbox-custom::after {
  content: '';
  position: absolute;
  left: 3px; top: 1px;
  width: 5px; height: 9px;
  border: 2px solid #4dd0e1;
  border-left: none; border-top: none;
  transform: rotate(45deg);
}
.checkbox-text { font-size: 13px; color: rgba(150, 210, 240, 0.75); }
.forgot-link {
  font-size: 13px;
  color: rgba(77, 208, 225, 0.7);
  text-decoration: none;
  transition: color 0.2s;
}
.forgot-link:hover { color: #4dd0e1; text-decoration: underline; }

/* ─── 错误提示 ──────────────────────────────────────────────────────────────── */
.error-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: rgba(180, 30, 30, 0.2);
  border: 1px solid rgba(220, 80, 80, 0.35);
  border-radius: 8px;
  font-size: 13px;
  color: #ff8080;
  margin-bottom: 14px;
}
.error-tip svg { width: 16px; height: 16px; flex-shrink: 0; }
.fade-enter-active, .fade-leave-active { transition: all 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-4px); }

/* ─── 登录按钮 ──────────────────────────────────────────────────────────────── */
.login-btn {
  width: 100%;
  height: 52px;
  background: linear-gradient(135deg, #0077cc 0%, #0099e6 50%, #00aaff 100%);
  border: none;
  border-radius: 10px;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 8px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
  box-shadow: 0 4px 20px rgba(0, 150, 230, 0.4);
}
.login-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.15), transparent);
  border-radius: inherit;
}
.login-btn::after {
  content: '';
  position: absolute;
  top: 0; left: -100%;
  width: 60%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
  transition: left 0.4s ease;
}
.login-btn:hover:not(:disabled)::after { left: 150%; }
.login-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 28px rgba(0, 150, 230, 0.6);
}
.login-btn:active:not(:disabled) {
  transform: translateY(0);
}
.login-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.btn-spinner {
  display: inline-block;
  width: 22px; height: 22px;
  border: 3px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  vertical-align: middle;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ─── 底部版权 ──────────────────────────────────────────────────────────────── */
.login-footer {
  text-align: center;
  font-size: 12px;
  color: rgba(100, 160, 200, 0.4);
  margin-top: 20px;
}

/* ─── 模式切换链接 ──────────────────────────────────────────────────────────── */
.switch-link {
  text-align: center;
  font-size: 13px;
  color: rgba(150, 210, 240, 0.65);
  margin-top: 18px;
}
.switch-link a, .switch-link .switch-btn {
  color: rgba(77, 208, 225, 0.8);
  text-decoration: none;
  transition: color 0.2s;
  cursor: pointer;
}
.switch-link a:hover, .switch-link .switch-btn:hover { color: #4dd0e1; text-decoration: underline; }

.select-value.placeholder { color: rgba(100, 170, 210, 0.45); }

/* ─── 注册模式卡片紧凑调整 ────────────────────────────────────────────────────── */
.register-card {
  padding: 22px 32px 18px !important;
  overflow: visible !important;  /* 让角色下拉列表不被裁剪 */
}
.register-card .form-group {
  margin-bottom: 12px;
}
.register-card .form-input {
  height: 42px;
  font-size: 13px;
}
.register-card .form-label {
  margin-bottom: 5px;
  font-size: 12px;
}
.register-card .login-btn {
  height: 46px;
  font-size: 16px;
}
</style>
