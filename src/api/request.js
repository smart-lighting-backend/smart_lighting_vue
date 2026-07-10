/**
 * Axios 请求封装
 * 统一响应格式: { code, msg, data }
 * - 自动附加 Authorization: Bearer <token>
 * - HTTP 401 → 清除 Token 并跳回登录页
 * - 业务 code ≠ 200 → 抛出带 msg 的 Error，让调用方统一处理
 * - 业务 code = 1003（账号已停用） → 清除 Token 并跳回登录页
 */
import axios from 'axios'
import { getToken, clearAuth } from './auth.js'

const ACCOUNT_DISABLED_CODE = 1003  // 后端约定：账号已停用业务码

const request = axios.create({
  // 开发模式下 baseURL 留空，由 Vite proxy 转发 /api 到 localhost:8080
  // 生产模式可通过 .env.production 设置 VITE_API_BASE_URL
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 10000,
})

// ─── 请求拦截器：注入 Bearer Token ────────────────────────────────────────
request.interceptors.request.use(
  config => {
    const token = getToken()
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }
    return config
  },
  error => Promise.reject(error)
)

// ─── 响应拦截器 ────────────────────────────────────────────────────────────
request.interceptors.response.use(
  response => {
    const res = response.data  // 取 HTTP body: { code, msg, data }

    // 业务层错误（HTTP 200 但 code ≠ 200）
    if (res && typeof res.code === 'number' && res.code !== 200) {
      // 账号已停用：清除认证并跳转到登录页
      if (res.code === ACCOUNT_DISABLED_CODE) {
        clearAuth()
        const msg = encodeURIComponent(res.msg || '账号已停用')
        window.location.href = `/login?disabled=1&msg=${msg}`
        return
      }

      const err = new Error(res.msg || '请求失败')
      err.bizCode = res.code
      err.bizData = res.data
      return Promise.reject(err)
    }

    // 正常：返回 { code, msg, data } 原始对象，调用方按需解包
    return res
  },
  error => {
    if (error.response?.status === 401) {
      clearAuth()
      // 已经在登录页就不做硬跳转，避免注册时被残留 Token 踢回刷新
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default request
