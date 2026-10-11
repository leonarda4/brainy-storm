import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { applySpeakers, transcriptLine } from './transcript.ts'

let server
let TranscriptContent
let AvatarGroup
let RecordingShape

before(async () => {
  server = await createServer({
    configFile: false,
    plugins: [react()],
    server: { middlewareMode: true, watch: null, ws: false },
  })
  ;({ TranscriptContent } = await server.ssrLoadModule('/src/TranscriptContent.tsx'))
  ;({ AvatarGroup } = await server.ssrLoadModule('/src/AvatarGroup.tsx'))
  ;({ RecordingShape } = await server.ssrLoadModule('/src/BrandShape.tsx'))
})

after(async () => { await server?.close() })

function render(transcript, recording = 'recording') {
  return renderToStaticMarkup(createElement(TranscriptContent, { transcript, recording }))
}

test('dated transcripts group by calendar day across recording sessions', () => {
  const timestamps = [new Date(2026, 9, 10, 18, 10), new Date(2026, 9, 10, 21, 45), new Date(2026, 9, 11, 9, 15)]
  const lines = timestamps.map((date, index) => transcriptLine({ person: 'Maya', text: `Thought ${index}`, timestamp: date.toISOString() }))
  const html = render(lines, 'stopped')
  assert.equal((html.match(/class="transcript-date"/g) || []).length, 2)
  for (const line of lines) {
    assert.ok(html.includes(`dateTime="${line.recordedAt}"`))
    assert.ok(html.includes(`>${line.time}</time>`))
  }
})

test('empty and legacy transcripts never invent a recording time or a today separator', () => {
  assert.equal(render([], 'stopped'), '')
  const html = render([transcriptLine({ person: 'Maya', text: 'Legacy passage.', timestamp: '00:11:36' })], 'stopped')
  assert.ok(html.includes('Legacy passage.'))
  assert.ok(!html.includes('<time'))
  assert.ok(!html.includes('transcript-date'))
})

test('word fragments stay hidden behind one speaking indicator until the merged chunk is ready', () => {
  const earlier = transcriptLine({ person: 'Maya', text: 'Earlier idea.' })
  const pending = ['We', 'could', 'build', 'this.'].map((text, index) => transcriptLine({ id: String(index), text, pending: true }))
  for (let count = 1; count <= pending.length; count++) {
    const html = render([earlier, ...pending.slice(0, count)])
    assert.equal((html.match(/Someone is speaking/g) || []).length, 1)
    assert.equal((html.match(/<article /g) || []).length, 1)
    assert.ok(html.includes('Earlier idea.'))
    for (const fragment of pending) assert.ok(!html.includes(`<p>${fragment.text}</p>`))
    assert.ok(!html.includes('Listening for the next thought'))
  }
  const completed = applySpeakers([earlier, ...pending], pending.map(line => line.id), [
    { id: 'merged', person: 'Alex', text: 'We could build this.' },
  ])
  const html = render(completed)
  assert.equal((html.match(/We could build this\./g) || []).length, 1)
  assert.ok(html.includes('<strong>Alex</strong>'))
  assert.ok(!html.includes('Someone is speaking'))
})

test('known pending speakers show their own avatar and name without revealing provisional text', () => {
  const line = transcriptLine({ person: 'Maya Patel', text: 'Unfinished sentence', pending: true })
  const html = render([line])
  assert.ok(html.includes('<strong>Maya Patel</strong> is speaking'))
  assert.ok(html.includes(`class="avatar ${line.color} speaker-avatar"`))
  assert.ok(html.includes('>MP</span>'))
  assert.ok(!html.includes(line.text))
  assert.ok(!html.includes('<article'))
})

test('unknown current speech never inherits a previous speaker’s identity', () => {
  const html = render([
    transcriptLine({ person: 'Maya', text: 'Previous thought.' }),
    transcriptLine({ person: 'Speaker 2', text: 'New thought.', pending: true }),
  ])
  assert.ok(html.includes('Someone is speaking'))
  assert.ok(!html.includes('Maya</strong> is speaking'))
  assert.ok(!html.includes('New thought.'))
})

test('finishing an older batch preserves the indicator for newer speech', () => {
  const older = transcriptLine({ id: 'old', text: 'Older fragment', pending: true })
  const newer = transcriptLine({ id: 'new', text: 'Newer fragment', person: 'Alex', pending: true })
  const lines = applySpeakers([older, newer], ['old'], [{ id: 'done', person: 'Maya', text: 'Finished thought.' }])
  const html = render(lines)
  assert.ok(html.includes('Finished thought.'))
  assert.ok(html.includes('<strong>Alex</strong> is speaking'))
  assert.ok(!html.includes('Newer fragment'))
})

test('unattributed completed chunks remain visible when speaker identification fails', () => {
  const pending = transcriptLine({ id: 'pending', text: 'Full thought.', pending: true })
  const lines = applySpeakers([pending], ['pending'], [{ id: 'saved', person: 'Unknown speaker', text: 'Full thought.' }])
  const html = render(lines, 'stopped')
  assert.ok(html.includes('<strong>Unknown</strong>'))
  assert.ok(html.includes('<p>Full thought.</p>'))
  assert.ok(!html.includes('is speaking'))
})

test('idle, saving, paused, and stopped states do not claim someone is speaking', () => {
  assert.ok(render([]).includes('Listening for the next thought'))
  assert.ok(!render([]).includes('is speaking'))
  const pending = [transcriptLine({ text: 'Still processing', pending: true })]
  for (const state of ['saving', 'paused', 'stopped', 'connecting']) {
    const html = render(pending, state)
    assert.ok(!html.includes('is speaking'))
    assert.ok(!html.includes('Still processing'))
    assert.equal(html.includes('Finishing transcript…'), state === 'saving')
  }
})

test('participant groups and transcript rows render the same avatar component and palette class', () => {
  const line = transcriptLine({ person: 'Maya Patel', text: 'Hello.' })
  const group = renderToStaticMarkup(createElement(AvatarGroup, { participants: [line] }))
  const transcript = render([line])
  assert.ok(group.includes(`class="avatar ${line.color} member-avatar"`))
  assert.ok(transcript.includes(`class="avatar ${line.color} speaker-avatar"`))
  assert.ok(!transcript.includes('background-color:'))
})

test('Storm takeover suppresses human speaking indicators and labels its saved comment', () => {
  const transcript = [transcriptLine({ text: 'Pending human speech', pending: true }),
    transcriptLine({ agent: 'storm', text: 'Move on to another idea.' })]
  const html = renderToStaticMarkup(createElement(TranscriptContent, { transcript, recording: 'recording', stormActive: true }))
  assert.ok(html.includes('storm-transcript-line'))
  assert.ok(html.includes('Focus agent'))
  assert.ok(html.includes('avatar-storm'))
  assert.ok(html.includes('Move on to another idea.'))
  assert.ok(!html.includes('Someone is speaking'))
  assert.ok(!html.includes('Listening for the next thought'))
})

test('the animated listening shapes switch from Memo bubbles to connected Storm diamonds', () => {
  const memo = renderToStaticMarkup(createElement(RecordingShape, { active: true }))
  const storm = renderToStaticMarkup(createElement(RecordingShape, { active: true, storm: true, stormSpeaking: true }))
  assert.ok(memo.includes('<ellipse'))
  assert.ok(memo.includes('<strong>Memo</strong>'))
  assert.ok(!memo.includes('<polygon'))
  assert.ok(storm.includes('<polygon'))
  assert.ok(storm.includes('storm-connector'))
  assert.ok(storm.includes('<strong>Storm</strong>'))
  assert.ok(storm.includes('Speaking'))
  assert.ok(!storm.includes('<ellipse'))
})
