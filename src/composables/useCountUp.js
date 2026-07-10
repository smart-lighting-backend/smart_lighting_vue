import { ref, onUnmounted } from 'vue'

/**
 * 数字滚动动画 composable
 * @param {object}  options
 *   - duration: number  动画时长 ms (默认 1500)
 *   - decimals: number  小数位数 (默认 0)
 *   - suffix:   string  单位后缀 (默认 '')
 * @returns {{ display: Ref<string>, animating: Ref<boolean>, start: (target: number) => void }}
 */
export function useCountUp(options = {}) {
  const {
    duration = 1500,
    decimals = 0,
    suffix = '',
  } = options

  const display = ref('--')
  const animating = ref(false)
  let raf = null
  let startTime = null
  let startVal = 0
  let endVal = 0

  function fmt(val) {
    const n = Number(val)
    if (!Number.isFinite(n)) return '--'
    return n.toFixed(decimals) + suffix
  }

  function animate() {
    const elapsed = Date.now() - startTime
    const progress = Math.min(elapsed / duration, 1)
    const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic
    const current = startVal + (endVal - startVal) * eased
    display.value = fmt(current)

    if (progress < 1) {
      raf = requestAnimationFrame(animate)
    } else {
      display.value = fmt(endVal)
      animating.value = false
    }
  }

  function start(target) {
    cancelAnimationFrame(raf)
    endVal = target
    startVal = 0
    startTime = Date.now()
    animating.value = true
    animate()
  }

  onUnmounted(() => cancelAnimationFrame(raf))

  return { display, animating, start }
}
