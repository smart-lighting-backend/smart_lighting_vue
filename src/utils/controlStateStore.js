/**
 * 全局灯光控制状态缓存
 * 当控制操作发生时自动记录，3D 场景读取此缓存覆盖遥测推测
 */
const store = new Map()

export function setControlState(deviceId, action, brightness) {
  store.set(deviceId, { action, brightness, time: Date.now() })
}

export function getControlState(deviceId) {
  return store.get(deviceId) || null
}

export function clearControlState(deviceId) {
  store.delete(deviceId)
}
