import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('./useTranscription.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source.replace('import.meta.env.VITE_TRANSCRIBER_URL', "''"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

function setup({ resume = () => Promise.resolve(), microphone } = {}) {
  const cells = [], timers = new Map(), contexts = [], sockets = [], events = []
  let cursor = 0, timerId = 0
  const react = {
    useRef(value) { const index = cursor++; return cells[index] ??= { current: value } },
    useState(value) {
      const index = cursor++
      if (!(index in cells)) cells[index] = value
      return [cells[index], next => { cells[index] = typeof next === 'function' ? next(cells[index]) : next }]
    },
    useCallback(fn) { return fn },
    useEffect() {},
  }
  const track = { stop() { this.stopped = true } }
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
  class AudioContext {
    state = 'suspended'
    sampleRate = 24000
    audioWorklet = { addModule: async () => {} }
    constructor() { contexts.push(this) }
    resume() { events.push('resume'); return resume() }
    async close() { this.state = 'closed' }
    createMediaStreamSource() { return { connect() {} } }
  }
  class WebSocket {
    static OPEN = 1
    static CLOSED = 3
    readyState = 1
    constructor() { sockets.push(this) }
    close() { this.readyState = 3 }
    send() {}
  }
  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === 'react') return react
      if (name === './transcript') return { parseTranscript: () => [] }
      if (name === './stormVoice') return {}
      throw new Error(name)
    },
    window: {
      location: { href: 'http://localhost:5173' },
      setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id },
      clearTimeout(id) { timers.delete(id) },
    },
    navigator: { mediaDevices: { getUserMedia: microphone ?? (async () => stream) } },
    AudioContext, WebSocket, URL, AbortSignal,
    AudioWorkletNode: class { port = {}; connect() {}; disconnect() {} },
    fetch: async () => { events.push('fetch'); return { ok: true, json: async () => ({ transcript: '' }) } },
  })
  return {
    render() { cursor = 0; return exports.useTranscription('test') },
    expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn() } },
    contexts, sockets, events, stream, track,
  }
}

test('audio is resumed in the start gesture and stalled initialization becomes retryable', async () => {
  const pending = deferred()
  const app = setup({ resume: () => pending.promise })
  const starting = app.render().startRecording()
  assert.deepEqual(app.events, ['resume'])
  app.expire(30000)
  assert.equal(app.render().recording, 'stopped')
  assert.match(app.render().error, /initializing browser audio/)
  assert.equal(app.contexts[0].state, 'closed')
  pending.resolve()
  await starting
  assert.equal(app.sockets.length, 0)
  await app.render().startRecording()
  assert.equal(app.sockets.length, 1)
})

test('late microphone permission after timeout cannot revive an expired attempt', async () => {
  const pending = deferred()
  const app = setup({ microphone: () => pending.promise })
  const starting = app.render().startRecording()
  await flush()
  app.expire(30000)
  assert.match(app.render().error, /waiting for microphone access/)
  pending.resolve(app.stream)
  await starting
  assert.equal(app.track.stopped, true)
  assert.equal(app.sockets.length, 0)
  assert.equal(app.render().recording, 'stopped')
})

test('ready handshake enters recording and removes startup timers', async () => {
  const app = setup()
  await app.render().startRecording()
  app.sockets[0].onmessage({ data: JSON.stringify({ type: 'ready' }) })
  app.expire(30000)
  app.expire(15000)
  assert.equal(app.render().recording, 'recording')
  assert.equal(app.render().error, '')
})

test('restart cancels pending microphone acquisition without stranding the start button', async () => {
  const pending = deferred()
  const app = setup({ microphone: () => pending.promise })
  const starting = app.render().startRecording()
  await flush()
  await app.render().restartTranscript()
  pending.resolve(app.stream)
  await starting
  assert.equal(app.sockets.length, 0)
  assert.equal(app.track.stopped, true)
  assert.equal(app.render().recording, 'stopped')
  await app.render().startRecording()
  assert.equal(app.sockets.length, 1)
})
