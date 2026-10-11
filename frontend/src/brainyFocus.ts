export const BRAINY_FOCUS_IDLE_MS = 5000

type FocusTarget = { container: HTMLElement; card: HTMLElement; horizontal: boolean }

// Move only far enough to reveal the card, leaving already-visible cards in place.
export function nearestScrollOffset(start: number, end: number, viewportStart: number, viewportEnd: number) {
  if (start < viewportStart && end > viewportEnd) return 0
  if (start < viewportStart) return start - viewportStart
  if (end > viewportEnd) return end - viewportEnd
  return 0
}

export function createBrainyFocus(board: HTMLElement) {
  let target: FocusTarget | null = null
  let paused = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let automaticContainer: HTMLElement | null = null
  const pointers = new Set<number>()
  const view = board.ownerDocument.defaultView!

  function follow() {
    if (paused || !target) return
    const { container, card, horizontal } = target
    const bounds = container.getBoundingClientRect()
    const cardBounds = card.getBoundingClientRect()
    const style = view.getComputedStyle(container)
    const start = horizontal ? bounds.left + container.clientLeft : bounds.top + container.clientTop
    const size = horizontal ? container.clientWidth : container.clientHeight
    const insetStart = parseFloat(horizontal ? style.scrollPaddingLeft : style.scrollPaddingTop) || 0
    const insetEnd = parseFloat(horizontal ? style.scrollPaddingRight : style.scrollPaddingBottom) || 0
    const offset = nearestScrollOffset(
      horizontal ? cardBounds.left : cardBounds.top,
      horizontal ? cardBounds.right : cardBounds.bottom,
      start + insetStart, start + size - insetEnd,
    )
    if (Math.abs(offset) < 1) return
    automaticContainer = container
    container.scrollTo({
      left: container.scrollLeft + (horizontal ? offset : 0),
      top: container.scrollTop + (horizontal ? 0 : offset),
      behavior: view.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    })
  }

  function resumeLater() {
    clearTimeout(timer)
    if (pointers.size) return
    timer = setTimeout(() => {
      // Let editing, menus and modal dialogs finish before moving their context.
      const active = board.ownerDocument.activeElement
      if ((active && board.contains(active) && active.matches('input, textarea, select, [contenteditable="true"]'))
        || board.querySelector(':popover-open') || board.ownerDocument.querySelector('dialog[open]')) {
        resumeLater()
        return
      }
      paused = false
      follow()
    }, BRAINY_FOCUS_IDLE_MS)
  }

  function cancelAutomaticScroll() {
    const container = automaticContainer
    automaticContainer = null
    if (container) {
      container.scrollTo({ left: container.scrollLeft, top: container.scrollTop, behavior: 'instant' })
    }
  }

  function pause() {
    // Cancel only our animation, preserving the user's own scrolling momentum.
    cancelAutomaticScroll()
    paused = true
    resumeLater()
  }

  function pointerDown(event: PointerEvent) { pointers.add(event.pointerId); pause() }
  function pointerUp(event: PointerEvent) { if (pointers.delete(event.pointerId)) resumeLater() }
  function releasePointers() { if (pointers.size) { pointers.clear(); resumeLater() } }
  function keyDown(event: KeyboardEvent) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Tab'].includes(event.key)
      || (event.target instanceof view.HTMLElement && event.target.matches('input, textarea, select, [contenteditable="true"]'))) pause()
  }
  // Scroll events extend a user's idle period (including momentum), but Brainy's
  // own smooth scrolling must never put following into a pause/resume loop.
  function scrolled(event: Event) {
    if (!paused && event.target === automaticContainer) return
    pause()
  }
  function scrollEnded(event: Event) {
    if (event.target === automaticContainer) automaticContainer = null
  }
  board.addEventListener('wheel', pause, { passive: true, capture: true })
  board.addEventListener('pointerdown', pointerDown, true)
  board.addEventListener('keydown', keyDown, true)
  board.addEventListener('scroll', scrolled, true)
  board.addEventListener('scrollend', scrollEnded, true)
  view.addEventListener('pointerup', pointerUp, true)
  view.addEventListener('pointercancel', pointerUp, true)
  view.addEventListener('blur', releasePointers)
  view.addEventListener('resize', follow)

  return {
    setTarget(next: FocusTarget | null) {
      if (!next || next.container !== target?.container) cancelAutomaticScroll()
      target = next
      follow()
    },
    dispose() {
      clearTimeout(timer)
      board.removeEventListener('wheel', pause, true)
      board.removeEventListener('pointerdown', pointerDown, true)
      board.removeEventListener('keydown', keyDown, true)
      board.removeEventListener('scroll', scrolled, true)
      board.removeEventListener('scrollend', scrollEnded, true)
      view.removeEventListener('pointerup', pointerUp, true)
      view.removeEventListener('pointercancel', pointerUp, true)
      view.removeEventListener('blur', releasePointers)
      view.removeEventListener('resize', follow)
      cancelAutomaticScroll()
    },
  }
}
