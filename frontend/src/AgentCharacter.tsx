import { useEffect, useRef } from 'react'
import motion from './agents/motions.js'
import characters from './agents/characters.js'
import data from './agents/data.json'
import './agents/characters.css'
import './agents/presence.css'

export function AgentCharacter({ name, featured = false, compact = false, speaking = false, avatar = false }: { name: 'Memo' | 'Storm' | 'Brainy'; featured?: boolean; compact?: boolean; speaking?: boolean; avatar?: boolean }) {
  const mount = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = mount.current!
    const agent = data.agents.find(agent => agent.name === name)!
    const character = characters.create(agent, data.shapes, data.outlines)
    characters.setSize(character, compact ? 'compact' : featured ? 'featured' : 'medium')
    if (avatar) {
      character.wrap.style.minWidth = '40px'
      character.wrap.style.minHeight = '40px'
      character.wrap.style.paddingRight = '0'
      character.avatar.style.width = '40px'
      character.badge.hidden = true
    }
    host.append(character.wrap)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const recipe = { body: name === 'Brainy' ? 'brainy' : name === 'Memo' ? 'memo' : speaking ? 'storm' : 'breathe', eyes: name === 'Brainy' ? 'think' : name === 'Memo' ? 'attentive' : 'double', speed: speaking ? 1.15 : 0.85, energy: speaking ? 0.8 : 0.65, expression: 1, loop: true }
    let frame = 0
    const start = performance.now()
    function animate(now: number) {
      const pose = motion.sample(recipe, (now - start) / 1000, agent.motion, { reducedMotion: reduced.matches })
      characters.render(character, pose)
      if (!pose.done && !document.hidden) frame = requestAnimationFrame(animate)
    }
    function restart() { cancelAnimationFrame(frame); animate(performance.now()) }
    restart()
    document.addEventListener('visibilitychange', restart)
    reduced.addEventListener('change', restart)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', restart)
      reduced.removeEventListener('change', restart)
      character.wrap.remove()
    }
  }, [name, featured, compact, speaking, avatar])
  return <div ref={mount} className={`agent-character agent-character-${name.toLowerCase()}`} aria-hidden="true" />
}
