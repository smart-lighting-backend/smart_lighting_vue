const IMPORT_FIELDS = [
  {
    key: 'deviceId',
    title: '设备编号',
    defaultIndex: 0,
    aliases: ['设备编号', '设备ID', '设备编码', '编号', 'deviceId', 'device_id', 'id'],
  },
  {
    key: 'name',
    title: '设备名称',
    defaultIndex: 1,
    aliases: ['设备名称', '名称', '设备名', 'name', 'deviceName', 'device_name'],
  },
  {
    key: 'area',
    title: '所属区域',
    defaultIndex: 2,
    aliases: ['所属区域', '区域', '分区', 'area', 'region'],
  },
  {
    key: 'longitude',
    title: '经度',
    defaultIndex: 3,
    aliases: ['经度', 'longitude', 'lng'],
  },
  {
    key: 'latitude',
    title: '纬度',
    defaultIndex: 4,
    aliases: ['纬度', 'latitude', 'lat'],
  },
  {
    key: 'ratedPower',
    title: '额定功率(W)',
    defaultIndex: 5,
    aliases: ['额定功率(W)', '额定功率', '功率', 'ratedPower', 'rated_power', 'power'],
  },
]

const TEMPLATE_HEADERS = IMPORT_FIELDS.map(field => field.title)
const EXPORT_HEADERS = ['设备编号', '设备名称', '所属区域', '安装位置', '状态', '健康分', '额定功率(W)', '是否启用', '最后心跳', '订阅前缀']
const STATUS_LABELS = { 0: '停用', 1: '在线', 2: '离线', 3: '异常' }
const SUPPORTED_IMPORT_EXTENSIONS = new Set(['csv', 'xlsx'])

export async function downloadTemplate() {
  const rows = [
    TEMPLATE_HEADERS,
    ['SL_007', '北门-03', 'A区', '106.5622', '29.5621', '60'],
  ]
  const data = await buildXlsxBlobData(rows)
  downloadBlob(
    new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    '设备批量导入模板.xlsx'
  )
}

export async function parseImportFile(file) {
  const ext = getFileExtension(file?.name)

  if (!SUPPORTED_IMPORT_EXTENSIONS.has(ext)) {
    throw new Error('仅支持 .xlsx、.csv 格式的设备导入文件；旧版 .xls 请另存为 .xlsx 后导入')
  }

  if (ext === 'csv') {
    const text = await readFileAsText(file)
    return parseRows(parseCsv(text))
  }

  const buffer = await readFileAsArrayBuffer(file)
  return parseRows(await parseXlsxRows(buffer))
}

export function validateDeviceRow(row, existingDeviceIds = new Set()) {
  const errors = []

  if (!row.deviceId) {
    errors.push('设备编号不能为空')
  } else if (row.deviceId.length > 50) {
    errors.push('设备编号不能超过50个字符')
  } else if (!/^[a-zA-Z0-9_]+$/.test(row.deviceId)) {
    errors.push('设备编号只能包含字母、数字和下划线')
  } else if (existingDeviceIds.has(row.deviceId)) {
    errors.push(`设备编号 "${row.deviceId}" 已存在`)
  }

  if (row.longitude) {
    const lng = parseFloat(row.longitude)
    if (Number.isNaN(lng) || lng < 73.5 || lng > 135) {
      errors.push('经度需在 73.5°~135° 之间')
    }
  }

  if (row.latitude) {
    const lat = parseFloat(row.latitude)
    if (Number.isNaN(lat) || lat < 18 || lat > 54) {
      errors.push('纬度需在 18°~54° 之间')
    }
  }

  if (row.ratedPower) {
    const power = parseFloat(row.ratedPower)
    if (Number.isNaN(power) || power <= 0) {
      errors.push('额定功率需为正数')
    }
  }

  return { valid: errors.length === 0, errors }
}

export function validateAllRows(rows, existingDeviceIds = new Set()) {
  const existingSet = new Set(existingDeviceIds)
  const seenRows = new Map()

  return rows.map((row, index) => {
    const result = validateDeviceRow(row, existingSet)
    const deviceId = row.deviceId

    if (deviceId) {
      if (seenRows.has(deviceId)) {
        result.errors.unshift(`设备编号 "${deviceId}" 与第 ${seenRows.get(deviceId)} 行重复`)
      } else {
        seenRows.set(deviceId, row._row || index + 2)
      }
    }

    result.valid = result.errors.length === 0
    return result
  })
}

export function rowsToPayload(rows) {
  return rows.map(row => {
    const lng = roundCoord(row.longitude)
    const lat = roundCoord(row.latitude)
    return {
      deviceId: row.deviceId,
      name: row.name || undefined,
      area: row.area || undefined,
      location: (lng && lat) ? `${lng},${lat}` : undefined,
      ratedPower: row.ratedPower ? parseFloat(row.ratedPower) : undefined,
      topicPrefix: 'streetlight',
    }
  })
}

export function exportDevices(devices, area = '') {
  const list = area ? devices.filter(device => device.area === area) : devices
  const data = list.map(device => [
    device.deviceId || '',
    device.name || '',
    device.area || '',
    device.location || '',
    STATUS_LABELS[device.status] || '未知',
    device.healthScore != null ? device.healthScore : '',
    device.ratedPower != null ? device.ratedPower : '',
    device.enabled !== false ? '是' : '否',
    device.lastHeartbeatAt ? formatExportTime(device.lastHeartbeatAt) : '',
    device.topicPrefix || 'streetlight',
  ])

  const filename = area ? `设备清单_${area}.csv` : '设备清单_全部.csv'
  downloadCsv([EXPORT_HEADERS, ...data], filename)
}

async function loadZipTools() {
  return import('three/examples/jsm/libs/fflate.module.js')
}

async function buildXlsxBlobData(rows) {
  const { zipSync, strToU8 } = await loadZipTools()
  const sheetXml = buildSheetXml(rows)
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="设备导入模板" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
  }, { level: 6 })
}

function buildSheetXml(rows) {
  const dimension = `A1:${columnName(Math.max(...rows.map(row => row.length)) - 1)}${rows.length}`
  const sheetRows = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1
    const cells = row.map((cell, colIndex) => {
      const ref = `${columnName(colIndex)}${rowNumber}`
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`
    }).join('')
    return `<row r="${rowNumber}">${cells}</row>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="2" width="18" customWidth="1"/>
    <col min="3" max="3" width="16" customWidth="1"/>
    <col min="4" max="6" width="14" customWidth="1"/>
  </cols>
  <sheetData>${sheetRows}</sheetData>
</worksheet>`
}

async function parseXlsxRows(buffer) {
  const { unzipSync } = await loadZipTools()
  const files = unzipSync(new Uint8Array(buffer))
  const sheetPath = getFirstSheetPath(files)
  const sheetXml = readZipText(files, sheetPath)

  if (!sheetXml) {
    throw new Error('Excel 文件中未找到工作表')
  }

  const sharedStrings = parseSharedStrings(readZipText(files, 'xl/sharedStrings.xml'))
  return parseSheetRows(sheetXml, sharedStrings)
}

function getFirstSheetPath(files) {
  const workbookXml = readZipText(files, 'xl/workbook.xml')
  const relsXml = readZipText(files, 'xl/_rels/workbook.xml.rels')

  if (!workbookXml || !relsXml) return 'xl/worksheets/sheet1.xml'

  const workbook = parseXml(workbookXml)
  const firstSheet = getXmlElements(workbook, 'sheet')[0]
  const relId = firstSheet?.getAttribute('r:id')
  if (!relId) return 'xl/worksheets/sheet1.xml'

  const rels = parseXml(relsXml)
  const relation = getXmlElements(rels, 'Relationship').find(item => item.getAttribute('Id') === relId)
  const target = relation?.getAttribute('Target')

  if (!target) return 'xl/worksheets/sheet1.xml'

  const normalizedTarget = target.replace(/^\/+/, '')
  return normalizedTarget.startsWith('xl/') ? normalizedTarget : `xl/${normalizedTarget}`
}

function parseSharedStrings(xml) {
  if (!xml) return []
  const doc = parseXml(xml)
  return getXmlElements(doc, 'si').map(item =>
    getXmlElements(item, 't').map(textNode => textNode.textContent || '').join('')
  )
}

function parseSheetRows(xml, sharedStrings) {
  const doc = parseXml(xml)
  return getXmlElements(doc, 'row').map(rowNode => {
    const row = []
    getXmlElements(rowNode, 'c').forEach(cellNode => {
      const ref = cellNode.getAttribute('r')
      const colIndex = ref ? columnIndexFromRef(ref) : row.length
      row[colIndex] = readCellValue(cellNode, sharedStrings)
    })
    return row
  })
}

function readCellValue(cellNode, sharedStrings) {
  const type = cellNode.getAttribute('t')

  if (type === 'inlineStr') {
    return getXmlElements(cellNode, 't').map(node => node.textContent || '').join('')
  }

  const value = getXmlElements(cellNode, 'v')[0]?.textContent || ''
  if (type === 's') return sharedStrings[Number(value)] || ''
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE'
  return value
}

function readZipText(files, path) {
  const file = files[path]
  return file ? new TextDecoder('utf-8').decode(file) : ''
}

function parseXml(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const parserError = doc.getElementsByTagName('parsererror')[0]
  if (parserError) throw new Error('Excel XML 内容解析失败')
  return doc
}

function getXmlElements(root, localName) {
  return Array.from(root.getElementsByTagNameNS('*', localName))
}

function columnIndexFromRef(ref) {
  const letters = String(ref).match(/[A-Z]+/i)?.[0] || 'A'
  return [...letters.toUpperCase()].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0) - 1
}

function columnName(index) {
  let name = ''
  let current = index + 1
  while (current > 0) {
    const rem = (current - 1) % 26
    name = String.fromCharCode(65 + rem) + name
    current = Math.floor((current - 1) / 26)
  }
  return name
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function parseRows(rows) {
  const normalizedRows = (rows || []).map(row => Array.isArray(row) ? row : [])

  if (normalizedRows.length < 2) {
    throw new Error('文件为空或只有表头')
  }

  const columnMap = buildColumnMap(normalizedRows[0])
  const result = []

  for (let i = 1; i < normalizedRows.length; i++) {
    const row = normalizedRows[i]
    if (!row || row.every(cell => cellToText(cell) === '')) continue

    const rawLng = getMappedValue(row, columnMap, 'longitude');
    const rawLat = getMappedValue(row, columnMap, 'latitude');
    const device = {
      deviceId: getMappedValue(row, columnMap, 'deviceId'),
      name: getMappedValue(row, columnMap, 'name'),
      area: getMappedValue(row, columnMap, 'area'),
      longitude: roundCoord(rawLng),
      latitude: roundCoord(rawLat),
      ratedPower: getMappedValue(row, columnMap, 'ratedPower'),
      _row: i + 1,
    }

    if (device.deviceId) result.push(device)
  }

  return result
}

function buildColumnMap(headerRow) {
  const normalizedHeaders = (headerRow || []).map(normalizeHeader)
  const map = {}

  IMPORT_FIELDS.forEach(field => {
    const aliases = field.aliases.map(normalizeHeader)
    const matchedIndex = normalizedHeaders.findIndex(header => aliases.includes(header))
    map[field.key] = matchedIndex >= 0 ? matchedIndex : field.defaultIndex
  })

  return map
}

function getMappedValue(row, columnMap, key) {
  return cellToText(row[columnMap[key]])
}

function cellToText(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/^\ufeff/, '').trim()
}

function roundCoord(value) {
  if (!value) return ''
  const num = parseFloat(value)
  if (Number.isNaN(num)) return ''
  return String(Math.round(num * 1e6) / 1e6)
}

function normalizeHeader(value) {
  return cellToText(value)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）]/g, '')
}

function getFileExtension(filename = '') {
  return String(filename).split('.').pop()?.toLowerCase() || ''
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = event => resolve(event.target.result)
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file, 'utf-8')
  })
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = event => resolve(event.target.result)
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsArrayBuffer(file)
  })
}

function downloadCsv(rows, filename) {
  const csv = rows.map(row => row.map(escapeCsvCell).join(',')).join('\r\n')
  downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }), filename)
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function escapeCsvCell(value) {
  const text = String(value ?? '')
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  const source = String(text || '').replace(/^\ufeff/, '')

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    const next = source[i + 1]

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (ch === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
      continue
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += ch
  }

  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

function formatExportTime(val) {
  if (!val) return ''
  if (Array.isArray(val)) {
    const [y, m, d, h, mi] = val
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
  }
  return String(val).replace('T', ' ').slice(0, 16)
}
