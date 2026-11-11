<!-- 环境监测页面 -->
<template>
  <div class="monitor-container">
    <!-- 实时采集状态条 -->
    <div class="live-bar">
      <span class="live-dot" :class="{ stale: !monitorStore.isFresh }"></span>
      <span class="live-text">{{ monitorStore.isFresh ? '实时采集中' : '等待数据' }}</span>
      <span class="live-divider"></span>
      <span class="live-meta">每 5 秒刷新</span>
      <span class="live-meta">最后更新 {{ monitorStore.shortLastUpdateTime }}</span>
      <span class="live-meta">数据源：{{ monitorStore.sourceLabel }}</span>
      <span v-if="monitorStore.error" class="live-error">{{ monitorStore.error }}</span>
    </div>

    <!-- 实时数据卡片 -->
    <el-row :gutter="10">
      <el-col :span="4" :xs="12" :sm="8" :md="6" :lg="4" v-for="(item, index) in monitorItems" :key="index">
        <el-card 
          shadow="hover" 
          class="monitor-card" 
          :class="[
            `monitor-card-${item.key}`, 
            {'monitor-card-selected': selectedMetric === item.key}
          ]"
          @click="handleCardClick(item.key)"
        >
          <div class="card-header">
            <component :is="item.icon" class="el-icon" />
            <span>{{ item.label }}</span>
          </div>
          <div class="card-content">
            <span class="value" :class="[`value-${item.key}`, { 'value-flash': flashKey === item.key }]">{{ 
              typeof realTimeData[item.key] === 'number' 
                ? item.key === 'light_intensity' || item.key === 'co2_level' 
                  ? realTimeData[item.key].toFixed(0) 
                  : realTimeData[item.key].toFixed(1) 
                : realTimeData[item.key] 
            }}{{ item.unit }}</span>
            <div class="trend">
              <span>更新时间: {{ formattedLastUpdateTime }}</span>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 历史数据图表 -->
    <el-card shadow="hover" class="chart-card">
      <template #header>
        <div class="chart-header">
          <div class="chart-title">
            <span>历史数据趋势</span>
            <div class="selected-sensor" :style="{ color: getSensorColor(selectedMetric) }">
              <component :is="getSensorIcon(selectedMetric)" class="sensor-icon" />
              <span>{{ getSensorLabel(selectedMetric) }}</span>
            </div>
          </div>
          <div class="chart-controls">
            <el-select v-model="selectedMetric" placeholder="选择指标" @change="handleMetricChange">
              <el-option
                v-for="item in monitorItems"
                :key="item.key"
                :label="item.label"
                :value="item.key"
              />
            </el-select>
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              :shortcuts="dateShortcuts"
              @change="handleDateChange"
            />
          </div>
        </div>
      </template>
      <div class="history-chart-container" style="height: 450px; position: relative;">
        <div ref="historyChart" class="history-chart" style="height: 100%; width: 100%;"></div>
        <div v-if="monitorStore.loading" class="chart-loading">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>加载中...</span>
        </div>
        <div v-if="!chartInitialized" class="chart-loading">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>初始化图表...</span>
        </div>
      </div>
    </el-card>

    <!-- 数据表格 -->
    <el-card shadow="hover" class="data-table">
      <template #header>
        <div class="table-header">
          <span>详细数据</span>
          <el-button type="primary" @click="handleExport">导出数据</el-button>
        </div>
      </template>
      <el-table 
        :data="historyData" 
        stripe 
        v-loading="monitorStore.loading"
        :empty-text="'暂无数据，请选择日期范围并点击查询'"
      >
        <el-table-column prop="timestamp" label="时间" width="180">
          <template #default="scope">
            {{ scope.row.timestamp ? new Date(scope.row.timestamp).toLocaleString() : '--' }}
          </template>
        </el-table-column>
        <el-table-column
          v-for="item in monitorItems"
          :key="item.key"
          :prop="item.key"
          :label="item.label"
        >
          <template #default="scope">
            <span class="data-value" :class="`value-${item.key}`" v-if="scope.row[item.key] !== undefined && scope.row[item.key] !== null">
              {{ typeof scope.row[item.key] === 'number' ? 
                   (item.key === 'light_intensity' || item.key === 'co2_level' ? 
                    scope.row[item.key].toFixed(0) : 
                    scope.row[item.key].toFixed(1)) : 
                   scope.row[item.key] }}{{ item.unit }}
            </span>
            <span v-else>--</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import { getHistoryData, getHistoryRange } from '@/api/monitor'
import { useRealtimeFeed } from '@/composables/useRealtimeFeed'
import { bucketSeries } from '@/utils/chartSeries'
import { Sunrise, Sunset, Cloudy, Lightning, Histogram, Loading } from '@element-plus/icons-vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'

const monitorStore = useRealtimeFeed(5000)
// 趋势图专用数据：完整时间段的聚合点，与下方表格的分页数据解耦
const chartSeries = ref([])
const historyChart = ref(null)
const chartInitialized = ref(false)
let chartInstance = null

// 监控项配置
const monitorItems = [
  { key: 'temperature', label: '空气温度', unit: '°C', icon: Sunrise },
  { key: 'humidity', label: '空气湿度', unit: '%', icon: Cloudy },
  { key: 'soil_temperature', label: '土壤温度', unit: '°C', icon: Sunrise },
  { key: 'soil_moisture', label: '土壤湿度', unit: '%', icon: Cloudy },
  { key: 'light_intensity', label: '光照强度', unit: 'lux', icon: Sunrise },
  { key: 'co2_level', label: 'CO2浓度', unit: 'ppm', icon: Cloudy }
]

// 数据状态
const selectedMetric = ref('temperature')
const dateRange = ref([])
const currentPage = ref(1)
const pageSize = ref(20)
const total = ref(0)

// 从store获取数据
const realTimeData = computed(() => monitorStore.realTimeData)
const historyData = computed(() => monitorStore.historyData)
const formattedLastUpdateTime = computed(() => monitorStore.formattedLastUpdateTime)

// 数值变化时短暂高亮，便于察觉实时刷新
const flashKey = ref('')
let flashTimer = null
let prevValues = {}
watch(
  () => monitorStore.realTimeData,
  (now) => {
    let changed = ''
    monitorItems.forEach((item) => {
      const value = Number(now[item.key])
      if (prevValues[item.key] !== undefined && prevValues[item.key] !== value && !Number.isNaN(value)) {
        changed = item.key
      }
      prevValues[item.key] = value
    })
    if (changed) {
      flashKey.value = changed
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => {
        flashKey.value = ''
      }, 800)
    }
  },
  { deep: true, immediate: true }
)

// 日期快捷选项
const dateShortcuts = [
  {
    text: '最近24小时',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setTime(start.getTime() - 3600 * 1000 * 24)
      return [start, end]
    }
  },
  {
    text: '最近3天',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setTime(start.getTime() - 3600 * 1000 * 24 * 3)
      return [start, end]
    }
  },
  {
    text: '最近一周',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setTime(start.getTime() - 3600 * 1000 * 24 * 7)
      return [start, end]
    }
  },
  {
    text: '最近一月',
    value: () => {
      const end = new Date()
      const start = new Date()
      start.setMonth(start.getMonth() - 1)
      return [start, end]
    }
  }
]

// 处理日期变化
const handleDateChange = () => {
  fetchHistoryData()
}

// 处理指标切换
const handleMetricChange = (value) => {
  console.log('指标切换为:', value)
  
  // 添加过渡动画效果
  if (chartInstance) {
    // 先显示加载状态
    monitorStore.loading = true
    
    // 延迟一点时间再加载新数据，让用户感知到切换过程
    setTimeout(() => {
      fetchHistoryData()
    }, 300)
  } else {
    fetchHistoryData()
  }
}


// 处理卡片点击
const handleCardClick = (key) => {  // 如果已经选中了这个传感器，不做任何操作
  if (selectedMetric.value === key) return
  
  selectedMetric.value = key
  
  // 添加过渡动画效果
  if (chartInstance) {
    // 先显示加载状态
    monitorStore.loading = true
    
    // 延迟一点时间再加载新数据，让用户感知到切换过程
    setTimeout(() => {
      fetchHistoryData()
    }, 300)
  } else {
    fetchHistoryData()
  }
}

// 获取传感器颜色
const getSensorColor = (key) => {
  const colorMap = {
    'temperature': '#f56c6c',
    'humidity': '#67c23a',
    'soil_temperature': '#e6a23c',
    'soil_moisture': '#909399',
    'light_intensity': '#9254de',
    'co2_level': '#1890ff'
  }
  return colorMap[key] || '#409EFF'
}

// 获取传感器图标
const getSensorIcon = (key) => {
  const iconMap = {
    'temperature': Sunrise,
    'humidity': Cloudy,
    'soil_temperature': Sunrise,
    'soil_moisture': Cloudy,
    'light_intensity': Sunrise,
    'co2_level': Cloudy
  }
  return iconMap[key] || Histogram
}

// 获取传感器标签
const getSensorLabel = (key) => {
  const item = monitorItems.find(item => item.key === key)
  return item ? item.label : '未知指标'
}

// 安全地将十六进制颜色转换为RGB值
const getSafeRgbValues = (hexColor) => {
  try {
    if (!hexColor || typeof hexColor !== 'string' || !hexColor.startsWith('#')) {
      return '64, 158, 255'; // 默认蓝色
    }
    
    const hex = hexColor.replace(/^#/, '');
    const matches = hex.match(/../g);
    
    if (!matches || matches.length !== 3) {
      return '64, 158, 255'; // 默认蓝色
    }
    
    return matches.map(h => parseInt(h, 16)).join(', ');
  } catch (error) {
    console.error('颜色转换错误:', error);
    return '64, 158, 255'; // 默认蓝色
  }
}

// 处理分页
const handleSizeChange = (val) => {
  pageSize.value = val
  fetchHistoryData()
}

const handleCurrentChange = (val) => {
  currentPage.value = val
  fetchHistoryData()
}

// 获取历史数据
const fetchHistoryData = async () => {
  if (!dateRange.value || dateRange.value.length !== 2) {
    ElMessage.warning('请选择日期范围')
    return
  }
  
  try {
    // 显示加载状态
    monitorStore.loading = true
    
    // 直接使用API中的getHistoryData
    const response = await getHistoryData({
      start_time: dateRange.value[0].toISOString(),
      end_time: dateRange.value[1].toISOString(),
      metric: selectedMetric.value,
      page: currentPage.value,
      page_size: pageSize.value
    })
    
    if (response && response.data) {
      // 后端返回的是分页数据
      monitorStore.historyData = response.data.items || []
      total.value = response.data.total || 0
    } else if (response && Array.isArray(response)) {
      // 后端直接返回了数组
      monitorStore.historyData = response
      total.value = response.length
    } else {
      console.warn('获取历史数据响应格式不正确:', response)
      ElMessage.warning('历史数据格式不正确')
      monitorStore.historyData = []
      total.value = 0
    }
    
    // 趋势图单独取完整区间数据（不跟着表格分页走），再按时间段聚合
    try {
      const rangeResponse = await getHistoryRange({
        start_date: dateRange.value[0].toISOString(),
        end_date: dateRange.value[1].toISOString()
      })
      const rows = Array.isArray(rangeResponse) ? rangeResponse : (rangeResponse?.data || [])
      const hours = Math.max(1, (dateRange.value[1] - dateRange.value[0]) / 3600000)
      // 24 小时显示 24 个点，时间跨度越大适当增加，上限 72 个避免过密
      const points = Math.min(72, Math.max(24, Math.round(hours)))
      chartSeries.value = bucketSeries(rows, { points, hours, end: dateRange.value[1] })
    } catch (rangeError) {
      console.warn('获取区间历史数据失败，趋势图退回当前页数据:', rangeError)
      chartSeries.value = monitorStore.historyData
    }

    // 确保DOM已经更新后再更新图表
    setTimeout(() => {
      if (chartInstance && historyChart.value) {
        updateChart()
      }
    }, 100)
  } catch (error) {
    console.error('获取历史数据失败:', error)
    ElMessage.error('获取历史数据失败')
    monitorStore.historyData = []
    chartSeries.value = []
    total.value = 0
  } finally {
    monitorStore.loading = false
  }
}

// 更新图表
const updateChart = () => {
  if (!historyChart.value) {
    console.warn('图表DOM元素不存在')
    return
  }
  
  // 使用nextTick确保DOM已更新
  nextTick(() => {
    try {
      // 图表实例绑定的 DOM 与当前 ref 不一致时（热更新、keep-alive 重建等），
      // 旧实例会一直画在已脱离文档的 canvas 上，表现为"换了指标但图不变"
      if (chartInstance && typeof chartInstance.getDom === 'function'
          && chartInstance.getDom() !== historyChart.value) {
        console.warn('图表实例与当前容器不一致，重新初始化')
        try {
          chartInstance.dispose()
        } catch (e) {
          console.warn('销毁旧图表实例失败:', e)
        }
        chartInstance = null
        chartInitialized.value = false
      }

      // 确保图表实例正确初始化
      if (!chartInstance) {
        try {
          // 延迟初始化以确保DOM元素已准备好
          chartInstance = echarts.init(historyChart.value)
          chartInitialized.value = true
        } catch (error) {
          console.error('图表初始化失败:', error)
          chartInitialized.value = false
          return
        }
      } else {
        try {
          // 检查DOM元素是否仍然存在
          if (!document.body.contains(historyChart.value)) {
            console.warn('图表DOM元素已从文档中移除')
            chartInitialized.value = false
            return
          }
          
          // 尝试调整大小以避免渲染问题
          if (chartInstance && chartInstance.resize && typeof chartInstance.resize === 'function') {
            chartInstance.resize()
          }
        } catch (error) {
          console.warn('图表调整大小失败:', error)
          // 如果调整大小失败，尝试重新初始化
          try {
            chartInstance.dispose()
            if (historyChart.value) {
              chartInstance = echarts.init(historyChart.value)
              chartInitialized.value = true
            } else {
              console.warn('图表DOM元素不存在，无法重新初始化')
              chartInitialized.value = false
              return
            }
          } catch (reinitError) {
            console.error('图表重新初始化失败:', reinitError)
            chartInitialized.value = false
            return
          }
        }
      }
      
      // 趋势图使用聚合后的完整区间数据
      if (!Array.isArray(chartSeries.value) || chartSeries.value.length === 0) {
        console.warn('历史数据为空或不是数组，不更新图表')
        chartInstance.setOption({
          title: {
            text: '暂无数据',
            left: 'center',
            top: 'center',
            textStyle: {
              color: '#999',
              fontSize: 16
            }
          }
        })
        return
      }

      // 数据转换
      const data = (chartSeries.value || [])
        .filter(item => item && item.timestamp)
        .map(item => {
          try {
            // 确定使用哪个字段
            let value = item[selectedMetric.value]
            
            // 兼容处理不同字段名
            if (value === undefined || value === null) {
              if (selectedMetric.value === 'temperature' && item.air_temperature !== undefined) {
                value = item.air_temperature
              } else if (selectedMetric.value === 'humidity' && item.air_humidity !== undefined) {
                value = item.air_humidity
              } else if (selectedMetric.value === 'co2_level' && item.co2_concentration !== undefined) {
                value = item.co2_concentration
              }
            }
            
            // 如果值仍然是 undefined 或 null，则跳过
            if (value === undefined || value === null) {
              return null
            }
            
            // 格式化时间显示，根据日期范围调整格式
            const itemDate = new Date(item.timestamp)
            let formattedTime
            
            // 如果是24小时内的数据，只显示时间
            const oneDayMs = 24 * 60 * 60 * 1000
            const isWithin24Hours = dateRange.value && 
                                  (dateRange.value[1] - dateRange.value[0] <= oneDayMs)
            
            if (isWithin24Hours) {
              formattedTime = itemDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            } else {
              formattedTime = itemDate.toLocaleString([], { 
                month: '2-digit', 
                day: '2-digit', 
                hour: '2-digit', 
                minute: '2-digit'
              })
            }
            
            return {
              time: formattedTime,
              fullTime: itemDate,
              value: parseFloat(value)
            }
          } catch (error) {
            console.error('处理数据项时出错:', error, item)
            return null
          }
        })
        .filter(item => item !== null && !isNaN(item.value))
        
      // 确保数据按时间排序
      data.sort((a, b) => a.fullTime - b.fullTime)

      if (!data || data.length === 0) {
        console.warn('处理后的历史数据为空，显示无数据提示')
        
        // 确保图表实例存在
        if (chartInstance) {
          chartInstance.clear();
          chartInstance.setOption({
            title: {
              text: '暂无有效数据',
              left: 'center',
              top: 'center',
              textStyle: {
                color: '#999',
                fontSize: 16
              }
            }
          })
        }
        return
      }

      // 获取所选指标信息
      const selectedItem = monitorItems.find(item => item.key === selectedMetric.value) || 
                         { label: '未知指标', unit: '' }

      // 设置图表配置
      try {
        // 再次检查图表实例和DOM元素
        if (!chartInstance || !historyChart.value || !document.body.contains(historyChart.value)) {
          console.warn('图表实例或DOM元素不存在，无法更新图表')
          return
        }
        
        // 获取当前指标的颜色
        const metricColor = getSensorColor(selectedMetric.value)
        
        // 根据日期范围确定是否显示详细时间
        const oneDayMs = 24 * 60 * 60 * 1000
        const isWithin24Hours = dateRange.value && dateRange.value.length === 2 && 
                               (dateRange.value[1] - dateRange.value[0] <= oneDayMs)
        
        // 设置图表标题，添加日期范围信息
        let titleText = `${selectedItem.label}趋势`
        if (dateRange.value && dateRange.value.length === 2) {
          const startDate = new Date(dateRange.value[0])
          const endDate = new Date(dateRange.value[1])
          const formatDate = (date) => {
            return date.toLocaleDateString()
          }
          titleText += ` (${formatDate(startDate)} 至 ${formatDate(endDate)})`
        }
        
        // 清除旧的图表配置
        chartInstance.clear();
        
        // 设置新的图表配置
        chartInstance.setOption({
          animation: true,
          animationDuration: 800,
          animationEasing: 'cubicInOut',
          title: {
            text: titleText,
            left: 'center',
            textStyle: {
              fontSize: 16,
              fontWeight: 'bold',
              color: '#303133'
            }
          },
          tooltip: {
            trigger: 'axis',
            formatter: function(params) {
              const param = params[0]
              const formattedValue = param.data.value.toFixed(
                selectedMetric.value === 'light_intensity' || selectedMetric.value === 'co2_level' ? 0 : 1
              )
              return `${param.name}<br/>${selectedItem.label}: <strong>${formattedValue}${selectedItem.unit}</strong>`
            },
            axisPointer: {
              animation: true,
              lineStyle: {
                color: metricColor,
                width: 2
              }
            },
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderWidth: 1,
            borderColor: '#eee',
            padding: 10,
            textStyle: {
              color: '#333'
            },
            extraCssText: 'box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);'
          },
          grid: {
            left: '3%',
            right: '4%',
            bottom: '8%',
            top: '60px',
            containLabel: true
          },
          xAxis: {
            type: 'category',
            data: data.map(item => item.time),
            axisLabel: {
              rotate: isWithin24Hours ? 0 : 45,
              fontSize: 11,
              color: '#666',
              interval: isWithin24Hours ? 'auto' : 0,
              formatter: function(value) {
                return value
              }
            },
            axisLine: {
              lineStyle: {
                color: '#ddd'
              }
            },
            axisTick: {
              alignWithLabel: true,
              lineStyle: {
                color: '#ddd'
              }
            }
          },
          yAxis: {
            type: 'value',
            name: selectedItem.label + selectedItem.unit,
            nameTextStyle: {
              color: '#666',
              padding: [0, 0, 0, 30]
            },
            axisLine: {
              show: true,
              lineStyle: {
                color: '#ddd'
              }
            },
            splitLine: {
              lineStyle: {
                color: '#eee',
                type: 'dashed'
              }
            },
            axisLabel: {
              formatter: '{value}'
            }
          },
          dataZoom: [{
            type: 'inside',
            start: 0,
            end: 100,
            zoomLock: false
          }, {
            type: 'slider',
            show: data.length > 20,
            start: 0,
            end: 100,
            height: 20,
            bottom: 0
          }],
          series: [{
            name: selectedItem.label,
            data: data.map(item => item.value),
            type: 'line',
            smooth: true,
            showSymbol: data.length < 30,
            symbolSize: 6,
            itemStyle: {
              color: metricColor
            },
            lineStyle: {
              width: 3,
              shadowColor: 'rgba(0, 0, 0, 0.2)',
              shadowBlur: 10,
              color: metricColor
            },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                {
                  offset: 0,
                  color: `rgba(${getSafeRgbValues(metricColor)}, 0.5)`
                },
                {
                  offset: 1,
                  color: `rgba(${getSafeRgbValues(metricColor)}, 0.1)`
                }
              ])
            },
            emphasis: {
              itemStyle: {
                color: metricColor,
                borderColor: '#fff',
                borderWidth: 2
              }
            }
          }]
        }, true)
      } catch (error) {
        console.error('设置图表选项失败:', error)
        ElMessage.error('图表渲染失败')
      }
    } catch (error) {
      console.error('更新图表时出错:', error)
    }
  })
}

// 定义 resize 处理函数
const handleResize = () => {
  if (chartInstance && chartInstance.resize && typeof chartInstance.resize === 'function') {
    try {
      nextTick(() => {
        chartInstance.resize()
      })
    } catch (error) {
      console.warn('调整图表大小失败:', error)
    }
  }
}

// 指标切换后立即按现有数据重绘一次，避免数据请求失败时图表停留在上一个指标
watch(selectedMetric, () => {
  nextTick(() => {
    if (Array.isArray(chartSeries.value) && chartSeries.value.length > 0) {
      updateChart()
    }
  })
})

// 生命周期钩子
onMounted(async () => {
  try {
    // 实时数据由 useRealtimeFeed 统一订阅（挂载即拉取一次，之后每 5 秒刷新）
    
    // 设置默认日期范围（过去24小时）
    const end = new Date()
    const start = new Date()
    start.setTime(start.getTime() - 3600 * 1000 * 24)
    dateRange.value = [start, end]
    
    // 添加窗口大小变化的监听器
    window.addEventListener('resize', handleResize)
    
    // 延迟初始化图表和获取历史数据
    setTimeout(async () => {
      try {
        // 初始化图表 - 确保DOM已渲染
        await nextTick()
        if (historyChart.value) {
          // 如果已经有实例，先销毁它
          if (chartInstance) {
            try {
              chartInstance.dispose()
            } catch (e) {
              console.warn('销毁旧图表实例失败:', e)
            }
            chartInstance = null
          }
          
          try {
            // 创建新的图表实例
            chartInstance = echarts.init(historyChart.value)
            
            // 添加图表点击事件处理
            chartInstance.on('click', (params) => {
              console.log('点击了图表点:', params)
              // 可以在这里添加点击数据点时的交互功能
            })
            
            // 添加错误处理
            chartInstance.on('error', (params) => {
              console.error('图表渲染错误:', params)
            })
            
            // 标记图表已初始化
            chartInitialized.value = true
          } catch (initError) {
            console.error('初始化图表实例失败:', initError)
            chartInstance = null
            chartInitialized.value = false
          }
        } else {
          console.warn('图表DOM元素不存在，无法初始化图表')
        }
        
        // 获取历史数据
        if (chartInstance) {
          await fetchHistoryData()
        } else {
          console.warn('图表实例不存在，跳过数据获取')
        }
      } catch (error) {
        console.error('初始化失败:', error)
        ElMessage.error('初始化图表或获取数据失败')
      }
    }, 800) // 增加延迟时间，确保DOM完全渲染
  } catch (error) {
    console.error('组件挂载时出错:', error)
    ElMessage.error('加载数据失败，请刷新页面重试')
  }
})

onUnmounted(() => {
  try {
    // 实时轮询由 useRealtimeFeed 在 onDeactivated / onUnmounted 中释放

    // 移除窗口大小变化的监听器
    window.removeEventListener('resize', handleResize)
    
    // 销毁图表实例
    if (chartInstance) {
      try {
        chartInstance.dispose()
      } catch (error) {
        console.warn('销毁图表实例失败:', error)
      }
      chartInstance = null
      chartInitialized.value = false
    }
  } catch (error) {
    console.error('组件卸载时出错:', error)
  }
})

// 导出数据
const handleExport = () => {
  if (!dateRange.value || dateRange.value.length !== 2) {
    ElMessage.warning('请选择导出时间范围')
    return
  }

  const params = {
    start_time: dateRange.value[0].toISOString(),
    end_time: dateRange.value[1].toISOString(),
    metric: selectedMetric.value,
    export: true
  }

  try {
    monitorStore.exportData(params)
    ElMessage.success('数据导出请求已发送')
  } catch (error) {
    console.error('导出数据请求失败:', error)
    ElMessage.error('导出数据失败，请重试')
  }
}
</script>
<style lang="scss">
@import '@/styles/components/monitor.scss';

/* 实时采集状态条 */
.live-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  margin-bottom: 12px;
  background: #fff;
  border: 1px solid #eaf0f4;
  border-radius: 10px;
  font-size: 12px;
  color: #8593a0;

  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #52c41a;
    animation: monitor-pulse 2s infinite;

    &.stale {
      background: #c0c4cc;
      animation: none;
      box-shadow: none;
    }
  }

  .live-text {
    font-size: 13px;
    font-weight: 600;
    color: #2f3b45;
  }

  .live-divider {
    width: 1px;
    height: 12px;
    background: #e4ebf1;
  }

  .live-meta {
    color: #8593a0;
    font-variant-numeric: tabular-nums;
  }

  .live-error {
    color: #f56c6c;
  }
}

@keyframes monitor-pulse {
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

/* 数值变化高亮 */
.value-flash {
  animation: value-flash 0.8s ease;
}

@keyframes value-flash {
  0% {
    background: rgba(64, 158, 255, 0.16);
    box-shadow: 0 0 0 4px rgba(64, 158, 255, 0.14);
    border-radius: 6px;
  }
  100% {
    background: transparent;
    box-shadow: 0 0 0 0 rgba(64, 158, 255, 0);
    border-radius: 6px;
  }
}

/* 修改卡片大小和颜色 */
.monitor-card {
  height: 100%;
  margin-bottom: 15px;
  transition: all 0.3s ease;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  
  &:hover {
    transform: translateY(-5px);
    box-shadow: 0 12px 20px rgba(0, 0, 0, 0.1);
  }
  
  &.monitor-card-selected {
    transform: translateY(-5px);
    box-shadow: 0 12px 20px rgba(0, 0, 0, 0.15);
    
    &::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      width: 100%;
      height: 3px;
      background: currentColor;
    }
    
    .card-header {
      background-color: rgba(0, 0, 0, 0.04);
    }
    
    .value {
      transform: scale(1.05);
    }
  }
  
  .card-header {
    padding: 10px 15px;
    
    .el-icon {
      font-size: 20px;
      margin-right: 8px;
    }
    
    span {
      font-size: 16px;
      font-weight: 600;
    }
  }
  
  .card-content {
    padding: 15px;
    
    .value {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 10px;
      transition: transform 0.3s ease;
    }
    
    .trend {
      font-size: 12px;
      margin-top: 8px;
      padding: 4px 8px;
    }
  }
}

/* 为每种数据类型设置不同颜色 */
.monitor-card-temperature .value-temperature {
  color: #f56c6c;
}

.monitor-card-humidity .value-humidity {
  color: #67c23a;
}

.monitor-card-soil_temperature .value-soil_temperature {
  color: #e6a23c;
}

.monitor-card-soil_moisture .value-soil_moisture {
  color: #909399;
}

.monitor-card-light_intensity .value-light_intensity {
  color: #9254de;
}

.monitor-card-co2_level .value-co2_level {
  color: #1890ff;
}

/* 历史数据图表样式 */
.chart-card {
  margin-top: 20px;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 8px 15px rgba(0, 0, 0, 0.08), 0 3px 8px rgba(0, 0, 0, 0.04);
  
  .chart-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 15px 20px;
    
    .chart-title {
      display: flex;
      flex-direction: column;
      
      span {
        font-size: 18px;
        font-weight: 600;
        color: #303133;
      }
      
      .selected-sensor {
        display: flex;
        align-items: center;
        margin-top: 8px;
        font-size: 14px;
        font-weight: 500;
        
        .sensor-icon {
          margin-right: 5px;
          font-size: 16px;
        }
        
        span {
          font-size: 14px;
        }
      }
    }
    
    .chart-controls {
      display: flex;
      gap: 15px;
      align-items: center;
    }
  }
  
  .history-chart-container {
    padding: 10px;
    position: relative;
    
    .history-chart {
      position: relative;
      z-index: 1;
    }
    
    .chart-loading {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background-color: rgba(255, 255, 255, 0.7);
      z-index: 10;
      
      .el-icon {
        font-size: 32px;
        color: #409EFF;
        margin-bottom: 10px;
      }
      
      span {
        font-size: 14px;
        color: #606266;
      }
    }
  }
}

/* 增强数据表格样式 */
.data-value {
  font-weight: 600;
  font-size: 15px;
  display: inline-block;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.03);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
  text-align: center;
  min-width: 80px;
  
  &:hover {
    transform: translateY(-3px) scale(1.05);
    box-shadow: 0 5px 10px rgba(0, 0, 0, 0.12);
  }
}

.value-temperature, .value-soil_temperature {
  color: #f56c6c;
  background: rgba(245, 108, 108, 0.08);
  border-left: 3px solid rgba(245, 108, 108, 0.5);
}

.value-humidity, .value-soil_moisture {
  color: #67c23a;
  background: rgba(103, 194, 58, 0.08);
  border-left: 3px solid rgba(103, 194, 58, 0.5);
}

.value-light_intensity {
  color: #e6a23c;
  background: rgba(230, 162, 60, 0.08);
  border-left: 3px solid rgba(230, 162, 60, 0.5);
}

.value-co2_level {
  color: #1890ff;
  background: rgba(24, 144, 255, 0.08);
  border-left: 3px solid rgba(24, 144, 255, 0.5);
}

/* 确保分页控件样式生效 */
.pagination {
  margin-top: 20px !important;
  
  .el-pagination {
    padding: 0;
    justify-content: flex-end;
    
    .el-pagination__sizes {
      margin-right: 15px;
    }
    
    .el-pagination__total {
      margin-right: 15px;
    }
    
    .el-pager li {
      min-width: 32px;
      height: 32px;
      line-height: 32px;
      font-weight: 500;
      
      &:hover, &.active {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      }
      
      &.active {
        background-color: #409EFF;
        color: white;
      }
    }
  }
}

/* 表格行样式增强 */
.el-table {
  tr:nth-child(even) {
    background-color: rgba(64, 158, 255, 0.02);
  }
  
  tr:hover td {
    background-color: rgba(64, 158, 255, 0.08) !important;
  }
  
  .cell {
    padding: 0 8px;
  }
  
  th {
    background: linear-gradient(to bottom, #f5f7fa, #ebeef5) !important;
    
    .cell {
      font-weight: 700;
      color: #303133;
    }
  }
}
</style> 