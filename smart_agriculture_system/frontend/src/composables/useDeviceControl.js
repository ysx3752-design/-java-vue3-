import { ref, computed, onMounted, onActivated, onDeactivated, onUnmounted } from 'vue'
import { getDeviceStatus, getConnectionStatus, controlDevice } from '@/api/device'

const DEVICE_NAMES = {
  external_shade: '外遮阳', internal_shade: '内遮阳', external_fan: '外通风',
  internal_fan: '内通风', skylight: '天窗', spray: '喷灌', water_curtain: '水帘', light: '灯光'
}
const normalizeStatus = value => {
  if ([1, '1', true, 'open', 'active', 'on'].includes(value)) return 1
  if ([0, '0', false, 'close', 'inactive', 'off'].includes(value)) return 0
  return null
}

// 两种视图共用一个设备快照和轮询，控制完成前不启动新的状态读取。
export function useDeviceControl(interval = 8000) {
  const devices = ref(Object.entries(DEVICE_NAMES).map(([type, name]) => ({ type, name, status: null })))
  const connection = ref({ status: 'disconnected', message: '检查中...' })
  const pending = ref({})
  const refreshing = ref(false)
  const error = ref('')
  const connected = computed(() => connection.value.status === 'connected')
  const busy = computed(() => Object.keys(pending.value).length > 0)
  const disabled = computed(() => !connected.value || busy.value || refreshing.value || !!error.value)
  let active = false
  let disposed = false
  let timer = null
  let inFlight = null
  let generation = 0

  const refresh = () => {
    if (inFlight) return inFlight
    if (busy.value || disposed) return Promise.resolve()
    refreshing.value = true
    inFlight = (async () => {
      try {
        const [info, result] = await Promise.all([getConnectionStatus(), getDeviceStatus()])
        if (disposed) return
        connection.value = info
        if (result.error) throw new Error(result.error)
        const list = result.devices || []
        devices.value = devices.value.map(device => {
          const latest = list.find(item => item.type === device.type)
          return { ...device, description: latest?.description || '', status: normalizeStatus(latest?.status) }
        })
        error.value = list.length ? '' : '暂无可用的设备状态'
      } catch (cause) {
        if (!disposed) error.value = cause.message || '获取设备状态失败'
      } finally {
        refreshing.value = false
        inFlight = null
      }
    })()
    return inFlight
  }

  const control = async (type, action) => {
    const device = devices.value.find(item => item.type === type)
    if (disabled.value || !device || device.status === null || !['open', 'close'].includes(action)) return null
    pending.value = { [type]: action }
    try {
      const result = await controlDevice(type, action)
      if (!result.success) throw new Error(result.message || '设备控制失败')
      // 请求完成前不乐观修改设备动画或开关，使用服务端返回的状态。
      const status = normalizeStatus(result.data?.status?.status)
      if (!disposed && status !== null) device.status = status
      return result
    } finally {
      pending.value = {}
      await refresh()
    }
  }

  const poll = async token => {
    await refresh()
    if (active && token === generation) timer = setTimeout(() => poll(token), interval)
  }
  const start = () => {
    if (active || disposed) return
    active = true
    poll(++generation)
  }
  const stop = () => {
    active = false
    generation += 1
    clearTimeout(timer)
    timer = null
  }
  onMounted(start)
  onActivated(start)
  onDeactivated(stop)
  onUnmounted(() => { disposed = true; stop() })
  return { devices, connection, pending, refreshing, connected, disabled, error, refresh, control }
}
