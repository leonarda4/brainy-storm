import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { ideaParticipants, sessionParticipants } from './ideaParticipants.ts'
import { speakerAppearance } from './transcript.ts'

test('counts distinct people across repeated names, roles, and attributed arguments', () => {
  const people = ideaParticipants([
    'Sarah (Principal Architect)', 'sarah: Supports the prototype.',
    'Alex expressed clear personal support for the concept.',
    'Leonarda, who believes attendees will share details',
    'Alex supported the idea and proposed an MVP.',
    'Leonarda argues registration provides an incentive.',
  ])
  assert.deepEqual(people.map(person => person.name), ['Sarah', 'Alex', 'Leonarda'])
  assert.equal(people[0].color, speakerAppearance('Sarah').color)
})

test('ignores absent opposition, anonymous groups, and unattributed arguments', () => {
  assert.deepEqual(ideaParticipants([
    '', 'None: No critical objections were raised.', 'Unknown speaker',
    'Unidentified Speaker (advocating cost reductions)',
    'Event/Concept Proponent: Advocates hosting parties.',
    'Enthusiastic Supporters: Back the project.',
    'Lower operating costs', 'High API costs undermine feasibility.',
    "Minimalist opposition (Giacomo's view implies skepticism toward complex tooling)",
    'Minimal opposition', 'No opposition', 'General consensus',
    'Technical skeptics: Concerned about complexity.',
  ]), [])
  assert.deepEqual(ideaParticipants(), [])
})

test('preserves full names and distinct unnamed voices with consistent avatars', () => {
  const people = ideaParticipants([
    'Zoë O’Connor: Supports testing.', 'Zoë O’Connor (Designer): Supports an MVP.',
    'Speaker 2: Recommends a prototype.', 'Speaker 4 (questions feasibility)',
    'Speaker 4: Challenges technical depth.',
  ])
  assert.deepEqual(people.map(person => person.name), ['Zoë O’Connor', 'Speaker 2', 'Speaker 4'])
  assert.deepEqual(people.map(person => person.initials), ['ZO', '?', '?'])
  assert.equal(people[1].color, speakerAppearance('Speaker 2').color)
})

let server
let IdeaStances
before(async () => {
  server = await createServer({
    configFile: false, plugins: [react()],
    server: { middlewareMode: true, watch: null, ws: false },
  })
  ;({ IdeaStances } = await server.ssrLoadModule('/src/components/IdeaStances.tsx'))
})
after(async () => { await server?.close() })
const render = idea => renderToStaticMarkup(createElement(IdeaStances, { idea }))

test('support and opposition each display at most one avatar and one overflow badge', () => {
  const html = render({
    proponents: ['Maya', 'Alex', 'Zoë', 'Maya: Supports testing.'],
    opponents: ['Giacomo', 'Leonarda'],
  })
  assert.ok(html.includes('aria-label="3 supporters: Maya, Alex, Zoë"'))
  assert.ok(html.includes('aria-label="2 opponents: Giacomo, Leonarda"'))
  assert.equal((html.match(/class="avatar /g) || []).length, 2)
  assert.equal((html.match(/class="member-more"/g) || []).length, 2)
  assert.ok(html.includes('>+2</span>'))
  assert.ok(html.includes('>+1</span>'))
  assert.ok(!html.includes('<button'), 'Conversation stance counts are not manual votes')
})

test('single supporters have no overflow and empty stance groups stay hidden', () => {
  assert.equal(render({}), '')
  const html = render({ proponents: ['Maya'], opponents: ['None: No objections.'] })
  assert.ok(html.includes('1 supporter: Maya'))
  assert.ok(!html.includes('idea-opponents'))
  assert.ok(!html.includes('member-more'))
  const opposed = render({ opponents: ['Alex: Rejects the proposal.'] })
  assert.ok(opposed.includes('1 opponent: Alex'))
  assert.ok(!opposed.includes('idea-supporters'))
})

test('descriptions of opposition never create an opponent avatar, count, or session participant', () => {
  const opponents = ["Minimalist opposition (Giacomo's view implies skepticism toward complex tooling)"]
  assert.equal(render({ opponents }), '')
  assert.deepEqual(sessionParticipants([], opponents), [])
  const html = render({ proponents: ['Leonarda'], opponents })
  assert.ok(html.includes('1 supporter: Leonarda'))
  assert.ok(!html.includes('idea-opponents'))
  assert.ok(!html.includes('Minimalist opposition'))
})
