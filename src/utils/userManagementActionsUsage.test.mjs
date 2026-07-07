import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const viewSource = readFileSync(resolve(__dirname, '../views/UserManagement.vue'), 'utf8')
const apiSource = readFileSync(resolve(__dirname, '../api/user.js'), 'utf8')

assert.match(apiSource, /export async function disableUser\(id\)/)
assert.match(apiSource, /request\.put\(`\/api\/users\/\$\{id\}\/disable`\)/)
assert.match(apiSource, /export async function deleteUser\(id\)/)
assert.match(apiSource, /request\.delete\(`\/api\/users\/\$\{id\}`\)/)

assert.match(viewSource, /handleToggleEnabled/)
assert.match(viewSource, /停用/)
assert.match(viewSource, /启用/)
assert.match(viewSource, /handleDelete/)
assert.match(viewSource, /物理删除用户/)
assert.match(viewSource, /row\.enabled === false \? '启用' : '停用'/)
assert.doesNotMatch(viewSource, /:disabled="row\.enabled === false"/)
assert.match(viewSource, /<Delete \/> 删除/)

assert.match(viewSource, /<ElTableColumn prop="displayId" label="ID"/)
assert.doesNotMatch(viewSource, /<ElTableColumn prop="id" label="ID"/)

console.log('userManagementActionsUsage tests passed')
