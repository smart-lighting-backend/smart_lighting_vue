/**
 * useMqtt.js — MQTT WebSocket 实时推送 composable
 *
 * 全局单例 MQTT 客户端，连接 EMQX WebSocket。
 * 各页面通过 subscribe(topic, callback) 订阅，组件卸载时自动取消。
 *
 * 用法:
 *   const { subscribe } = useMqtt()
 *   onMounted(() => {
 *     subscribe('system/alarms', (data) => { ... })
 *   })
 */
import { onUnmounted } from 'vue'
import mqtt from 'mqtt'

const BROKER_URL = 'ws://47.96.27.141:8083/mqtt'
const MQTT_USER = 'backend'
const MQTT_PASS = '123456'

let client = null
const topicCallbacks = new Map()
let connectPromise = null
let connected = false

function getClient() {
  if (client) return client

  client = mqtt.connect(BROKER_URL, {
    username: MQTT_USER,
    password: MQTT_PASS,
    clientId: 'web_' + Math.random().toString(16).slice(2, 10),
    clean: true,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
  })

  client.on('connect', () => {
    connected = true
    for (const topic of topicCallbacks.keys()) {
      client.subscribe(topic, { qos: 0 })
    }
  })

  client.on('reconnect', () => {
    connected = false
  })

  client.on('message', (topic, payload) => {
    const cbs = topicCallbacks.get(topic)
    if (!cbs) return
    try {
      const data = JSON.parse(payload.toString())
      cbs.forEach(cb => cb(data, topic))
    } catch (_) { /* ignore malformed */ }
  })

  return client
}

export function useMqtt() {
  const unsubs = []

  function subscribe(topic, callback) {
    const c = getClient()

    if (!topicCallbacks.has(topic)) {
      topicCallbacks.set(topic, new Set())
    }
    topicCallbacks.get(topic).add(callback)

    if (c.connected) {
      c.subscribe(topic, { qos: 0 })
    }

    const unsub = () => {
      const cbs = topicCallbacks.get(topic)
      if (cbs) {
        cbs.delete(callback)
        if (cbs.size === 0) {
          topicCallbacks.delete(topic)
          if (client && client.connected) {
            client.unsubscribe(topic)
          }
        }
      }
    }
    unsubs.push(unsub)
    return unsub
  }

  onUnmounted(() => {
    unsubs.forEach(fn => fn())
  })

  return { subscribe }
}
