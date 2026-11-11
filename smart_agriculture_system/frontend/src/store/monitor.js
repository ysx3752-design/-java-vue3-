import { defineStore } from 'pinia'
import { getSensorData } from '@/api/monitor'
import { ElMessage } from 'element-plus'

// 安全解析数值
function safeParseFloat(value, defaultValue = 0) {
  if (value === undefined || value === null) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

function safeParseInt(value, defaultValue = 0) {
  if (value === undefined || value === null) return defaultValue;
  const parsed = parseInt(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

// 确保数组
function ensureArray(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data.data && Array.isArray(data.data)) return data.data;
  return [];
}

export const useMonitorStore = defineStore('monitor', {
  state: () => ({
    realTimeData: {
      air_temperature: 0,
      air_humidity: 0,
      soil_temperature: 0,
      soil_moisture: 0,
      light_intensity: 0,
      co2_concentration: 0,
      // 兼容旧版前端显示使用的键名
      temperature: 0,
      humidity: 0,
      co2_level: 0
    },
    historyData: [],
    lastUpdateTime: null,
    loading: false,
    error: null,
    updateInterval: null,
    // 订阅式刷新的引用计数：多个页面同时监听时共用一个轮询
    subscribers: 0,
    // 数据来源（realtime = 虚拟仿真平台实时读取，cache/database = 回退数据）
    source: ''
  }),

  getters: {
    formattedLastUpdateTime: (state) => {
      if (!state.lastUpdateTime) return '暂无数据'
      return new Date(state.lastUpdateTime).toLocaleString()
    },
    // 简化版时间，用于实时条上的紧凑显示
    shortLastUpdateTime: (state) => {
      if (!state.lastUpdateTime) return '--:--:--'
      return new Date(state.lastUpdateTime).toLocaleTimeString('zh-CN', { hour12: false })
    },
    // 数据是否新鲜（15 秒内有更新）
    isFresh: (state) => {
      if (!state.lastUpdateTime) return false
      return Date.now() - new Date(state.lastUpdateTime).getTime() < 15000
    },
    // 数据来源的中文描述
    sourceLabel: (state) => {
      if (state.source === 'realtime') return '虚拟仿真平台'
      if (state.source === 'database' || state.source === 'cache') return '数据库缓存'
      return state.source ? state.source : '未获取'
    }
  },

  actions: {
    // 获取实时数据，不显示加载状态
    async fetchRealTimeData() {
      try {
        const response = await getSensorData()
        if (!response || response.error) {
          throw new Error(response?.error || '获取数据失败')
        }
        
        // 处理从虚拟平台获取的数据
        const sensorData = response.data || response || {}
        
        // 确保数据类型转换正确，使用kv_wsn标准的数据格式
        // 确保数值不超出合理范围
        this.realTimeData = {
          // 后端原始数据
          air_temperature: safeParseFloat(sensorData.air_temperature),
          air_humidity: safeParseFloat(sensorData.air_humidity),
          soil_temperature: safeParseFloat(sensorData.soil_temperature),
          soil_moisture: safeParseFloat(sensorData.soil_moisture),
          light_intensity: safeParseInt(sensorData.light_intensity),
          co2_concentration: safeParseInt(sensorData.co2_concentration),
          
          // 前端显示使用的键名
          temperature: safeParseFloat(sensorData.air_temperature || sensorData.temperature),
          humidity: safeParseFloat(sensorData.air_humidity || sensorData.humidity),
          co2_level: safeParseInt(sensorData.co2_concentration || sensorData.co2_level)
        }
        
        // 打印接收到的数据，用于调试
        console.log("接收到的传感器数据:", sensorData)
        console.log("处理后的显示数据:", this.realTimeData)
        
        this.lastUpdateTime = new Date()
        this.source = response.source || ''
        this.error = null
      } catch (error) {
        console.error('获取实时数据失败:', error)
        this.error = error.message || '获取实时数据失败'
      }
    },

    // 获取历史数据，显示加载状态
    async fetchHistoryData(params) {
      try {
        this.loading = true
        const response = await getSensorData({
          ...params,
          noLoading: false // 显示加载遮罩
        })
        
        if (!response) {
          throw new Error('未收到响应数据')
        }
        
        if (response.error) {
          throw new Error(response.error)
        }
        
        // 确保历史数据是数组格式
        const data = ensureArray(response.data || response);
        
        // 确保每个数据项的值都是有效的数字
        this.historyData = data.map(item => {
          if (!item) return null;
          
          return {
            timestamp: item.timestamp,
            air_temperature: safeParseFloat(item.air_temperature),
            air_humidity: safeParseFloat(item.air_humidity),
            soil_temperature: safeParseFloat(item.soil_temperature),
            soil_moisture: safeParseFloat(item.soil_moisture),
            light_intensity: safeParseInt(item.light_intensity),
            co2_concentration: safeParseInt(item.co2_concentration),
            
            // 兼容性字段
            temperature: safeParseFloat(item.air_temperature || item.temperature),
            humidity: safeParseFloat(item.air_humidity || item.humidity),
            co2_level: safeParseInt(item.co2_concentration || item.co2_level)
          };
        }).filter(item => item !== null);
        
        this.error = null
      } catch (error) {
        console.error('获取历史数据失败:', error)
        this.error = error.message || '获取历史数据失败'
        ElMessage.error(this.error)
        this.historyData = []
      } finally {
        this.loading = false
      }
    },

    startRealTimeUpdate(interval = 10000) {  // 设定轮询间隔为10秒
      // 先清除可能存在的定时器
      this.stopRealTimeUpdate()
      
      // 立即获取一次数据
      this.fetchRealTimeData()
      
      // 设置定时获取数据
      this.updateInterval = setInterval(() => {
        this.fetchRealTimeData()
      }, interval)
    },

    /**
     * 订阅实时数据（页面进入时调用）。
     * 多个页面同时订阅只保留一个轮询定时器，间隔取调用方传入值。
     */
    acquireRealtime(interval = 5000) {
      this.subscribers += 1
      if (this.updateInterval) {
        return
      }
      this.fetchRealTimeData()
      this.updateInterval = setInterval(() => {
        this.fetchRealTimeData()
      }, interval)
    },

    /**
     * 取消订阅（页面离开时调用），最后一个订阅者退出后停止轮询。
     */
    releaseRealtime() {
      this.subscribers = Math.max(0, this.subscribers - 1)
      if (this.subscribers === 0) {
        this.stopRealTimeUpdate()
      }
    },

    stopRealTimeUpdate() {
      if (this.updateInterval) {
        clearInterval(this.updateInterval)
        this.updateInterval = null
      }
    },

    // 导出数据
    async exportData(params) {
      try {
        this.loading = true
        const response = await getSensorData({
          ...params,
          export: true,
          responseType: 'blob'
        })
        
        // 处理后端返回的文件流
        if (response instanceof Blob) {
          // 如果直接返回了Blob对象
          const url = window.URL.createObjectURL(response)
          this.downloadFile(url, `sensor-data-${new Date().toISOString().slice(0,10)}.csv`)
          return
        }
        
        if (!response || (!response.data && !Array.isArray(response))) {
          throw new Error('未收到可导出的数据')
        }
        
        // 如果返回了JSON数据，我们将其转换为CSV格式
        const exportData = ensureArray(response.data || response)
        
        if (exportData.length === 0) {
          throw new Error('导出数据为空')
        }
        
        // 创建CSV内容
        const headers = Object.keys(exportData[0]).join(',')
        const rows = exportData.map(item => {
          return Object.values(item).join(',')
        })
        const csvContent = [headers, ...rows].join('\n')
        
        // 创建下载链接
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = window.URL.createObjectURL(blob)
        this.downloadFile(url, `sensor-data-${new Date().toISOString().slice(0,10)}.csv`)
        
        ElMessage.success('数据导出成功')
      } catch (error) {
        console.error('导出数据失败:', error)
        ElMessage.error(error.message || '导出数据失败')
      } finally {
        this.loading = false
      }
    },

    // 辅助方法：下载文件
    downloadFile(url, fileName) {
      const link = document.createElement('a')
      link.href = url
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    }
  }
})