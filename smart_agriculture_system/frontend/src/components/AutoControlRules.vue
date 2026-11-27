<template>
  <div class="auto-control-rules">
    <el-card class="rules-card">
      <template #header>
        <div class="card-header">
          <span>自动控制规则</span>
          <div class="rule-actions">
            <el-button size="small" :disabled="loading" @click="openThresholds">阈值设置</el-button>
            <el-button type="primary" size="small" @click="refreshRules">刷新</el-button>
          </div>
        </div>
      </template>
      
      <el-table :data="rules" style="width: 100%" v-loading="loading">
        <el-table-column prop="sensor_type" label="传感器类型" width="120">
          <template #default="scope">
            {{ getSensorTypeName(scope.row.sensor_type) }}
          </template>
        </el-table-column>
        <el-table-column prop="threshold" label="阈值" width="100">
          <template #default="scope">
            {{ scope.row.operator }} {{ scope.row.threshold }} {{ getSensorUnit(scope.row.sensor_type) }}
          </template>
        </el-table-column>
        <el-table-column prop="device_type" label="设备" width="120">
          <template #default="scope">
            {{ getDeviceName(scope.row.device_type) }}
          </template>
        </el-table-column>
        <el-table-column prop="action" label="操作" width="100">
          <template #default="scope">
            {{ getActionName(scope.row.action) }}
          </template>
        </el-table-column>
        <el-table-column label="说明">
          <template #default="scope">
            当{{ getSensorTypeName(scope.row.sensor_type) }}
            {{ getOperatorText(scope.row.operator) }}
            {{ scope.row.threshold }}{{ getSensorUnit(scope.row.sensor_type) }}时，
            {{ getActionName(scope.row.action) }}{{ getDeviceName(scope.row.device_type) }}
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    
    <el-card class="logs-card">
      <template #header>
        <div class="card-header">
          <span>自动控制日志</span>
          <el-button type="primary" size="small" @click="refreshLogs">
            <i class="el-icon-refresh"></i> 刷新
          </el-button>
        </div>
      </template>
      
      <el-table :data="logs" style="width: 100%" v-loading="logsLoading">
        <el-table-column prop="time" label="时间" width="180">
          <template #default="scope">
            {{ formatTime(scope.row.time) }}
          </template>
        </el-table-column>
        <el-table-column prop="device_type" label="设备" width="120">
          <template #default="scope">
            {{ getDeviceName(scope.row.device_type) }}
          </template>
        </el-table-column>
        <el-table-column prop="description" label="操作描述"></el-table-column>
        <el-table-column prop="result" label="结果" width="80">
          <template #default="scope">
            <el-tag :type="scope.row.result ? 'success' : 'danger'">
              {{ scope.row.result ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-dialog v-model="thresholdDialog" title="自动控制阈值" width="480px">
      <el-form label-width="100px">
        <el-form-item v-for="(range, key) in thresholdDraft" :key="key" :label="getSensorTypeName(key)">
          <el-input-number v-model="range.min" :controls="false" style="width:120px" />
          <span style="margin:0 10px">至</span>
          <el-input-number v-model="range.max" :controls="false" style="width:120px" />
          <span style="margin-left:8px">{{ getSensorUnit(key) }}</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="thresholdDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveThresholds">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { getAutoControlRules, getAutoControlLogs } from '@/api/alerts'
import { getAutoControlStatus, updateThresholds } from '@/api/auto-control'

const thresholds = ref({})
const thresholdDraft = ref({})
const thresholdDialog = ref(false)
const saving = ref(false)
const openThresholds = () => {
  thresholdDraft.value = JSON.parse(JSON.stringify(thresholds.value))
  thresholdDialog.value = true
}
const saveThresholds = async () => {
  if (Object.values(thresholdDraft.value).some(r => !Number.isFinite(r.min) || !Number.isFinite(r.max) || r.min >= r.max)) {
    ElMessage.warning('每项最小值必须小于最大值')
    return
  }
  saving.value = true
  try {
    const result = await updateThresholds(thresholdDraft.value)
    if (!result.success) throw Error(result.error)
    thresholdDialog.value = false
    await refreshRules()
    ElMessage.success('阈值已更新')
  } catch (error) { ElMessage.error(error.message || '保存失败') }
  finally { saving.value = false }
}
const rules = ref([])
const logs = ref([])
const loading = ref(false)
const logsLoading = ref(false)

// 刷新规则
const refreshRules = async () => {
  loading.value = true
  try {
    const [response, status] = await Promise.all([getAutoControlRules(), getAutoControlStatus()])
    if (status.error) throw Error(status.error)
    rules.value = response
    thresholds.value = status.thresholds
  } catch (error) {
    console.error('获取自动控制规则失败:', error)
    ElMessage.error('获取自动控制规则失败')
  } finally {
    loading.value = false
  }
}

// 刷新日志
const refreshLogs = async () => {
  logsLoading.value = true
  try {
    const response = await getAutoControlLogs(20)
    logs.value = response
  } catch (error) {
    console.error('获取自动控制日志失败:', error)
    ElMessage.error('获取自动控制日志失败')
  } finally {
    logsLoading.value = false
  }
}

// 获取传感器类型名称
const getSensorTypeName = (type) => {
  const typeNames = {
    'temperature': '空气温度',
    'humidity': '空气湿度',
    'soil_moisture': '土壤湿度',
    'soil_temperature': '土壤温度',
    'light': '光照强度',
    'co2': 'CO2浓度',
    'light_intensity': '光照强度',
    'co2_concentration': 'CO2浓度',
    'co2_level': 'CO2浓度'
  }
  return typeNames[type] || type
}

// 获取设备名称
const getDeviceName = (type) => {
  const deviceNames = {
    'external_fan': '外通风',
    'internal_fan': '内通风',
    'external_shade': '外遮阳',
    'internal_shade': '内遮阳',
    'skylight': '天窗',
    'spray': '喷灌',
    'water_curtain': '水帘',
    'light': '灯光'
  }
  return deviceNames[type] || type
}

// 获取操作名称
const getActionName = (action) => {
  return action === 'open' ? '开启' : '关闭'
}

// 获取操作符文本
const getOperatorText = (operator) => {
  const operatorTexts = {
    '>': '高于',
    '<': '低于',
    '>=': '高于等于',
    '<=': '低于等于',
    '==': '等于'
  }
  return operatorTexts[operator] || operator
}

// 获取传感器单位
const getSensorUnit = (type) => {
  const units = {
    'temperature': '°C',
    'humidity': '%',
    'soil_moisture': '%',
    'soil_temperature': '°C',
    'light': 'lux',
    'co2': 'ppm',
    'light_intensity': 'lux',
    'co2_concentration': 'ppm',
    'co2_level': 'ppm'
  }
  return units[type] || ''
}

// 格式化时间
const formatTime = (timeStr) => {
  if (!timeStr) return '--'
  try {
    const date = new Date(timeStr)
    return date.toLocaleString()
  } catch (e) {
    return timeStr
  }
}

onMounted(() => {
  refreshRules()
  refreshLogs()
})
</script>

<style scoped>
.rule-actions { display:flex; align-items:center; gap:12px; }
.auto-control-rules {
  margin-bottom: 20px;
}

.rules-card {
  margin-bottom: 20px;
}

.logs-card {
  margin-bottom: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>