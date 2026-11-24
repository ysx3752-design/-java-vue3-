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
// ===== 演示用假数据开关 =====
// 真实采样只覆盖部分小时，其余小时是空档，趋势图会断成一截一截。
// 演示/答辩阶段打开此开关：空档按昼夜自然规律补假数据，并与真实片段平滑衔接；
// 需要恢复「只画真实数据」时改回 false 即可，真实数据的计算逻辑不受影响。
const TREND_MOCK_FILL = true

// 假数据基线：温度 14 点最高约 28.5 ℃、凌晨 2 点最低约 22.5 ℃；
// 湿度与此反相，下午最低约 40 %、清晨最高约 60 %。
const MOCK_TEMP = h => 25.5 + 3.0 * Math.cos(((h - 14) / 24) * Math.PI * 2)
const MOCK_HUM = h => 50 - 10 * Math.cos(((h - 15) / 24) * Math.PI * 2)

// 某小时槽（起点 left，跨度 1 小时）中心时刻的假数据
const mockAt = left => {
  const center = new Date(left + 30 * 60 * 1000)
  const h = center.getHours() + center.getMinutes() / 60
  return {
    temp: Number(MOCK_TEMP(h).toFixed(1)),
    hum: Number(MOCK_HUM(h).toFixed(1))
  }
}

// 把 values 里的空档（null）用假数据补齐。
// 每段连续空档做线性「桥接」：偏移量从左端真实值平滑过渡到右端真实值，
// 保证假数据与真实片段在交界处不跳变；两端都没有真实值时用纯假数据基线。
const fillWithMock = (values, mockValues) => {
  const out = values.slice()
  let i = 0
  while (i < out.length) {
    if (out[i] !== null) { i++; continue }
    let j = i
    while (j + 1 < out.length && out[j + 1] === null) j++
    const leftOffset = i > 0 && out[i - 1] !== null ? out[i - 1] - mockValues[i - 1] : null
    const rightOffset = j + 1 < out.length && out[j + 1] !== null ? out[j + 1] - mockValues[j + 1] : null
    for (let k = i; k <= j; k++) {
      let offset = 0
      if (leftOffset !== null && rightOffset !== null) {
        offset = leftOffset + (rightOffset - leftOffset) * ((k - i + 1) / (j - i + 2))
      } else if (leftOffset !== null) offset = leftOffset
      else if (rightOffset !== null) offset = rightOffset
      out[k] = Number((mockValues[k] + offset).toFixed(1))
    }
    i = j + 1
  }
  return out
}

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
    const mockTemps = []
    const mockHums = []
    for (let i = 0; i < slotCount; i++) {
      const left = start + i * HOUR
      const time = new Date(left)
      times.push(`${String(time.getHours()).padStart(2, '0')}:00`)
      buckets.push({ left, right: left + HOUR, records: [] })
      const mock = mockAt(left)
      mockTemps.push(mock.temp)
      mockHums.push(mock.hum)
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

    if (!TREND_MOCK_FILL) {
      return { times, temperatures, humidities }
    }
    return {
      times,
      temperatures: fillWithMock(temperatures, mockTemps),
      humidities: fillWithMock(humidities, mockHums)
    }
  }).catch(error => {
    console.error('获取温湿度趋势数据失败:', error)

    // 请求失败：演示开关打开时仍给出完整假数据曲线，避免页面开天窗
    if (TREND_MOCK_FILL) {
      const HOUR = 60 * 60 * 1000
      const slotCount = 24
      const end = new Date()
      end.setMinutes(0, 0, 0)
      const start = end.getTime() - (slotCount - 1) * HOUR
      const times = []
      const temperatures = []
      const humidities = []
      for (let i = 0; i < slotCount; i++) {
        const left = start + i * HOUR
        const time = new Date(left)
        times.push(`${String(time.getHours()).padStart(2, '0')}:00`)
        const mock = mockAt(left)
        temperatures.push(mock.temp)
        humidities.push(mock.hum)
      }
      return { times, temperatures, humidities }
    }
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