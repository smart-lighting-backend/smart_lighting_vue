<script setup>
import { ref, onMounted, computed } from 'vue'
import { getSystemLogs } from '../api/log.js'
import { ElMessage, ElNotification } from 'element-plus'

const logs = ref([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const size = ref(20)

// ── 筛选条件 ──────────────────────────────────────────────────────────────
const filters = ref({
  operator: '',
  action: '',
  targetType: '',
  result: '',
  dateFrom: null,
  dateTo: null,
})

const actionOptions = [
  { label: '全部操作', value: '' },
  { label: 'LOGIN — 登录', value: 'LOGIN' },
  { label: 'DEVICE_CREATE — 新增设备', value: 'DEVICE_CREATE' },
  { label: 'DEVICE_UPDATE — 更新设备', value: 'DEVICE_UPDATE' },
  { label: 'DEVICE_DELETE — 删除设备', value: 'DEVICE_DELETE' },
  { label: 'CONTROL — 设备控制', value: 'CONTROL' },
  { label: 'THRESHOLD_SET — 阈值设置', value: 'THRESHOLD_SET' },
  { label: 'POLICY_CREATE — 新增策略', value: 'POLICY_CREATE' },
  { label: 'POLICY_TOGGLE — 策略启停', value: 'POLICY_TOGGLE' },
  { label: 'ALARM_CREATE — 新增告警', value: 'ALARM_CREATE' },
  { label: 'ALARM_HANDLE — 处理告警', value: 'ALARM_HANDLE' },
  { label: 'USER_CREATE — 新增用户', value: 'USER_CREATE' },
  { label: 'USER_UPDATE — 更新用户', value: 'USER_UPDATE' },
  { label: 'ROLE_CREATE — 新增角色', value: 'ROLE_CREATE' },
  { label: 'ROLE_PERMISSION — 分配权限', value: 'ROLE_PERMISSION' },
  { label: 'PERM_CREATE — 新增权限', value: 'PERM_CREATE' },
  { label: 'PERM_DELETE — 删除权限', value: 'PERM_DELETE' },
]

const targetOptions = [
  { label: '全部类型', value: '' },
  { label: 'SYSTEM — 系统', value: 'SYSTEM' },
  { label: 'DEVICE — 设备', value: 'DEVICE' },
  { label: 'POLICY — 策略', value: 'POLICY' },
  { label: 'THRESHOLD — 阈值', value: 'THRESHOLD' },
  { label: 'ALARM — 告警', value: 'ALARM' },
  { label: 'USER — 用户', value: 'USER' },
  { label: 'ROLE — 角色', value: 'ROLE' },
  { label: 'PERMISSION — 权限', value: 'PERMISSION' },
]

const resultOptions = [
  { label: '全部结果', value: '' },
  { label: 'SUCCESS — 成功', value: 'SUCCESS' },
  { label: 'FAIL — 失败', value: 'FAIL' },
]

const levelFilter = ref('全部')
const levels = ['全部', 'info', 'warn', 'error']
const levelLabels = { info: '信息', warn: '警告', error: '错误' }

const loadLogs = async () => {
  loading.value = true
  try {
    const f = filters.value
    const res = await getSystemLogs(page.value, size.value, {
      operator: f.operator || undefined,
      action: f.action || undefined,
      targetType: f.targetType || undefined,
      result: f.result || undefined,
      dateFrom: f.dateFrom ? new Date(f.dateFrom).toISOString() : undefined,
      dateTo: f.dateTo ? new Date(f.dateTo).toISOString() : undefined,
    })
    if (res.code === 200) {
      logs.value = res.data.list
      total.value = res.data.total
    } else {
      ElNotification.error({ title: '获取日志失败', message: res.message || '未知错误' })
    }
  } catch (e) {
    ElNotification.error({ title: '加载失败', message: e.message || e })
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  page.value = 1
  loadLogs()
}

const handleReset = () => {
  filters.value = { operator: '', action: '', targetType: '', result: '', dateFrom: null, dateTo: null }
  page.value = 1
  loadLogs()
}

const handlePageChange = (p) => {
  page.value = p
  loadLogs()
}

const handleSizeChange = (s) => {
  size.value = s
  page.value = 1
  loadLogs()
}

const filtered = computed(() =>
  levelFilter.value === '全部'
    ? logs.value
    : logs.value.filter(l => l.level === levelFilter.value)
)

onMounted(() => {
  loadLogs()
})
</script>

<template>
  <div class="log-page">
    <div class="page-header">
      <div>
        <h1 class="page-title">系统日志</h1>
        <p class="page-sub">记录所有系统操作、事件触发与告警记录</p>
      </div>
      <div class="level-tabs">
        <button
          v-for="l in levels"
          :key="l"
          class="level-tab"
          :class="{ active: levelFilter === l }"
          @click="levelFilter = l"
        >
          {{ l === '全部' ? '全部' : levelLabels[l] }}
        </button>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <div class="filter-row">
        <div class="filter-item">
          <label>操作人</label>
          <input
            v-model="filters.operator"
            placeholder="输入操作人"
            class="filter-input"
            @keyup.enter="handleSearch"
          />
        </div>
        <div class="filter-item">
          <label>操作类型</label>
          <select v-model="filters.action" class="filter-select">
            <option v-for="opt in actionOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="filter-item">
          <label>目标类型</label>
          <select v-model="filters.targetType" class="filter-select">
            <option v-for="opt in targetOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="filter-item">
          <label>结果</label>
          <select v-model="filters.result" class="filter-select">
            <option v-for="opt in resultOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <div class="filter-item">
          <label>开始时间</label>
          <input
            v-model="filters.dateFrom"
            type="datetime-local"
            class="filter-input"
          />
        </div>
        <div class="filter-item">
          <label>结束时间</label>
          <input
            v-model="filters.dateTo"
            type="datetime-local"
            class="filter-input"
          />
        </div>
        <div class="filter-actions">
          <button class="btn-search" @click="handleSearch">查询</button>
          <button class="btn-reset" @click="handleReset">重置</button>
        </div>
      </div>
    </div>

    <!-- 日志列表 -->
    <div class="log-card">
      <div v-if="loading" class="loading-state">加载中...</div>
      <div v-else-if="filtered.length === 0" class="empty-state">
        <div class="empty-icon">📋</div>
        <p>暂无系统日志</p>
        <p class="empty-hint">当前筛选条件下没有操作记录，请调整筛选条件或等待更多操作产生日志</p>
      </div>
      <div v-else class="log-list">
        <div v-for="log in filtered" :key="log.id" class="log-row" :class="log.level">
          <span class="log-level-badge" :class="log.level">{{ levelLabels[log.level] || log.level }}</span>
          <span class="log-time">{{ log.time }}</span>
          <span class="log-user">{{ log.user }}</span>
          <span class="log-action">{{ log.action }}</span>
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="total > size" class="pagination-bar">
      <div class="page-info">共 {{ total }} 条记录</div>
      <div class="page-controls">
        <button
          class="page-btn"
          :disabled="page <= 1"
          @click="handlePageChange(page - 1)"
        >
          上一页
        </button>
        <span class="page-num">{{ page }}</span>
        <button
          class="page-btn"
          :disabled="page >= Math.ceil(total / size)"
          @click="handlePageChange(page + 1)"
        >
          下一页
        </button>
        <select class="page-size" :value="size" @change="e => handleSizeChange(Number(e.target.value))">
          <option :value="10">10条/页</option>
          <option :value="20">20条/页</option>
          <option :value="50">50条/页</option>
          <option :value="100">100条/页</option>
        </select>
      </div>
    </div>
  </div>
</template>

<style scoped>
.log-page {
  padding: 24px 28px;
  color: #1d3148;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 20px;
}
.page-title {
  font-size: 22px;
  font-weight: 800;
  color: #0d1b2d;
  margin: 0 0 4px;
  letter-spacing: 0;
}
.page-sub {
  font-size: 13px;
  color: #40566f;
  margin: 0;
  font-weight: 600;
}
.level-tabs {
  display: flex;
  gap: 6px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(0, 141, 230, 0.14);
  border-radius: 8px;
  box-shadow: 0 10px 26px rgba(14, 70, 120, 0.08);
}
.level-tab {
  padding: 7px 16px;
  background: rgba(247, 251, 255, 0.95);
  border: 1px solid rgba(0, 141, 230, 0.14);
  border-radius: 6px;
  color: #31516f;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}
.level-tab:hover {
  color: #006fc2;
  border-color: rgba(0, 141, 230, 0.28);
  background: rgba(232, 246, 255, 0.92);
}
.level-tab.active {
  background: linear-gradient(135deg, rgba(0, 141, 230, 0.14), rgba(56, 189, 248, 0.14));
  border-color: rgba(0, 141, 230, 0.34);
  color: #006fc2;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.72);
}

/* 筛选栏 */
.filter-bar {
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(243, 250, 255, 0.92)),
    linear-gradient(90deg, rgba(0, 141, 230, 0.08), transparent);
  border: 1px solid rgba(0, 141, 230, 0.18);
  border-radius: 8px;
  padding: 16px 18px;
  margin-bottom: 16px;
  box-shadow: 0 16px 34px rgba(14, 70, 120, 0.10);
}
.filter-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.filter-item { display: flex; flex-direction: column; gap: 5px; }
.filter-item label {
  font-size: 12px;
  color: #31516f;
  font-weight: 700;
}
.filter-input, .filter-select {
  padding: 7px 11px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(0, 141, 230, 0.20);
  border-radius: 6px;
  color: #1d3148;
  font-size: 13px;
  font-weight: 600;
  outline: none;
  min-width: 130px;
  box-shadow: 0 0 0 1px rgba(0, 141, 230, 0.04) inset;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
}
.filter-input::placeholder {
  color: #6f8194;
  font-weight: 500;
}
.filter-input:focus, .filter-select:focus {
  border-color: rgba(0, 141, 230, 0.48);
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(0, 141, 230, 0.12);
}
.filter-select option { background: #ffffff; color: #1d3148; }
.filter-actions { display: flex; gap: 8px; align-items: flex-end; padding-bottom: 1px; }
.btn-search, .btn-reset {
  padding: 8px 18px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  border: none;
  transition: all 0.18s ease;
}
.btn-search {
  background: linear-gradient(135deg, #21c8dc, #008de6);
  border: 1px solid rgba(0, 141, 230, 0.24);
  color: #ffffff;
  box-shadow: 0 8px 18px rgba(0, 141, 230, 0.22);
}
.btn-search:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 22px rgba(0, 141, 230, 0.28);
}
.btn-reset {
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(0, 141, 230, 0.18);
  color: #31516f;
}
.btn-reset:hover {
  background: rgba(232, 246, 255, 0.95);
  border-color: rgba(0, 141, 230, 0.34);
  color: #006fc2;
}

/* 日志卡片 */
.log-card {
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(0, 141, 230, 0.16);
  border-radius: 8px;
  overflow: hidden;
  min-height: 200px;
  box-shadow: 0 18px 42px rgba(14, 70, 120, 0.10);
}
.log-list { display: flex; flex-direction: column; }
.log-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 13px 18px;
  border-bottom: 1px solid rgba(16, 126, 196, 0.10);
  transition: background 0.15s ease, box-shadow 0.15s ease;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.90);
}
.log-row:nth-child(even) {
  background: rgba(247, 251, 255, 0.82);
}
.log-row:last-child { border-bottom: none; }
.log-row:hover {
  background: rgba(232, 246, 255, 0.92);
  box-shadow: inset 3px 0 0 #008de6;
}
.log-level-badge {
  padding: 2px 9px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 800;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.35;
}
.log-level-badge.info  {
  background: rgba(16, 185, 129, 0.10);
  border: 1px solid rgba(16, 185, 129, 0.24);
  color: #087f5b;
}
.log-level-badge.warn  {
  background: rgba(245, 158, 11, 0.13);
  border: 1px solid rgba(245, 158, 11, 0.28);
  color: #a16207;
}
.log-level-badge.error {
  background: rgba(239, 68, 68, 0.10);
  border: 1px solid rgba(239, 68, 68, 0.24);
  color: #c92a2a;
}
.log-time {
  font-size: 12px;
  color: #4b6883;
  white-space: nowrap;
  flex-shrink: 0;
  font-family: monospace;
  font-weight: 700;
}
.log-user {
  min-width: 72px;
  font-size: 12px;
  color: #006fc2;
  flex-shrink: 0;
  font-weight: 800;
}
.log-action {
  color: #1d3148;
  flex: 1;
  line-height: 1.45;
  font-weight: 600;
  word-break: break-word;
}
.log-row.error .log-action { color: #9b1c1c; }
.log-row.warn .log-action { color: #7c4a03; }

/* 加载 & 空状态 */
.loading-state, .empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #40566f;
}
.empty-icon { font-size: 48px; margin-bottom: 12px; }
.empty-state p { margin: 4px 0; font-size: 14px; font-weight: 700; }
.empty-hint { font-size: 12px !important; color: #60748a; font-weight: 500 !important; }

/* 分页 */
.pagination-bar { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; padding: 0 4px; }
.page-info { font-size: 12px; color: #40566f; font-weight: 700; }
.page-controls { display: flex; align-items: center; gap: 8px; }
.page-btn {
  padding: 6px 13px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(0, 141, 230, 0.18);
  border-radius: 6px;
  color: #31516f;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}
.page-btn:hover:not(:disabled) {
  background: rgba(232, 246, 255, 0.95);
  border-color: rgba(0, 141, 230, 0.34);
  color: #006fc2;
}
.page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.page-num { color: #006fc2; font-size: 13px; min-width: 24px; text-align: center; font-weight: 800; }
.page-size {
  padding: 6px 9px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(0, 141, 230, 0.18);
  border-radius: 6px;
  color: #31516f;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  outline: none;
}
.page-size option { background: #ffffff; color: #1d3148; }

@media (max-width: 900px) {
  .page-header {
    flex-direction: column;
    align-items: stretch;
  }
  .level-tabs {
    align-self: flex-start;
    flex-wrap: wrap;
  }
  .log-row {
    gap: 10px;
    padding: 12px;
  }
  .log-time {
    white-space: normal;
  }
}
</style>
