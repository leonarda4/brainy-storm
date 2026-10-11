export type StormIntervention = { id: string; text: string }
export type StormTakeover = StormIntervention & { phase: 'starting' | 'speaking' | 'text' }

type VoiceEnvironment = {
  synthesis?: SpeechSynthesis
  utterance: (text: string) => SpeechSynthesisUtterance
  later: (callback: () => void, milliseconds: number) => number
  clear: (timer: number | undefined) => void
}

/** Owns one utterance and always releases Memo, even if a browser loses an event. */
export function createStormVoice(
  onTakeover: (value: StormTakeover | null) => void,
  onGate: (muted: boolean) => void,
  onWarning: (message: string) => void,
  env: VoiceEnvironment = {
    synthesis: window.speechSynthesis,
    utterance: text => new SpeechSynthesisUtterance(text),
    later: (callback, ms) => window.setTimeout(callback, ms),
    clear: timer => window.clearTimeout(timer),
  },
) {
  let current: SpeechSynthesisUtterance | undefined
  let deadline: number | undefined
  let release: number | undefined
  let generation = 0

  function cancel() {
    ++generation
    env.clear(deadline)
    env.clear(release)
    if (current) {
      current.onstart = current.onend = current.onerror = null
      current = undefined
      env.synthesis?.cancel()
    }
    onGate(false)
    onTakeover(null)
  }

  function speak(intervention: StormIntervention) {
    cancel()
    onWarning('')
    const token = generation
    const fallback = () => {
      if (token !== generation) return
      env.clear(deadline)
      if (current) {
        current.onstart = current.onend = current.onerror = null
        current = undefined
        env.synthesis?.cancel()
      }
      onGate(false)
      onTakeover({ ...intervention, phase: 'text' })
      onWarning('Storm’s voice could not play. Its focus reminder is shown here and in the transcript.')
      release = env.later(() => { if (token === generation) onTakeover(null) }, 8000)
    }
    if (!env.synthesis) { fallback(); return }
    try {
      const utterance = env.utterance(intervention.text)
      current = utterance
      utterance.lang = 'en-US'
      utterance.rate = 1.05
      utterance.pitch = 0.85
      const voices = env.synthesis.getVoices()
      utterance.voice = voices.find(voice => voice.lang.startsWith('en') && voice.localService)
        || voices.find(voice => voice.lang.startsWith('en')) || null
      utterance.onstart = () => {
        if (token !== generation) return
        env.clear(deadline)
        onTakeover({ ...intervention, phase: 'speaking' })
        deadline = env.later(fallback, 25000)
      }
      utterance.onend = () => {
        if (token !== generation) return
        env.clear(deadline)
        current = undefined
        // Keep the microphone quiet through the speaker's short acoustic tail.
        release = env.later(() => {
          if (token !== generation) return
          onGate(false)
          onTakeover(null)
        }, 350)
      }
      utterance.onerror = fallback
      onGate(true)
      onTakeover({ ...intervention, phase: 'starting' })
      deadline = env.later(fallback, 5000)
      env.synthesis.resume()
      env.synthesis.speak(utterance)
    } catch { fallback() }
  }

  return { speak, cancel }
}
