<template>
  <section class="inspector" role="dialog" aria-modal="false" :aria-label="item.title" @pointerdown.stop @wheel.stop>
    <header>
      <strong>{{ item.title }}</strong>
      <button class="close" aria-label="关闭详情" @click="emit('close')">×</button>
    </header>
    <template v-if="item.kind === 'device'">
      <div class="device-summary">
        <span class="state" :class="{ on: isDeviceOn(devices[item.deviceKey]) }">{{ deviceStateText(item.deviceKey, devices[item.deviceKey]) }}</span>
        <span v-if="pending[item.deviceKey]" class="subtle">指令执行中…</span>
      </div>
      <div class="actions">
        <button v-for="action in ['open', 'close']" :key="action" :class="{ primary: action === 'open' }"
          :disabled="disabled || devices[item.deviceKey] == null || isDeviceOn(devices[item.deviceKey]) === (action === 'open')"
          @click="emit('control', item.deviceKey, action)">{{ deviceActionText(item.deviceKey, action) }}</button>
      </div>
      <p class="subtle">{{ !connected ? '控制器离线，暂不可操作' : disabled ? '正在同步状态或执行操作，请稍候' : '操作结果由控制器接口返回' }}</p>
    </template>
    <template v-else>
      <div class="history-toolbar">
        <select v-model="metricKey" aria-label="历史指标">
          <option v-for="metric in metrics" :key="metric.key" :value="metric.key">{{ metric.label }}</option>
        </select>
        <select v-model="hours" aria-label="历史时间范围">
          <option :value="1">近1小时</option><option :value="6">近6小时</option><option :value="24">近24小时</option>
        </select>
      </div>
      <div class="current"><span class="subtle">当前</span> {{ format(environment[metricKey]) }} <small>{{ metric.unit }}</small></div>
      <div v-if="loading" class="chart-message" role="status">正在读取历史数据…</div>
      <div v-else-if="historyError" class="chart-message" role="alert">{{ historyError }} <button @click="loadHistory">重试</button></div>
      <div v-else-if="!points.length" class="chart-message">该时段暂无有效历史数据</div>
      <template v-else>
        <svg class="history-chart" viewBox="0 0 220 62" role="img" :aria-label="`${metric.label}历史趋势，共${points.length}条记录`">
          <path d="M4 15H216 M4 40H216 M4 58H216" class="chart-grid" />
          <path :d="chartPath" class="chart-line" />
          <circle v-if="points.length === 1" cx="110" cy="31" r="3" fill="#3d7965" />
        </svg>
        <div class="history-summary"><span>最低 {{ format(minimum) }}</span><span>最高 {{ format(maximum) }} {{ metric.unit }}</span></div>
        <div class="history-summary subtle"><span>{{ timeText(points[0].time) }}</span><span>{{ timeText(points.at(-1).time) }}</span></div>
      </template>
    </template>
  </section>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { getHistoryRange } from '@/api/monitor'
import { isDeviceOn, deviceStateText, deviceActionText } from '@/utils/devicePresentation'

const props = defineProps({
  item: { type: Object, required: true }, environment: { type: Object, required: true },
  devices: { type: Object, required: true }, pending: { type: Object, default: () => ({}) },
  disabled: Boolean, connected: Boolean
})
const emit = defineEmits(['control', 'close'])
const SENSOR_METRICS = {
  'sensor-air': [{ key: 'air_temperature', label: '空气温度', unit: '℃', digits: 1 }, { key: 'air_humidity', label: '空气湿度', unit: '%', digits: 1 }],
  'sensor-soil': [{ key: 'soil_temperature', label: '土壤温度', unit: '℃', digits: 1 }, { key: 'soil_moisture', label: '土壤湿度', unit: '%', digits: 1 }],
  'sensor-light': [{ key: 'light_intensity', label: '光照强度', unit: 'lx', digits: 0 }],
  'sensor-co2': [{ key: 'co2_concentration', label: 'CO₂浓度', unit: 'ppm', digits: 0 }]
}
const metrics = computed(() => SENSOR_METRICS[props.item.id] || [])
const metricKey = ref('')
const metric = computed(() => metrics.value.find(m => m.key === metricKey.value) || metrics.value[0] || {})
const hours = ref(6)
const rows = ref([])
const loading = ref(false)
const historyError = ref('')
let requestId = 0
let controller = null
const points = computed(() => rows.value.flatMap(row => {
  const raw = row[metricKey.value]
  const time = new Date(row.timestamp).getTime()
  return raw != null && raw !== '' && Number.isFinite(Number(raw)) && Number.isFinite(time)
    ? [{ time, value: Number(raw) }] : []
}).sort((a, b) => a.time - b.time))
const minimum = computed(() => Math.min(...points.value.map(p => p.value)))
const maximum = computed(() => Math.max(...points.value.map(p => p.value)))
const chartPath = computed(() => {
  const values = points.value
  if (!values.length) return ''
  const span = maximum.value - minimum.value || 1
  const duration = values.at(-1).time - values[0].time || 1
  // 最多120个绘图点，统计值仍使用整个时间段的数据。
  const step = Math.max(1, Math.ceil(values.length / 120))
  return values.filter((_, i) => i % step === 0 || i === values.length - 1).map((p, i) => {
    const x = values.length === 1 ? 110 : 4 + (p.time - values[0].time) / duration * 212
    const y = maximum.value === minimum.value ? 31 : 55 - (p.value - minimum.value) / span * 48
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
})
const format = value => value == null || value === '' || !Number.isFinite(Number(value)) ? '--' : Number(value).toFixed(metric.value.digits || 0)
const timeText = value => new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
const loadHistory = async () => {
  controller?.abort()
  const id = ++requestId
  rows.value = []
  historyError.value = ''
  if (props.item.kind !== 'sensor' || !metricKey.value) { loading.value = false; return }
  controller = new AbortController()
  loading.value = true
  try {
    const end = new Date()
    const result = await getHistoryRange({ start_date: new Date(end.getTime() - hours.value * 3600000).toISOString(), end_date: end.toISOString(), metric: metricKey.value }, { signal: controller.signal })
    if (id !== requestId) return
    const records = Array.isArray(result) ? result : result?.data
    if (!Array.isArray(records)) throw new Error('历史数据格式异常')
    rows.value = records
  } catch (cause) {
    if (id === requestId && cause.code !== 'ERR_CANCELED') historyError.value = '历史数据读取失败'
  } finally {
    if (id === requestId) loading.value = false
  }
}
watch(() => props.item.id, () => { metricKey.value = metrics.value[0]?.key || '' }, { immediate: true, flush: 'sync' })
watch([metricKey, hours, () => props.item.id], loadHistory, { immediate: true })
onBeforeUnmount(() => { requestId++; controller?.abort() })
</script>

<style scoped>
.inspector { font-size: 12px; color: #30433d; padding: 10px; background: #fbfcf8; border: 1px solid #93ab9a;
  border-radius: 4px; box-shadow: 0 4px 18px #263d3424; box-sizing: border-box; max-height: 230px; overflow: auto; }
header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
button, select { font: inherit; color: inherit; cursor: pointer; border: 1px solid #c4d0c4; border-radius: 3px; background: #f5f8f0; padding: 5px 8px; }
button:disabled { opacity: .48; cursor: not-allowed; }
button:focus-visible, select:focus-visible { outline: 2px solid #3d7965; outline-offset: 2px; }
.close { border: 0; background: none; font-size: 20px; padding: 0 3px; line-height: 20px; }
.device-summary, .actions, .history-toolbar, .history-summary { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.actions { margin-top: 10px; } .actions button { flex: 1; } .primary { color: white; background: #3d7965; border-color: #3d7965; }
.state { color: #7a847b; } .state.on { color: #36785a; } .subtle { font-size: 10px; color: #778578; }
p { margin: 8px 0 0; line-height: 1.4; }
.history-toolbar select { min-width: 0; max-width: 60%; padding: 4px 2px; font-size: 11px; }
.current { margin-top: 7px; font: 600 17px monospace; } .current small { font-size: 11px; }
.history-chart { display: block; width: 100%; height: 62px; margin: 3px 0; }
.chart-grid { fill: none; stroke: #e2e8de; stroke-width: 1; }
.chart-line { fill: none; stroke: #3d7965; stroke-width: 2; stroke-linecap: round; }
.chart-message { min-height: 70px; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 11px; }
.history-summary { margin-top: 3px; font-size: 10px; }
</style>
