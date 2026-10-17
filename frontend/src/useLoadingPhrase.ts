import { useEffect, useState } from 'react'
import { formatLoadingPhrase, loadingWords, nextLoadingWord, type LoadingPurpose } from './loadingPhrases'

export function useLoadingPhrase(subject: string, purpose: LoadingPurpose = 'thinking', active = true, intervalMs = 4200) {
  const [state, setState] = useState<{ purpose: LoadingPurpose; word: string }>({ purpose, word: loadingWords[purpose][0] })
  const word = state.purpose === purpose ? state.word : loadingWords[purpose][0]
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => {
      if (!document.hidden) setState(previous => ({ purpose, word: nextLoadingWord(purpose, previous.purpose === purpose ? previous.word : loadingWords[purpose][0]) }))
    }, Math.max(2000, intervalMs))
    return () => window.clearInterval(timer)
  }, [purpose, active, intervalMs])
  return formatLoadingPhrase(subject, word)
}
