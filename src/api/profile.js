import request from './request.js'

/**
 * 当前用户修改个人信息（真实姓名、手机号、邮箱）。
 * @param {{ realName?: string, phone?: string, email?: string }} data
 */
export function updateProfile(data) {
  return request.put('/api/users/profile', data)
}

/**
 * 当前用户修改登录密码。
 * @param {{ oldPassword: string, newPassword: string }} data
 */
export function changePassword(data) {
  return request.put('/api/users/profile/password', data)
}
