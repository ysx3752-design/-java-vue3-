const intersects = (a, b) => a.x < b.x + b.width + 5 && a.x + a.width + 5 > b.x
  && a.y < b.y + b.height + 5 && a.y + a.height + 5 > b.y

export function positionInspector(anchor, width, height, cardWidth, cardHeight) {
  return { x: Math.max(10, (width - cardWidth) / 2), y: Math.max(10, height - cardHeight - 36),
    width: cardWidth, height: cardHeight }
}

// 初次布局避让；之后只跟随自身锚点和固定偏移，不按邻居的逐帧位置重新排序。
// 调用方按视口尺寸、弹层状态缓存 offsets，拖动与旋转不能清空缓存。
export function layoutLabels(items, width, height, reserved = [], offsets = new Map()) {
  const occupied = [...reserved]
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
  return items.map(item => {
    const w = Math.min(item.width, width / 2 - 20), h = item.height
    const baseX = item.anchorX - w / 2, baseY = item.anchorY - h - 10
    let offset = offsets.get(item.id)
    if (!offset) {
      const candidates = []
      for (let dy = -5; dy <= 5; dy++) {
        for (const dx of [0, -1, 1]) {
          const x = clamp(baseX + dx * (w + 8), 8, width - w - 8)
          const y = clamp(baseY + dy * (h + 8), 58, height - h - 36)
          candidates.push({ x, y, width: w, height: h })
        }
      }
      candidates.sort((a, b) => (a.x - baseX) ** 2 + (a.y - baseY) ** 2 - ((b.x - baseX) ** 2 + (b.y - baseY) ** 2))
      const initial = candidates.find(candidate => !occupied.some(other => intersects(candidate, other))) || candidates[0]
      offset = { x: initial.x - item.anchorX, y: initial.y - item.anchorY }
      offsets.set(item.id, offset)
    }
    const placed = { ...item, x: clamp(item.anchorX + offset.x, 8, width - w - 8),
      y: clamp(item.anchorY + offset.y, 58, height - h - 36), width: w, height: h, visible: true }
    occupied.push(placed)
    return placed
  })
}
