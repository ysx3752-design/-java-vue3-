import axios from 'axios'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/store/user'
import router from '@/router'

// 是否正在刷新token
let isRefreshing = false
// 请求队列，存储等待刷新token的请求
let requests = []

// 安全地处理响应
function safelyProcessResponse(response) {
  if (!response) return { success: false, message: '无响应数据' };
  
  // 如果是Blob类型，直接返回
  if (response instanceof Blob) return response;
  
  // 如果已经是数组，直接返回（适用于图表数据）
  if (Array.isArray(response)) return response;
  
  // 如果是对象，检查是否包含标准格式的数据字段
  if (typeof response === 'object') {
    // 检查是否有标准的data字段
    if (response.data !== undefined) {
      // 如果data是数组，可能是图表数据，直接返回数组
      if (Array.isArray(response.data)) {
        return response.data;
      }
      // 其他情况返回完整对象
      return response;
    }
    
    // 检查是否有其他常见的数据字段
    if (Array.isArray(response.records)) return response.records;
    if (Array.isArray(response.items)) return response.items;
    if (Array.isArray(response.results)) return response.results;
    
    // 如果对象包含传感器数据的关键字段，转为单元素数组
    if (response.timestamp || 
        response.air_temperature !== undefined || 
        response.air_humidity !== undefined || 
        response.soil_moisture !== undefined || 
        response.soil_temperature !== undefined ||
        response.light_intensity !== undefined) {
      return [response];
    }
    
    // 默认返回对象本身
    return response;
  }
  
  // 尝试解析JSON字符串
  if (typeof response === 'string') {
    try {
      const parsed = JSON.parse(response);
      // 对解析后的结果递归调用本函数
      return safelyProcessResponse(parsed);
    } catch (e) {
      return { data: response };
    }
  }
  
  return response;
}

// 创建axios实例
const service = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 30000,
  withCredentials: false,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  },
  // 添加重试配置
  retry: 3,
  retryDelay: 1000
})

// 请求拦截器
service.interceptors.request.use(
  config => {
    // 添加认证头
    const token = localStorage.getItem('access_token')
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }
    
    // 确保POST请求有数据体，避免空请求
    if (config.method?.toLowerCase() === 'post' && !config.data) {
      config.data = {}
    }
    
    // 添加时间戳防止缓存
    if (config.method?.toLowerCase() === 'get') {
      config.params = {
        ...config.params,
        _t: Date.now()
      }
    }
    
    // 只在开发环境打印请求信息
    if (import.meta.env.DEV) {
      console.log(`发送请求: ${config.method?.toUpperCase() || 'GET'} ${config.url}`)
      if (token) {
        console.log('使用token:', token.substring(0, 20) + '...')
      }
    }
    
    return config
  },
  error => {
    console.error('Request error:', error)
    return Promise.reject(error)
  }
)

// 响应拦截器
service.interceptors.response.use(
  response => {
    try {
      // 只在开发环境打印响应信息
      if (import.meta.env.DEV) {
        console.log(`接收响应: ${response.config.method?.toUpperCase() || 'GET'} ${response.config.url}`)
      }
      
      // 处理空响应
      if (response.data === undefined || response.data === null || response.data === '') {
        return { success: true, message: '操作成功' }
      }
      
      // 安全处理响应数据
      const processedData = safelyProcessResponse(response.data);
      
      // 只在开发环境打印数据类型信息
      if (import.meta.env.DEV) {
        console.log('处理后的响应数据类型:', Array.isArray(processedData) ? 'Array' : typeof processedData);
        if (Array.isArray(processedData)) {
          console.log('数组长度:', processedData.length);
        }
      }
      
      return processedData;
    } catch (error) {
      console.error('响应处理错误:', error)
      return response.data || { success: true, message: '操作成功但响应处理出错' }
    }
  },
  async error => {
    const { config, response } = error
    
    // 如果配置了重试，并且是网络错误或5xx错误
    if (config && config.retry && (!response || response.status >= 500)) {
      config.__retryCount = config.__retryCount || 0
      
      if (config.__retryCount < config.retry) {
        config.__retryCount += 1
        console.log(`请求重试 (${config.__retryCount}/${config.retry}):`, config.url)
        
        // 延迟重试
        await new Promise(resolve => setTimeout(resolve, config.retryDelay || 1000))
        return service(config)
      }
    }
    
    console.error('Response error:', error)
    
    if (response) {
      console.error(`响应错误状态: ${response.status}`, response.data)
    } else if (error.request) {
      console.error('请求已发送但未收到响应', error.request)
    } else {
      console.error('请求配置错误', error.message)
    }
    
    try {
      const userStore = useUserStore()
      // 轮询类/可降级接口可传 silent 或 noErrorNotification，避免后台抖动时反复弹全局错误提示
      const silent = Boolean(config && (config.silent || config.noErrorNotification))
      const notify = (message) => {
        if (!silent) ElMessage.error(message)
      }

      if (response) {
        switch (response.status) {
          case 401:
            notify('未授权或登录已过期，请重新登录')
            try {
              await userStore.logout()
            } catch (logoutError) {
              console.error('注销时出错:', logoutError)
              localStorage.removeItem('access_token')
              localStorage.removeItem('userInfo')
              router.push('/login')
            }
            break
          case 403:
            notify('没有权限访问')
            break
          case 404:
            notify('请求的资源不存在')
            break
          case 500:
            notify('服务器错误')
            break
          default:
            if (error.message?.includes('Network Error')) {
              notify('网络错误，请检查服务器是否运行')
            } else if (error.message?.includes('timeout')) {
              notify('请求超时，服务器响应时间过长')
            } else {
              notify(response.data?.error || '未知错误')
            }
        }
      } else {
        if (error.message?.includes('Network Error')) {
          notify('网络错误，请检查服务器是否运行')
        } else if (error.message?.includes('timeout')) {
          notify('请求超时，服务器响应时间过长')
        } else {
          notify('网络错误，请检查您的网络连接')
        }
      }
    } catch (handlerError) {
      console.error('错误处理时发生异常:', handlerError)
      if (!(config && (config.silent || config.noErrorNotification))) {
        ElMessage.error('请求出错')
      }
    }
    
    if (response?.status === 401) {
      return Promise.reject({ isAuthError: true, ...error })
    }
    
    return Promise.reject(error)
  }
)

export default service