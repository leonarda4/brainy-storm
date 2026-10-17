import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AgentCharacter } from './AgentCharacter'
import { floatOffset, silk, travelArc } from './agentTravel'

/** One character survives target changes, with every handoff contained in the viewport. */
export function FlyingAgent({ name, enabled = true }: { name: 'Memo' | 'Brainy'; enabled?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const enabledRef = useRef(enabled)
  useEffect(() => { enabledRef.current = enabled }, [enabled])
  useEffect(() => {
    const element = host.current!
    const width = name === 'Brainy' ? 112 : 168
    const height = name === 'Brainy' ? 56 : 112
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let x = -240, y = -240, scale = 1, frame = 0
    let destination: HTMLElement | undefined
    let from = { x, y }, fromScale = scale, started = performance.now(), duration = 1400
    function move(now: number) {
      const targets = enabledRef.current ? Array.from(document.querySelectorAll<HTMLElement>(`[data-agent-target="${name}"]`)) : []
      const target = targets.find(target => {
        const rect = target.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight && !target.closest('[inert]')
      })
      // Card companions belong below the surrounding panels, including while travelling.
      element.classList.toggle('is-card-bound', name === 'Brainy' && !!target?.closest('.idea-card'))
      const rect = target?.getBoundingClientRect()
      const size = name === 'Brainy' ? 1 : target ? Number(target.dataset.agentScale || 1) : scale
      const margin = 16
      const insetX = width * Math.max(scale, size) / 2 + margin
      const insetY = height * Math.max(scale, size) / 2 + margin
      const bounds = { left: insetX - width / 2, right: Math.max(insetX, innerWidth - insetX) - width / 2, top: insetY - height / 2, bottom: Math.max(insetY, innerHeight - insetY) - height / 2 }
      const constrain = (p: { x: number; y: number }) => ({ x: Math.max(bounds.left, Math.min(bounds.right, p.x)), y: Math.max(bounds.top, Math.min(bounds.bottom, p.y)) })
      const wander = target?.dataset.agentWander
      if (target !== destination) {
        destination = target
        from = constrain({ x, y })
        fromScale = scale
        started = now
        const distance = rect ? Math.hypot(rect.left + rect.width / 2 - width / 2 - x, rect.top + rect.height / 2 - height / 2 - y) : 700
        duration = Math.max(1000, Math.min(1900, 850 + distance * .65))
      }
      const progress = reduced.matches ? 1 : Math.min(1, (now - started) / duration)
      const inside = wander === 'inside'
      const drift = rect && wander && !reduced.matches
        ? floatOffset(Math.max(0, now - started - duration) / 1000, inside,
          inside ? Math.max(0, rect.width - width * size) : 160,
          inside ? Math.max(0, rect.height - height * size) : 100)
        : { x: 0, y: 0 }
      const driftEase = silk(Math.max(0, now - started - duration) / 1200)
      const to = constrain({
        x: rect ? rect.left + rect.width / 2 - width / 2 + drift.x * driftEase : x,
        y: rect ? rect.top + rect.height / 2 - height / 2 + drift.y * driftEase : y,
      })
      const position = travelArc(constrain(from), to, progress, bounds.top)
      x = position.x
      y = position.y
      scale = fromScale + (size - fromScale) * silk(progress)
      element.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
      element.style.visibility = !rect ? 'hidden' : 'visible'
      frame = requestAnimationFrame(move)
    }
    frame = requestAnimationFrame(move)
    return () => cancelAnimationFrame(frame)
  }, [name])
  return createPortal(<div ref={host} className="flying-agent" style={name === 'Brainy' ? { width: 112, height: 56 } : undefined} aria-hidden="true"><AgentCharacter name={name} compact={name === 'Brainy'} /></div>, document.body)
}
