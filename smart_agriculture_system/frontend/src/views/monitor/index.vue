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
        <!-- 切换指标时曲线已按缓存数据即时重绘，只有初次加载（还没有任何数据）才铺遮罩 -->
        <div v-if="trendLoading && !chartSeries.length" class="chart-loading">
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
import { ref, onMounted, onUnmounted, onActivated, computed, nextTick, watch } from 'vue'
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
// 趋势图自己的加载态：不跟 monitorStore.loading 混用，
// 避免表格/导出等操作把图表的遮罩状态带偏
const trendLoading = ref(false)
// 拉取失败时画在画布上的提示，正常渲染时会被清空
const renderFailure = ref('')

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
  if (!value) return
  // 趋势图由 watch(selectedMetric) 立即重绘，这里只负责拉取最新数据
  fetchHistoryData()
}


// 处理卡片点击
const handleCardClick = (key) => {
  // 如果已经选中了这个传感器，不做任何操作
  if (selectedMetric.value === key) return
  selectedMetric.value = key
  fetchHistoryData()
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
  return colorMap[key] || '#2fa98d'
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
      return '47, 169, 141'; // 默认蓝色
    }
    
    const hex = hexColor.replace(/^#/, '');
    const matches = hex.match(/../g);
    
    if (!matches || matches.length !== 3) {
      return '47, 169, 141'; // 默认蓝色
    }
    
    return matches.map(h => parseInt(h, 16)).join(', ');
  } catch (error) {
    console.error('颜色转换错误:', error);
    return '47, 169, 141'; // 默认蓝色
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

// 请求序号：连续快速切换指标/日期时，只让最后一次请求的结果落地，
// 避免先发后到的旧响应把新曲线覆盖掉
let fetchSeq = 0

// el-date-picker 的 daterange 两端都是当天 00:00，
// 原样传给后端会把结束日一整天排除在外（选 11.21–11.22 实际只查 11.21），
// 因此统一把结束时间补到当天最后一毫秒。
const buildQueryRange = () => {
  const start = new Date(dateRange.value[0])
  const end = new Date(dateRange.value[1])
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

// 获取历史数据
const fetchHistoryData = async () => {
  if (!dateRange.value || dateRange.value.length !== 2) {
    ElMessage.warning('请选择日期范围')
    trendLoading.value = false
    return
  }

  const seq = ++fetchSeq
  trendLoading.value = true

  try {
    // 表格遮罩
    monitorStore.loading = true

    const { start: rangeStart, end: rangeEnd } = buildQueryRange()

    const response = await getHistoryData({
      start_time: rangeStart.toISOString(),
      end_time: rangeEnd.toISOString(),
      metric: selectedMetric.value,
      page: currentPage.value,
      page_size: pageSize.value
    })

    // 期间又发起了新查询，本次结果已过期，直接丢弃
    if (seq !== fetchSeq) return

    if (response && response.data) {
      // 后端返回的是分页数据
      monitorStore.historyData = Array.isArray(response.data) ? response.data : (response.data.items || [])
      total.value = response.meta?.total ?? response.data.total ?? 0
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

    // 趋势图单独取完整区间数据（不跟着表格分页走），再按时间桶聚合
    try {
      const rangeResponse = await getHistoryRange({
        start_date: rangeStart.toISOString(),
        end_date: rangeEnd.toISOString(),
        metric: selectedMetric.value
      })
      // 旧请求晚到，丢弃，避免覆盖最新一次查询的曲线
      if (seq !== fetchSeq) return
      const rows = Array.isArray(rangeResponse) ? rangeResponse : (rangeResponse?.data || [])
      // 时间桶严格对齐所选区间，横轴标签才会与真实采样时刻一致
      chartSeries.value = bucketSeries(rows, { start: rangeStart, end: rangeEnd })
    } catch (rangeError) {
      console.warn('获取区间历史数据失败，趋势图退回当前页数据:', rangeError)
      chartSeries.value = monitorStore.historyData
    }

    if (seq !== fetchSeq) return
    renderFailure.value = ''
    scheduleRender()
  } catch (error) {
    if (seq !== fetchSeq) return
    console.error('获取历史数据失败:', error)
    ElMessage.error('获取历史数据失败')
    monitorStore.historyData = []
    chartSeries.value = []
    total.value = 0
    // 失败时也要重画：把旧曲线清掉，否则画布停在上一张图上，
    // 用户会以为"日期选了没反应"
    renderFailure.value = '历史数据加载失败'
    scheduleRender()
  } finally {
    // 只由最后一次请求收起加载态，避免旧请求提前把遮罩关掉
    if (seq === fetchSeq) {
      trendLoaded = true
      trendLoading.value = false
      monitorStore.loading = false
    }
  }
}

// ---- 趋势图渲染 ----
// 渲染只由 (selectedMetric, chartSeries, dateRange) 三个状态决定：
// 任何状态变化都重画一次，画完立刻回读 option 校验结果。
//
// 为什么要校验：ECharts 在内部主流程（tooltip 动作、dispatchAction 等）期间
// 收到 setOption / resize 会直接 return，既不报错也不更新画布；一旦实例卡在
// 这个状态，图表就会永远停在上一张图上（「切换指标后仍是空气温度曲线」）。
// 这里发现没画上去就销毁重建实例再画一次，从机制上保证图表不会被冻住。
let needsRender = false
let renderQueued = false
// 首次数据回来之前不要画「暂无数据」，否则进页面会闪一下空状态
let trendLoaded = false

// 销毁实例（DOM 变更、实例异常、组件卸载）
const disposeChartInstance = () => {
  if (!chartInstance) return
  try {
    chartInstance.dispose()
  } catch (error) {
    console.warn('销毁图表实例失败:', error)
  }
  chartInstance = null
  chartInitialized.value = false
}

// 确保图表实例与当前容器一致：DOM 变了或实例已销毁，都重建
const ensureChartInstance = () => {
  const el = historyChart.value
  if (!el) return null
  if (chartInstance) {
    const stale = chartInstance.isDisposed?.() || chartInstance.getDom?.() !== el
    if (stale) disposeChartInstance()
  }
  if (!chartInstance) {
    try {
      chartInstance = echarts.init(el)
      chartInstance.on('error', (params) => console.error('图表渲染错误:', params))
    } catch (error) {
      console.error('图表初始化失败:', error)
      return null
    }
  }
  chartInitialized.value = true
  return chartInstance
}

// 标题里的日期范围后缀
const formatRangeLabel = () => {
  if (!dateRange.value || dateRange.value.length !== 2) return ''
  const startDate = new Date(dateRange.value[0])
  const endDate = new Date(dateRange.value[1])
  return ` (${startDate.toLocaleDateString()} 至 ${endDate.toLocaleDateString()})`
}

// 组装 option —— 纯函数，只读当前状态，不碰实例
const buildTrendOption = () => {
  // 请求失败：画错误提示，绝不把上一次查询的曲线留在画布上
  if (renderFailure.value) {
    return {
      title: {
        text: renderFailure.value,
        subtext: '请稍后重试，或检查后端服务是否正常',
        left: 'center',
        top: 'center',
        textStyle: { color: '#f56c6c', fontSize: 16, fontWeight: 'normal' },
        subtextStyle: { color: '#b6bcc4', fontSize: 12 }
      }
    }
  }

  const selectedItem = monitorItems.find((item) => item.key === selectedMetric.value) ||
    { label: '未知指标', unit: '' }
  const metricColor = getSensorColor(selectedMetric.value)

  const oneDayMs = 24 * 60 * 60 * 1000
  const rangeStart = dateRange.value && dateRange.value.length === 2 ? new Date(dateRange.value[0]) : null
  const rangeEnd = dateRange.value && dateRange.value.length === 2 ? new Date(dateRange.value[1]) : null
  const isWithin24Hours = Boolean(rangeStart && rangeEnd && rangeEnd - rangeStart <= oneDayMs)

  const data = (Array.isArray(chartSeries.value) ? chartSeries.value : [])
    .filter((item) => item && item.timestamp)
    .map((item) => {
      let value = item[selectedMetric.value]

      // 兼容后端 / 缓存里的其他字段名
      if (value === undefined || value === null) {
        if (selectedMetric.value === 'temperature' && item.air_temperature !== undefined) {
          value = item.air_temperature
        } else if (selectedMetric.value === 'humidity' && item.air_humidity !== undefined) {
          value = item.air_humidity
        } else if (selectedMetric.value === 'co2_level' && item.co2_concentration !== undefined) {
          value = item.co2_concentration
        }
      }
      if (value === undefined || value === null) return null

      const itemDate = new Date(item.timestamp)
      if (Number.isNaN(itemDate.getTime())) return null

      const num = parseFloat(value)
      if (Number.isNaN(num)) return null

      const time = isWithin24Hours
        ? itemDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : itemDate.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

      return { time, fullTime: itemDate, value: num }
    })
    .filter(Boolean)
    .sort((a, b) => a.fullTime - b.fullTime)

  if (data.length === 0) {
    return {
      title: {
        text: '所选时间段暂无数据',
        subtext: '该指标在此区间没有有效采样值',
        left: 'center',
        top: 'center',
        textStyle: { color: '#909399', fontSize: 16, fontWeight: 'normal' },
        subtextStyle: { color: '#b6bcc4', fontSize: 12 }
      }
    }
  }

  const digits = selectedMetric.value === 'light_intensity' || selectedMetric.value === 'co2_level' ? 0 : 1

  return {
    animation: true,
    animationDuration: 600,
    animationEasing: 'cubicInOut',
    title: {
      text: `${selectedItem.label}趋势${formatRangeLabel()}`,
      left: 'center',
      textStyle: { fontSize: 16, fontWeight: 'bold', color: '#303133' }
    },
    tooltip: {
      trigger: 'axis',
      // series.data 是纯数字数组，数值在 param.value 上；
      // 早期写成 param.data.value 会抛 TypeError，异常发生在 ECharts 的
      // tooltip 动作里，会把实例卡在「主流程」状态，之后所有 setOption 都被
      // 静默忽略 —— 这是「图表只显示空气温度曲线」的根因，这里一并修掉。
      formatter: (params) => {
        try {
          const list = Array.isArray(params) ? params : [params]
          const param = list.find((item) => item && item.seriesName) || list[0]
          if (!param) return ''
          const raw = Array.isArray(param.value) ? param.value[param.value.length - 1] : param.value
          const num = typeof raw === 'number' ? raw : Number(raw)
          const text = Number.isFinite(num) ? num.toFixed(digits) : '--'
          const label = param.axisValueLabel || param.name || ''
          return `${label}<br/>${param.marker || ''}${selectedItem.label}: <strong>${text}${selectedItem.unit}</strong>`
        } catch (error) {
          return ''
        }
      },
      axisPointer: {
        animation: true,
        lineStyle: { color: metricColor, width: 2 }
      },
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderWidth: 1,
      borderColor: '#eee',
      padding: 10,
      textStyle: { color: '#333' },
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
      data: data.map((item) => item.time),
      axisLabel: {
        rotate: isWithin24Hours ? 0 : 45,
        fontSize: 11,
        color: '#666',
        interval: isWithin24Hours ? 'auto' : 0
      },
      axisLine: { lineStyle: { color: '#ddd' } },
      axisTick: { alignWithLabel: true, lineStyle: { color: '#ddd' } }
    },
    yAxis: {
      type: 'value',
      name: selectedItem.label + selectedItem.unit,
      nameTextStyle: { color: '#666', padding: [0, 0, 0, 30] },
      axisLine: { show: true, lineStyle: { color: '#ddd' } },
      splitLine: { lineStyle: { color: '#eee', type: 'dashed' } },
      axisLabel: { formatter: '{value}' }
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
      data: data.map((item) => item.value),
      type: 'line',
      smooth: true,
      showSymbol: data.length < 30,
      symbolSize: 6,
      itemStyle: { color: metricColor },
      lineStyle: {
        width: 3,
        shadowColor: 'rgba(0, 0, 0, 0.2)',
        shadowBlur: 10,
        color: metricColor
      },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: `rgba(${getSafeRgbValues(metricColor)}, 0.5)` },
          { offset: 1, color: `rgba(${getSafeRgbValues(metricColor)}, 0.1)` }
        ])
      },
      emphasis: {
        itemStyle: { color: metricColor, borderColor: '#fff', borderWidth: 2 }
      }
    }]
  }
}

// 真正写画布；返回 false 表示这次没有画上去（被 ECharts 忽略或抛错）
const paintOption = (instance, option) => {
  // 只有尺寸变了才重排，避免每次切换指标都多跑一遍渲染
  try {
    const el = historyChart.value
    if (el && (instance.getWidth() !== el.clientWidth || instance.getHeight() !== el.clientHeight)) {
      instance.resize()
    }
  } catch (error) {
    /* 尺寸异常不阻塞绘制 */
  }
  try {
    // notMerge = true：整份 option 替换，旧指标的标题/坐标轴/曲线不会残留
    instance.setOption(option, true)
  } catch (error) {
    console.error('设置图表选项失败:', error)
    return false
  }
  const applied = instance.getOption?.()?.title?.[0]?.text
  return applied === option.title.text
}

// 按当前状态重绘趋势图
const paintTrendChart = () => {
  const el = historyChart.value
  if (!el) return false

  // 容器没有尺寸（页面被 keep-alive 缓存、父级隐藏）时既不能 init 也不能画，
  // 但这一次渲染不能丢：标记后由 ResizeObserver / onActivated 补画。
  if (el.clientWidth === 0 || el.clientHeight === 0) {
    needsRender = true
    return false
  }

  // 首次请求还没回来：保持「初始化图表…」遮罩，避免闪出空状态
  if (!trendLoaded && !renderFailure.value && !chartSeries.value.length) {
    needsRender = true
    return false
  }

  const option = buildTrendOption()
  const instance = ensureChartInstance()
  if (!instance) {
    needsRender = true
    return false
  }

  let painted = paintOption(instance, option)

  if (!painted) {
    console.warn('趋势图未生效，重建实例后重试', {
      expect: option.title.text,
      actual: instance.getOption?.()?.title?.[0]?.text
    })
    disposeChartInstance()
    const retry = ensureChartInstance()
    painted = retry ? paintOption(retry, option) : false
  }

  needsRender = !painted
  return painted
}

// 合并同一轮状态变化，避免一次切换触发多次重绘
const scheduleRender = () => {
  if (renderQueued) return
  renderQueued = true
  nextTick(() => {
    renderQueued = false
    paintTrendChart()
  })
}

// 容器尺寸变化（侧边栏折叠、窗口缩放、页面从缓存恢复）时补画
let trendResizeObserver = null
const observeChartSize = () => {
  const el = historyChart.value
  if (!el || typeof ResizeObserver === 'undefined') return
  if (trendResizeObserver && trendResizeObserver.__el === el) return
  if (trendResizeObserver) {
    trendResizeObserver.disconnect()
    trendResizeObserver = null
  }
  trendResizeObserver = new ResizeObserver(() => {
    if (chartInstance && !chartInstance.isDisposed?.()) {
      try {
        chartInstance.resize()
      } catch (error) {
        /* 忽略尺寸异常 */
      }
    }
    if (needsRender) scheduleRender()
  })
  trendResizeObserver.__el = el
  trendResizeObserver.observe(el)
}

// 窗口尺寸变化：只重排画布，不重新取数
const handleResize = () => {
  if (chartInstance && typeof chartInstance.resize === 'function') {
    try {
      chartInstance.resize()
    } catch (error) {
      console.warn('调整图表大小失败:', error)
    }
  }
  if (needsRender) scheduleRender()
}

// 指标切换后立即按现有数据重绘：缓存里每行都含全部指标，
// 不必等接口回来，切换指标时曲线和标题会同步变化
watch(selectedMetric, () => {
  scheduleRender()
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

    window.addEventListener('resize', handleResize)
    await nextTick()
    observeChartSize()
    await fetchHistoryData()
  } catch (error) {
    console.error('组件挂载时出错:', error)
    ElMessage.error('加载数据失败，请刷新页面重试')
  }
})

// keep-alive 缓存后再次进入本页时，DOM 会被重新挂载、尺寸才恢复，
// 这里补一次尺寸监听并重绘，避免图表停在缓存前的旧画布上
onActivated(() => {
  nextTick(() => {
    observeChartSize()
    scheduleRender()
  })
})

onUnmounted(() => {
  try {
    // 实时轮询由 useRealtimeFeed 在 onDeactivated / onUnmounted 中释放

    window.removeEventListener('resize', handleResize)
    if (trendResizeObserver) {
      trendResizeObserver.disconnect()
      trendResizeObserver = null
    }
    disposeChartInstance()
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

  // 与表格查询保持一致：结束日补到 23:59:59.999，避免导出零宽度区间
  const { start: rangeStart, end: rangeEnd } = buildQueryRange()

  const params = {
    start_time: rangeStart.toISOString(),
    end_time: rangeEnd.toISOString(),
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
    background: rgba(47, 169, 141, 0.16);
    box-shadow: 0 0 0 4px rgba(47, 169, 141, 0.14);
    border-radius: 6px;
  }
  100% {
    background: transparent;
    box-shadow: 0 0 0 0 rgba(47, 169, 141, 0);
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
        color: #2fa98d;
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
        background-color: #2fa98d;
        color: white;
      }
    }
  }
}

/* 表格行样式增强 */
.el-table {
  tr:nth-child(even) {
    background-color: rgba(47, 169, 141, 0.02);
  }
  
  tr:hover td {
    background-color: rgba(47, 169, 141, 0.08) !important;
  }
  
  .cell {
    padding: 0 8px;
  }
  
  th {
    background: linear-gradient(to bottom, #f5f9f7, #ebeef5) !important;
    
    .cell {
      font-weight: 700;
      color: #303133;
    }
  }
}
</style> 