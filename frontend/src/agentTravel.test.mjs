import { test } from 'node:test'
import assert from 'node:assert/strict'
import { travelArc, silk, floatOffset } from './agentTravel.ts'

test('handoffs arrive exactly at their anchors with an arch between them', () => {
  const from = { x: 0, y: 200 }, to = { x: 600, y: 200 }
  assert.deepEqual(travelArc(from, to, 0), from)
  assert.deepEqual(travelArc(from, to, 1), to)
  assert.ok(travelArc(from, to, .5).y < 200)
  assert.ok(silk(.01) < .0001)
  assert.ok(silk(.99) > .9999)
})

test('thinking flight stays inside the available space and loops without a jump', () => {
  for (let t = 0; t < 12; t += .1) {
    const point = floatOffset(t, true, 80, 180)
    assert.ok(Math.abs(point.x) <= 40)
    assert.ok(Math.abs(point.y) <= 90)
  }
  const end = floatOffset(12, true, 80, 180)
  assert.ok(Math.abs(end.x) < 1e-10 && Math.abs(end.y) < 1e-10)
})


test('high handoffs keep the entire arc below the viewport safety margin', () => {
  for (const [from, to] of [[{ x: 16, y: 20 }, { x: 250, y: 30 }], [{ x: 250, y: 300 }, { x: 16, y: 16 }]]) {
    for (let i = 0; i <= 100; i++) {
      const point = travelArc(from, to, i / 100, 16)
      assert.ok(point.y >= 16 - 1e-10)
      assert.ok(point.y <= 300 + 1e-10)
      assert.ok(point.x >= 16 - 1e-10 && point.x <= 250 + 1e-10)
    }
  }
})
