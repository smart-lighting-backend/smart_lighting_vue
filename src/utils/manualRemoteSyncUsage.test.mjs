import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const manualModalPath = resolve(__dirname, '../components/ManualControlModal.vue')
const detailPath = resolve(__dirname, '../views/DeviceDetail.vue')

const manualModalSource = readFileSync(manualModalPath, 'utf8')
const detailSource = readFileSync(detailPath, 'utf8')

assert.match(
  manualModalSource,
  /manual-control-state-change/,
  'ManualControlModal should publish successful manual control state changes.',
)

assert.match(
  detailSource,
  /manual-control-state-change/,
  'DeviceDetail should listen for manual control state changes from the modal.',
)

assert.match(
  detailSource,
  /window\.removeEventListener\(MANUAL_CONTROL_STATE_EVENT/,
  'DeviceDetail should remove the manual control state listener on unmount.',
)

console.log('manualRemoteSyncUsage tests passed')
