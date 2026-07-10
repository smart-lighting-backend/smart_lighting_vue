<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchStrategyGroups, createStrategy, fetchStrategyDetail, updateStrategy, testStrategy } from '../api/strategy.js'
import { ElMessage } from 'element-plus'

const route = useRoute()
const router = useRouter()
const groups = ref([])
const saving = ref(false)
const saveSuccess = ref(false)
const isEdit = ref(false)
const testVisible = ref(false)
const testLoading = ref(false)
const testResult = ref(null)
const hasAnyHit = computed(() => testResult.value?.allResults?.some(r => r.hit) || testResult.value?.matched)
const testInput = reactive({
  illuminance: 20, temperature: 26, humidity: 60,
  pir: 0, trafficFlow: 5, currentTime: '23:00'
})

function buildCurrentConditions() {
  const obj = { group: form.group, time_range: `${form.startTime}-${form.endTime}` }
  conditionItems.value.filter(c => c.enabled).forEach(c => {
    obj[c.key] = c.isBoolean ? 1 : c.value
  })
  obj.extraActions = {
    voiceAlert: form.actions.voiceAlert,
    voiceContent: form.actions.voiceContent || undefined,
    capturePhoto: form.actions.capturePhoto,
    nightVision: form.actions.nightVision,
    generateAlert: form.actions.generateAlert,
    alertType: form.actions.alertType,
    alertLevel: form.actions.alertLevel,
    alertContent: form.actions.alertContent || undefined,
  }
  return JSON.stringify(obj)
}

function buildCurrentAction() {
  if (!form.actions.controlEnabled) return 'NOTIFY'
  if (form.actions.brightness === 0) return 'OFF'
  if (form.actions.brightness === 100) return 'ON'
  return 'DIMMING(' + form.actions.brightness + ')'
}

async function runTest() {
  testLoading.value = true
  testResult.value = null
  try {
    const payload = {
      illuminance: testInput.illuminance,
      temperature: testInput.temperature,
      humidity: testInput.humidity,
      pir: testInput.pir,
      trafficFlow: testInput.trafficFlow,
      currentTime: testInput.currentTime,
      conditions: buildCurrentConditions(),
      action: buildCurrentAction(),
      name: form.name || '(当前编辑策略)',
    }
    const res = await testStrategy(payload)
    testResult.value = res?.data || null
  } catch { testResult.value = { matched: false, matchedPolicy: null } }
  testLoading.value = false
}

const showAddMenu = ref(false)

// 可添加的条件类型（key 必须与 DecisionEngine evaluateSingle 匹配）
const AVAILABLE_CONDITIONS = [
  { key: 'lux_lt',     label: '光照强度低于',   desc: '当光照传感器读数低于阈值时触发',     value: 50,  unit: 'Lux' },
  { key: 'lux_gt',     label: '光照强度高于',   desc: '当光照传感器读数超过阈值时触发',     value: 200, unit: 'Lux' },
  { key: 'temp_lt',    label: '温度低于',       desc: '当温度读数低于阈值时触发',           value: 5,   unit: '°C' },
  { key: 'temp_gt',    label: '温度高于',       desc: '当温度读数超过阈值时触发',           value: 35,  unit: '°C' },
  { key: 'humidity_lt',label: '湿度低于',       desc: '当湿度读数低于阈值时触发',           value: 30,  unit: '%' },
  { key: 'humidity_gt',label: '湿度高于',       desc: '当湿度读数超过阈值时触发',           value: 80,  unit: '%' },
  { key: 'traffic_gt', label: '车流量高于',     desc: '当车流量读数超过阈值时触发',         value: 30,  unit: '辆/分钟' },
  { key: 'pir',        label: '人体红外检测',   desc: '检测到人体活动时触发（1=有人）',    value: 1,   unit: '',   isBoolean: true },
]

// 旧格式条件映射 → 新格式 key
function mapOldCondition(key, val) {
  switch (key) {
    case 'illuminance': return { key: 'lux_lt', label: '环境光照度低于阈值', desc: '当光传感器读数跌至阈值以下时触发。', value: val.threshold || 30, unit: 'Lux', enabled: true }
    case 'traffic': return { key: 'traffic_lt', label: '人车流量阈值（雷达感知）', desc: '区域内5分钟平均流量低于设定值。', value: val.threshold || 10, unit: '次/5min', enabled: true }
    default: return null
  }
}

const form = reactive({
  name: '',
  group: '',
  startTime: '23:00',
  endTime: '05:00',
  actions: {
    controlEnabled: true,
    brightness: 30,
    voiceAlert: false,
    voiceContent: '',
    capturePhoto: false,
    nightVision: false,
    generateAlert: false,
    alertType: 'POLICY_ALERT',
    alertLevel: 'WARNING',
    alertContent: '',
  },
})

let nextId = 1
const conditionItems = ref([
  { id: nextId++, key: 'lux_lt',     label: '环境光照度低于阈值',       desc: '当光传感器读数跌至阈值以下时触发。',   value: 30, unit: 'Lux',        enabled: true },
  { id: nextId++, key: 'traffic_lt', label: '人车流量阈值（雷达感知）', desc: '区域内5分钟平均流量低于设定值。',       value: 10, unit: '次/5min',    enabled: false },
])

function addCondition(typeKey) {
  const def = AVAILABLE_CONDITIONS.find(c => c.key === typeKey)
  if (!def) return
  if (conditionItems.value.some(c => c.key === typeKey)) {
    ElMessage.warning('该条件已存在')
    return
  }
  conditionItems.value.push({
    id: nextId++,
    key: def.key,
    label: def.label,
    desc: def.desc,
    value: def.value,
    unit: def.unit,
    enabled: true,
    isBoolean: def.isBoolean || false,
  })
}

function removeCondition(id) {
  conditionItems.value = conditionItems.value.filter(c => c.id !== id)
}

function unusedConditions() {
  return AVAILABLE_CONDITIONS.filter(o => !conditionItems.value.some(c => c.key === o.key))
}

onMounted(async () => {
  const res = await fetchStrategyGroups()
  groups.value = res.data || []
  if (groups.value.length) form.group = groups.value[0]

  if (route.params.id) {
    isEdit.value = true
    const detailRes = await fetchStrategyDetail(route.params.id)
    if (detailRes && detailRes.data) {
      const data = detailRes.data
      form.name = data.name || ''
      if (data.conditions && typeof data.conditions === 'string') {
        try {
          const cond = JSON.parse(data.conditions)
          if (cond.group) form.group = cond.group
          // 兼容 time_range（新格式）和 startTime/endTime（旧格式）
          if (cond.time_range && typeof cond.time_range === 'string') {
            const parts = cond.time_range.split('-')
            if (parts.length === 2) {
              form.startTime = parts[0]
              form.endTime = parts[1]
            }
          } else {
            if (cond.startTime) form.startTime = cond.startTime
            if (cond.endTime) form.endTime = cond.endTime
          }
          if (cond.extraActions) {
            form.actions.voiceAlert = !!cond.extraActions.voiceAlert
            form.actions.voiceContent = cond.extraActions.voiceContent || ''
            form.actions.capturePhoto = !!cond.extraActions.capturePhoto
            form.actions.nightVision = !!cond.extraActions.nightVision
            form.actions.generateAlert = !!cond.extraActions.generateAlert
            if (cond.extraActions.alertType) form.actions.alertType = cond.extraActions.alertType
            if (cond.extraActions.alertLevel) form.actions.alertLevel = cond.extraActions.alertLevel
            form.actions.alertContent = cond.extraActions.alertContent || ''
          }

          // 解析条件：兼容新格式 (lux_lt: 30) 和旧嵌套格式 (illuminance: {enabled, threshold})
          const items = []
          const metaKeys = ['group', 'startTime', 'endTime', 'time_range', 'extraActions']
          for (const [key, val] of Object.entries(cond)) {
            if (metaKeys.includes(key)) continue
            if (typeof val === 'number' || typeof val === 'string') {
              const def = AVAILABLE_CONDITIONS.find(c => c.key === key)
              items.push({
                id: nextId++,
                key,
                label: def ? def.label : key,
                desc: def ? def.desc : '',
                value: Number(val),
                unit: def ? def.unit : '',
                enabled: true,
                isBoolean: def ? def.isBoolean || false : false,
              })
            } else if (val && typeof val === 'object' && val.enabled) {
              const mapped = mapOldCondition(key, val)
              if (mapped) items.push({ id: nextId++, ...mapped })
            }
          }
          if (items.length > 0) conditionItems.value = items
        } catch(e) {}
      }

      if (data.action === 'NOTIFY') {
        form.actions.controlEnabled = false
      } else if (data.action === 'ON') {
        form.actions.brightness = 100
      } else if (data.action === 'OFF') {
        form.actions.brightness = 0
      } else if (data.action && data.action.startsWith('DIMMING(')) {
        const val = parseInt(data.action.replace('DIMMING(', '').replace(')', ''))
        if (!isNaN(val)) form.actions.brightness = val
      }
    }
  }
})

async function saveStrategy() {
  if (!form.name.trim()) return alert('请输入策略名称')
  saving.value = true

  let actionStr
  if (!form.actions.controlEnabled) {
    actionStr = 'NOTIFY'
  } else if (form.actions.brightness === 0) {
    actionStr = 'OFF'
  } else if (form.actions.brightness === 100) {
    actionStr = 'ON'
  } else {
    actionStr = 'DIMMING(' + form.actions.brightness + ')'
  }

  // 构建引擎兼容的扁平条件 JSON
  const conditionsObj = {
    group: form.group,
    time_range: `${form.startTime}-${form.endTime}`,
  }
  conditionItems.value.filter(c => c.enabled).forEach(c => {
    conditionsObj[c.key] = c.isBoolean ? 1 : c.value
  })
  conditionsObj.extraActions = {
    voiceAlert: form.actions.voiceAlert,
    voiceContent: form.actions.voiceContent || undefined,
    capturePhoto: form.actions.capturePhoto,
    nightVision: form.actions.nightVision,
    generateAlert: form.actions.generateAlert,
    alertType: form.actions.alertType,
    alertLevel: form.actions.alertLevel,
    alertContent: form.actions.alertContent || undefined,
  }

  const payload = {
    name: form.name,
    policyType: 'SCENE',
    conditions: JSON.stringify(conditionsObj),
    action: actionStr,
    effectiveTime: `${form.startTime}-${form.endTime}`,
  }

  try {
    if (isEdit.value) {
      await updateStrategy(route.params.id, payload)
    } else {
      await createStrategy(payload)
    }
    saveSuccess.value = true
    setTimeout(() => {
      router.push('/strategy')
    }, 1200)
  } catch (e) {
    alert('保存失败，请重试')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="strategy-create-page">
    <div class="page-header">
      <button class="back-btn" @click="router.push('/strategy')">
        <svg viewBox="0 0 24 24" fill="none"><path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div>
        <h1 class="page-title">{{ isEdit ? '编辑策略配置' : '新建策略配置' }}</h1>
        <p class="page-sub">配置基于环境感知与时间调度的路灯联动规则。</p>
      </div>
    </div>

    <div class="form-content">
      <!-- ① 基础信息 -->
      <div class="form-section">
        <div class="section-title">
          <span class="section-icon info">ℹ</span>
          基础信息
        </div>
        <div class="field-grid">
          <div class="field-group">
            <label>策略名称</label>
            <input v-model="form.name" class="field-input" placeholder="例：深夜节能模式" />
          </div>
          <div class="field-group">
            <label>策略组</label>
            <select v-model="form.group" class="field-select">
              <option v-for="g in groups" :key="g">{{ g }}</option>
            </select>
          </div>
          <div class="field-group">
            <label>生效开始时间</label>
            <div class="time-input-wrap">
              <input v-model="form.startTime" class="field-input" type="time" />
            </div>
          </div>
          <div class="field-group">
            <label>生效结束时间</label>
            <div class="time-input-wrap">
              <input v-model="form.endTime" class="field-input" type="time" />
            </div>
          </div>
        </div>
      </div>

      <!-- ② 触发条件 -->
      <div class="form-section">
        <div class="section-title">
          <span class="section-icon radio">((·))</span>
          触发条件 <span class="logic-tag">AND 逻辑</span>
        </div>

        <div v-for="item in conditionItems" :key="item.id"
             class="condition-card" :class="{ active: item.enabled }">
          <label class="condition-check">
            <input type="checkbox" v-model="item.enabled" class="real-checkbox" />
            <span class="checkbox-custom"></span>
          </label>
          <div class="condition-body">
            <div class="condition-name">{{ item.label }}</div>
            <div class="condition-desc">{{ item.desc }}</div>
          </div>
          <div class="condition-params" v-if="item.enabled && !item.isBoolean">
            <div class="param-field">
              <input v-model.number="item.value" class="param-input" type="number" min="0" />
              <span class="param-unit">{{ item.unit }}</span>
            </div>
          </div>
          <div class="condition-params" v-if="item.enabled && item.isBoolean">
            <span class="param-bool">{{ item.value === 1 ? '已启用（检测到人体时触发）' : '已启用' }}</span>
          </div>
          <button class="cond-remove-btn" @click="removeCondition(item.id)" title="移除此条件">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>

        <div class="add-condition-wrap">
          <button class="add-condition-btn" @click="showAddMenu = !showAddMenu">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            添加更多条件
          </button>
          <div class="add-condition-dropdown" v-if="showAddMenu">
            <div v-for="opt in unusedConditions()" :key="opt.key"
                 class="add-option" @click="addCondition(opt.key); showAddMenu = false">
              <div>
                <div class="add-option-label">{{ opt.label }}</div>
                <div class="add-option-desc">{{ opt.desc }}</div>
              </div>
              <span class="add-option-unit">{{ opt.unit || '布尔' }}</span>
            </div>
            <div v-if="unusedConditions().length === 0" class="add-option-empty">
              所有条件类型已添加
            </div>
          </div>
        </div>
      </div>

      <!-- ③ 动作执行 -->
      <div class="form-section">
        <div class="section-title">
          <span class="section-icon action">⚙</span>
          动作执行
        </div>
        <div class="action-body">
          <div class="action-left">
            <label class="action-check-item" style="margin-bottom:12px">
              <input type="checkbox" v-model="form.actions.controlEnabled" class="real-checkbox" />
              <span class="checkbox-custom"></span>
              下发照明控制指令
            </label>
            <template v-if="form.actions.controlEnabled">
            <div class="action-label-row">
              <span>目标亮度调节</span>
              <span class="brightness-pct">{{ form.actions.brightness }}%</span>
            </div>
            <input
              type="range" min="0" max="100" step="5"
              v-model="form.actions.brightness"
              class="brightness-slider"
              :style="{ '--val': form.actions.brightness + '%' }"
            />
            <div class="slider-marks">
              <span>0%（关闭）</span>
              <span>50%</span>
              <span>100%（全亮）</span>
            </div>
            </template>
          </div>

          <div class="action-right">
            <div class="action-sub-title">附加联动动作</div>
            <div class="action-checks">
              <!-- 语音播报 -->
              <label class="action-check-item">
                <input type="checkbox" v-model="form.actions.voiceAlert" class="real-checkbox" />
                <span class="checkbox-custom"></span>
                <svg class="ac-icon" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" stroke="currentColor" stroke-width="1.5"/><path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                开启语音播报提示
              </label>
              <div v-if="form.actions.voiceAlert" class="action-sub-field">
                <input v-model="form.actions.voiceContent" class="field-input" placeholder="自定义播报内容（留空使用默认文案）" />
              </div>

              <!-- 自动拍照 -->
              <label class="action-check-item">
                <input type="checkbox" v-model="form.actions.capturePhoto" class="real-checkbox" />
                <span class="checkbox-custom"></span>
                <svg class="ac-icon" viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/></svg>
                自动抓拍照片（策略触发时联动拍照）
              </label>

              <!-- 夜视红外 -->
              <label class="action-check-item">
                <input type="checkbox" v-model="form.actions.nightVision" class="real-checkbox" />
                <span class="checkbox-custom"></span>
                <svg class="ac-icon" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 20h20L12 2z" stroke="currentColor" stroke-width="1.5"/><path d="M12 9v5M12 17v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                切换监控摄像头至夜视红外模式
              </label>

              <!-- 自定义告警 -->
              <label class="action-check-item">
                <input type="checkbox" v-model="form.actions.generateAlert" class="real-checkbox" />
                <span class="checkbox-custom"></span>
                <svg class="ac-icon" viewBox="0 0 24 24" fill="none"><path d="M12 2L2 20h20L12 2z" stroke="currentColor" stroke-width="1.5"/><path d="M12 9v5M12 17v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                产生自定义告警记录
              </label>
              <div v-if="form.actions.generateAlert" class="action-sub-fields">
                <div class="alert-config-row">
                  <select v-model="form.actions.alertType" class="field-select" style="width:auto">
                    <option value="POLICY_ALERT">策略联动</option>
                    <option value="FAULT">故障</option>
                    <option value="OFFLINE">离线</option>
                    <option value="HEALTH_LOW">健康分过低</option>
                  </select>
                  <select v-model="form.actions.alertLevel" class="field-select" style="width:auto">
                    <option value="INFO">提示</option>
                    <option value="WARNING">警告</option>
                    <option value="MAJOR">严重</option>
                    <option value="CRITICAL">紧急</option>
                  </select>
                </div>
                <input v-model="form.actions.alertContent" class="field-input" placeholder="自定义告警内容（留空使用默认文案）" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 模拟测试弹窗 -->
    <ElDialog v-model="testVisible" title="策略模拟测试" width="500px" top="5vh">
      <div class="test-form">
        <div class="test-field"><label>光照强度 (Lux)</label><input v-model.number="testInput.illuminance" type="number" class="field-input" /></div>
        <div class="test-field"><label>温度 (°C)</label><input v-model.number="testInput.temperature" type="number" class="field-input" /></div>
        <div class="test-field"><label>湿度 (%)</label><input v-model.number="testInput.humidity" type="number" class="field-input" /></div>
        <div class="test-field"><label>人体红外 (0/1)</label><input v-model.number="testInput.pir" type="number" min="0" max="1" class="field-input" /></div>
        <div class="test-field"><label>车流量 (/min)</label><input v-model.number="testInput.trafficFlow" type="number" class="field-input" /></div>
        <div class="test-field"><label>模拟时间</label><input v-model="testInput.currentTime" type="time" class="field-input" /></div>
        <button class="search-btn" @click="runTest" :disabled="testLoading">{{ testLoading ? '测试中...' : '开始测试' }}</button>
      </div>
      <div v-if="testResult" class="test-result">
        <div v-if="testResult.matched" class="test-match">
          匹配成功！命中策略 <strong>{{ testResult.matchedPolicy }}</strong>，执行 {{ testResult.matchedAction }}
        </div>
        <div v-else-if="!hasAnyHit" class="test-nomatch">未匹配任何策略 — 当前条件不满足任何已启用策略</div>
        <div v-if="testResult.allResults?.length" class="test-all">
          <div v-for="r in testResult.allResults" :key="r.policyId" class="test-policy-row" :class="{ hit: r.hit }">
            <span>{{ r.hit ? '' : '' }} {{ r.policyName }}</span>
            <span class="test-tag">{{ r.hit ? '命中' : '未命中' }}</span>
          </div>
        </div>
      </div>
    </ElDialog>

    <!-- 保存按钮 -->
    <div class="footer-save">
      <button class="test-mode-btn" @click="testVisible = true">模拟测试</button>
      <button class="save-btn" :class="{ success: saveSuccess }" @click="saveStrategy" :disabled="saving">
        <svg v-if="!saveSuccess" viewBox="0 0 24 24" fill="none"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" stroke="currentColor" stroke-width="1.5"/><polyline points="17 21 17 13 7 13 7 21" stroke="currentColor" stroke-width="1.5"/><polyline points="7 3 7 8 15 8" stroke="currentColor" stroke-width="1.5"/></svg>
        <svg v-else viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        {{ saveSuccess ? '保存成功！' : saving ? '保存中...' : '保存策略配置' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.strategy-create-page { padding: 24px 28px 40px; max-width: 900px; color: #1d3148; }

.page-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 24px; }
.back-btn {
  width: 34px; height: 34px; margin-top: 4px;
  background: rgba(0,80,140,0.2); border: 1px solid rgba(0,120,200,0.25);
  border-radius: 7px; color: rgba(140,190,220,0.8);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.2s; flex-shrink: 0;
}
.back-btn:hover { color: #4dd0e1; border-color: rgba(77,208,225,0.4); }
.back-btn svg { width: 16px; height: 16px; }
.page-title { font-size: 22px; font-weight: 700; color: #e0f4ff; margin-bottom: 4px; }
.page-sub { font-size: 13px; color: rgba(140,190,220,0.6); }

/* Sections */
.form-section {
  background: rgba(8,20,45,0.8);
  border: 1px solid rgba(0,120,200,0.15);
  border-radius: 12px;
  padding: 20px 24px;
  margin-bottom: 14px;
}
.section-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 600; color: #4dd0e1;
  margin-bottom: 18px;
}
.section-icon { font-size: 14px; }
.logic-tag {
  font-size: 11px; font-weight: 400;
  background: rgba(77,208,225,0.12);
  border: 1px solid rgba(77,208,225,0.25);
  padding: 2px 8px; border-radius: 10px;
  color: rgba(77,208,225,0.8);
}

/* Field grid */
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.field-group { display: flex; flex-direction: column; gap: 6px; }
.field-group label { font-size: 12px; color: rgba(140,190,220,0.7); }
.field-input {
  height: 40px; padding: 0 12px;
  background: rgba(0,20,50,0.7);
  border: 1px solid rgba(0,100,160,0.3);
  border-radius: 7px; color: #d0eaf8;
  font-size: 13px; outline: none;
  transition: border-color 0.2s;
}
.field-input:focus { border-color: rgba(77,208,225,0.5); }
.field-input::placeholder { color: rgba(100,160,200,0.4); }
.field-select {
  height: 40px; padding: 0 12px;
  background: rgba(0,20,50,0.7);
  border: 1px solid rgba(0,100,160,0.3);
  border-radius: 7px; color: #d0eaf8;
  font-size: 13px; outline: none; cursor: pointer;
  appearance: auto;
}
.time-input-wrap { position: relative; }

/* Conditions */
.condition-card {
  display: flex; align-items: flex-start; gap: 12px;
  background: rgba(0,20,50,0.5);
  border: 1px solid rgba(0,80,140,0.2);
  border-radius: 8px; padding: 14px 16px;
  margin-bottom: 10px;
  transition: border-color 0.2s;
}
.condition-card.active { border-color: rgba(77,208,225,0.3); }
.condition-check { flex-shrink: 0; margin-top: 2px; }
.real-checkbox { display: none; }
.checkbox-custom {
  width: 16px; height: 16px;
  border: 1.5px solid rgba(0,120,180,0.6);
  border-radius: 3px;
  background: rgba(0,30,60,0.6);
  display: block; position: relative;
  transition: all 0.2s; cursor: pointer;
}
.real-checkbox:checked + .checkbox-custom {
  background: rgba(0,150,220,0.4);
  border-color: #4dd0e1;
}
.real-checkbox:checked + .checkbox-custom::after {
  content: '';
  position: absolute;
  left: 3px; top: 1px;
  width: 5px; height: 9px;
  border: 1.5px solid #4dd0e1;
  border-left: none; border-top: none;
  transform: rotate(45deg);
}
.condition-body { flex: 1; }
.condition-name { font-size: 13px; font-weight: 500; color: #d0eaf8; margin-bottom: 3px; }
.condition-desc { font-size: 11px; color: rgba(140,190,220,0.55); }
.condition-params { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.param-field { display: flex; align-items: center; gap: 4px; }
.param-input {
  width: 60px; height: 32px;
  background: rgba(0,30,70,0.8);
  border: 1px solid rgba(0,120,200,0.3);
  border-radius: 5px; color: #d0eaf8;
  font-size: 13px; text-align: center; outline: none;
  padding: 0 6px;
}
.param-unit { font-size: 11px; color: rgba(140,190,220,0.6); white-space: nowrap; }
.param-bool { font-size: 12px; color: rgba(77,208,225,0.7); }

.cond-remove-btn {
  width: 24px; height: 24px;
  background: none; border: 1px solid rgba(200,60,60,0.2);
  border-radius: 4px;
  color: rgba(200,100,100,0.6);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s; flex-shrink: 0; align-self: center;
}
.cond-remove-btn svg { width: 12px; height: 12px; }
.cond-remove-btn:hover { border-color: rgba(200,60,60,0.5); color: #ff7070; background: rgba(180,30,30,0.15); }

/* Add condition */
.add-condition-wrap { position: relative; }
.add-condition-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px;
  background: none;
  border: 1px dashed rgba(0,120,200,0.3);
  border-radius: 7px;
  color: rgba(77,208,225,0.7); font-size: 13px;
  cursor: pointer; transition: all 0.2s;
}
.add-condition-btn svg { width: 14px; height: 14px; }
.add-condition-btn:hover { border-color: rgba(77,208,225,0.5); color: #4dd0e1; background: rgba(0,120,200,0.06); }

.add-condition-dropdown {
  position: absolute; top: 100%; left: 0;
  margin-top: 4px;
  min-width: 280px;
  background: rgba(10,24,55,0.98);
  border: 1px solid rgba(0,120,200,0.3);
  border-radius: 8px;
  padding: 6px 0;
  z-index: 10;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}
.add-option {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 14px;
  cursor: pointer;
  transition: background 0.15s;
}
.add-option:hover { background: rgba(0,120,200,0.12); }
.add-option-label { font-size: 13px; color: #d0eaf8; }
.add-option-desc { font-size: 11px; color: rgba(140,190,220,0.5); }
.add-option-unit { font-size: 11px; color: rgba(77,208,225,0.6); flex-shrink: 0; margin-left: 12px; }
.add-option-empty { padding: 10px 14px; font-size: 12px; color: rgba(140,190,220,0.4); text-align: center; }

/* Actions */
.action-body { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.action-label-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 13px; color: rgba(160,210,235,0.8); }
.brightness-pct { font-size: 14px; font-weight: 700; color: #4dd0e1; }
.brightness-slider {
  width: 100%; height: 4px;
  -webkit-appearance: none; border-radius: 2px;
  background: linear-gradient(to right, #4dd0e1 0%, #4dd0e1 var(--val, 30%), rgba(0,80,140,0.4) var(--val, 30%));
  outline: none; cursor: pointer; accent-color: #4dd0e1;
  margin-bottom: 8px;
}
.brightness-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px; height: 16px; border-radius: 50%;
  background: #4dd0e1; box-shadow: 0 0 8px rgba(77,208,225,0.6); cursor: pointer;
}
.slider-marks { display: flex; justify-content: space-between; font-size: 11px; color: rgba(140,190,220,0.5); }

.action-sub-title { font-size: 12px; color: rgba(140,190,220,0.7); margin-bottom: 12px; }
.action-checks { display: flex; flex-direction: column; gap: 10px; }
.action-check-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px;
  background: rgba(0,20,50,0.5);
  border: 1px solid rgba(0,80,140,0.2);
  border-radius: 7px;
  cursor: pointer;
  transition: border-color 0.2s;
  font-size: 12px; color: rgba(160,210,235,0.8);
}
.action-check-item:has(.real-checkbox:checked) { border-color: rgba(77,208,225,0.3); }
.ac-icon { width: 15px; height: 15px; flex-shrink: 0; color: rgba(140,190,220,0.6); }

/* Save */
.footer-save {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
}
.test-mode-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  min-width: 112px;
  padding: 14px 28px;
  background: rgba(255, 255, 255, 0.86) !important;
  border: 1px solid rgba(0, 141, 230, 0.2) !important;
  border-radius: 10px !important;
  color: #006fc2 !important;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s;
  box-shadow: 0 10px 26px rgba(0, 106, 170, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.92) !important;
}
.test-mode-btn:hover {
  transform: translateY(-2px);
  background: #ffffff !important;
  border-color: rgba(0, 145, 215, 0.32) !important;
  color: #008de6 !important;
  box-shadow: 0 14px 34px rgba(0, 126, 206, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.95) !important;
}
.save-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 40px;
  background: linear-gradient(135deg, #0077cc, #0099e6);
  border: none; border-radius: 10px;
  color: #fff; font-size: 15px; font-weight: 600;
  cursor: pointer; transition: all 0.3s;
  box-shadow: 0 4px 20px rgba(0,150,230,0.4);
  letter-spacing: 1px;
}
.save-btn svg { width: 18px; height: 18px; }
.save-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 28px rgba(0,150,230,0.6); }
.save-btn.success { background: linear-gradient(135deg, #2e7d32, #43a047); box-shadow: 0 4px 20px rgba(76,175,80,0.4); }
.save-btn:disabled { opacity: 0.7; cursor: not-allowed; }

/* White sci-fi refresh for the strategy editor */
.strategy-create-page {
  color: #1d3148;
}

.page-header {
  margin-bottom: 24px;
}

.back-btn {
  width: 36px;
  height: 36px;
  margin-top: 3px;
  background: rgba(255, 255, 255, 0.92) !important;
  border: 1px solid rgba(0, 141, 230, 0.18) !important;
  border-radius: 8px;
  color: #006fc2 !important;
  box-shadow: 0 10px 24px rgba(30, 86, 130, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.95);
  transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s, color 0.2s;
}

.back-btn:hover {
  color: #008de6 !important;
  border-color: rgba(0, 141, 230, 0.34) !important;
  transform: translateY(-1px);
  box-shadow: 0 14px 30px rgba(0, 126, 206, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.95);
}

.page-title {
  color: #0d1b2d !important;
  font-weight: 900;
  letter-spacing: 0;
}

.page-sub {
  color: #40566f !important;
  font-weight: 600;
  line-height: 1.6;
}

.form-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-section {
  position: relative;
  overflow: visible;
  margin-bottom: 0;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 252, 255, 0.95)) !important;
  border: 1px solid rgba(0, 141, 230, 0.16) !important;
  border-radius: 10px;
  box-shadow: 0 16px 38px rgba(30, 86, 130, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.95) !important;
}

.form-section::before {
  content: "";
  position: absolute;
  top: 0;
  left: 24px;
  right: 24px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 141, 230, 0.42), rgba(23, 201, 223, 0.34), transparent);
  pointer-events: none;
}

.section-title {
  color: #0d1b2d !important;
  font-weight: 900;
}

.section-icon {
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  color: #006fc2;
  background: linear-gradient(135deg, rgba(0, 141, 230, 0.1), rgba(23, 201, 223, 0.13));
  border: 1px solid rgba(0, 141, 230, 0.18);
  font-size: 13px;
  font-weight: 900;
}

.logic-tag {
  background: rgba(0, 141, 230, 0.09) !important;
  border: 1px solid rgba(0, 141, 230, 0.22) !important;
  border-radius: 999px;
  color: #006fc2 !important;
  font-weight: 800;
}

.field-group label,
.test-field label {
  color: #40566f !important;
  font-weight: 800;
}

.field-input,
.field-select,
.param-input {
  background: rgba(255, 255, 255, 0.96) !important;
  border: 1px solid rgba(0, 141, 230, 0.18) !important;
  color: #0d1b2d !important;
  font-weight: 650;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 8px 18px rgba(30, 86, 130, 0.05);
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
  box-sizing: border-box;
}

.field-input:focus,
.field-select:focus,
.param-input:focus {
  background: #ffffff !important;
  border-color: rgba(0, 141, 230, 0.42) !important;
  box-shadow: 0 0 0 3px rgba(0, 141, 230, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.95);
}

.field-input::placeholder {
  color: #7990a7 !important;
  font-weight: 600;
}

.condition-card {
  background: rgba(255, 255, 255, 0.86) !important;
  border: 1px solid rgba(0, 141, 230, 0.14) !important;
  border-radius: 9px;
  transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s, background 0.2s;
}

.condition-card:hover {
  transform: translateY(-1px);
  border-color: rgba(0, 141, 230, 0.28) !important;
  box-shadow: 0 12px 26px rgba(30, 86, 130, 0.09);
}

.condition-card.active {
  background: linear-gradient(180deg, rgba(245, 252, 255, 0.98), rgba(255, 255, 255, 0.94)) !important;
  border-color: rgba(0, 141, 230, 0.3) !important;
  box-shadow: 0 12px 26px rgba(0, 126, 206, 0.1), inset 3px 0 0 rgba(0, 141, 230, 0.54);
}

.checkbox-custom {
  border: 1.5px solid rgba(0, 141, 230, 0.42) !important;
  border-radius: 4px;
  background: #ffffff !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.95), 0 3px 8px rgba(30, 86, 130, 0.08);
}

.real-checkbox:checked + .checkbox-custom {
  background: linear-gradient(135deg, #008de6, #17c9df) !important;
  border-color: rgba(0, 141, 230, 0.78) !important;
  box-shadow: 0 0 0 3px rgba(0, 141, 230, 0.12), 0 6px 14px rgba(0, 126, 206, 0.18);
}

.real-checkbox:checked + .checkbox-custom::after {
  left: 4px;
  top: 1px;
  width: 5px;
  height: 9px;
  border: 2px solid #ffffff;
  border-left: none;
  border-top: none;
}

.condition-body {
  min-width: 0;
}

.condition-name {
  color: #10243b !important;
  font-weight: 850;
}

.condition-desc {
  color: #506780 !important;
  font-weight: 650;
  line-height: 1.5;
}

.param-input {
  width: 68px;
  border-radius: 7px;
  font-weight: 800;
}

.param-unit {
  color: #40566f !important;
  font-weight: 750;
}

.param-bool {
  color: #006fc2 !important;
  font-weight: 800;
}

.cond-remove-btn {
  width: 26px;
  height: 26px;
  background: rgba(255, 255, 255, 0.8) !important;
  border: 1px solid rgba(229, 72, 77, 0.22) !important;
  border-radius: 6px;
  color: #c62f36 !important;
  transition: transform 0.2s, border-color 0.2s, background 0.2s, color 0.2s;
}

.cond-remove-btn:hover {
  border-color: rgba(229, 72, 77, 0.38) !important;
  color: #e5484d !important;
  background: rgba(229, 72, 77, 0.08) !important;
  transform: translateY(-1px);
}

.add-condition-btn {
  background: rgba(255, 255, 255, 0.82) !important;
  border: 1px dashed rgba(0, 141, 230, 0.34) !important;
  border-radius: 8px;
  color: #006fc2 !important;
  font-weight: 800;
  transition: transform 0.2s, border-color 0.2s, background 0.2s, color 0.2s;
}

.add-condition-btn:hover {
  border-color: rgba(0, 141, 230, 0.52) !important;
  color: #008de6 !important;
  background: rgba(0, 141, 230, 0.08) !important;
  transform: translateY(-1px);
}

.add-condition-dropdown {
  min-width: 340px;
  max-width: min(520px, calc(100vw - 80px));
  background: rgba(255, 255, 255, 0.98) !important;
  border: 1px solid rgba(0, 141, 230, 0.22) !important;
  border-radius: 10px;
  padding: 6px;
  box-shadow: 0 18px 44px rgba(30, 86, 130, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.95) !important;
  backdrop-filter: blur(14px) saturate(1.1);
}

.add-option {
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  transition: background 0.15s, transform 0.15s;
}

.add-option:hover {
  background: rgba(0, 141, 230, 0.08) !important;
  transform: translateX(2px);
}

.add-option-label {
  color: #0d1b2d !important;
  font-weight: 850;
}

.add-option-desc {
  margin-top: 2px;
  color: #506780 !important;
  font-weight: 650;
  line-height: 1.45;
}

.add-option-unit {
  color: #006fc2 !important;
  font-weight: 850;
  background: rgba(0, 141, 230, 0.08);
  border: 1px solid rgba(0, 141, 230, 0.16);
  border-radius: 999px;
  padding: 2px 8px;
}

.add-option-empty {
  color: #60748a !important;
  font-weight: 700;
}

.action-body {
  gap: 20px;
}

.action-left,
.action-right {
  min-width: 0;
  padding: 14px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(0, 141, 230, 0.12);
}

.action-label-row {
  color: #40566f !important;
  font-weight: 800;
}

.brightness-pct {
  color: #008de6 !important;
  font-size: 15px;
  font-weight: 900;
}

.brightness-slider {
  height: 6px;
  border-radius: 999px;
  background: linear-gradient(to right, #008de6 0%, #17c9df var(--val, 30%), rgba(96, 116, 138, 0.18) var(--val, 30%)) !important;
  box-shadow: inset 0 1px 2px rgba(30, 86, 130, 0.1);
}

.brightness-slider::-webkit-slider-thumb {
  width: 18px;
  height: 18px;
  background: #ffffff;
  border: 4px solid #008de6;
  box-shadow: 0 0 0 4px rgba(0, 141, 230, 0.1), 0 8px 16px rgba(0, 126, 206, 0.22);
}

.brightness-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: #ffffff;
  border: 4px solid #008de6;
  box-shadow: 0 0 0 4px rgba(0, 141, 230, 0.1), 0 8px 16px rgba(0, 126, 206, 0.22);
}

.slider-marks {
  color: #60748a !important;
  font-weight: 700;
}

.action-sub-title {
  color: #40566f !important;
  font-weight: 850;
}

.action-check-item {
  background: rgba(255, 255, 255, 0.9) !important;
  border: 1px solid rgba(0, 141, 230, 0.14) !important;
  border-radius: 8px;
  color: #1d3148 !important;
  font-weight: 750;
  line-height: 1.5;
  transition: transform 0.2s, border-color 0.2s, background 0.2s, box-shadow 0.2s;
}

.action-check-item:hover {
  transform: translateY(-1px);
  border-color: rgba(0, 141, 230, 0.28) !important;
  box-shadow: 0 10px 22px rgba(30, 86, 130, 0.08);
}

.action-check-item:has(.real-checkbox:checked) {
  background: linear-gradient(180deg, rgba(244, 252, 255, 0.98), rgba(255, 255, 255, 0.94)) !important;
  border-color: rgba(0, 141, 230, 0.32) !important;
}

.ac-icon {
  color: #006fc2 !important;
}

/* 附加联动子字段 */
.action-sub-field { margin-top: 2px; padding-left: 28px; }
.action-sub-field .field-input {
  width: 100%; padding: 6px 10px; border: 1px solid rgba(0,141,230,0.2); border-radius: 6px;
  font-size: 12px; color: #1d3148; background: #fff; outline: none;
}
.action-sub-field .field-input:focus { border-color: rgba(0,141,230,0.4); }
.action-sub-fields { margin-top: 4px; padding-left: 28px; display: flex; flex-direction: column; gap: 6px; }
.alert-config-row { display: flex; gap: 8px; }
.alert-config-row .field-select {
  padding: 4px 8px; border: 1px solid rgba(0,141,230,0.2); border-radius: 6px;
  font-size: 12px; color: #1d3148; background: #fff; outline: none; cursor: pointer;
}
.action-sub-fields .field-input {
  width: 100%; padding: 6px 10px; border: 1px solid rgba(0,141,230,0.2); border-radius: 6px;
  font-size: 12px; color: #1d3148; background: #fff; outline: none;
}
.action-sub-fields .field-input:focus { border-color: rgba(0,141,230,0.4); }

.test-mode-btn {
  color: #006fc2 !important;
  font-weight: 850;
}

.save-btn {
  background: linear-gradient(135deg, #0077cc, #0099e6 60%, #17c9df) !important;
  font-weight: 850;
  letter-spacing: 0;
  box-shadow: 0 14px 32px rgba(0, 150, 230, 0.28) !important;
}

.save-btn:hover:not(:disabled) {
  box-shadow: 0 18px 42px rgba(0, 150, 230, 0.36) !important;
  filter: saturate(1.05);
}

.save-btn.success {
  background: linear-gradient(135deg, #149664, #35b86f) !important;
  box-shadow: 0 14px 32px rgba(53, 184, 111, 0.24) !important;
}

.test-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.test-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.test-form .search-btn {
  grid-column: 1 / -1;
  min-height: 40px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #0077cc, #17c9df);
  color: #ffffff;
  font-size: 14px;
  font-weight: 850;
  cursor: pointer;
  box-shadow: 0 12px 28px rgba(0, 150, 230, 0.22);
}

.test-form .search-btn:disabled {
  opacity: 0.72;
  cursor: not-allowed;
}

.test-result {
  margin-top: 14px;
  border-radius: 9px;
  border: 1px solid rgba(0, 141, 230, 0.16);
  background: rgba(247, 252, 255, 0.9);
  padding: 12px;
  color: #1d3148;
  font-size: 13px;
  font-weight: 700;
}

.test-match {
  color: #0d8b62;
}

.test-nomatch {
  color: #c62f36;
}

.test-all {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.test-policy-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 7px;
  background: #ffffff;
  border: 1px solid rgba(96, 116, 138, 0.14);
  color: #40566f;
}

.test-policy-row.hit {
  border-color: rgba(16, 185, 129, 0.24);
  color: #0d8b62;
  background: rgba(16, 185, 129, 0.06);
}

.test-tag {
  flex-shrink: 0;
  color: #006fc2;
  font-weight: 850;
}

:deep(.el-dialog) {
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 252, 255, 0.96));
  border: 1px solid rgba(0, 141, 230, 0.18);
  box-shadow: 0 24px 64px rgba(30, 86, 130, 0.22);
  overflow: hidden;
}

:deep(.el-dialog__header) {
  padding: 18px 22px 12px;
  border-bottom: 1px solid rgba(0, 141, 230, 0.12);
}

:deep(.el-dialog__title) {
  color: #0d1b2d;
  font-weight: 900;
}

:deep(.el-dialog__body) {
  padding: 18px 22px 22px;
}

@media (max-width: 760px) {
  .strategy-create-page {
    padding: 18px 16px 32px;
  }

  .field-grid,
  .action-body,
  .test-form {
    grid-template-columns: 1fr;
  }

  .condition-card {
    flex-wrap: wrap;
  }

  .condition-params {
    width: 100%;
    padding-left: 28px;
  }

  .add-condition-dropdown {
    min-width: 0;
    width: calc(100vw - 48px);
  }

  .footer-save {
    flex-wrap: wrap;
  }
}
</style>
