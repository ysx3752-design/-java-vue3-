<template>
  <div class="data-analysis">
    <el-card class="box-card">
      <template #header>
        <div class="card-header">
          <div class="title-section">
            <span class="title">数据分析</span>
            <span class="subtitle">显示最近24小时的数据，按小时聚合</span>
            <el-tag v-if="isDemoData" type="warning" size="small" effect="plain" class="demo-tag">
              演示数据
            </el-tag>
          </div>
          
          <!-- 添加右侧刷新按钮 -->
          <div class="header-actions">
            <el-button 
              type="primary" 
              size="small" 
              :loading="loading" 
              @click="fetchData">
              <el-icon><Refresh /></el-icon>
              <span>刷新数据</span>
            </el-button>
          </div>
        </div>
      </template>
      
      <!-- 图表区域 -->
      <div v-loading="loading" class="charts-container">
        <el-row :gutter="20" v-if="!loading && chartData && chartData.length > 0">
          <el-col :span="12">
            <div class="chart-wrapper">
              <div ref="temperatureChart" class="chart-inner" style="width:100%;height:300px;"></div>
            </div>
          </el-col>
          <el-col :span="12">
            <div class="chart-wrapper">
              <div ref="humidityChart" class="chart-inner" style="width:100%;height:300px;"></div>
            </div>
          </el-col>
        </el-row>
        
        <el-row :gutter="20" style="margin-top: 20px" v-if="!loading && chartData && chartData.length > 0">
          <el-col :span="12">
            <div class="chart-wrapper">
              <div ref="soilMoistureChart" class="chart-inner" style="width:100%;height:300px;"></div>
            </div>
          </el-col>
          <el-col :span="12">
            <div class="chart-wrapper">
              <div ref="lightIntensityChart" class="chart-inner" style="width:100%;height:300px;"></div>
            </div>
          </el-col>
        </el-row>
        
        <!-- 没有数据时显示提示 -->
        <el-empty v-if="!loading && (!chartData || chartData.length === 0)" description="暂无历史数据" />
      </div>

      <!-- 数据统计 -->
      <div class="data-summary" v-if="chartData && chartData.length > 0">
        <div class="summary-title">数据统计</div>
        <div class="summary-content">
          <div class="summary-item">
            <span>数据时间范围: {{ dataTimeRange }}</span>
          </div>
          <div class="summary-item">
            <span>共 {{ rawRecordCount }} 条采样记录，聚合为 {{ chartData.length }} 个曲线点</span>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, computed, inject, getCurrentInstance } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import axios from 'axios'
import { historyApi } from '@/api/history'
import { ensureArray, safeParseFloat, safeArrayOperation } from '@/utils/dataHelper'
import { bucketSeries, generateDemoSeries } from '@/utils/chartSeries'

const temperatureChart = ref(null)
const humidityChart = ref(null)
const soilMoistureChart = ref(null)
const lightIntensityChart = ref(null)
const loading = ref(false)
const chartData = ref([])
const dataLoaded = ref(false) // Track if data has been loaded
// 无接口数据时为 true，界面会明确标注为演示数据
const isDemoData = ref(false)
// 原始记录条数（聚合前），用于在摘要里显示真实样本量
const rawRecordCount = ref(0)
const { proxy } = getCurrentInstance()

// 添加数据缓存
const chartDataCache = {
  lastFetched: null,
  data: null,
  cacheExpiration: 5 * 60 * 1000 // 5分钟缓存过期
}

// 计算数据时间范围
const dataTimeRange = computed(() => {
  if (!chartData.value || chartData.value.length === 0) {
    return '无数据';
  }
  
  try {
    // 获取排序后的数据
    const sortedData = [...chartData.value].sort((a, b) => {
      return new Date(a.timestamp) - new Date(b.timestamp);
    });
    
    // 获取第一条和最后一条数据的时间
    const firstDate = new Date(sortedData[0].timestamp);
    const lastDate = new Date(sortedData[sortedData.length - 1].timestamp);
    
    // 格式化日期
    return `${firstDate.toLocaleString()} 至 ${lastDate.toLocaleString()}`;
  } catch (e) {
    return '时间范围计算失败';
  }
});

let charts = {
  temperature: null,
  humidity: null,
  soilMoisture: null,
  lightIntensity: null
}

// 提取resize处理函数为独立函数，方便移除监听
const handleResize = () => {
  Object.values(charts).forEach(chart => chart?.resize())
}

// 简化DOM元素检查
const checkDomElements = () => {
  const elements = [
    temperatureChart.value,
    humidityChart.value,
    soilMoistureChart.value,
    lightIntensityChart.value
  ]
  
  return elements.every(el => el && el.clientWidth > 0 && el.clientHeight > 0)
}

// 把一组曲线点渲染到四个图表上（真实数据与演示数据共用）
const renderSeries = async (series) => {
  // 强制销毁并重新创建所有图表
  Object.values(charts).forEach(chart => {
    if (chart) {
      try {
        chart.dispose()
      } catch (e) {
        console.warn('销毁图表出错:', e)
      }
    }
  })

  charts.temperature = null
  charts.humidity = null
  charts.soilMoisture = null
  charts.lightIntensity = null

  chartData.value = series
  dataLoaded.value = true
  // 必须先解除 loading：图表容器被 v-if="!loading && chartData.length>0" 控制，
  // loading 为 true 时 DOM 根本不存在，initSimpleCharts 会直接返回
  loading.value = false

  await nextTick()
  await nextTick()

  initSimpleCharts()
  await nextTick()

  updateCharts(series)
}

// 优化数据获取逻辑
const fetchData = async () => {
  // 如果已经在加载，则不再重复请求
  if (loading.value) return
  
  loading.value = true
  chartData.value = [] // 先清空当前数据
  
  try {
    // 清除缓存，强制重新获取最新数据
    historyApi.clearCache()
    
    // 设置默认时间范围为最近24小时
    const end = new Date()
    const start = new Date()
    start.setTime(start.getTime() - 3600 * 1000 * 24)
    
    const params = {
      start_date: start.toISOString(),
      end_date: end.toISOString()
    }
    
    console.log('请求历史数据，参数:', params)
    
    // 添加直接请求作为备选
    let response
    let successMethod = ''
    
    try {
    // 使用historyApi模块获取数据
      response = await historyApi.getHistoryData(params)
      successMethod = 'historyApi'
      
    } catch (apiError) {
      console.error('historyApi获取失败，尝试直接请求:', apiError)
      
      try {
        // 直接使用axios请求
        const directResponse = await axios.get('http://localhost:5000/api/history/data', {
          params: params,
          timeout: 10000
        })
        response = directResponse.data
        successMethod = 'direct axios'
        
      } catch (directError) {
        console.error('直接请求也失败:', directError)
        throw directError
      }
    }
    
    console.log(`成功通过${successMethod}获取数据:`, response)
    
    // 使用安全数组方法
    const data = ensureArray(response)
    console.log('处理后的数据数组:', data)
    rawRecordCount.value = data.length

    if (data.length > 0) {
      // 按小时聚合成固定 24 个点再绘制：库里可能几百条记录，
      // 逐点画会在采样密集处叠成一团，看不出趋势
      const series = bucketSeries(data, { points: 24, hours: 24, end })
      isDemoData.value = false

      // 更新缓存
      chartDataCache.data = series
      chartDataCache.lastFetched = Date.now()

      await renderSeries(series)
      ElMessage.success(`成功加载 ${data.length} 条记录，按小时聚合为 ${series.length} 个点`)
    } else {
      // 无接口数据时展示演示曲线，并在界面上明确标注
      isDemoData.value = true
      await renderSeries(generateDemoSeries({ points: 24, end }))
      ElMessage.info('该时间范围内暂无历史数据，当前展示演示曲线')
    }
  } catch (error) {
    console.error('获取历史数据失败:', error)
    // 后端不可用时同样给出演示曲线，避免整页空白（界面有"演示数据"标识）
    isDemoData.value = true
    rawRecordCount.value = 0
    await renderSeries(generateDemoSeries({ points: 24 }))
    ElMessage.warning('获取历史数据失败，当前展示演示曲线，请检查后端服务与硬件连接')
  } finally {
    loading.value = false
  }
}

// 简化版图表初始化函数 - 避免使用复杂的插件
const initSimpleCharts = () => {
  // 确保DOM元素已准备好
  if (!temperatureChart.value || !humidityChart.value || 
      !soilMoistureChart.value || !lightIntensityChart.value) {
    console.warn('图表DOM元素未准备好')
    return
  }
  
  console.log('初始化简化图表...')
  console.log('图表容器尺寸:', 
    temperatureChart.value.clientWidth, 
    temperatureChart.value.clientHeight
  )
  
  // 如果容器尺寸为0，使用延迟策略
  if (temperatureChart.value.clientWidth === 0 || temperatureChart.value.clientHeight === 0) {
    console.warn('容器尺寸为0，使用延迟初始化策略')
    delayedChartInit()
    return
  }
  
  // 初始化温度图表
  try {
    charts.temperature = echarts.init(temperatureChart.value)
    charts.temperature.setOption({
      title: { text: '温度变化趋势' },
      tooltip: { 
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          label: {
            backgroundColor: '#6a7985'
          }
        },
        formatter: function(params) {
          const date = new Date(params[0].value[0]);
          const formattedTime = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
          let result = `<div style="font-weight:bold;margin-bottom:5px;">${formattedTime}</div>`;
          params.forEach(param => {
            result += `<div style="display:flex;align-items:center;margin:3px 0;">
              <span style="display:inline-block;width:10px;height:10px;background:${param.color};margin-right:5px;border-radius:50%;"></span>
              <span>${param.seriesName}: <span style="font-weight:bold;float:right;margin-left:15px;">${param.value[1].toFixed(1)}°C</span></span>
            </div>`;
          });
          return result;
        },
        backgroundColor: 'rgba(50,50,50,0.9)',
        borderColor: '#ccc',
        borderWidth: 1,
        padding: [5, 10],
        textStyle: {
          color: '#fff',
          fontSize: 13
        }
      },
      xAxis: { type: 'time' },
      yAxis: { type: 'value', name: '温度 (°C)' },
      series: [{ 
        type: 'line',
        name: '温度',
        data: []
      }]
    })
    
    // 初始化湿度图表
    charts.humidity = echarts.init(humidityChart.value)
    charts.humidity.setOption({
      title: { text: '湿度变化趋势' },
      tooltip: { 
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          label: {
            backgroundColor: '#6a7985'
          }
        },
        formatter: function(params) {
          const date = new Date(params[0].value[0]);
          const formattedTime = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
          let result = `<div style="font-weight:bold;margin-bottom:5px;">${formattedTime}</div>`;
          params.forEach(param => {
            result += `<div style="display:flex;align-items:center;margin:3px 0;">
              <span style="display:inline-block;width:10px;height:10px;background:${param.color};margin-right:5px;border-radius:50%;"></span>
              <span>${param.seriesName}: <span style="font-weight:bold;float:right;margin-left:15px;">${param.value[1].toFixed(1)}%</span></span>
            </div>`;
          });
          return result;
        },
        backgroundColor: 'rgba(50,50,50,0.9)',
        borderColor: '#ccc',
        borderWidth: 1,
        padding: [5, 10],
        textStyle: {
          color: '#fff',
          fontSize: 13
        }
      },
      xAxis: { type: 'time' },
      yAxis: { type: 'value', name: '湿度 (%)' },
      series: [{ 
        type: 'line',
        name: '湿度',
        data: []
      }]
    })
    
    // 初始化土壤湿度图表
    charts.soilMoisture = echarts.init(soilMoistureChart.value)
    charts.soilMoisture.setOption({
      title: { text: '土壤湿度变化趋势' },
      tooltip: { 
        trigger: 'axis',
        axisPointer: {
          type: 'shadow'
        },
        formatter: function(params) {
          const date = new Date(params[0].value[0]);
          const formattedTime = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
          let result = `<div style="font-weight:bold;margin-bottom:5px;">${formattedTime}</div>`;
          params.forEach(param => {
            result += `<div style="display:flex;align-items:center;margin:3px 0;">
              <span style="display:inline-block;width:10px;height:10px;background:${param.color};margin-right:5px;border-radius:50%;"></span>
              <span>${param.seriesName}: <span style="font-weight:bold;float:right;margin-left:15px;">${param.value[1].toFixed(1)}%</span></span>
            </div>`;
          });
          return result;
        },
        backgroundColor: 'rgba(50,50,50,0.9)',
        borderColor: '#ccc',
        borderWidth: 1,
        padding: [5, 10],
        textStyle: {
          color: '#fff',
          fontSize: 13
        }
      },
      xAxis: { type: 'time' },
      yAxis: { type: 'value', name: '土壤湿度 (%)' },
      series: [{
        type: 'bar',
        barWidth: '60%',
        showBackground: true,
        backgroundStyle: {
          color: 'rgba(220, 220, 220, 0.3)'
        },
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#83bff6' },
            { offset: 0.5, color: '#188df0' },
            { offset: 1, color: '#188df0' }
          ]),
          borderRadius: [4, 4, 0, 0],
          shadowColor: 'rgba(0, 0, 0, 0.3)',
          shadowBlur: 10
        },
        emphasis: {
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#2378f7' },
              { offset: 0.7, color: '#2378f7' },
              { offset: 1, color: '#83bff6' }
            ])
          }
        },
        data: []
      }]
    })
    
    // 初始化光照强度图表
    charts.lightIntensity = echarts.init(lightIntensityChart.value)
    charts.lightIntensity.setOption({
      title: { text: '光照强度变化趋势' },
      tooltip: { 
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          label: {
            backgroundColor: '#6a7985'
          }
        },
        formatter: function(params) {
          const date = new Date(params[0].value[0]);
          const formattedTime = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
          let result = `<div style="font-weight:bold;margin-bottom:5px;">${formattedTime}</div>`;
          params.forEach(param => {
            result += `<div style="display:flex;align-items:center;margin:3px 0;">
              <span style="display:inline-block;width:10px;height:10px;background:${param.color};margin-right:5px;border-radius:50%;"></span>
              <span>${param.seriesName}: <span style="font-weight:bold;float:right;margin-left:15px;">${param.value[1].toFixed(0)} lux</span></span>
            </div>`;
          });
          return result;
        },
        backgroundColor: 'rgba(50,50,50,0.9)',
        borderColor: '#ccc',
        borderWidth: 1,
        padding: [5, 10],
        textStyle: {
          color: '#fff',
          fontSize: 13
        }
      },
      xAxis: { type: 'time' },
      yAxis: { type: 'value', name: '光照强度 (lux)' },
      series: [{
        type: 'line',
        name: '光照强度',
        data: []
      }]
    })
    
    // 添加窗口大小改变事件
    window.addEventListener('resize', () => {
      Object.values(charts).forEach(chart => chart?.resize())
    })
    
    console.log('图表初始化完成')
  } catch (e) {
    console.error('图表初始化失败:', e)
    // 失败时使用延迟策略
    delayedChartInit()
  }
}

// 延迟初始化策略 - 通过多次尝试和DOM监听确保图表正确渲染
const delayedChartInit = (retries = 5) => {
  if (retries <= 0) {
    console.error('图表初始化失败: 超过最大重试次数')
    return
  }
  
  console.log(`延迟初始化图表，剩余重试次数: ${retries}`)
  
  // 给图表容器显式设置宽高
  const forceSetSize = () => {
    [temperatureChart.value, humidityChart.value, soilMoistureChart.value, lightIntensityChart.value].forEach(el => {
      if (el) {
        el.style.width = '100%'
        el.style.height = '300px'
      }
    })
  }
  
  // 强制应用样式
  forceSetSize()
  
  // 使用MutationObserver监听DOM变化
  if (!window._chartObserver) {
    window._chartObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' || mutation.type === 'childList') {
          // 当DOM变化时，尝试重新初始化图表
          forceSetSize()
          console.log('DOM变化，尝试重新初始化图表')
          
  setTimeout(() => {
            if (charts.temperature) return // 已经初始化，不再处理
            
            // 检查容器尺寸
            if (temperatureChart.value && 
                temperatureChart.value.clientWidth > 0 && 
                temperatureChart.value.clientHeight > 0) {
              initSimpleCharts()
              
              // 如果图表已成功初始化，更新数据
              if (charts.temperature && chartData.value.length > 0) {
                updateCharts(chartData.value)
              }
            }
          }, 100)
        }
      }
    })
    
    // 监听所有图表容器
    ;[temperatureChart.value, humidityChart.value, soilMoistureChart.value, lightIntensityChart.value].forEach(el => {
      if (el) {
        window._chartObserver.observe(el, { 
          attributes: true, 
          childList: true,
          subtree: true,
          attributeFilter: ['style', 'class', 'width', 'height']
        })
      }
    })
  }
  
  // 延迟重试
  setTimeout(() => {
    // 检查图表是否已初始化
    if (charts.temperature) return
    
    // 检查容器尺寸
    if (temperatureChart.value && 
        temperatureChart.value.clientWidth > 0 && 
        temperatureChart.value.clientHeight > 0) {
      // 尝试初始化
      initSimpleCharts()
      
      // 如果图表已成功初始化，更新数据
      if (charts.temperature && chartData.value.length > 0) {
        updateCharts(chartData.value)
      }
    } else {
      // 容器尺寸仍为0，继续重试
      delayedChartInit(retries - 1)
    }
  }, 300)
}

const updateCharts = (data) => {
  // 检查数据是否为空或不是数组
  const safeData = ensureArray(data)
  if (safeData.length === 0) {
    console.warn('没有数据可以更新图表')
    chartData.value = []
    return
  }
  
  console.log('开始更新图表数据，数据条数:', safeData.length)

  // 确保数据按时间排序
  const sortedData = [...safeData].sort((a, b) => {
    try {
      return normalizeTimestamp(a.timestamp) - normalizeTimestamp(b.timestamp)
    } catch (e) {
      return 0
    }
  })

  // 设置图表数据
  chartData.value = sortedData
  dataLoaded.value = true

  // 预处理所有图表数据 - 确保时间戳格式正确
  const processedData = {
    temperature: [],
    humidity: [],
    soilMoisture: [],
    lightIntensity: []
  }
  
  // 如果数据量过大，进行采样
  const sampleData = (data, maxPoints = 100) => {
    if (data.length <= maxPoints) return data;
    
    const step = Math.ceil(data.length / maxPoints);
    const sampled = [];
    
    // 确保始终保留第一个和最后一个数据点
    sampled.push(data[0]);
    
    // 采样中间的数据点
    for (let i = step; i < data.length - step; i += step) {
      sampled.push(data[i]);
    }
    
    // 添加最后一个数据点
    sampled.push(data[data.length - 1]);
    
    return sampled;
  };
  
  sortedData.forEach(item => {
    const time = normalizeTimestamp(item.timestamp)
    
    // 温度数据
    if (item.air_temperature !== undefined || item.temperature !== undefined) {
      const temp = safeParseFloat(item.air_temperature || item.temperature)
      processedData.temperature.push([time, temp])
    }
    
    // 湿度数据
    if (item.air_humidity !== undefined || item.humidity !== undefined) {
      const humidity = safeParseFloat(item.air_humidity || item.humidity)
      processedData.humidity.push([time, humidity])
    }
    
    // 土壤湿度数据
    if (item.soil_moisture !== undefined) {
      const soilMoisture = safeParseFloat(item.soil_moisture)
      processedData.soilMoisture.push([time, soilMoisture])
    }
    
    // 光照强度数据
    if (item.light_intensity !== undefined) {
      const light = safeParseFloat(item.light_intensity)
      processedData.lightIntensity.push([time, light])
    }
  })
  
  // 对过多的数据点进行采样
  processedData.temperature = sampleData(processedData.temperature);
  processedData.humidity = sampleData(processedData.humidity);
  processedData.soilMoisture = sampleData(processedData.soilMoisture);
  processedData.lightIntensity = sampleData(processedData.lightIntensity);
  
  console.log('处理后的数据:',
    `温度: ${processedData.temperature.length}条`,
    `湿度: ${processedData.humidity.length}条`,
    `土壤湿度: ${processedData.soilMoisture.length}条`,
    `光照强度: ${processedData.lightIntensity.length}条`
  )
  
  // 逐个更新图表数据
  if (charts.temperature && processedData.temperature.length > 0) {
    try {
      charts.temperature.setOption({
        series: [{ data: processedData.temperature }]
      })
      console.log('温度图表更新成功')
    } catch (e) {
      console.error('更新温度图表失败:', e)
    }
  }
  
  if (charts.humidity && processedData.humidity.length > 0) {
    try {
      charts.humidity.setOption({
        series: [{ data: processedData.humidity }]
      })
      console.log('湿度图表更新成功')
    } catch (e) {
      console.error('更新湿度图表失败:', e)
    }
  }
  
  if (charts.soilMoisture && processedData.soilMoisture.length > 0) {
    try {
      charts.soilMoisture.setOption({
        series: [{ data: processedData.soilMoisture }]
      })
      console.log('土壤湿度图表更新成功')
    } catch (e) {
      console.error('更新土壤湿度图表失败:', e)
    }
  }
  
  if (charts.lightIntensity && processedData.lightIntensity.length > 0) {
    try {
      charts.lightIntensity.setOption({
        series: [{ data: processedData.lightIntensity }]
      })
      console.log('光照强度图表更新成功')
    } catch (e) {
      console.error('更新光照强度图表失败:', e)
    }
  }
  
  // 强制重绘所有图表
  Object.values(charts).forEach(chart => {
    if (chart) {
      try {
        chart.resize()
      } catch (e) {
        console.error('重绘图表失败:', e)
      }
    }
  })
}

// 添加标准化时间戳的函数
const normalizeTimestamp = (timestamp) => {
  // 确保时间戳是有效的
  if (!timestamp) return new Date().getTime();
  
  let timeValue;
  
  // 如果是数字，直接使用
  if (typeof timestamp === 'number') {
    timeValue = timestamp;
  }
  // 如果是字符串，尝试转换
  else if (typeof timestamp === 'string') {
    try {
      timeValue = new Date(timestamp).getTime();
      // 检查是否为有效日期
      if (isNaN(timeValue)) {
        timeValue = Date.now();
      }
    } catch (e) {
      timeValue = Date.now();
    }
  }
  // 如果是Date对象，获取时间戳
  else if (timestamp instanceof Date) {
    timeValue = timestamp.getTime();
  }
  // 其他情况，使用当前时间
  else {
    timeValue = Date.now();
  }
  
  return timeValue;
}

// 处理页面可见性变化时的数据更新
const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    // 检查缓存是否过期
    if (!chartDataCache.lastFetched || 
        Date.now() - chartDataCache.lastFetched > chartDataCache.cacheExpiration) {
      // 如果过期则刷新数据
      fetchData()
    }
  }
}

// 处理重试初始化图表的事件
const handleRetryInitCharts = () => {
  nextTick(() => {
    initSimpleCharts()
    if (chartData.value && chartData.value.length > 0) {
      updateCharts(chartData.value)
    }
  })
}

// 直接初始化图表，使用最简化的方式
const directInitCharts = () => {
  console.log('直接初始化图表...');
  
  // 强制销毁现有图表
    Object.values(charts).forEach(chart => {
      if (chart) {
        try {
        chart.dispose();
        } catch (e) {
        console.warn('销毁图表出错:', e);
      }
    }
  });
  
  // 清空引用
  charts = {
    temperature: null,
    humidity: null,
    soilMoisture: null,
    lightIntensity: null
  };
  
  try {
    // 定义公共主题配置
    const chartTheme = {
      // 全局调色板
      color: ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272'],
      
      // 背景渐变
      backgroundColor: {
        type: 'linear',
        x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [
          { offset: 0, color: 'rgba(255, 255, 255, 0.2)' },
          { offset: 1, color: 'rgba(248, 248, 255, 0.1)' }
        ]
      },
      
      // 坐标轴通用样式
      axisLine: {
        lineStyle: {
          width: 2,
          shadowColor: 'rgba(0, 0, 0, 0.2)',
          shadowBlur: 5,
          shadowOffsetX: 2,
          shadowOffsetY: 2
        }
      },
      
      // 网格线样式 - 增加留白空间
      grid: {
        left: '8%',
        right: '8%',
        top: '15%',
        bottom: '15%',
        containLabel: true
      }
    };
    
    // 温度图表 - 3D区域图
    charts.temperature = echarts.init(temperatureChart.value, null, {
      width: temperatureChart.value.clientWidth || 500,
      height: temperatureChart.value.clientHeight || 300,
      renderer: 'canvas' // 使用canvas渲染器以获得更好的性能
    });
    
    charts.temperature.setOption({
      ...chartTheme,
      title: {
        text: '温度变化趋势',
        textStyle: {
          fontWeight: 'bold',
          fontSize: 16,
          textShadow: '1px 1px 2px rgba(0,0,0,0.2)'
        },
        left: 'center'
      },
      tooltip: { 
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          label: {
            backgroundColor: '#6a7985'
          }
        },
        formatter: function(params) {
          const date = new Date(params[0].value[0]);
          const formattedTime = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
          let result = `<div style="font-weight:bold;margin-bottom:5px;">${formattedTime}</div>`;
          params.forEach(param => {
            result += `<div style="display:flex;align-items:center;margin:3px 0;">
              <span style="display:inline-block;width:10px;height:10px;background:${param.color};margin-right:5px;border-radius:50%;"></span>
              <span>${param.seriesName}: <span style="font-weight:bold;float:right;margin-left:15px;">${param.value[1].toFixed(1)}°C</span></span>
            </div>`;
          });
          return result;
        },
        backgroundColor: 'rgba(50,50,50,0.9)',
        borderColor: '#ccc',
        borderWidth: 1,
        padding: [5, 10],
        textStyle: {
          color: '#fff',
          fontSize: 13
        }
      },
      legend: {
        data: ['温度'],
        top: 30
      },
      xAxis: { 
        type: 'time',
        boundaryGap: false,
        axisLabel: {
          formatter: function(value) {
            const date = new Date(value);
            return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
          },
          interval: 'auto',
          rotate: 0,
          margin: 10,
          showMaxLabel: true,
          showMinLabel: true
        },
        axisTick: {
          alignWithLabel: true
        },
        splitLine: {
          show: false
        }
      },
      yAxis: {
        type: 'value',
        name: '温度 (°C)',
        nameLocation: 'middle',
        nameGap: 40,
        nameTextStyle: {
          fontWeight: 'bold'
        },
        axisLine: {
          show: true
        },
        axisLabel: {
          formatter: '{value}',
          margin: 10
        },
        splitLine: {
          show: true,
          lineStyle: {
            type: 'dashed'
          }
        },
        min: function(value) {
          return Math.floor(value.min - 5);
        },
        max: function(value) {
          return Math.ceil(value.max + 5);
        }
      },
      series: [{
        name: '温度',
        type: 'line',
        smooth: true,
        symbol: 'emptyCircle',
        symbolSize: 8,
        showSymbol: false,
        showAllSymbol: false,
        sampling: 'lttb',
        lineStyle: {
          width: 3,
          shadowColor: 'rgba(0,0,0,0.3)',
          shadowBlur: 10
        },
        areaStyle: {
          opacity: 0.8,
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{
              offset: 0, color: 'rgba(84, 112, 198, 0.8)'
            }, {
              offset: 1, color: 'rgba(84, 112, 198, 0.1)'
            }]
          }
        },
        emphasis: {
          focus: 'series',
          itemStyle: {
            borderWidth: 3
          }
        },
        data: []
      }]
    });
    
    // 湿度图表 - 渐变区域图
    charts.humidity = echarts.init(humidityChart.value, null, {
      width: humidityChart.value.clientWidth || 500,
      height: humidityChart.value.clientHeight || 300,
      renderer: 'canvas'
    });
    
    charts.humidity.setOption({
      ...chartTheme,
      title: {
        text: '湿度变化趋势',
        textStyle: {
          fontWeight: 'bold',
          fontSize: 16,
          textShadow: '1px 1px 2px rgba(0,0,0,0.2)'
        },
        left: 'center'
      },
      tooltip: { 
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          label: {
            backgroundColor: '#6a7985'
          }
        },
        formatter: function(params) {
          const date = new Date(params[0].value[0]);
          const formattedTime = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
          let result = `<div style="font-weight:bold;margin-bottom:5px;">${formattedTime}</div>`;
          params.forEach(param => {
            result += `<div style="display:flex;align-items:center;margin:3px 0;">
              <span style="display:inline-block;width:10px;height:10px;background:${param.color};margin-right:5px;border-radius:50%;"></span>
              <span>${param.seriesName}: <span style="font-weight:bold;float:right;margin-left:15px;">${param.value[1].toFixed(1)}%</span></span>
            </div>`;
          });
          return result;
        },
        backgroundColor: 'rgba(50,50,50,0.9)',
        borderColor: '#ccc',
        borderWidth: 1,
        padding: [5, 10],
        textStyle: {
          color: '#fff',
          fontSize: 13
        }
      },
      legend: {
        data: ['湿度'],
        top: 30
      },
      xAxis: {
        type: 'time',
        boundaryGap: false,
        axisLabel: {
          formatter: function(value) {
            const date = new Date(value);
            return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
          },
          interval: 'auto',
          rotate: 0,
          margin: 10,
          showMaxLabel: true,
          showMinLabel: true
        },
        axisTick: {
          alignWithLabel: true
        },
        splitLine: {
          show: false
        }
      },
      yAxis: { 
        type: 'value', 
        name: '湿度 (%)',
        nameLocation: 'middle',
        nameGap: 40,
        nameTextStyle: {
          fontWeight: 'bold'
        },
        axisLine: {
          show: true
        },
        axisLabel: {
          formatter: '{value}',
          margin: 10
        },
        splitLine: {
          show: true,
          lineStyle: {
            type: 'dashed'
          }
        },
        min: function(value) {
          return Math.floor(value.min - 5);
        },
        max: function(value) {
          return Math.ceil(value.max + 5);
        }
      },
      series: [{ 
        name: '湿度',
        type: 'line', 
        smooth: true,
        symbol: 'emptyCircle',
        symbolSize: 8,
        showSymbol: false,
        showAllSymbol: false,
        sampling: 'lttb',
        lineStyle: {
          width: 3,
          shadowColor: 'rgba(0,0,0,0.3)',
          shadowBlur: 10
        },
        areaStyle: {
          opacity: 0.8,
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{
              offset: 0, color: 'rgba(145, 204, 117, 0.8)'
            }, {
              offset: 1, color: 'rgba(145, 204, 117, 0.1)'
            }]
          }
        },
        emphasis: {
          focus: 'series',
          itemStyle: {
            borderWidth: 3
          }
        },
        data: []
      }]
    });
    
    // 土壤湿度图表 - 具有层次感的柱状图
    charts.soilMoisture = echarts.init(soilMoistureChart.value, null, {
      width: soilMoistureChart.value.clientWidth || 500,
      height: soilMoistureChart.value.clientHeight || 300,
      renderer: 'canvas'
    });
    
    charts.soilMoisture.setOption({
      ...chartTheme,
      title: {
        text: '土壤湿度变化趋势',
        textStyle: {
          fontWeight: 'bold',
          fontSize: 16,
          textShadow: '1px 1px 2px rgba(0,0,0,0.2)'
        },
        left: 'center'
      },
      tooltip: { 
        trigger: 'axis',
        axisPointer: {
          type: 'shadow'
        },
        formatter: function(params) {
          const date = new Date(params[0].value[0]);
          const formattedTime = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
          let result = `<div style="font-weight:bold;margin-bottom:5px;">${formattedTime}</div>`;
          params.forEach(param => {
            result += `<div style="display:flex;align-items:center;margin:3px 0;">
              <span style="display:inline-block;width:10px;height:10px;background:${param.color};margin-right:5px;border-radius:50%;"></span>
              <span>${param.seriesName}: <span style="font-weight:bold;float:right;margin-left:15px;">${param.value[1].toFixed(1)}%</span></span>
            </div>`;
          });
          return result;
        },
        backgroundColor: 'rgba(50,50,50,0.9)',
        borderColor: '#ccc',
        borderWidth: 1,
        padding: [5, 10],
        textStyle: {
          color: '#fff',
          fontSize: 13
        }
      },
      legend: {
        data: ['土壤湿度'],
        top: 30
      },
      xAxis: {
        type: 'time',
        axisLabel: {
          formatter: function(value) {
            const date = new Date(value);
            return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
          },
          interval: 'auto',
          rotate: 0,
          margin: 10,
          showMaxLabel: true,
          showMinLabel: true
        },
        axisTick: {
          alignWithLabel: true
        },
        splitLine: {
          show: false
        }
      },
      yAxis: {
        type: 'value',
        name: '土壤湿度 (%)',
        nameLocation: 'middle',
        nameGap: 40,
        nameTextStyle: {
          fontWeight: 'bold'
        },
        axisLine: {
          show: true
        },
        axisLabel: {
          formatter: '{value}',
          margin: 10
        },
        splitLine: {
          show: true,
          lineStyle: {
            type: 'dashed'
          }
        },
        min: function(value) {
          return Math.floor(value.min - 5);
        },
        max: function(value) {
          return Math.ceil(value.max + 5);
        }
      },
      series: [{
        name: '土壤湿度',
        type: 'bar',
        barWidth: '60%',
        showBackground: true,
        backgroundStyle: {
          color: 'rgba(220, 220, 220, 0.3)'
        },
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#83bff6' },
            { offset: 0.5, color: '#188df0' },
            { offset: 1, color: '#188df0' }
          ]),
          borderRadius: [4, 4, 0, 0],
          shadowColor: 'rgba(0, 0, 0, 0.3)',
          shadowBlur: 10
        },
        emphasis: {
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: '#2378f7' },
              { offset: 0.7, color: '#2378f7' },
              { offset: 1, color: '#83bff6' }
            ])
          }
        },
        data: []
      }]
    });
    
    // 光照强度图表 - 丰富的折线图
    charts.lightIntensity = echarts.init(lightIntensityChart.value, null, {
      width: lightIntensityChart.value.clientWidth || 500,
      height: lightIntensityChart.value.clientHeight || 300,
      renderer: 'canvas'
    });
    
    charts.lightIntensity.setOption({
      ...chartTheme,
      title: {
        text: '光照强度变化趋势',
        textStyle: {
          fontWeight: 'bold',
          fontSize: 16,
          textShadow: '1px 1px 2px rgba(0,0,0,0.2)'
        },
        left: 'center'
      },
      tooltip: { 
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          label: {
            backgroundColor: '#6a7985'
          }
        },
        formatter: function(params) {
          const date = new Date(params[0].value[0]);
          const formattedTime = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
          let result = `<div style="font-weight:bold;margin-bottom:5px;">${formattedTime}</div>`;
          params.forEach(param => {
            result += `<div style="display:flex;align-items:center;margin:3px 0;">
              <span style="display:inline-block;width:10px;height:10px;background:${param.color};margin-right:5px;border-radius:50%;"></span>
              <span>${param.seriesName}: <span style="font-weight:bold;float:right;margin-left:15px;">${param.value[1].toFixed(0)} lux</span></span>
            </div>`;
          });
          return result;
        },
        backgroundColor: 'rgba(50,50,50,0.9)',
        borderColor: '#ccc',
        borderWidth: 1,
        padding: [5, 10],
        textStyle: {
          color: '#fff',
          fontSize: 13
        }
      },
      legend: {
        data: ['光照强度'],
        top: 30
      },
      xAxis: {
        type: 'time',
        boundaryGap: false,
        axisLabel: {
          formatter: function(value) {
            const date = new Date(value);
            return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
          },
          interval: 'auto',
          rotate: 0,
          margin: 10,
          showMaxLabel: true,
          showMinLabel: true
        },
        axisTick: {
          alignWithLabel: true
        },
        splitLine: {
          show: false
        }
      },
      yAxis: {
        type: 'value',
        name: '光照强度 (lux)',
        nameLocation: 'middle',
        nameGap: 40,
        nameTextStyle: {
          fontWeight: 'bold'
        },
        axisLine: {
          show: true
        },
        axisLabel: {
          formatter: '{value}',
          margin: 10
        },
        splitLine: {
          show: true,
          lineStyle: {
            type: 'dashed'
          }
        },
        min: function(value) {
          return Math.floor(value.min - 200);
        },
        max: function(value) {
          return Math.ceil(value.max + 200);
        }
      },
      series: [{
        name: '光照强度',
        type: 'line',
        smooth: true,
        symbol: 'diamond',
        symbolSize: 10,
        showSymbol: false,
        showAllSymbol: false,
        sampling: 'lttb',
        lineStyle: {
          width: 3,
          color: '#fac858',
          shadowColor: 'rgba(0,0,0,0.3)',
          shadowBlur: 10
        },
        areaStyle: {
          opacity: 0.8,
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{
              offset: 0, color: 'rgba(250, 200, 88, 0.8)'
            }, {
              offset: 1, color: 'rgba(250, 200, 88, 0.1)'
            }]
          }
        },
        emphasis: {
          focus: 'series',
          itemStyle: {
            borderWidth: 3
          }
        },
        markPoint: {
          data: [
            { type: 'max', name: '最大值' },
            { type: 'min', name: '最小值' }
          ]
        },
        data: []
      }]
    });
    
    console.log('直接初始化3D增强图表成功');
    
    // 如果有数据，立即更新图表
    if (chartData.value && chartData.value.length > 0) {
      updateCharts(chartData.value);
    }
  } catch (e) {
    console.error('直接初始化图表失败:', e);
  }
};

onMounted(() => {
  console.log('数据分析组件挂载...');
  
  // 添加页面可见性变化监听
  document.addEventListener('visibilitychange', handleVisibilityChange);
  
  // 监听重试初始化图表的事件
  window.addEventListener('retry-init-charts', handleRetryInitCharts);
  
  // 最简直接初始化，移除所有复杂逻辑
  // 使用两层延时确保DOM完全渲染
    setTimeout(() => {
    // 首先确保加载数据
    fetchData();
    
    // 然后延时初始化图表
    setTimeout(() => {
      directInitCharts();
      
      // 强制再次更新一次
      if (chartData.value && chartData.value.length > 0) {
        updateCharts(chartData.value);
      }
    }, 500);
  }, 300);
});

// 在组件卸载时清理资源
onUnmounted(() => {
  // 移除监听
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('retry-init-charts', handleRetryInitCharts)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  
  // 清理MutationObserver
  if (window._chartObserver) {
    window._chartObserver.disconnect()
    window._chartObserver = null
  }
  
  // 清理图表实例，避免内存泄漏
  Object.values(charts).forEach(chart => {
    if (chart) {
      try {
        chart.dispose()
      } catch (e) {
        // 忽略错误
      }
    }
  })
  charts = {} // 清空引用
})

// 添加window全局resize事件处理
window.addEventListener('resize', () => {
  Object.values(charts).forEach(chart => {
    if (chart) {
      try {
        chart.resize();
      } catch (e) {
        console.warn('图表resize出错:', e);
      }
    }
  });
});
</script>

<style scoped>
.data-analysis {
  padding: 20px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.title-section {
  display: flex;
  align-items: center;
}

.demo-tag {
  margin-left: 10px;
}

.title {
  font-size: 16px;
  font-weight: bold;
}

.subtitle {
  margin-left: 10px;
  font-size: 0.9em;
  color: #909399;
}

.header-actions {
  margin-left: auto;
}

.charts-container {
  margin-top: 20px;
}

.chart-wrapper {
  background: linear-gradient(to bottom, #ffffff, #f5f7fa);
  padding: 20px;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  width: 100%;
  height: 380px;
  transition: all 0.3s ease;
}

.chart-wrapper:hover {
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.chart-inner {
  width: 100%;
  height: 340px;
  border-radius: 4px;
  overflow: hidden;
}

.data-summary {
  margin-top: 20px;
  padding: 20px;
  background: linear-gradient(to right, #f8f9fa, #eef2f6);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.05);
}

.summary-title {
  font-weight: bold;
  margin-bottom: 15px;
  font-size: 18px;
  color: #303133;
  border-bottom: 2px solid #ebeef5;
  padding-bottom: 10px;
}

.summary-content {
  font-size: 14px;
  color: #606266;
}

.summary-item {
  margin-bottom: 10px;
  background: rgba(255, 255, 255, 0.6);
  padding: 8px 12px;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}
</style> 