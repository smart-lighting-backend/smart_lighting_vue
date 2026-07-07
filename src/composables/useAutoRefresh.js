/**
 * 通用自动刷新 composable
 *
 * 用法:
 *   const { pause, resume, stop } = useAutoRefresh(() => loadData(), { interval: 30000 })
 *
 * 特性:
 *   - 页面隐藏时自动暂停，恢复可见时立刻拉取一次
 *   - KeepAlive 缓存时暂停（onDeactivated），激活时恢复（onActivated）
 *   - 传入 isSensitive 回调可在敏感操作（如下拉框展开）时跳过当次刷新
 *   - onUnmounted 自动清理定时器和事件监听
 */
import { onUnmounted, onActivated, onDeactivated, ref } from 'vue'

export function useAutoRefresh(fn, { interval = 30000, immediateFirst = false, isSensitive } = {}) {
  let timer = null
  let lastRun = 0
  const paused = ref(false)
  let deactivated = false

  function run() {
    if (paused.value || deactivated) return
    if (typeof isSensitive === 'function' && isSensitive()) return
    lastRun = Date.now()
    fn()
  }

  function schedule() {
    if (timer) clearInterval(timer)
    const delay = typeof interval === 'function' ? interval() : interval
    timer = setInterval(run, delay)
  }

  function start() {
    stop()
    if (immediateFirst) run()
    schedule()
  }

  function pause() {
    paused.value = true
    stop()
  }

  function resume() {
    paused.value = false
    run()
    schedule()
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  // ── 浏览器 Tab 可见性 ──
  function onVisibilityChange() {
    if (deactivated) return
    if (document.visibilityState === 'visible') {
      if (!lastRun || Date.now() - lastRun > (typeof interval === 'function' ? interval() : interval)) {
        run()
      }
      schedule()
    } else {
      stop()
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)

  // ── KeepAlive 缓存/激活 ──
  onDeactivated(() => {
    deactivated = true
    stop()
  })

  onActivated(() => {
    deactivated = false
    if (!lastRun || Date.now() - lastRun > (typeof interval === 'function' ? interval() : interval)) {
      run()
    }
    schedule()
  })

  // ── 组件销毁 ──
  onUnmounted(() => {
    stop()
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  // 启动
  start()

  return { pause, resume, stop }
}
