import request from '@/utils/request'

// 获取设备列表
export function getDevices() {
  return request({
    url: '/api/device/devices',
    method: 'get'
  })
}

// 获取设备连接状态
export function getConnectionStatus() {
  return request({
    url: '/api/device/connection-status',
    method: 'get',
    // 连接状态属于可降级信息：短超时、不重试、不弹全局错误提示，
    // 避免网关离线时控制面板被拖到 30 秒超时并满屏报错
    timeout: 5000,
    retry: 0,
    silent: true
  }).then(response => {
    // 处理响应数据，确保格式一致
    return {
      status: response.status || (response.connected ? 'connected' : 'disconnected'),
      message: response.message || (response.connected ? '已连接' : '未连接'),
      totalDevices: response.total_devices ?? 0,
      connectedDevices: response.connected_devices ?? 0,
      connecting: Boolean(response.connecting),
      lastCommunication: response.last_communication || null
    }
  }).catch(error => {
    console.error('获取设备连接状态失败:', error)
    // 返回默认断开连接状态
    return {
      status: 'disconnected',
      message: '连接失败: ' + (error.message || '未知错误'),
      totalDevices: 0,
      connectedDevices: 0,
      connecting: false,
      lastCommunication: null
    }
  })
}

// 请求设备连接
export function connectDevice() {
  console.log('请求设备连接')
  return request({
    url: '/api/device/connect',
    method: 'post'
  }).then(response => {
    return {
      status: response.status || 'unknown',
      message: response.message || '连接状态未知',
      connected: response.connected || false
    }
  }).catch(error => {
    console.error('连接设备失败:', error)
    return {
      status: 'error',
      message: '连接失败: ' + (error.message || '未知错误'),
      connected: false
    }
  })
}

// 断开设备连接
export function disconnectDevice() {
  console.log('请求断开设备连接')
  return request({
    url: '/api/device/disconnect',
    method: 'post'
  }).then(response => {
    return {
      status: response.status || 'unknown',
      message: response.message || '断开连接状态未知'
    }
  }).catch(error => {
    console.error('断开设备连接失败:', error)
    return {
      status: 'error',
      message: '断开连接失败: ' + (error.message || '未知错误')
    }
  })
}

// 控制设备
export function controlDevice(deviceType, action) {
  console.log('控制设备:', deviceType, action)
  
  // 根据设备类型获取友好名称
  const deviceNames = {
    'external_fan': '外通风',
    'internal_fan': '内通风',
    'skylight': '天窗',
    'spray': '喷灌',
    'water_curtain': '水帘',
    'light': '灯光'
  };
  
  const deviceName = deviceNames[deviceType] || deviceType;
  
  // 将open/close转换为前端显示的开启/关闭文本
  const actionText = action === 'open' ? '开启' : '关闭';
  
  return request({
    url: '/api/device/control',
    method: 'post',
    data: {
      device_type: deviceType,
      action: action
    }
  }).then(response => {
    // 返回统一格式的响应
    return {
      success: response.success !== undefined ? response.success : true,
      message: response.message || `设备 ${deviceName} ${actionText} 成功`,
      data: response
    };
  }).catch(error => {
    console.error('控制设备失败:', error);
    
    // 从错误响应中提取信息
    const errorMessage = error.response?.data?.message || 
                        error.response?.data?.error || 
                        error.message || 
                        '未知错误';
    
    return {
      success: false,
      message: `设备 ${deviceName} ${actionText} 失败: ${errorMessage}`,
      error: error
    };
  });
}

// 获取传感器数据
export function getSensorData(params) {
  return request({
    url: '/api/device/public/sensor-data',
    method: 'get',
    params,
    noLoading: true
  }).then(response => {
    // 处理可能的不同响应格式
    if (response.data) {
      return response.data;
    }
    return response;
  }).catch(error => {
    console.error('获取传感器数据失败:', error);
    // 返回默认空数据
    return {
      air_temperature: 0,
      air_humidity: 0,
      soil_temperature: 0,
      soil_moisture: 0,
      light_intensity: 0,
      co2_concentration: 0,
      error: error.message || '获取传感器数据失败'
    };
  });
}

// 获取设备状态
export function getDeviceStatus() {
  return request({
    url: '/api/device/status',
    method: 'get'
  }).then(response => {
    // 处理不同的响应格式
    if (Array.isArray(response)) {
      return { devices: response };
    } else if (response.devices) {
      return response;
    } else {
      // 如果响应格式不符合预期，转换为统一格式
      return { devices: [] };
    }
  }).catch(error => {
    console.error('获取设备状态失败:', error);
    return { devices: [], error: error.message || '获取设备状态失败' };
  });
}