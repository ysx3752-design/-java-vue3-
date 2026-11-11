<template>
  <div class="alerts-management">
    <!-- 实时监测：当前值与阈值规则对照 -->
    <el-card class="box-card realtime-monitor-card">
      <template #header>
        <div class="card-header">
          <span>实时监测</span>
          <div class="live-meta">
            <span class="live-dot" :class="{ stale: !monitorStore.isFresh }"></span>
            <span class="live-text">{{ monitorStore.isFresh ? '实时采集中' : '等待数据' }}</span>
            <el-tag size="small" :type="monitorStore.source === 'realtime' ? 'success' : 'info'" effect="plain">
              {{ monitorStore.sourceLabel }}
            </el-tag>
            <span class="live-time">更新于 {{ monitorStore.shortLastUpdateTime }}</span>
          </div>
        </div>
      </template>

      <div v-if="liveRules.length" class="live-rule-grid">
        <div
          v-for="rule in liveRules"
          :key="rule.id || rule.name"
          class="live-rule"
          :class="{ 'is-triggered': rule.triggered, 'is-disabled': !rule.enabled }"
        >
          <div class="rule-top">
            <span class="rule-name">{{ rule.name }}</span>
            <el-tag
              size="small"
              :type="rule.triggered ? 'danger' : (rule.enabled ? 'success' : 'info')"
            >
              {{ rule.triggered ? '已触发' : (rule.enabled ? '正常' : '未启用') }}
            </el-tag>
          </div>
          <div class="rule-body">
            <div class="rule-value">
              <span class="num">{{ rule.currentValue === null ? '--' : formatNumber(rule.currentValue) }}</span>
              <span class="unit-text">{{ getUnitByType(rule.type) }}</span>
            </div>
            <div class="rule-threshold">
              {{ getTypeName(rule.type) }} {{ rule.operator }} {{ rule.threshold }}{{ getUnitByType(rule.type) }}
            </div>
          </div>
        </div>
      </div>
      <el-empty v-else description="暂未配置警报规则" :image-size="60" />
    </el-card>

    <!-- 警报规则管理 -->
    <el-card class="box-card">
      <template #header>
        <div class="card-header">
          <span>警报规则</span>
          <el-button type="primary" @click="openAddDialog">添加警报规则</el-button>
        </div>
      </template>

      <!-- 警报规则列表 -->
      <el-table v-loading="loading" :data="alertRules" style="width: 100%">
        <el-table-column prop="name" label="规则名称" />
        <el-table-column prop="type" label="监测类型">
          <template #default="{ row }">
            {{ getTypeName(row.type) }}
          </template>
        </el-table-column>
        <el-table-column prop="condition" label="触发条件">
          <template #default="{ row }">
            {{ row.operator }} {{ row.threshold }} {{ getUnitByType(row.type) }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'">
              {{ row.enabled ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button-group>
              <el-button
                :type="row.enabled ? 'warning' : 'success'"
                size="small"
                @click="toggleAlert(row)"
              >
                {{ row.enabled ? '禁用' : '启用' }}
              </el-button>
              <el-button
                type="primary"
                size="small"
                @click="editAlert(row)"
              >
                编辑
              </el-button>
              <el-button
                type="danger"
                size="small"
                @click="deleteAlert(row)"
              >
                删除
              </el-button>
            </el-button-group>
          </template>
        </el-table-column>
      </el-table>

      <!-- 空数据状态 -->
      <el-empty v-if="!loading && alertRules.length === 0" description="暂无警报规则" />
    </el-card>
    
    <!-- 自动控制规则 -->
    <auto-control-rules class="auto-control-rules-component" />

    <!-- 警报记录 -->
    <el-card class="box-card alert-records-card">
      <template #header>
        <div class="card-header">
          <span>警报记录</span>
          <el-button type="primary" @click="fetchAlertRecords(false)">刷新</el-button>
        </div>
      </template>

      <!-- 警报记录列表 -->
      <el-table v-loading="recordsLoading" :data="alertRecords" style="width: 100%">
        <el-table-column prop="time" label="时间" width="180">
          <template #default="{ row }">
            {{ formatTime(row.time) }}
          </template>
        </el-table-column>
        <el-table-column prop="type" label="类型" width="180" />
        <el-table-column prop="description" label="描述" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === '未处理' ? 'danger' : 'success'">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button
              v-if="row.status === '未处理'"
              type="success"
              size="small"
              @click="markAsHandled(row)"
            >
              标记已处理
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 空数据状态 -->
      <el-empty v-if="!recordsLoading && alertRecords.length === 0" description="暂无警报记录" />
    </el-card>

    <!-- 添加/编辑警报规则对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEditing ? '编辑警报规则' : '添加警报规则'"
      width="500px"
    >
      <el-form
        ref="ruleFormRef"
        :model="ruleForm"
        :rules="rules"
        label-width="100px"
      >
        <el-form-item label="规则名称" prop="name">
          <el-input v-model="ruleForm.name" placeholder="请输入规则名称" />
        </el-form-item>
        <el-form-item label="监测类型" prop="type">
          <el-select v-model="ruleForm.type" placeholder="请选择监测类型">
            <el-option
              v-for="type in monitorTypes"
              :key="type.value"
              :label="type.label"
              :value="type.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="触发条件" prop="operator">
          <el-select v-model="ruleForm.operator" placeholder="请选择触发条件">
            <el-option label="大于" value=">" />
            <el-option label="小于" value="<" />
          </el-select>
        </el-form-item>
        <el-form-item label="阈值" prop="threshold">
          <el-input-number
            v-model="ruleForm.threshold"
            :precision="2"
            :step="0.1"
            :min="0"
          />
          <span class="unit">{{ getUnitByType(ruleForm.type) }}</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="closeDialog">取消</el-button>
          <el-button type="primary" @click="submitForm">确定</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onActivated, onDeactivated, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { alertsApi } from '@/api/alerts'
import { useUserStore } from '@/store/user'
import { useRealtimeFeed } from '@/composables/useRealtimeFeed'
import AutoControlRules from '@/components/AutoControlRules.vue'

// 实时传感器数据（每 5 秒刷新，页面切走自动暂停）
const monitorStore = useRealtimeFeed(5000)

// 获取用户存储
const userStore = useUserStore()

// 监测类型选项
const monitorTypes = [
  { label: '温度', value: 'temperature' },
  { label: '湿度', value: 'humidity' },
  { label: '土壤湿度', value: 'soil_moisture' },
  { label: '土壤温度', value: 'soil_temperature' },
  { label: '光照强度', value: 'light_intensity' },
  { label: 'CO2浓度', value: 'co2_level' }
]

// 后端内置规则可能使用 air_temperature / air_humidity / co2_concentration 命名，
// 与下拉框里的 temperature / humidity / co2_level 统一到同一套键名
const TYPE_ALIASES = {
  air_temperature: 'temperature',
  air_humidity: 'humidity',
  co2_concentration: 'co2_level'
}

const normalizeType = (type) => TYPE_ALIASES[type] || type

// 获取类型名称
const getTypeName = (type) => {
  const found = monitorTypes.find(t => t.value === normalizeType(type))
  return found ? found.label : type
}

// 获取单位
const getUnitByType = (type) => {
  const units = {
    temperature: '°C',
    humidity: '%',
    soil_moisture: '%',
    soil_temperature: '°C',
    light_intensity: 'lux',
    co2_level: 'ppm'
  }
  return units[normalizeType(type)] || ''
}

// 格式化时间
const formatTime = (timeStr) => {
  if (!timeStr) return ''
  try {
    const date = new Date(timeStr)
    return date.toLocaleString('zh-CN', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch (e) {
    return timeStr
  }
}

// 表单验证规则
const rules = {
  name: [
    { required: true, message: '请输入规则名称', trigger: 'blur' },
    { min: 2, max: 20, message: '长度在 2 到 20 个字符', trigger: 'blur' }
  ],
  type: [
    { required: true, message: '请选择监测类型', trigger: 'change' }
  ],
  operator: [
    { required: true, message: '请选择触发条件', trigger: 'change' }
  ],
  threshold: [
    { required: true, message: '请输入阈值', trigger: 'blur' },
    { type: 'number', message: '阈值必须为数字', trigger: 'blur' }
  ]
}

// 数据
const alertRules = ref([])
const alertRecords = ref([])
const loading = ref(false)
const recordsLoading = ref(false)
const dialogVisible = ref(false)
const isEditing = ref(false)
const ruleFormRef = ref(null)
const ruleForm = reactive({
  id: null,
  name: '',
  type: '',
  operator: '>',
  threshold: 0,
  enabled: true
})

// 处理认证错误
const handleAuthError = async (error) => {
  // 检查是否为认证错误
  if (error.isAuthError || (error.response && error.response.status === 401)) {
    ElMessage.warning('会话已过期，请重新登录')
    // 注销并重定向到登录页
    await userStore.logout()
    return true
  }
  return false
}

// 获取警报规则列表
const fetchAlertRules = async () => {
  loading.value = true
  try {
    const res = await alertsApi.getAlertRules()
    alertRules.value = res || []
  } catch (error) {
    console.error('获取警报规则失败:', error)
    if (!await handleAuthError(error)) {
      ElMessage.error('获取警报规则失败')
    }
  } finally {
    loading.value = false
  }
}

// 获取警报记录
const fetchAlertRecords = async (silent = false) => {
  if (!silent) {
    recordsLoading.value = true
  }
  try {
    const res = await alertsApi.getRecentAlerts(20) // 获取最近20条记录
    alertRecords.value = res || []
  } catch (error) {
    if (!silent) {
      ElMessage.error('获取警报记录失败')
    }
  } finally {
    if (!silent) {
      recordsLoading.value = false
    }
  }
}

// 当前值 vs 规则阈值的实时对照
const liveRules = computed(() => {
  return alertRules.value.map((rule) => {
    const raw = Number(monitorStore.realTimeData[normalizeType(rule.type)])
    const value = Number.isNaN(raw) ? null : raw
    const threshold = Number(rule.threshold)
    const triggered = Boolean(rule.enabled)
      && value !== null
      && !Number.isNaN(threshold)
      && (rule.operator === '>' ? value > threshold : value < threshold)
    return { ...rule, currentValue: value, triggered }
  })
})

// 数值格式化：整数不显示小数位
const formatNumber = (value) => {
  const num = Number(value)
  if (Number.isNaN(num)) return '--'
  return Number.isInteger(num) ? String(num) : num.toFixed(1)
}

// 标记警报为已处理
const markAsHandled = async (row) => {
  ElMessageBox.confirm(
    '确定将该警报标记为已处理吗？',
    '确认',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    }
  ).then(async () => {
    try {
      await alertsApi.handleAlert(row.id)
      row.status = '已处理'
      ElMessage.success('已将警报标记为已处理')
    } catch (error) {
      ElMessage.error('操作失败')
    }
  }).catch(() => {
    // 用户取消操作
  })
}

// 打开添加对话框
const openAddDialog = () => {
  isEditing.value = false
  resetForm()
  dialogVisible.value = true
}

// 编辑警报
const editAlert = (row) => {
  isEditing.value = true
  resetForm()
  
  // 复制要编辑的规则数据到表单
  Object.keys(ruleForm).forEach(key => {
    if (key in row) {
      ruleForm[key] = row[key]
    }
  })
  
  dialogVisible.value = true
}

// 重置表单
const resetForm = () => {
  if (ruleFormRef.value) {
    ruleFormRef.value.resetFields()
  }
  
  // 重置表单数据
  Object.assign(ruleForm, {
    id: null,
    name: '',
    type: '',
    operator: '>',
    threshold: 0,
    enabled: true
  })
}

// 关闭对话框
const closeDialog = () => {
  dialogVisible.value = false
  resetForm()
}

// 提交表单
const submitForm = async () => {
  if (!ruleFormRef.value) return
  
  let valid = false
  try {
    valid = await ruleFormRef.value.validate()
  } catch (validationError) {
    valid = false
  }
  
  if (valid) {
    // 显示加载状态
    const loading = ElMessage({
      message: isEditing.value ? '正在更新...' : '正在添加...',
      type: 'info',
      duration: 0
    })
    
    try {
      const formData = {
        name: ruleForm.name,
        type: ruleForm.type,
        operator: ruleForm.operator,
        threshold: Number(ruleForm.threshold),
        enabled: ruleForm.enabled
      }
      
      if (isEditing.value) {
        // 更新现有警报规则
        await alertsApi.updateAlertRule(ruleForm.id, formData)
        loading.close()
        ElMessage.success('更新成功')
      } else {
        // 添加新警报规则
        await alertsApi.createAlertRule(formData)
        loading.close()
        ElMessage.success('添加成功')
      }
      
      // 关闭对话框
      dialogVisible.value = false
      
      // 刷新列表
      await fetchAlertRules()
    } catch (error) {
      loading.close()
      console.error(isEditing.value ? '更新失败:' : '添加失败:', error)
      
      if (!await handleAuthError(error)) {
        // 获取具体错误信息
        const errorMsg = error.response?.data?.error || 
                         (isEditing.value ? '更新失败' : '添加失败')
        ElMessage.error(errorMsg)
      }
    }
  } else {
    ElMessage.warning('请正确填写所有必填字段')
  }
}

// 删除警报
const deleteAlert = (row) => {
  ElMessageBox.confirm(
    '确定要删除这条警报规则吗？',
    '警告',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    }
  ).then(async () => {
    try {
      await alertsApi.deleteAlertRule(row.id)
      ElMessage.success('删除成功')
      // 刷新列表
      fetchAlertRules()
    } catch (error) {
      console.error('删除失败:', error)
      if (!await handleAuthError(error)) {
        ElMessage.error('删除失败')
      }
    }
  }).catch(() => {
    // 用户取消删除，不做任何处理
  })
}

// 切换警报状态
const toggleAlert = async (row) => {
  try {
    const res = await alertsApi.toggleAlertRule(row.id)
    if (res && res.enabled !== undefined) {
      // 更新本地状态
      row.enabled = res.enabled
      ElMessage.success(`${row.enabled ? '启用' : '禁用'}成功`)
    } else {
      // 如果响应格式不符合预期，刷新列表获取最新状态
      await fetchAlertRules()
      ElMessage.success('状态更新成功')
    }
  } catch (error) {
    console.error('切换警报状态失败:', error)
    if (!await handleAuthError(error)) {
      ElMessage.error('操作失败，请检查网络连接和服务器状态')
    }
    // 操作失败时刷新列表以恢复原始状态
    await fetchAlertRules()
  }
}

// 警报记录自动刷新（静默，不闪加载态）
let recordsTimer = null
const startRecordsTimer = () => {
  if (recordsTimer) return
  recordsTimer = setInterval(() => fetchAlertRecords(true), 30000)
}
const stopRecordsTimer = () => {
  if (recordsTimer) {
    clearInterval(recordsTimer)
    recordsTimer = null
  }
}

// 在组件挂载时获取数据
onMounted(async () => {
  await fetchAlertRules()
  await fetchAlertRecords()
  startRecordsTimer()
})

onActivated(startRecordsTimer)
onDeactivated(stopRecordsTimer)
onUnmounted(stopRecordsTimer)
</script>

<style scoped>
.alerts-management {
  padding: 20px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.realtime-monitor-card {
  margin-bottom: 20px;
}

.live-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #8593a0;
  font-weight: 400;
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #52c41a;
  animation: alerts-pulse 2s infinite;
}

.live-dot.stale {
  background: #c0c4cc;
  animation: none;
  box-shadow: none;
}

@keyframes alerts-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(82, 196, 26, 0.45);
  }
  70% {
    box-shadow: 0 0 0 7px rgba(82, 196, 26, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(82, 196, 26, 0);
  }
}

.live-text {
  font-size: 13px;
  font-weight: 600;
  color: #2f3b45;
}

.live-time {
  font-variant-numeric: tabular-nums;
}

.live-rule-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.live-rule {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid #eaf0f4;
  background: #f9fbfd;
  transition: all 0.3s ease;

  &.is-triggered {
    border-color: #f5b9b8;
    background: #fef6f6;
  }

  &.is-disabled {
    opacity: 0.6;
  }
}

.rule-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.rule-name {
  font-size: 13px;
  font-weight: 600;
  color: #2f3b45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-body {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.rule-value {
  display: flex;
  align-items: baseline;
  gap: 3px;

  .num {
    font-size: 20px;
    font-weight: 600;
    color: #2f3b45;
    font-variant-numeric: tabular-nums;
  }

  .unit-text {
    font-size: 11px;
    color: #a3aeb8;
  }
}

.is-triggered .rule-value .num {
  color: #f56c6c;
}

.rule-threshold {
  font-size: 12px;
  color: #9aa7b2;
}

.alert-records-card {
  margin-top: 20px;
}

.auto-control-rules-component {
  margin-top: 20px;
}

.unit {
  margin-left: 8px;
  color: #909399;
}

:deep(.el-input-number) {
  width: 180px;
}
</style> 