/**
 * composables/useUserInfo.js
 * 读取本地缓存的用户信息、权限列表、菜单树
 */
import { computed } from 'vue'
import { getUserInfo, getPermissions, getMenus, getPermVersionRef } from '../api/auth.js'

export function useUserInfo() {
  // 追踪权限版本号，使 computed 在权限变更时重新求值
  const permVersion = getPermVersionRef()

  const userInfo = computed(() => getUserInfo() || { username: 'Admin', roleCode: 'SUPER_ADMIN', roleName: '系统管理员' })
  const username = computed(() => userInfo.value?.username || 'Admin')
  const realName = computed(() => userInfo.value?.realName || '未设置')
  const phone = computed(() => userInfo.value?.phone || '未设置')
  const email = computed(() => userInfo.value?.email || '')
  const roleName = computed(() => userInfo.value?.roleName || '系统管理员')
  const permissions = computed(() => {
    permVersion.value  // 建立响应式依赖：版本号递增时重新读取 storage
    return getPermissions()
  })
  const menus = computed(() => getMenus())

  /**
   * 检查是否拥有指定权限
   * @param {string} code 权限编码，如 "device:create"
   */
  function hasPerm(code) {
    return permissions.value.includes(code)
  }

  return { userInfo, username, realName, phone, email, roleName, permissions, menus, hasPerm }
}
