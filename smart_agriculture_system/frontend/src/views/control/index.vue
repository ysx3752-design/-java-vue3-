<template>
  <div class="control-page">
    <header class="control-header">
      <div><h2>设备控制</h2><p>查看温室设备状态并进行控制</p></div>
    </header>
    <el-card shadow="never">
      <div class="connection-bar">
        <div class="connection-info">
          <el-tag :type="connected ? 'success' : 'danger'">{{ connected ? '已连接' : '未连接' }}</el-tag>
          <span>{{ connection.message }}</span>
          <span v-if="connection.totalDevices" class="muted">{{ connected ? connection.connectedDevices : 0 }}/{{ connection.totalDevices }} 设备在线</span>
          <span class="muted">上次通信：{{ formatTime(connection.lastCommunication) }}</span>
        </div>
        <el-button :loading="refreshing" :disabled="busy" @click="refresh">刷新状态</el-button>
      </div>
    </el-card>
    <el-alert v-if="error" :title="error" type="warning" show-icon :closable="false" />
    <RealtimeMetrics :interval="5000" />
    <div class="twin-layout">
      <div class="scene-wrap">
        <GreenhouseTwin :environment="monitorStore.realTimeData"
          :devices="sceneDevices" :connected="connected" :pending="pending" :control-disabled="disabled"
          @select="selectDevice" @control="handleControl" />
      </div>
      <el-card class="device-panel" shadow="never">
        <template #header>
          <div class="panel-header">
            <span>设备状态</span>
            <el-switch :model-value="autoEnabled" :loading="autoToggling" active-text="自动控制" @change="toggleAutoControl" />
          </div>
        </template>
        <div class="device-list">
          <div v-for="device in devices" :key="device.type" class="device-entry">
            <div class="device-row" :class="{ selected: selected === device.type }">
              <span class="device-name">{{ device.name }}</span>
              <el-tag size="small" :type="device.status === 1 ? 'success' : 'info'">{{ deviceStateText(device.type, device.status) }}</el-tag>
              <el-button :type="device.status === 1 ? 'default' : 'primary'" size="small"
                :loading="Boolean(pending[device.type])"
                :aria-label="`${device.name}${device.status == null ? '状态未知' : deviceActionText(device.type, deviceNextAction(device.status))}`"
                :disabled="disabled || device.status == null"
                @click="handleControl(device.type, deviceNextAction(device.status))">
                {{ device.status == null ? '状态未知' : deviceActionText(device.type, deviceNextAction(device.status)) }}
              </el-button>
            </div>
          </div>
        </div>
        <h3 class="sensor-title">传感器当前读数</h3>
        <div class="sensor-readings">
          <div v-for="metric in sensorMetrics" :key="metric.key" class="sensor-row">
            <span>{{ metric.label }}</span><strong>{{ sensorValue(metric) }} <small>{{ metric.unit }}</small></strong>
          </div>
        </div>
        <p v-if="monitorStore.error" class="muted">采集异常，保留上次读数</p>
      </el-card>
    </div>
  </div>
</template>
<script setup>
import { ref, computed, onMounted, defineAsyncComponent } from 'vue'
import { ElMessage } from 'element-plus'
import { useMonitorStore } from '@/store/monitor'
import { useDeviceControl } from '@/composables/useDeviceControl'
import RealtimeMetrics from '@/components/RealtimeMetrics.vue'
import { deviceStateText, deviceActionText, deviceNextAction } from '@/utils/devicePresentation'
import { METRIC_LIST } from '@/composables/useRealtimeFeed'
import { getAutoControlStatus, enableAutoControl, disableAutoControl } from '@/api/auto-control'

const GreenhouseTwin = defineAsyncComponent(() => import('@/components/DigitalTwin/GreenhouseTwin.vue'))
const monitorStore = useMonitorStore()
const { devices, connection, pending, refreshing, connected, disabled, error, refresh, control } = useDeviceControl()
const busy = computed(() => Object.keys(pending.value).length > 0)
const selected = ref('')
const sensorMetrics = METRIC_LIST.map(metric => ({ ...metric, key: metric.rawKey }))
const sensorValue = metric => {
  const value = monitorStore.realTimeData[metric.key]
  return !monitorStore.lastUpdateTime || value == null || !Number.isFinite(Number(value)) ? '--' : Number(value).toFixed(metric.decimals)
}
const sceneDevices = computed(() => Object.fromEntries(devices.value.map(device => [device.type, device.status])))
const selectDevice = type => { selected.value = type }
const formatTime = value => {
  if (!value) return '未知'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN')
}
const handleControl = async (type, action) => {
  try {
    const result = await control(type, action)
    if (result) ElMessage.success(result.message)
  } catch (cause) {
    ElMessage.error(cause.message || '设备控制失败')
  }
}

// 自动控制总开关（从告警页的规则面板移入，逻辑不变）
const autoEnabled = ref(false)
const autoToggling = ref(false)
const toggleAutoControl = async value => {
  if (autoToggling.value) return
  autoToggling.value = true
  try {
    const result = await (value ? enableAutoControl() : disableAutoControl())
    if (!result.success) throw Error(result.error)
    autoEnabled.value = result.enabled
    ElMessage.success(result.message)
  } catch (error) {
    ElMessage.error(error.message || '切换失败')
  } finally {
    autoToggling.value = false
  }
}
onMounted(async () => {
  try {
    const status = await getAutoControlStatus()
    if (!status.error) autoEnabled.value = Boolean(status.enabled)
  } catch (error) {
    console.error('获取自动控制状态失败:', error)
  }
})
</script>
<style scoped>
.control-page { display: flex; flex-direction: column; gap: 16px; }
.control-header, .connection-bar, .connection-info { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.control-header, .connection-bar { justify-content: space-between; }
h2 { margin: 0; font-size: 22px; }
.control-header p { margin: 6px 0 0; color: var(--el-text-color-secondary); }
.muted { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
.twin-layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; }
.scene-wrap { min-width: 0; height: 640px; }
.device-list { display: flex; flex-direction: column; gap: 8px; }
.panel-header { display: flex; justify-content: space-between; align-items: center; }
.device-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px;
  width: 100%; background: var(--el-bg-color); color: var(--el-text-color-primary);
  border: 1px solid var(--el-border-color-light); border-radius: 6px; font: inherit; text-align: left; }
.device-row.selected { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.device-name { flex: 1; min-width: 0; }
.device-entry { border: 1px solid var(--el-border-color-light); border-radius: 6px; }
.device-row { border: 0; gap: 6px; padding: 9px 8px; }
.device-row :deep(.el-button + .el-button) { margin-left: 0; }
.device-row :deep(.el-button--small) { padding: 5px 8px; }
.sensor-title { margin: 16px 0 8px; font-size: 14px; }
.sensor-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12px; border-bottom: 1px solid var(--el-border-color-lighter); }
.sensor-row strong { font-variant-numeric: tabular-nums; }
.sensor-row small { color: var(--el-text-color-secondary); font-weight: normal; }
@media (max-width: 1100px) { .twin-layout { grid-template-columns: minmax(0, 1fr); } .scene-wrap { height: 640px; } }
@media (max-width: 600px) { .scene-wrap { height: 640px; } .connection-info { align-items: flex-start; } }
</style>
