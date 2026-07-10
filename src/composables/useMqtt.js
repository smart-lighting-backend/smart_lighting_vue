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
let connected = false
let connectCount = 0

function getClient() {
  if (client) return client

  client = mqtt.connect(BROKER_URL, {
    username: MQTT_USER,
    password: MQTT_PASS,
    clientId: 'web_' + Math.random().toString(16).slice(2, 10),
    clean: true,
    reconnectPeriod: 4000,
    connectTimeout: 8000,
    protocolVersion: 5,
    // MQTT 5.0 properties
    properties: {
      sessionExpiryInterval: 0,
    },
  })

  client.on('connect', (connack) => {
    connected = true
    connectCount++
    console.log('[MQTT] 已连接 (#' + connectCount + '), connack:', JSON.stringify(connack))

    // 收集所有待订阅主题，一次批量订阅
    const topics = [...topicCallbacks.keys()]
    if (topics.length === 0) return

    console.log('[MQTT] 批量订阅:', topics.join(', '))
    client.subscribe(topics, { qos: 0 }, (err, granted) => {
      if (err) {
        console.error('[MQTT] 订阅失败:', err.message)
        // 逐个重试
        topics.forEach(t => {
          client.subscribe(t, { qos: 0 }, (e2, g2) => {
            if (e2) {
              console.error('[MQTT] 单独订阅失败 [' + t + ']:', e2.message)
            } else {
              console.log('[MQTT] 单独订阅成功 [' + t + ']:', JSON.stringify(g2))
            }
          })
        })
      } else {
        console.log('[MQTT] 订阅成功:', JSON.stringify(granted))
      }
    })
  })

  client.on('reconnect', () => {
    connected = false
    console.warn('[MQTT] 重连中...')
  })

  client.on('error', (err) => {
    console.error('[MQTT] 连接错误:', err.message)
  })

  client.on('close', () => {
    connected = false
    console.warn('[MQTT] 连接已关闭')
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
      c.subscribe(topic, { qos: 0 }, (err, granted) => {
        if (err) {
          console.error('[MQTT] 订阅失败 [' + topic + ']:', err.message)
        } else {
          console.log('[MQTT] 订阅成功 [' + topic + ']:', JSON.stringify(granted))
        }
      })
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
