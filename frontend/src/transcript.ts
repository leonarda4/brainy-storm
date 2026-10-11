import { avatarColors } from './avatarColors.ts'

export type TranscriptLine = {
  id?: string
  person: string
  initials: string
  speakerKey: string
  color: string
  time: string
  recordedAt?: string
  text: string
  pending?: boolean
  agent?: 'storm'
}

type Caption = { id?: string; person?: string; text: string; timestamp?: string; pending?: boolean; agent?: 'storm' }

const unknownNames = /^(?:room|unknown(?: speaker)?|unidentified(?: speaker)?|anonymous|speaker(?:\s*\d+)?|\?)$/iu
const clock = /^\d{1,2}:\d{2}(?::\d{2})?$/u
const recordedTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u

export function transcriptDateKey(timestamp?: string): string | undefined {
  if (!timestamp) return undefined
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function transcriptDateLabel(timestamp: string, now = new Date()): string {
  const key = transcriptDateKey(timestamp)
  if (key === transcriptDateKey(now.toISOString())) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (key === transcriptDateKey(yesterday.toISOString())) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(timestamp))
}

export function speakerAppearance(name = '') {
  const clean = name.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  const unknown = !clean || unknownNames.test(clean) || clock.test(clean)
  // Numbered, unnamed voices remain distinct. Truly unattributed speech shares
  // the neutral fallback; it must not be presented as a known person.
  const numbered = /^speaker\s*(\d+)$/iu.exec(clean)
  const speakerKey = numbered ? `voice:${numbered[1]}` : unknown ? 'unknown' : `name:${clean.toLocaleLowerCase()}`
  let hash = 2166136261
  for (const char of speakerKey) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0
  const words = clean.split(' ')
  const initials = unknown ? '?' : Array.from([words[0], ...(words.length > 1 ? [words[words.length - 1]] : [])]
    .map(word => Array.from(word)[0]).join('').toLocaleUpperCase()).slice(0, 2).join('')
  return {
    person: unknown ? 'Unknown' : clean,
    initials,
    speakerKey,
    color: speakerKey === 'unknown' ? 'avatar-unknown' : avatarColors[hash % avatarColors.length],
  }
}

export function transcriptLine({ id, text, timestamp = '', person = 'Unknown speaker', pending = false, agent }: Caption): TranscriptLine {
  const recordedAt = recordedTimestamp.test(timestamp) && !Number.isNaN(Date.parse(timestamp)) ? timestamp : undefined
  const time = recordedAt ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(recordedAt)) : timestamp
  if (agent === 'storm' || person === 'Agent Storm') {
    return { id, text, time, recordedAt, person: 'Storm', initials: 'S', speakerKey: 'agent:storm', color: 'avatar-storm', pending: false, agent: 'storm' }
  }
  return { id, ...speakerAppearance(person), time, recordedAt, text, pending }
}

function introducedName(text: string): string | undefined {
  const introduction = /^(?:(?:hi|hello|hey)(?: everyone| all| there)?[,.!]?\s+)?(?:my name is|i['’]m(?: also)?|i am(?: also)?|this is|it['’]s|it is)\s+/iu.exec(text)
  if (!introduction) return undefined
  const name = /^(\p{Lu}[\p{L}\p{M}'’-]*(?:\s+\p{Lu}[\p{L}\p{M}'’-]*){0,3})(?=[,.!?;:]|\s|$)/u.exec(text.slice(introduction[0].length))?.[1]
  if (!name || /['’]s(?:\s|$)/u.test(name) || /^(?:I|Really|Also|Going|Testing|Sorry|Not|Just|Excited|Happy|Thinking|Sure|Ready|Here)\b/u.test(name)) return undefined
  if (/(?:it['’]s|it is|this is)\s+$/iu.test(introduction[0]) &&
      !/^(?:\s+(?:here|speaking))?\s*(?:[,.!?;:]|$)/iu.test(text.slice(introduction[0].length + name.length))) return undefined
  return name
}

export function parseTranscript(text: string): TranscriptLine[] {
  const captions = text.split('\n').filter(line => line.trim()).map(line => {
    let content = line.trim()
    let timestamp = ''
    const timed = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})|\d{1,2}:\d{2}(?::\d{2})?)\]\s*/u.exec(content)
    if (timed) {
      timestamp = timed[1]
      content = content.slice(timed[0].length)
    }
    const labeled = /^\[([^\]\r\n]+)\]\s+(.*)$/u.exec(content)
    // Earlier recordings use [HH:MM:SS] Name: text. An unlabelled colon
    // (for example "Budget: 100 CHF") is part of the speech, not a speaker.
    const legacy = timed ? /^([\p{L}\p{M}'’-]+(?: [\p{L}\p{M}'’-]+){0,3}):\s+(.*)$/u.exec(content) : null
    const attributed = labeled || legacy
    return { person: attributed?.[1], timestamp, text: attributed?.[2] ?? content }
  })
  // A numbered voice is audio-backed identity, unlike generic Unknown speech.
  // Recover its name throughout older recordings, including earlier turns.
  const names = new Map<string, string>()
  const conflicts = new Set<string>()
  for (const caption of captions) {
    const voice = /^speaker\s*\d+$/iu.test(caption.person || '') ? speakerAppearance(caption.person).speakerKey : undefined
    const name = voice && introducedName(caption.text)
    if (voice && name) {
      const previous = names.get(voice)
      if (previous && previous.toLocaleLowerCase() !== name.toLocaleLowerCase()) conflicts.add(voice)
      names.set(voice, name)
    }
  }
  return captions.map(caption => {
    const voice = speakerAppearance(caption.person).speakerKey
    let person = caption.person
    if (voice.startsWith('voice:') && !conflicts.has(voice)) person = names.get(voice) || person
    // A generic Unknown label may represent overlapping voices. Only legacy
    // unlabelled speech can recover its own name without an audio-backed ID.
    if (!person) person = introducedName(caption.text)
    return transcriptLine({ ...caption, person })
  })
}

export function applySpeakers(current: TranscriptLine[], replaceIds: string[], captions: Caption[]): TranscriptLine[] {
  const replaced = new Set(replaceIds)
  const first = current.findIndex(line => line.id && replaced.has(line.id))
  if (first < 0) return current // Ignore a stale/duplicate update after a reset or reload.
  return [
    ...current.slice(0, first),
    ...captions.map(transcriptLine),
    ...current.slice(first).filter(line => !line.id || !replaced.has(line.id)),
  ]
}
