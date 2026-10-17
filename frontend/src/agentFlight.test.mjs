import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avoidObstacles } from './agentFlight.ts'
const bounds = { left: 0, top: 0, width: 400, height: 300 }
const inside = (p, r) => p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom

test('keeps clear flight paths unchanged', () => {
  assert.deepEqual(avoidObstacles({ x: 20, y: 30 }, bounds, []), { x: 20, y: 30 })
})
test('clears overlapping text and button obstacles together', () => {
  const obstacles = [
    { left: 100, right: 300, top: 80, bottom: 180 },
    { left: 120, right: 280, top: 160, bottom: 240 },
  ]
  const result = avoidObstacles({ x: 200, y: 170 }, bounds, obstacles)
  assert.ok(obstacles.every(rect => !inside(result, rect)))
})
test('stays within a narrow board even when no clear space exists', () => {
  const result = avoidObstacles({ x: 200, y: 170 }, { left: 0, top: 0, width: 0, height: 20 }, [
    { left: -50, right: 300, top: -50, bottom: 300 },
  ])
  assert.equal(result.x, 0)
  assert.ok(result.y >= 0 && result.y <= 20)
})
