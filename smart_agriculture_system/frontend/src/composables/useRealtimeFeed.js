import { onMounted, onActivated, onDeactivated, onUnmounted } from 'vue'
import { useMonitorStore } from '@/store/monitor'

/**
 * 页面级实时数据订阅。
 *
 * 由于 Layout 使用 keep-alive 缓存页面，这里同时挂载 onMounted / onActivated
 * 并在 onDeactivated / onUnmounted 时释放，保证切换页面后不会留下空闲轮询。
 * store 内部按引用计数管理，多个页面共用同一个定时器。
 *
 * @param {number} interval 轮询间隔（毫秒），默认 5 秒
 * @returns 监控 store 实例
 */
export function useRealtimeFeed(interval = 5000) {
  const store = useMonitorStore()
  let active = false

  const start = () => {
    if (active) return
    active = true
    store.acquireRealtime(interval)
  }

  const stop = () => {
    if (!active) return
    active = false
    store.releaseRealtime()
  }

  onMounted(start)
  onActivated(start)
  onDeactivated(stop)
  onUnmounted(stop)

  return store
}

/** 指标定义，环境监测 / 设备控制 / 报警管理三处共用 */
export const METRIC_LIST = [
  { key: 'temperature', rawKey: 'air_temperature', label: '空气温度', unit: '°C', decimals: 1, icon: 'Sunrise' },
  { key: 'humidity', rawKey: 'air_humidity', label: '空气湿度', unit: '%', decimals: 1, icon: 'Cloudy' },
  { key: 'soil_temperature', rawKey: 'soil_temperature', label: '土壤温度', unit: '°C', decimals: 1, icon: 'Sunrise' },
  { key: 'soil_moisture', rawKey: 'soil_moisture', label: '土壤湿度', unit: '%', decimals: 1, icon: 'Cloudy' },
  { key: 'light_intensity', rawKey: 'light_intensity', label: '光照强度', unit: 'lux', decimals: 0, icon: 'Sunny' },
  { key: 'co2_level', rawKey: 'co2_concentration', label: 'CO₂ 浓度', unit: 'ppm', decimals: 0, icon: 'Cloudy' }
]
