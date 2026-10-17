type Point = { x: number; y: number }

// Brand Studio movement: silk easing, high-arc travel, figure eight and hover pocket.
export function silk(progress: number) {
  const t = Math.max(0, Math.min(1, progress))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function travelArc(from: Point, to: Point, progress: number, minY = -Infinity) {
  const t = silk(progress), u = 1 - t
  const dx = to.x - from.x
  const lift = Math.min(180, Math.max(48, Math.hypot(dx, to.y - from.y) * .25))
  const top = Math.max(minY, Math.min(from.y, to.y) - lift)
  return {
    x: u ** 3 * from.x + 3 * u * u * t * (from.x + dx * .2) + 3 * u * t * t * (from.x + dx * .82) + t ** 3 * to.x,
    y: u ** 3 * from.y + 3 * u * u * t * top + 3 * u * t * t * top + t ** 3 * to.y,
  }
}

export function floatOffset(seconds: number, inside: boolean, width: number, height: number) {
  const phase = seconds / (inside ? 12 : 8) * Math.PI * 2
  // Same normalized path geometry as the studio; bound the full character footprint.
  return {
    x: Math.sin(phase) * width * (inside ? .38 : .055),
    y: Math.sin(2 * phase) * height * (inside ? .3 : .08),
  }
}
