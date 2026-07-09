/**
 * 全局 Mock 数据状态管理
 * 当 API 接口不可用、前端降级使用 Mock 数据时记录痕迹，
 * 方便调试时识别哪些接口尚未对接后端。
 */
import { reactive } from 'vue'

const store = reactive({
  /** { endpoint: count } 每个降级接口的调用次数 */
  details: {},
  /** 是否有任何 Mock 数据被使用 */
  get active() {
    return Object.keys(this.details).length > 0
  },
  /** 总降级次数 */
  get total() {
    return Object.values(this.details).reduce((a, b) => a + b, 0)
  },
})

/**
 * 记录一次 Mock 数据使用。
 * @param {string} endpoint  接口标识，如 "GET /api/telemetry/latest/SL_001"
 */
export function reportMock(endpoint) {
  store.details[endpoint] = (store.details[endpoint] || 0) + 1
  if (import.meta.env.DEV) {
    console.warn(`[Mock] ${endpoint} 共 ${store.details[endpoint]} 次`)
  }
}

export default store
