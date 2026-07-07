/**
 * 请求级短时缓存（stale-while-revalidate）
 *
 * 用法:
 *   import { withCache, invalidateCache } from '../utils/requestCache.js'
 *
 *   // 包装 API 调用
 *   const data = await withCache(() => fetchDashboardStats(), 'dashboard:stats', { ttl: 30000 })
 *
 *   // 增删改后清除相关缓存
 *   invalidateCache('device:')  // 匹配所有 device: 开头的 key
 */

const store = new Map()

/**
 * 带缓存的请求
 * @param {Function} fn  实际请求函数
 * @param {string}    key 缓存键（唯一标识这个请求）
 * @param {{ ttl?: number }} options  ttl 默认 30000ms
 * @returns {Promise<any>}
 */
export async function withCache(fn, key, { ttl = 30000 } = {}) {
  const cached = store.get(key)
  const now = Date.now()

  // 缓存有效 → 直接返回，后台更新
  if (cached && now - cached.time < ttl) {
    // 如果缓存快过期（超过 80% ttl），后台静默刷新
    if (now - cached.time > ttl * 0.8) {
      fn().then(d => store.set(key, { data: d, time: Date.now() })).catch(() => {})
    }
    return cached.data
  }

  // 无缓存或已过期 → 请求并缓存
  const data = await fn()
  store.set(key, { data, time: Date.now() })
  return data
}

/**
 * 使缓存失效
 * @param {string} prefixOrKey  缓存键或前缀（如 'device:' 匹配所有 device:* 的 key）
 */
export function invalidateCache(prefixOrKey) {
  for (const key of store.keys()) {
    if (key.startsWith(prefixOrKey)) {
      store.delete(key)
    }
  }
}

/** 清空所有缓存 */
export function clearAllCache() {
  store.clear()
}
