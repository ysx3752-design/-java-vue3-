/**
 * 图表数据整理工具。
 *
 * 数据库里一天可能有几百上千条采样记录，直接逐点绘制会出现两种情况：
 * 1. 采样密集处线条叠成一团（表现为右端一片竖线）；
 * 2. 某个指标几乎不变时，横轴点太多反而看不出趋势。
 *
 * 因此前端按固定时间桶聚合后再绘制（与参考项目的"24 个时间点"思路一致），
 * 每桶对该时段内的样本取平均，桶内无样本则跳过，不做插值。
 */

const NUMERIC_FIELDS = [
  'air_temperature',
  'air_humidity',
  'soil_temperature',
  'soil_moisture',
  'light_intensity',
  'co2_concentration'
]

/**
 * 将原始记录按时间桶聚合成固定数量的曲线点。
 *
 * 注意：start / end 应传入查询区间的实际边界。早期只传 hours，
 * 由 end - hours 反推窗口起点，会让时间桶整体偏移（选 11.21–11.22 时
 * 窗口实际从 11.20 23:59 开始），横轴标签与真实采样时刻对不上。
 *
 * @param {Array} rows 后端返回的原始记录
 * @param {Object} options
 * @param {Date|string} options.start 窗口开始时间
 * @param {Date|string} options.end 窗口结束时间，默认当前时间
 * @param {number} options.hours 未传 start 时，用 end - hours 推窗口起点，默认 24
 * @param {number} options.points 目标点数，默认按小时数推算（24–72）
 * @returns {Array} 聚合后的数据点
 */
export function bucketSeries(rows, options = {}) {
  const end = options.end ? new Date(options.end) : new Date()
  const start = options.start
    ? new Date(options.start)
    : new Date(end.getTime() - (options.hours || 24) * 3600 * 1000)
  const span = Math.max(1, end.getTime() - start.getTime())
  const points = options.points || Math.min(72, Math.max(24, Math.round(span / 3600000)))
  const bucketSize = span / points

  const buckets = Array.from({ length: points }, () => null)

  for (const row of rows || []) {
    if (!row || !row.timestamp) continue
    const time = new Date(row.timestamp).getTime()
    if (Number.isNaN(time) || time < start.getTime() || time > end.getTime()) continue

    let index = Math.floor((time - start.getTime()) / bucketSize)
    if (index < 0) index = 0
    if (index >= points) index = points - 1

    const bucket = buckets[index] || { sums: {}, counts: {}, samples: 0, lastTime: 0 }
    for (const field of NUMERIC_FIELDS) {
      const raw = row[field]
      if (raw === null || raw === undefined || raw === '') continue
      const value = Number(raw)
      if (!Number.isFinite(value)) continue
      bucket.sums[field] = (bucket.sums[field] || 0) + value
      bucket.counts[field] = (bucket.counts[field] || 0) + 1
    }
    bucket.samples += 1
    bucket.lastTime = Math.max(bucket.lastTime, time)
    buckets[index] = bucket
  }

  const series = []
  buckets.forEach((bucket, index) => {
    if (!bucket || bucket.samples === 0) return
    const point = {
      timestamp: new Date(start.getTime() + index * bucketSize).toISOString(),
      sampleCount: bucket.samples
    }
    for (const field of NUMERIC_FIELDS) {
      // 按字段各自的有效样本数取均值：某些记录缺字段时不会把平均值拉低
      const count = bucket.counts[field]
      if (count) {
        point[field] = Math.round((bucket.sums[field] / count) * 10) / 10
      }
    }
    // 兼容字段
    point.temperature = point.air_temperature
    point.humidity = point.air_humidity
    point.co2_level = point.co2_concentration
    series.push(point)
  })
  return series
}

/**
 * 无数据时的演示曲线（昼夜模型），仅用于界面兜底展示，调用方应明确标注为演示数据。
 */
export function generateDemoSeries(options = {}) {
  const points = options.points || 24
  const end = options.end ? new Date(options.end) : new Date()
  // 支持自定义区间：不传 start 时沿用"最近 24 小时"
  const start = options.start ? new Date(options.start) : new Date(end.getTime() - 24 * 3600 * 1000)
  const span = Math.max(1, end.getTime() - start.getTime())
  const bucketSize = span / points

  const series = []
  for (let i = 0; i < points; i++) {
    const time = new Date(start.getTime() + i * bucketSize)
    const hour = time.getHours() + time.getMinutes() / 60
    const wave = Math.cos(((hour - 14) / 24) * Math.PI * 2)
    const daylight = hour < 6 || hour > 18 ? 0 : Math.sin((Math.PI * (hour - 6)) / 12)
    const jitter = (seed) => {
      const v = Math.sin((time.getMinutes() + seed * 37) * 12.9898) * 43758.5453
      return ((v - Math.floor(v)) * 2 - 1) * 0.3
    }

    series.push({
      timestamp: time.toISOString(),
      air_temperature: round1(25 + 3.2 * wave + jitter(1)),
      air_humidity: round1(50 - 8 * wave + jitter(2)),
      soil_temperature: round1(25 + 1.5 * Math.cos(((hour - 16) / 24) * Math.PI * 2)),
      soil_moisture: round1(50 - 2.5 * wave),
      light_intensity: Math.round(5000 * (0.12 + 0.88 * daylight)),
      co2_concentration: Math.round(500 * (1 + 0.18 * (1 - daylight))),
      temperature: round1(25 + 3.2 * wave),
      humidity: round1(50 - 8 * wave),
      co2_level: Math.round(500 * (1 + 0.18 * (1 - daylight))),
      demo: true
    })
  }
  return series
}

function round1(value) {
  return Math.round(value * 10) / 10
}
