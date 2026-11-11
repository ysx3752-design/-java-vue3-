<!-- 设备控制页面 -->
<template>
  <div class="control-container">
    <!-- 设备连接状态 -->
    <el-card shadow="hover" class="mb-4 status-card">
      <div class="connection-status">
        <el-row :gutter="20">
          <el-col :span="12">
            <div class="status-info">
              <el-tag :type="isConnected ? 'success' : 'danger'" size="large" class="status-tag">
                <el-icon class="status-icon"><component :is="isConnected ? 'CircleCheck' : 'CircleClose'" /></el-icon>
                {{ isConnected ? '已连接' : '未连接' }}
              </el-tag>
              <span class="status-text">控制器状态: {{ controllerStatus }}</span>
            </div>
          </el-col>
          <el-col :span="12" class="text-right">
            <div class="status-actions">
              <el-button type="primary" @click="refreshDevices" :loading="loading" class="refresh-btn">
                <el-icon><Refresh /></el-icon> 刷新状态
              </el-button>
              <el-tooltip content="上次通信时间" placement="top">
                <span class="last-comm-time">{{ connectionInfo.lastCommunication ? formatTime(connectionInfo.lastCommunication) : '未知' }}</span>
              </el-tooltip>
            </div>
          </el-col>
        </el-row>
        <el-row :gutter="20" class="mt-2">
          <el-col :span="24">
            <el-progress 
              :percentage="isConnected ? (connectionInfo.connectedDevices / connectionInfo.totalDevices * 100 || 0) : 0" 
              :status="isConnected ? 'success' : 'exception'"
              :format="() => `${connectionInfo.connectedDevices || 0}/${connectionInfo.totalDevices || 0} 设备在线`"
              :stroke-width="15"
            />
          </el-col>
        </el-row>
      </div>
    </el-card>

    <!-- 实时环境数据 -->
    <realtime-metrics class="mb-4" title="实时环境数据" :interval="5000" />

    <!-- 设备列表 -->
    <el-row :gutter="20">
      <el-col :xs="24" :sm="12" :md="8" :lg="6" v-for="device in deviceList" :key="device.type">
        <el-card shadow="hover" class="device-card mb-4" :class="{ 'device-offline': !isConnected, 'device-active': device.status === 1 }">
          <div class="device-header">
            <el-icon :class="{ 'is-active': device.status === 1 }">
              <component :is="getDeviceIcon(device.type)" />
            </el-icon>
            <span class="device-name">{{ device.name || getDeviceTypeName(device.type) }}</span>
            <el-tag :type="device.status === 1 ? 'success' : 'info'" size="small" class="device-status-tag">
              {{ device.status === 1 ? '开启' : '关闭' }}
            </el-tag>
          </div>
          
          <div class="device-content">
            <div class="device-info">
              <p><strong>类型：</strong>{{ getDeviceTypeName(device.type) }}</p>
              <p><strong>状态：</strong>
                <span :class="device.status === 1 ? 'status-on' : 'status-off'">
                  {{ device.status === 1 ? '开启' : '关闭' }}
                </span>
              </p>
              <p><strong>描述：</strong>{{ device.description || '无描述' }}</p>
            </div>
            
            <div class="device-controls">
              <el-switch
                v-model="deviceSwitches[device.type]"
                :active-text="'开启'"
                :inactive-text="'关闭'"
                :disabled="!isConnected"
                :loading="loading && controlStatus[device.type]?.action !== undefined"
                @change="(val) => handleSwitchChange(device.type, val)"
                class="device-switch"
              />
              <div class="button-controls">
                <el-button-group>
                  <el-button
                    type="primary"
                    :loading="loading && controlStatus[device.type]?.action === 'open'"
                    :disabled="device.status === 1 || !isConnected"
                    @click="handleControl(device.type, 'open')"
                    size="small"
                  >
                    <el-icon><CircleCheck /></el-icon> 开启
                  </el-button>
                  <el-button
                    type="danger"
                    :loading="loading && controlStatus[device.type]?.action === 'close'"
                    :disabled="device.status === 0 || !isConnected"
                    @click="handleControl(device.type, 'close')"
                    size="small"
                  >
                    <el-icon><CircleClose /></el-icon> 关闭
                  </el-button>
                </el-button-group>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, onActivated, onDeactivated, watch } from 'vue'
import { useControlStore } from '@/store/control'
import { controlDevice, getDeviceStatus, getConnectionStatus } from '@/api/device'
import RealtimeMetrics from '@/components/RealtimeMetrics.vue'
import { ElMessage } from 'element-plus'
import { 
  Monitor, 
  WindPower, 
  Umbrella, 
  Sunny, 
  Drizzling, 
  Setting, 
  CircleCheck, 
  CircleClose,
  Refresh
} from '@element-plus/icons-vue'

// 设备配置（与后端保持一致）
const DEVICE_CONFIG = {
  'external_shade': {
    'name': '外遮阳',
    'relay_address': 0x2001,
    'relay_port': 0x01
  },
  'internal_shade': {
    'name': '内遮阳',
    'relay_address': 0x2001,
    'relay_port': 0x02
  },
  'external_fan': {
    'name': '外通风',
    'relay_address': 0x2001,
    'relay_port': 0x03
  },
  'internal_fan': {
    'name': '内通风',
    'relay_address': 0x2001,
    'relay_port': 0x04
  },
  'skylight': {
    'name': '天窗',
    'relay_address': 0x2002,
    'relay_port': 0x01
  },
  'spray': {
    'name': '喷灌',
    'relay_address': 0x2002,
    'relay_port': 0x02
  },
  'water_curtain': {
    'name': '水帘',
    'relay_address': 0x2002,
    'relay_port': 0x03
  },
  'light': {
    'name': '灯光',
    'relay_address': 0x2002,
    'relay_port': 0x04
  }
}

const controlStore = useControlStore()
const loading = ref(false)
const controlStatus = ref({})
const isConnected = ref(false)
const controllerStatus = ref('检查中...')
const connectionInfo = ref({})
const deviceList = ref([
  { type: 'external_shade', name: '外遮阳', status: 0, description: '控制温室外部遮阳系统' },
  { type: 'internal_shade', name: '内遮阳', status: 0, description: '控制温室内部遮阳系统' },
  { type: 'external_fan', name: '外通风', status: 0, description: '控制温室外部通风系统' },
  { type: 'internal_fan', name: '内通风', status: 0, description: '控制温室内部通风系统' },
  { type: 'skylight', name: '天窗', status: 0, description: '控制温室顶部天窗' },
  { type: 'spray', name: '喷灌', status: 0, description: '控制温室喷灌系统' },
  { type: 'water_curtain', name: '水帘', status: 0, description: '控制温室水帘系统' },
  { type: 'light', name: '灯光', status: 0, description: '控制温室照明系统' }
])

// 设备开关状态
const deviceSwitches = ref({})

// 初始化开关状态
deviceList.value.forEach(device => {
  deviceSwitches.value[device.type] = device.status === 1
})

// 监听设备状态变化，更新开关状态
watch(deviceList, (newList) => {
  newList.forEach(device => {
    deviceSwitches.value[device.type] = device.status === 1
  })
}, { deep: true })

// 处理开关变化
const handleSwitchChange = (deviceType, value) => {
  const action = value ? 'open' : 'close'
  handleControl(deviceType, action)
}

// 设备类型映射
const deviceTypeMap = {
  'external_shade': '外遮阳',
  'internal_shade': '内遮阳',
  'external_fan': '外通风',
  'internal_fan': '内通风',
  'skylight': '天窗',
  'spray': '喷灌',
  'water_curtain': '水帘',
  'light': '灯光'
}

// 获取设备图标
const getDeviceIcon = (type) => {
  const icons = {
    'external_shade': Umbrella,
    'internal_shade': Umbrella,
    'external_fan': WindPower,
    'internal_fan': WindPower,
    'skylight': Monitor,
    'spray': Umbrella,
    'water_curtain': Drizzling,
    'light': Sunny
  }
  return icons[type] || Setting
}

// 获取设备类型名称
const getDeviceTypeName = (type) => {
  return deviceTypeMap[type] || type
}

// 格式化时间
const formatTime = (isoTime) => {
  if (!isoTime) return '未知';
  try {
    const date = new Date(isoTime);
    return date.toLocaleString('zh-CN');
  } catch (e) {
    console.error('时间格式化错误:', e);
    return isoTime;
  }
}

// 刷新连接状态
const refreshConnectionStatus = async () => {
  loading.value = true;
  try {
    const response = await getConnectionStatus();
    console.log('连接状态响应:', response);
    
    connectionInfo.value = response;
    isConnected.value = response.status === 'connected' || response.connected === true;
    controllerStatus.value = response.message || '未知状态';
    
    // 更新连接信息
    if (!connectionInfo.value.totalDevices && response.total_devices) {
      connectionInfo.value.totalDevices = response.total_devices;
    }
    
    if (!connectionInfo.value.connectedDevices && response.connected_devices) {
      connectionInfo.value.connectedDevices = response.connected_devices;
    }
    
    // 如果连接状态为已连接，同时刷新设备状态
    if (isConnected.value) {
      await refreshDeviceStatus();
    }
  } catch (error) {
    console.error('刷新连接状态失败:', error);
    ElMessage.error('刷新连接状态失败: ' + (error.message || '未知错误'));
    isConnected.value = false;
    controllerStatus.value = '连接失败';
  } finally {
    loading.value = false;
  }
};

// 刷新设备状态
const refreshDeviceStatus = async () => {
  try {
    const response = await getDeviceStatus();
    console.log('设备状态响应:', response);
    
    if (response && response.devices) {
      // 更新设备状态
      deviceList.value = deviceList.value.map(device => {
        const deviceInfo = response.devices.find(d => d.type === device.type);
        if (deviceInfo) {
          return {
            ...device,
            status: deviceInfo.status
          };
        }
        return device;
      });
      
      // 如果获取到设备状态，则认为已连接
      isConnected.value = true;
    }
  } catch (error) {
    console.error('刷新设备状态失败:', error);
    // 不要在这里设置isConnected.value = false，因为可能只是设备状态获取失败，而连接是正常的
  }
};

// 刷新所有状态
const refreshDevices = async () => {
  loading.value = true;
  try {
    await refreshConnectionStatus();
    
    // 如果连接成功，立即刷新设备状态
    if (isConnected.value) {
      await refreshDeviceStatus();
    }
  } catch (error) {
    console.error('刷新状态出错:', error);
    ElMessage.error('刷新状态出错: ' + (error.message || '未知错误'));
  } finally {
    loading.value = false;
  }
};

// 控制设备
const handleControl = async (deviceType, action) => {
  // 设置对应设备的loading状态
  if (!controlStatus.value[deviceType]) {
    controlStatus.value[deviceType] = {};
  }
  controlStatus.value[deviceType].action = action;
  loading.value = true;
  
  // 立即更新UI状态，提高响应速度
  const device = deviceList.value.find(d => d.type === deviceType);
  if (device) {
    device.status = action === 'open' ? 1 : 0;
    // 同时更新开关状态
    deviceSwitches.value[deviceType] = action === 'open';
  }
  
  try {
    // 根据设备配置从硬件配置中获取继电器地址和端口
    const deviceConfig = DEVICE_CONFIG[deviceType];
    console.log('设备配置:', deviceConfig);
    
    if (!deviceConfig) {
      throw new Error(`未找到设备 ${deviceType} 的配置信息`);
    }
    
    // 适配为原虚拟平台接受的控制格式
    const result = await controlDevice(deviceType, action);
    console.log('控制设备结果:', result);
    
    if (result.success) {
      // 显示成功消息
      ElMessage.success(result.message || `设备${deviceConfig.name} ${action === 'open' ? '开启' : '关闭'}成功`);
      
      // 标记为已连接
      isConnected.value = true;
    } else {
      // 显示错误消息
      ElMessage.error(result.message || `设备控制失败`);
      
      // 如果控制失败，不要恢复设备状态，因为后端可能已经更新了状态
      // 而是尝试刷新设备状态以获取最新状态
      setTimeout(() => {
        refreshDeviceStatus();
      }, 1000);
    }
  } catch (error) {
    console.error('控制设备出错:', error);
    ElMessage.error(`控制设备失败: ${error.message || '未知错误'}`);
    
    // 如果控制出错，不恢复UI状态，因为命令可能已经发送成功
    // 而是尝试刷新设备状态
    setTimeout(() => {
      refreshDeviceStatus();
    }, 1000);
  } finally {
    // 清除loading状态
    if (controlStatus.value[deviceType]) {
      controlStatus.value[deviceType].action = null;
    }
    loading.value = false;
  }
};

// 更新状态的定时器
let statusTimer = null;

const startStatusTimer = () => {
  if (statusTimer) return
  // 设置自动刷新定时器（每60秒刷新一次连接状态，每120秒刷新一次设备状态）
  statusTimer = setInterval(async () => {
    console.log('自动刷新状态')
    try {
      await refreshConnectionStatus()

      // 每隔两次刷新设备状态
      if (Math.floor(Date.now() / 1000) % 120 < 5) {
        await refreshDevices()
      }
    } catch (e) {
      console.error('自动刷新状态失败:', e)
    }
  }, 60000) // 60秒
}

const stopStatusTimer = () => {
  if (statusTimer) {
    clearInterval(statusTimer)
    statusTimer = null
  }
}

// 组件挂载时获取设备列表和初始状态
onMounted(async () => {
  try {
    await refreshConnectionStatus()
    await refreshDevices()
    startStatusTimer()
  } catch (error) {
    console.error('初始化失败:', error)
    ElMessage.error('初始化失败，请刷新页面重试')
  }
})

// keep-alive 缓存页面：切回来时恢复轮询
onActivated(startStatusTimer)

// 切走时暂停轮询，避免后台空转
onDeactivated(stopStatusTimer)

// 组件卸载时清除定时器
onUnmounted(stopStatusTimer)
</script>

<style scoped>
.control-container {
  padding: 20px;
}

.mb-4 {
  margin-bottom: 16px;
}

.mt-2 {
  margin-top: 8px;
}

.ml-2 {
  margin-left: 8px;
}

.connection-status {
  display: flex;
  flex-direction: column;
}

.status-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.status-tag {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
}

.status-icon {
  font-size: 16px;
}

.status-text {
  font-size: 16px;
  font-weight: 500;
}

.status-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
}

.refresh-btn {
  display: flex;
  align-items: center;
  gap: 5px;
}

.last-comm-time {
  color: var(--el-color-info);
  font-size: 14px;
}

.text-right {
  text-align: right;
}

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

.status-card {
  background-color: #f9f9f9;
}

@media (max-width: 768px) {
  .status-info, .status-actions {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  
  .text-right {
    text-align: left;
    margin-top: 10px;
  }
}
</style> 