<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import {
  ElButton, ElDialog, ElForm, ElFormItem, ElInput,
  ElSelect, ElOption, ElMessage, ElTree, ElMessageBox,
  ElCard, ElEmpty, ElTable, ElTableColumn, ElTag,
  ElCheckbox, ElPagination
} from 'element-plus'
import { Plus, Edit, Delete, Refresh, Search } from '@element-plus/icons-vue'
import { fetchAreaTree, createArea, updateArea, deleteArea } from '../api/area.js'
import { fetchDeviceList, batchDeviceArea } from '../api/devices.js'
import { useUserInfo } from '../composables/useUserInfo.js'

const { hasPerm } = useUserInfo()

const treeData = ref([])
const loading = ref(false)
const selectedNode = ref(null)
const areaKeyword = ref('')

/** 根据关键词过滤树（匹配名称或名称含关键词的节点及其父路径） */
const filteredTreeData = computed(() => {
  const kw = areaKeyword.value.trim().toLowerCase()
  if (!kw) return treeData.value

  function filterNodes(nodes) {
    return nodes.reduce((acc, n) => {
      const match = (n.name || '').toLowerCase().includes(kw)
      const filteredChildren = n.children?.length ? filterNodes(n.children) : []
      if (match || filteredChildren.length) {
        acc.push({ ...n, children: filteredChildren.length ? filteredChildren : (match ? n.children : []) })
      }
      return acc
    }, [])
  }
  return filterNodes(treeData.value)
})

// ── 对话框 ────────────────────────────────────────────────────────────────
const dialogVisible = ref(false)
const dialogMode = ref('create')
const formRef = ref(null)
const editingId = ref(null)
const submitting = ref(false)

const formData = ref({
  name: '',
  description: '',
  parentId: null
})

const rules = {
  name: [{ required: true, message: '请输入区域名称', trigger: 'blur' }]
}

// ── 树形选择器用平铺选项（排除自身及子孙） ──────────────────────────────
const parentOptions = computed(() => {
  const result = []
  function walk(nodes) {
    for (const n of nodes) {
      if (editingId.value && isDescendantOrSelf(n, editingId.value)) continue
      result.push({ id: n.id, name: n.name, parentId: n.parentId })
      if (n.children?.length) walk(n.children)
    }
  }
  walk(treeData.value)
  return result
})

function isDescendantOrSelf(node, targetId) {
  if (node.id === targetId) return true
  if (!node.children?.length) return false
  return node.children.some(child => isDescendantOrSelf(child, targetId))
}

/** 从树中查找指定 ID 的节点 */
function findNodeById(nodes, targetId) {
  for (const node of nodes) {
    if (node.id === targetId) return node
    if (node.children?.length) {
      const found = findNodeById(node.children, targetId)
      if (found) return found
    }
  }
  return null
}

/** 收集目标节点及其所有子孙节点 ID（用于跨层查询设备） */
function collectDescendantIds(nodes, targetId) {
  const ids = []
  function walk(node) {
    ids.push(node.id)
    if (node.children?.length) node.children.forEach(walk)
  }
  function find(nodes) {
    for (const node of nodes) {
      if (node.id === targetId) { walk(node); return true }
      if (node.children?.length && find(node.children)) return true
    }
    return false
  }
  find(nodes)
  return ids
}

// ── 节点路径显示 ──────────────────────────────────────────────────────────
const selectedNodePath = computed(() => {
  if (!selectedNode.value) return ''
  const parts = []
  function find(node, targetId) {
    if (node.id === targetId) {
      parts.unshift(node.name)
      return true
    }
    if (node.children) {
      for (const child of node.children) {
        if (find(child, targetId)) {
          parts.unshift(node.name)
          return true
        }
      }
    }
    return false
  }
  for (const root of treeData.value) {
    if (find(root, selectedNode.value.id)) break
  }
  return parts.join(' / ')
})

// ── 该区域下的设备 ─────────────────────────────────────────────────────────
const areaDevices = ref([])
const areaDevicesLoading = ref(false)
const devicePageNum = ref(1)
const devicePageSize = ref(10)

const pagedAreaDevices = computed(() => {
  const start = (devicePageNum.value - 1) * devicePageSize.value
  return areaDevices.value.slice(start, start + devicePageSize.value)
})

watch(areaDevices, () => {
  devicePageNum.value = 1
})

async function loadAreaDevices(areaId) {
  if (!areaId) {
    areaDevices.value = []
    return
  }
  areaDevicesLoading.value = true
  try {
    // 收集当前区域及所有子区域的 ID，显示汇总设备
    const allIds = collectDescendantIds(treeData.value, areaId)
    const res = await fetchDeviceList({ areaIds: allIds, pageSize: 10000 })
    areaDevices.value = Array.isArray(res) ? res : (res?.data || [])
  } catch {
    areaDevices.value = []
  } finally {
    areaDevicesLoading.value = false
  }
}

watch(selectedNode, (val) => {
  loadAreaDevices(val?.id)
})

// ── 批量分配 ──────────────────────────────────────────────────────────────
const batchDialogVisible = ref(false)
const batchKeyword = ref('')
const showUnassignedOnly = ref(true)
const allDevices = ref([])
const devicesLoading = ref(false)
const selectedDeviceIds = ref([])
const batchSubmitting = ref(false)

const filteredDevices = computed(() => {
  let list = allDevices.value
  if (showUnassignedOnly.value) {
    list = list.filter(d => d.areaId === undefined || d.areaId === null)
  }
  if (batchKeyword.value) {
    const kw = batchKeyword.value.toLowerCase()
    list = list.filter(d =>
      (d.deviceId?.toLowerCase() || '').includes(kw) ||
      (d.name?.toLowerCase() || '').includes(kw)
    )
  }
  return list
})

async function openBatchAssign() {
  selectedDeviceIds.value = []
  batchKeyword.value = ''
  showUnassignedOnly.value = true
  batchDialogVisible.value = true
  devicesLoading.value = true
  try {
    const res = await fetchDeviceList({ pageSize: 500 })
    allDevices.value = Array.isArray(res) ? res : (res?.data || [])
  } catch {
    allDevices.value = []
  } finally {
    devicesLoading.value = false
  }
}

function onSelectionChange(selection) {
  selectedDeviceIds.value = selection.map(d => d.id)
}

async function confirmBatchAssign() {
  if (!selectedDeviceIds.value.length) {
    ElMessage.warning('请至少选择一台设备')
    return
  }
  batchSubmitting.value = true
  try {
    await batchDeviceArea({
      deviceIds: selectedDeviceIds.value,
      areaId: selectedNode.value.id
    })
    ElMessage.success(`已分配 ${selectedDeviceIds.value.length} 台设备到「${selectedNode.value.name}」`)
    batchDialogVisible.value = false
    // 刷新当前区域设备列表
    await loadAreaDevices(selectedNode.value.id)
    // 全量刷新列表，让左侧树更新（可在 detail 中展示设备数）
  } catch (error) {
    ElMessage.error(error?.message || '批量分配失败')
  } finally {
    batchSubmitting.value = false
  }
}

async function confirmBatchClear() {
  if (!areaDevices.value.length) {
    ElMessage.info('该区域下无设备')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认清除该区域下全部 ${areaDevices.value.length} 台设备的区域关联？`,
      '批量清除区域',
      { confirmButtonText: '确认清除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  batchSubmitting.value = true
  try {
    await batchDeviceArea({
      deviceIds: areaDevices.value.map(d => d.id),
      areaId: null
    })
    ElMessage.success(`已清除 ${areaDevices.value.length} 台设备的区域`)
    await loadAreaDevices(selectedNode.value.id)
  } catch (error) {
    ElMessage.error(error?.message || '批量清除失败')
  } finally {
    batchSubmitting.value = false
  }
}

const statusTag = (s) => {
  const map = { 1: 'success', 2: 'info', 3: 'danger', 0: 'info' }
  return map[s] || 'info'
}
const statusLabel = (s) => {
  const map = { 0: '停用', 1: '在线', 2: '离线', 3: '异常' }
  return map[s] || '未知'
}

// ── 数据加载 ──────────────────────────────────────────────────────────────
async function loadTree() {
  loading.value = true
  try {
    const res = await fetchAreaTree()
    treeData.value = res?.data || []
  } finally {
    loading.value = false
  }
}

// ── 新增 ──────────────────────────────────────────────────────────────────
function openCreate(parent) {
  dialogMode.value = 'create'
  editingId.value = null
  formData.value = {
    name: '',
    description: '',
    parentId: parent?.id ?? null
  }
  dialogVisible.value = true
  nextTick(() => formRef.value?.clearValidate?.())
}

// ── 编辑 ──────────────────────────────────────────────────────────────────
function openEdit(node) {
  dialogMode.value = 'edit'
  editingId.value = node.id
  formData.value = {
    name: node.name || '',
    description: node.description || '',
    parentId: node.parentId ?? null
  }
  dialogVisible.value = true
  nextTick(() => formRef.value?.clearValidate?.())
}

// ── 提交流单 ──────────────────────────────────────────────────────────────
async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  // 名称唯一性校验（前端预检，避免后端 400）
  const nameToCheck = formData.value.name.trim().toLowerCase()
  const allNames = []
  function collectNames(nodes) {
    for (const n of nodes) {
      allNames.push({ id: n.id, name: n.name.toLowerCase() })
      if (n.children?.length) collectNames(n.children)
    }
  }
  collectNames(treeData.value)
  const isDuplicate = dialogMode.value === 'edit'
    ? allNames.some(n => n.id !== editingId.value && n.name === nameToCheck)
    : allNames.some(n => n.name === nameToCheck)
  if (isDuplicate) {
    ElMessage.warning(`区域名称"${formData.value.name}"已存在，请使用其他名称`)
    return
  }

  submitting.value = true
  try {
    const payload = { ...formData.value }

    if (dialogMode.value === 'edit') {
      await updateArea(editingId.value, payload)
      ElMessage.success('修改区域成功')
    } else {
      await createArea(payload)
      ElMessage.success('新增区域成功')
    }

    dialogVisible.value = false
    await loadTree()
  } catch (error) {
    ElMessage.error(error?.message || (dialogMode.value === 'edit' ? '修改区域失败' : '新增区域失败'))
  } finally {
    submitting.value = false
  }
}

// ── 删除 ──────────────────────────────────────────────────────────────────
async function handleDelete(node) {
  try {
    await ElMessageBox.confirm(
      `确认删除区域”${node.name}”？${
        node.children?.length ? '该区域下有子区域，无法删除。' : '若该区域已被设备引用，将拒绝删除。'
      }`,
      '删除区域',
      {
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
  } catch {
    return
  }

  try {
    await deleteArea(node.id)
    ElMessage.success('删除区域成功')
    if (selectedNode.value?.id === node.id) selectedNode.value = null
    await loadTree()
  } catch (error) {
    const msg = error?.response?.data?.msg || error?.message || '删除区域失败'
    if (msg.includes('设备')) {
      await ElMessageBox.alert(msg, '无法删除', { confirmButtonText: '知道了', type: 'warning' })
    } else {
      ElMessage.error(msg)
    }
  }
}

onMounted(() => {
  loadTree()
  window.addEventListener('area-created', loadTree)
})

onUnmounted(() => {
  window.removeEventListener('area-created', loadTree)
})
</script>

<template>
  <div class="area-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <div>
        <h1 class="page-title">分区管理</h1>
        <p class="page-sub">管理设备分区区域，支持树形层级结构</p>
      </div>
      <div class="header-actions">
        <button class="refresh-btn" @click="loadTree">
          <Refresh class="btn-icon" />
          刷新
        </button>
        <button v-if="hasPerm('device_area:create')" class="add-btn" @click="openCreate(null)">
          <Plus class="btn-icon" />
          新增区域
        </button>
      </div>
    </div>

    <div class="content-wrap">
      <!-- 左侧：区域树 -->
      <ElCard class="tree-card" :body-style="{ padding: '12px' }">
        <div class="tree-header">
          <span class="tree-title">区域结构</span>
          <button class="tree-refresh-btn" @click="loadTree" title="刷新">
            <Refresh class="btn-icon" />
          </button>
        </div>
        <div class="tree-search">
          <Search class="tree-search-icon" />
          <input
            v-model="areaKeyword"
            class="tree-search-input"
            placeholder="输入区域名称搜索"
          />
        </div>
        <ElEmpty v-if="!loading && !filteredTreeData.length" :image-size="60" description="暂无区域数据" />
        <div v-else-if="loading" class="loading-state">
          <div class="loading-spinner"></div>
          <span>加载中...</span>
        </div>
        <ElTree
          v-else-if="filteredTreeData.length"
          ref="treeRef"
          :data="filteredTreeData"
          node-key="id"
          :props="{ children: 'children', label: 'name' }"
          default-expand-all
          highlight-current
          @node-click="(data) => selectedNode = data"
        />
      </ElCard>

      <!-- 右侧：详情 / 设备列表 -->
      <div class="right-panel">
        <ElCard class="detail-card" :body-style="{ padding: '16px 20px' }">
          <template v-if="selectedNode">
            <div class="detail-header">
              <h3 class="detail-title">{{ selectedNode.name }}</h3>
              <div class="detail-actions">
                <button
                  v-if="hasPerm('device_area:update')"
                  class="detail-btn edit"
                  @click="openEdit(selectedNode)"
                >
                  <Edit class="btn-icon" />
                  编辑
                </button>
                <button
                  v-if="hasPerm('device_area:delete')"
                  class="detail-btn delete"
                  @click="handleDelete(selectedNode)"
                >
                  <Delete class="btn-icon" />
                  删除
                </button>
              </div>
            </div>
            <div class="detail-body">
              <div class="detail-row">
                <span class="detail-label">节点路径</span>
                <span class="detail-value">{{ selectedNodePath || '--' }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">区域名称</span>
                <span class="detail-value">{{ selectedNode.name }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">区域描述</span>
                <span class="detail-value">{{ selectedNode.description || '--' }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">上级区域</span>
                <span class="detail-value">{{ selectedNode.parentId ? `ID: ${selectedNode.parentId}` : '无（顶级区域）' }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">子区域数</span>
                <span class="detail-value">{{ selectedNode.children?.length || 0 }}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">设备数</span>
                <span class="detail-value">{{ areaDevices.length }}</span>
              </div>
            </div>
          </template>
          <ElEmpty v-else :image-size="60" description="请在左侧选择一个区域" />
        </ElCard>

        <!-- 设备列表 & 批量操作 -->
        <ElCard v-if="selectedNode" class="device-card" :body-style="{ padding: '12px 16px' }">
          <div class="device-header">
            <span class="device-title">
              归属设备（含子区域）
              <span class="device-count">{{ areaDevices.length }} 台</span>
            </span>
            <div class="device-header-actions">
              <button
                v-if="hasPerm('device:update')"
                class="detail-btn primary"
                @click="openBatchAssign"
              >
                <Plus class="btn-icon" />
                批量分配
              </button>
              <button
                v-if="hasPerm('device:update') && areaDevices.length"
                class="detail-btn delete"
                @click="confirmBatchClear"
              >
                批量清除
              </button>
            </div>
          </div>

          <div v-if="areaDevicesLoading" class="loading-state">
            <div class="loading-spinner"></div>
            <span>加载中...</span>
          </div>
          <ElEmpty v-else-if="!areaDevices.length" :image-size="50" description="该区域暂无设备" />
          <template v-else>
            <ElTable :data="pagedAreaDevices" stripe size="small" class="area-device-table">
              <ElTableColumn prop="deviceId" label="设备编号" width="110" />
              <ElTableColumn prop="name" label="设备名称" min-width="130" />
              <ElTableColumn prop="area" label="区域" width="100">
                <template #default="{ row }">
                  <ElTag size="small" effect="plain">{{ row.area || '--' }}</ElTag>
                </template>
              </ElTableColumn>
              <ElTableColumn label="状态" width="80">
                <template #default="{ row }">
                  <ElTag :type="statusTag(row.status)" size="small" effect="light">
                    {{ statusLabel(row.status) }}
                  </ElTag>
                </template>
              </ElTableColumn>
            </ElTable>
            <div class="device-pagination-wrap" v-if="areaDevices.length">
              <ElPagination
                v-model:current-page="devicePageNum"
                v-model:page-size="devicePageSize"
                :total="areaDevices.length"
                :page-sizes="[10, 20, 50]"
                background
                small
                layout="sizes, prev, pager, next"
              />
            </div>
          </template>
        </ElCard>
      </div>
    </div>

    <!-- 新增/编辑对话框 -->
    <ElDialog
      v-model="dialogVisible"
      :title="dialogMode === 'edit' ? '编辑区域' : '新增区域'"
      width="480px"
      class="area-dialog"
    >
      <ElForm ref="formRef" :model="formData" :rules="rules" label-width="80px">
        <ElFormItem label="区域名称" prop="name">
          <ElInput v-model.trim="formData.name" placeholder="如 A区、南门" maxlength="50" show-word-limit />
        </ElFormItem>
        <ElFormItem label="区域描述" prop="description">
          <ElInput
            v-model.trim="formData.description"
            type="textarea"
            :rows="3"
            placeholder="如 A区 — 主干道照明区域（南门）"
            maxlength="200"
            show-word-limit
          />
        </ElFormItem>
        <ElFormItem label="上级区域" prop="parentId">
          <ElSelect v-model="formData.parentId" placeholder="选择上级区域（留空为顶级区域）" clearable style="width: 100%">
            <ElOption label="── 顶级区域（无上级）──" :value="null" />
            <ElOption
              v-for="opt in parentOptions"
              :key="opt.id"
              :label="opt.name"
              :value="opt.id"
            />
          </ElSelect>
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="submitting" @click="handleSubmit">
          {{ dialogMode === 'edit' ? '保存修改' : '确定新增' }}
        </ElButton>
      </template>
    </ElDialog>

    <!-- 批量分配设备对话框 -->
    <ElDialog
      v-model="batchDialogVisible"
      :title="`批量分配设备 → ${selectedNode?.name || ''}`"
      width="800px"
      top="4vh"
      class="batch-dialog"
      destroy-on-close
    >
      <div class="batch-filter">
        <div class="batch-filter-left">
          <ElInput
            v-model="batchKeyword"
            placeholder="搜索设备编号/名称"
            clearable
            size="small"
            :prefix-icon="Search"
            class="search-input"
          />
          <label class="unassigned-toggle">
            <ElCheckbox v-model="showUnassignedOnly" size="small" />
            <span>仅显示未分配区域的设备</span>
          </label>
        </div>
        <span class="batch-selected-info">
          已选 {{ selectedDeviceIds.length }} 台
        </span>
      </div>

      <div v-if="devicesLoading" class="loading-state">
        <div class="loading-spinner"></div>
        <span>加载设备列表中...</span>
      </div>
      <template v-else>
        <ElTable
          :data="filteredDevices"
          stripe
          size="small"
          max-height="360"
          @selection-change="onSelectionChange"
          class="batch-device-table"
        >
          <ElTableColumn type="selection" width="44" />
          <ElTableColumn prop="deviceId" label="设备编号" width="120" />
          <ElTableColumn prop="name" label="设备名称" min-width="140" />
          <ElTableColumn prop="area" label="当前区域" width="120">
            <template #default="{ row }">
              <ElTag v-if="row.area" size="small" effect="plain">{{ row.area }}</ElTag>
              <span v-else class="no-area">未分配</span>
            </template>
          </ElTableColumn>
          <ElTableColumn label="状态" width="80">
            <template #default="{ row }">
              <ElTag :type="statusTag(row.status)" size="small" effect="light">
                {{ statusLabel(row.status) }}
              </ElTag>
            </template>
          </ElTableColumn>
        </ElTable>
        <div v-if="!filteredDevices.length" class="batch-empty">
          <ElEmpty :image-size="40" description="没有符合条件的设备" />
        </div>
      </template>

      <template #footer>
        <ElButton @click="batchDialogVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="batchSubmitting" @click="confirmBatchAssign">
          确认分配 ({{ selectedDeviceIds.length }})
        </ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.area-page {
  padding: 24px 28px;
  height: 100%;
  display: flex;
  flex-direction: column;
  color: #1d3148;
  position: relative;
  overflow: hidden;
}

.area-page::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 10% 8%, rgba(0, 141, 230, 0.13), transparent 30%),
    radial-gradient(circle at 86% 12%, rgba(20, 184, 166, 0.10), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.38), transparent 32%);
}

.area-page > * {
  position: relative;
  z-index: 1;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}

.page-title {
  font-size: 22px;
  font-weight: 900;
  color: #0d1b2d;
  margin: 0 0 5px;
  letter-spacing: 0;
}

.page-sub {
  font-size: 13px;
  color: #40566f;
  font-weight: 600;
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.add-btn,
.refresh-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 14px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s;
}

.add-btn {
  background: linear-gradient(135deg, #008de6, #21c8dc 62%, #18b6a5);
  color: #fff;
  box-shadow: 0 10px 24px rgba(0, 141, 230, 0.24);
}

.add-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 30px rgba(0, 141, 230, 0.30);
}

.refresh-btn {
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(0, 141, 230, 0.18);
  color: #006fc2;
  box-shadow: 0 8px 22px rgba(30, 86, 130, 0.08);
}

.refresh-btn:hover {
  background: #ffffff;
  border-color: rgba(0, 141, 230, 0.36);
  color: #008de6;
}

.btn-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.content-wrap {
  flex: 1;
  display: flex;
  gap: 16px;
  min-height: 0;
}

.tree-card {
  width: 310px;
  flex-shrink: 0;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(247, 251, 255, 0.94));
  border: 1px solid rgba(0, 141, 230, 0.18);
  border-radius: 10px;
  box-shadow: 0 20px 46px rgba(14, 70, 120, 0.12);
  overflow: hidden;
}

.tree-card :deep(.el-card__body) {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px 12px;
  border-bottom: 1px solid rgba(16, 126, 196, 0.12);
  margin-bottom: 12px;
}

.tree-title {
  font-size: 15px;
  font-weight: 900;
  color: #0d1b2d;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.tree-title::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #008de6;
  box-shadow: 0 0 0 5px rgba(0, 141, 230, 0.10);
}

.right-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
}

.detail-card {
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(0, 141, 230, 0.16);
  border-radius: 10px;
  box-shadow: 0 18px 42px rgba(14, 70, 120, 0.10);
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(16, 126, 196, 0.12);
  margin-bottom: 16px;
}

.detail-title {
  font-size: 20px;
  font-weight: 900;
  color: #0d1b2d;
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.detail-title::before {
  content: "";
  width: 4px;
  height: 20px;
  border-radius: 999px;
  background: linear-gradient(180deg, #008de6, #21c8dc);
  box-shadow: 0 0 16px rgba(0, 141, 230, 0.24);
}

.detail-actions {
  display: flex;
  gap: 8px;
}

.detail-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  border: none;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s;
}

.detail-btn.edit {
  background: rgba(0, 141, 230, 0.09) !important;
  color: #006fc2 !important;
  border: 1px solid rgba(0, 141, 230, 0.24) !important;
}

.detail-btn.edit:hover {
  background: rgba(0, 141, 230, 0.15) !important;
  color: #008de6 !important;
}

.detail-btn.delete {
  background: rgba(229, 72, 77, 0.08) !important;
  color: #c62f36 !important;
  border: 1px solid rgba(229, 72, 77, 0.22) !important;
}

.detail-btn.delete:hover {
  background: rgba(229, 72, 77, 0.14) !important;
  color: #e5484d !important;
}

.detail-btn.primary {
  background: linear-gradient(135deg, #0094ff, #17c9df 56%, #4bd0a0) !important;
  color: #ffffff !important;
  border: 1px solid rgba(0, 141, 230, 0.18) !important;
  box-shadow: 0 10px 24px rgba(0, 141, 230, 0.18) !important;
}

.detail-btn.primary:hover {
  box-shadow: 0 14px 32px rgba(0, 141, 230, 0.24) !important;
}

.detail-body {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.detail-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 10px 12px;
  background: linear-gradient(135deg, rgba(247, 251, 255, 0.95), rgba(255, 255, 255, 0.98));
  border: 1px solid rgba(0, 141, 230, 0.10);
  border-radius: 8px;
  box-shadow: inset 3px 0 0 rgba(0, 141, 230, 0.12);
}

.detail-row:nth-child(1),
.detail-row:nth-child(3) {
  grid-column: 1 / -1;
}

.detail-label {
  font-size: 12px;
  color: #31516f;
  font-weight: 900;
  min-width: 86px;
  flex-shrink: 0;
}

.detail-value {
  font-size: 13px;
  color: #1d3148;
  font-weight: 700;
  line-height: 1.45;
  word-break: break-word;
}

.device-card {
  flex: 1;
  min-height: 360px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(0, 141, 230, 0.16);
  border-radius: 10px;
  box-shadow: 0 18px 42px rgba(14, 70, 120, 0.10);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.device-card :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.device-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(16, 126, 196, 0.12);
  margin-bottom: 12px;
}

.device-title {
  font-size: 15px;
  font-weight: 900;
  color: #0d1b2d;
}

.device-count {
  font-size: 12px;
  font-weight: 800;
  color: #006fc2;
  margin-left: 6px;
  padding: 2px 8px;
  background: rgba(0, 141, 230, 0.08);
  border: 1px solid rgba(0, 141, 230, 0.14);
  border-radius: 999px;
}

.device-header-actions {
  display: flex;
  gap: 6px;
}

.area-device-table {
  width: 100%;
}

.device-pagination-wrap {
  display: flex;
  justify-content: flex-end;
  padding: 12px 0 4px;
}

.device-pagination-wrap :deep(.el-pagination) {
  --el-pagination-font-size: 12px;
}

/* ── 批量分配对话框 ─────────────────────────────────────── */
.batch-dialog :deep(.el-dialog__body) {
  padding-top: 12px;
  padding-bottom: 8px;
}

.batch-filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.batch-filter-left {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1;
}

.search-input {
  width: 240px;
}

.unassigned-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #40566f;
  cursor: pointer;
  white-space: nowrap;
}

.batch-selected-info {
  font-size: 12px;
  color: #006fc2;
  font-weight: 700;
  white-space: nowrap;
}

.batch-device-table {
  width: 100%;
}

.batch-empty {
  padding: 20px 0;
}

.no-area {
  color: #60748a;
  font-size: 12px;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px;
  color: #40566f;
}

.loading-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(0, 141, 230, 0.22);
  border-top-color: #008de6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* 树搜索 */
.tree-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 40px;
  margin: 0 2px 16px;
  position: relative;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(244, 250, 255, 0.9));
  border: 1px solid rgba(0, 141, 230, 0.2);
  border-radius: 8px;
  box-shadow: 0 10px 24px rgba(30, 86, 130, 0.09), inset 0 1px 0 rgba(255,255,255,0.9);
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
}
.tree-search::after {
  content: "";
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 141, 230, 0.34), transparent);
  pointer-events: none;
}
.tree-search:focus-within {
  background: #ffffff;
  border-color: rgba(0, 141, 230, 0.45);
  box-shadow: 0 0 0 3px rgba(0, 141, 230, 0.1), 0 12px 28px rgba(30, 86, 130, 0.12);
}
.tree-search-icon {
  width: 14px;
  height: 14px;
  color: #006fc2;
  flex-shrink: 0;
}
.tree-search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: #0d1b2d;
  font-size: 13px;
  font-weight: 700;
}
.tree-search-input::placeholder { color: #6f8194; }
.tree-refresh-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px;
  background: rgba(255, 255, 255, 0.86) !important;
  border: 1px solid rgba(0, 141, 230, 0.16) !important;
  color: #006fc2 !important; cursor: pointer;
  border-radius: 6px; transition: all 0.2s;
}
.tree-refresh-btn:hover { background: rgba(0, 141, 230, 0.1) !important; color: #008de6 !important; }
.tree-refresh-btn .btn-icon { width: 13px; height: 13px; }

.tree-card :deep(.el-tree) {
  background: transparent;
  color: #1d3148;
  padding: 2px 0;
  flex: 1;
  overflow-y: auto;
}

.tree-card :deep(.el-tree-node__content) {
  height: 38px;
  margin: 3px 0;
  border-radius: 8px;
  color: #1d3148;
  border: 1px solid transparent;
  transition: background 0.18s ease, box-shadow 0.18s ease, color 0.18s ease;
}

.tree-card :deep(.el-tree-node__content:hover) {
  background: rgba(232, 246, 255, 0.92);
  border-color: rgba(0, 141, 230, 0.12);
  box-shadow: inset 2px 0 0 rgba(0, 141, 230, 0.28);
}

.tree-card :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: linear-gradient(90deg, rgba(0, 141, 230, 0.16), rgba(22, 199, 232, 0.09));
  border-color: rgba(0, 141, 230, 0.18);
  box-shadow: inset 4px 0 0 #008de6, 0 10px 24px rgba(0, 141, 230, 0.12);
}

.tree-card :deep(.el-tree-node__label) {
  color: #1d3148 !important;
  font-size: 14px;
  font-weight: 800;
}

.tree-card :deep(.el-tree-node.is-current > .el-tree-node__content .el-tree-node__label) {
  color: #006fc2 !important;
  font-weight: 800;
}

.tree-card :deep(.el-tree-node__expand-icon) {
  color: #31516f;
  font-size: 14px;
}

.tree-card :deep(.el-tree-node__expand-icon.is-leaf) {
  color: transparent;
}

.area-page :deep(.el-card) {
  --el-card-border-radius: 10px;
  --el-card-padding: 0;
}

.area-page :deep(.el-empty) {
  flex: 1;
  min-height: 180px;
}

.area-page :deep(.el-empty__image) {
  opacity: 0.68;
}

.device-card :deep(.el-empty) {
  min-height: 260px;
  display: flex;
  justify-content: center;
}

.area-device-table :deep(.el-table),
.batch-device-table :deep(.el-table) {
  background: transparent;
}

.area-device-table :deep(.el-table__inner-wrapper::before),
.batch-device-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}

.area-device-table :deep(th.el-table__cell),
.batch-device-table :deep(th.el-table__cell) {
  background: rgba(232, 246, 255, 0.88) !important;
  color: #0d1b2d !important;
  font-weight: 800;
  border-bottom: 1px solid rgba(0, 141, 230, 0.12) !important;
}

.area-device-table :deep(td.el-table__cell),
.batch-device-table :deep(td.el-table__cell),
.area-device-table :deep(.cell),
.batch-device-table :deep(.cell) {
  color: #1d3148 !important;
  font-weight: 700;
}

.area-device-table :deep(.el-table__row--striped td.el-table__cell),
.batch-device-table :deep(.el-table__row--striped td.el-table__cell) {
  background: rgba(247, 251, 255, 0.78) !important;
}

.area-device-table :deep(.el-table__body tr:hover > td.el-table__cell),
.batch-device-table :deep(.el-table__body tr:hover > td.el-table__cell) {
  background: rgba(0, 141, 230, 0.06) !important;
}

.area-device-table :deep(.el-tag),
.batch-device-table :deep(.el-tag) {
  font-weight: 700;
}

.area-dialog :deep(.el-form-item__label),
.batch-dialog :deep(.el-form-item__label),
.batch-dialog :deep(.el-checkbox__label) {
  color: #1d3148 !important;
  font-weight: 700;
}

.area-dialog :deep(.el-input__inner),
.area-dialog :deep(.el-textarea__inner),
.batch-dialog :deep(.el-input__inner) {
  color: #0d1b2d !important;
}

.area-page :deep(.el-empty__description p) {
  color: #1d3148 !important;
  font-weight: 800;
}

@media (max-width: 1100px) {
  .content-wrap {
    flex-direction: column;
  }

  .tree-card {
    width: 100%;
    min-height: 280px;
  }

  .detail-body {
    grid-template-columns: 1fr;
  }

  .detail-row:nth-child(1),
  .detail-row:nth-child(3) {
    grid-column: auto;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
