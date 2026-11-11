<!-- 温室数字孪生页面 -->
<template>
  <div class="twin-page">
    <!-- 页头 -->
    <div class="twin-head">
      <div class="head-main">
        <h2 class="head-title">温室数字孪生</h2>
        <span class="head-sub">三维实时映射 · 环境参数与设备状态同步驱动</span>
      </div>
      <div class="head-actions">
        <el-tag v-if="monitorStore.error" type="warning" size="small" effect="plain">数据异常</el-tag>
        <span class="update-time">更新于 {{ lastUpdateText }}</span>
        <el-button size="small" :loading="refreshing" @click="refreshAll(false)">
          <el-icon><Refresh /></el-icon>刷新
        </el-button>
        <el-button size="small" type="primary" @click="goControl">
          <el-icon><Setting /></el-icon>设备控制
        </el-button>
      </div>
    </div>

    <!-- 主体 -->
    <div class="twin-body">
      <div class="scene-wrap">
        <GreenhouseTwin
          ref="twinRef"
          :environment="environment"
          :devices="devices"
          :connected="connected"
          @select="handleSelect"
        />
      </div>

      <aside class="side-panel">
        <!-- 环境态势 -->
        <section class="panel-card">
          <header class="panel-head">
            <span class="panel-title">环境态势</span>
            <span class="panel-extra">{{ metrics.length }} 项参数</span>
          </header>
          <div class="metric-grid">
            <div v-for="m in metrics" :key="m.key" class="metric">
              <div class="metric-top">
                <el-icon class="metric-icon"><component :is="m.icon" /></el-icon>
                <span class="metric-label">{{ m.label }}</span>
                <span class="metric-status" :style="{ color: m.status.color }">{{ m.status.text }}</span>
              </div>
              <div class="metric-value">
                {{ m.display }}<span class="metric-unit">{{ m.unit }}</span>
              </div>
              <div class="metric-bar">
                <i :style="{ width: m.percent + '%', background: m.status.color }"></i>
              </div>
            </div>
          </div>
        </section>

        <!-- 设备状态 -->
        <section class="panel-card">
          <header class="panel-head">
            <span class="panel-title">设备运行状态</span>
            <span class="panel-extra">{{ activeCount }}/{{ deviceRows.length }} 运行中</span>
          </header>
          <div class="device-list">
            <div
              v-for="item in deviceRows"
              :key="item.key"
              class="device-row"
              :class="{ on: item.on, selected: selected === item.key }"
              @click="handleSelect(item.key)"
            >
              <span class="device-dot"></span>
              <el-icon class="device-icon"><component :is="item.icon" /></el-icon>
              <span class="device-name">{{ item.name }}</span>
              <span class="device-state">{{ item.on ? '运行中' : '已停止' }}</span>
              <el-icon class="device-locate"><Aim /></el-icon>
            </div>
          </div>
          <p class="panel-tip">点击设备可在三维场景中定位查看</p>
        </section>

        <!-- 联动说明 -->
        <section class="panel-card">
          <header class="panel-head">
            <span class="panel-title">场景联动说明</span>
          </header>
          <ul class="mapping-list">
            <li v-for="item in mappings" :key="item.text">
              <i :style="{ background: item.color }"></i>
              <span>{{ item.text }}</span>
            </li>
          </ul>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onActivated, onDeactivated, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import {
  Refresh,
  Setting,
  Aim,
  Sunny,
  Drizzling,
  Odometer,
  Pouring,
  Sunrise,
  Cloudy,
  WindPower,
  Umbrella,
  Monitor
} from '@element-plus/icons-vue'
import GreenhouseTwin from '@/components/DigitalTwin/GreenhouseTwin.vue'
import { useMonitorStore } from '@/store/monitor'
import { getDeviceStatus, getConnectionStatus } from '@/api/device'

const POLL_INTERVAL = 8000

const router = useRouter()
const monitorStore = useMonitorStore()
const twinRef = ref(null)

const refreshing = ref(false)
const connected = ref(false)
const selected = ref('')
const devices = ref({
  external_fan: 0,
  internal_fan: 0,
  skylight: 0,
  spray: 0,
  water_curtain: 0,
  light: 0
})

let timer = null

const environment = computed(() => monitorStore.realTimeData)

const num = (v) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

const lastUpdateText = computed(() => {
  const t = monitorStore.lastUpdateTime
  if (!t) return '暂无数据'
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
})

const judge = (value, low, high, labels = ['偏低', '适宜', '偏高']) => {
  if (value < low) return { text: labels[0], color: '#409EFF' }
  if (value > high) return { text: labels[2], color: '#F56C6C' }
  return { text: labels[1], color: '#67C23A' }
}

const metrics = computed(() => {
  const d = environment.value || {}
  const items = [
    {
      key: 'air_temperature',
      label: '空气温度',
      unit: '℃',
      digits: 1,
      icon: Sunny,
      value: num(d.air_temperature),
      min: 0,
      max: 40,
      status: judge(num(d.air_temperature), 16, 30)
    },
    {
      key: 'air_humidity',
      label: '空气湿度',
      unit: '%',
      digits: 0,
      icon: Drizzling,
      value: num(d.air_humidity),
      min: 0,
      max: 100,
      status: judge(num(d.air_humidity), 45, 88, ['偏干', '适宜', '偏湿'])
    },
    {
      key: 'soil_temperature',
      label: '土壤温度',
      unit: '℃',
      digits: 1,
      icon: Odometer,
      value: num(d.soil_temperature),
      min: 0,
      max: 40,
      status: judge(num(d.soil_temperature), 14, 28)
    },
    {
      key: 'soil_moisture',
      label: '土壤湿度',
      unit: '%',
      digits: 0,
      icon: Pouring,
      value: num(d.soil_moisture),
      min: 0,
      max: 100,
      status: judge(num(d.soil_moisture), 30, 75, ['偏干', '适宜', '偏湿'])
    },
    {
      key: 'light_intensity',
      label: '光照强度',
      unit: 'lx',
      digits: 0,
      icon: Sunrise,
      value: num(d.light_intensity),
      min: 0,
      max: 60000,
      status: judge(num(d.light_intensity), 3000, 40000, ['偏弱', '适宜', '偏强'])
    },
    {
      key: 'co2_concentration',
      label: 'CO₂ 浓度',
      unit: 'ppm',
      digits: 0,
      icon: Cloudy,
      value: num(d.co2_concentration),
      min: 300,
      max: 1500,
      status: judge(num(d.co2_concentration), 400, 1200)
    }
  ]
  return items.map((it) => ({
    ...it,
    display: it.value.toFixed(it.digits),
    percent: clamp(((it.value - it.min) / (it.max - it.min)) * 100, 2, 100)
  }))
})

const DEVICE_META = [
  { key: 'external_fan', name: '外通风', icon: WindPower },
  { key: 'internal_fan', name: '内通风', icon: WindPower },
  { key: 'skylight', name: '天窗', icon: Monitor },
  { key: 'spray', name: '喷灌', icon: Umbrella },
  { key: 'water_curtain', name: '水帘', icon: Drizzling },
  { key: 'light', name: '补光灯', icon: Sunny }
]

const deviceRows = computed(() =>
  DEVICE_META.map((item) => ({
    ...item,
    on: Number(devices.value[item.key]) === 1
  }))
)

const activeCount = computed(() => deviceRows.value.filter((i) => i.on).length)

const mappings = [
  { color: '#4a90e2', text: '空气温度 → 基座光环冷暖色' },
  { color: '#9ad3f0', text: '空气湿度 → 室内雾气浓度' },
  { color: '#ffd54f', text: '光照强度 → 场景日光强弱' },
  { color: '#8d6e4f', text: '土壤湿度 → 苗床土壤湿润度' },
  { color: '#67c23a', text: '设备状态 → 风扇/天窗/喷灌/水帘/补光动画' }
]

const handleSelect = (key) => {
  selected.value = key
  if (twinRef.value) twinRef.value.focus(key)
}

const goControl = () => router.push('/control')

const loadDevices = async () => {
  const res = await getDeviceStatus()
  const list = res?.devices || []
  if (!list.length) return
  const next = { ...devices.value }
  list.forEach((d) => {
    if (!d || !(d.type in next)) return
    const on = d.status === 1 || d.status === '1' || d.status === 'active' || d.status === 'open' || d.status === true
    next[d.type] = on ? 1 : 0
  })
  devices.value = next
}

const loadConnection = async () => {
  const res = await getConnectionStatus()
  connected.value = res?.status === 'connected'
}

const refreshAll = async (silent = true) => {
  if (!silent) refreshing.value = true
  try {
    await Promise.allSettled([
      monitorStore.fetchRealTimeData(),
      loadDevices(),
      loadConnection()
    ])
  } finally {
    refreshing.value = false
  }
}

const startPolling = () => {
  stopPolling()
  refreshAll()
  timer = setInterval(() => refreshAll(), POLL_INTERVAL)
}

const stopPolling = () => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

onMounted(() => {
  startPolling()
})

onActivated(() => {
  startPolling()
})

onDeactivated(() => {
  stopPolling()
})

onBeforeUnmount(() => {
  stopPolling()
})
</script>

<style lang="scss" scoped>
.twin-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: calc(100vh - 100px);
  min-height: 600px;
}

.twin-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 4px;

  .head-main {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
  }

  .head-title {
    font-size: 20px;
    font-weight: 700;
    color: #2f3e4b;
    letter-spacing: 0.4px;
  }

  .head-sub {
    font-size: 12px;
    color: #8a99a6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;

    :deep(.el-button .el-icon) {
      margin-right: 4px;
    }
  }

  .update-time {
    font-size: 12px;
    color: #8a99a6;
    font-variant-numeric: tabular-nums;
  }
}

.twin-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 14px;
}

.scene-wrap {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.side-panel {
  width: 336px;
  flex: none;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 2px;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-thumb {
    background: #d8e2ea;
    border-radius: 3px;
  }
}

.panel-card {
  background: #fff;
  border-radius: 12px;
  padding: 12px 14px 13px;
  box-shadow: 0 6px 18px rgba(38, 66, 92, 0.08);
  border: 1px solid rgba(226, 236, 243, 0.9);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;

  .panel-title {
    position: relative;
    padding-left: 10px;
    font-size: 14px;
    font-weight: 600;
    color: #303133;

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 13px;
      border-radius: 2px;
      background: #409eff;
    }
  }

  .panel-extra {
    font-size: 11px;
    color: #9aa7b2;
    font-variant-numeric: tabular-nums;
  }
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.metric {
  padding: 8px 9px 7px;
  border-radius: 9px;
  background: #f7fafc;
  border: 1px solid #eef4f8;
  transition: all 0.2s ease;

  &:hover {
    background: #f2f8fd;
    border-color: #dceaf6;
  }

  .metric-top {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .metric-icon {
    font-size: 13px;
    color: #7fa8c9;
    margin: 0;
    width: auto;
    height: auto;
    filter: none;
  }

  .metric-label {
    font-size: 11px;
    color: #7c8b99;
    white-space: nowrap;
  }

  .metric-status {
    margin-left: auto;
    font-size: 10px;
    font-weight: 600;
  }

  .metric-value {
    margin-top: 3px;
    font-size: 17px;
    font-weight: 700;
    color: #2f3e4b;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;

    .metric-unit {
      margin-left: 2px;
      font-size: 11px;
      font-weight: 500;
      color: #94a3af;
    }
  }

  .metric-bar {
    margin-top: 6px;
    height: 3px;
    border-radius: 2px;
    background: #e6eef4;
    overflow: hidden;

    i {
      display: block;
      height: 100%;
      border-radius: 2px;
      transition: width 0.6s ease, background 0.4s ease;
    }
  }
}

.device-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.device-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border-radius: 9px;
  background: #f9fbfc;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.2s ease;

  .device-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #ccd4db;
    flex: none;
    transition: all 0.3s ease;
  }

  .device-icon {
    font-size: 14px;
    color: #9aa7b2;
    margin: 0;
    width: auto;
    height: auto;
    filter: none;
    transition: color 0.3s ease;
  }

  .device-name {
    font-size: 12px;
    color: #4a5a68;
  }

  .device-state {
    margin-left: auto;
    font-size: 11px;
    color: #a0aab3;
    font-weight: 600;
  }

  .device-locate {
    font-size: 13px;
    color: #c8d2da;
    margin: 0;
    width: auto;
    height: auto;
    filter: none;
    transition: color 0.2s ease;
  }

  &.on {
    .device-dot {
      background: #67c23a;
      box-shadow: 0 0 0 3px rgba(103, 194, 58, 0.16);
    }

    .device-icon {
      color: #67c23a;
    }

    .device-state {
      color: #4f9e2e;
    }
  }

  &:hover {
    background: #f2f8fd;
    border-color: #dceaf6;

    .device-locate {
      color: #409eff;
    }
  }

  &.selected {
    background: #ecf5ff;
    border-color: #b9dbff;
  }
}

.panel-tip {
  margin-top: 7px;
  font-size: 11px;
  color: #a6b1bb;
}

.mapping-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;

  li {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: #6b7a87;
    line-height: 1.4;

    i {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex: none;
    }
  }
}

@media (max-width: 1200px) {
  .twin-page {
    height: auto;
    min-height: 0;
  }

  .twin-body {
    flex-direction: column;
  }

  .scene-wrap {
    height: 520px;
  }

  .side-panel {
    width: 100%;
    overflow: visible;
  }
}
</style>
