<!-- 数字孪生三维视图容器 -->
<template>
  <div ref="viewportRef" class="twin-viewport" :class="{ 'is-fullscreen': isFullscreen }">
    <div ref="canvasHostRef" class="twin-canvas"></div>

    <!-- 顶部信息条 -->
    <div class="twin-status">
      <span class="status-dot" :class="{ online: connected }"></span>
      <span class="status-text">{{ connected ? '设备在线' : '设备离线' }}</span>
      <span class="divider"></span>
      <span class="status-hint">实时映射</span>
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

    <!-- 三维标注（位置由渲染循环实时计算） -->
    <div v-show="showLabels" class="twin-labels">
      <div
        v-for="item in labelList"
        :key="item.id"
        :ref="(el) => setLabelRef(item.id, el)"
        class="twin-label"
        :class="[item.kind, { clickable: !!item.deviceKey, active: item.active }]"
        @click="item.deviceKey && emit('select', item.deviceKey)"
      >
        <template v-if="item.kind === 'sensor'">
          <span class="label-name">{{ item.title }}</span>
          <span class="label-value">{{ item.value }}</span>
        </template>
        <template v-else>
          <span class="label-dot" :class="{ on: item.active }"></span>
          <span class="label-name">{{ item.title }}</span>
          <span class="label-state" :class="{ on: item.active }">{{ item.active ? '运行中' : '已停止' }}</span>
        </template>
      </div>
    </div>

    <!-- 温度色标 -->
    <div class="twin-legend">
      <span class="legend-label">空气温度</span>
      <div class="legend-bar"></div>
      <div class="legend-scale">
        <span>低</span>
        <span>适宜</span>
        <span>高</span>
      </div>
    </div>

    <div class="twin-hint">左键拖拽旋转 · 滚轮缩放 · 右键平移 · 点击标注定位</div>

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

const props = defineProps({
  environment: { type: Object, default: () => ({}) },
  devices: { type: Object, default: () => ({}) },
  connected: { type: Boolean, default: false }
})

const emit = defineEmits(['select'])

const viewportRef = ref(null)
const canvasHostRef = ref(null)
const ready = ref(false)
const error = ref('')
const autoRotate = ref(true)
const showLabels = ref(true)
const isFullscreen = ref(false)

let scene = null
let frameTick = 0
const labelEls = {}
const projection = { x: 0, y: 0, visible: false }

const DEVICE_LABELS = {
  external_fan: '外通风',
  internal_fan: '内通风',
  skylight: '天窗',
  spray: '喷灌',
  water_curtain: '水帘',
  light: '补光灯'
}

const isOn = (key) => {
  const v = props.devices?.[key]
  return v === true || v === 1 || v === '1' || v === 'open' || v === 'active' || v === 'on'
}

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

const updateLabelPositions = () => {
  if (!scene || !showLabels.value) return
  frameTick = (frameTick + 1) % 2
  if (frameTick) return

  // 传感器标注优先展示，避免设备标注相互遮挡
  const placed = []
  const ordered = [...labelList.value].sort((a, b) => {
    if (a.kind === b.kind) return 0
    return a.kind === 'sensor' ? -1 : 1
  })

  for (const item of ordered) {
    const el = labelEls[item.id]
    const anchor = scene.anchors[item.id]
    if (!el || !anchor) continue
    scene.project(anchor, projection)

    if (!projection.visible) {
      el.style.opacity = '0'
      el.style.pointerEvents = 'none'
      continue
    }

    const w = el.offsetWidth || 90
    const h = el.offsetHeight || 20
    const left = projection.x - w / 2
    const top = projection.y - h
    const overlap = placed.some(
      (r) => left < r.right && left + w > r.left && top < r.bottom && top + h > r.top
    )

    if (overlap) {
      el.style.opacity = '0'
      el.style.pointerEvents = 'none'
      continue
    }

    placed.push({ left, top, right: left + w, bottom: top + h })
    el.style.opacity = '1'
    el.style.pointerEvents = item.deviceKey ? 'auto' : 'none'
    el.style.transform = `translate3d(${projection.x}px, ${projection.y}px, 0) translate(-50%, -100%)`
  }
}

const toggleAutoRotate = () => {
  autoRotate.value = !autoRotate.value
  if (scene) scene.setAutoRotate(autoRotate.value)
}

const toggleLabels = () => {
  showLabels.value = !showLabels.value
}

const resetView = () => {
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
  if (scene) scene.focus(key)
  if (autoRotate.value) {
    autoRotate.value = false
  }
}

defineExpose({ focus: focusDevice, resetView })

onMounted(async () => {
  await nextTick()
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
    console.error('[DigitalTwin] 初始化失败:', e)
    error.value = e?.message || '当前浏览器可能不支持 WebGL'
    ready.value = false
  }
  document.addEventListener('fullscreenchange', handleFullscreenChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  if (scene) {
    scene.dispose()
    scene = null
  }
})

onActivated(() => {
  if (scene) scene.resume()
})

onDeactivated(() => {
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
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 420px;
  border-radius: 14px;
  overflow: hidden;
  background:
    radial-gradient(120% 90% at 70% 0%, #fbfdff 0%, #eaf3f9 42%, #dfeaf2 100%);
  box-shadow: 0 10px 30px rgba(38, 66, 92, 0.12), inset 0 0 0 1px rgba(255, 255, 255, 0.7);

  &.is-fullscreen {
    border-radius: 0;
  }
}

.twin-canvas {
  position: absolute;
  inset: 0;
}

.twin-status {
  position: absolute;
  top: 14px;
  left: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 12px;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 10px rgba(38, 66, 92, 0.1);
  font-size: 12px;
  color: #4a5a68;
  pointer-events: none;

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #c0c4cc;
    box-shadow: 0 0 0 3px rgba(192, 196, 204, 0.25);

    &.online {
      background: #67c23a;
      box-shadow: 0 0 0 3px rgba(103, 194, 58, 0.2);
      animation: twin-pulse 2s ease-in-out infinite;
    }
  }

  .status-text {
    font-weight: 600;
    color: #303133;
  }

  .divider {
    width: 1px;
    height: 12px;
    background: #dcdfe6;
  }

  .status-hint {
    color: #8492a6;
  }
}

.twin-toolbar {
  position: absolute;
  top: 14px;
  right: 14px;
  display: flex;
  gap: 6px;

  .tool-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 30px;
    padding: 0 10px;
    border: none;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.82);
    backdrop-filter: blur(8px);
    box-shadow: 0 2px 10px rgba(38, 66, 92, 0.1);
    color: #54646f;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s ease;

    .el-icon {
      font-size: 14px;
      margin: 0;
      width: auto;
      height: auto;
      filter: none;
    }

    &:hover {
      color: #409eff;
      background: #fff;
      transform: translateY(-1px);
    }

    &.active {
      color: #fff;
      background: #409eff;
      box-shadow: 0 4px 12px rgba(64, 158, 255, 0.35);
    }
  }
}

.twin-labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.twin-label {
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(214, 230, 240, 0.9);
  box-shadow: 0 4px 14px rgba(38, 66, 92, 0.14);
  font-size: 10.5px;
  line-height: 1.3;
  color: #4a5a68;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.15s ease;
  will-change: transform;
  pointer-events: none;

  &.clickable {
    cursor: pointer;

    &:hover {
      border-color: #a8d4ff;
      box-shadow: 0 6px 18px rgba(64, 158, 255, 0.25);
    }
  }

  &.sensor {
    border-left: 3px solid #409eff;
  }

  &.device {
    border-left: 3px solid #c8d2da;
    background: rgba(252, 253, 254, 0.9);

    &.active {
      border-left-color: #67c23a;
    }
  }

  .label-name {
    color: #7c8b99;
  }

  .label-value {
    font-weight: 700;
    color: #2f3e4b;
    font-variant-numeric: tabular-nums;
  }

  .label-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #ccd4db;

    &.on {
      background: #67c23a;
      box-shadow: 0 0 0 3px rgba(103, 194, 58, 0.18);
    }
  }

  .label-state {
    font-weight: 600;
    color: #a0aab3;

    &.on {
      color: #4f9e2e;
    }
  }
}

.twin-legend {
  position: absolute;
  left: 16px;
  bottom: 44px;
  width: 148px;
  padding: 8px 10px 6px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(8px);
  box-shadow: 0 2px 10px rgba(38, 66, 92, 0.1);
  pointer-events: none;

  .legend-label {
    display: block;
    font-size: 11px;
    color: #7c8b99;
    margin-bottom: 5px;
  }

  .legend-bar {
    height: 6px;
    border-radius: 3px;
    background: linear-gradient(90deg, #4a90e2 0%, #63c98a 50%, #f56c6c 100%);
  }

  .legend-scale {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-size: 10px;
    color: #a0aab3;
  }
}

.twin-hint {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 14px;
  text-align: center;
  font-size: 11px;
  color: #94a3af;
  pointer-events: none;
  letter-spacing: 0.2px;
}

.twin-mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(244, 249, 252, 0.92);
  backdrop-filter: blur(2px);
  color: #5b6b78;

  .mask-icon {
    font-size: 34px;
    color: #f56c6c;
    margin: 0;
    width: auto;
    height: auto;
    filter: none;
  }

  .mask-spinner {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 3px solid rgba(64, 158, 255, 0.2);
    border-top-color: #409eff;
    animation: twin-spin 0.9s linear infinite;
  }

  .mask-title {
    font-size: 13px;
    font-weight: 600;
    color: #3d4d5a;
  }

  .mask-desc {
    font-size: 12px;
    color: #8492a6;
    max-width: 320px;
    text-align: center;
    line-height: 1.6;
  }
}

@keyframes twin-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes twin-pulse {
  0%, 100% {
    box-shadow: 0 0 0 3px rgba(103, 194, 58, 0.2);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(103, 194, 58, 0.08);
  }
}
</style>
