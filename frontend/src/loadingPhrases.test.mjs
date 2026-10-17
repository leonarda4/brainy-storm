import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadingWords, nextLoadingWord, formatLoadingPhrase } from './loadingPhrases.ts'

test('every purpose generates phrases without consecutive repeats', () => {
  for (const purpose of Object.keys(loadingWords)) {
    let previous = loadingWords[purpose][0]
    for (let i = 0; i < 30; i++) {
      const word = nextLoadingWord(purpose, previous, () => (i % 10) / 10)
      assert.notEqual(word, previous)
      assert.ok(loadingWords[purpose].includes(word))
      previous = word
    }
  }
})
test('copy is reusable with any subject', () => {
  assert.equal(formatLoadingPhrase('Brainy', 'detangling'), 'Brainy is detangling…')
  assert.equal(formatLoadingPhrase(' Scout ', 'following breadcrumbs'), 'Scout is following breadcrumbs…')
})
