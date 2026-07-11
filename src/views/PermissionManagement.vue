<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import {
  ElButton, ElTable, ElTableColumn, ElTag, ElDialog, ElForm, ElFormItem, ElInput,
  ElSelect, ElOption, ElMessage, ElMessageBox, ElTree, ElCard, ElTabs, ElTabPane,
  ElPopconfirm, ElEmpty, ElBadge, ElTooltip, ElCheckbox
} from 'element-plus'
import { Search, Refresh, Check } from '@element-plus/icons-vue'
import { fetchRoleList, fetchRoleById, assignRolePermissions } from '../api/role.js'
import { refreshPermissionsAndMenus } from '../api/auth.js'

// ═══════════════════ 角色权限分配 ═══════════════════
const roleList = ref([])
const selectedRoleId = ref(null)
const assignTreeData = ref([])
const assignCheckedKeys = ref([])
const assignLoading = ref(false)
const assignSaving = ref(false)
const assignTreeRef = ref(null)
const assignFilterText = ref('')
const selectedRole = computed(() => roleList.value.find(r => r.id === selectedRoleId.value))

const checkedCount = ref(0)
const totalPermCount = ref(0)

const loadRoles = async () => {
  try {
    const res = await fetchRoleList()
    roleList.value = (res?.code === 200 ? (res.data || []) : (res || []))
      .filter(r => (r.roleCode || r.code) !== 'SUPER_ADMIN')
  } catch {
    roleList.value = []
  }
}

const loadAssignData = async () => {
  if (!selectedRoleId.value) {
    assignTreeData.value = []
    assignCheckedKeys.value = []
    checkedCount.value = 0
    return
  }
  assignLoading.value = true
  try {
    const res = await fetchRoleById(selectedRoleId.value)
    const data = res?.code === 200 ? res.data : res
    const permCodes = data?.permissionCodes || []
    const allPerms = data?.allPermissions || []

    const checkedIds = allPerms
      .filter(p => permCodes.includes(p.permissionCode))
      .map(p => p.id)
    assignCheckedKeys.value = checkedIds
    checkedCount.value = checkedIds.length

    const buildAssignTree = (parentId) => {
      const children = allPerms.filter(p =>
        (parentId === null && (p.parentId === null || p.parentId === 0)) ||
        (parentId !== null && p.parentId === parentId)
      )
      return children
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'MODULE' ? -1 : 1
          return (a.sort ?? 0) - (b.sort ?? 0)
        })
        .map(c => ({
          id: c.id,
          label: c.name,
          code: c.permissionCode,
          type: c.type,
          children: buildAssignTree(c.id)
        }))
    }

    assignTreeData.value = buildAssignTree(null)
    totalPermCount.value = allPerms.length

    // 确保树加载后正确设置已勾选节点
    await nextTick()
    assignTreeRef.value?.setCheckedKeys(checkedIds, false)
    updateCheckedCount()
  } catch {
    ElMessage.error('获取角色权限失败')
  } finally {
    assignLoading.value = false
  }
}

// 搜索过滤分配树
const filteredAssignTree = computed(() => {
  if (!assignFilterText.value) return assignTreeData.value
  const kw = assignFilterText.value.toLowerCase()
  const filter = (nodes) => {
    return nodes.reduce((acc, node) => {
      const match = node.label?.toLowerCase().includes(kw) || node.code?.toLowerCase().includes(kw)
      const filteredChildren = node.children ? filter(node.children) : []
      if (match || filteredChildren.length > 0) {
        acc.push({ ...node, children: filteredChildren.length > 0 ? filteredChildren : node.children })
      }
      return acc
    }, [])
  }
  return filter(assignTreeData.value)
})

const handleCheckAll = () => {
  assignTreeRef.value?.setCheckedNodes(assignTreeData.value)
  updateCheckedCount()
}

const handleUncheckAll = () => {
  assignTreeRef.value?.setCheckedKeys([])
  checkedCount.value = 0
}

const handleExpandAll = () => {
  loadAssignData()
}

const updateCheckedCount = () => {
  const keys = assignTreeRef.value?.getCheckedKeys() || []
  checkedCount.value = keys.length
}

/**
 * 自动补全 :read 权限
 * 勾选了 MODULE 但没勾选对应的 :read 子权限时，自动补上
 */
const ensureReadPermissions = (checkedKeys, treeNodes) => {
  const result = new Set(checkedKeys)
  const added = []

  const isReadAction = (child) => {
    if (child.type !== 'ACTION') return false
    const code = child.code || child.permissionCode || ''
    return code.endsWith(':read') || code.includes(':read')
  }

  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'MODULE' && result.has(node.id) && node.children?.length) {
        const readChild = node.children.find(isReadAction)
        if (readChild && !result.has(readChild.id)) {
          result.add(readChild.id)
          added.push(`${node.label} → ${readChild.label}`)
        }
      }
      if (node.children?.length) walk(node.children)
    }
  }

  walk(treeNodes)

  if (added.length > 0) {
    console.log('[perm] 自动补全 :read 权限:', added.join(', '))
  }
  return Array.from(result)
}

const handleSaveAssign = async () => {
  if (!selectedRoleId.value) {
    ElMessage.warning('请先选择角色')
    return
  }
  assignSaving.value = true
  try {
    let checkedKeys = assignTreeRef.value?.getCheckedKeys() || []

    // 自动补全 :read 权限：勾选了模块但没勾选查看权限 → 自动加上
    checkedKeys = ensureReadPermissions(checkedKeys, assignTreeData.value)

    await assignRolePermissions(selectedRoleId.value, checkedKeys)
    ElMessage.success(`已为角色「${selectedRole.value?.name}」分配 ${checkedKeys.length} 个权限`)
    checkedCount.value = checkedKeys.length

    // 刷新当前用户权限（如果修改的是自己的角色）
    await refreshPermissionsAndMenus()
    loadAssignData()
  } catch (error) {
    ElMessage.error(error.message || '权限分配失败')
  } finally {
    assignSaving.value = false
  }
}

watch(selectedRoleId, () => loadAssignData())

onMounted(() => {
  loadRoles()
})

const typeTag = (type) => {
  return type === 'MODULE'
    ? { type: '', text: '模块', class: 'tag-module' }
    : { type: 'success', text: '操作', class: 'tag-action' }
}
</script>

<template>
  <div class="permission-container">
    <div class="page-header">
      <div class="header-left">
        <h2 class="page-title">权限管理</h2>
        <span class="page-subtitle">为角色分配功能权限</span>
      </div>
    </div>

    <div class="assign-panel">
      <!-- 顶部：角色选择 + 操作按钮 -->
      <div class="assign-toolbar">
        <div class="assign-toolbar-left">
          <span class="selector-label">目标角色：</span>
          <ElSelect
            v-model="selectedRoleId"
            placeholder="请选择要分配权限的角色"
            class="role-select"
            popper-class="role-select-popper"
            clearable
            filterable
          >
            <ElOption
              v-for="role in roleList"
              :key="role.id"
              :label="`${role.name}  (${role.roleCode})`"
              :value="role.id"
            >
              <div class="role-option">
                <span class="role-option-name">{{ role.name }}</span>
                <code class="role-option-code">{{ role.roleCode }}</code>
              </div>
            </ElOption>
          </ElSelect>

          <template v-if="selectedRoleId">
            <ElTag class="assign-count-tag" size="small" type="primary" round>
              已分配 {{ checkedCount }} 个权限
            </ElTag>
          </template>
        </div>

        <div v-if="selectedRoleId" class="assign-toolbar-right">
          <ElInput
            v-model="assignFilterText"
            placeholder="筛选项..."
            :prefix-icon="Search"
            clearable
            size="small"
            style="width:180px"
          />
          <ElButton size="small" @click="handleCheckAll">全选</ElButton>
          <ElButton size="small" @click="handleUncheckAll">全不选</ElButton>
          <ElButton size="small" @click="loadAssignData" :loading="assignLoading">
            <Refresh /> 刷新
          </ElButton>
          <ElButton
            type="primary"
            size="small"
            @click="handleSaveAssign"
            :loading="assignSaving"
            :icon="Check"
          >
            保存分配
          </ElButton>
        </div>
      </div>

      <!-- 权限树 -->
      <div v-if="selectedRoleId" class="assign-tree-wrapper" v-loading="assignLoading">
        <div v-if="filteredAssignTree.length > 0" class="assign-tree-scroll">
          <ElTree
            ref="assignTreeRef"
            :data="filteredAssignTree"
            show-checkbox
            node-key="id"
            :default-expand-all="true"
            check-strictly
            @check="updateCheckedCount"
          >
            <template #default="{ data }">
              <span class="assign-tree-node" :class="{ 'is-module': data.type === 'MODULE' }">
                <span class="assign-node-label">{{ data.label }}</span>
                <span :class="['tree-tag', typeTag(data.type).class]">
                  {{ typeTag(data.type).text }}
                </span>
                <code class="assign-node-code">{{ data.code }}</code>
              </span>
            </template>
          </ElTree>
        </div>
        <ElEmpty v-else description="该角色暂无可用权限" />
      </div>
      <div v-else class="assign-placeholder">
        <ElEmpty description="请先选择一个角色，再为其分配功能权限" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.permission-container {
  padding: 24px;
  min-height: 100vh;
  background:
    radial-gradient(circle at 8% 8%, rgba(0, 141, 230, 0.12), transparent 28%),
    radial-gradient(circle at 92% 12%, rgba(56, 189, 248, 0.10), transparent 30%),
    linear-gradient(135deg, #f7fbff 0%, #eef7ff 46%, #ffffff 100%);
  color: #1d3148;
}

.page-header {
  margin-bottom: 20px;
}
.header-left {
  display: flex;
  align-items: baseline;
  gap: 14px;
}
.page-title {
  font-size: 22px;
  font-weight: 800;
  color: #0d1b2d;
  margin: 0;
}
.page-subtitle {
  font-size: 13px;
  color: #40566f;
}

.assign-panel {
  padding: 4px 0;
}
.assign-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
  padding: 14px 16px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(242, 249, 255, 0.92)),
    linear-gradient(90deg, rgba(0, 141, 230, 0.10), transparent);
  border-radius: 8px;
  border: 1px solid rgba(0, 141, 230, 0.18);
  box-shadow: 0 14px 32px rgba(14, 70, 120, 0.10);
}
.assign-toolbar-left, .assign-toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.selector-label {
  font-weight: 600;
  color: #1d3148;
  white-space: nowrap;
  font-size: 14px;
}
.role-select {
  width: 320px;
  max-width: 100%;
}
.assign-count-tag {
  border-color: rgba(0, 141, 230, 0.18);
  background: rgba(0, 141, 230, 0.10);
  color: #006fc2;
  font-weight: 700;
}

.assign-tree-wrapper {
  padding: 16px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(0, 141, 230, 0.16);
  border-radius: 8px;
  min-height: 360px;
  box-shadow: 0 16px 38px rgba(14, 70, 120, 0.10);
}
.assign-tree-scroll {
  max-height: 500px;
  overflow-y: auto;
  padding-right: 4px;
}

.assign-tree-node {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
}
.assign-node-label {
  font-weight: 600;
  color: #1d3148;
  white-space: nowrap;
}
.is-module .assign-node-label {
  font-weight: 800;
  color: #0d1b2d;
}
.is-module {
  padding: 2px 0;
}
.assign-node-code {
  font-size: 11px;
  color: #60748a;
  font-family: monospace;
  margin-left: auto;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: rgba(232, 246, 255, 0.70);
  border: 1px solid rgba(0, 141, 230, 0.10);
  border-radius: 4px;
  padding: 1px 6px;
}

.assign-placeholder {
  padding: 80px 0;
  background: rgba(255, 255, 255, 0.86);
  border: 1px dashed rgba(0, 141, 230, 0.22);
  border-radius: 8px;
}

.tree-tag {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 700;
  white-space: nowrap;
  line-height: 1.5;
}
.tag-module {
  background: rgba(0, 141, 230, 0.10);
  color: #006fc2;
  border: 1px solid rgba(0, 141, 230, 0.22);
}
.tag-action {
  background: rgba(16, 185, 129, 0.10);
  color: #087f5b;
  border: 1px solid rgba(16, 185, 129, 0.22);
}

:deep(.el-select__wrapper),
:deep(.el-input__wrapper) {
  min-height: 34px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(0, 141, 230, 0.18);
  box-shadow: 0 0 0 1px rgba(0, 141, 230, 0.04) inset;
}
:deep(.el-select__wrapper.is-focused),
:deep(.el-input__wrapper.is-focus) {
  border-color: rgba(0, 141, 230, 0.46);
  box-shadow: 0 0 0 3px rgba(0, 141, 230, 0.12);
}
:deep(.el-select__selected-item),
:deep(.el-input__inner) {
  color: #1d3148;
  font-weight: 600;
}
:deep(.el-select__placeholder),
:deep(.el-input__inner::placeholder) {
  color: #6f8194;
  font-weight: 500;
}
:deep(.el-button:not(.el-button--primary)) {
  background: rgba(255, 255, 255, 0.92);
  border-color: rgba(0, 141, 230, 0.18);
  color: #1d3148;
}
:deep(.el-button:not(.el-button--primary):hover) {
  background: rgba(232, 246, 255, 0.95);
  border-color: rgba(0, 141, 230, 0.34);
  color: #006fc2;
}
:deep(.el-button--primary) {
  background: linear-gradient(135deg, #008de6, #006fc2);
  border-color: transparent;
  color: #ffffff;
  box-shadow: 0 8px 18px rgba(0, 111, 194, 0.24);
}
:deep(.el-tree) {
  background: transparent;
  color: #1d3148;
  --el-tree-node-hover-bg-color: rgba(0, 141, 230, 0.07);
}
:deep(.el-tree-node__content) {
  height: 36px;
  border-radius: 6px;
  margin: 2px 0;
  padding-right: 8px;
  transition: background-color 0.16s ease, box-shadow 0.16s ease;
}
:deep(.el-tree-node__content:hover) {
  background: rgba(0, 141, 230, 0.07);
}
:deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: rgba(0, 141, 230, 0.12);
  box-shadow: inset 3px 0 0 #008de6;
}
:deep(.el-checkbox__inner) {
  border-color: rgba(0, 141, 230, 0.36);
}
:deep(.el-checkbox__input.is-checked .el-checkbox__inner),
:deep(.el-checkbox__input.is-indeterminate .el-checkbox__inner) {
  background-color: #008de6;
  border-color: #008de6;
}
:deep(.el-empty__description p) {
  color: #40566f;
  font-weight: 600;
}

:global(.role-select-popper) {
  border: 1px solid rgba(0, 141, 230, 0.18) !important;
  border-radius: 8px !important;
  box-shadow: 0 18px 42px rgba(14, 70, 120, 0.16) !important;
}
:global(.role-select-popper .el-select-dropdown__wrap) {
  max-height: 260px;
}
:global(.role-select-popper .el-select-dropdown__list) {
  padding: 6px;
}
:global(.role-select-popper .el-select-dropdown__item) {
  height: 38px;
  line-height: 38px;
  padding: 0 10px;
  border-radius: 6px;
  color: #1d3148;
}
:global(.role-select-popper .el-select-dropdown__item.is-hovering),
:global(.role-select-popper .el-select-dropdown__item.hover) {
  background: rgba(0, 141, 230, 0.08);
}
:global(.role-select-popper .el-select-dropdown__item.is-selected) {
  background: rgba(0, 141, 230, 0.12);
  color: #006fc2;
  font-weight: 800;
}
:global(.role-select-popper .role-option) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
}
:global(.role-select-popper .role-option-name) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
:global(.role-select-popper .role-option-code) {
  flex-shrink: 0;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #60748a;
  font-size: 12px;
  line-height: 20px;
  background: rgba(232, 246, 255, 0.90);
  border: 1px solid rgba(0, 141, 230, 0.12);
  border-radius: 4px;
  padding: 1px 6px;
}
</style>
