import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStormVoice } from './stormVoice.ts'

function setup({ supported = true, throws = false } = {}) {
  const timers = new Map()
  let nextTimer = 0
  const state = { takeover: null, muted: false, warning: '', cancelled: 0 }
  const synthesis = {
    getVoices: () => [{ lang: 'en-US', localService: true }],
    resume() {},
    speak(utterance) { if (throws) throw new Error('Playback denied'); state.utterance = utterance },
    cancel() { state.cancelled++ },
  }
  const voice = createStormVoice(
    value => { state.takeover = value },
    value => { state.muted = value },
    value => { state.warning = value },
    {
      synthesis: supported ? synthesis : undefined,
      utterance: text => ({ text }),
      later(callback, ms) { const id = ++nextTimer; timers.set(id, { callback, ms }); return id },
      clear(id) { timers.delete(id) },
    },
  )
  const advance = ms => {
    for (const [id, timer] of [...timers]) {
      if (timer.ms <= ms) { timers.delete(id); timer.callback() }
    }
  }
  return { voice, state, advance, timers }
}

const intervention = { id: 'storm-1', text: 'Please move on to another aspect.' }

test('Storm gates the microphone until voice ends and its acoustic tail clears', () => {
  const { voice, state, advance } = setup()
  voice.speak(intervention)
  assert.equal(state.muted, true)
  assert.equal(state.takeover.phase, 'starting')
  assert.equal(state.utterance.text, intervention.text)
  state.utterance.onstart()
  assert.equal(state.takeover.phase, 'speaking')
  state.utterance.onend()
  assert.equal(state.muted, true)
  advance(350)
  assert.equal(state.muted, false)
  assert.equal(state.takeover, null)
})

test('pause, disconnect, reset, and unmount can cancel without stale events restoring Storm', () => {
  const { voice, state, advance, timers } = setup()
  voice.speak(intervention)
  const delayedStart = state.utterance.onstart
  const delayedEnd = state.utterance.onend
  voice.cancel()
  delayedStart()
  delayedEnd()
  advance(30000)
  assert.equal(state.muted, false)
  assert.equal(state.takeover, null)
  assert.equal(state.cancelled, 1)
  assert.equal(timers.size, 0)
})

test('unavailable or blocked voice preserves a readable reminder and releases Memo', () => {
  for (const options of [{ supported: false }, { throws: true }, {}]) {
    const { voice, state, advance } = setup(options)
    voice.speak(intervention)
    if (state.utterance) state.utterance.onerror()
    assert.equal(state.takeover.phase, 'text')
    assert.equal(state.takeover.text, intervention.text)
    assert.equal(state.muted, false)
    assert.match(state.warning, /voice could not play/)
    advance(8000)
    assert.equal(state.takeover, null)
  }
})

test('missing start or end events cannot leave the microphone muted indefinitely', () => {
  for (const started of [false, true]) {
    const { voice, state, advance } = setup()
    voice.speak(intervention)
    if (started) state.utterance.onstart()
    advance(started ? 25000 : 5000)
    assert.equal(state.muted, false)
    assert.equal(state.takeover.phase, 'text')
    assert.equal(state.cancelled, 1)
  }
})

test('a new intervention cancels the old one without old callbacks releasing its microphone gate', () => {
  const { voice, state } = setup()
  voice.speak(intervention)
  const oldEnd = state.utterance.onend
  voice.speak({ id: 'storm-2', text: 'A new reminder.' })
  oldEnd()
  assert.equal(state.takeover.id, 'storm-2')
  assert.equal(state.muted, true)
  assert.equal(state.cancelled, 1)
})
