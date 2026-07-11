<script setup>
import { ref, onMounted } from 'vue'
import {
  ElInput, ElButton, ElTable, ElTableColumn, ElTag, ElCard, ElDialog, ElForm, ElFormItem, ElSelect, ElOption, ElMessageBox, ElPagination, ElNotification
} from 'element-plus'
import { Search, Plus, Edit, Delete, CircleClose, CircleCheck, WarningFilled, Download } from '@element-plus/icons-vue'
import { fetchUserList, fetchAllRoles, createUser, updateUser, disableUser, deleteUser, batchDeleteUsers, exportUsers } from '../api/user'
import { useUserInfo } from '../composables/useUserInfo.js'

const { hasPerm } = useUserInfo()

const searchForm = ref({
  username: '',
  realName: '',
  roleId: null
})

const selectedRows = ref([])
const userList = ref([])
const roleList = ref([])
const loading = ref(false)
const total = ref(0)
const currentPage = ref(1)
const pageSize = ref(10)

const dialogVisible = ref(false)
const dialogType = ref('add') // 'add' or 'edit'
const formRef = ref(null)

const formData = ref({
  id: null,
  username: '',
  password: '',
  realName: '',
  phone: '',
  email: '',
  areaCode: '',
  roleId: null,
  enabled: true
})

const createFormData = (user = {}) => ({
  id: user.id ?? null,
  username: user.username ?? '',
  password: '',
  realName: user.realName ?? '',
  phone: user.phone ?? '',
  email: user.email ?? '',
  areaCode: user.areaCode ?? '',
  roleId: user.roleId ?? null,
  enabled: user.enabled ?? true
})

const buildSubmitPayload = () => {
  const {
    id,
    username,
    password,
    realName,
    phone,
    email,
    areaCode,
    roleId,
    enabled
  } = formData.value
  const payload = { id, username, password, realName, phone, email, areaCode, roleId, enabled }

  if (dialogType.value === 'edit' && !payload.password) {
    delete payload.password
  }

  return payload
}

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]{4,20}$/, message: '用户名4-20位，只能包含字母、数字和下划线', trigger: 'change' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, message: '密码至少 8 位', trigger: 'blur' }
  ],
  phone: [
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的11位手机号', trigger: 'blur' }
  ],
  roleId: [{ required: true, message: '请选择角色', trigger: 'change' }]
}

const getRoleTag = (roleCode) => {
  switch (roleCode) {
    case 'SUPER_ADMIN': return { type: 'danger', text: '系统管理员' }
    case 'MUNICIPAL': return { type: 'warning', text: '市政人员' }
    case 'MAINTENANCE': return { type: 'primary', text: '路灯管理员' }
    case 'EMERGENCY': return { type: 'success', text: '安全应急员' }
    default: return { type: 'info', text: '普通用户' }
  }
}

const isSuperAdmin = (row) => row.roleCode === 'SUPER_ADMIN'

const loadRoles = async () => {
  try {
    const res = await fetchAllRoles()
    if (res && res.code === 200) {
      roleList.value = res.data
    } else {
      roleList.value = res || []
    }
  } catch (error) {
    console.error('获取角色失败', error)
  }
}

const loadUsers = async () => {
  loading.value = true
  try {
    const query = {
      page: currentPage.value,
      size: pageSize.value,
      ...searchForm.value
    }
    const res = await fetchUserList(query)
    if (res) {
      userList.value = res.records || res.list || []
      total.value = res.total || 0
    }
  } catch (error) {
    ElNotification.error({ title: '获取用户列表失败', message: '' })
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  currentPage.value = 1
  loadUsers()
}

const handleReset = () => {
  searchForm.value = {
    username: '',
    realName: '',
    roleId: null
  }
  handleSearch()
}

const handleAdd = () => {
  dialogType.value = 'add'
  formData.value = createFormData()
  dialogVisible.value = true
}

const handleEdit = (row) => {
  dialogType.value = 'edit'
  formData.value = createFormData(row)
  dialogVisible.value = true
}

const handleSubmit = async () => {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (valid) {
      const payload = buildSubmitPayload()
      
      try {
        if (dialogType.value === 'add') {
          await createUser(payload)
          ElNotification.success({ title: '新增成功', message: `用户 ${payload.username} 已创建` })
        } else {
          await updateUser(payload.id, payload)
          ElNotification.success({ title: '修改成功', message: `用户 ${payload.username} 已更新` })
        }
        dialogVisible.value = false
        loadUsers()
      } catch (error) {
        ElNotification.error({ title: '操作失败', message: error.message || '' })
      }
    }
  })
}

const handleToggleEnabled = (row) => {
  const isDisabled = row.enabled === false
  const actionText = isDisabled ? '启用' : '停用'
  const message = isDisabled
    ? `确定要启用用户 "${row.username}" 吗？启用后该账号将恢复正常使用。`
    : `确定要停用用户 "${row.username}" 吗？停用后该账号将无法正常使用。`

  ElMessageBox.confirm(message, '警告', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(async () => {
    try {
      if (isDisabled) {
        await updateUser(row.id, { enabled: true })
      } else {
        await disableUser(row.id)
      }
      ElNotification.success({ title: `${actionText}成功`, message: `用户 ${row.username} 已${actionText}` })
      loadUsers()
    } catch (error) {
      ElNotification.error({ title: `${actionText}失败`, message: '' })
    }
  }).catch(() => {})
}

const handleDelete = (row) => {
  ElMessageBox.confirm(`确定要物理删除用户 "${row.username}" 吗？删除后数据将无法恢复。`, '危险操作', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'error'
  }).then(async () => {
    try {
      await deleteUser(row.id)
      ElNotification.success({ title: '删除成功', message: `用户 ${row.username} 已删除` })
      loadUsers()
    } catch (error) {
      ElNotification.error({ title: '删除失败', message: '' })
    }
  }).catch(() => {})
}

function handleSelectionChange(rows) {
  selectedRows.value = rows
}

async function handleBatchDelete() {
  const ids = selectedRows.value.map(r => r.id).filter(Boolean)
  if (!ids.length) {
    ElNotification.warning({ title: '未选择用户', message: '请先勾选需要删除的用户' })
    return
  }
  try {
    await ElMessageBox.confirm(
      `确定要批量删除选中的 ${ids.length} 个用户吗？删除后数据将无法恢复。`,
      '批量删除确认',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'error' }
    )
    await batchDeleteUsers(ids)
    ElNotification.success({ title: '批量删除成功', message: `已删除 ${ids.length} 个用户` })
    selectedRows.value = []
    loadUsers()
  } catch (error) {
    if (error !== 'cancel') {
      ElNotification.error({ title: '批量删除失败', message: '' })
    }
  }
}

async function handleExportUsers(ids) {
  try {
    const params = ids && ids.length > 0 ? { ...searchForm.value, ids } : searchForm.value
    const res = await exportUsers(params)
    // res 是 axios 响应对象，Blob 在 res.data 中
    const blob = res?.data || res
    if (!(blob instanceof Blob)) {
      ElNotification.error({ title: '导出失败', message: '后端返回格式异常' })
      return
    }
    // 从 Content-Disposition 取文件名，否则用默认格式
    const disposition = res?.headers?.['content-disposition'] || ''
    const match = disposition.match(/filename\*?=(?:UTF-8'')?([^;\s]+)/i)
    const filename = match
      ? decodeURIComponent(match[1])
      : `users_${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}.xlsx`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    ElNotification.success({ title: '导出成功', message: `文件 ${filename} 已下载` })
  } catch (error) {
    ElNotification.error({ title: '导出失败', message: '' })
  }
}

const formatDateTime = (dateRaw) => {
  if (!dateRaw) return '--';
  let dateArr = dateRaw;
  if (typeof dateRaw === 'string' && dateRaw.includes(',')) {
    dateArr = dateRaw.split(',').filter(x => x !== '').map(Number);
  }
  if (Array.isArray(dateArr) && dateArr.length >= 6) {
    const [y, m, d, h, min, s] = dateArr;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  try {
    const d = new Date(dateRaw);
    if (isNaN(d.getTime())) return String(dateRaw);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch(e) {
    return String(dateRaw);
  }
};

onMounted(() => {
  loadRoles()
  loadUsers()
})
</script>

<template>
  <div class="user-manage-page">
    <div class="page-header">
      <div>
        <h1 class="page-title">用户管理</h1>
        <p class="page-sub">管理系统用户、角色分配与账号状态</p>
      </div>
    </div>

    <div class="search-bar">
      <ElForm :inline="true" :model="searchForm" class="search-form">
        <ElFormItem label="用户名">
          <ElInput v-model="searchForm.username" placeholder="请输入用户名" clearable />
        </ElFormItem>
        <ElFormItem label="姓名">
          <ElInput v-model="searchForm.realName" placeholder="请输入姓名" clearable />
        </ElFormItem>
        <ElFormItem label="角色">
          <ElSelect v-model="searchForm.roleId" placeholder="请选择角色" clearable style="width: 180px">
            <ElOption v-for="role in roleList" :key="role.id" :label="role.name" :value="role.id" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem>
          <ElButton type="primary" @click="handleSearch"><Search /> 查询</ElButton>
          <ElButton @click="handleReset">重置</ElButton>
          <ElButton @click="handleExportUsers"><Download /> 导出</ElButton>
          <ElButton v-if="hasPerm('user:create')" type="success" @click="handleAdd"><Plus /> 新增用户</ElButton>
        </ElFormItem>
      </ElForm>
    </div>

    <div class="batch-bar" v-if="selectedRows.length > 0">
      <span class="batch-bar-info">已选 <strong>{{ selectedRows.length }}</strong> 人</span>
      <button v-if="hasPerm('user:delete')" class="batch-bar-btn danger-btn" @click="handleBatchDelete">
        <Delete style="width:13px;height:13px" /> 批量删除
      </button>
      <button class="batch-bar-btn export-btn" @click="handleExportUsers(selectedRows.map(r => r.id))">
        <Download style="width:13px;height:13px" /> 导出用户
      </button>
      <button class="batch-bar-btn cancel-btn" @click="selectedRows = []">取消选择</button>
    </div>

    <div class="user-content" v-loading="loading">
      <ElTable :data="userList" border stripe style="width: 100%" @sort-change="() => {}" @selection-change="handleSelectionChange">
        <ElTableColumn type="selection" width="50" />
        <template #empty>
          <div class="empty-illust">
            <svg viewBox="0 0 120 80" fill="none" width="100" height="66">
              <rect x="25" y="12" width="70" height="56" rx="6" stroke="#b0cadd" stroke-width="1" fill="rgba(176,202,221,0.05)"/>
              <circle cx="60" cy="30" r="8" stroke="#b0cadd" stroke-width="1" fill="rgba(176,202,221,0.08)"/>
              <path d="M55-41l4 4-6 6" stroke="#b0cadd" stroke-width="0.8" stroke-linecap="round"/>
              <rect x="46" y="44" width="28" height="14" rx="7" stroke="#b0cadd" stroke-width="1" fill="rgba(176,202,221,0.06)"/>
              <path d="M34 18l-8-4M86 18l8-4M30 66l-6 4M90 66l6 4" stroke="#b0cadd" stroke-width="0.6" stroke-linecap="round" opacity="0.4"/>
            </svg>
            <p>暂无用户数据</p>
          </div>
        </template>
        <ElTableColumn prop="displayId" label="ID" width="80" sortable="custom" />
        <ElTableColumn prop="username" label="用户名" min-width="120" sortable="custom" show-overflow-tooltip />
        <ElTableColumn prop="realName" label="真实姓名" min-width="100" sortable="custom" show-overflow-tooltip />
        <ElTableColumn label="角色" min-width="120" sortable="custom" prop="roleName">
          <template #default="{ row }">
            <ElTag v-if="row.roleCode" :type="getRoleTag(row.roleCode).type">
              {{ row.roleName }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="phone" label="联系电话" min-width="120" />
        <ElTableColumn prop="email" label="邮箱" min-width="160" show-overflow-tooltip />
        <ElTableColumn label="状态" width="100" sortable="custom" prop="enabled">
          <template #default="{ row }">
            <ElTag :type="row.enabled ? 'success' : 'danger'">
              {{ row.enabled ? '正常' : '停用' }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="创建时间" min-width="160" sortable="custom" prop="createTime">
          <template #default="{ row }">
            <span class="time-cell">
              {{ formatDateTime(row.createTime) }}
            </span>
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <template v-if="!isSuperAdmin(row)">
              <ElButton v-if="hasPerm('user:update')" type="primary" link @click="handleEdit(row)"><Edit /> 编辑</ElButton>
              <ElButton v-if="hasPerm('user:update')" :type="row.enabled === false ? 'success' : 'warning'" link @click="handleToggleEnabled(row)">
                <CircleCheck v-if="row.enabled === false" />
                <CircleClose v-else />
                {{ row.enabled === false ? '启用' : '停用' }}
              </ElButton>
              <ElButton v-if="hasPerm('user:delete')" type="danger" link @click="handleDelete(row)"><Delete /> 删除</ElButton>
            </template>
            <span v-else class="super-admin-badge">不可操作</span>
          </template>
        </ElTableColumn>
      </ElTable>

      <div class="pagination-wrapper" v-if="total > 0">
        <ElPagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          @size-change="loadUsers"
          @current-change="loadUsers"
        />
      </div>
    </div>

    <!-- 用户表单弹窗 -->
    <ElDialog
      v-model="dialogVisible"
      :title="dialogType === 'add' ? '新增用户' : '编辑用户'"
      width="500px"
      custom-class="dark-dialog"
    >
      <ElForm ref="formRef" :model="formData" :rules="rules" label-width="100px">
        <ElFormItem label="用户名" prop="username">
          <ElInput v-model="formData.username" :disabled="dialogType === 'edit'" placeholder="4-20位字母、数字或下划线" maxlength="20" show-word-limit />
        </ElFormItem>
        <ElFormItem label="密码" :prop="dialogType === 'add' ? 'password' : ''">
          <ElInput v-model="formData.password" type="password" placeholder="请输入密码" show-password />
          <div v-if="dialogType === 'edit'" class="form-hint">留空表示不修改密码</div>
        </ElFormItem>
        <ElFormItem label="真实姓名" prop="realName">
          <ElInput v-model="formData.realName" placeholder="请输入真实姓名" />
        </ElFormItem>
        <ElFormItem label="角色" prop="roleId">
          <ElSelect v-model="formData.roleId" placeholder="请选择角色" style="width: 100%">
            <ElOption v-for="role in roleList" :key="role.id" :label="role.name" :value="role.id" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="联系电话" prop="phone">
          <ElInput v-model="formData.phone" placeholder="请输入联系电话" />
        </ElFormItem>
        <ElFormItem label="邮箱" prop="email">
          <ElInput v-model="formData.email" placeholder="请输入邮箱" />
        </ElFormItem>
        <ElFormItem label="账号状态" prop="enabled">
          <ElSelect v-model="formData.enabled" style="width: 100%">
            <ElOption label="正常" :value="true" />
            <ElOption label="停用" :value="false" />
          </ElSelect>
        </ElFormItem>
      </ElForm>
      <template #footer>
        <span class="dialog-footer">
          <ElButton @click="dialogVisible = false">取消</ElButton>
          <ElButton type="primary" @click="handleSubmit">确定</ElButton>
        </span>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.user-manage-page {
  padding: 24px 28px;
  min-height: 100vh;
  background: transparent !important;
  color: #1d3148;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 20px;
}
.page-title {
  font-size: 22px;
  font-weight: 800;
  color: #0d1b2d;
  margin: 0 0 4px;
}
.page-sub {
  font-size: 13px;
  color: #40566f;
  margin: 0;
  font-weight: 500;
}

.search-bar {
  background: rgba(255, 255, 255, 0.94) !important;
  backdrop-filter: blur(16px) saturate(1.12);
  border: 1px solid rgba(0, 141, 230, 0.16) !important;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
  box-shadow: 0 18px 40px rgba(30, 86, 130, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.92) !important;
}

.user-content {
  background: rgba(255, 255, 255, 0.94) !important;
  backdrop-filter: blur(16px) saturate(1.12);
  border: 1px solid rgba(0, 141, 230, 0.16) !important;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 18px 40px rgba(30, 86, 130, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.92) !important;
}

.batch-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  margin-bottom: 16px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(0, 141, 230, 0.16);
  border-radius: 8px;
  box-shadow: 0 12px 28px rgba(30, 86, 130, 0.08);
}
.batch-bar-info {
  font-size: 13px;
  color: #1d3148;
  font-weight: 600;
}
.batch-bar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border: 1px solid rgba(0, 141, 230, 0.18);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  background: rgba(255,255,255,0.9);
  color: #1d3148;
  transition: all 0.18s;
}
.batch-bar-btn:hover { background: rgba(232, 246, 255, 0.9); border-color: rgba(0,141,230,0.3); }
.danger-btn { color: #c62f36; border-color: rgba(198,47,54,0.22); }
.danger-btn:hover { background: rgba(229,72,77,0.08); border-color: rgba(198,47,54,0.3); }
.export-btn { color: #006fc2; }
.cancel-btn { margin-left: auto; color: #60748a; font-weight: 500; }

.form-hint {
  font-size: 12px;
  color: #40566f;
  margin-top: 4px;
}

.pagination-wrapper {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
}

.time-cell {
  font-family: monospace;
  color: #40566f;
  letter-spacing: 0.5px;
  font-weight: 600;
}

/* Deep styling for Element Plus to match the light sci-fi theme */
:deep(.el-form-item__label) {
  color: #1d3148 !important;
  font-weight: 700;
}

:deep(.el-input__wrapper), :deep(.el-select__wrapper) {
  background: rgba(255, 255, 255, 0.94) !important;
  border-color: rgba(0, 141, 230, 0.18) !important;
  box-shadow: 0 0 0 1px rgba(0, 141, 230, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.92) !important;
}

:deep(.el-input__inner),
:deep(.el-select__selected-item),
:deep(.el-select__placeholder) {
  color: #0d1b2d !important;
  font-weight: 600;
}

:deep(.el-input__inner::placeholder) {
  color: #6f8194 !important;
}

:deep(.el-table) {
  background: transparent !important;
  --el-table-border-color: rgba(16, 126, 196, 0.12);
  --el-table-header-bg-color: rgba(232, 246, 255, 0.82);
  --el-table-header-text-color: #0d1b2d;
  --el-table-text-color: #1d3148;
  --el-table-row-hover-bg-color: rgba(0, 141, 230, 0.06);
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
}

:deep(.el-table th.el-table__cell) {
  background: linear-gradient(180deg, rgba(236, 248, 255, 0.95), rgba(222, 241, 255, 0.78)) !important;
  color: #0d1b2d !important;
  font-weight: 800;
  border-bottom: 1px solid rgba(16, 126, 196, 0.12);
}

:deep(.el-table td.el-table__cell) {
  background: rgba(255, 255, 255, 0.72) !important;
  color: #1d3148 !important;
  border-bottom: 1px solid rgba(16, 126, 196, 0.1);
  font-weight: 500;
}

:deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: rgba(244, 250, 255, 0.82) !important;
}

:deep(.el-table__body tr:hover > td.el-table__cell) {
  background: rgba(0, 141, 230, 0.07) !important;
}

:deep(.el-table .cell) {
  color: inherit !important;
}

:deep(.el-tag) {
  font-weight: 700;
}

:deep(.el-button.is-link) {
  font-weight: 700;
}

:deep(.el-button.is-link.el-button--primary) {
  color: #006fc2 !important;
}

:deep(.el-button.is-link.el-button--danger) {
  color: #c62f36 !important;
}

.super-admin-badge {
  display: inline-block;
  padding: 2px 10px;
  font-size: 12px;
  font-weight: 700;
  color: #60748a;
  background: rgba(96, 116, 138, 0.1);
  border: 1px solid rgba(96, 116, 138, 0.18);
  border-radius: 4px;
  cursor: default;
}

/* Empty illustration */
.empty-illust {
  text-align: center;
  padding: 40px 0;
  color: #6f8194;
  font-size: 14px;
}

:deep(.el-pagination) {
  --el-pagination-bg-color: rgba(255, 255, 255, 0.82);
  --el-pagination-text-color: #1d3148;
  --el-pagination-button-color: #1d3148;
  --el-pagination-button-disabled-bg-color: rgba(232, 246, 255, 0.62);
}

@media (max-width: 900px) {
  .user-manage-page { padding: 16px; }
  .page-header { flex-direction: column; }
  .search-form :deep(.el-form-item) { display: block; width: 100%; }
  .search-form :deep(.el-form-item__content) { width: 100%; }
  .user-content { padding: 12px; overflow-x: auto; }
}
</style>
