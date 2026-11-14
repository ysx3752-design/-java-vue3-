<template>
  <div class="auto-control-panel">
    <div class="auto-control-header">
      <h2>智能控制系统</h2>
      <el-switch
        v-model="autoControlEnabled"
        active-text="已启用"
        inactive-text="已禁用"
        @change="toggleAutoControl"
        :loading="loading"
      />
    </div>

    <el-divider content-position="center">阈值设置</el-divider>

    <div class="threshold-settings">
      <!-- 空气温度阈值设置 -->
      <div class="threshold-card">
        <div class="threshold-header">
          <i class="el-icon-warning-outline" />
          <span>空气温度阈值</span>
        </div>
        <div class="threshold-content">
          <el-slider
            v-model="thresholds.air_temperature"
            range
            :min="0"
            :max="50"
            :disabled="!autoControlEnabled"
            @change="updateAirTempThreshold"
          />
          <div class="threshold-values">
            <span>最小值: {{ thresholds.air_temperature[0] }}°C</span>
            <span>最大值: {{ thresholds.air_temperature[1] }}°C</span>
          </div>
          <div class="threshold-description">
            当温度超过最大值时开启外部风扇，低于最小值时关闭
          </div>
        </div>
      </div>

      <!-- 空气湿度阈值设置 -->
      <div class="threshold-card">
        <div class="threshold-header">
          <i class="el-icon-warning-outline" />
          <span>空气湿度阈值</span>
        </div>
        <div class="threshold-content">
          <el-slider
            v-model="thresholds.air_humidity"
            range
            :min="0"
            :max="100"
            :disabled="!autoControlEnabled"
            @change="updateAirHumidityThreshold"
          />
          <div class="threshold-values">
            <span>最小值: {{ thresholds.air_humidity[0] }}%</span>
            <span>最大值: {{ thresholds.air_humidity[1] }}%</span>
          </div>
          <div class="threshold-description">
            当湿度超过最大值时开启内部风扇，低于最小值时关闭
          </div>
        </div>
      </div>

      <!-- 土壤温度阈值设置 -->
      <div class="threshold-card">
        <div class="threshold-header">
          <i class="el-icon-warning-outline" />
          <span>土壤温度阈值</span>
        </div>
        <div class="threshold-content">
          <el-slider
            v-model="thresholds.soil_temperature"
            range
            :min="0"
            :max="50"
            :disabled="!autoControlEnabled"
            @change="updateSoilTempThreshold"
          />
          <div class="threshold-values">
            <span>最小值: {{ thresholds.soil_temperature[0] }}°C</span>
            <span>最大值: {{ thresholds.soil_temperature[1] }}°C</span>
          </div>
          <div class="threshold-description">
            当温度超过最大值时开启天窗，低于最小值时关闭
          </div>
        </div>
      </div>
    </div>

    <div class="threshold-settings">
      <!-- 土壤湿度阈值设置 -->
      <div class="threshold-card">
        <div class="threshold-header">
          <i class="el-icon-warning-outline" />
          <span>土壤湿度阈值</span>
        </div>
        <div class="threshold-content">
          <el-slider
            v-model="thresholds.soil_moisture"
            range
            :min="0"
            :max="100"
            :disabled="!autoControlEnabled"
            @change="updateSoilMoistureThreshold"
          />
          <div class="threshold-values">
            <span>最小值: {{ thresholds.soil_moisture[0] }}%</span>
            <span>最大值: {{ thresholds.soil_moisture[1] }}%</span>
          </div>
          <div class="threshold-description">
            当湿度超过最大值时开启喷灌系统，低于最小值时关闭
          </div>
        </div>
      </div>

      <!-- 光照阈值设置 -->
      <div class="threshold-card">
        <div class="threshold-header">
          <i class="el-icon-warning-outline" />
          <span>光照阈值</span>
        </div>
        <div class="threshold-content">
          <el-slider
            v-model="thresholds.light_intensity"
            range
            :min="0"
            :max="10000"
            :step="100"
            :disabled="!autoControlEnabled"
            @change="updateLightThreshold"
          />
          <div class="threshold-values">
            <span>最小值: {{ thresholds.light_intensity[0] }}lux</span>
            <span>最大值: {{ thresholds.light_intensity[1] }}lux</span>
          </div>
          <div class="threshold-description">
            当光照超过最大值时开启照明系统，低于最小值时关闭
          </div>
        </div>
      </div>

      <!-- CO2浓度阈值设置 -->
      <div class="threshold-card">
        <div class="threshold-header">
          <i class="el-icon-warning-outline" />
          <span>CO2浓度阈值</span>
        </div>
        <div class="threshold-content">
          <el-slider
            v-model="thresholds.co2_concentration"
            range
            :min="0"
            :max="2000"
            :step="50"
            :disabled="!autoControlEnabled"
            @change="updateCO2Threshold"
          />
          <div class="threshold-values">
            <span>最小值: {{ thresholds.co2_concentration[0] }}ppm</span>
            <span>最大值: {{ thresholds.co2_concentration[1] }}ppm</span>
          </div>
          <div class="threshold-description">
            当CO2浓度超过最大值时开启水帘系统，低于最小值时关闭
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getAutoControlStatus,
  enableAutoControl,
  disableAutoControl,
  getThresholds,
  updateThresholds
} from '@/api/auto-control'

// 自动控制状态
const autoControlEnabled = ref(false)
const loading = ref(false)

// 阈值设置，使用响应式对象
const thresholds = reactive({
  air_temperature: [20, 40],
  air_humidity: [40, 60],
  soil_temperature: [20, 40],
  soil_moisture: [40, 60],
  light_intensity: [4000, 6000],
  co2_concentration: [400, 600]
})

// 初始化时获取当前状态
onMounted(async () => {
  loading.value = true
  try {
    // 获取自动控制状态
    const statusRes = await getAutoControlStatus()
    autoControlEnabled.value = statusRes.enabled
    
    // 获取阈值设置
    const thresholdsRes = await getThresholds()
    if (thresholdsRes.success) {
      // 将后端返回的阈值格式转换为前端使用的数组格式
      Object.keys(thresholdsRes.thresholds).forEach(key => {
        if (thresholds[key] && thresholdsRes.thresholds[key]) {
          const { min, max } = thresholdsRes.thresholds[key]
          thresholds[key] = [min, max]
        }
      })
    }
  } catch (error) {
    console.error('初始化自动控制设置失败:', error)
    ElMessage.error('获取自动控制设置失败')
  } finally {
    loading.value = false
  }
})// 切换自动控制状态
const toggleAutoControl = async (value) => {
  loading.value = true
  try {
    const res = value ? await enableAutoControl() : await disableAutoControl()
    if (res.success) {
      autoControlEnabled.value = res.enabled
      ElMessage.success(res.message || (value ? '自动控制已启用' : '自动控制已禁用'))
    } else {
      // 恢复原始状态
      autoControlEnabled.value = !value
      ElMessage.error(res.error || '操作失败')
    }
  } catch (error) {
    // 恢复原始状态
    autoControlEnabled.value = !value
    ElMessage.error('操作失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

// 更新阈值的通用函数
const updateThreshold = async (sensorType, values) => {
  if (!autoControlEnabled.value) return

  const data = {}
  data[sensorType] = { min: values[0], max: values[1] }

  try {
    const res = await updateThresholds(data)
    if (res.success) {
      ElMessage.success('阈值已更新')
    } else {
      ElMessage.error(res.error || '更新阈值失败')
      // 理论上应该恢复原始值，但简化处理
    }
  } catch (error) {
    ElMessage.error('更新阈值失败: ' + error.message)
  }
}

// 各传感器阈值更新函数
const updateAirTempThreshold = (values) => updateThreshold('air_temperature', values)
const updateAirHumidityThreshold = (values) => updateThreshold('air_humidity', values)
const updateSoilTempThreshold = (values) => updateThreshold('soil_temperature', values)
const updateSoilMoistureThreshold = (values) => updateThreshold('soil_moisture', values)
const updateLightThreshold = (values) => updateThreshold('light_intensity', values)
const updateCO2Threshold = (values) => updateThreshold('co2_concentration', values)
</script>

<style scoped>
.auto-control-panel {
  background-color: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}

.auto-control-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.auto-control-header h2 {
  margin: 0;
  font-size: 20px;
  color: #333;
}

.threshold-settings {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
  margin-top: 20px;
}

.threshold-card {
  border: 1px solid #ebeef5;
  border-radius: 4px;
  background-color: #f8f8f8;
  padding: 15px;
  transition: all 0.3s;
}

.threshold-card:hover {
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}

.threshold-header {
  display: flex;
  align-items: center;
  margin-bottom: 15px;
  font-weight: bold;
  color: #409eff;
}

.threshold-header i {
  margin-right: 8px;
}

.threshold-values {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  color: #606266;
  font-size: 14px;
}

.threshold-description {
  margin-top: 10px;
  color: #909399;
  font-size: 12px;
  line-height: 1.4;
}
</style>