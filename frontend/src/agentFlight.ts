export type FlightRect = { left: number; right: number; top: number; bottom: number }
type Point = { x: number; y: number }
type Bounds = { left: number; top: number; width: number; height: number }

// Obstacles are expanded by the flyer's footprint before reaching this helper.
export function avoidObstacles(point: Point, bounds: Bounds, obstacles: FlightRect[]): Point {
  const clamp = ({ x, y }: Point) => ({
    x: Math.max(bounds.left, Math.min(bounds.left + bounds.width, x)),
    y: Math.max(bounds.top, Math.min(bounds.top + bounds.height, y)),
  })
  const desired = clamp(point)
  const depth = (p: Point, rect: FlightRect) => Math.max(0,
    Math.min(p.x - rect.left, rect.right - p.x, p.y - rect.top, rect.bottom - p.y))
  if (!obstacles.some(rect => depth(desired, rect) > 0)) return desired
  const xs = [desired.x, bounds.left, bounds.left + bounds.width, ...obstacles.flatMap(r => [r.left, r.right])]
  const ys = [desired.y, bounds.top, bounds.top + bounds.height, ...obstacles.flatMap(r => [r.top, r.bottom])]
  let best = desired
  let bestScore = Infinity
  for (const x of xs) for (const y of ys) {
    const candidate = clamp({ x, y })
    // When space is tight, prefer the least obstructive available position.
    const overlap = obstacles.reduce((sum, rect) => sum + depth(candidate, rect), 0)
    const score = overlap * 10000 + Math.hypot(candidate.x - desired.x, candidate.y - desired.y)
    if (score < bestScore) { best = candidate; bestScore = score }
  }
  return best
}
