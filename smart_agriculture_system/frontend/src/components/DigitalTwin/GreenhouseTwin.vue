<!-- 数字孪生三维视图容器 -->
<template>
  <div ref="viewportRef" class="twin-viewport" :class="{ 'is-fullscreen': isFullscreen, inspecting: !!activeItem }" @keydown.esc="closeInspector">
    <div ref="canvasHostRef" class="twin-canvas" @pointerdown="closeInspector"></div>

    <!-- 顶部信息条 -->
    <div class="twin-status">
      <span class="status-dot" :class="{ online: connected }"></span>
      <span class="status-text">{{ connected ? '设备在线' : '设备离线' }}</span>
      <span class="divider"></span>
      <span class="status-hint">工程剖视</span>
    </div>

    <div class="scene-heading">
      <span class="scene-eyebrow">GH—01 / DIGITAL TWIN</span>
      <h3>温室工程剖视</h3>
      <p>结构 · 环境 · 设备</p>
    </div>

    <!-- 右上工具栏 -->
    <div class="twin-toolbar">
      <button
        class="tool-btn"
        :class="{ active: autoRotate }"
        title="自动旋转"
        @click="toggleAutoRotate"
      >
        <el-icon><RefreshRight /></el-icon>
        <span>旋转</span>
      </button>
      <button
        class="tool-btn"
        :class="{ active: showLabels }"
        title="显示/隐藏标注"
        @click="toggleLabels"
      >
        <el-icon><Aim /></el-icon>
        <span>标注</span>
      </button>
      <button class="tool-btn" title="重置视角" @click="resetView">
        <el-icon><ScaleToOriginal /></el-icon>
        <span>复位</span>
      </button>
      <button class="tool-btn" :title="isFullscreen ? '退出全屏' : '全屏查看'" @click="toggleFullscreen">
        <el-icon><FullScreen /></el-icon>
        <span>全屏</span>
      </button>
    </div>

    <svg v-show="showLabels" class="label-leaders" aria-hidden="true">
      <line v-for="item in labelList" :key="item.id" :ref="el => setLeaderRef(item.id, el)" />
    </svg>
    <!-- 标签避让详情卡，传感器与设备均支持直接操作。 -->
    <div v-show="showLabels" class="twin-labels">
      <button
        v-for="item in labelList"
        :key="item.id"
        :ref="(el) => setLabelRef(item.id, el)"
        class="twin-label"
        type="button"
        :aria-label="`${item.title}：${item.kind === 'device' ? deviceStateText(item.deviceKey, devices[item.deviceKey]) : item.value}，${item.kind === 'device' ? '控制设备' : '查看历史'}`"
        :aria-expanded="activeLabelId === item.id"
        :class="[item.kind, { clickable: true, active: item.active, selected: activeLabelId === item.id }]"
        @click="handleLabelClick(item)"
      >
        <template v-if="item.kind === 'sensor'">
          <span class="label-name">{{ item.title }}</span>
          <span class="label-value">{{ item.value }}</span>
        </template>
        <template v-else>
          <span class="label-dot" :class="{ on: item.active }"></span>
          <span class="label-name">{{ item.title }}</span>
          <span class="label-state" :class="{ on: item.active }">{{ deviceStateText(item.deviceKey, devices[item.deviceKey]) }}</span>
        </template>
      </button>
    </div>

    <div v-if="activeItem" ref="inspectorHostRef" class="inspector-host">
      <TwinInspector :item="activeItem" :environment="environment" :devices="devices" :connected="connected"
        :pending="pending" :disabled="controlDisabled" @close="closeInspector" @control="(key, action) => emit('control', key, action)" />
    </div>

    <!-- 温度色标 -->
    <div v-if="!activeItem" class="twin-legend">
      <span class="legend-label">底座指示条 / 空气温度</span>
      <div class="legend-bar"></div>
      <div class="legend-scale">
        <span>低</span>
        <span>适宜</span>
        <span>高</span>
      </div>
    </div>

    <div class="twin-hint">拖拽旋转 · 滚轮缩放 · 点击标签控制设备 / 查看历史</div>

    <div class="scene-note">剖切展示 · 模型比例示意</div>

    <!-- 加载 / 异常 -->
    <div v-if="!ready" class="twin-mask">
      <template v-if="error">
        <el-icon class="mask-icon"><WarningFilled /></el-icon>
        <p class="mask-title">三维视图加载失败</p>
        <p class="mask-desc">{{ error }}</p>
      </template>
      <template v-else>
        <span class="mask-spinner"></span>
        <p class="mask-title">正在构建温室数字孪生场景…</p>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, onActivated, onDeactivated, nextTick } from 'vue'
import { RefreshRight, Aim, ScaleToOriginal, FullScreen, WarningFilled } from '@element-plus/icons-vue'
import GreenhouseScene, { DEVICE_KEYS } from './greenhouseScene'
import TwinInspector from './TwinInspector.vue'
import { layoutLabels, positionInspector } from './labelLayout'
import { DEVICE_LABELS, isDeviceOn, deviceStateText } from '@/utils/devicePresentation'

const props = defineProps({
  environment: { type: Object, default: () => ({}) },
  devices: { type: Object, default: () => ({}) },
  connected: { type: Boolean, default: false },
  pending: { type: Object, default: () => ({}) },
  controlDisabled: { type: Boolean, default: true }
})

const emit = defineEmits(['select', 'control'])

const activeLabelId = ref('')
const activeItem = computed(() => labelList.value.find(item => item.id === activeLabelId.value))
const inspectorHostRef = ref(null)
const viewportRef = ref(null)
const canvasHostRef = ref(null)
const ready = ref(false)
const error = ref('')
const autoRotate = ref(false)
const showLabels = ref(true)
const isFullscreen = ref(false)

let scene = null
let disposed = false
let frameTick = 0
const labelEls = {}
const leaderEls = {}
const projection = { x: 0, y: 0, visible: false }

const isOn = key => isDeviceOn(props.devices?.[key])

const fmt = (value, digits = 0) => {
  const n = parseFloat(value)
  return Number.isFinite(n) ? n.toFixed(digits) : '--'
}

const labelList = computed(() => {
  const env = props.environment || {}
  return [
    {
      id: 'sensor-air',
      kind: 'sensor',
      title: '空气温湿度',
      value: `${fmt(env.air_temperature, 1)}℃ / ${fmt(env.air_humidity, 0)}%`
    },
    {
      id: 'sensor-co2',
      kind: 'sensor',
      title: 'CO₂ 浓度',
      value: `${fmt(env.co2_concentration, 0)} ppm`
    },
    {
      id: 'sensor-soil',
      kind: 'sensor',
      title: '土壤温湿度',
      value: `${fmt(env.soil_temperature, 1)}℃ / ${fmt(env.soil_moisture, 0)}%`
    },
    {
      id: 'sensor-light',
      kind: 'sensor',
      title: '光照强度',
      value: `${fmt(env.light_intensity, 0)} lx`
    },
    ...DEVICE_KEYS.map((key) => ({
      id: `device-${key}`,
      kind: 'device',
      title: DEVICE_LABELS[key],
      active: isOn(key),
      unknown: props.devices?.[key] == null,
      deviceKey: key
    }))
  ]
})

const setLabelRef = (id, el) => {
  if (!el) {
    delete labelEls[id]
    return
  }
  labelEls[id] = el
}

const setLeaderRef = (id, el) => {
  if (el) leaderEls[id] = el
  else delete leaderEls[id]
}
const closeInspector = () => {
  activeLabelId.value = ''
  if (scene) scene.selectedDevice = null
}
const handleLabelClick = item => {
  if (activeLabelId.value === item.id) { closeInspector(); return }
  activeLabelId.value = item.id
  autoRotate.value = false
  scene?.setAutoRotate(false)
  if (item.deviceKey) {
    scene?.focus(item.deviceKey)
    emit('select', item.deviceKey)
  }
}
const updateLabelPositions = () => {
  if (!scene || !showLabels.value) return
  frameTick = (frameTick + 1) % 3
  if (frameTick) return
  const reserved = []
  const viewport = viewportRef.value
  for (const el of [viewport.querySelector('.twin-status'), viewport.querySelector('.twin-toolbar'),
    viewport.querySelector('.scene-heading'), viewport.querySelector('.twin-legend')]) {
    if (!el || !el.offsetWidth || !el.offsetHeight) continue
    reserved.push({ x: el.offsetLeft - 5, y: el.offsetTop - 5, width: el.offsetWidth + 10, height: el.offsetHeight + 10 })
  }
  reserved.push({ x: 0, y: viewport.clientHeight - 32, width: viewport.clientWidth, height: 32 })
  const inspector = inspectorHostRef.value
  const selectedAnchor = scene.anchors[activeLabelId.value]
  if (inspector && selectedAnchor) {
    scene.project(selectedAnchor, projection)
    const rectangle = positionInspector(projection, viewport.clientWidth, viewport.clientHeight,
      inspector.offsetWidth, inspector.offsetHeight, reserved)
    inspector.style.left = `${rectangle.x}px`
    inspector.style.top = `${rectangle.y}px`
    inspector.style.right = 'auto'
    inspector.style.bottom = 'auto'
    reserved.push(rectangle)
  }
  const items = []
  for (const item of labelList.value) {
    const el = labelEls[item.id]
    const anchor = scene.anchors[item.id]
    if (!el || !anchor) continue
    scene.project(anchor, projection)
    el.style.visibility = 'hidden'
    el.tabIndex = -1
    if (leaderEls[item.id]) leaderEls[item.id].style.visibility = 'hidden'
    if (!projection.visible) continue
    items.push({ id: item.id, width: el.offsetWidth || 100, height: el.offsetHeight || 26,
      anchorX: projection.x, anchorY: projection.y })
  }
  // 当前选中项先布局，剩余标签寻找不重叠位置，不再直接因碰撞而消失。
  items.sort((a, b) => Number(b.id === activeLabelId.value) - Number(a.id === activeLabelId.value))
  for (const item of layoutLabels(items, viewport.clientWidth, viewport.clientHeight, reserved)) {
    if (!item.visible) continue
    const el = labelEls[item.id]
    el.style.visibility = 'visible'
    el.style.opacity = '1'
    el.style.pointerEvents = 'auto'
    el.style.transform = `translate3d(${item.x}px, ${item.y}px, 0)`
    el.tabIndex = 0
    const line = leaderEls[item.id]
    if (line) {
      line.setAttribute('x1', item.anchorX)
      line.setAttribute('y1', item.anchorY)
      line.setAttribute('x2', item.x + item.width / 2)
      line.setAttribute('y2', item.y + item.height)
      line.style.visibility = 'visible'
    }
  }
}

const toggleAutoRotate = () => {
  autoRotate.value = !autoRotate.value
  if (scene) scene.setAutoRotate(autoRotate.value)
}

const toggleLabels = () => {
  showLabels.value = !showLabels.value
  if (!showLabels.value) closeInspector()
}

const resetView = () => {
  closeInspector()
  if (scene) scene.resetView()
}

const toggleFullscreen = async () => {
  const el = viewportRef.value
  if (!el) return
  try {
    if (!document.fullscreenElement) {
      await el.requestFullscreen()
    } else {
      await document.exitFullscreen()
    }
  } catch (e) {
    console.warn('[DigitalTwin] 全屏切换失败:', e)
  }
}

const handleFullscreenChange = () => {
  isFullscreen.value = document.fullscreenElement === viewportRef.value
  nextTick(() => scene && scene.resize())
}

const focusDevice = (key) => {
  activeLabelId.value = `device-${key}`
  if (scene) scene.focus(key)
  if (autoRotate.value) {
    autoRotate.value = false
  }
}

defineExpose({ focus: focusDevice, resetView })

onMounted(async () => {
  await nextTick()
  if (disposed) return
  try {
    scene = new GreenhouseScene(canvasHostRef.value, {})
    scene.onFrame = updateLabelPositions
    scene.onAutoRotateChange = (val) => {
      autoRotate.value = val
    }
    scene.setEnvironment(props.environment)
    scene.setDevices(props.devices)
    scene.setAutoRotate(autoRotate.value)
    ready.value = true
  } catch (e) {
    if (scene) {
      scene.dispose()
      scene = null
    }
    console.error('[DigitalTwin] 初始化失败:', e)
    error.value = e?.message || '当前浏览器可能不支持 WebGL'
    ready.value = false
  }
  document.addEventListener('fullscreenchange', handleFullscreenChange)
})

onBeforeUnmount(() => {
  disposed = true
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  if (scene) {
    scene.dispose()
    scene = null
  }
})

onActivated(() => {
  if (scene) {
    scene.resize()
    scene.resume()
  }
})

onDeactivated(() => {
  closeInspector()
  if (scene) scene.pause()
})

watch(
  () => props.environment,
  (val) => {
    if (scene) scene.setEnvironment(val)
  },
  { deep: true }
)

watch(
  () => props.devices,
  (val) => {
    if (scene) scene.setDevices(val)
  },
  { deep: true }
)
</script>

<style lang="scss" scoped>
.twin-viewport {
  --ink: #30433d;
  --muted: #78847d;
  --accent: #3d7965;
  position: relative;
  width: 100%; height: 100%; min-height: 440px;
  border: 1px solid #cbd2cc; border-radius: 4px; overflow: hidden;
  background: radial-gradient(ellipse at 50% 38%, #f7f8f3 0%, #e8ebe5 65%, #dde3dc 100%);
  box-sizing: border-box;
  &.is-fullscreen { border-radius: 0; }
}
.twin-canvas { position: absolute; inset: 0; }
.scene-heading {
  position: absolute; top: 65px; left: 24px; pointer-events: none;
  border-left: 3px solid var(--accent); padding-left: 12px;
  .scene-eyebrow { font: 10px monospace; letter-spacing: 1.4px; color: var(--muted); }
  h3 { margin: 6px 0; font-size: 20px; font-weight: 600; color: var(--ink); letter-spacing: 2px; }
  p { margin: 0; font-size: 11px; color: var(--muted); letter-spacing: 3px; }
}
.twin-status {
  position: absolute; top: 16px; left: 20px; display: flex; align-items: center; gap: 8px;
  height: 26px; padding: 0 10px; border: 1px solid #cbd3cb; border-radius: 3px;
  background: rgba(246,248,242,.94); font-size: 11px; color: var(--ink); pointer-events: none;
  .status-dot { width: 6px; height: 6px; background: #9a9f98; border-radius: 1px; }
  .status-dot.online { background: var(--accent); }
  .divider { width: 1px; height: 11px; background: #c4ccc4; }
  .status-hint { color: var(--muted); }
}
.twin-toolbar {
  position: absolute; top: 16px; right: 16px; display: flex; gap: 4px;
  .tool-btn {
    display: flex; align-items: center; gap: 5px; height: 28px; padding: 0 9px;
    border: 1px solid #cbd3cb; border-radius: 3px; background: rgba(246,248,242,.95);
    color: #5b6c61; font-size: 11px; cursor: pointer; transition: background .2s;
    .el-icon { font-size: 13px; margin: 0; width: auto; height: auto; filter: none; }
    &:hover { background: #fff; color: var(--ink); border-color: #8b9e8f; }
    &.active { background: #3b6657; color: #fff; border-color: #3b6657; }
  }
}
.inspector-host { position: absolute; right: 14px; bottom: 36px; width: 248px; max-width: calc(100% - 28px); z-index: 4; }
.label-leaders { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;
  line { stroke: #6f8d7a; stroke-width: 1; stroke-opacity: .55; visibility: hidden; } }
.twin-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.twin-label {
  position: absolute; top: 0; left: 0; display: flex; align-items: center; gap: 6px;
  padding: 5px 8px; border-radius: 2px; border: 1px solid #b9c6bc;
  border-left: 3px solid #6d8679; background: rgba(248,250,245,.96);
  box-shadow: 0 2px 4px rgba(40,55,42,.08); font-size: 10px; line-height: 1.4;
  color: var(--ink); white-space: nowrap; opacity: 0; transition: opacity .15s; will-change: transform;
  pointer-events: none; font-family: inherit;
  &.selected { border-color: #3d7965; box-shadow: 0 0 0 1px #3d7965; }
  &:focus-visible { outline: 2px solid #3d7965; outline-offset: 2px; }
  &::after { content: ''; position: absolute; width: 1px; height: 8px; left: 50%; top: 100%; background: #7f9384; }
  &.clickable { cursor: pointer; &:hover { background: #fff; border-color: #3d7965; } }
  &.device { border-left-color: #96a19a; background: rgba(240,244,237,.96); }
  &.device.active { border-left-color: #36785a; }
  .label-name { color: #607265; }
  .label-value { font: 600 11px monospace; color: #293f34; }
  .label-dot { width: 5px; height: 5px; background: #a5afa5; border-radius: 1px; &.on { background: #36785a; } }
  .label-state { font-size: 9px; color: #7d8a7e; &.on { color: #36785a; } }
}
.twin-legend {
  position: absolute; left: 20px; bottom: 48px; width: 150px; padding: 10px;
  border: 1px solid #cad3c7; border-radius: 3px; background: rgba(246,248,242,.9); pointer-events: none;
  .legend-label { display: block; font-size: 10px; color: #657565; margin-bottom: 7px; }
  .legend-bar { height: 4px; background: linear-gradient(90deg,#638cac,#588e78,#c17a5d); }
  .legend-scale { display: flex; justify-content: space-between; margin-top: 5px; font-size: 9px; color: #7f8b7d; }
}
.twin-hint { position: absolute; left: 20px; bottom: 15px; font-size: 10px; color: #72806f; pointer-events: none; }
.scene-note { position: absolute; right: 18px; bottom: 15px; font-size: 10px; color: #7d8877; pointer-events: none; }
.twin-mask {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; background: rgba(237,241,232,.97); color: #52634f;
  .mask-icon { font-size: 34px; color: #b76c51; width: auto; height: auto; margin: 0; filter: none; }
  .mask-spinner { width: 26px; height: 26px; border: 2px solid #c8d1c4; border-top-color: #3d7965;
    border-radius: 50%; animation: twin-spin .9s linear infinite; }
  .mask-title { font-size: 13px; font-weight: 600; margin: 0; }
  .mask-desc { font-size: 12px; max-width: 320px; text-align: center; line-height: 1.6; }
}
@media (max-width: 620px) {
  .twin-toolbar { top: 52px; left: 20px; right: auto; }
  .scene-heading { top: 100px; left: 20px; h3 { font-size: 16px; } p { display: none; } }
  .scene-note { display: none; }
  .twin-label { padding: 4px 5px; .label-value, .label-state { display: none; } }
  .twin-viewport.inspecting .scene-heading { display: none; }
  .inspector-host { width: 218px; right: 10px; }

  .twin-hint { font-size: 9px; }
  .twin-legend { width: 125px; padding: 7px; }
}
@keyframes twin-spin { to { transform: rotate(360deg); } }
</style>
