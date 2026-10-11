import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteWorkspaceSession, editIdea, migrateWorkspace, readWorkspace, mergeGeneratedIdeas, mergeSessionIdeas, queueSavedTextEdits } from './ideaWorkspace.ts'

const idea = { id: 'engine-1', title: 'My title', summary: 'My notes\nSecond paragraph', tag: 'Next steps', votes: 3, pattern: 'orbit', thumbnail: '/ideas/1/artifacts/thumbnail.svg', locallyEdited: true }

test('deleting a storm removes its ideas and survives reload and late backend results', () => {
  const sessions = ['team-discussion', 'keep'].map(id => ({ id, name: id, date: 'Saved', ideas: 1 }))
  const workspace = { sessions, sessionIdeas: { 'team-discussion': [idea], keep: [{ ...idea, id: 'manual-keep' }] }, activeSession: 'team-discussion', cleanupRevision: 3 }
  const deleted = deleteWorkspaceSession(workspace, 'team-discussion')
  assert.deepEqual(deleted.sessions.map(session => session.id), ['keep'])
  assert.equal(deleted.activeSession, 'keep')
  assert.equal(deleted.sessionIdeas['team-discussion'], undefined)
  assert.deepEqual(deleted.deletedIdeaIds, ['1'])
  const restored = migrateWorkspace(readWorkspace(JSON.stringify(deleted)))
  assert.deepEqual(restored.sessions.map(session => session.id), ['keep'])
  const refreshed = mergeSessionIdeas(restored.sessionIdeas, [
    { id: 'late', title: 'Late idea', summary: '', session_id: 'team-discussion' },
    { id: 1, title: 'Old unscoped idea', summary: '' },
  ], restored.deletedIdeaIds, restored.deletedSessionIds)
  assert.deepEqual(Object.keys(refreshed), ['keep'])
  assert.deepEqual(refreshed.keep, restored.sessionIdeas.keep)
  assert.equal(refreshed.keep[0].summary, workspace.sessionIdeas.keep[0].summary)
})

test('deleting an inactive storm keeps the selection and deleting the last storm creates a fresh one', () => {
  const session = id => ({ id, name: id, date: 'Saved', ideas: 0 })
  const first = deleteWorkspaceSession({ sessions: [session('a'), session('b')], sessionIdeas: { a: [], b: [] }, activeSession: 'b' }, 'a')
  assert.equal(first.activeSession, 'b')
  const last = deleteWorkspaceSession(first, 'b')
  assert.equal(last.sessions.length, 1)
  assert.ok(!['a', 'b'].includes(last.activeSession))
  assert.deepEqual(last.sessionIdeas[last.activeSession], [])
})

test('polling preserves edits and votes while adding incoming ideas', () => {
  const result = mergeGeneratedIdeas([idea], [{ id: 1, title: 'Server title', summary: 'Server summary' }, { id: 2, title: 'New idea', summary: 'New content' }])
  assert.equal(result[0].title, idea.title)
  assert.equal(result[0].summary, idea.summary)
  assert.equal(result[0].tag, idea.tag)
  assert.equal(result[0].thumbnail, idea.thumbnail)
  assert.equal(result[0].votes, 3)
  assert.equal(result[1].title, 'New idea')
})

test('server refresh does not erase edited or manually created pages', () => {
  const manual = { ...idea, id: 'manual-1', locallyEdited: undefined }
  assert.deepEqual(mergeGeneratedIdeas([idea, manual], []), [idea, manual])
})

test('unedited generated ideas receive server updates', () => {
  const result = mergeGeneratedIdeas([{ ...idea, locallyEdited: false }], [{ id: 1, title: 'Updated', summary: 'Updated summary' }])
  assert.equal(result[0].title, 'Updated')
  assert.equal(result[0].votes, 3)
})

test('workspace round-trip retains multiline edits and manual sessions', () => {
  const workspace = { sessions: [{ name: 'New brainstorm', date: 'Just now', ideas: 1 }], sessionIdeas: { 'New brainstorm': [idea] } }
  assert.deepEqual(readWorkspace(JSON.stringify(workspace)), workspace)
})

test('malformed storage safely falls back to an empty workspace', () => {
  for (const raw of [null, '{', '{}', '{"sessions":[null],"sessionIdeas":{}}', '{"sessions":[],"sessionIdeas":{"x":[{}]}}']) assert.equal(readWorkspace(raw), null)
})

test('new ideas append after manual cards and polling never reorders existing cards', () => {
  const manual = { ...idea, id: 'manual-1' }
  const incoming = [
    { id: 2, title: 'Newest', summary: '' },
    { id: 1, title: 'Original', summary: '' },
  ]
  const result = mergeGeneratedIdeas([idea, manual], incoming)
  assert.deepEqual(result.map(i => i.id), ['engine-1', 'manual-1', 'engine-2'])
  assert.deepEqual(mergeGeneratedIdeas(result, incoming).map(i => i.id), result.map(i => i.id))
})

test('successive polls refresh every agent section and the raw JSON export together', () => {
  const initial = mergeGeneratedIdeas([], [{ id: 'live', title: 'First title', summary: 'First summary', status: 'enriching' }])
  const completed = {
    id: 'live', title: 'Refined title', summary: 'Refined summary', status: 'enriched',
    pros_cons: { pros: ['A benefit'], cons: ['A concern'], open_questions: ['Who is the customer?'] },
    systemGraph: { nodes: [{ id: 'api', label: 'API' }], mermaid_code: 'graph LR; A-->B' },
    workflow: { steps: ['Capture', 'Analyze'] },
    competitors: { competitors: [{ name: 'Existing product', summary: 'A similar solution' }] },
    metadata: { key_takeaway: 'Validate the customer need.' },
  }
  const [updated] = mergeGeneratedIdeas(initial, [completed])
  assert.equal(updated.id, initial[0].id)
  for (const field of ['title', 'summary', 'pros_cons', 'systemGraph', 'workflow', 'competitors', 'metadata', 'status']) {
    assert.deepEqual(updated[field], completed[field])
  }
  assert.deepEqual(updated.rawIdea, completed)
  assert.equal(updated.rawIdea.votes, undefined)
  assert.equal(updated.rawIdea.editedFields, undefined)
})

test('editing the summary does not freeze the generated title or agent results', () => {
  const [initial] = mergeGeneratedIdeas([], [{ id: 1, title: 'Original', summary: 'Original summary' }])
  const edited = editIdea(initial, { summary: 'My own notes' })
  const server = { id: 1, title: 'New title', summary: 'New summary', metadata: { key_takeaway: 'New conclusion' } }
  const [updated] = mergeGeneratedIdeas([edited], [server])
  assert.equal(updated.title, server.title)
  assert.equal(updated.summary, 'My own notes')
  assert.equal(updated.metadata.key_takeaway, 'New conclusion')
  assert.deepEqual(updated.rawIdea, server)
})

test('editing the title or tag leaves the generated summary live', () => {
  const [initial] = mergeGeneratedIdeas([], [{ id: 1, title: 'Original', summary: 'Original summary' }])
  const edited = editIdea(initial, { title: 'My title', tag: 'Pinned' })
  const [updated] = mergeGeneratedIdeas([edited], [{ id: 1, title: 'New title', summary: 'New summary' }])
  assert.equal(updated.title, 'My title')
  assert.equal(updated.tag, 'Pinned')
  assert.equal(updated.summary, 'New summary')
})

test('shared-context acknowledgement releases the draft and keeps all text live', () => {
  const [initial] = mergeGeneratedIdeas([], [{ id: 1, title: 'Original', summary: 'Original summary' }])
  const edited = editIdea(initial, { title: 'My title', summary: 'My notes', tag: 'My tag' })
  const received = { id: 1, title: 'My title', summary: 'My notes', transcript_segments: [{ chunk_id: `text-edit:${edited.pendingTextEdit.edit_id}`, text: 'Written input' }] }
  const [acknowledged] = mergeGeneratedIdeas([edited], [received])
  assert.equal(acknowledged.pendingTextEdit, undefined)
  assert.equal(acknowledged.textEditsSaved, true)
  assert.equal(acknowledged.tag, 'My tag')
  const [next] = mergeGeneratedIdeas([acknowledged], [{ ...received, title: 'Latest title', summary: 'Summary with new context' }])
  assert.equal(next.title, 'Latest title')
  assert.equal(next.summary, 'Summary with new context')
})

test('acknowledging an older edit cannot erase newer typing', () => {
  const [initial] = mergeGeneratedIdeas([], [{ id: 1, title: 'Original', summary: 'Original summary' }])
  const first = editIdea(initial, { title: 'My title' })
  const second = editIdea(first, { summary: 'Extra context' })
  assert.equal(second.pendingTextEdit.title, 'My title')
  assert.equal(second.pendingTextEdit.summary, 'Extra context')
  const [updated] = mergeGeneratedIdeas([second], [{ id: 1, title: 'Server title', summary: 'Server summary', transcript_segments: [{ chunk_id: `text-edit:${first.pendingTextEdit.edit_id}`, text: '' }] }])
  assert.equal(updated.pendingTextEdit.edit_id, second.pendingTextEdit.edit_id)
  assert.equal(updated.summary, 'Extra context')
  assert.equal(updated.title, 'My title')
})

test('unsynced edits survive browser storage and legacy edits enter the sync queue', () => {
  const edited = editIdea(idea, { summary: 'Remember this detail' })
  const restored = readWorkspace(JSON.stringify({ sessions: [], sessionIdeas: { Hackathon: [edited] } }))
  assert.deepEqual(restored.sessionIdeas.Hackathon[0].pendingTextEdit, edited.pendingTextEdit)
  assert.equal(queueSavedTextEdits(edited).pendingTextEdit.edit_id, edited.pendingTextEdit.edit_id)
  assert.equal(queueSavedTextEdits(idea).pendingTextEdit.summary, idea.summary)
})

test('manual ideas receive live results without moving sessions or changing selection IDs', () => {
  const manual = { ...idea, id: 'manual-1', locallyEdited: false }
  const current = { Hackathon: [], Personal: [manual] }
  const incoming = [{ id: 'manual-1', title: 'Updated title', summary: 'Updated summary' }]
  const result = mergeSessionIdeas(current, incoming)
  assert.equal(result.Hackathon.length, 0)
  assert.equal(result.Personal[0].id, 'manual-1')
  assert.equal(result.Personal[0].summary, 'Updated summary')
})

test('legacy saved edits only pin fields that differ from their previous server snapshot', () => {
  const legacy = { ...idea, title: 'Previous title', rawIdea: { id: 1, title: 'Previous title', summary: 'Previous summary' } }
  const [updated] = mergeGeneratedIdeas([legacy], [{ id: 1, title: 'Fresh title', summary: 'Fresh summary' }])
  assert.equal(updated.title, 'Fresh title')
  assert.equal(updated.summary, idea.summary)
})

test('deleted ideas stay removed across polls and workspace reloads', () => {
  const incoming = [{ id: 1, title: 'Deleted idea', summary: '' }, { id: 2, title: 'Keep this idea', summary: '' }]
  const workspace = {
    sessions: [{ name: 'Hackathon', date: 'Today', ideas: 1 }],
    sessionIdeas: { Hackathon: [idea] },
    deletedIdeaIds: ['1'],
  }
  const restored = readWorkspace(JSON.stringify(workspace))
  const refreshed = mergeSessionIdeas(restored.sessionIdeas, incoming, restored.deletedIdeaIds)
  assert.deepEqual(refreshed.Hackathon.map(entry => entry.id), ['engine-2'])
  assert.deepEqual(mergeSessionIdeas(refreshed, incoming, restored.deletedIdeaIds), refreshed)
})

test('deleted manual ideas cannot return through shared backend results', () => {
  const manual = { ...idea, id: 'manual-1', originalId: 'manual-1' }
  const refreshed = mergeSessionIdeas({ Hackathon: [], Personal: [manual] }, [
    { id: 'manual-1', title: 'Late result', summary: '' },
  ], ['manual-1'])
  assert.deepEqual(refreshed, { Hackathon: [], Personal: [] })
})

test('project IDs isolate identical names, delayed results, and renamed projects', () => {
  const current = { 'storm-a': [], 'storm-b': [] }
  const incoming = [
    { id: 'a-idea', session_id: 'storm-a', title: 'Shared title', summary: 'A context' },
    { id: 'b-idea', session_id: 'storm-b', title: 'Shared title', summary: 'B context' },
  ]
  const first = mergeSessionIdeas(current, incoming)
  assert.deepEqual(first['storm-a'].map(idea => idea.summary), ['A context'])
  assert.deepEqual(first['storm-b'].map(idea => idea.summary), ['B context'])
  const saved = readWorkspace(JSON.stringify({
    sessions: [{ id: 'storm-a', name: 'Renamed', date: 'Today', ideas: 1 }, { id: 'storm-b', name: 'Renamed', date: 'Today', ideas: 1 }],
    sessionIdeas: first, activeSession: 'storm-b',
  }))
  assert.equal(saved.activeSession, 'storm-b')
  assert.deepEqual(mergeSessionIdeas(saved.sessionIdeas, incoming), first)
})

test('sample cleanup removes demo content but preserves real projects and stable IDs', async () => {
  const { migrateWorkspace } = await import('./ideaWorkspace.ts')
  const clean = migrateWorkspace({
    sessions: [{ name: 'Hackathon', date: 'Today', ideas: 1 }, { name: 'Agent onboarding', date: 'Today', ideas: 0 }, { name: 'My project', date: 'Today', ideas: 1 }],
    sessionIdeas: { Hackathon: [{ ...idea, id: 'engine-idea_pr_bot_01' }], 'My project': [{ ...idea, id: 'manual' }] },
  })
  assert.deepEqual(clean.sessions.map(session => session.name), ['My project', 'Team discussion'])
  assert.deepEqual(clean.sessionIdeas[clean.sessions[0].id].map(idea => idea.id), ['manual'])
  assert.deepEqual(migrateWorkspace(clean), clean)
  const empty = migrateWorkspace(null)
  assert.equal(empty.sessions[0].name, 'New storm')
  assert.ok(Object.values(empty.sessionIdeas).every(ideas => ideas.length === 0))
})


test('restoring the original discussion clears only its previous cleanup markers once', async () => {
  const { migrateWorkspace } = await import('./ideaWorkspace.ts')
  const original = 'idea_product_recommendation_system_e232e478'
  const restored = migrateWorkspace({ sessions: [], sessionIdeas: {}, deletedIdeaIds: [original, 'unrelated-deletion'], cleanupRevision: 2 })
  assert.ok(!restored.deletedIdeaIds.includes(original))
  assert.ok(restored.deletedIdeaIds.includes('unrelated-deletion'))
  assert.equal(restored.cleanupRevision, 3)
  // A deliberate deletion after restoration must still be respected on reload.
  const deletedLater = migrateWorkspace({ ...restored, deletedIdeaIds: [...restored.deletedIdeaIds, original] })
  assert.ok(deletedLater.deletedIdeaIds.includes(original))
})

test('live focus follows idea flags within each storm without replacing card IDs or manual edits', () => {
  const incoming = [
    { id: 'a', session_id: 'storm-a', title: 'First', summary: 'Original', is_currently_discussed: true },
    { id: 'b', session_id: 'storm-a', title: 'Second', summary: 'Original', is_currently_discussed: false },
    { id: 'c', session_id: 'storm-b', title: 'Other storm', summary: '', is_currently_discussed: true },
  ]
  const initial = mergeSessionIdeas({}, incoming)
  initial['storm-a'][0] = editIdea(initial['storm-a'][0], { title: 'My edited title' })
  const updated = mergeSessionIdeas(initial, incoming.map(idea => ({
    ...idea, summary: 'Updated from speech', is_currently_discussed: idea.id !== 'a',
  })))
  assert.deepEqual(updated['storm-a'].map(idea => idea.id), initial['storm-a'].map(idea => idea.id))
  assert.equal(updated['storm-a'].find(idea => idea.is_currently_discussed).originalId, 'b')
  assert.equal(updated['storm-b'].find(idea => idea.is_currently_discussed).originalId, 'c')
  assert.equal(updated['storm-a'][0].title, 'My edited title')
  const cleared = mergeSessionIdeas(updated, incoming.map(idea => ({ ...idea, is_currently_discussed: false })))
  assert.ok(cleared['storm-a'].every(idea => !idea.is_currently_discussed))
})
