<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { fetchStrategyList, fetchStrategyHistory, toggleStrategy, deleteStrategy } from '../api/strategy.js'
import { ElForm, ElFormItem, ElInput, ElSelect, ElOption, ElInputNumber, ElButton, ElPagination, ElIcon, ElMessage, ElMessageBox, ElDialog, ElNotification } from 'element-plus'
import { Search, Refresh, Timer } from '@element-plus/icons-vue'
import { useUserInfo } from '../composables/useUserInfo.js'

const { hasPerm } = useUserInfo()

const router = useRouter()
const strategies = ref([])
const loading = ref(false)
const historyVisible = ref(false)
const historyLoading = ref(false)
const historyData = ref(null)
const historyPolicyName = ref('')

async function showHistory(s) {
  historyPolicyName.value = s.name
  historyVisible.value = true
  historyLoading.value = true
  try {
    const res = await fetchStrategyHistory(s.id, 7)
    historyData.value = res?.data || null
  } catch { historyData.value = null }
  historyLoading.value = false
}

const searchForm = ref({
  name: '',
  policyType: '',
  enabled: null,
  priorityMin: null,
  priorityMax: null,
  effectiveTime: ''
})
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)

async function loadData() {
  loading.value = true
  const query = {
    page: currentPage.value,
    size: pageSize.value,
    name: searchForm.value.name || undefined,
    policyType: searchForm.value.policyType || undefined,
    enabled: searchForm.value.enabled !== null ? searchForm.value.enabled : undefined,
    priorityMin: searchForm.value.priorityMin !== null ? searchForm.value.priorityMin : undefined,
    priorityMax: searchForm.value.priorityMax !== null ? searchForm.value.priorityMax : undefined,
    effectiveTime: searchForm.value.effectiveTime || undefined,
  }
  
  try {
    const res = await fetchStrategyList(query)
    if (res && res.data) {
      const list = Array.isArray(res.data) ? res.data : (res.data.records || res.data.list || [])
      strategies.value = list.map(item => {
        let group = '--', startTime = '--', endTime = '--'
        if (item.conditions && typeof item.conditions === 'string') {
          try {
            const cond = JSON.parse(item.conditions)
            if (cond.group) group = cond.group
            if (cond.startTime) startTime = cond.startTime
            if (cond.endTime) endTime = cond.endTime
          } catch (e) {}
        }
        return {
          ...item,
          group,
          startTime,
          endTime,
          lastTrigger: item.lastTriggerTime || item.lastTrigger || '--',
          triggerCount: item.triggerCount || 0
        }
      })
      total.value = Array.isArray(res.data) ? res.data.length : (res.data.total || 0)
    } else {
      strategies.value = Array.isArray(res) ? res : []
    }
  } catch (error) {
    ElMessage.error(error?.message || '加载策略列表失败')
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  currentPage.value = 1
  loadData()
}

function handleReset() {
  searchForm.value = {
    name: '', policyType: '', enabled: null, priorityMin: null, priorityMax: null, effectiveTime: ''
  }
  handleSearch()
}

onMounted(loadData)

async function toggle(s) {
  s.enabled = !s.enabled
  await toggleStrategy(s.id, s.enabled)
}
async function remove(s) {
  try {
    await ElMessageBox.confirm(`确认删除策略"${s.name}"？此操作不可恢复。`, '删除确认', {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await deleteStrategy(s.id)
    ElNotification.success({ title: '删除成功', message: `策略"${s.name}"已删除` })
    await loadData()
  } catch (err) {
    if (err !== 'cancel') ElNotification.error({ title: '删除失败', message: err?.message || '' })
  }
}
</script>

<template>
  <div class="strategy-page">
    <div class="page-header">
      <div>
        <h1 class="page-title">策略配置</h1>
        <p class="page-sub">管理路灯自动调节规则，基于环境感知与时间调度</p>
      </div>
      <button v-if="hasPerm('policy:create')" class="create-btn" @click="router.push('/strategy/create')">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        新建策略
      </button>
    </div>

    <!-- 搜索表单 -->
    <div class="search-bar">
      <ElForm :inline="true" :model="searchForm" class="search-form">
        <ElFormItem label="名称">
          <ElInput v-model="searchForm.name" placeholder="模糊查询" clearable style="width: 140px" />
        </ElFormItem>
        <ElFormItem label="类型">
          <ElSelect v-model="searchForm.policyType" placeholder="全部" clearable style="width: 120px">
            <ElOption label="时间(TIME)" value="TIME" />
            <ElOption label="传感(SENSOR)" value="SENSOR" />
            <ElOption label="场景(SCENE)" value="SCENE" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="状态">
          <ElSelect v-model="searchForm.enabled" placeholder="全部" clearable style="width: 100px">
            <ElOption label="已启用" :value="true" />
            <ElOption label="已停用" :value="false" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="优先级">
          <ElInputNumber v-model="searchForm.priorityMin" :min="1" :max="100" placeholder="最小" style="width: 80px" :controls="false" />
          <span style="margin: 0 8px; color: #40566f; font-weight: 700">-</span>
          <ElInputNumber v-model="searchForm.priorityMax" :min="1" :max="100" placeholder="最大" style="width: 80px" :controls="false" />
        </ElFormItem>
        <ElFormItem label="时段">
          <ElInput v-model="searchForm.effectiveTime" placeholder="如: 22:00" clearable style="width: 120px" />
        </ElFormItem>
        <ElFormItem>
          <ElButton type="primary" @click="handleSearch"><ElIcon><Search /></ElIcon>&nbsp;查询</ElButton>
          <ElButton @click="handleReset"><ElIcon><Refresh /></ElIcon>&nbsp;重置</ElButton>
        </ElFormItem>
      </ElForm>
    </div>

    <div class="strategy-list">
      <div v-if="loading" class="loading-state">加载中...</div>
      <div v-for="s in strategies" :key="s.id" class="strategy-card">
        <div class="sc-left">
          <div class="sc-name">{{ s.name }}</div>
          <div class="sc-meta">
            <span class="sc-tag">{{ s.group }}</span>
            <span class="sc-time">{{ s.startTime }} — {{ s.endTime }}</span>
          </div>
          <div class="sc-stats">
            触发次数：<strong>{{ s.triggerCount }}</strong> &nbsp;·&nbsp;
            最近触发：{{ s.lastTrigger }}
          </div>
        </div>
        <div class="sc-right">
          <div class="toggle-wrap">
            <span class="toggle-label" :class="s.enabled ? 'active' : 'inactive'">{{ s.enabled ? '启用' : '停用' }}</span>
            <div class="toggle-switch" :class="{ on: s.enabled }" @click="toggle(s)">
              <div class="toggle-thumb"></div>
            </div>
          </div>
          <button class="sc-btn hist" @click="showHistory(s)">历史</button>
          <button v-if="hasPerm('policy:update')" class="sc-btn edit" @click="router.push('/strategy/edit/' + s.id)">编辑</button>
          <button v-if="hasPerm('policy:delete')" class="sc-btn del" @click="remove(s)">删除</button>
        </div>
      </div>
    </div>
    
    <!-- 执行历史弹窗 -->
    <ElDialog v-model="historyVisible" :title="'执行历史 — ' + historyPolicyName" width="700px" top="5vh">
      <div v-if="historyLoading" class="loading-state">加载中...</div>
      <div v-else-if="historyData">
        <div class="history-summary">近7天共触发 <strong>{{ historyData.totalTriggers }}</strong> 次</div>
        <div class="history-list" v-if="historyData.records?.length">
          <div v-for="(r, i) in historyData.records.slice(0, 30)" :key="i" class="history-item">
            <span class="hi-time">{{ r.createTime }}</span>
            <span class="hi-device">{{ r.deviceId }}</span>
            <span class="hi-action">{{ r.actionTaken }}</span>
          </div>
        </div>
        <div v-else class="empty-hint">暂无执行记录 — 可能还没有遥测数据触发该策略，或策略条件尚未满足</div>
      </div>
    </ElDialog>

    <!-- 分页 -->
    <div class="pagination-wrapper" v-if="total > 0">
      <ElPagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[10, 20, 50]"
        background
        layout="total, sizes, prev, pager, next, jumper"
        :total="total"
        @size-change="loadData"
        @current-change="loadData"
      />
    </div>
  </div>
</template>

<style scoped>
.strategy-page { padding: 24px 28px; color: #1d3148; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px; }
.search-bar {
  background: rgba(255,255,255,0.94) !important;
  border: 1px solid rgba(0,141,230,0.16) !important;
  border-radius: 8px;
  padding: 16px 20px 0 20px;
  margin-bottom: 16px;
  box-shadow: 0 18px 40px rgba(30,86,130,0.1), inset 0 1px 0 rgba(255,255,255,0.92) !important;
  backdrop-filter: blur(16px) saturate(1.12);
}
.search-form :deep(.el-form-item__label) { color: #1d3148 !important; font-weight: 700; }
.search-form :deep(.el-input__inner),
.search-form :deep(.el-select__selected-item),
.search-form :deep(.el-input-number__decrease),
.search-form :deep(.el-input-number__increase) { color: #0d1b2d !important; }
.search-form :deep(.el-input__wrapper),
.search-form :deep(.el-select__wrapper) {
  background: rgba(255,255,255,0.94) !important;
  border-color: rgba(0,141,230,0.18) !important;
  box-shadow: 0 0 0 1px rgba(0,141,230,0.14), inset 0 1px 0 rgba(255,255,255,0.92) !important;
}
.page-title { font-size: 22px; font-weight: 800; color: #0d1b2d; margin-bottom: 4px; }
.page-sub { font-size: 13px; color: #40566f; font-weight: 500; }
.create-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 9px 18px;
  background: linear-gradient(135deg, #0094ff, #17c9df 56%, #4bd0a0) !important;
  border: 1px solid rgba(0,141,230,0.18) !important; border-radius: 8px;
  color: #fff !important; font-size: 13px; font-weight: 700;
  cursor: pointer; transition: all 0.2s;
  box-shadow: 0 12px 30px rgba(0,150,230,0.23) !important;
}
.create-btn svg { width: 15px; height: 15px; }
.create-btn:hover { transform: translateY(-1px); box-shadow: 0 16px 40px rgba(0,150,230,0.3) !important; }
.loading-state { text-align: center; padding: 40px; color: #40566f; font-weight: 600; }
.strategy-list { display: flex; flex-direction: column; gap: 10px; }
.strategy-card {
  background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(247,252,255,0.94)) !important;
  border: 1px solid rgba(0,141,230,0.16) !important;
  border-radius: 10px; padding: 18px 22px;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
  box-shadow: 0 14px 34px rgba(30,86,130,0.09), inset 0 1px 0 rgba(255,255,255,0.95) !important;
  position: relative;
  overflow: hidden;
}
.strategy-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 22px;
  right: 22px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0,141,230,0.36), rgba(22,199,232,0.28), transparent);
  pointer-events: none;
}
.strategy-card:hover { border-color: rgba(0,141,230,0.34) !important; box-shadow: 0 20px 44px rgba(0,126,206,0.16), inset 0 1px 0 rgba(255,255,255,0.95) !important; transform: translateY(-1px); }
.sc-name { font-size: 15px; font-weight: 800; color: #0d1b2d; margin-bottom: 6px; }
.sc-meta { display: flex; gap: 12px; margin-bottom: 6px; }
.sc-tag { padding: 2px 8px; background: rgba(0,141,230,0.1); border: 1px solid rgba(0,141,230,0.24); border-radius: 10px; font-size: 11px; color: #006fc2; font-weight: 700; }
.sc-time { font-size: 12px; color: #2f7fb3; font-weight: 600; }
.sc-stats { font-size: 12px; color: #40566f; font-weight: 600; }
.sc-stats strong { color: #008de6; font-weight: 800; }
.sc-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
.toggle-wrap { display: flex; align-items: center; gap: 6px; }
.toggle-label { font-size: 12px; font-weight: 700; }
.toggle-label.active { color: #15966a; }
.toggle-label.inactive { color: #60748a; }
.toggle-switch {
  width: 38px; height: 20px;
  background: rgba(96,116,138,0.16);
  border-radius: 10px; cursor: pointer;
  position: relative; transition: background 0.3s;
  box-shadow: inset 0 0 0 1px rgba(96,116,138,0.18);
}
.toggle-switch.on { background: rgba(16,185,129,0.18); box-shadow: inset 0 0 0 1px rgba(16,185,129,0.24); }
.toggle-thumb {
  position: absolute;
  top: 3px; left: 3px;
  width: 14px; height: 14px; border-radius: 50%;
  background: #7b8da1;
  transition: all 0.25s;
}
.toggle-switch.on .toggle-thumb { left: 21px; background: #35b86f; box-shadow: 0 0 10px rgba(53,184,111,0.55); }
.sc-btn {
  padding: 5px 12px;
  border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s;
}
.sc-btn.hist { background: rgba(0,141,230,0.08) !important; border: 1px solid rgba(0,141,230,0.22) !important; color: #006fc2 !important; }
.sc-btn.hist:hover { background: rgba(0,141,230,0.14) !important; color: #008de6 !important; transform: translateY(-1px); }
.sc-btn.edit { background: rgba(16,185,129,0.08) !important; border: 1px solid rgba(16,185,129,0.22) !important; color: #0d8b62 !important; }
.sc-btn.edit:hover { background: rgba(16,185,129,0.15) !important; color: #10a875 !important; transform: translateY(-1px); }
.sc-btn.del { background: rgba(229,72,77,0.08) !important; border: 1px solid rgba(229,72,77,0.22) !important; color: #c62f36 !important; }
.sc-btn.del:hover { background: rgba(229,72,77,0.14) !important; color: #e5484d !important; transform: translateY(-1px); }
.pagination-wrapper {
  margin-top: 20px;
  display: flex;
  justify-content: flex-end;
}

.history-summary { font-size: 14px; color: #1d3148; margin-bottom: 12px; font-weight: 600; }
.history-summary strong { color: #008de6; font-size: 18px; }
.history-list { display: flex; flex-direction: column; gap: 4px; max-height: 400px; overflow-y: auto; }
.history-item {
  display: flex; gap: 16px; padding: 6px 10px;
  background: rgba(0,141,230,0.06); border: 1px solid rgba(0,141,230,0.12); border-radius: 4px;
  font-size: 12px;
}
.hi-time { color: #40566f; min-width: 140px; font-weight: 600; }
.hi-device { color: #006fc2; min-width: 80px; font-weight: 700; }
.hi-action { color: #1d3148; font-weight: 600; }
.empty-hint { text-align: center; padding: 24px; color: #40566f; font-weight: 600; }
</style>
