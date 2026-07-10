/**
 * useControlSync.js — 跨标签页设备控制状态同步
 *
 * 使用 BroadcastChannel API 在同源标签页之间广播设备控制状态变更。
 * DeviceDetail 操作设备后广播 → Dashboard 的 3D 场景实时更新。
 * 同一标签页内仍使用 controlStateStore 内存缓存。
 *
 * 用法:
 *   // 广播端（DeviceDetail / control.js）
 *   const { broadcastControl } = useControlSync()
 *   broadcastControl(deviceId, 'OFF', 0)
 *
 *   // 接收端（Dashboard）
 *   const { onControlChange } = useControlSync()
 *   onControlChange((deviceId, action, brightness) => {
 *     // 更新 3D 场景
 *   })
 */
import { onUnmounted } from 'vue'
import { setControlState } from '../utils/controlStateStore.js'

const CHANNEL_NAME = 'smart-light-control'

let channel = null
const listeners = new Set()

function getChannel() {
  if (channel) return channel
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event) => {
      const { deviceId, action, brightness } = event.data || {}
      if (!deviceId || !action) return
      // 同步到内存缓存
      setControlState(deviceId, action, brightness)
      // 通知所有监听器
      listeners.forEach(fn => {
        try { fn(deviceId, action, brightness) } catch (_) { /* ignore */ }
      })
    }
  } catch (_) {
    // BroadcastChannel 不可用（极旧浏览器），静默降级
    channel = null
  }
  return channel
}

export function useControlSync() {
  const c = getChannel()

  /** 广播控制状态变更到其他标签页 */
  function broadcastControl(deviceId, action, brightness) {
    // 先更新本标签页内存缓存
    setControlState(deviceId, action, brightness)
    // 广播给其他标签页
    if (c) {
      c.postMessage({ deviceId, action, brightness })
    }
  }

  /** 监听来自其他标签页的控制状态变更 */
  function onControlChange(fn) {
    listeners.add(fn)
    // 返回取消订阅函数
    return () => { listeners.delete(fn) }
  }

  onUnmounted(() => {
    // 注意：不在这里关闭 channel，因为它是单例
  })

  return { broadcastControl, onControlChange }
}
