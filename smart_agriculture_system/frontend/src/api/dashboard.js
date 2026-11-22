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
    getConnectionStatus(),
    // 卡片口径是「今日警报」：只要当天新增的警报（含已处理），
    // 不传 scope 拿到的是全部未处理数（历史累计，会显示成两千多）
    request({ url: '/api/alerts/count', method: 'get', params: { scope: 'today' } })
  ]).then(([sensorResult, deviceResult, alertResult, connectionResult, countResult]) => {
    const pick = (result, fallback) => (result.status === 'fulfilled' && result.value !== undefined ? result.value : fallback)
    return {
      sensorData: pick(sensorResult, null),
      deviceStatus: pick(deviceResult, { devices: [] }),
      alerts: ensureArray(pick(alertResult, [])),
      alertCount: countResult.status === 'fulfilled' ? countResult.value?.count : null,
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

    // 24 个小时槽，槽边界对齐整点。
    // 早期用 8 个 3 小时的大槽：只有几小时数据时，全部样本会被合并进同一个槽，
    // 图上只剩最右侧一个孤立的点，看起来就像「曲线全没了」。
    const HOUR = 60 * 60 * 1000
    const slotCount = 24
    const end = new Date()
    end.setMinutes(0, 0, 0)
    const start = end.getTime() - (slotCount - 1) * HOUR

    const numeric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
    const buckets = []
    const times = []
    for (let i = 0; i < slotCount; i++) {
      const left = start + i * HOUR
      const time = new Date(left)
      times.push(`${String(time.getHours()).padStart(2, '0')}:00`)
      buckets.push({ left, right: left + HOUR, records: [] })
    }

    for (const record of data) {
      const timestamp = new Date(record?.timestamp).getTime()
      if (!Number.isFinite(timestamp)) continue
      const bucket = buckets.find(item => timestamp >= item.left && timestamp < item.right)
      if (bucket) bucket.records.push(record)
    }

    const temperatures = []
    const humidities = []
    for (const bucket of buckets) {
      const average = (key, alias) => {
        const values = bucket.records.map(record => numeric(record[key] ?? record[alias])).filter(value => value !== null)
        return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)) : null
      }
      temperatures.push(average('air_temperature', 'temperature'))
      humidities.push(average('air_humidity', 'humidity'))
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