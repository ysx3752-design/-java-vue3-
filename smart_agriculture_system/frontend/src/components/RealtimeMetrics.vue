<!-- 实时环境数据条：可嵌入任意页面，自身负责订阅与释放轮询 -->
<template>
  <el-card shadow="hover" class="realtime-metrics">
    <div class="rt-head">
      <div class="rt-left">
        <span class="rt-dot" :class="{ stale: !isFresh }"></span>
        <span class="rt-title">{{ title }}</span>
        <span class="rt-sub">{{ isFresh ? `每 ${intervalLabel} 秒自动刷新` : '数据可能已过期' }}</span>
      </div>
      <div class="rt-right">
        <el-tag size="small" :type="source === 'realtime' ? 'success' : 'info'" effect="plain" class="rt-source">
          {{ sourceLabel }}
        </el-tag>
        <span class="rt-time">更新于 {{ shortLastUpdateTime }}</span>
      </div>
    </div>

    <div class="rt-grid">
      <div
        v-for="m in METRIC_LIST"
        :key="m.key"
        class="rt-item"
        :class="[`rt-${m.key}`, { flash: flashKey === m.key }]"
      >
        <div class="rt-label">{{ m.label }}</div>
        <div class="rt-value">
          <span class="rt-num">{{ display(m) }}</span>
          <span class="rt-unit">{{ m.unit }}</span>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { useRealtimeFeed, METRIC_LIST } from '@/composables/useRealtimeFeed'

const props = defineProps({
  title: { type: String, default: '实时环境数据' },
  interval: { type: Number, default: 5000 }
})

const store = useRealtimeFeed(props.interval)

const isFresh = computed(() => store.isFresh)
const source = computed(() => store.source)
const sourceLabel = computed(() => store.sourceLabel)
const shortLastUpdateTime = computed(() => store.shortLastUpdateTime)
const intervalLabel = computed(() => String(Math.round(props.interval / 1000)))

const flashKey = ref('')
let flashTimer = null
let previous = {}

// 数值变化时短暂高亮，让"实时"可见
watch(
  () => store.realTimeData,
  (now) => {
    let changed = ''
    for (const m of METRIC_LIST) {
      const value = Number(now[m.key])
      if (previous[m.key] !== undefined && previous[m.key] !== value && !Number.isNaN(value)) {
        changed = m.key
      }
      previous[m.key] = value
    }
    if (changed) {
      flashKey.value = changed
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => {
        flashKey.value = ''
      }, 800)
    }
  },
  { deep: true, immediate: true }
)

onUnmounted(() => {
  clearTimeout(flashTimer)
})

const display = (metric) => {
  const value = Number(store.realTimeData[metric.key])
  if (Number.isNaN(value)) return '--'
  return value.toFixed(metric.decimals)
}
</script>

<style scoped>
.realtime-metrics {
  border-radius: 10px;
  border: 1px solid #eaf0f4;
}

.realtime-metrics :deep(.el-card__body) {
  padding: 14px 18px 16px;
}

.rt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.rt-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rt-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #52c41a;
  box-shadow: 0 0 0 0 rgba(82, 196, 26, 0.5);
  animation: rt-pulse 2s infinite;
}

.rt-dot.stale {
  background: #c0c4cc;
  box-shadow: none;
  animation: none;
}

@keyframes rt-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(82, 196, 26, 0.45);
  }
  70% {
    box-shadow: 0 0 0 7px rgba(82, 196, 26, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(82, 196, 26, 0);
  }
}

.rt-title {
  font-size: 14px;
  font-weight: 600;
  color: #2f3b45;
}

.rt-sub {
  font-size: 12px;
  color: #9aa7b2;
}

.rt-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.rt-source {
  font-weight: 400;
}

.rt-time {
  font-size: 12px;
  color: #9aa7b2;
  font-variant-numeric: tabular-nums;
}

.rt-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.rt-item {
  padding: 10px 12px;
  border-radius: 8px;
  background: #f8fbfd;
  border: 1px solid #eef4f8;
  transition: background 0.45s ease, border-color 0.45s ease;
}

.rt-item.flash {
  background: #eef7ff;
  border-color: #b9dcf7;
}

.rt-label {
  font-size: 12px;
  color: #8593a0;
  margin-bottom: 4px;
}

.rt-value {
  display: flex;
  align-items: baseline;
  gap: 3px;
}

.rt-num {
  font-size: 20px;
  font-weight: 600;
  color: #2f3b45;
  font-variant-numeric: tabular-nums;
  transition: color 0.3s ease;
}

.rt-unit {
  font-size: 11px;
  color: #a3aeb8;
}

.rt-temperature .rt-num {
  color: #e6a23c;
}

.rt-humidity .rt-num {
  color: #409eff;
}

.rt-soil_temperature .rt-num {
  color: #b88230;
}

.rt-soil_moisture .rt-num {
  color: #529b2e;
}

.rt-light_intensity .rt-num {
  color: #d9a12a;
}

.rt-co2_level .rt-num {
  color: #7a8b99;
}

@media (max-width: 1200px) {
  .rt-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .rt-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .rt-head {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
