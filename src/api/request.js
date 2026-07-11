import axios from 'axios'
import { getToken, clearAuth, isMockAuthToken } from './auth.js'

const ACCOUNT_DISABLED_CODE = 1003

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 10000,
})

function isPublicRequest(config = {}) {
  const rawUrl = (config.url || '').split('?')[0].replace(/\/+$/, '')
  const method = (config.method || 'get').toLowerCase()
  return (
    rawUrl.endsWith('/api/auth/login') ||
    rawUrl.endsWith('/api/auth/register') ||
    (method === 'get' && rawUrl.endsWith('/api/roles'))
  )
}

function shouldSkipAuthRedirect(error) {
  return Boolean(
    error?.config?.skipAuthRedirect ||
    isPublicRequest(error?.config) ||
    isMockAuthToken(getToken())
  )
}

function redirectToLogin(query = '') {
  if (typeof window === 'undefined') return
  const target = `/login${query}`
  if (window.location.pathname.startsWith('/login')) {
    if (query) window.location.href = target
    return
  }
  window.location.href = target
}

request.interceptors.request.use(
  config => {
    const token = getToken()
    if (token) {
      config.headers = config.headers || {}
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  error => Promise.reject(error)
)

request.interceptors.response.use(
  response => {
    const res = response.data

    if (res && typeof res.code === 'number' && res.code !== 200) {
      const err = new Error(res.msg || '请求失败')
      err.bizCode = res.code
      err.bizData = res.data

      if (res.code === ACCOUNT_DISABLED_CODE) {
        clearAuth()
        const msg = encodeURIComponent(res.msg || '账号已停用')
        redirectToLogin(`?disabled=1&msg=${msg}`)
      }

      return Promise.reject(err)
    }

    return res
  },
  error => {
    if (error.response?.status === 401) {
      error.authExpired = true
      if (!shouldSkipAuthRedirect(error)) {
        clearAuth()
        redirectToLogin()
      }
    }
    return Promise.reject(error)
  }
)

export default request
