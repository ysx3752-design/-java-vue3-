export const DEVICE_LABELS = {
  external_shade: '外遮阳', internal_shade: '内遮阳', external_fan: '外通风', internal_fan: '内通风',
  skylight: '天窗', spray: '喷灌', water_curtain: '水帘', light: '补光灯'
}
export const isDeviceOn = value => [1, '1', true, 'open', 'active', 'on'].includes(value)
export function deviceStateText(key, value) {
  if (value == null) return '状态未知'
  const on = isDeviceOn(value)
  if (key === 'external_shade' || key === 'internal_shade') return on ? '已展开' : '已收起'
  return on ? '已开启' : '已关闭'
}
export function deviceActionText(key, action) {
  if (key === 'external_shade' || key === 'internal_shade') return action === 'open' ? '展开' : '收起'
  return action === 'open' ? '开启' : '关闭'
}
