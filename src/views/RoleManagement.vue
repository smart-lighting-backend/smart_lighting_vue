<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  ElButton, ElTable, ElTableColumn, ElTag, ElDialog, ElForm, ElFormItem, ElInput,
  ElMessage, ElMessageBox, ElCard, ElPagination, ElEmpty, ElNotification, ElTooltip
} from 'element-plus'
import { Edit, Delete, Key, Plus, CircleCheck, CircleClose, WarningFilled } from '@element-plus/icons-vue'
import { fetchRoleList, createRole, updateRole, deleteRole } from '../api/role.js'
import { useUserInfo } from '../composables/useUserInfo.js'
import { useRouter } from 'vue-router'

const { hasPerm } = useUserInfo()
const router = useRouter()

// ═══════════════════ 角色列表 ═══════════════════
const roleList = ref([])
const loading = ref(false)

const dialogVisible = ref(false)
const dialogTitle = ref('')
const formRef = ref(null)
const formData = ref({
  id: null,
  name: '',
  code: '',
  description: ''
})

const buildFormData = (role = {}) => ({
  id: role.id ?? null,
  name: role.name ?? '',
  roleCode: role.roleCode ?? role.code ?? '',
  description: role.description ?? ''
})

const rules = {
  name: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
  roleCode: [
    { required: true, message: '请输入角色编码', trigger: 'blur' },
    { pattern: /^[A-Z_]+$/, message: '角色编码只能包含大写字母和下划线', trigger: 'blur' }
  ]
}

const PROTECTED_ROLES = ['SUPER_ADMIN']

const isProtected = (role) => role && PROTECTED_ROLES.includes(role.roleCode)

const loadRoles = async () => {
  loading.value = true
  try {
    const res = await fetchRoleList()
    roleList.value = res?.code === 200 ? (res.data || []) : (res || [])
  } catch (error) {
    ElNotification.error({ title: '获取角色列表失败', message: '' })
  } finally {
    loading.value = false
  }
}

const handleAdd = () => {
  dialogTitle.value = '新增角色'
  formData.value = buildFormData()
  dialogVisible.value = true
}

const handleEdit = (row) => {
  dialogTitle.value = '编辑角色'
  formData.value = buildFormData(row)
  dialogVisible.value = true
}

const handleSubmit = async () => {
  if (!formRef.value) return
  await formRef.value.validate(async (valid) => {
    if (!valid) return
    const payload = {
      name: formData.value.name,
      roleCode: formData.value.roleCode,
      description: formData.value.description || ''
    }
    try {
      if (formData.value.id) {
        await updateRole(formData.value.id, payload)
        ElNotification.success({ title: '修改成功', message: `角色 ${payload.name} 已更新` })
      } else {
        await createRole(payload)
        ElNotification.success({ title: '新增成功', message: `角色 ${payload.name} 已创建` })
      }
      dialogVisible.value = false
      loadRoles()
    } catch (error) {
      const msg = error?.response?.data?.msg || error?.message || ''
      ElNotification.error({ title: '操作失败', message: msg || '' })
    }
  })
}

const handleDelete = (row) => {
  ElMessageBox.confirm(
    `确定要删除角色 "${row.name}" 吗？删除后关联的权限关系将一并清除，数据不可恢复。`,
    '危险操作',
    { confirmButtonText: '删除', cancelButtonText: '取消', type: 'error' }
  ).then(async () => {
    try {
      await deleteRole(row.id)
      ElNotification.success({ title: '删除成功', message: `角色 ${row.name} 已删除` })
      loadRoles()
    } catch (error) {
      ElNotification.error({ title: '删除失败', message: '' })
    }
  }).catch(() => {})
}

const handleAssignPermission = (row) => {
  router.push({
    path: '/system/permission',
    query: { roleId: row.id }
  })
}

onMounted(() => {
  loadRoles()
})
</script>

<template>
  <div class="role-manage-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <h2 class="page-header-title">角色管理</h2>
      <p class="page-header-desc">管理系统角色，支持新增、编辑、删除角色，以及跳转至权限管理分配具体权限</p>
    </div>

    <!-- 操作栏 -->
    <div class="action-bar">
      <ElButton type="primary" @click="handleAdd" v-if="hasPerm('role:create')">
        <Plus /> 新增角色
      </ElButton>
    </div>

    <!-- 角色列表 -->
    <ElCard class="role-content" shadow="never">
      <ElTable :data="roleList" border stripe v-loading="loading" style="width: 100%">
        <template #empty>
          <ElEmpty description="暂无角色数据" />
        </template>
        <ElTableColumn type="index" label="序号" width="70" align="center" />
        <ElTableColumn prop="name" label="角色名称" min-width="140" show-overflow-tooltip />
        <ElTableColumn prop="roleCode" label="角色编码" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="code-text">{{ row.roleCode }}</span>
          </template>
        </ElTableColumn>
        <ElTableColumn prop="description" label="描述" min-width="200" show-overflow-tooltip />
        <ElTableColumn label="权限数" width="100" align="center">
          <template #default="{ row }">
            <ElTag :type="(row.permissionCodes?.length || 0) > 0 ? 'primary' : 'info'" effect="plain" round>
              {{ row.permissionCodes?.length ?? 0 }}
            </ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="状态" width="90" align="center">
          <template #default="{ row }">
            <ElTag v-if="isProtected(row)" type="danger" effect="dark" size="small">内置</ElTag>
          </template>
        </ElTableColumn>
        <ElTableColumn label="操作" width="270" align="center" fixed="right">
          <template #default="{ row }">
            <template v-if="isProtected(row)">
              <ElTooltip content="内置角色不可操作" placement="top">
                <span class="disabled-op">
                  <ElButton size="small" disabled><Edit style="width:12px;height:12px" /> 编辑</ElButton>
                  <ElButton size="small" disabled><Key style="width:12px;height:12px" /> 分配权限</ElButton>
                  <ElButton size="small" disabled><Delete style="width:12px;height:12px" /> 删除</ElButton>
                </span>
              </ElTooltip>
            </template>
            <template v-else>
              <ElButton size="small" type="primary" plain @click="handleEdit(row)" v-if="hasPerm('role:update')">
                <Edit style="width:12px;height:12px" /> 编辑
              </ElButton>
              <ElButton size="small" type="warning" plain @click="handleAssignPermission(row)" v-if="hasPerm('role:assign')">
                <Key style="width:12px;height:12px" /> 分配权限
              </ElButton>
              <ElButton size="small" type="danger" plain @click="handleDelete(row)" v-if="hasPerm('role:delete')">
                <Delete style="width:12px;height:12px" /> 删除
              </ElButton>
            </template>
          </template>
        </ElTableColumn>
      </ElTable>
    </ElCard>

    <!-- 新增/编辑弹窗 -->
    <ElDialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="480px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <ElForm
        ref="formRef"
        :model="formData"
        :rules="rules"
        label-width="80px"
        class="role-form"
        @submit.prevent
      >
        <ElFormItem label="角色名称" prop="name">
          <ElInput v-model.trim="formData.name" placeholder="如 系统管理员" maxlength="30" show-word-limit />
        </ElFormItem>
        <ElFormItem label="角色编码" prop="roleCode">
          <ElInput
            v-model.trim="formData.roleCode"
            placeholder="如 SUPER_ADMIN，只能包含大写字母和下划线"
            maxlength="30"
            show-word-limit
          />
        </ElFormItem>
        <ElFormItem label="描述" prop="description">
          <ElInput
            v-model.trim="formData.description"
            type="textarea"
            :rows="3"
            placeholder="角色功能说明（选填）"
            maxlength="200"
            show-word-limit
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <ElButton @click="dialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="handleSubmit">确认</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.role-manage-page {
  padding: 0;
}

.page-header {
  margin-bottom: 20px;
}
.page-header-title {
  font-size: 20px;
  font-weight: 700;
  color: #0d1b2d;
  margin: 0 0 6px 0;
}
.page-header-desc {
  font-size: 13px;
  color: #60748a;
  margin: 0;
}

.action-bar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}

.role-content {
  background: rgba(255, 255, 255, 0.94) !important;
  backdrop-filter: blur(16px) saturate(1.12);
  border: 1px solid rgba(0, 141, 230, 0.16) !important;
  border-radius: 8px;
  padding: 4px 20px 20px;
  box-shadow: 0 18px 40px rgba(30, 86, 130, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.92) !important;
}

.code-text {
  font-family: 'Inter', 'SF Mono', 'Fira Code', monospace;
  font-weight: 600;
  font-size: 13px;
  color: #006fc2;
  letter-spacing: 0.3px;
}

.disabled-op {
  display: inline-flex;
  gap: 4px;
  opacity: 0.55;
}

.role-form {
  padding: 8px 16px 0;
}
</style>
