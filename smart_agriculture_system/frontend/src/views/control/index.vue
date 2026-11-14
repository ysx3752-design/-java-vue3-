<template>
  <div class="control-page">
    <header class="control-header">
      <div><h2>设备控制</h2><p>查看温室设备状态并进行控制</p></div>
      <el-radio-group v-model="mode" aria-label="展示模式">
        <el-radio-button label="flat">平面模式</el-radio-button>
        <el-radio-button label="twin">数字孪生</el-radio-button>
      </el-radio-group>
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
    <FlatDevicePanel v-if="mode === 'flat'" :device-list="devices" :connected="connected"
      :disabled="disabled" :pending="pending" @control="handleControl" />
    <div v-else class="twin-layout">
      <div class="scene-wrap">
        <GreenhouseTwin ref="twinRef" :environment="monitorStore.realTimeData"
          :devices="sceneDevices" :connected="connected" :pending="pending" :control-disabled="disabled"
          @select="selectDevice" @control="handleControl" />
      </div>
      <el-card class="device-panel" shadow="never">
        <template #header>设备状态</template>
        <div class="device-list">
          <button v-for="device in devices" :key="device.type" class="device-row"
            :class="{ selected: selected === device.type }" @click="selectDevice(device.type)">
            <span>{{ device.name }}</span>
            <el-tag size="small" :type="device.status === 1 ? 'success' : 'info'">{{ deviceStateText(device.type, device.status) }}</el-tag>
          </button>
        </div>
        <div v-if="selectedDevice" class="device-actions">
          <h3>{{ selectedDevice.name }}</h3><p>{{ selectedDevice.description }}</p>
          <el-button type="primary" :loading="pending[selected] === 'open'"
            :disabled="disabled || selectedDevice.status === null || selectedDevice.status === 1"
            @click="handleControl(selected, 'open')">{{ deviceActionText(selected, 'open') }}</el-button>
          <el-button type="danger" :loading="pending[selected] === 'close'"
            :disabled="disabled || selectedDevice.status === null || selectedDevice.status === 0"
            @click="handleControl(selected, 'close')">{{ deviceActionText(selected, 'close') }}</el-button>
        </div>
        <p v-else class="muted">点击场景标签即可控制设备，也可在此选择设备。</p>
      </el-card>
    </div>
  </div>
</template>
<script setup>
import { ref, computed, watch, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useMonitorStore } from '@/store/monitor'
import { useDeviceControl } from '@/composables/useDeviceControl'
import RealtimeMetrics from '@/components/RealtimeMetrics.vue'
import FlatDevicePanel from '@/components/DeviceControl/FlatDevicePanel.vue'
import { deviceStateText, deviceActionText } from '@/utils/devicePresentation'

const GreenhouseTwin = defineAsyncComponent(() => import('@/components/DigitalTwin/GreenhouseTwin.vue'))
const route = useRoute()
const router = useRouter()
const monitorStore = useMonitorStore()
const { devices, connection, pending, refreshing, connected, disabled, error, refresh, control } = useDeviceControl()
const busy = computed(() => Object.keys(pending.value).length > 0)
const twinRef = ref(null)
const selected = ref('')
const selectedDevice = computed(() => devices.value.find(device => device.type === selected.value))
const sceneDevices = computed(() => Object.fromEntries(devices.value.map(device => [device.type, device.status])))
const storageKey = 'device-control-mode'
const readMode = () => {
  try { return localStorage.getItem(storageKey) === 'twin' ? 'twin' : 'flat' } catch { return 'flat' }
}
const mode = computed({
  get: () => ['flat', 'twin'].includes(route.query.mode) ? route.query.mode : readMode(),
  set: value => router.replace({ path: '/control', query: { ...route.query, mode: value }, hash: route.hash })
})
watch(mode, value => {
  try { localStorage.setItem(storageKey, value) } catch { /* 本地存储不可用时仍可切换 */ }
}, { immediate: true })
const selectDevice = type => {
  selected.value = type
  twinRef.value?.focus(type)
}
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
</script>
<style scoped>
.control-page { display: flex; flex-direction: column; gap: 16px; }
.control-header, .connection-bar, .connection-info { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.control-header, .connection-bar { justify-content: space-between; }
h2 { margin: 0; font-size: 22px; }
.control-header p { margin: 6px 0 0; color: var(--el-text-color-secondary); }
.muted { color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
.twin-layout { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; }
.scene-wrap { min-width: 0; height: 640px; }
.device-list { display: flex; flex-direction: column; gap: 8px; }
.device-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px;
  width: 100%; background: var(--el-bg-color); color: var(--el-text-color-primary); cursor: pointer;
  border: 1px solid var(--el-border-color-light); border-radius: 6px; font: inherit; text-align: left; }
.device-row.selected { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.device-actions { border-top: 1px solid var(--el-border-color-light); margin-top: 16px; padding-top: 8px; }
@media (max-width: 1100px) { .twin-layout { grid-template-columns: minmax(0, 1fr); } .scene-wrap { height: 520px; } }
@media (max-width: 600px) { .scene-wrap { height: 440px; } .connection-info { align-items: flex-start; } }
</style>
