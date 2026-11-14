const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const THREE = require('three')
async function loadModule(file, imports = {}) {
  const context = vm.createContext({ console })
  const module = new vm.SourceTextModule(readFileSync(resolve(__dirname, file), 'utf8'), { context })
  await module.link(name => {
    const values = imports[name]
    if (!values) throw Error('Unexpected import: ' + name)
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  return module.namespace
}
const sceneModule = () => loadModule('../src/components/DigitalTwin/greenhouseScene.js', {
  three: THREE, 'three/examples/jsm/controls/OrbitControls.js': { OrbitControls: class {} }
})

test('selecting any device keeps the orbit target at the base center and cancels old camera movement', async () => {
  const { default: Scene, DEVICE_KEYS } = await sceneModule()
  const scene = Object.create(Scene.prototype)
  scene.controls = { target: new THREE.Vector3(6.6, 1.9, 0), autoRotate: true }
  scene.tween = {}
  for (const key of DEVICE_KEYS) {
    scene.focus(key)
    assert.equal(scene.controls.target.length(), 0)
    assert.equal(scene.tween, null)
    assert.equal(scene.controls.autoRotate, false)
    assert.equal(scene.selectedDevice, key)
  }
})

test('both shading devices have independent geometry and deployment animations', async () => {
  const { default: Scene, DEVICE_KEYS } = await sceneModule()
  assert.equal(DEVICE_KEYS.length, 8)
  const scene = Object.create(Scene.prototype)
  scene.scene = new THREE.Scene()
  scene.buildShades()
  const off = Object.fromEntries(DEVICE_KEYS.map(key => [key, 0]))
  scene.cur = { devices: { ...off } }
  scene.target = { devices: { ...off, external_shade: 1 } }
  scene.fans = []; scene.vents = []; scene.lampBulbs = []
  scene.drops = {}; scene.drips = {}; scene.indoorLight = {}
  scene.curtainTexture = { offset: { y: 0 } }
  scene.curtainMaterial = { color: new THREE.Color() }
  scene.updateDevices(1)
  assert.ok(scene.shades.find(s => s.key === 'external_shade').moving.scale.z > .99)
  assert.equal(scene.shades.find(s => s.key === 'internal_shade').moving.scale.z, .035)
  scene.target.devices.external_shade = 0
  scene.target.devices.internal_shade = 1
  scene.updateDevices(1)
  assert.ok(scene.shades.find(s => s.key === 'internal_shade').moving.scale.z > .99)
  assert.ok(scene.shades.find(s => s.key === 'external_shade').moving.scale.z < .05)
})

test('dense labels stay inside the viewport and avoid the inspector and each other', async () => {
  const { layoutLabels } = await loadModule('../src/components/DigitalTwin/labelLayout.js')
  const cases = [
    { width: 900, height: 640, labelWidth: 160, reserved: [{ x: 638, y: 374, width: 248, height: 230 }] },
    { width: 352, height: 440, labelWidth: 70, reserved: [{ x: 0, y: 0, width: 352, height: 90 }, { x: 124, y: 174, width: 218, height: 230 }] }
  ]
  for (const { width, height, labelWidth, reserved } of cases) {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: i, anchorX: width / 2, anchorY: height / 2, width: labelWidth, height: 26 }))
    const placed = layoutLabels(items, width, height, reserved)
    assert.ok(placed.every(p => p.visible), 'all 12 labels must remain available')
    const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
    for (let i = 0; i < placed.length; i++) {
      const item = placed[i]
      assert.ok(item.x >= 0 && item.y >= 0 && item.x + item.width <= width && item.y + item.height <= height)
      assert.ok(!reserved.some(r => overlaps(item, r)))
      assert.ok(!placed.slice(0, i).some(r => overlaps(item, r)))
    }
  }
})

test('state wording distinguishes a closed skylight from a retracted shade', async () => {
  const { deviceStateText, deviceActionText } = await loadModule('../src/utils/devicePresentation.js')
  assert.equal(deviceStateText('skylight', 0), '已关闭')
  assert.equal(deviceStateText('light', 1), '已开启')
  assert.equal(deviceStateText('external_shade', 0), '已收起')
  assert.equal(deviceStateText('internal_shade', 1), '已展开')
  assert.equal(deviceStateText('light', null), '状态未知')
  assert.equal(deviceActionText('external_shade', 'open'), '展开')
})

test('inspector stays within the scene and avoids reserved toolbar areas near viewport edges', async () => {
  const { positionInspector } = await loadModule('../src/components/DigitalTwin/labelLayout.js')
  const reserved = [{ x: 0, y: 0, width: 352, height: 90 }]
  for (const anchor of [{ x: 5, y: 5 }, { x: 350, y: 435 }, { x: 175, y: 200 }]) {
    const card = positionInspector(anchor, 352, 440, 218, 204, reserved)
    assert.ok(card.x >= 0 && card.x + card.width <= 352)
    assert.ok(card.y >= 90 && card.y + card.height <= 440 - 32)
  }
})
