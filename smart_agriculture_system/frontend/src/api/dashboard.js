import request from '@/utils/request'
import { getSensorData } from './sensor'
import { getDeviceStatus, getConnectionStatus } from './device'

// 安全地检查数组
function ensureArray(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (data.data && Array.isArray(data.data)) return data.data;
  return [];
}

/**
 * 获取仪表盘所需的所有数据
 * 包括：传感器数据、设备状态、警报信息
 */
export function getDashboardData() {
  // 用 allSettled：任何一项失败（例如网关离线导致连接状态拿不到）都不影响其余数据展示
  return Promise.allSettled([
    getSensorData(),
    getDeviceStatus(),
    getAlerts(),
    getConnectionStatus()
  ]).then(([sensorResult, deviceResult, alertResult, connectionResult]) => {
    const pick = (result, fallback) => (result.status === 'fulfilled' && result.value !== undefined ? result.value : fallback)
    return {
      sensorData: pick(sensorResult, null),
      deviceStatus: pick(deviceResult, { devices: [] }),
      alerts: ensureArray(pick(alertResult, [])),
      connectionStatus: pick(connectionResult, null)
    }
  })
}

/**
 * 获取24小时温湿度趋势数据
 */
export function getTempHumidityTrend() {
  return request({
    url: '/api/history/data',
    method: 'get',
    params: {
      start_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      end_date: new Date().toISOString()
    }
  }).then(response => {
    // 处理数据，按时间间隔分组
    const data = ensureArray(response);
    
    // 如果没有数据，返回空曲线，不生成模拟数据
    if (data.length === 0) {
      return { times: [], temperatures: [], humidities: [] }
    }
    
    // 将24小时数据分为8个时间点
    const timePoints = 8
    const timeInterval = 24 / timePoints
    const now = new Date()
    const times = []
    const temperatures = []
    const humidities = []
    
    // 创建时间点
    for (let i = 0; i < timePoints; i++) {
      const time = new Date(now.getTime() - (timePoints - i - 1) * timeInterval * 60 * 60 * 1000)
      times.push(time.getHours().toString().padStart(2, '0') + ':00')
    }
    
    // 对每个时间点，找到最接近的数据
    for (let i = 0; i < timePoints; i++) {
      const targetTime = new Date(now.getTime() - (timePoints - i - 1) * timeInterval * 60 * 60 * 1000)
      
      // 找到最接近目标时间的数据点
      let closestData = null
      let minTimeDiff = Infinity
      
      for (const record of data) {
        if (!record || !record.timestamp) continue;
        
        try {
          const recordTime = new Date(record.timestamp)
          const timeDiff = Math.abs(recordTime.getTime() - targetTime.getTime())
          
          if (timeDiff < minTimeDiff) {
            minTimeDiff = timeDiff
            closestData = record
          }
        } catch (e) {
          console.error('处理记录时间出错:', e, record);
          continue;
        }
      }
      
      // 添加数据，如果没有找到则使用默认值
      temperatures.push(closestData ? parseFloat(closestData.air_temperature || closestData.temperature || 25) : 25)
      humidities.push(closestData ? parseFloat(closestData.air_humidity || closestData.humidity || 60) : 60)
    }
    
    return { times, temperatures, humidities }
  }).catch(error => {
    console.error('获取温湿度趋势数据失败:', error)

    // 失败时返回空曲线，不生成模拟数据
    return { times: [], temperatures: [], humidities: [] }
  })
}

/**
 * 获取最近警报
 */
export function getAlerts(limit = 5) {
  return request({
    url: '/api/alerts/recent',
    method: 'get',
    params: { limit }
  }).then(response => {
    return ensureArray(response);
  }).catch(error => {
    console.error('获取警报数据失败:', error)

    // 失败时返回空列表，不生成模拟数据
    return []
  })
}

/**
 * 计算传感器数据的变化趋势百分比
 * @param {Object} currentData 当前数据
 * @param {Object} previousData 前一时间点数据
 * @param {String} field 字段名
 * @returns {Number} 变化百分比
 */
export function calculateTrend(currentData, previousData, field) {
  if (!currentData || !previousData) return 0
  
  const current = parseFloat(currentData[field]);
  const previous = parseFloat(previousData[field]);
  
  if (isNaN(current) || isNaN(previous) || previous === 0) return 0
  
  return parseFloat(((current - previous) / previous * 100).toFixed(1))
}