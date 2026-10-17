import { useEffect, useState } from 'react'
import type { Idea } from './ideaWorkspace'

export function useBrainyActivity(sessionId: string, ideas: Idea[]) {
  const [activity, setActivity] = useState<{ sessionId: string; phase: string; new_idea_ids: string[] } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const base = (import.meta.env.VITE_TRANSCRIBER_URL || '/api/transcriber').replace(/\/$/, '')
        const response = await fetch(`${base}/brainy?session_id=${encodeURIComponent(sessionId)}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]), cache: 'no-store',
        })
        if (!response.ok) throw new Error('Could not load Brainy activity')
        const data = await response.json()
        if (typeof data.phase !== 'string' || !Array.isArray(data.new_idea_ids)) throw new Error('Invalid activity')
        if (!controller.signal.aborted) setActivity({ ...data, sessionId })
      } catch {
        if (!controller.signal.aborted) setActivity(null)
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 1000)
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [sessionId])
  if (activity?.sessionId !== sessionId) return false
  return (activity.phase === 'classifying' && ideas.length === 0)
    || activity.new_idea_ids.some(id => !ideas.some(idea => (idea.originalId || idea.id.replace(/^engine-/, '')) === id))
}
