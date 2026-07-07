/**
 * 路灯图标 Canvas 绘制工具 — 三个地图组件共用。
 */
const iconCache = {}

function toBaseHex(color) {
  return color && color.length >= 7 ? color.slice(0, 7) : color
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h)
  ctx.lineTo(x, y + h)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fill()
}

export function drawStreetlight(ctx, color, w, h) {
  const base = toBaseHex(color)
  const cx = w / 2
  const pad = Math.round(w * 0.12)

  const domeW = Math.round(w * 0.38)
  const domeH = Math.round(h * 0.13)
  const domeY = pad + Math.round(h * 0.04)
  const domeCY = domeY + domeH
  const bulbR = Math.round(domeW * 0.48)
  const bulbCY = domeCY - Math.round(domeH * 0.2)
  const poleTop = domeCY + Math.round(domeH * 0.3)
  const poleBot = h - pad
  const poleW = Math.max(4, Math.round(w * 0.1))

  // 地面投影
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.beginPath()
  ctx.ellipse(cx, poleBot, w * 0.28, Math.round(h * 0.02), 0, 0, Math.PI * 2)
  ctx.fill()

  // 光晕
  const glowCY = bulbCY + domeH * 0.5
  const glowR = w * 0.44
  const glow = ctx.createRadialGradient(cx, glowCY, bulbR * 0.3, cx, glowCY, glowR)
  glow.addColorStop(0, color)
  glow.addColorStop(0.25, base + 'cc')
  glow.addColorStop(0.55, base + '44')
  glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow
  ctx.beginPath(); ctx.arc(cx, glowCY, glowR, 0, Math.PI * 2); ctx.fill()

  // 灯杆
  const poleGrad = ctx.createLinearGradient(cx - poleW, 0, cx + poleW, 0)
  poleGrad.addColorStop(0, '#5d6d7e')
  poleGrad.addColorStop(0.3, '#aeb6bf')
  poleGrad.addColorStop(0.5, '#d5d8dc')
  poleGrad.addColorStop(0.7, '#aeb6bf')
  poleGrad.addColorStop(1, '#4a5568')
  ctx.fillStyle = poleGrad
  ctx.beginPath()
  ctx.moveTo(cx - poleW / 2, poleTop)
  ctx.lineTo(cx - poleW * 0.3, poleBot)
  ctx.quadraticCurveTo(cx, poleBot + 1, cx + poleW * 0.3, poleBot)
  ctx.lineTo(cx + poleW / 2, poleTop)
  ctx.closePath()
  ctx.fill()

  // 灯颈
  const neckW = Math.round(w * 0.06)
  const neckTop = domeCY + domeH * 0.6
  ctx.fillStyle = '#7f8c8d'
  ctx.fillRect(cx - neckW / 2, neckTop, neckW, poleTop - neckTop)

  // 灯臂
  ctx.strokeStyle = '#95a5a6'
  ctx.lineWidth = Math.max(1.5, w * 0.04)
  ctx.beginPath()
  ctx.moveTo(cx - domeW * 0.35, domeCY + domeH * 0.15)
  ctx.quadraticCurveTo(cx - domeW * 0.5, domeCY - domeH * 0.1, cx - domeW * 0.3, domeCY - domeH * 0.35)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx + domeW * 0.35, domeCY + domeH * 0.15)
  ctx.quadraticCurveTo(cx + domeW * 0.5, domeCY - domeH * 0.1, cx + domeW * 0.3, domeCY - domeH * 0.35)
  ctx.stroke()

  // 灯罩
  const domeGrad = ctx.createLinearGradient(0, domeY, 0, domeCY + domeH * 0.5)
  domeGrad.addColorStop(0, '#7f8c8d')
  domeGrad.addColorStop(0.4, '#bdc3c7')
  domeGrad.addColorStop(1, '#5d6d7e')
  ctx.fillStyle = domeGrad
  ctx.beginPath()
  ctx.ellipse(cx, domeCY, domeW / 2, domeH, 0, Math.PI, 0)
  ctx.fill()
  ctx.strokeStyle = '#4a5568'
  ctx.lineWidth = 1
  ctx.stroke()

  // 灯泡
  const bulbGrad = ctx.createRadialGradient(cx, bulbCY, 0, cx, bulbCY, bulbR)
  bulbGrad.addColorStop(0, '#ffffff')
  bulbGrad.addColorStop(0.25, base + 'ff')
  bulbGrad.addColorStop(0.6, color)
  bulbGrad.addColorStop(1, base + '88')
  ctx.fillStyle = bulbGrad
  ctx.beginPath(); ctx.arc(cx, bulbCY, bulbR, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'
  ctx.lineWidth = Math.max(1, w * 0.03)
  ctx.stroke()
}

/** 生成路灯图标 data URL */
export function makeStreetlightIcon(color, w, h) {
  const k = `${color}_${w}x${h}`
  if (iconCache[k]) return iconCache[k]
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  drawStreetlight(ctx, color, w, h)
  iconCache[k] = canvas.toDataURL('image/png')
  return iconCache[k]
}

const flashIconCache = {}

export function makeFlashIcon(color, w, h) {
  const k = `flash_${color}_${w}x${h}`
  if (flashIconCache[k]) return flashIconCache[k]
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  drawStreetlight(ctx, color, w, h)
  // 灯泡区域径向高亮
  const pad = Math.round(w * 0.12)
  const domeH = Math.round(h * 0.13)
  const domeY = pad + Math.round(h * 0.04)
  const domeCY = domeY + domeH
  const bulbCY = domeCY - Math.round(domeH * 0.2)
  const bulbR = Math.round(w * 0.18)
  const flash = ctx.createRadialGradient(w / 2, bulbCY, bulbR * 0.2, w / 2, bulbCY, bulbR * 1.6)
  flash.addColorStop(0, 'rgba(255,255,255,0.55)')
  flash.addColorStop(0.5, 'rgba(255,255,255,0.2)')
  flash.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = flash
  ctx.beginPath(); ctx.arc(w / 2, bulbCY, bulbR * 1.6, 0, Math.PI * 2); ctx.fill()
  flashIconCache[k] = canvas.toDataURL('image/png')
  return flashIconCache[k]
}

// 区域调色板
const AREA_PALETTE = ['#4dd0e1','#5c6bc0','#4caf82','#ab47bc','#ff9800','#ef5350','#42a5f5','#66bb6a','#ffa726','#26c6da']
const areaColorMap = {}

export function getAreaColor(area) {
  if (!area) return '#26a6da'
  if (!areaColorMap[area]) {
    const idx = Object.keys(areaColorMap).length % AREA_PALETTE.length
    areaColorMap[area] = AREA_PALETTE[idx]
  }
  return areaColorMap[area]
}

/** 综合颜色：离线/停用→灰；异常→橙；在线→区域色 */
export function getDeviceColor(device) {
  const s = device.status
  if (s === 0 || s === 2) return '#6b7f93'
  if (s === 3) return '#f59e0b'
  return getAreaColor(device.area)
}
