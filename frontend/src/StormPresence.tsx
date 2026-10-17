import { useEffect, useState } from 'react'
import type { StormTakeover } from './stormVoice'
import { AgentCharacter } from './AgentCharacter'

export function StormPresence({ storm }: { storm: StormTakeover | null }) {
  const [lastStorm, setLastStorm] = useState(storm)
  if (storm && storm !== lastStorm) setLastStorm(storm)
  useEffect(() => {
    if (storm) return
    const timer = window.setTimeout(() => setLastStorm(null), 700)
    return () => window.clearTimeout(timer)
  }, [storm])
  const visible = storm || lastStorm
  if (!visible) return null
  return <div className={`storm-presence${storm ? '' : ' is-leaving'}`}>
    <div className="storm-presence-content">
      <div className="storm-presence-flight"><AgentCharacter name="Storm" featured speaking={visible.phase === 'speaking'} /></div>
    </div>
  </div>
}
