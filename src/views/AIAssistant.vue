<script setup>
import { ref, reactive, onMounted } from 'vue'
import { sendChatMessage, diagnoseDevice } from '../api/assistant.js'
import { fetchDeviceList } from '../api/devices.js'

const messages = ref([
  { role: 'assistant', text: '你好！我是智慧路灯节能系统的 AI 助手。基于 MaxKB 知识库，我可以帮助你解答路灯故障排查和系统配置问题。请问有什么可以帮您？' },
])
const input = ref('')
const loading = ref(false)

const suggestions = ['灯不亮怎么办', '如何优化节能策略？', '设备离线怎么排查']
const deviceList = ref([])
const selectedDevice = ref('')

onMounted(async () => {
  try {
    const list = await fetchDeviceList()
    deviceList.value = Array.isArray(list) ? list : (list?.data?.records || [])
  } catch { deviceList.value = [] }
})

async function runDiagnose() {
  if (!selectedDevice.value) return
  loading.value = true
  const label = '诊断设备: ' + selectedDevice.value
  messages.value.push({ role: 'user', text: label })
  try {
    const res = await diagnoseDevice(selectedDevice.value, '')
    if (res?.data) {
      messages.value.push({ role: 'assistant', text: res.data.content || '诊断完成', type: 'KNOWLEDGE_QA' })
    }
  } catch {
    messages.value.push({ role: 'assistant', text: '诊断请求失败，请检查服务状态。' })
  }
  loading.value = false
}

// 过滤 action 中的非参数 key（name/policyId/policyName 是元信息）
function actionParams(action) {
  if (!action) return {}
  const meta = ['name', 'policyId', 'policyName']
  return Object.fromEntries(Object.entries(action).filter(([k]) => !meta.includes(k)))
}

const PARAM_LABELS = {
  luxLt: '开灯阈值', lux_lt: '开灯阈值',
  luxGt: '关灯阈值', lux_gt: '关灯阈值',
  tempLt: '低温触发', temp_lt: '低温触发',
  startTime: '开始时间', endTime: '结束时间',
  brightness: '调光亮度', enabled: '启用状态',
}

function paramLabel(key) { return PARAM_LABELS[key] || key }

function formatParam(key, val) {
  if (['luxLt','lux_lt','luxGt','lux_gt'].includes(key)) return val + ' lux'
  if (['tempLt','temp_lt'].includes(key)) return val + '℃'
  if (key === 'brightness') return val + '%'
  return val
}

function renderMd(text) {
  if (!text) return ''
  // 先转义 HTML 防止 XSS，再还原我们主动生成的标签
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  // 粗体
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // 斜体
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // 块引用
  html = html.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
  // 标题
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>')
  // 水平线
  html = html.replace(/^---$/gm, '<hr>')
  // 无序列表
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  // 有序列表
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
  // 合并相邻 <li> 为 <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')
  // 合并相邻 <blockquote>
  html = html.replace(/((?:<blockquote>.*<\/blockquote>\n?)+)/g, '<div class="md-quote-group">$1</div>')
  // 换行
  html = html.replace(/\n\n/g, '<br><br>')
  html = html.replace(/\n/g, '<br>')
  return html
}

async function sendMessage(text) {
  const q = text || input.value.trim()
  if (!q) return
  messages.value.push({ role: 'user', text: q })
  input.value = ''
  loading.value = true
  
  try {
    const res = await sendChatMessage(q)
    if (res && res.data) {
      const type = res.data.type
      const content = res.data.content || ''
      const action = res.data.action
      
      messages.value.push({ role: 'assistant', text: content, type, action })
    }
  } catch (e) {
    messages.value.push({ role: 'assistant', text: '抱歉，系统通信出现异常，请稍后重试。' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="assistant-page">
    <div class="page-header">
      <h1 class="page-title">
        <svg viewBox="0 0 24 24" fill="none" width="22" height="22"><rect x="4" y="8" width="16" height="12" rx="2" fill="currentColor" opacity="0.2" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="13" r="1.5" fill="currentColor"/><circle cx="15" cy="13" r="1.5" fill="currentColor"/><path d="M9 17h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 8V5M10 5h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        智能助手
      </h1>
      <p class="page-sub">AI 驱动的设备诊断与运维建议</p>
    </div>

    <div class="chat-container">
      <section class="chat-main">
        <div class="chat-main-header">
          <div class="assistant-orb">
            <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="8" width="16" height="12" rx="2" fill="currentColor" opacity="0.18" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="13" r="1.5" fill="currentColor"/><circle cx="15" cy="13" r="1.5" fill="currentColor"/><path d="M9 17h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 8V5M10 5h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </div>
          <div class="chat-title-block">
            <span class="chat-kicker">MAXKB · AI OPERATIONS</span>
            <h2>智能运维会话</h2>
          </div>
          <div class="chat-health">
            <span class="health-dot"></span>
            <span>在线</span>
          </div>
        </div>

        <div class="messages-area">
          <div v-for="(msg, i) in messages" :key="i" class="message" :class="msg.role">
            <div class="msg-avatar">
              <svg v-if="msg.role==='assistant'" viewBox="0 0 24 24" fill="none"><rect x="4" y="8" width="16" height="12" rx="2" fill="currentColor" opacity="0.6" stroke="currentColor" stroke-width="1.5"/><circle cx="9" cy="13" r="1.5" fill="currentColor"/><circle cx="15" cy="13" r="1.5" fill="currentColor"/></svg>
              <svg v-else viewBox="0 0 24 24" fill="none"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </div>
            <div class="msg-bubble">
              <div v-html="renderMd(msg.text)"></div>
              <div v-if="msg.action" class="action-card">
                <div class="ac-title">
                  <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  指令已执行: {{ msg.action.name }}
                </div>
                <div class="ac-detail">▸ 目标策略：{{ msg.action.policyName }} (ID: {{ msg.action.policyId }})</div>
                <div v-for="(val, key) in actionParams(msg.action)" :key="key" class="ac-detail">
                  ▸ {{ paramLabel(key) }}：<span class="ac-highlight">{{ formatParam(key, val) }}</span>
                </div>
                <router-link :to="'/strategy/edit/' + msg.action.policyId" class="ac-link">查看策略 →</router-link>
              </div>
            </div>
          </div>
          <div v-if="loading" class="message assistant">
            <div class="msg-avatar"><svg viewBox="0 0 24 24" fill="none"><rect x="4" y="8" width="16" height="12" rx="2" fill="currentColor" opacity="0.6" stroke="currentColor" stroke-width="1.5"/></svg></div>
            <div class="msg-bubble typing"><span></span><span></span><span></span></div>
          </div>
        </div>

        <div class="input-area">
          <input v-model="input" class="chat-input" placeholder="输入问题，例如：当前有哪些设备异常？" @keydown.enter="sendMessage()" :disabled="loading" />
          <button class="send-btn" @click="sendMessage()" :disabled="loading || !input.trim()">
            <svg viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </section>

      <aside class="ai-side">
        <div class="side-panel diagnose-panel">
          <div class="side-panel-head">
            <span class="side-icon">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v3M12 18v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M3 12h3M18 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/></svg>
            </span>
            <div>
              <h3>设备诊断</h3>
              <p>{{ deviceList.length }} 台设备接入</p>
            </div>
          </div>
          <div class="diagnose-bar">
            <select v-model="selectedDevice" class="device-select">
              <option value="">— 选择设备 —</option>
              <option v-for="d in deviceList" :key="d.deviceId || d.id" :value="d.deviceId">{{ d.deviceId }} {{ d.name }}</option>
            </select>
            <button class="diagnose-btn" @click="runDiagnose" :disabled="loading || !selectedDevice">一键诊断</button>
          </div>
        </div>

        <div class="side-panel quick-panel">
          <div class="side-panel-head compact">
            <span class="side-icon">
              <svg viewBox="0 0 24 24" fill="none"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            </span>
            <h3>快捷指令</h3>
          </div>
          <div class="suggestions">
            <button v-for="s in suggestions" :key="s" class="suggestion-chip" @click="sendMessage(s)">{{ s }}</button>
          </div>
        </div>

        <div class="side-panel signal-panel">
          <div class="signal-row">
            <span>知识库</span>
            <b>ACTIVE</b>
          </div>
          <div class="signal-row">
            <span>策略联动</span>
            <b>READY</b>
          </div>
          <div class="signal-row">
            <span>诊断通道</span>
            <b>ONLINE</b>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.assistant-page {
  position: relative;
  padding: 24px 28px;
  height: calc(100vh - 56px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #1d3148;
}
.assistant-page::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 12% 12%, rgba(0, 141, 230, 0.16), transparent 28%),
    radial-gradient(circle at 86% 16%, rgba(20, 184, 166, 0.12), transparent 30%),
    radial-gradient(circle at 52% 86%, rgba(245, 158, 11, 0.07), transparent 26%);
  opacity: 0.9;
}
.assistant-page > * {
  position: relative;
  z-index: 1;
}
.page-header {
  margin-bottom: 16px;
}
.page-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 24px;
  font-weight: 900;
  color: #0d1b2d;
  margin: 0 0 5px;
  letter-spacing: 0;
}
.page-title svg {
  width: 26px;
  height: 26px;
  padding: 5px;
  color: #008de6;
  background: linear-gradient(135deg, rgba(0, 141, 230, 0.12), rgba(20, 184, 166, 0.12));
  border: 1px solid rgba(0, 141, 230, 0.20);
  border-radius: 8px;
  box-shadow: 0 10px 22px rgba(0, 141, 230, 0.14);
}
.page-sub {
  font-size: 13px;
  color: #40566f;
  font-weight: 700;
}
.chat-container {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.97), rgba(242, 249, 255, 0.94)),
    linear-gradient(90deg, rgba(0, 141, 230, 0.08), transparent 32%, rgba(20, 184, 166, 0.07));
  border: 1px solid rgba(0, 141, 230, 0.18);
  border-radius: 10px;
  box-shadow:
    0 22px 56px rgba(14, 70, 120, 0.13),
    inset 0 0 0 1px rgba(255, 255, 255, 0.74);
}
.chat-container::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(90deg, rgba(0, 141, 230, 0.06) 1px, transparent 1px),
    linear-gradient(180deg, rgba(0, 141, 230, 0.05) 1px, transparent 1px);
  background-size: 42px 42px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.75), transparent 72%);
}
.chat-container::after {
  content: "";
  position: absolute;
  top: 0;
  left: -35%;
  width: 35%;
  height: 2px;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(0, 141, 230, 0.78), rgba(20, 184, 166, 0.72), transparent);
  animation: aiScan 4s ease-in-out infinite;
}
@keyframes aiScan {
  0% { transform: translateX(0); opacity: 0; }
  18% { opacity: 1; }
  72% { opacity: 1; }
  100% { transform: translateX(390%); opacity: 0; }
}
.messages-area {
  position: relative;
  flex: 1;
  overflow-y: auto;
  padding: 22px 20px;
  display: flex;
  flex-direction: column;
  gap: 15px;
  background:
    radial-gradient(circle at 20% 8%, rgba(0, 141, 230, 0.10), transparent 24%),
    radial-gradient(circle at 80% 22%, rgba(20, 184, 166, 0.08), transparent 24%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.50), rgba(247, 251, 255, 0.62));
}
.messages-area > .message {
  position: relative;
  z-index: 1;
}
.message {
  display: flex;
  gap: 11px;
}
.message.user {
  flex-direction: row-reverse;
}
.msg-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.message.assistant .msg-avatar {
  position: relative;
  background: radial-gradient(circle at 35% 32%, #ffffff, rgba(0, 141, 230, 0.16));
  border: 1px solid rgba(0, 141, 230, 0.26);
  color: #008de6;
  box-shadow: 0 0 0 5px rgba(0, 141, 230, 0.06), 0 12px 24px rgba(0, 141, 230, 0.18);
}
.message.assistant .msg-avatar::after {
  content: "";
  position: absolute;
  inset: -5px;
  border-radius: 50%;
  border: 1px solid rgba(20, 184, 166, 0.22);
  animation: neuralPulse 2.4s ease-out infinite;
}
.message.user .msg-avatar {
  background: linear-gradient(135deg, rgba(49, 81, 111, 0.12), rgba(0, 141, 230, 0.10));
  border: 1px solid rgba(49, 81, 111, 0.18);
  color: #31516f;
}
.msg-avatar svg {
  width: 18px;
  height: 18px;
}
@keyframes neuralPulse {
  0% { transform: scale(0.86); opacity: 0.8; }
  70%, 100% { transform: scale(1.35); opacity: 0; }
}
.msg-bubble {
  max-width: 74%;
  padding: 12px 15px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.65;
  box-shadow: 0 10px 24px rgba(14, 70, 120, 0.08);
}
.msg-bubble :deep(strong) { color: #0d1b2d; font-weight: 900; }
.msg-bubble :deep(em) { color: #40566f; }
.msg-bubble :deep(h3) { margin: 4px 0 8px; font-size: 15px; font-weight: 900; color: #0d1b2d; }
.msg-bubble :deep(h4) { margin: 4px 0 6px; font-size: 13px; font-weight: 900; color: #0d1b2d; }
.msg-bubble :deep(ul) { margin: 6px 0; padding-left: 18px; }
.msg-bubble :deep(li) { margin-bottom: 2px; line-height: 1.6; }
.msg-bubble :deep(blockquote) {
  margin: 8px 0; padding: 6px 12px;
  border-left: 3px solid #008de6;
  background: rgba(0, 141, 230, 0.06);
  border-radius: 0 6px 6px 0;
  color: #40566f; font-style: italic;
}
.msg-bubble :deep(hr) { margin: 10px 0; border: none; border-top: 1px solid rgba(0,141,230,0.14); }
.msg-bubble :deep(.md-quote-group) { margin: 6px 0; }
.message.assistant .msg-bubble {
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(235, 248, 255, 0.94));
  border: 1px solid rgba(0, 141, 230, 0.18);
  border-left: 3px solid #008de6;
  color: #1d3148;
  font-weight: 600;
  border-radius: 4px 10px 10px 10px;
}
.message.user .msg-bubble {
  background: linear-gradient(135deg, #008de6, #21c8dc);
  border: 1px solid rgba(0, 141, 230, 0.28);
  color: #ffffff;
  font-weight: 700;
  border-radius: 10px 4px 10px 10px;
  box-shadow: 0 12px 26px rgba(0, 141, 230, 0.22);
}
.typing {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 14px;
}
.typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #008de6;
  animation: bounce 1.2s infinite;
}
.typing span:nth-child(2) { animation-delay: 0.2s; }
.typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-6px); }
}
.diagnose-bar,
.suggestions,
.input-area {
  position: relative;
  z-index: 1;
  background: rgba(255, 255, 255, 0.84);
  backdrop-filter: blur(10px);
}
.diagnose-bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(0, 141, 230, 0.13);
}
.device-select {
  flex: 1;
  height: 38px;
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(0, 141, 230, 0.20);
  border-radius: 7px;
  color: #1d3148;
  font-size: 13px;
  font-weight: 600;
  outline: none;
  cursor: pointer;
  box-shadow: 0 0 0 1px rgba(0, 141, 230, 0.04) inset;
}
.device-select:focus {
  border-color: rgba(0, 141, 230, 0.48);
  box-shadow: 0 0 0 3px rgba(0, 141, 230, 0.12);
}
.device-select option {
  color: #1d3148;
  background: #ffffff;
}
.diagnose-btn {
  padding: 8px 20px;
  background: linear-gradient(135deg, #18b6a5, #21c8dc);
  border: 1px solid rgba(20, 184, 166, 0.28);
  border-radius: 7px;
  color: #ffffff;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.18s ease;
  box-shadow: 0 10px 22px rgba(20, 184, 166, 0.20);
}
.diagnose-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 26px rgba(20, 184, 166, 0.26);
}
.diagnose-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.suggestions {
  padding: 12px 16px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  border-top: 1px solid rgba(0, 141, 230, 0.10);
}
.suggestion-chip {
  padding: 6px 13px;
  background: rgba(232, 246, 255, 0.92);
  border: 1px solid rgba(0, 141, 230, 0.20);
  border-radius: 18px;
  font-size: 12px;
  font-weight: 700;
  color: #006fc2;
  cursor: pointer;
  transition: all 0.18s ease;
}
.suggestion-chip:hover {
  background: rgba(0, 141, 230, 0.10);
  color: #005fa8;
  border-color: rgba(0, 141, 230, 0.34);
  transform: translateY(-1px);
}
.input-area {
  display: flex;
  gap: 10px;
  padding: 14px 16px;
  border-top: 1px solid rgba(0, 141, 230, 0.12);
}
.chat-input {
  flex: 1;
  height: 42px;
  padding: 0 14px;
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid rgba(0, 141, 230, 0.20);
  border-radius: 8px;
  color: #1d3148;
  font-size: 13px;
  font-weight: 600;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.chat-input:focus {
  border-color: rgba(0, 141, 230, 0.50);
  box-shadow: 0 0 0 3px rgba(0, 141, 230, 0.12);
}
.chat-input::placeholder {
  color: #6f8194;
  font-weight: 500;
}
.chat-input:disabled {
  opacity: 0.62;
}
.send-btn {
  width: 42px;
  height: 42px;
  background: linear-gradient(135deg, #008de6, #21c8dc);
  border: none;
  border-radius: 8px;
  color: #ffffff;
  cursor: pointer;
  transition: all 0.18s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 22px rgba(0, 141, 230, 0.24);
}
.send-btn:hover:not(:disabled) {
  transform: translateY(-1px) scale(1.03);
  box-shadow: 0 12px 26px rgba(0, 141, 230, 0.30);
}
.send-btn:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}
.action-card {
  margin-top: 10px;
  padding: 11px 12px;
  background: rgba(232, 246, 255, 0.90);
  border: 1px solid rgba(0, 141, 230, 0.18);
  border-radius: 7px;
  border-left: 3px solid #18b6a5;
}
.ac-title {
  font-weight: 800;
  color: #006fc2;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 4px;
}
.ac-detail {
  font-size: 12px;
  color: #40566f;
  line-height: 1.55;
  margin-left: 19px;
  font-weight: 600;
}
.ac-highlight {
  color: #b45309;
  font-weight: 800;
}
.ac-link {
  display: inline-block;
  margin-top: 8px;
  font-size: 12px;
  color: #006fc2;
  font-weight: 800;
  text-decoration: none;
  transition: color 0.18s ease;
}
.ac-link:hover {
  color: #18b6a5;
  text-decoration: underline;
}

/* 布局重排：主会话 + 右侧 AI 运维面板 */
.chat-container {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  grid-template-rows: minmax(0, 1fr);
  gap: 18px;
  padding: 16px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(242, 249, 255, 0.92)),
    linear-gradient(90deg, rgba(0, 141, 230, 0.06), transparent 32%, rgba(20, 184, 166, 0.06));
}

.chat-main,
.ai-side {
  position: relative;
  z-index: 1;
  min-height: 0;
}

.chat-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(0, 141, 230, 0.16);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(246, 251, 255, 0.92));
  box-shadow:
    0 16px 38px rgba(14, 70, 120, 0.10),
    inset 0 1px 0 rgba(255, 255, 255, 0.95);
}

.chat-main-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid rgba(0, 141, 230, 0.12);
  background:
    linear-gradient(180deg, rgba(236, 248, 255, 0.95), rgba(255, 255, 255, 0.72));
}

.assistant-orb {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
  color: #008de6;
  background:
    linear-gradient(135deg, rgba(0, 141, 230, 0.14), rgba(20, 184, 166, 0.12));
  border: 1px solid rgba(0, 141, 230, 0.22);
  box-shadow: 0 12px 28px rgba(0, 126, 206, 0.14);
}

.assistant-orb svg {
  width: 24px;
  height: 24px;
}

.chat-title-block {
  flex: 1;
  min-width: 0;
}

.chat-kicker {
  display: block;
  margin-bottom: 2px;
  color: #008de6;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0;
}

.chat-title-block h2 {
  margin: 0;
  color: #0d1b2d;
  font-size: 18px;
  line-height: 1.25;
  font-weight: 900;
  letter-spacing: 0;
}

.chat-health {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 10px;
  border: 1px solid rgba(27, 169, 116, 0.22);
  border-radius: 999px;
  background: rgba(27, 169, 116, 0.10);
  color: #13845c;
  font-size: 12px;
  font-weight: 900;
  white-space: nowrap;
}

.health-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 0 5px rgba(27, 169, 116, 0.11);
}

.messages-area {
  min-height: 0;
  padding: 20px 20px 22px;
  border: 0;
  background:
    radial-gradient(circle at 18% 12%, rgba(0, 141, 230, 0.09), transparent 24%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.62), rgba(247, 251, 255, 0.74));
}

.input-area {
  flex-shrink: 0;
  padding: 14px 16px;
  border-top: 1px solid rgba(0, 141, 230, 0.12);
  background: rgba(255, 255, 255, 0.92);
}

.ai-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.side-panel {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(0, 141, 230, 0.16);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(244, 250, 255, 0.90));
  box-shadow:
    0 16px 34px rgba(14, 70, 120, 0.09),
    inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.side-panel::before {
  content: "";
  position: absolute;
  left: 14px;
  right: 14px;
  top: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 141, 230, 0.42), rgba(20, 184, 166, 0.34), transparent);
}

.side-panel-head {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 15px 15px 12px;
}

.side-panel-head.compact {
  padding-bottom: 8px;
}

.side-icon {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
  color: #006fc2;
  background: rgba(232, 246, 255, 0.92);
  border: 1px solid rgba(0, 141, 230, 0.16);
}

.side-icon svg {
  width: 18px;
  height: 18px;
}

.side-panel h3 {
  margin: 0;
  color: #0d1b2d;
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0;
}

.side-panel p {
  margin: 3px 0 0;
  color: #40566f;
  font-size: 12px;
  font-weight: 700;
}

.ai-side .diagnose-bar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 15px 15px;
  border: 0;
  background: transparent;
}

.ai-side .device-select {
  width: 100%;
  flex: none;
}

.ai-side .diagnose-btn {
  width: 100%;
  height: 40px;
}

.quick-panel .suggestions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 9px;
  padding: 0 15px 15px;
  border: 0;
  background: transparent;
}

.quick-panel .suggestion-chip {
  width: 100%;
  min-height: 38px;
  border-radius: 8px;
  text-align: left;
  color: #006fc2;
  background: rgba(232, 246, 255, 0.82);
}

.quick-panel .suggestion-chip:hover {
  background: #ffffff;
}

.signal-panel {
  padding: 10px 14px;
}

.signal-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid rgba(16, 126, 196, 0.10);
}

.signal-row:last-child {
  border-bottom: 0;
}

.signal-row span {
  color: #40566f;
  font-size: 12px;
  font-weight: 800;
}

.signal-row b {
  color: #13845c;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0;
}

/* 视口适配：把底部输入框上移，避免低高度屏幕看不完整 */
.assistant-page {
  padding-top: 16px;
  padding-bottom: 14px;
  height: calc(100vh - 56px);
  min-height: 0;
}

.page-header {
  margin-bottom: 10px;
}

.page-title {
  font-size: 22px;
  margin-bottom: 2px;
}

.page-title svg {
  width: 24px;
  height: 24px;
}

.page-sub {
  line-height: 1.25;
}

.chat-container {
  align-items: stretch;
  flex: 1 1 0;
  min-height: 0;
  height: auto;
}

.chat-main {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.ai-side {
  height: 100%;
  min-height: 0;
}

.signal-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.chat-main-header {
  padding: 12px 16px;
}

.assistant-orb {
  width: 38px;
  height: 38px;
}

.assistant-orb svg {
  width: 21px;
  height: 21px;
}

.chat-title-block h2 {
  font-size: 17px;
}

.messages-area {
  padding: 16px 18px;
}

.input-area {
  margin: 0 16px 14px;
  padding: 10px;
  border: 1px solid rgba(0, 141, 230, 0.16);
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(0, 126, 206, 0.10);
}

.chat-input,
.send-btn {
  height: 38px;
}

.send-btn {
  width: 38px;
}

@media (max-width: 900px) {
  .assistant-page {
    padding: 18px;
  }
  .chat-container {
    grid-template-columns: 1fr;
    overflow-y: auto;
  }
  .chat-main {
    min-height: 560px;
  }
  .ai-side {
    display: grid;
    grid-template-columns: 1fr;
  }
  .msg-bubble {
    max-width: 84%;
  }
  .diagnose-bar {
    flex-direction: column;
  }
}
</style>
