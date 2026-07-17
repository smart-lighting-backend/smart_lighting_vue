const CSV_HEADERS = ['告警ID', '设备编号', '级别', '告警类型', '告警原因', '发生时间', '恢复时间', '状态', '处理人']

function pad2(value) {
  return String(value).padStart(2, '0')
}

/**
 * 格式化日期为本地时间。
 * 输入为 UTC 时区时间戳（毫秒），JavaScript Date 自动转为本地时区显示。
 */
function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '--'
  }
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join('-') + ' ' + [
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join(':')
}

function formatParts(parts) {
  const toPart = (index, fallback) => {
    const value = Number(parts[index])
    return Number.isFinite(value) ? value : fallback
  }
  const year = toPart(0, 0)
  const month = toPart(1, 0)
  const day = toPart(2, 0)
  const hour = toPart(3, 0)
  const minute = toPart(4, 0)
  const second = toPart(5, 0)
  if (!year || !month || !day) {
    return '--'
  }
  return `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`
}

export function formatAlarmTime(value) {
  if (value === null || value === undefined || value === '') {
    return '--'
  }
  if (Array.isArray(value)) {
    return formatParts(value)
  }
  if (value instanceof Date) {
    return formatDate(value)
  }
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))) {
    const raw = Number(value)
    const timestamp = raw < 1000000000000 ? raw * 1000 : raw
    return formatDate(new Date(timestamp))
  }
  if (typeof value !== 'string') {
    return String(value)
  }

  const text = value.trim()
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (match) {
    return formatParts(match.slice(1))
  }

  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) {
    return formatDate(parsed)
  }
  return text
}

function escapeCsvCell(cell) {
  const text = String(cell ?? '--').replace(/\r?\n/g, ' ')
  return `"${text.replace(/"/g, '""')}"`
}

export function buildAlarmCsvContent(alarms, maps) {
  const rows = alarms.map(alarm => [
    alarm.id,
    alarm.deviceId,
    maps.levelMap[alarm.level]?.label || alarm.level || '--',
    maps.typeMap[alarm.type] || alarm.type || '--',
    alarm.reason || '--',
    formatAlarmTime(alarm.startAt),
    formatAlarmTime(alarm.recoverAt),
    maps.statusMap[alarm.status]?.label || alarm.status || '--',
    alarm.handler || '--',
  ])

  return '\uFEFF' + [CSV_HEADERS, ...rows]
    .map(row => row.map(escapeCsvCell).join(','))
    .join('\r\n')
}
