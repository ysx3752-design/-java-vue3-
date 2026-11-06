<template>
  <div class="dashboard-container">
    <!-- 顶部操作-->
    <div class="dashboard-header">
      <h2 class="dashboard-title">智能农业监控系统</h2>
      <el-button type="primary" :loading="loading" @click="loadDashboardData" class="refresh-button">
        <el-icon class="refresh-icon"><Refresh /></el-icon> 刷新数据
      </el-button>
    </div>
    
    <!-- 数据概览卡片 -->
    <el-row :gutter="20">
      <el-col :span="6" v-for="(card, index) in dataCards" :key="card.title" class="card-item" :style="{ animationDelay: `${index * 0.1}s` }">
        <el-card shadow="hover" class="data-card">
          <template #header>
            <div class="card-header">
              <el-icon class="card-icon"><component :is="card.icon" /></el-icon>
              <span>{{ card.title }}</span>
            </div>
          </template>
          <div class="card-content">
            <span class="value">{{ card.value }}</span>
            <span class="trend" :class="{ 'up': card.trend > 0, 'down': card.trend < 0 }" v-if="card.trend !== undefined">
              {{ card.trend > 0 ? '+' : '' }}{{ card.trend }}%
            </span>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 图表区域 -->
    <el-row :gutter="20" class="chart-row">
      <el-col :span="16" class="chart-col">
        <el-card shadow="hover" class="chart-card">
          <template #header>
            <div class="card-header">
              <span>24小时温湿度趋势</span>
              <div class="chart-actions">
                <el-tooltip content="刷新图表" placement="top">
                  <el-button size="small" circle @click="refreshTempChart" :loading="chartLoading">
                    <el-icon><Refresh /></el-icon>
                  </el-button>
                </el-tooltip>
              </div>
            </div>
          </template>
          <v-chart class="chart" :option="tempHumidityChartOption" :autoresize="true" />
        </el-card>
      </el-col>
      
      <el-col :span="8" class="chart-col">
        <el-card shadow="hover" class="chart-card">
          <template #header>
            <div class="card-header">
              <span>设备状态分布</span>
            </div>
          </template>
          <v-chart class="chart" :option="deviceStatusChartOption" :autoresize="true" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 最近警报列表 -->
    <el-card shadow="hover" class="alert-list">
      <template #header>
        <div class="card-header">
          <span>最近警报</span>
          <el-button type="text" @click="viewAllAlerts" class="view-all-btn">查看全部</el-button>
        </div>
      </template>
      <el-table :data="recentAlerts" style="width: 100%" v-loading="tableLoading">
        <el-table-column prop="time" label="时间" width="180" />
        <el-table-column prop="type" label="类型" width="120">
          <template #default="scope">
            <div class="alert-type">
              <el-icon class="alert-icon" :class="getAlertTypeClass(scope.row.type)">
                <Warning v-if="scope.row.type.includes('温度') || scope.row.type.includes('湿度')" />
                <CircleClose v-else-if="scope.row.type.includes('离线')" />
                <InfoFilled v-else />
              </el-icon>
              <span>{{ scope.row.type }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" />
        <el-table-column prop="status" label="状态" width="120">
          <template #default="scope">
            <el-tag :type="getAlertStatusType(scope.row.status)" effect="light">
              {{ scope.row.status }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import {
  CanvasRenderer
} from 'echarts/renderers'
import {
  LineChart,
  PieChart
} from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent
} from 'echarts/components'
import { getDashboardData, getTempHumidityTrend, calculateTrend } from '@/api/dashboard'
import { ElMessage } from 'element-plus'

// 注册必要的 ECharts 组件
use([
  CanvasRenderer,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent
])

const router = useRouter()

// 获取需要的图标组件
const { Sunrise, Cloudy, Bell, Monitor, Refresh, Warning, InfoFilled, CircleClose } = ElementPlusIconsVue

// 实时数据
const temperature = ref(25.6)
const temperatureTrend = ref(2.1)
const humidity = ref(65)
const humidityTrend = ref(-1.5)
const alertCount = ref(3)
const alertTrend = ref(50)
const onlineDevices = ref(8)
const totalDevices = ref(10)
const loading = ref(false)
const chartLoading = ref(false)
const tableLoading = ref(false)

// 最近警报数组
const recentAlerts = ref([
  {
    time: '2024-01-20 10:30:00',
    type: '温度异常',
    description: '温室1号温度过高',
    status: '已处理'
  },
  {
    time: '2024-01-20 09:15:00',
    type: '湿度异常',
    description: '温室2号湿度过高',
    status: '处理中'
  },
  {
    time: '2024-01-20 08:45:00',
    type: '设备离线',
    description: '灌溉系统离线',
    status: '未处理'
  }
])

// 数据卡片配置，使用响应式数据
const dataCards = computed(() => [
  {
    title: '平均温度',
    value: `${temperature.value}°C`,
    trend: temperatureTrend.value,
    icon: 'Sunrise'
  },
  {
    title: '平均湿度',
    value: `${humidity.value}%`,
    trend: humidityTrend.value,
    icon: 'Cloudy'
  },
  {
    title: '今日警报',
    value: alertCount.value,
    trend: alertTrend.value,
    icon: 'Bell'
  },
  {
    title: '设备在线',
    value: `${onlineDevices.value}/${totalDevices.value}`,
    trend: undefined,
    icon: 'Monitor'
  }
])

// 获取警报类型对应的类
const getAlertTypeClass = (type) => {
  if (type.includes('温度')) return 'temp-alert'
  if (type.includes('湿度')) return 'humidity-alert'
  if (type.includes('离线')) return 'offline-alert'
  return 'other-alert'
}

// 单独刷新温湿度图表
const refreshTempChart = async () => {
  chartLoading.value = true
  try {
    const trendData = await getTempHumidityTrend()
    if (trendData && trendData.times) {
      // 使用nextTick确保DOM更新后再更新图表
      await nextTick()
      tempHumidityChartOption.value = {
        ...tempHumidityChartOption.value,
        xAxis: {
          ...tempHumidityChartOption.value.xAxis,
          data: trendData.times
        },
        series: [
          {
            name: '温度',
            type: 'line',
            data: trendData.temperatures,
            smooth: true,
            showSymbol: false,
            lineStyle: {
              width: 3,
              shadowColor: 'rgba(0, 0, 0, 0.2)',
              shadowBlur: 10
            },
            itemStyle: {
              color: '#f56c6c'
            },
            areaStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(245, 108, 108, 0.5)' },
                  { offset: 1, color: 'rgba(245, 108, 108, 0.1)' }
                ]
              }
            }
          },
          {
            name: '湿度',
            type: 'line',
            yAxisIndex: 1,
            data: trendData.humidities,
            smooth: true,
            showSymbol: false,
            lineStyle: {
              width: 3,
              shadowColor: 'rgba(0, 0, 0, 0.2)',
              shadowBlur: 10
            },
            itemStyle: {
              color: '#409EFF'
            },
            areaStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: 'rgba(64, 158, 255, 0.5)' },
                  { offset: 1, color: 'rgba(64, 158, 255, 0.1)' }
                ]
              }
            }
          }
        ]
      }
      
      ElMessage.success({
        message: '图表数据已更新',
        duration: 2000
      })
    }
  } catch (error) {
    console.error('刷新图表数据失败:', error)
    ElMessage.error('刷新图表数据失败')
  } finally {
    chartLoading.value = false
  }
}

// 加载仪表盘数据
const loadDashboardData = async () => {
  loading.value = true
  
  // 分开加载不同部分的数据，防止一个数据加载失败影响整体
  const promises = []
  
  // 加载仪表板基本数据
  promises.push(
    (async () => {
      try {
        const dashboardData = await getDashboardData()
        
        // 更新传感器数据
        if (dashboardData.sensorData && !dashboardData.error) {
          temperature.value = parseFloat(dashboardData.sensorData.air_temperature || 25.6).toFixed(1)
          humidity.value = parseFloat(dashboardData.sensorData.air_humidity || 65).toFixed(0)
        }
        
        // 更新设备状态
        if (dashboardData.connectionStatus) {
          totalDevices.value = dashboardData.connectionStatus.totalDevices || 10
          onlineDevices.value = dashboardData.connectionStatus.connectedDevices || 8
        }
        
        // 更新警报数据
        if (Array.isArray(dashboardData.alerts)) {
          tableLoading.value = true
          setTimeout(() => {
            recentAlerts.value = dashboardData.alerts
            alertCount.value = dashboardData.alerts.filter(alert => alert.status === '未处理').length
            tableLoading.value = false
          }, 300)
        }
      } catch (error) {
        console.error('加载仪表盘基本数据失败', error)
      }
    })()
  )
  
  // 加载温湿度趋势图表
  promises.push(
    (async () => {
      chartLoading.value = true
      try {
        const trendData = await getTempHumidityTrend()
        if (trendData && trendData.times) {
          // 使用nextTick确保DOM更新后再更新图表
          await nextTick()
          tempHumidityChartOption.value = {
            ...tempHumidityChartOption.value,
            xAxis: {
              ...tempHumidityChartOption.value.xAxis,
              data: trendData.times
            },
            series: [
              {
                name: '温度',
                type: 'line',
                data: trendData.temperatures,
                smooth: true,
                showSymbol: false,
                lineStyle: {
                  width: 3,
                  shadowColor: 'rgba(0, 0, 0, 0.2)',
                  shadowBlur: 10
                },
                itemStyle: {
                  color: '#f56c6c'
                },
                areaStyle: {
                  color: {
                    type: 'linear',
                    x: 0,
                    y: 0,
                    x2: 0,
                    y2: 1,
                    colorStops: [
                      { offset: 0, color: 'rgba(245, 108, 108, 0.5)' },
                      { offset: 1, color: 'rgba(245, 108, 108, 0.1)' }
                    ]
                  }
                }
              },
              {
                name: '湿度',
                type: 'line',
                yAxisIndex: 1,
                data: trendData.humidities,
                smooth: true,
                showSymbol: false,
                lineStyle: {
                  width: 3,
                  shadowColor: 'rgba(0, 0, 0, 0.2)',
                  shadowBlur: 10
                },
                itemStyle: {
                  color: '#409EFF'
                },
                areaStyle: {
                  color: {
                    type: 'linear',
                    x: 0,
                    y: 0,
                    x2: 0,
                    y2: 1,
                    colorStops: [
                      { offset: 0, color: 'rgba(64, 158, 255, 0.5)' },
                      { offset: 1, color: 'rgba(64, 158, 255, 0.1)' }
                    ]
                  }
                }
              }
            ]
          }
          
          // 计算趋势
          if (trendData.temperatures && trendData.temperatures.length > 1) {
            const lastIndex = trendData.temperatures.length - 1
            const prevIndex = lastIndex - 1
            temperatureTrend.value = ((trendData.temperatures[lastIndex] - trendData.temperatures[prevIndex]) / trendData.temperatures[prevIndex] * 100).toFixed(1)
            humidityTrend.value = ((trendData.humidities[lastIndex] - trendData.humidities[prevIndex]) / trendData.humidities[prevIndex] * 100).toFixed(1)
          }
        }
      } catch (error) {
        console.error('加载温湿度趋势数据失败', error)
      } finally {
        chartLoading.value = false
      }
    })()
  )
  
  // 等待所有任务完成
  await Promise.allSettled(promises)
  loading.value = false
}

// 页面加载时获取数据
onMounted(() => {
  // 使用nextTick确保DOM已完全渲染
  nextTick(() => {
    loadDashboardData()
    
    // 设置定时刷新，每10秒刷新一次
    const refreshInterval = setInterval(() => {
      loadDashboardData()
    }, 10000)
    
    // 组件卸载时清除定时器
    return () => clearInterval(refreshInterval)
  })
})

// 获取警报状态对应的标签类型
const getAlertStatusType = (status) => {
  const types = {
    '已处理': 'success',
    '处理中': 'warning',
    '未处理': 'danger'
  }
  return types[status] || 'info'
}

// 查看所有警报
const viewAllAlerts = () => {
  router.push('/alerts')
}

// 温湿度趋势图配置
const tempHumidityChartOption = ref({
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'cross',
      label: {
        backgroundColor: '#6a7985'
      }
    }
  },
  legend: {
    data: ['温度', '湿度'],
    textStyle: {
      color: '#606266'
    }
  },
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    containLabel: true
  },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'],
    axisLine: {
      lineStyle: {
        color: '#DCDFE6'
      }
    },
    axisTick: {
      show: false
    }
  },
  yAxis: [
    {
      type: 'value',
      name: '温度(°C)',
      min: 0,
      max: 40,
      axisLine: {
        show: true,
        lineStyle: {
          color: '#DCDFE6'
        }
      },
      splitLine: {
        lineStyle: {
          color: '#EBEEF5'
        }
      }
    },
    {
      type: 'value',
      name: '湿度(%)',
      min: 0,
      max: 100,
      axisLine: {
        show: true,
        lineStyle: {
          color: '#DCDFE6'
        }
      },
      splitLine: {
        lineStyle: {
          color: '#EBEEF5'
        }
      }
    }
  ],
  series: [
    {
      name: '温度',
      type: 'line',
      data: [23, 24, 25, 26, 27, 28, 26, 25],
      smooth: true,
      showSymbol: false,
      lineStyle: {
        width: 3,
        shadowColor: 'rgba(0, 0, 0, 0.2)',
        shadowBlur: 10
      },
      itemStyle: {
        color: '#f56c6c'
      },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(245, 108, 108, 0.5)' },
            { offset: 1, color: 'rgba(245, 108, 108, 0.1)' }
          ]
        }
      }
    },
    {
      name: '湿度',
      type: 'line',
      yAxisIndex: 1,
      data: [60, 62, 65, 63, 58, 55, 58, 62],
      smooth: true,
      showSymbol: false,
      lineStyle: {
        width: 3,
        shadowColor: 'rgba(0, 0, 0, 0.2)',
        shadowBlur: 10
      },
      itemStyle: {
        color: '#409EFF'
      },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(64, 158, 255, 0.5)' },
            { offset: 1, color: 'rgba(64, 158, 255, 0.1)' }
          ]
        }
      }
    }
  ]
})

// 设备状态分布图配置
const deviceStatusChartOption = computed(() => ({
  tooltip: {
    trigger: 'item',
    formatter: '{a} <br/>{b}: {c} ({d}%)'
  },
  legend: {
    orient: 'vertical',
    left: 'left',
    textStyle: {
      color: '#606266'
    }
  },
  series: [
    {
      name: '设备状态分布',
      type: 'pie',
      radius: ['50%', '70%'],
      avoidLabelOverlap: false,
      itemStyle: {
        borderRadius: 10,
        borderColor: '#fff',
        borderWidth: 2
      },
      label: {
        show: false,
        position: 'center'
      },
      emphasis: {
        label: {
          show: true,
          fontSize: 16,
          fontWeight: 'bold'
        },
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      },
      labelLine: {
        show: false
      },
      data: [
        { value: onlineDevices.value, name: '在线', itemStyle: { color: '#67C23A' } },
        { value: totalDevices.value - onlineDevices.value, name: '离线', itemStyle: { color: '#909399' } }
      ]
    }
  ]
}))
</script>

<style lang="scss" scoped>
.dashboard-container {
  padding: 20px;

  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    
    .dashboard-title {
      margin: 0;
      color: #303133;
      font-size: 22px;
      font-weight: 600;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }
    
    .refresh-button {
      transition: all 0.3s;
      
      .refresh-icon {
        transition: transform 0.4s ease;
      }
      
      &:hover .refresh-icon {
        transform: rotate(180deg);
      }
    }
  }
  
  .card-item {
    animation: card-fade-in 0.5s ease-out forwards;
    opacity: 0;
    transform: translateY(20px);
  }
  
  @keyframes card-fade-in {
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .data-card {
    .card-header {
      display: flex;
      align-items: center;
      
      .card-icon {
        margin-right: 8px;
        font-size: 20px;
        color: #409EFF;
        filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.15));
        transition: all 0.3s;
      }
    }

    .card-content {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding: 10px 0;

      .value {
        font-size: 28px;
        font-weight: bold;
        color: #303133;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
      }

      .trend {
        font-size: 14px;
        padding: 2px 8px;
        border-radius: 12px;
        transition: all 0.3s;
        
        &.up {
          color: #fff;
          background-color: rgba(245, 108, 108, 0.8);
        }
        
        &.down {
          color: #fff;
          background-color: rgba(103, 194, 58, 0.8);
        }
      }
    }
    
    &:hover {
      .card-icon {
        transform: scale(1.1);
      }
    }
  }

  .chart-row {
    margin-top: 20px;
  }
  
  .chart-col {
    transition: all 0.3s;
  }

  .chart-card {
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      
      .chart-actions {
        display: flex;
        gap: 8px;
      }
    }
  }

  .chart {
    height: 400px;
    width: 100%;
    transition: all 0.3s;
  }

  .alert-list {
    margin-top: 20px;

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      
      .view-all-btn {
        transition: all 0.3s;
        
        &:hover {
          transform: translateX(3px);
        }
      }
    }
    
    .alert-type {
      display: flex;
      align-items: center;
      
      .alert-icon {
        margin-right: 5px;
        
        &.temp-alert {
          color: #f56c6c;
        }
        
        &.humidity-alert {
          color: #409EFF;
        }
        
        &.offline-alert {
          color: #909399;
        }
        
        &.other-alert {
          color: #E6A23C;
        }
      }
    }
  }
}
</style> 
