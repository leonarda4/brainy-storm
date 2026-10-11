import { speakerAppearance } from './transcript.ts'
import type { TranscriptLine } from './transcript.ts'

// Older enrichment records mix names, "Name (role): reason", and sentences.
// Keep attribution separate from arguments so repeated points count once.
const stanceVerb = /\s+(?:who\b|advocates?\b|argues?\b|argued\b|backs?\b|believes?\b|champions?\b|challenges?\b|challenged\b|contends?\b|criticizes?\b|emphasizes?\b|expressed\b|highlights?\b|opposes?\b|prefers?\b|promotes?\b|proposes?\b|proposed\b|questions?\b|recommends?\b|reintroduced\b|rejects?\b|suggests?\b|supports?\b|supported\b|warns?\b|cautions?\b)/iu
const nameWords = /^[\p{L}\p{M}][\p{L}\p{M}'’.-]*(?:\s+[\p{L}\p{M}][\p{L}\p{M}'’.-]*){0,4}$/u
const noPerson = /\b(?:none|nobody|no one|unknown|unidentified|anonymous|unattributed|proponents?|supporters?|opponents?|opposition|support|objections?|consensus|critics?|skeptics?|team|everyone|participants?|users?|group|room)\b/iu

export function ideaParticipants(attributions: string[] = []) {
  const people = new Map<string, { name: string; initials: string; color: string }>()
  for (const attribution of attributions) {
    if (typeof attribution !== 'string') continue
    const text = attribution.normalize('NFKC').trim().replace(/\s+/gu, ' ')
    const name = text.split(/[:(,]/u, 1)[0].split(stanceVerb, 1)[0].trim()
    const numberedSpeaker = /^speaker\s*\d+$/iu.test(name)
    if (!numberedSpeaker && (!nameWords.test(name) || noPerson.test(name))) continue
    // Unattributed argument sentences are not participant identities.
    if (name === text && !numberedSpeaker && !name.split(' ').every(word => /^\p{Lu}/u.test(word))) continue
    const appearance = speakerAppearance(name)
    if (appearance.speakerKey === 'unknown') continue
    if (!people.has(appearance.speakerKey)) {
      people.set(appearance.speakerKey, { name, initials: appearance.initials, color: appearance.color })
    }
  }
  return [...people.values()]
}

export function sessionParticipants(transcript: TranscriptLine[], attributions: string[] = []) {
  const people = new Map<string, { name: string; initials: string; color: string }>()
  for (const line of transcript) {
    if (line.agent || line.speakerKey === 'unknown') continue
    const name = line.speakerKey.startsWith('voice:') ? `Speaker ${line.speakerKey.slice(6)}` : line.person
    people.set(line.speakerKey, { name, initials: line.initials, color: line.color })
  }
  // Saved idea attributions also supply names when the transcript is unavailable.
  for (const person of ideaParticipants(attributions)) {
    const key = speakerAppearance(person.name).speakerKey
    if (!people.has(key)) people.set(key, person)
  }
  return [...people.values()]
}
