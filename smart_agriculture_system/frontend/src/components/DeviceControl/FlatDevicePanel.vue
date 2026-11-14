<template>
    <el-row :gutter="20">
      <el-col :xs="24" :sm="12" :md="8" :lg="6" v-for="device in deviceList" :key="device.type">
        <el-card shadow="hover" class="device-card mb-4" :class="{ 'device-offline': !connected, 'device-active': device.status === 1 }">
          <div class="device-header">
            <el-icon :class="{ 'is-active': device.status === 1 }">
              <component :is="getDeviceIcon(device.type)" />
            </el-icon>
            <span class="device-name">{{ device.name || device.type }}</span>
            <el-tag :type="device.status === 1 ? 'success' : 'info'" size="small" class="device-status-tag">
              {{ deviceStateText(device.type, device.status) }}
            </el-tag>
          </div>
          
          <div class="device-content">
            <div class="device-info">
              <p><strong>类型：</strong>{{ device.type }}</p>
              <p><strong>状态：</strong>
                <span :class="device.status === 1 ? 'status-on' : 'status-off'">
                  {{ deviceStateText(device.type, device.status) }}
                </span>
              </p>
              <p><strong>描述：</strong>{{ device.description || '无描述' }}</p>
            </div>
            
            <div class="device-controls">
              <el-switch
                :model-value="device.status === 1"
                :active-text="deviceActionText(device.type, 'open')"
                :inactive-text="deviceActionText(device.type, 'close')"
                :disabled="disabled || device.status === null"
                :loading="pending[device.type] != null"
                @change="(val) => emit('control', device.type, val ? 'open' : 'close')"
                class="device-switch"
              />
              <div class="button-controls">
                <el-button-group>
                  <el-button
                    type="primary"
                    :loading="pending[device.type] === 'open'"
                    :disabled="device.status === 1 || disabled || device.status === null"
                    @click="emit('control', device.type, 'open')"
                    size="small"
                  >
                    <el-icon><CircleCheck /></el-icon> {{ deviceActionText(device.type, 'open') }}
                  </el-button>
                  <el-button
                    type="danger"
                    :loading="pending[device.type] === 'close'"
                    :disabled="device.status === 0 || disabled || device.status === null"
                    @click="emit('control', device.type, 'close')"
                    size="small"
                  >
                    <el-icon><CircleClose /></el-icon> {{ deviceActionText(device.type, 'close') }}
                  </el-button>
                </el-button-group>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
</template>
<script setup>
import { deviceStateText, deviceActionText } from '@/utils/devicePresentation'
import { Monitor, WindPower, Umbrella, Sunny, Drizzling, Setting, CircleCheck, CircleClose } from '@element-plus/icons-vue'
defineProps({
  deviceList: { type: Array, required: true },
  connected: Boolean,
  disabled: Boolean,
  pending: { type: Object, required: true }
})
const emit = defineEmits(['control'])
const icons = { external_shade: Umbrella, internal_shade: Umbrella, external_fan: WindPower,
  internal_fan: WindPower, skylight: Monitor, spray: Umbrella, water_curtain: Drizzling, light: Sunny }
const getDeviceIcon = (type) => icons[type] || Setting
</script>
<style scoped>
.mb-4 { margin-bottom: 16px; }
.device-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  transition: all 0.3s ease;
  border: 1px solid var(--el-border-color-light);
}

.device-active {
  border-color: var(--el-color-success);
  box-shadow: 0 0 8px rgba(103, 194, 58, 0.3);
}

.device-header {
  display: flex;
  align-items: center;
  margin-bottom: 15px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.device-header .el-icon {
  font-size: 24px;
  margin-right: 10px;
  color: var(--el-color-info);
}

.device-header .el-icon.is-active {
  color: var(--el-color-success);
}

.device-name {
  font-size: 16px;
  font-weight: 500;
  margin-right: 10px;
  flex: 1;
}

.device-status-tag {
  min-width: 40px;
  text-align: center;
}

.device-content {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.device-info {
  margin-bottom: 15px;
  flex: 1;
}

.device-info p {
  margin: 8px 0;
  color: var(--el-text-color-regular);
  display: flex;
}

.device-info p strong {
  width: 60px;
  color: var(--el-text-color-secondary);
}

.status-on {
  color: var(--el-color-success);
  font-weight: 500;
}

.status-off {
  color: var(--el-color-info);
}

.device-controls {
  display: flex;
  flex-direction: column;
  gap: 15px;
  padding-top: 10px;
  border-top: 1px dashed var(--el-border-color-light);
}

.device-switch {
  width: 100%;
  display: flex;
  justify-content: center;
}

.button-controls {
  display: flex;
  justify-content: center;
}

.device-offline {
  opacity: 0.7;
  filter: grayscale(30%);
}

</style>
