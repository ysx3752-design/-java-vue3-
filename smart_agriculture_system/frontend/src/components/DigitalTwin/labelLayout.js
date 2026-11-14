const overlaps = (a, b, gap = 5) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
  && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y

export function positionInspector(anchor, width, height, cardWidth, cardHeight, reserved = []) {
  const clampX = x => Math.max(10, Math.min(width - cardWidth - 10, x))
  const clampY = y => Math.max(10, Math.min(height - cardHeight - 36, y))
  const candidates = [
    { x: anchor.x + 18, y: anchor.y + 12 },
    { x: anchor.x - cardWidth - 18, y: anchor.y + 12 },
    { x: anchor.x - cardWidth / 2, y: anchor.y - cardHeight - 42 },
    { x: width - cardWidth - 14, y: height - cardHeight - 36 }
  ].map(p => ({ x: clampX(p.x), y: clampY(p.y), width: cardWidth, height: cardHeight }))
  return candidates.find(p => !reserved.some(r => overlaps(p, r))) || candidates.at(-1)
}

// 从投影点附近向外寻找空位，保留全部可见锚点的标签，并避开工具栏和详情卡。
export function layoutLabels(items, width, height, reserved = []) {
  const occupied = [...reserved]
  return items.map(item => {
    const w = Math.min(item.width, width - 16)
    const h = item.height
    const maxX = Math.max(8, width - w - 8)
    const maxY = Math.max(8, height - h - 8)
    const originX = Math.max(8, Math.min(maxX, item.anchorX - w / 2))
    const originY = Math.max(8, Math.min(maxY, item.anchorY - h - 10))
    const candidates = [{ x: originX, y: originY }]
    // 网格补位保证密集视角下仍能找到可点击位置。
    for (let y = 8; y <= maxY; y += h + 7) {
      for (let x = 8; x <= maxX; x += Math.max(12, Math.floor(w / 2))) candidates.push({ x, y })
      candidates.push({ x: maxX, y })
    }
    const distance = p => (p.x - originX) ** 2 + (p.y - originY) ** 2
    candidates.sort((a, b) => distance(a) - distance(b))
    const position = candidates.find(p => !occupied.some(r => overlaps({ ...p, width: w, height: h }, r)))
    if (!position) return { ...item, visible: false }
    const rectangle = { ...position, width: w, height: h }
    occupied.push(rectangle)
    return { ...item, ...rectangle, visible: true }
  })
}
