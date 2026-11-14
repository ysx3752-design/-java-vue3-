const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const vm = require('node:vm')
const { ref, computed } = require('vue')

const tick = () => new Promise(setImmediate)
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
async function harness() {
  const hooks = {}
  const timers = new Map()
  let timerId = 0
  const calls = { status: 0, connection: 0, control: 0 }
  const api = {
    getConnectionStatus: async () => { calls.connection++; return { status: 'connected' } },
    getDeviceStatus: async () => {
      calls.status++
      return { devices: [{ type: 'light', status: '0' }, { type: 'external_fan', status: true }] }
    },
    controlDevice: async () => { calls.control++; return { success: true, data: { status: { status: 1 } } } }
  }
  const context = vm.createContext({
    setTimeout: fn => { timers.set(++timerId, fn); return timerId },
    clearTimeout: id => timers.delete(id)
  })
  const vue = { ref, computed }
  for (const hook of ['onMounted', 'onActivated', 'onDeactivated', 'onUnmounted']) vue[hook] = fn => { hooks[hook] = fn }
  const vueModule = new vm.SyntheticModule(Object.keys(vue), function () {
    for (const [key, value] of Object.entries(vue)) this.setExport(key, value)
  }, { context })
  const apiModule = new vm.SyntheticModule(Object.keys(api), function () {
    for (const key of Object.keys(api)) this.setExport(key, (...args) => api[key](...args))
  }, { context })
  const source = readFileSync(resolve(__dirname, '../src/composables/useDeviceControl.js'), 'utf8')
  const module = new vm.SourceTextModule(source, { context })
  await module.link(name => name === 'vue' ? vueModule : apiModule)
  await module.evaluate()
  return { state: module.namespace.useDeviceControl(), hooks, timers, api, calls }
}

test('normalizes device states and leaves unavailable devices unknown', async () => {
  const { state } = await harness()
  await state.refresh()
  assert.equal(state.devices.value.length, 8)
  assert.equal(state.devices.value.find(d => d.type === 'light').status, 0)
  assert.equal(state.devices.value.find(d => d.type === 'external_fan').status, 1)
  assert.equal(state.devices.value.find(d => d.type === 'spray').status, null)
})

test('deduplicates reads and never marks a disconnected controller online from device data', async () => {
  const { state, api, calls } = await harness()
  const gate = deferred()
  api.getConnectionStatus = async () => { calls.connection++; await gate.promise; return { status: 'disconnected' } }
  const first = state.refresh()
  const second = state.refresh()
  assert.equal(first, second)
  gate.resolve()
  await first
  assert.equal(calls.status, 1)
  assert.equal(state.connected.value, false)
  assert.equal(state.disabled.value, true)
})

test('does not optimistically change state or accept duplicate commands', async () => {
  const { state, api, calls } = await harness()
  await state.refresh()
  const gate = deferred()
  api.controlDevice = async () => { calls.control++; await gate.promise; return { success: true, data: { status: { status: 1 } } } }
  const command = state.control('light', 'open')
  assert.equal(state.devices.value.find(d => d.type === 'light').status, 0)
  assert.equal(state.pending.value.light, 'open')
  assert.equal(await state.control('light', 'open'), null)
  await state.refresh()
  assert.equal(calls.status, 1)
  api.getDeviceStatus = async () => ({ devices: [{ type: 'light', status: 1 }] })
  gate.resolve()
  await command
  assert.equal(calls.control, 1)
  assert.equal(state.devices.value.find(d => d.type === 'light').status, 1)
  assert.equal(Object.keys(state.pending.value).length, 0)
})

test('failed commands preserve state and reconcile from server', async () => {
  const { state, api, calls } = await harness()
  await state.refresh()
  api.controlDevice = async () => ({ success: false, message: 'command failed' })
  await assert.rejects(state.control('light', 'open'), /command failed/)
  assert.equal(calls.status, 2)
  assert.equal(state.devices.value.find(d => d.type === 'light').status, 0)
  assert.equal(Object.keys(state.pending.value).length, 0)
})

test('status failures are visible and disable controls until recovery', async () => {
  const { state, api } = await harness()
  await state.refresh()
  api.getDeviceStatus = async () => ({ devices: [], error: 'unavailable' })
  await state.refresh()
  assert.equal(state.error.value, 'unavailable')
  assert.equal(state.disabled.value, true)
  api.getDeviceStatus = async () => ({ devices: [{ type: 'light', status: 0 }] })
  await state.refresh()
  assert.equal(state.error.value, '')
  assert.equal(state.disabled.value, false)
})

test('mount and activation share one timer; reactivation during a read does not leave extra timers', async () => {
  const { hooks, timers, api, calls } = await harness()
  const gate = deferred()
  api.getDeviceStatus = async () => { calls.status++; await gate.promise; return { devices: [{ type: 'light', status: 0 }] } }
  hooks.onMounted()
  hooks.onActivated()
  hooks.onDeactivated()
  hooks.onActivated()
  gate.resolve()
  await tick()
  assert.equal(calls.status, 1)
  assert.equal(timers.size, 1)
  hooks.onDeactivated()
  assert.equal(timers.size, 0)
})

test('unmount during a pending read does not update state or restart polling', async () => {
  const { state, hooks, timers, api } = await harness()
  const gate = deferred()
  api.getDeviceStatus = async () => { await gate.promise; return { devices: [{ type: 'light', status: 1 }] } }
  hooks.onMounted()
  hooks.onUnmounted()
  gate.resolve()
  await tick()
  assert.equal(timers.size, 0)
  assert.equal(state.devices.value.find(d => d.type === 'light').status, null)
})
