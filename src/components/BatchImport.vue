<script setup>
import { ref, computed, nextTick, onUnmounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled } from '@element-plus/icons-vue'
import { downloadTemplate, parseImportFile, validateAllRows, rowsToPayload } from '../utils/excelTemplate.js'
import { batchCreateDevices } from '../api/devices.js'
import { useAMap } from '../composables/useAMap.js'
import { parseLocation } from '../utils/coordinate.js'
import { makeStreetlightIcon, makeFlashIcon, getDeviceColor, getAreaColor } from '../utils/streetlightIcon.js'

const props = defineProps({
  visible: { type: Boolean, default: false },
  existingDeviceIds: { type: Array, default: () => [] },
  existingDevices: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:visible', 'imported'])

const { AMap: AMapRef, loaded: mapLoaded } = useAMap()

const step = ref('upload')

// 区域筛选
const mapAreaFilter = ref('')
const mapAreaOptions = computed(() => {
  const areas = [...new Set(props.existingDevices.map(d => d.area).filter(Boolean))]
  return areas.sort()
})
const filteredExistingDevices = computed(() => {
  if (!mapAreaFilter.value) return props.existingDevices
  return props.existingDevices.filter(d => d.area === mapAreaFilter.value)
})
const file = ref(null)
const fileInputRef = ref(null)
const parsedRows = ref([])
const validationResults = ref([])
const importing = ref(false)
const importResult = ref({ success: 0, failed: 0, errors: [] })

const editingCell = ref(null)
const editValue = ref('')

const mapPreviewVisible = ref(false)
const mapContainerRef = ref(null)
let previewMap = null
let previewMarkers = []
let pulseTimer = null
let pulseOn = false

const SUPPORTED_EXTENSIONS = new Set(['csv', 'xlsx'])

const validCount = computed(() => validationResults.value.filter(row => row.valid).length)
const errorCount = computed(() => validationResults.value.filter(row => !row.valid).length)
const fileLabel = computed(() => file.value?.name || '未选择文件')
const importCandidatesWithCoords = computed(() =>
  parsedRows.value.filter(row =>
    row.longitude &&
    row.latitude &&
    !Number.isNaN(parseFloat(row.longitude)) &&
    !Number.isNaN(parseFloat(row.latitude))
  )
)

function getFileExtension(filename = '') {
  return String(filename).split('.').pop()?.toLowerCase() || ''
}

function validateImportFile(targetFile) {
  const ext = getFileExtension(targetFile?.name)
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    ElMessage.error('仅支持 .xlsx、.csv 格式导入；旧版 .xls 请另存为 .xlsx')
    return false
  }
  return true
}

function onFileChange(event) {
  const nextFile = event.target.files?.[0]
  event.target.value = ''
  if (!nextFile || !validateImportFile(nextFile)) return
  file.value = nextFile
  doParse(nextFile)
}

async function doParse(targetFile) {
  try {
    parsedRows.value = await parseImportFile(targetFile)
    if (parsedRows.value.length === 0) {
      ElMessage.warning('文件中未解析到有效设备数据')
      return
    }
    revalidateAll()
    step.value = 'preview'
  } catch (error) {
    ElMessage.error(error.message || '文件解析失败')
  }
}

async function handleDownloadTemplate() {
  try {
    await downloadTemplate()
  } catch (error) {
    ElMessage.error(error.message || '模板下载失败')
  }
}

function revalidateAll() {
  validationResults.value = validateAllRows(parsedRows.value, new Set(props.existingDeviceIds))
}

function revalidateRow() {
  revalidateAll()
}

function startEdit(rowIndex, field) {
  editingCell.value = { rowIndex, field }
  editValue.value = parsedRows.value[rowIndex][field] || ''
  nextTick(() => {
    const input = document.querySelector('.bi-edit-input')
    if (input) {
      input.focus()
      input.select()
    }
  })
}

function finishEdit() {
  if (!editingCell.value) return
  const { rowIndex, field } = editingCell.value
  parsedRows.value[rowIndex][field] = editValue.value.trim()
  editingCell.value = null
  revalidateRow(rowIndex)
}

function onEditKeydown(event) {
  if (event.key === 'Enter') finishEdit()
  if (event.key === 'Escape') editingCell.value = null
}

function cellDisplay(rowIndex, field) {
  if (editingCell.value?.rowIndex === rowIndex && editingCell.value?.field === field) return null
  return parsedRows.value[rowIndex][field] || ''
}

async function doImport() {
  if (importing.value) return
  const validRows = parsedRows.value.filter((_, index) => validationResults.value[index]?.valid)

  if (validRows.length === 0) {
    ElMessage.warning('没有可导入的有效数据')
    return
  }

  importing.value = true
  const payload = rowsToPayload(validRows)

  try {
    const response = await batchCreateDevices(payload)
    const data = response?.data || response || {}
    importResult.value = {
      success: data.success || 0,
      failed: data.failed || 0,
      errors: (data.failedDetails || []).map(error => ({
        row: error.row,
        deviceId: error.deviceId,
        reason: error.reason,
      })),
    }
  } catch (error) {
    importResult.value = {
      success: 0,
      failed: payload.length,
      errors: [{ row: 0, deviceId: '', reason: error?.message || '批量导入请求失败' }],
    }
  } finally {
    step.value = 'result'
    importing.value = false
    emit('imported')
  }
}

function reset() {
  step.value = 'upload'
  file.value = null
  parsedRows.value = []
  validationResults.value = []
  importResult.value = { success: 0, failed: 0, errors: [] }
  editingCell.value = null
}

function handleClose() {
  reset()
  emit('update:visible', false)
}

function openMapPreview() {
  mapPreviewVisible.value = true
  nextTick(initPreviewMap)
}

function closeMapPreview() {
  mapPreviewVisible.value = false
  clearPreviewMarkers()
  if (previewMap) {
    previewMap.destroy()
    previewMap = null
  }
}

function refreshMapPreview() {
  if (previewMap) initPreviewMap()
}

watch(mapAreaFilter, () => { nextTick(refreshMapPreview) })

function initPreviewMap() {
  if (!mapContainerRef.value || !AMapRef.value) return
  if (previewMap) {
    previewMap.destroy()
    previewMap = null
  }
  clearPreviewMarkers()

  previewMap = new AMapRef.value.Map(mapContainerRef.value, {
    mapStyle: 'amap://styles/whitesmoke',
    zoom: 5,
    center: [104, 35],
  })

  const allMarkers = []

  filteredExistingDevices.value.forEach(device => {
    const pos = parseLocation(device.location)
    if (!pos) return
    const color = getDeviceColor(device)
    const iconImage = makeStreetlightIcon(color, 26, 36)
    const marker = new AMapRef.value.Marker({
      position: [pos.lng, pos.lat],
      icon: new AMapRef.value.Icon({
        image: iconImage,
        imageSize: new AMapRef.value.Size(26, 36),
        size: new AMapRef.value.Size(26, 36),
      }),
      anchor: 'bottom-center',
      zIndex: 100,
    })
    marker.__deviceData = device
    marker.setMap(previewMap)
    allMarkers.push(marker)
    previewMarkers.push(marker)
  })

  // 闪烁动画 — 仅选中区域时启动
  clearInterval(pulseTimer)
  pulseOn = false
  const existingOnly = previewMarkers.filter(m => m.__deviceData)
  if (existingOnly.length > 0 && mapAreaFilter.value) {
    pulseTimer = setInterval(() => {
      pulseOn = !pulseOn
      existingOnly.forEach(m => {
        const d = m.__deviceData
        const color = getDeviceColor(d)
        const fn = pulseOn ? makeFlashIcon : makeStreetlightIcon
        m.setIcon(new AMapRef.value.Icon({
          image: fn(color, 26, 36),
          imageSize: new AMapRef.value.Size(26, 36),
          size: new AMapRef.value.Size(26, 36),
        }))
      })
    }, 400)
  }

  importCandidatesWithCoords.value.forEach((row, index) => {
    const lng = parseFloat(row.longitude)
    const lat = parseFloat(row.latitude)
    const label = row.deviceId || `#${index + 1}`
    const marker = new AMapRef.value.Marker({
      position: [lng, lat],
      content: `<div style="text-align:center;line-height:1.1"><div style="width:14px;height:14px;background:#e5484d;border:2.5px solid #fff;border-radius:50%;box-shadow:0 0 10px rgba(229,72,77,0.7);margin:0 auto;"></div><span style="font-size:9px;color:#ffb4b7;white-space:nowrap;">${label}</span></div>`,
      anchor: 'bottom-center',
      zIndex: 200,
    })
    marker.setMap(previewMap)
    allMarkers.push(marker)
    previewMarkers.push(marker)
  })

  if (allMarkers.length > 0) previewMap.setFitView(allMarkers)
}

function clearPreviewMarkers() {
  clearInterval(pulseTimer)
  previewMarkers.forEach(marker => marker.setMap(null))
  previewMarkers = []
}

function handleDragOver(event) {
  event.preventDefault()
}

function handleDrop(event) {
  event.preventDefault()
  const droppedFile = event.dataTransfer?.files?.[0]
  if (!droppedFile || !validateImportFile(droppedFile)) return
  file.value = droppedFile
  doParse(droppedFile)
}

onUnmounted(() => {
  clearInterval(pulseTimer)
  clearPreviewMarkers()
  if (previewMap) {
    previewMap.destroy()
    previewMap = null
  }
})
</script>

<template>
  <div v-if="visible" class="bi-overlay" @click.self="handleClose">
    <div class="bi-dialog">
      <div class="bi-header">
        <div>
          <span class="bi-title">批量导入设备</span>
          <p class="bi-subtitle">支持 Excel 与 CSV 文件，导入前可预览并修正数据</p>
        </div>
        <button class="bi-close" type="button" aria-label="关闭" @click="handleClose">&times;</button>
      </div>

      <div v-if="step === 'upload'" class="bi-body compact">
        <div class="bi-upload-zone" @dragover="handleDragOver" @drop="handleDrop" @click="fileInputRef?.click()">
          <span class="bi-upload-symbol">
            <UploadFilled />
          </span>
          <p>点击或拖拽上传设备文件</p>
          <span class="bi-hint">支持 .xlsx、.csv 格式，旧版 .xls 请另存为 .xlsx</span>
          <strong class="bi-file-name">{{ fileLabel }}</strong>
          <input
            ref="fileInputRef"
            type="file"
            accept=".xlsx,.csv"
            style="display:none"
            @change="onFileChange"
          />
        </div>
        <div class="bi-template">
          <span>还没有模板？</span>
          <button class="bi-btn-outline" type="button" @click="handleDownloadTemplate">下载 Excel 模板</button>
        </div>
      </div>

      <div v-if="step === 'preview'" class="bi-body">
        <div class="bi-summary">
          共解析 <strong>{{ parsedRows.length }}</strong> 条，
          <span class="bi-ok">有效 {{ validCount }} 条</span>
          <span v-if="errorCount > 0" class="bi-err">，错误 {{ errorCount }} 条</span>
          <span v-if="errorCount > 0" class="bi-hint-edit">点击单元格可直接修正</span>
        </div>
        <div class="bi-table-wrap">
          <table class="bi-table">
            <thead>
              <tr>
                <th>行</th>
                <th>设备编号</th>
                <th>名称</th>
                <th>区域</th>
                <th>经度</th>
                <th>纬度</th>
                <th>功率(W)</th>
                <th>问题</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in parsedRows" :key="index" :class="{ 'bi-row-err': !validationResults[index]?.valid }">
                <td>{{ row._row }}</td>
                <td
                  v-for="field in ['deviceId','name','area','longitude','latitude','ratedPower']"
                  :key="field"
                  class="bi-cell-editable"
                  @click="startEdit(index, field)"
                >
                  <template v-if="editingCell?.rowIndex === index && editingCell?.field === field">
                    <input
                      v-model="editValue"
                      class="bi-edit-input"
                      @blur="finishEdit"
                      @keydown="onEditKeydown"
                      @click.stop
                    />
                  </template>
                  <template v-else>{{ cellDisplay(index, field) }}</template>
                </td>
                <td class="bi-err-cell">{{ validationResults[index]?.errors?.join('；') || '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="step === 'result'" class="bi-body compact">
        <div class="bi-result">
          <div class="bi-result-badge" :class="{ warn: importResult.failed > 0 }">
            {{ importResult.failed === 0 ? 'OK' : '!' }}
          </div>
          <p class="bi-result-text">
            导入完成：成功 <strong>{{ importResult.success }}</strong> 条
            <template v-if="importResult.failed > 0">
              ，失败 <strong class="bi-err">{{ importResult.failed }}</strong> 条
            </template>
          </p>
          <div v-if="importResult.errors.length" class="bi-err-list">
            <div v-for="(error, index) in importResult.errors" :key="index" class="bi-err-item">
              第 {{ error.row }} 行 [{{ error.deviceId }}]：{{ error.reason }}
            </div>
          </div>
        </div>
      </div>

      <div class="bi-footer">
        <button class="bi-btn-cancel" type="button" @click="handleClose">关闭</button>
        <template v-if="step === 'preview'">
          <button class="bi-btn-outline" type="button" @click="openMapPreview">地图预览</button>
          <div class="bi-footer-spacer"></div>
          <button class="bi-btn-cancel" type="button" @click="reset">重新上传</button>
          <button class="bi-btn-confirm" type="button" :disabled="validCount === 0 || importing" @click="doImport">
            {{ importing ? '导入中...' : `确认导入 ${validCount} 条` }}
          </button>
        </template>
        <template v-if="step === 'result'">
          <button class="bi-btn-confirm" type="button" @click="reset">继续导入</button>
        </template>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="mapPreviewVisible" class="bi-map-overlay" @click.self="closeMapPreview">
        <div class="bi-map-dialog">
          <div class="bi-map-header">
            <span>导入地图预览：红色为待导入设备</span>
            <select v-if="mapAreaOptions.length > 1" v-model="mapAreaFilter" class="bi-area-select">
              <option value="">全部区域</option>
              <option v-for="a in mapAreaOptions" :key="a" :value="a">{{ a }}</option>
            </select>
            <button class="bi-close" type="button" aria-label="关闭地图预览" @click="closeMapPreview">&times;</button>
          </div>
          <div class="bi-map-body">
            <div v-if="!mapLoaded" class="bi-map-loading">地图加载中...</div>
            <div ref="mapContainerRef" class="bi-map-container"></div>
          </div>
          <div class="bi-map-footer">
            <span class="bi-legend">
              <i class="bi-dot import"></i> 待导入({{ importCandidatesWithCoords.length }})
              <i class="bi-dot online"></i> 已有设备({{ filteredExistingDevices.filter(d => d.status === 1).length }})
            </span>
            <button class="bi-btn-confirm" type="button" @click="closeMapPreview">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.bi-overlay {
  position: fixed;
  inset: 0;
  z-index: 3100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(13, 27, 45, 0.34);
  backdrop-filter: blur(10px);
}

.bi-dialog {
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #1d3148;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(244, 251, 255, 0.96)),
    linear-gradient(rgba(0, 141, 230, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 141, 230, 0.04) 1px, transparent 1px);
  background-size: 100% 100%, 28px 28px, 28px 28px;
  border: 1px solid rgba(0, 141, 230, 0.18);
  border-radius: 10px;
  box-shadow: 0 26px 70px rgba(14, 70, 120, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.bi-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px 10px;
  border-bottom: 1px solid rgba(0, 141, 230, 0.14);
  background: linear-gradient(180deg, rgba(236, 248, 255, 0.94), rgba(255, 255, 255, 0.74));
}

.bi-title {
  display: block;
  color: #0d1b2d;
  font-size: 15px;
  font-weight: 900;
}

.bi-subtitle {
  margin: 3px 0 0;
  color: #40566f;
  font-size: 11px;
  line-height: 1.35;
  font-weight: 700;
}

.bi-close {
  width: 30px;
  height: 30px;
  border: 1px solid rgba(0, 141, 230, 0.16);
  border-radius: 7px;
  color: #40566f;
  background: rgba(255, 255, 255, 0.76);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.18s ease;
}

.bi-close:hover {
  color: #006fc2;
  border-color: rgba(0, 141, 230, 0.34);
  background: #ffffff;
}

.bi-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px;
}

.bi-body.compact {
  flex: 0 0 auto;
  overflow: visible;
  padding: 14px 16px;
}

.bi-upload-zone {
  min-height: 146px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 18px 16px;
  text-align: center;
  cursor: pointer;
  border: 1.5px dashed rgba(0, 141, 230, 0.28);
  border-radius: 10px;
  background:
    radial-gradient(circle at 50% 0%, rgba(0, 141, 230, 0.12), transparent 36%),
    rgba(255, 255, 255, 0.72);
  transition: all 0.18s ease;
}

.bi-upload-zone:hover {
  border-color: rgba(0, 141, 230, 0.5);
  background:
    radial-gradient(circle at 50% 0%, rgba(0, 141, 230, 0.16), transparent 40%),
    #ffffff;
  box-shadow: 0 16px 36px rgba(0, 126, 206, 0.12);
}

.bi-upload-symbol {
  width: 46px;
  height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #008de6;
  border: 1px solid rgba(0, 141, 230, 0.18);
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(232, 246, 255, 0.95), rgba(255, 255, 255, 0.86));
  box-shadow: 0 12px 24px rgba(0, 141, 230, 0.14);
}

.bi-upload-symbol :deep(svg) {
  width: 26px !important;
  height: 26px !important;
  display: block;
  color: #008de6;
  filter: drop-shadow(0 10px 18px rgba(0, 141, 230, 0.2));
}

.bi-upload-zone p {
  margin: 2px 0 0;
  color: #0d1b2d;
  font-size: 14px;
  font-weight: 800;
}

.bi-hint,
.bi-file-name,
.bi-template,
.bi-summary,
.bi-hint-edit {
  color: #40566f;
  font-size: 12px;
  font-weight: 700;
}

.bi-file-name {
  max-width: 100%;
  margin-top: 3px;
  overflow: hidden;
  color: #006fc2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bi-template {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 10px;
}

.bi-summary {
  margin-bottom: 11px;
}

.bi-summary strong {
  color: #006fc2;
  font-weight: 900;
}

.bi-ok {
  color: #13845c;
  font-weight: 900;
}

.bi-err {
  color: #c62f36;
  font-weight: 900;
}

.bi-hint-edit {
  margin-left: 8px;
  color: #60748a;
}

.bi-table-wrap {
  max-height: min(300px, 46vh);
  overflow: auto;
  border: 1px solid rgba(0, 141, 230, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.9);
}

.bi-table {
  width: 100%;
  min-width: 780px;
  border-collapse: collapse;
  font-size: 12px;
}

.bi-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 8px 10px;
  color: #0d1b2d;
  text-align: left;
  font-weight: 900;
  white-space: nowrap;
  background: linear-gradient(180deg, #eef8ff, #ffffff);
  border-bottom: 1px solid rgba(0, 141, 230, 0.14);
}

.bi-table td {
  padding: 8px 10px;
  color: #1d3148;
  border-top: 1px solid rgba(16, 126, 196, 0.09);
  white-space: nowrap;
  font-weight: 650;
}

.bi-row-err td {
  background: rgba(229, 72, 77, 0.07);
}

.bi-cell-editable {
  cursor: pointer;
  transition: background 0.15s ease, outline-color 0.15s ease;
}

.bi-cell-editable:hover {
  background: rgba(0, 141, 230, 0.07);
  outline: 1px dashed rgba(0, 141, 230, 0.28);
  outline-offset: -1px;
}

.bi-edit-input {
  width: 100%;
  min-width: 90px;
  padding: 3px 6px;
  color: #0d1b2d;
  font-size: 12px;
  font-weight: 700;
  outline: none;
  background: #ffffff;
  border: 1px solid rgba(0, 141, 230, 0.42);
  border-radius: 5px;
  box-shadow: 0 0 0 3px rgba(0, 141, 230, 0.1);
}

.bi-err-cell {
  min-width: 150px;
  color: #c62f36 !important;
  white-space: normal !important;
  font-weight: 800 !important;
}

.bi-result {
  text-align: center;
  padding: 18px 0 10px;
}

.bi-result-badge {
  width: 46px;
  height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  color: #ffffff;
  font-size: 15px;
  font-weight: 900;
  border-radius: 50%;
  background: linear-gradient(135deg, #1ba974, #21c8dc);
  box-shadow: 0 14px 28px rgba(27, 169, 116, 0.22);
}

.bi-result-badge.warn {
  background: linear-gradient(135deg, #f59e0b, #e5484d);
  box-shadow: 0 14px 28px rgba(229, 72, 77, 0.22);
}

.bi-result-text {
  color: #1d3148;
  font-size: 15px;
  font-weight: 800;
}

.bi-result-text strong {
  color: #006fc2;
  font-size: 17px;
}

.bi-err-list {
  max-height: 170px;
  margin-top: 14px;
  overflow: auto;
  text-align: left;
}

.bi-err-item {
  margin-bottom: 6px;
  padding: 7px 10px;
  color: #c62f36;
  font-size: 12px;
  font-weight: 700;
  background: rgba(229, 72, 77, 0.07);
  border: 1px solid rgba(229, 72, 77, 0.12);
  border-radius: 6px;
}

.bi-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 9px;
  padding: 10px 16px;
  border-top: 1px solid rgba(0, 141, 230, 0.14);
  background: rgba(255, 255, 255, 0.82);
  flex-wrap: wrap;
}

.bi-footer-spacer {
  flex: 1;
}

.bi-btn-outline,
.bi-btn-cancel,
.bi-btn-confirm {
  height: 34px;
  padding: 0 14px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;
}

.bi-btn-outline {
  color: #006fc2;
  background: rgba(232, 246, 255, 0.8);
  border: 1px solid rgba(0, 141, 230, 0.2);
}

.bi-btn-outline:hover {
  color: #008de6;
  background: #ffffff;
  border-color: rgba(0, 141, 230, 0.36);
}

.bi-btn-cancel {
  color: #40566f;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(16, 126, 196, 0.14);
}

.bi-btn-cancel:hover {
  color: #0d1b2d;
  border-color: rgba(0, 141, 230, 0.28);
  background: #ffffff;
}

.bi-btn-confirm {
  color: #ffffff;
  background: linear-gradient(135deg, #008de6, #21c8dc);
  border: 1px solid rgba(0, 141, 230, 0.18);
  box-shadow: 0 10px 22px rgba(0, 141, 230, 0.22);
}

.bi-btn-confirm:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 26px rgba(0, 141, 230, 0.28);
}

.bi-btn-confirm:disabled {
  opacity: 0.48;
  cursor: not-allowed;
  box-shadow: none;
}

.bi-map-overlay {
  position: fixed;
  inset: 0;
  z-index: 3200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(13, 27, 45, 0.52);
  backdrop-filter: blur(10px);
}

.bi-map-dialog {
  width: min(880px, calc(100vw - 48px));
  height: min(76vh, 680px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #ffffff;
  border: 1px solid rgba(0, 141, 230, 0.18);
  border-radius: 10px;
  box-shadow: 0 26px 70px rgba(14, 70, 120, 0.24);
}

.bi-map-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  color: #0d1b2d;
  font-size: 14px;
  font-weight: 900;
  border-bottom: 1px solid rgba(0, 141, 230, 0.14);
  background: linear-gradient(180deg, #eef8ff, #ffffff);
}

.bi-area-select {
  height: 30px; padding: 0 8px; border-radius: 6px;
  border: 1px solid rgba(0,141,230,0.25);
  background: #fff; color: #0d1b2d;
  font-size: 12px; cursor: pointer; outline: none;
}

.bi-map-body {
  position: relative;
  flex: 1;
  min-height: 0;
}

.bi-map-container {
  width: 100%;
  height: 100%;
}

.bi-map-loading {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #40566f;
  font-size: 14px;
  font-weight: 800;
  background: rgba(247, 251, 255, 0.76);
}

.bi-map-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid rgba(0, 141, 230, 0.14);
}

.bi-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #40566f;
  font-size: 12px;
  font-weight: 800;
  flex-wrap: wrap;
}

.bi-dot {
  width: 10px;
  height: 10px;
  display: inline-block;
  margin-left: 8px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(0, 141, 230, 0.12);
}

.bi-dot.import {
  margin-left: 0;
  background: #e5484d;
}

.bi-dot.online {
  background: #1ba974;
}

.bi-dot.offline {
  background: #60748a;
}

@media (max-width: 720px) {
  .bi-overlay,
  .bi-map-overlay {
    padding: 14px;
  }

  .bi-dialog,
  .bi-map-dialog {
    width: calc(100vw - 28px);
    max-height: calc(100vh - 28px);
  }

  .bi-footer {
    justify-content: flex-start;
  }

  .bi-footer-spacer {
    display: none;
  }
}
</style>
