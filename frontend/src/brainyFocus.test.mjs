import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BRAINY_FOCUS_IDLE_MS, createBrainyFocus, nearestScrollOffset } from './brainyFocus.ts'

function setup(t, horizontal = true, reducedMotion = false) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  class Element extends EventTarget { matches() { return false } }
  const view = Object.assign(new EventTarget(), {
    HTMLElement: Element,
    getComputedStyle: () => ({ scrollPaddingLeft: '20px', scrollPaddingRight: '20px', scrollPaddingTop: '20px', scrollPaddingBottom: '20px' }),
    matchMedia: () => ({ matches: reducedMotion }),
  })
  const board = Object.assign(new Element(), {
    ownerDocument: { defaultView: view, activeElement: null, querySelector: () => null },
    querySelector: () => null,
    contains: () => false,
  })
  const calls = []
  const container = {
    scrollLeft: 0, scrollTop: 0, clientWidth: 500, clientHeight: 500, clientLeft: 0, clientTop: 0,
    getBoundingClientRect: () => ({ left: 100, top: 100 }),
    scrollTo(options) { calls.push(options); this.scrollLeft = options.left; this.scrollTop = options.top },
  }
  const card = (position, size = 200) => ({
    getBoundingClientRect: () => ({
      left: 100 + position - container.scrollLeft, right: 100 + position + size - container.scrollLeft,
      top: 100 + position - container.scrollTop, bottom: 100 + position + size - container.scrollTop,
    }),
  })
  const focus = createBrainyFocus(board)
  t.after(() => focus.dispose())
  const select = position => focus.setTarget({ container, card: card(position), horizontal })
  const emit = (name, props = {}, on = board) => {
    const event = Object.assign(new Event(name), props)
    // The board captures scroll events from its nested rail.
    if (name === 'scroll' || name === 'scrollend') Object.defineProperty(event, 'target', { value: container })
    return on.dispatchEvent(event)
  }
  return { focus, container, select, calls, emit, board, view, tick: ms => t.mock.timers.tick(ms) }
}

test('reveals the focused card along the layout axis and respects reduced motion', t => {
  const { select, container, calls } = setup(t, false, true)
  select(900)
  assert.equal(container.scrollTop, 620)
  assert.equal(container.scrollLeft, 0)
  assert.equal(calls.at(-1).behavior, 'instant')
  select(900)
  assert.equal(calls.length, 1, 'Already visible cards do not move')
})

test('user navigation yields immediately and resumes at the latest idea after five idle seconds', t => {
  const { select, container, emit, tick } = setup(t)
  select(900)
  emit('wheel')
  container.scrollLeft = 0
  select(1300)
  tick(BRAINY_FOCUS_IDLE_MS - 1)
  assert.equal(container.scrollLeft, 0)
  tick(1)
  assert.equal(container.scrollLeft, 1020)
})

test('momentum extends the idle delay but automatic scroll events do not pause following', t => {
  const { select, container, emit, tick } = setup(t)
  select(900)
  emit('scroll')
  select(1300)
  assert.equal(container.scrollLeft, 1020)
  emit('wheel')
  container.scrollLeft = 0
  tick(4000)
  emit('scroll')
  tick(4000)
  assert.equal(container.scrollLeft, 0)
  tick(1000)
  assert.equal(container.scrollLeft, 1020)
})

test('a held touch or scrollbar drag stays in user control until release, even outside the board', t => {
  const { select, container, emit, tick, view } = setup(t)
  select(900)
  emit('pointerdown', { pointerId: 1 })
  container.scrollLeft = 0
  select(1300)
  tick(20000)
  assert.equal(container.scrollLeft, 0)
  emit('pointerup', { pointerId: 1 }, view)
  tick(4999)
  assert.equal(container.scrollLeft, 0)
  tick(1)
  assert.equal(container.scrollLeft, 1020)
})

test('keyboard navigation pauses following and resumes the same idea without a new update', t => {
  const { select, container, emit, tick } = setup(t)
  select(900)
  emit('keydown', { key: 'Home' })
  container.scrollLeft = 0
  tick(5000)
  assert.equal(container.scrollLeft, 620)
})

test('scrollbar movement also yields when the browser does not send a pointer event', t => {
  const { select, container, emit, tick } = setup(t)
  select(900)
  emit('scrollend')
  container.scrollLeft = 0
  emit('scroll')
  select(1300)
  assert.equal(container.scrollLeft, 0)
  tick(5000)
  assert.equal(container.scrollLeft, 1020)
})

test('clearing discussion focus or leaving the board cancels pending movement', t => {
  const { focus, select, container, emit, tick } = setup(t)
  select(900)
  emit('wheel')
  container.scrollLeft = 0
  focus.setTarget(null)
  tick(5000)
  assert.equal(container.scrollLeft, 0)
  select(900)
  emit('wheel')
  container.scrollLeft = 0
  focus.dispose()
  tick(5000)
  assert.equal(container.scrollLeft, 0)
})

test('a target larger than the viewport stays still when it already spans the viewport', () => {
  assert.equal(nearestScrollOffset(0, 800, 100, 600), 0)
  assert.equal(nearestScrollOffset(0, 200, 100, 600), -100)
  assert.equal(nearestScrollOffset(650, 850, 100, 600), 250)
})
