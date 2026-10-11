import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
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
  return createPortal(<div className={`storm-presence${storm ? '' : ' is-leaving'}`}>
    <div className="storm-presence-shade" />
    <div className="storm-presence-content">
      <div className="storm-presence-flight"><AgentCharacter name="Storm" featured speaking={visible.phase === 'speaking'} /></div>
      <div className="storm-presence-caption" role="status" aria-atomic="true">
        <span>{visible.phase === 'speaking' ? 'Storm is speaking' : 'Storm · Focus check'}</span>
        <p>{visible.text}</p>
      </div>
    </div>
  </div>, document.body)
}
