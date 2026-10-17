import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stormPresentation } from './stormPresentation.ts'

test('new storms welcome Memo and recording immediately hands the card to Brainy', () => {
  assert.equal(stormPresentation('stopped', 0, 0, false).memoInWelcome, true)
  assert.deepEqual(stormPresentation('recording', 0, 0, false), {
    recordingActive: true, emptyStormThinking: true, memoInWelcome: false,
  })
})

test('stopping before any content restores the welcome even with stale processing activity', () => {
  for (const status of ['paused', 'stopped']) {
    assert.equal(stormPresentation(status, 0, 0, true).memoInWelcome, true)
  }
})

test('pending spoken content can finish after pausing and real ideas never restore the welcome', () => {
  assert.equal(stormPresentation('paused', 0, 1, true).emptyStormThinking, true)
  assert.equal(stormPresentation('paused', 1, 1, false).memoInWelcome, false)
})
