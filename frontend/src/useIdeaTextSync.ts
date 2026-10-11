import { useEffect, useState } from 'react'
import type { Idea } from './ideaWorkspace'

export function useIdeaTextSync(sessionIdeas: Record<string, Idea[]>) {
  const [errors, setErrors] = useState<Record<string, boolean>>({})
  // Depend on edits, not incoming agent results, so polling cannot reset the debounce.
  const pending = JSON.stringify(Object.entries(sessionIdeas).flatMap(([sessionId, ideas]) => ideas.map(idea => ({ ...idea, session_id: sessionId }))).filter(idea => idea.pendingTextEdit).map(idea => ({
    id: idea.originalId || idea.id.replace(/^engine-/, ''),
    localId: idea.id,
    payload: { ...idea.pendingTextEdit, session_id: idea.session_id, idea_title: idea.title, is_new: !idea.rawIdea && !idea.id.startsWith('engine-') },
  })))

  useEffect(() => {
    const controller = new AbortController()
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const entries = JSON.parse(pending) as { id: string; localId: string; payload: Idea['pendingTextEdit'] & { idea_title: string; is_new: boolean } }[]
    const base = (import.meta.env.VITE_ENRICHMENT_URL || '/api/enrichment').replace(/\/$/, '')
    function schedule(callback: () => void, delay: number) {
      const timer = setTimeout(() => { timers.delete(timer); callback() }, delay)
      timers.add(timer)
    }
    async function send(entry: typeof entries[number]) {
      try {
        const response = await fetch(`${base}/ideas/${encodeURIComponent(entry.id)}/text-edits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry.payload),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        })
        if (!response.ok) throw new Error('Could not sync text edits')
        if (!controller.signal.aborted) setErrors(current => current[entry.localId] ? { ...current, [entry.localId]: false } : current)
      } catch {
        if (!controller.signal.aborted) setErrors(current => current[entry.localId] ? current : { ...current, [entry.localId]: true })
      } finally {
        // Retry with the same ID until polling confirms durable context storage.
        if (!controller.signal.aborted) schedule(() => void send(entry), 10000)
      }
    }
    entries.forEach(entry => schedule(() => void send(entry), 900))
    return () => { controller.abort(); timers.forEach(clearTimeout) }
  }, [pending])

  return errors
}
