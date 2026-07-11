<script setup>
import { ref, onMounted, onActivated, nextTick, computed, watch } from 'vue'
import { useAutoRefresh } from '../composables/useAutoRefresh.js'
import { useMqtt } from '../composables/useMqtt.js'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, ElCascader } from 'element-plus'
import { Plus, Edit, Delete, Location, Download, Upload, Connection, CircleClose, CircleCheck, Sunny, Moon } from '@element-plus/icons-vue'
import { createDevice, deleteDevice, fetchDeviceList, updateDevice, batchDeviceArea, batchDisableDevices, batchEnableDevices, batchTurnOnDevices, batchTurnOffDevices, batchDeleteDevices, STATUS_MAP, STATUS_QUERY_MAP } from '../api/devices.js'
import { fetchAreaTree } from '../api/area.js'
import { useUserInfo } from '../composables/useUserInfo.js'
import LocationPicker from '../components/LocationPicker.vue'
import BatchImport from '../components/BatchImport.vue'
import { exportDevices } from '../utils/excelTemplate.js'

const router = useRouter()
const { hasPerm } = useUserInfo()
const devices  = ref([])
const loading  = ref(false)
const togglingDeviceId = ref('')
const search   = ref('')
const areaFilter = ref('全部')
const statusFilter = ref('全部')
const statuses = ['全部', '在线', '离线', '异常', '停用']
const pageNum = ref(1)
const pageSize = ref(12)
const pageSizeOptions = [12, 24, 36, 48]
const areaOptions = computed(() => {
  const areas = [...new Set(devices.value.map(d => d.area || '未分类'))]
  return ['全部', ...areas.sort()]
})
const createDialogVisible = ref(false)
const createFormRef = ref(null)
const creatingDevice = ref(false)
const createDialogMode = ref('create')
const editingDeviceId = ref('')
const deletingDeviceId = ref('')
const createStatusOptions = [
  { label: '在线', value: 1 },
  { label: '离线', value: 2 },
  { label: '异常', value: 3 },
  { label: '停用', value: 0 },
]
const createForm = ref(buildCreateForm())
const locationPickerVisible = ref(false)
const locationCoords = ref({ lng: '', lat: '' })
const batchImportVisible = ref(false)
const existingDeviceIds = computed(() => devices.value.map(d => d.deviceId))
const areaBindingDialogVisible = ref(false)
const areaBindingDevice = ref(null)
const areaBindingTargetId = ref(null)
const areaBindingSubmitting = ref(false)
const areaUnbindingDeviceId = ref('')

function handleExport(area) {
  let list
  if (!area || area === '全部') {
    list = devices.value
  } else if (area === '未分类') {
    list = devices.value.filter(d => !d.area)
  } else {
    list = devices.value.filter(d => d.area === area)
  }
  if (!list.length) { ElMessage.warning('没有可导出的设备'); return }
  const label = area === '未分类' ? '' : area
  exportDevices(list, label)
  ElMessage.success(`已导出 ${list.length} 台设备`)
}

function onBatchImported() {
  loadDevices()
}

function makeCoordRule(field) {
  return [
    {
      validator: (_rule, value, callback) => {
        if (value === '' || value === null || value === undefined) { callback(); return }
        if (isNaN(Number(value))) {
          callback(new Error(`${field}请输入有效数字`))
          return
        }
        callback()
      },
      trigger: 'blur',
    },
  ]
}

const DEVICE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_]*$/

const createRules = {
  deviceId: [
    { required: true, message: '请输入设备编号', trigger: 'blur' },
    { pattern: DEVICE_ID_PATTERN, message: '设备编号只能包含字母、数字和下划线，且不能以下划线开头', trigger: 'blur' },
  ],
  status: [{ required: true, message: '请选择设备状态', trigger: 'change' }],
  longitude: makeCoordRule('经度'),
  latitude: makeCoordRule('纬度'),
}

function openLocationPicker() {
  locationCoords.value = {
    lng: createForm.value.longitude || '',
    lat: createForm.value.latitude || '',
  }
  locationPickerVisible.value = true
}

function onLocationPicked(coords) {
  createForm.value.longitude = coords.lng
  createForm.value.latitude = coords.lat
  createFormRef.value?.validateField('longitude')
  createFormRef.value?.validateField('latitude')
}

function buildCreateForm() {
  return {
    deviceId: '',
    name: '',
    area: '',
    areaId: null,
    longitude: '',
    latitude: '',
    factorySerial: '',
    status: 1,
    healthScore: 100,
    topicPrefix: 'streetlight',
    enabled: true,
  }
}

async function loadDevices() {
  loading.value = true
  try {
    const statusVal = STATUS_QUERY_MAP[statusFilter.value]
    const res = await fetchDeviceList({ status: statusVal, pageSize: 10000 })
    // 后端返回数组或 data 字段
    const raw = Array.isArray(res) ? res : (res.data || [])
    devices.value = raw
  } finally {
    loading.value = false
  }
}

// 设备列表每 5 分钟自动刷新，敏感操作时跳过
useAutoRefresh(async () => {
  try {
    const statusVal = STATUS_QUERY_MAP[statusFilter.value]
    const res = await fetchDeviceList({ status: statusVal, pageSize: 10000 })
    const raw = Array.isArray(res) ? res : (res.data || [])
    devices.value = raw
  } catch {}
}, {
  interval: 60000,
  isSensitive: () => createDialogVisible.value || deletingDeviceId.value || togglingDeviceId.value || areaBindingDialogVisible.value || areaUnbindingDeviceId.value || batchOperating.value,
})

onMounted(() => {
  loadDevices()
  const { subscribe } = useMqtt()
  subscribe('streetlight/+/heartbeat', () => {
    const statusVal = STATUS_QUERY_MAP[statusFilter.value]
    fetchDeviceList({ status: statusVal, pageSize: 10000 }).then(res => {
      const raw = Array.isArray(res) ? res : (res.data || [])
      devices.value = raw
    }).catch(() => {})
  })
})
onActivated(() => {
  nextTick(() => loadDevices())
})

// 所选区域变化时同步 area 文本
watch(() => createForm.value?.areaId, (id) => {
  if (!createForm.value) return
  createForm.value.area = id ? getAreaPathById(id) : ''
})

const filtered = computed(() => {
  const kw = search.value.toLowerCase()
  return devices.value.filter(d => {
    const matchSearch = !kw || d.deviceId?.toLowerCase().includes(kw) || d.name?.toLowerCase().includes(kw) || d.area?.toLowerCase().includes(kw)
    if (areaFilter.value === '未分类') { if (d.area) return false }
    else if (areaFilter.value !== '全部' && d.area !== areaFilter.value) return false
    if (statusFilter.value === '全部') return matchSearch
    const statusVal = STATUS_QUERY_MAP[statusFilter.value]
    return matchSearch && displayStatus(d) === statusVal
  })
})

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))
const pageStart = computed(() => filtered.value.length ? (pageNum.value - 1) * pageSize.value + 1 : 0)
const pageEnd = computed(() => Math.min(pageNum.value * pageSize.value, filtered.value.length))
const pagedDevices = computed(() => {
  const start = (pageNum.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

watch([search, areaFilter, statusFilter], () => {
  pageNum.value = 1
})

watch(() => filtered.value.length, () => {
  if (pageNum.value > pageCount.value) pageNum.value = pageCount.value
})

function handlePageChange(page) {
  pageNum.value = page
}

function handlePageSizeChange(size) {
  pageSize.value = size
  pageNum.value = 1
}

function doFilterChange() { loadDevices() }

function healthColor(score) {
  if (!score && score !== 0) return '#60748a'
  if (score >= 80) return '#4caf50'
  if (score >= 60) return '#ffa726'
  return '#ef5350'
}

function displayStatus(device) {
  return device?.enabled === false ? 0 : device?.status
}

function getStatusMeta(device) {
  return STATUS_MAP[displayStatus(device)] || { label: '未知', cls: 'offline' }
}

function deviceHasArea(device) {
  return (device?.areaId !== undefined && device?.areaId !== null) || Boolean(device?.area)
}

function displayAreaName(device) {
  return device?.area || (deviceHasArea(device) ? `区域ID: ${device.areaId}` : '未绑定区域')
}

function openCreateDialog() {
  createDialogMode.value = 'create'
  editingDeviceId.value = ''
  createForm.value = buildCreateForm()
  ensureAreaTreeLoaded()
  createDialogVisible.value = true
}

function openEditDialog(device) {
  createDialogMode.value = 'edit'
  editingDeviceId.value = device.deviceId
  const locParts = (device.location || '').split(',').map(s => s.trim())
  createForm.value = {
    deviceId: device.deviceId || '',
    name: device.name || '',
    area: device.area || '',
    areaId: findAreaIdByName(device.area) ?? null,
    longitude: locParts[0] || '',
    latitude: locParts[1] || '',
    status: displayStatus(device) ?? 1,
    healthScore: device.healthScore ?? 100,
    topicPrefix: device.topicPrefix || 'streetlight',
    enabled: device.enabled !== false,
  }
  ensureAreaTreeLoaded()
  createDialogVisible.value = true
}

function resetCreateForm() {
  createForm.value = buildCreateForm()
  createDialogMode.value = 'create'
  editingDeviceId.value = ''
  createFormRef.value?.clearValidate?.()
}

function normalizeOptionalText(value) {
  const text = `${value ?? ''}`.trim()
  return text || undefined
}

function buildCreatePayload() {
  const formStatus = Number(createForm.value.status ?? 1)
  const enabled = formStatus !== 0
  const lng = createForm.value.longitude?.toString().trim()
  const lat = createForm.value.latitude?.toString().trim()
  const location = (lng && lat) ? `${lng},${lat}` : undefined
  return {
    deviceId: createForm.value.deviceId.trim(),
    name: normalizeOptionalText(createForm.value.name),
    area: normalizeOptionalText(createForm.value.area),
    location,
    factorySerial: normalizeOptionalText(createForm.value.factorySerial),
    status: enabled ? formStatus : 0,
    healthScore: createForm.value.healthScore === '' || createForm.value.healthScore === null
      ? undefined
      : Number(createForm.value.healthScore),
    topicPrefix: normalizeOptionalText(createForm.value.topicPrefix),
    enabled,
  }
}

function upsertCreatedDevice(device) {
  if (!device?.deviceId) return
  const idx = devices.value.findIndex(d => d.deviceId === device.deviceId)
  if (idx === -1) {
    devices.value.unshift(device)
    return
  }
  devices.value.splice(idx, 1, { ...devices.value[idx], ...device })
}

let _lastWarnedCode = ''
function onDeviceIdBlur() {
  const code = createForm.value.deviceId?.trim()
  if (code && !DEVICE_ID_PATTERN.test(code) && code !== _lastWarnedCode) {
    _lastWarnedCode = code
    ElMessage.warning('设备编号只能包含字母、数字和下划线，且不能以下划线开头')
  }
}

async function submitCreateDevice() {
  if (!createFormRef.value) return

  // 设备编号格式校验
  const code = createForm.value.deviceId?.trim()
  if (code && !DEVICE_ID_PATTERN.test(code)) {
    ElMessage.warning('设备编号只能包含字母、数字和下划线，且不能以下划线开头')
    return
  }

  const valid = await createFormRef.value.validate().catch(() => false)
  if (!valid) return

  creatingDevice.value = true
  try {
    const payload = buildCreatePayload()
    if (createDialogMode.value === 'edit') {
      const { deviceId: _deviceId, ...updatePayload } = payload
      const res = await updateDevice(editingDeviceId.value, updatePayload)
      const updated = res?.data || { deviceId: editingDeviceId.value, ...updatePayload }
      upsertCreatedDevice(updated)
      ElMessage.success('修改设备成功')
    } else {
      const res = await createDevice(payload)
      const created = res?.data || { id: Date.now(), deleted: false, ...payload }
      upsertCreatedDevice(created)
      ElMessage.success('新增设备成功')
    }
    createDialogVisible.value = false
  } catch (error) {
    ElMessage.error(error?.message || (createDialogMode.value === 'edit' ? '修改设备失败' : '新增设备失败'))
  } finally {
    creatingDevice.value = false
  }
}

async function removeDevice(device) {
  try {
    await ElMessageBox.confirm(
      `确认删除设备“${device.name || device.deviceId}”？删除后设备将从列表中移除。`,
      '删除设备',
      {
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )
  } catch {
    return
  }

  deletingDeviceId.value = device.deviceId
  try {
    await deleteDevice(device.deviceId)
    devices.value = devices.value.filter(d => d.deviceId !== device.deviceId)
    ElMessage.success('删除设备成功')
  } catch (error) {
    ElMessage.error(error?.message || '删除设备失败')
  } finally {
    deletingDeviceId.value = ''
  }
}

async function toggleEnabled(device) {
  const currentEnabled = device.enabled !== false
  const nextEnabled = !currentEnabled
  const actionText = nextEnabled ? '启用' : '停用'
  const nextStatus = nextEnabled ? 2 : 0

  try {
    await ElMessageBox.confirm(
      `确认${actionText}设备“${device.name || device.deviceId}”？`,
      `${actionText}设备`,
      {
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        type: nextEnabled ? 'info' : 'warning',
      }
    )
  } catch {
    return
  }

  togglingDeviceId.value = device.deviceId
  try {
    const res = await updateDevice(device.deviceId, { enabled: nextEnabled, status: nextStatus })
    const updated = res?.data || {}
    const idx = devices.value.findIndex(d => d.deviceId === device.deviceId)
    if (idx !== -1) {
      devices.value.splice(idx, 1, {
        ...devices.value[idx],
        ...updated,
        enabled: nextEnabled,
        status: nextStatus,
      })
    }
    ElMessage.success(`${actionText}成功`)
  } catch (error) {
    ElMessage.error(error?.message || `${actionText}失败`)
  } finally {
    togglingDeviceId.value = ''
  }
}

// 格式化最后心跳时间
function formatTime(iso) {
  if (!iso) return '--'
  // 兼容后端 LocalDateTime 数组格式 [2026,7,3,10,39,6]
  if (Array.isArray(iso)) {
    const [y, m, d, h, mi] = iso
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')} ${String(h).padStart(2,'0')}:${String(mi).padStart(2,'0')}`
  }
  return iso.replace('T', ' ').slice(0, 16)
}

// ── 批量操作 ────────────────────────────────────────────────────────────────
const selectMode = ref(false)
const selectedIds = ref([])
const batchDialogVisible = ref(false)
const batchTargetAreaId = ref(null)
const areaTreeOptions = ref([])
const batchOperating = ref(false)

/** 加载区域树用于 Cascader 选择 */
async function loadAreaTree() {
  try {
    const res = await fetchAreaTree()
    const raw = Array.isArray(res) ? res : (res.data || [])
    areaTreeOptions.value = mapAreaTreeToOptions(raw)
  } catch {
    areaTreeOptions.value = []
  }
}
function mapAreaTreeToOptions(tree, parentPath = []) {
  return (tree || []).map(node => ({
    value: node.id,
    label: node.name,
    areaPath: [...parentPath, node.name].filter(Boolean).join('-'),
    children: node.children?.length ? mapAreaTreeToOptions(node.children, [...parentPath, node.name]) : undefined,
  }))
}

async function ensureAreaTreeLoaded() {
  if (!areaTreeOptions.value.length) {
    await loadAreaTree()
  }
}

function findAreaOptionById(options, areaId) {
  for (const option of options || []) {
    if (String(option.value) === String(areaId)) return option
    const child = findAreaOptionById(option.children, areaId)
    if (child) return child
  }
  return null
}

function getAreaPathById(areaId) {
  return findAreaOptionById(areaTreeOptions.value, areaId)?.areaPath || ''
}

/** 根据区域名称在区域树中查找对应的 ID（首条匹配） */
function findAreaIdByName(areaName) {
  if (!areaName) return null
  function search(options) {
    for (const opt of options || []) {
      if (opt.label === areaName || opt.areaPath === areaName) return opt.value
      if (opt.children?.length) {
        const found = search(opt.children)
        if (found != null) return found
      }
    }
    return null
  }
  return search(areaTreeOptions.value)
}

function getDeviceDbId(device) {
  if (device?.id === undefined || device?.id === null) return null
  return device.id
}

async function openBindAreaDialog(device) {
  areaBindingDevice.value = device
  areaBindingTargetId.value = device?.areaId ?? null
  areaBindingDialogVisible.value = true
  await ensureAreaTreeLoaded()
}

function resetAreaBindingDialog() {
  areaBindingDevice.value = null
  areaBindingTargetId.value = null
}

async function confirmBindArea() {
  const device = areaBindingDevice.value
  const deviceDbId = getDeviceDbId(device)
  if (!device || deviceDbId === null) {
    ElMessage.error('设备缺少数据库ID，无法绑定区域')
    return
  }
  if (areaBindingTargetId.value === null || areaBindingTargetId.value === undefined || areaBindingTargetId.value === '') {
    ElMessage.warning('请选择目标区域')
    return
  }

  areaBindingSubmitting.value = true
  try {
    const areaName = getAreaPathById(areaBindingTargetId.value)
    await batchDeviceArea({
      deviceIds: [deviceDbId],
      areaId: areaBindingTargetId.value,
      areaName,
    })
    ElMessage.success(`已将「${device.name || device.deviceId}」绑定到「${areaName || '目标区域'}」`)
    areaBindingDialogVisible.value = false
    await loadDevices()
  } catch (error) {
    ElMessage.error(error?.message || '绑定区域失败')
  } finally {
    areaBindingSubmitting.value = false
  }
}

async function unbindDeviceArea(device) {
  const deviceDbId = getDeviceDbId(device)
  if (!device || deviceDbId === null) {
    ElMessage.error('设备缺少数据库ID，无法解绑区域')
    return
  }
  if (!deviceHasArea(device)) {
    ElMessage.info('该设备尚未绑定区域')
    return
  }

  try {
    await ElMessageBox.confirm(
      `确认解绑设备“${device.name || device.deviceId}”当前所属区域？`,
      '解绑区域',
      { confirmButtonText: '确认解绑', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  areaUnbindingDeviceId.value = device.deviceId
  try {
    await batchDeviceArea({
      deviceIds: [deviceDbId],
      areaId: null,
      areaName: '',
    })
    ElMessage.success('解绑区域成功')
    await loadDevices()
  } catch (error) {
    ElMessage.error(error?.message || '解绑区域失败')
  } finally {
    areaUnbindingDeviceId.value = ''
  }
}

function toggleSelectMode() {
  selectMode.value = !selectMode.value
  if (!selectMode.value) selectedIds.value = []
}

function toggleSelect(deviceId) {
  const idx = selectedIds.value.indexOf(deviceId)
  if (idx >= 0) selectedIds.value.splice(idx, 1)
  else selectedIds.value.push(deviceId)
}

function isSelected(deviceId) {
  return selectedIds.value.includes(deviceId)
}

function getSelectedDevices() {
  return filtered.value.filter(d => selectedIds.value.includes(d.deviceId))
}

function getSelectedDeviceDbIds() {
  return getSelectedDevices()
    .map(d => d.id)
    .filter(id => id !== undefined && id !== null)
}

function resetBatchSelection() {
  selectMode.value = false
  selectedIds.value = []
}

/** 全选当前筛选结果 */
function selectAllFiltered() {
  selectedIds.value = filtered.value.map(d => d.deviceId)
}

/** 打开批量分配弹窗 */
async function openBatchAssign() {
  await ensureAreaTreeLoaded()
  batchTargetAreaId.value = null
  batchDialogVisible.value = true
}

/** 确认批量分配区域 */
async function confirmBatchAssign() {
  if (batchTargetAreaId.value === null || batchTargetAreaId.value === undefined || batchTargetAreaId.value === '') {
    ElMessage.warning('请选择目标区域')
    return
  }
  const deviceIds = getSelectedDeviceDbIds()
  if (!deviceIds.length) {
    ElMessage.warning('未选中任何设备')
    return
  }
  batchOperating.value = true
  try {
    const areaName = getAreaPathById(batchTargetAreaId.value)
    await batchDeviceArea({ deviceIds, areaId: batchTargetAreaId.value, areaName })
    ElMessage.success(`已成功将 ${deviceIds.length} 台设备分配到「${areaName || '目标区域'}」`)
    batchDialogVisible.value = false
    resetBatchSelection()
    await loadDevices()
  } catch (error) {
    ElMessage.error(error?.message || '批量分配失败')
  } finally {
    batchOperating.value = false
  }
}

/** 批量清除区域关联 */
async function batchClearArea() {
  const deviceIds = getSelectedDeviceDbIds()
  if (!deviceIds.length) {
    ElMessage.warning('未选中任何设备')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认清除 ${deviceIds.length} 台设备的区域关联？`,
      '清除区域',
      { confirmButtonText: '确认清除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  batchOperating.value = true
  try {
    await batchDeviceArea({ deviceIds, areaId: null, areaName: '' })
    ElMessage.success(`已清除 ${deviceIds.length} 台设备的区域关联`)
    resetBatchSelection()
    await loadDevices()
  } catch (error) {
    ElMessage.error(error?.message || '批量清除失败')
  } finally {
    batchOperating.value = false
  }
}

/** 批量停用设备 */
async function batchDisableSelected() {
  const deviceIds = getSelectedDeviceDbIds()
  if (!deviceIds.length) {
    ElMessage.warning('未选中任何设备')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认停用 ${deviceIds.length} 台设备？停用后设备将不可参与自动控制。`,
      '批量停用设备',
      { confirmButtonText: '确认停用', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  batchOperating.value = true
  try {
    const res = await batchDisableDevices({ deviceIds })
    const success = res?.data?.success ?? deviceIds.length
    ElMessage.success(`已停用 ${success} 台设备`)
    resetBatchSelection()
    await loadDevices()
  } catch (error) {
    ElMessage.error(error?.message || '批量停用失败')
  } finally {
    batchOperating.value = false
  }
}

/** 批量启用设备 */
async function batchEnableSelected() {
  const deviceIds = getSelectedDeviceDbIds()
  if (!deviceIds.length) {
    ElMessage.warning('未选中任何设备')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认启用 ${deviceIds.length} 台设备？启用后设备将恢复为离线待心跳状态。`,
      '批量启用设备',
      { confirmButtonText: '确认启用', cancelButtonText: '取消', type: 'info' }
    )
  } catch {
    return
  }

  batchOperating.value = true
  try {
    const res = await batchEnableDevices({ deviceIds })
    const success = res?.data?.success ?? deviceIds.length
    ElMessage.success(`已启用 ${success} 台设备`)
    resetBatchSelection()
    await loadDevices()
  } catch (error) {
    ElMessage.error(error?.message || '批量启用失败')
  } finally {
    batchOperating.value = false
  }
}

/** 批量开灯 */
async function batchTurnOnSelected() {
  const deviceIds = getSelectedDeviceDbIds()
  if (!deviceIds.length) {
    ElMessage.warning('未选中任何设备')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认对 ${deviceIds.length} 台设备下发开灯指令？设备将进入手动控制锁定。`,
      '批量开灯',
      { confirmButtonText: '确认开灯', cancelButtonText: '取消', type: 'info' }
    )
  } catch {
    return
  }

  batchOperating.value = true
  try {
    const res = await batchTurnOnDevices({ deviceIds })
    const success = res?.data?.success ?? deviceIds.length
    ElMessage.success(`已下发开灯指令 ${success} 台`)
    resetBatchSelection()
    await loadDevices()
  } catch (error) {
    ElMessage.error(error?.message || '批量开灯失败')
  } finally {
    batchOperating.value = false
  }
}

/** 批量关灯 */
async function batchTurnOffSelected() {
  const deviceIds = getSelectedDeviceDbIds()
  if (!deviceIds.length) {
    ElMessage.warning('未选中任何设备')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认对 ${deviceIds.length} 台设备下发关灯指令？设备将进入手动控制锁定。`,
      '批量关灯',
      { confirmButtonText: '确认关灯', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  batchOperating.value = true
  try {
    const res = await batchTurnOffDevices({ deviceIds })
    const success = res?.data?.success ?? deviceIds.length
    ElMessage.success(`已下发关灯指令 ${success} 台`)
    resetBatchSelection()
    await loadDevices()
  } catch (error) {
    ElMessage.error(error?.message || '批量关灯失败')
  } finally {
    batchOperating.value = false
  }
}

/** 批量删除设备 */
async function batchDeleteSelected() {
  const deviceIds = getSelectedDeviceDbIds()
  if (!deviceIds.length) {
    ElMessage.warning('未选中任何设备')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除 ${deviceIds.length} 台设备？删除后设备将从列表中移除。`,
      '批量删除设备',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }

  batchOperating.value = true
  try {
    const res = await batchDeleteDevices({ deviceIds })
    const success = res?.data?.success ?? deviceIds.length
    ElMessage.success(`已删除 ${success} 台设备`)
    resetBatchSelection()
    await loadDevices()
  } catch (error) {
    ElMessage.error(error?.message || '批量删除失败')
  } finally {
    batchOperating.value = false
  }
}
</script>

<template>
  <div class="devices-page">
    <div class="page-header">
      <div>
        <h1 class="page-title">设备管理</h1>
        <p class="page-sub">管理全域智慧路灯节点设备</p>
      </div>
      <div class="header-actions">
        <button v-if="hasPerm('device:create')" class="create-device-btn" @click="openCreateDialog">
          <Plus class="create-device-icon" />
          新增设备
        </button>
        <button v-if="hasPerm('device:create')" class="header-btn import-btn" @click="batchImportVisible = true">
          <Upload class="header-btn-icon" />
          批量导入
        </button>
        <button
          v-if="hasPerm('device:update') || hasPerm('device:delete') || hasPerm('device:control')"
          class="header-btn batch-btn"
          :class="{ active: selectMode }"
          @click="toggleSelectMode"
        >
          <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>
          {{ selectMode ? '退出批量' : '批量操作' }}
        </button>
        <el-dropdown v-if="hasPerm('device:read')" @command="handleExport">
          <button class="header-btn export-btn">
            <Download class="header-btn-icon" />
            导出
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="">全部设备</el-dropdown-item>
              <el-dropdown-item v-for="area in areaOptions.filter(a => a !== '全部')" :key="area" :command="area">
                {{ area }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <input v-model="search" class="search-input" placeholder="搜索设备ID、名称或区域" />
        </div>
        <div class="status-tabs">
          <button
            v-for="s in statuses" :key="s"
            class="status-tab"
            :class="{ active: statusFilter === s }"
            @click="statusFilter = s; doFilterChange()"
          >{{ s }}</button>
        </div>
      </div>
    </div>

    <!-- 分区筛选标签 -->
    <div class="area-tabs" v-if="areaOptions.length > 1">
      <button
        v-for="a in areaOptions" :key="a"
        class="area-tab"
        :class="{ active: areaFilter === a }"
        @click="areaFilter = a"
      >{{ a === '全部' ? '全部设备' : a }}</button>
    </div>

    <!-- 统计条 -->
    <div class="summary-bar">
      <span class="summary-item">
        共 <strong>{{ filtered.length }}</strong> 台设备
      </span>
      <span class="summary-item online">
        在线 <strong>{{ filtered.filter(d=>displayStatus(d)===1).length }}</strong>
      </span>
      <span class="summary-item offline">
        离线 <strong>{{ filtered.filter(d=>displayStatus(d)===2).length }}</strong>
      </span>
      <span class="summary-item warning">
        异常 <strong>{{ filtered.filter(d=>displayStatus(d)===3).length }}</strong>
      </span>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="loading-spinner"></div>
      <span>加载设备列表...</span>
    </div>

    <div v-else-if="!filtered.length" class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" width="40" height="40"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5" opacity="0.4"/><path d="M12 8v4M12 16v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.4"/></svg>
      <p>暂无符合条件的设备</p>
    </div>

    <div v-else class="device-grid">
      <div
        v-for="d in pagedDevices"
        :key="d.deviceId"
        class="device-card"
        :class="{ 'card-check-mode': selectMode, 'card-selected': selectMode && isSelected(d.deviceId) }"
        @click="selectMode ? toggleSelect(d.deviceId) : router.push(`/devices/${d.deviceId}`)"
      >
        <div v-if="selectMode" class="card-select-overlay" @click.stop="toggleSelect(d.deviceId)">
          <div class="card-select-check" :class="{ checked: isSelected(d.deviceId) }">
            <svg v-if="isSelected(d.deviceId)" viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M5 13l4 4L19 7" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
        </div>
        <div class="dc-header">
          <div class="dc-icon" :class="getStatusMeta(d).cls">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7z" fill="currentColor"/></svg>
          </div>
          <div class="status-pill" :class="getStatusMeta(d).cls">
            <span class="dot"></span>
            {{ getStatusMeta(d).label }}
          </div>
        </div>
        <div class="dc-name">{{ d.name }}</div>
        <div class="dc-id">{{ d.deviceId }}</div>
        <div class="dc-location">
          <svg viewBox="0 0 24 24" fill="none" width="11" height="11"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/></svg>
          {{ displayAreaName(d) }}
        </div>
        <div class="dc-metrics">
          <div class="metric">
            <span class="metric-label">健康分</span>
            <span class="metric-val" :style="{ color: healthColor(d.healthScore) }">
              {{ d.healthScore != null ? d.healthScore.toFixed(0) : '--' }}
            </span>
          </div>
          <div class="metric">
            <span class="metric-label">启用</span>
            <span class="metric-val" :class="d.enabled !== false ? 'enabled' : 'disabled-text'">{{ d.enabled !== false ? '是' : '否' }}</span>
          </div>
          <div class="metric">
            <span class="metric-label">心跳</span>
            <span class="metric-val heartbeat">{{ formatTime(d.lastHeartbeatAt) }}</span>
          </div>
        </div>
        <div class="dc-actions" v-if="hasPerm('device:update') || hasPerm('device:delete')">
          <button
            v-if="hasPerm('device:update')"
            class="device-action-btn edit"
            @click.stop="openEditDialog(d)"
          >
            <Edit class="device-action-icon" />
            编辑设备
          </button>
          <button
            v-if="hasPerm('device:update')"
            class="device-action-btn area"
            @click.stop="openBindAreaDialog(d)"
          >
            <Connection class="device-action-icon" />
            {{ deviceHasArea(d) ? '更换区域' : '绑定区域' }}
          </button>
          <button
            v-if="hasPerm('device:update')"
            class="device-action-btn unbind"
            :class="{ inactive: !deviceHasArea(d) }"
            :disabled="areaUnbindingDeviceId === d.deviceId || !deviceHasArea(d)"
            @click.stop="unbindDeviceArea(d)"
          >
            <CircleClose class="device-action-icon" />
            {{ !deviceHasArea(d) ? '未绑定' : areaUnbindingDeviceId === d.deviceId ? '解绑中...' : '解绑区域' }}
          </button>
          <button
            v-if="hasPerm('device:delete')"
            class="device-action-btn delete"
            :disabled="deletingDeviceId === d.deviceId"
            @click.stop="removeDevice(d)"
          >
            <Delete class="device-action-icon" />
            {{ deletingDeviceId === d.deviceId ? '删除中...' : '删除设备' }}
          </button>
          <button
            v-if="hasPerm('device:update')"
            class="device-toggle-btn"
            :class="d.enabled !== false ? 'stop' : 'start'"
            :disabled="togglingDeviceId === d.deviceId"
            @click.stop="toggleEnabled(d)"
          >
            {{ togglingDeviceId === d.deviceId ? '处理中...' : d.enabled !== false ? '停用设备' : '启用设备' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="!loading && filtered.length" class="device-pagination">
      <span class="pagination-summary">
        显示 <strong>{{ pageStart }}-{{ pageEnd }}</strong> / 共 <strong>{{ filtered.length }}</strong> 台
      </span>
      <ElPagination
        v-model:current-page="pageNum"
        v-model:page-size="pageSize"
        :page-sizes="pageSizeOptions"
        :total="filtered.length"
        :pager-count="5"
        background
        layout="sizes, prev, pager, next, jumper"
        @size-change="handlePageSizeChange"
        @current-change="handlePageChange"
      />
    </div>

    <!-- 批量操作栏 -->
    <div v-if="selectMode && selectedIds.length" class="batch-bar">
      <span class="batch-bar-info">已选 <strong>{{ selectedIds.length }}</strong> / {{ filtered.length }} 台</span>
      <button class="batch-bar-btn select-all-btn" :disabled="batchOperating" @click="selectAllFiltered">
        <svg viewBox="0 0 24 24" fill="none" width="13" height="13"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 12l3 3 5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        全选当前筛选
      </button>
      <div class="batch-bar-actions">
        <button v-if="hasPerm('device:update')" class="batch-bar-btn assign-btn" :disabled="batchOperating" @click="openBatchAssign">
          <svg viewBox="0 0 24 24" fill="none" width="13" height="13"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="currentColor"/></svg>
          分配区域
        </button>
        <button v-if="hasPerm('device:update')" class="batch-bar-btn clear-btn" :disabled="batchOperating" @click="batchClearArea">
          <svg viewBox="0 0 24 24" fill="none" width="13" height="13"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          清除区域
        </button>
        <button v-if="hasPerm('device:control')" class="batch-bar-btn light-on-btn" :disabled="batchOperating" @click="batchTurnOnSelected">
          <Sunny class="batch-bar-icon" />
          开灯
        </button>
        <button v-if="hasPerm('device:control')" class="batch-bar-btn light-off-btn" :disabled="batchOperating" @click="batchTurnOffSelected">
          <Moon class="batch-bar-icon" />
          关灯
        </button>
        <button v-if="hasPerm('device:update')" class="batch-bar-btn disable-btn" :disabled="batchOperating" @click="batchDisableSelected">
          <CircleClose class="batch-bar-icon" />
          停用设备
        </button>
        <button v-if="hasPerm('device:update')" class="batch-bar-btn enable-btn" :disabled="batchOperating" @click="batchEnableSelected">
          <CircleCheck class="batch-bar-icon" />
          启用设备
        </button>
        <button v-if="hasPerm('device:delete')" class="batch-bar-btn delete-btn" :disabled="batchOperating" @click="batchDeleteSelected">
          <Delete class="batch-bar-icon" />
          删除设备
        </button>
      </div>
    </div>

    <ElDialog
      v-model="createDialogVisible"
      :title="createDialogMode === 'edit' ? '编辑设备' : '新增设备'"
      width="560px"
      class="device-create-dialog"
      @closed="resetCreateForm"
    >
      <ElForm ref="createFormRef" :model="createForm" :rules="createRules" label-width="96px" class="device-create-form">
        <ElFormItem label="设备编号" prop="deviceId">
          <ElInput
            v-model.trim="createForm.deviceId"
            :disabled="createDialogMode === 'edit'"
            placeholder="如 SL_007"
            maxlength="50"
            show-word-limit
            @blur="onDeviceIdBlur"
          />
        </ElFormItem>
        <ElFormItem label="设备名称" prop="name">
          <ElInput v-model.trim="createForm.name" placeholder="如 北门-01" />
        </ElFormItem>
        <ElFormItem label="所属区域" prop="area">
          <ElCascader
            v-model="createForm.areaId"
            :options="areaTreeOptions"
            :props="{ emitPath: false, checkStrictly: true, expandTrigger: 'hover' }"
            clearable
            filterable
            placeholder="选择区域（空置为暂不绑定）"
            style="width: 100%"
          />
          <span class="area-hint" v-if="!createForm.areaId">暂不绑定区域</span>
        </ElFormItem>
        <ElFormItem label="经度" prop="longitude">
          <div style="display:flex;gap:8px;align-items:center">
            <ElInput v-model.trim="createForm.longitude" placeholder="如 106.5622" style="flex:1" />
            <span style="color:#40566f;font-size:12px;white-space:nowrap">°E</span>
          </div>
        </ElFormItem>
        <ElFormItem label="纬度" prop="latitude">
          <div style="display:flex;gap:8px;align-items:center">
            <ElInput v-model.trim="createForm.latitude" placeholder="如 29.5621" style="flex:1" />
            <span style="color:#40566f;font-size:12px;white-space:nowrap">°N</span>
          </div>
        </ElFormItem>
        <ElFormItem label=" ">
          <button type="button" class="pick-map-btn" @click="openLocationPicker">
            <Location style="width:14px;height:14px" />
            地图选点
          </button>
        </ElFormItem>
        <ElFormItem label="设备状态" prop="status">
          <ElSelect v-model="createForm.status" style="width: 100%">
            <ElOption v-for="option in createStatusOptions" :key="option.value" :label="option.label" :value="option.value" />
          </ElSelect>
        </ElFormItem>
        <ElFormItem label="出厂编号" prop="factorySerial">
          <ElInput
            v-model.trim="createForm.factorySerial"
            placeholder="设备出厂编号（用于生成 MQTT 鉴权凭证）"
            maxlength="100"
            show-word-limit
          />
        </ElFormItem>
      </ElForm>
      <template #footer>
        <div class="device-dialog-footer">
          <ElButton @click="createDialogVisible = false">取消</ElButton>
          <ElButton type="primary" :loading="creatingDevice" @click="submitCreateDevice">
            {{ createDialogMode === 'edit' ? '保存修改' : '确定新增' }}
          </ElButton>
        </div>
      </template>
    </ElDialog>

    <LocationPicker
      v-model:visible="locationPickerVisible"
      v-model="locationCoords"
      :devices="devices"
      @confirm="onLocationPicked"
    />
    <BatchImport
      v-model:visible="batchImportVisible"
      :existingDeviceIds="existingDeviceIds"
      :existingDevices="devices"
      @imported="onBatchImported"
    />

    <ElDialog
      v-model="areaBindingDialogVisible"
      :title="`绑定区域 - ${areaBindingDevice?.name || areaBindingDevice?.deviceId || ''}`"
      width="420px"
      class="batch-area-dialog"
      @closed="resetAreaBindingDialog"
    >
      <div class="batch-area-body">
        <div class="area-binding-summary">
          <span class="area-binding-label">当前设备</span>
          <span class="area-binding-value">{{ areaBindingDevice?.name || '--' }}</span>
        </div>
        <div class="area-binding-summary">
          <span class="area-binding-label">当前区域</span>
          <span class="area-binding-value">{{ areaBindingDevice ? displayAreaName(areaBindingDevice) : '--' }}</span>
        </div>
        <p class="batch-area-label">选择目标区域：</p>
        <ElCascader
          v-model="areaBindingTargetId"
          :options="areaTreeOptions"
          :props="{ emitPath: false, checkStrictly: true, expandTrigger: 'hover' }"
          clearable
          filterable
          placeholder="输入区域名称搜索或从树中选择"
          style="width: 100%"
        />
        <p class="batch-area-hint">
          将绑定到：{{ areaBindingTargetId ? (getAreaPathById(areaBindingTargetId) || '目标区域') : '未选择' }}
        </p>
      </div>
      <template #footer>
        <ElButton @click="areaBindingDialogVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="areaBindingSubmitting" @click="confirmBindArea">确认绑定</ElButton>
      </template>
    </ElDialog>

    <!-- 批量分配区域弹窗 -->
    <ElDialog
      v-model="batchDialogVisible"
      title="批量分配区域"
      width="420px"
      class="batch-area-dialog"
    >
      <div class="batch-area-body">
        <p class="batch-area-label">选择目标区域：</p>
        <ElCascader
          v-model="batchTargetAreaId"
          :options="areaTreeOptions"
          :props="{ emitPath: false, checkStrictly: true, expandTrigger: 'hover' }"
          clearable
          filterable
          placeholder="输入区域名称搜索或从树中选择"
          style="width: 100%"
        />
        <p class="batch-area-hint">将 <strong>{{ selectedIds.length }}</strong> 台设备分配到该区域（支持搜索区域名称）</p>
      </div>
      <template #footer>
        <ElButton @click="batchDialogVisible = false">取消</ElButton>
        <ElButton type="primary" :loading="batchOperating" @click="confirmBatchAssign">确认分配</ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.devices-page { padding: 24px 28px; color: #1d3148; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
.page-title { font-size: 22px; font-weight: 700; color: #0d1b2d; margin-bottom: 4px; }
.page-sub { font-size: 13px; color: #40566f; }
.header-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.create-device-btn {
  display: flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 14px;
  background: linear-gradient(135deg, #0094ff, #17c9df 56%, #4bd0a0) !important;
  border: 1px solid rgba(0,141,230,0.18) !important; border-radius: 7px;
  color: #fff !important; font-size: 13px; font-weight: 700;
  cursor: pointer; transition: all 0.2s;
  box-shadow: 0 12px 30px rgba(0,150,230,0.23) !important;
}
.create-device-icon { width: 15px; height: 15px; flex-shrink: 0; }
.create-device-btn:hover { transform: translateY(-1px); box-shadow: 0 16px 40px rgba(0,150,230,0.3) !important; }
.search-wrap {
  display: flex; align-items: center; gap: 8px;
  background: rgba(255,255,255,0.92);
  border: 1px solid rgba(0,141,230,0.18);
  border-radius: 7px; padding: 0 12px; height: 36px;
  box-shadow: 0 8px 20px rgba(30,86,130,0.08);
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
}
.search-wrap:focus-within {
  background: #ffffff;
  border-color: rgba(0,141,230,0.42);
  box-shadow: 0 0 0 3px rgba(0,141,230,0.1), 0 12px 28px rgba(30,86,130,0.12);
}
.search-wrap svg { width: 14px; height: 14px; color: #006fc2; flex-shrink: 0; }
.search-input { background: none; border: none; color: #0d1b2d; font-size: 13px; font-weight: 500; outline: none; width: 180px; }
.search-input::placeholder { color: #6f8194; }
.status-tabs { display: flex; gap: 4px; }
.status-tab {
  padding: 6px 14px; background: rgba(255,255,255,0.9) !important;
  border: 1px solid rgba(0,141,230,0.16) !important; border-radius: 6px;
  color: #1d3148 !important; font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s;
  box-shadow: 0 8px 18px rgba(30,86,130,0.06);
}
.status-tab:hover { color: #006fc2 !important; border-color: rgba(0,141,230,0.34) !important; background: #ffffff !important; }
.status-tab.active { background: linear-gradient(135deg, rgba(0,141,230,0.18), rgba(22,199,232,0.12)) !important; border-color: rgba(0,141,230,0.42) !important; color: #006fc2 !important; font-weight: 800; }

.area-tabs { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
.area-tab {
  padding: 8px 18px; background: rgba(255,255,255,0.9) !important;
  border: 1px solid rgba(0,141,230,0.16) !important; border-radius: 7px;
  color: #1d3148 !important; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s;
  box-shadow: 0 8px 18px rgba(30,86,130,0.06);
}
.area-tab:hover { border-color: rgba(0,141,230,0.34) !important; color: #006fc2 !important; background: #ffffff !important; transform: translateY(-1px); }
.area-tab.active { background: linear-gradient(135deg, rgba(0,141,230,0.18), rgba(22,199,232,0.12)) !important; border-color: rgba(0,141,230,0.42) !important; color: #006fc2 !important; font-weight: 800; }

/* Summary */
.summary-bar { display: flex; gap: 20px; margin-bottom: 16px; }
.summary-item { font-size: 13px; color: #40566f; }
.summary-item strong { font-weight: 800; color: #006fc2; margin: 0 2px; }
.summary-item.online strong { color: #15966a; }
.summary-item.offline strong { color: #60748a; }
.summary-item.warning strong { color: #d97706; }

/* Loading/empty */
.loading-state { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 60px; color: #40566f; }
.loading-spinner { width: 20px; height: 20px; border: 2px solid rgba(0,141,230,0.22); border-top-color: #008de6; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px; color: #40566f; gap: 12px; }
.empty-state p { font-size: 14px; }

/* Grid */
.device-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
  align-items: stretch;
}
.device-card {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 314px;
  background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(247,252,255,0.94)) !important;
  border: 1px solid rgba(0,141,230,0.16) !important;
  border-radius: 10px; padding: 16px 18px;
  cursor: pointer; transition: all 0.2s;
  box-shadow: 0 14px 34px rgba(30,86,130,0.09), inset 0 1px 0 rgba(255,255,255,0.95) !important;
}
.device-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 18px;
  right: 18px;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0,141,230,0.36), rgba(22,199,232,0.28), transparent);
  pointer-events: none;
}
.device-card:hover { border-color: rgba(0,141,230,0.34) !important; transform: translateY(-2px); box-shadow: 0 20px 44px rgba(0,126,206,0.16), inset 0 1px 0 rgba(255,255,255,0.95) !important; }
.dc-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.dc-icon { width: 32px; height: 32px; border-radius: 7px; display: flex; align-items: center; justify-content: center; }
.dc-icon svg { width: 17px; height: 17px; }
.dc-icon.online  { background: rgba(16,185,129,0.14); color: #15966a; }
.dc-icon.offline { background: rgba(96,116,138,0.12); color: #60748a; }
.dc-icon.warning { background: rgba(245,158,11,0.15); color: #d97706; }
.dc-icon.disabled { background: rgba(96,116,138,0.12); color: #60748a; }
.status-pill { display: flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.status-pill.online  { background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.22); color: #15966a; }
.status-pill.offline { background: rgba(96,116,138,0.12); border: 1px solid rgba(96,116,138,0.2); color: #40566f; }
.status-pill.warning { background: rgba(245,158,11,0.14); border: 1px solid rgba(245,158,11,0.28); color: #d97706; }
.status-pill.disabled { background: rgba(96,116,138,0.1); border: 1px solid rgba(96,116,138,0.2); color: #40566f; }
.dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.dc-name { font-size: 13px; font-weight: 800; color: #0d1b2d; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dc-id { font-size: 11px; font-family: monospace; color: #006fc2; margin-bottom: 6px; font-weight: 700; }
.dc-location { display: flex; align-items: center; gap: 4px; font-size: 11px; color: #1d3148; margin-bottom: 12px; font-weight: 600; }
.dc-metrics { display: flex; gap: 0; border-top: 1px solid rgba(16,126,196,0.12); padding-top: 10px; }
.metric { flex: 1; text-align: center; }
.metric:not(:last-child) { border-right: 1px solid rgba(16,126,196,0.12); }
.metric-label { display: block; font-size: 10px; color: #40566f; margin-bottom: 3px; font-weight: 700; }
.metric-val { display: block; font-size: 13px; font-weight: 700; color: #0d1b2d; }
.metric-val.enabled { color: #15966a; }
.metric-val.disabled-text { color: #40566f; }
.metric-val.heartbeat { font-size: 9px; font-family: monospace; color: #1d3148; font-weight: 700; }
.dc-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: auto;
  padding-top: 12px;
}
.device-action-btn,
.device-toggle-btn {
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  min-width: 0;
}
.device-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.device-toggle-btn {
  grid-column: 1 / -1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.device-action-icon { width: 13px; height: 13px; flex-shrink: 0; }
.device-action-btn.edit {
  background: rgba(0,141,230,0.08) !important;
  border: 1px solid rgba(0,141,230,0.2) !important;
  color: #006fc2 !important;
}
.device-action-btn.area {
  background: rgba(16,185,129,0.09) !important;
  border: 1px solid rgba(16,185,129,0.22) !important;
  color: #0d8b62 !important;
}
.device-action-btn.unbind {
  background: rgba(245,158,11,0.1) !important;
  border: 1px solid rgba(245,158,11,0.24) !important;
  color: #9a5a00 !important;
}
.device-action-btn.unbind.inactive {
  background: rgba(96,116,138,0.08) !important;
  border-color: rgba(96,116,138,0.16) !important;
  color: #60748a !important;
}
.device-action-btn.delete {
  background: rgba(229,72,77,0.08) !important;
  border: 1px solid rgba(229,72,77,0.22) !important;
  color: #c62f36 !important;
}
.device-toggle-btn.stop {
  background: rgba(229,72,77,0.08) !important;
  border: 1px solid rgba(229,72,77,0.22) !important;
  color: #c62f36 !important;
}
.device-toggle-btn.start {
  background: rgba(16,185,129,0.09) !important;
  border: 1px solid rgba(16,185,129,0.22) !important;
  color: #0d8b62 !important;
}
.device-action-btn:hover:not(:disabled),
.device-toggle-btn:hover:not(:disabled) { transform: translateY(-1px); }
.device-action-btn.edit:hover:not(:disabled) { background: rgba(0,141,230,0.14) !important; color: #008de6 !important; }
.device-action-btn.area:hover:not(:disabled) { background: rgba(16,185,129,0.15) !important; color: #10a875 !important; }
.device-action-btn.unbind:hover:not(:disabled) { background: rgba(245,158,11,0.16) !important; color: #b46a00 !important; }
.device-action-btn.delete:hover:not(:disabled) { background: rgba(229,72,77,0.14) !important; color: #e5484d !important; }
.device-toggle-btn.stop:hover:not(:disabled) { background: rgba(229,72,77,0.14) !important; color: #e5484d !important; }
.device-toggle-btn.start:hover:not(:disabled) { background: rgba(16,185,129,0.15) !important; color: #10a875 !important; }
.device-action-btn:disabled,
.device-toggle-btn:disabled { opacity: 0.72; cursor: not-allowed; }
.device-action-btn.unbind.inactive:disabled {
  opacity: 1;
}

.device-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 18px;
  padding: 12px 16px;
  background: rgba(255,255,255,0.94);
  border: 1px solid rgba(0,141,230,0.16);
  border-radius: 10px;
  box-shadow: 0 14px 34px rgba(30,86,130,0.10);
}
.pagination-summary {
  color: #40566f;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
}
.pagination-summary strong {
  color: #006fc2;
  font-weight: 900;
}
.device-pagination :deep(.el-pagination) {
  --el-pagination-bg-color: rgba(255,255,255,0.92);
  --el-pagination-button-bg-color: rgba(255,255,255,0.92);
  --el-pagination-hover-color: #006fc2;
  --el-pagination-font-size: 13px;
}
.device-pagination :deep(.el-pager li),
.device-pagination :deep(.btn-prev),
.device-pagination :deep(.btn-next) {
  border: 1px solid rgba(0,141,230,0.14);
  color: #31516f;
  font-weight: 800;
}
.device-pagination :deep(.el-pager li.is-active) {
  background: linear-gradient(135deg, #008de6, #21c8dc) !important;
  border-color: transparent;
  color: #ffffff;
}
.device-pagination :deep(.el-select__wrapper),
.device-pagination :deep(.el-input__wrapper) {
  background: rgba(255,255,255,0.96);
  border: 1px solid rgba(0,141,230,0.16);
  box-shadow: none;
}
.device-create-form :deep(.el-form-item__label) { color: #40566f; font-weight: 600; }
.device-create-form :deep(.el-input__wrapper),
.device-create-form :deep(.el-input-number),
.device-create-form :deep(.el-select__wrapper) {
  background: rgba(255,255,255,0.92);
}
.device-dialog-footer { display: flex; justify-content: flex-end; gap: 10px; }
.pick-map-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 16px;
  background: rgba(0,141,230,0.08); border: 1px solid rgba(0,141,230,0.22);
  border-radius: 6px; color: #006fc2; font-size: 13px;
  cursor: pointer; transition: all 0.2s;
}
.pick-map-btn:hover { background: rgba(0,141,230,0.14); border-color: rgba(0,141,230,0.38); }
.header-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 36px; padding: 0 14px; border-radius: 7px;
  font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s;
  border: 1px solid rgba(0,141,230,0.18) !important;
  background: rgba(255,255,255,0.9) !important; color: #006fc2 !important;
  box-shadow: 0 8px 20px rgba(30,86,130,0.08) !important;
}
.header-btn-icon { width: 14px; height: 14px; flex-shrink: 0; }
.import-btn:hover { background: #ffffff !important; border-color: rgba(0,141,230,0.36) !important; color: #008de6 !important; }
.export-btn:hover { background: rgba(16,185,129,0.1) !important; border-color: rgba(16,185,129,0.3) !important; color: #15966a !important; }
.batch-btn:hover { background: #ffffff !important; border-color: rgba(0,141,230,0.36) !important; }
.batch-btn.active { background: linear-gradient(135deg, rgba(0,141,230,0.18), rgba(22,199,232,0.12)) !important; border-color: rgba(0,141,230,0.42) !important; color: #006fc2 !important; }

/* 卡片选择模式 */
.card-check-mode { cursor: pointer; }
.card-check-mode:hover .card-select-check { border-color: rgba(0,141,230,0.55); }
.card-selected { border-color: rgba(0,141,230,0.45) !important; box-shadow: 0 0 0 1px rgba(0,141,230,0.16), 0 14px 32px rgba(0,126,206,0.18) !important; }
.card-select-overlay { position: absolute; top: 8px; left: 8px; z-index: 2; padding: 4px; }
.card-select-check {
  width: 20px; height: 20px; border-radius: 4px;
  border: 2px solid rgba(0,141,230,0.28);
  background: rgba(255,255,255,0.9);
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.card-select-check.checked { background: #008de6; border-color: #008de6; }

/* 批量操作栏 */
.batch-bar {
  position: sticky; bottom: 0; z-index: 100;
  display: flex; align-items: center; gap: 12px;
  padding: 10px 20px;
  margin-top: 16px;
  background: rgba(255,255,255,0.94);
  border: 1px solid rgba(0,141,230,0.18);
  border-radius: 10px;
  backdrop-filter: blur(12px);
  box-shadow: 0 18px 42px rgba(30,86,130,0.14);
}
.batch-bar-info { font-size: 13px; color: #40566f; white-space: nowrap; }
.batch-bar-info strong { color: #006fc2; font-weight: 700; }
.batch-bar-actions { margin-left: auto; display: flex; gap: 8px; }
.batch-bar-btn {
  display: inline-flex; align-items: center; gap: 5px;
  height: 32px; padding: 0 12px; border-radius: 6px;
  font-size: 12px; font-weight: 500; cursor: pointer;
  transition: all 0.2s; white-space: nowrap;
}
.batch-bar-btn:disabled {
  opacity: 0.62;
  cursor: not-allowed;
  transform: none;
}
.batch-bar-icon { width: 13px; height: 13px; flex-shrink: 0; }
.select-all-btn {
  background: rgba(0,141,230,0.08);
  border: 1px solid rgba(0,141,230,0.18);
  color: #006fc2;
}
.select-all-btn:hover:not(:disabled) { background: rgba(0,141,230,0.14); color: #008de6; }
.assign-btn {
  background: rgba(0,141,230,0.1);
  border: 1px solid rgba(0,141,230,0.24);
  color: #006fc2;
}
.assign-btn:hover:not(:disabled) { background: rgba(0,141,230,0.16); }
.clear-btn {
  background: rgba(245,158,11,0.1);
  border: 1px solid rgba(245,158,11,0.24);
  color: #9a5a00;
}
.clear-btn:hover:not(:disabled) { background: rgba(245,158,11,0.16); color: #b46a00; }
.light-on-btn {
  background: rgba(250,204,21,0.12);
  border: 1px solid rgba(217,119,6,0.24);
  color: #9a5a00;
}
.light-on-btn:hover:not(:disabled) { background: rgba(250,204,21,0.18); color: #b45309; }
.light-off-btn {
  background: rgba(99,102,241,0.08);
  border: 1px solid rgba(99,102,241,0.2);
  color: #4f46e5;
}
.light-off-btn:hover:not(:disabled) { background: rgba(99,102,241,0.14); color: #4338ca; }
.disable-btn {
  background: rgba(96,116,138,0.1);
  border: 1px solid rgba(96,116,138,0.22);
  color: #40566f;
}
.disable-btn:hover:not(:disabled) { background: rgba(96,116,138,0.16); color: #263d57; }
.enable-btn {
  background: rgba(16,185,129,0.09);
  border: 1px solid rgba(16,185,129,0.22);
  color: #0d8b62;
}
.enable-btn:hover:not(:disabled) { background: rgba(16,185,129,0.15); color: #10a875; }
.delete-btn {
  background: rgba(229,72,77,0.08);
  border: 1px solid rgba(229,72,77,0.2);
  color: #c62f36;
}
.delete-btn:hover:not(:disabled) { background: rgba(229,72,77,0.14); color: #e5484d; }

/* 批量分配弹窗 */
.batch-area-dialog :deep(.el-dialog__body) { padding: 20px 24px; }
.batch-area-body { padding: 4px 0; }
.area-binding-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(16,126,196,0.12);
}
.area-binding-summary + .batch-area-label { margin-top: 14px; }
.area-binding-label { font-size: 12px; color: #40566f; font-weight: 600; }
.area-binding-value { font-size: 13px; color: #0d1b2d; font-weight: 600; text-align: right; }
.batch-area-label { font-size: 13px; color: #1d3148; font-weight: 600; margin-bottom: 10px; }
.batch-area-hint { font-size: 12px; color: #40566f; margin-top: 12px; }
.batch-area-dialog :deep(.el-cascader__wrapper) { background: rgba(255,255,255,0.92); }
.batch-area-dialog :deep(.el-cascader__search-input) { color: #0d1b2d; }

.device-create-form .area-hint {
  display: inline-block;
  margin-top: 4px;
  font-size: 12px;
  color: #60748a;
  font-style: italic;
}
</style>
