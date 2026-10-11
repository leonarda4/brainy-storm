import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { mergeGeneratedIdeas } from './ideaWorkspace.ts'

let server
let EditableIdea

before(async () => {
  server = await createServer({
    configFile: false,
    plugins: [react()],
    server: { middlewareMode: true, watch: null, ws: false },
  })
  ;({ EditableIdea } = await server.ssrLoadModule('/src/EditableIdea.tsx'))
})

after(async () => { await server?.close() })

function render(idea) {
  return renderToStaticMarkup(createElement(EditableIdea, {
    idea, storageError: false, onChange() {},
  }))
}

test('an open idea page renders fresh agent outputs with a collapsed data export', () => {
  const [initial] = mergeGeneratedIdeas([], [{ id: 'live', title: 'Early title', summary: 'Early summary' }])
  const payload = {
    id: 'live', title: 'Updated product title', summary: 'Updated product summary', status: 'enriched',
    pros_cons: { pros: ['Useful benefit'], cons: ['Known tradeoff'], open_questions: ['Who needs this?'] },
    systemGraph: { summary: 'System design result', nodes: [{ id: 'api', label: 'Application service' }] },
    workflow: { steps: ['Capture', 'Analyze'] },
    competitors: { competitors: [{ name: 'Example competitor', summary: 'Research result' }] },
    metadata: { key_takeaway: 'Validate the target audience.' },
  }
  const [updated] = mergeGeneratedIdeas([initial], [payload])
  const html = render(updated)
  for (const text of [
    payload.title, payload.summary, 'Useful benefit', 'Known tradeoff', 'Who needs this?',
    'System design result', 'Application service', 'Example competitor',
    'Validate the target audience.', 'Idea data', 'Copy JSON', 'Download .json',
  ]) assert.ok(html.includes(text), `Missing idea page content: ${text}`)
  assert.ok(!html.includes('Early title'))
  assert.ok(!html.includes('Early summary'))
  assert.ok(!html.includes('json-code-pre'), 'Raw data stays collapsed until requested')
  assert.ok(!html.includes('&quot;rawIdea&quot;'), 'Export must not contain frontend metadata')
})

test('unfinished ideas show progress without empty analysis sections', () => {
  const [idea] = mergeGeneratedIdeas([], [{
    id: 'pending', title: 'New idea', summary: '', status: 'enriching', active_tools: ['summary'],
  }])
  const html = render(idea)
  for (const text of [
    'Idea title', 'Idea summary', 'Idea data', 'Agents working', 'Updating summary',
  ]) assert.ok(html.includes(text), `Missing idea content: ${text}`)
  for (const text of ['Pros and cons', 'How it works', 'Competition research', 'Conclusion so far', 'pending-agent-section']) {
    assert.ok(!html.includes(text), `Unnecessary empty section: ${text}`)
  }
})
