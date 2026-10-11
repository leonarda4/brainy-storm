import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applySpeakers, parseTranscript, speakerAppearance, transcriptDateKey, transcriptDateLabel, transcriptLine } from './transcript.ts'
import { avatarColors } from './avatarColors.ts'

test('recording dates and local clock times survive speaker attribution and transcript reload', () => {
  const timestamp = '2026-10-11T16:42:07.250+02:00'
  const live = transcriptLine({ person: 'Maya', text: 'A thought.', timestamp })
  const [saved] = parseTranscript(`[${timestamp}] [Maya] A thought.\n`)
  assert.equal(saved.recordedAt, timestamp)
  assert.equal(saved.time, new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp)))
  assert.equal(saved.time, live.time)
  assert.equal(saved.text, live.text)
  const updated = applySpeakers([transcriptLine({ id: '1', text: 'A thought.', timestamp, pending: true })], ['1'], [{ person: 'Maya', text: 'A thought.', timestamp }])
  assert.equal(updated[0].recordedAt, timestamp)
})

test('date separators use local calendar days across midnight and year boundaries', () => {
  const now = new Date(2026, 0, 1, 0, 10)
  const beforeMidnight = new Date(2025, 11, 31, 23, 59).toISOString()
  assert.equal(transcriptDateLabel(now.toISOString(), now), 'Today')
  assert.equal(transcriptDateLabel(beforeMidnight, now), 'Yesterday')
  assert.equal(transcriptDateKey(beforeMidnight), '2025-12-31')
  assert.notEqual(transcriptDateLabel(new Date(2025, 11, 30).toISOString(), now), 'Yesterday')
  assert.equal(transcriptDateKey(), undefined)
})

test('speaker names and initials survive saving and reloading', () => {
  const lines = parseTranscript('[Maya Patel] I propose solar panels.\n[Alex] I agree.\n[Maya Patel] Let’s build it.\n')
  assert.deepEqual(lines.map(line => line.person), ['Maya Patel', 'Alex', 'Maya Patel'])
  assert.equal(lines[0].initials, 'MP')
  assert.equal(lines[0].text, 'I propose solar panels.')
})

test('Storm is an explicit agent after reload, distinct from a human named Storm', () => {
  const live = transcriptLine({ id: 'storm-1', person: 'Storm', agent: 'storm', text: 'Move on.' })
  const [saved, person] = parseTranscript('[Agent Storm] Move on.\n[Storm] My name is Storm.\n')
  assert.equal(live.agent, 'storm')
  assert.equal(saved.agent, 'storm')
  assert.equal(saved.speakerKey, live.speakerKey)
  assert.equal(saved.color, 'avatar-storm')
  assert.equal(saved.person, 'Storm')
  assert.equal(person.agent, undefined)
  assert.notEqual(person.speakerKey, saved.speakerKey)
})

test('legacy transcripts and unknown speakers remain readable', () => {
  const lines = parseTranscript('Budget: 100 CHF.\n\n[Unknown speaker] Unclear voice.\n')
  assert.equal(lines[0].person, 'Unknown')
  assert.equal(lines[0].text, 'Budget: 100 CHF.')
  assert.equal(lines[1].initials, '?')
})

test('timestamped legacy names are separated from speech and timestamps', () => {
  const lines = parseTranscript('[00:11:36] Giacomo: A recommendation system.\n[00:11:45] Alex: Could we scrape a catalog?\n[16:27:20] Testing, testing.\n[12:00:01] [Maya Patel] Hello.\n')
  assert.deepEqual(lines.map(line => line.person), ['Giacomo', 'Alex', 'Unknown', 'Maya Patel'])
  assert.deepEqual(lines.map(line => line.initials), ['G', 'A', '?', 'MP'])
  assert.equal(lines[0].time, '00:11:36')
  assert.equal(lines[0].text, 'A recommendation system.')
  assert.equal(lines[2].text, 'Testing, testing.')
})

test('literal introductions name only their own legacy passage, never subsequent unknown speech', () => {
  const lines = parseTranscript("My name is Leonardo.\nA new thought.\nHi, I'm Maya Patel and I have an idea.\nI'm also Leonardo. Sorry for not introducing myself.\nI agree with Maya.\nI'm really interested.\n")
  assert.deepEqual(lines.map(line => line.person), ['Leonardo', 'Unknown', 'Maya Patel', 'Leonardo', 'Unknown', 'Unknown'])
  assert.equal(lines[2].text, "Hi, I'm Maya Patel and I have an idea.")
})

test('casual introductions recover the same saved voice across transcript chunks', () => {
  const lines = parseTranscript("[Speaker 1] An earlier thought.\n[Speaker 2] Hello.\n[Speaker 1] Hi, it's Leonarda. So\n[Speaker 1] I'm just further explaining\n[Speaker 1] our brainstorming idea decision tracker.\n[Unknown speaker] A different voice.\n[Speaker 2] I agree.\n")
  assert.deepEqual(lines.map(line => line.person), ['Leonarda', 'Unknown', 'Leonarda', 'Leonarda', 'Leonarda', 'Unknown', 'Unknown'])
  assert.equal(lines[0].color, speakerAppearance('Leonarda').color)
  assert.equal(lines[3].initials, 'L')
})

test('casual introductions need no speaking suffix and do not override known labels', () => {
  const lines = parseTranscript("It's Leonarda.\nHi, it’s Zoë.\nHello, it is Maya Patel.\nThis is Alex.\n[Unknown speaker] Hi, it's Leonarda.\n[Maya] It's Leonarda.\n")
  assert.deepEqual(lines.map(line => line.person), ['Leonarda', 'Zoë', 'Maya Patel', 'Alex', 'Unknown', 'Maya'])
})

test('mentions and conflicting introductions cannot rename a saved voice', () => {
  const lines = parseTranscript("I think it's Leonarda.\nIt's Leonarda's idea.\nIt's Leonarda who proposed that.\nShe said it's Leonarda.\n[Speaker 1] Hi, it's Maya.\n[Speaker 1] Hi, it's Alex.\n[Speaker 1] Another thought.\n")
  assert.ok(lines.every(line => line.person === 'Unknown'))
})

test('speaker colors stay stable across return visits, reloads, reordering, and live attribution', () => {
  const live = transcriptLine({ person: 'Maya Patel', text: 'Hello.' })
  const [reloaded] = parseTranscript('[Maya Patel] Hello again.')
  const [other, returned] = parseTranscript('[Alex] Next.\n[Maya Patel] Returning.')
  assert.equal(live.color, reloaded.color)
  assert.equal(live.color, returned.color)
  assert.notEqual(live.color, other.color)
  assert.equal(speakerAppearance('  maya   patel ').color, live.color)
  assert.equal(speakerAppearance('Zoë').initials, 'Z')
  assert.equal(speakerAppearance('Mary Jane Watson').initials, 'MW')
})

test('identified speakers use only the shared supporting brand colors', () => {
  for (const person of ['Maya Patel', 'Alex', 'Giacomo', 'Leonardo', 'Zoë', 'Mary Jane Watson', 'Speaker 1', 'Speaker 2']) {
    assert.ok(avatarColors.includes(speakerAppearance(person).color))
  }
  assert.equal(speakerAppearance('Unknown').color, 'avatar-unknown')
})

test('unidentified speech uses a question mark and distinct unnamed voices keep their own colors', () => {
  for (const person of ['', 'Room', 'Unknown', 'Unknown speaker', 'Unidentified speaker', 'Speaker 1', '?']) {
    const line = transcriptLine({ person, text: 'Hello.' })
    assert.equal(line.person, 'Unknown')
    assert.equal(line.initials, '?')
  }
  assert.equal(transcriptLine({ text: 'Pending.', pending: true }).initials, '?')
  assert.notEqual(speakerAppearance('Speaker 1').color, speakerAppearance('Speaker 2').color)
  assert.notEqual(speakerAppearance('Speaker 1').speakerKey, speakerAppearance('Speaker 2').speakerKey)
})

test('attribution replaces pending captions in place without duplicating or dropping newer speech', () => {
  const previous = transcriptLine({ text: 'Earlier.', person: 'Maya' })
  const pending = transcriptLine({ id: '1', text: 'I’m Alex.', pending: true })
  const newer = transcriptLine({ id: '2', text: 'Next thought.', pending: true })
  const result = applySpeakers([previous, pending, newer], ['1'], [{ id: '1-0', person: 'Alex', text: 'I’m Alex.', timestamp: '12:00:01' }])
  assert.equal(result.length, 3)
  assert.equal(result[0], previous)
  assert.equal(result[1].person, 'Alex')
  assert.equal(result[1].pending, false)
  assert.equal(result[1].time, '12:00:01')
  assert.equal(result[2], newer)
  assert.equal(applySpeakers(result, ['1'], []), result)
  assert.deepEqual(applySpeakers([], ['1'], [{ person: 'Alex', text: 'Stale result' }]), [])
})

test('a batch with several voices renders each speaker turn separately', () => {
  const lines = applySpeakers([transcriptLine({ id: '1', text: 'Hello. Hi.', pending: true })], ['1'], [
    { id: '1-0', person: 'Maya', text: 'Hello.' },
    { id: '1-1', person: 'Zoë', text: 'Hi.' },
  ])
  assert.deepEqual(lines.map(line => line.person), ['Maya', 'Zoë'])
  assert.equal(lines[1].initials, 'Z')
})
