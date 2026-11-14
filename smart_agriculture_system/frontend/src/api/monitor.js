import request from '@/utils/request'

// 获取实时传感器数据
export function getSensorData(params = {}) {
  if (params.export) {
    // 导出数据请求
    return request({
      url: '/api/export/sensor-data',
      method: 'get',
      params,
      responseType: 'blob'
    })
  }
  
  // 根据是否有历史数据参数来决定调用哪个接口
  if (params.start_time && params.end_time) {
    // 获取历史数据
    return request({
      url: '/api/history/sensor-data',
      method: 'get',
      params
    })
  }
  
  // 获取实时数据
  return request({
    url: '/api/sensor-data',
    method: 'get'
  })
}

// 获取历史数据 - 独立API
export function getHistoryData(params) {
  return request({
    url: '/api/history/sensor-data',
    method: 'get',
    params
  })
}

// 获取时间段内的完整历史记录（不分页，用于趋势图）
export function getHistoryRange(params, { signal } = {}) {
  return request({
    url: '/api/history/data',
    method: 'get',
    signal,
    params
  })
}

// 获取统计数据
export function getStatistics(params) {
  return request({
    url: '/api/history/statistics',
    method: 'get',
    params
  })
}

// 获取设备状态
export function getDeviceStatus() {
  return request({
    url: '/api/device/status',
    method: 'get'
  })
}

// 获取阈值设置
export function getThresholds() {
  return request({
    url: '/thresholds',
    method: 'get'
  })
}

// 更新阈值设置
export function updateThresholds(thresholds) {
  return request({
    url: '/thresholds',
    method: 'post',
    data: { thresholds }
  })
}

// 获取连接状态
export function getConnectionStatus() {
  return request({
    url: '/connection-status',
    method: 'get'
  })
}

// 获取系统状态
export function getSystemStatus() {
  return request({
    url: '/system/status',
    method: 'get'
  })
}

// 获取警报列表
export function getAlerts(params) {
  return request({
    url: '/monitor/alerts',
    method: 'get',
    params
  })
}

// 确认警报
export function acknowledgeAlert(alertId) {
  return request({
    url: `/monitor/alerts/${alertId}/acknowledge`,
    method: 'post'
  })
}

// 导出数据 - 独立API
export function exportData(params) {
  return request({
    url: '/api/export/sensor-data',
    method: 'get',
    params,
    responseType: 'blob'
  })
}
