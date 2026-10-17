export type CompetitorItem = {
  name: string
  summary?: string
  differentiator?: string
  idea?: string | null
  yearOfFounding?: string | null
  shortBio?: string | null
  howWeDiffer?: string | null
}

export type CompetitorEnrichment = {
  summary?: string | null
  competitors: CompetitorItem[]
  market_landscape?: string
  our_positioning?: string
  groundingSources?: string[]
  generated_at?: number
}

export type ProConItem = {
  point: string
  category: string
  severity_or_impact: 'High' | 'Medium' | 'Low' | string
  source_context?: string
}

export type ProsConsEnrichment = {
  summary?: string | null
  pros: (ProConItem | string)[]
  cons: (ProConItem | string)[]
  key_risks?: string[]
  assumptions?: string[]
  open_questions?: string[]
  generated_at?: number
}

export type WorkflowEnrichment = {
  summary?: string
  steps?: string[]
  mermaid_code?: string | null
  mermaidCode?: string | null
  image_prompt?: string
  image_url?: string | null
  generated_at?: number
}

export type ArchitectureNode = {
  id: string
  label: string
  description?: string
  component_type?: string
}

export type ArchitectureEdge = {
  source: string
  target: string
  label?: string
}

export type ArchitectureEnrichment = {
  summary?: string
  nodes?: ArchitectureNode[]
  edges?: ArchitectureEdge[]
  mermaid_code?: string
  image_prompt?: string
  image_url?: string | null
  generated_at?: number
}

export type GeneratedIdea = {
  id: string | number
  title: string
  summary: string
  short_summary?: string | null
  thumbnail?: string | null
  is_currently_discussed?: boolean
  transcript?: string | null
  raw_body?: string | null
  transcript_segments?: { chunk_id: string; text: string }[]
  proponents?: string[]
  opponents?: string[]
  competitors?: CompetitorEnrichment | null
  workflow?: WorkflowEnrichment | null
  pros_cons?: ProsConsEnrichment | null
  systemGraph?: ArchitectureEnrichment | null
  status?: string
  metadata?: Record<string, any>
  conclusion?: string | null
  [key: string]: any
}

export type Idea = GeneratedIdea & {
  id: string
  originalId?: string
  title: string
  summary: string
  tag: string
  votes: number
  pattern: string
  thumbnail?: string | null
  locallyEdited?: boolean
  editedFields?: Partial<Record<'title' | 'summary' | 'tag', boolean>>
  rawIdea?: GeneratedIdea
  pendingTextEdit?: { edit_id: string; title?: string; summary?: string }
  textEditsSaved?: boolean
}

export function editedIdeaFields(idea: Idea): NonNullable<Idea['editedFields']> {
  if (idea.editedFields) return idea.editedFields
  if (!idea.locallyEdited) return {}
  // Migrate saved pages from the old all-or-nothing edit flag.
  return {
    title: !idea.rawIdea || idea.title !== idea.rawIdea.title,
    summary: !idea.rawIdea || idea.summary !== idea.rawIdea.summary,
    tag: true,
  }
}

export function editIdea(idea: Idea, fields: Partial<Pick<Idea, 'title' | 'summary' | 'tag'>>): Idea {
  const editedFields = { ...editedIdeaFields(idea) }
  for (const field of ['title', 'summary', 'tag'] as const) {
    if (fields[field] !== undefined) editedFields[field] = true
  }
  const updated = { ...idea, ...fields }
  const hasTextEdits = editedFields.title || editedFields.summary
  return {
    ...updated,
    editedFields,
    locallyEdited: true,
    ...(hasTextEdits ? {
      pendingTextEdit: {
        edit_id: crypto.randomUUID(),
        ...(editedFields.title ? { title: updated.title } : {}),
        ...(editedFields.summary ? { summary: updated.summary } : {}),
      },
    } : {}),
  }
}

export function queueSavedTextEdits(idea: Idea): Idea {
  const fields = editedIdeaFields(idea)
  return !idea.pendingTextEdit && (fields.title || fields.summary) ? editIdea(idea, {}) : idea
}

export type Session = { id: string; name: string; date: string; ideas: number }
export type Workspace = { sessions: Session[]; sessionIdeas: Record<string, Idea[]>; deletedIdeaIds?: string[]; deletedSessionIds?: string[]; activeSession?: string; cleanupRevision?: number }
export const workspaceKey = 'brainy-storm.workspace.v1'

export function readWorkspace(raw: string | null): Workspace | null {
  try {
    const data = JSON.parse(raw || 'null')
    if (!data || !Array.isArray(data.sessions) || !data.sessionIdeas || typeof data.sessionIdeas !== 'object' || Array.isArray(data.sessionIdeas)) return null
    if (!data.sessions.every((s: Session) => s && (s.id === undefined || typeof s.id === 'string') && typeof s.name === 'string' && typeof s.date === 'string' && typeof s.ideas === 'number')) return null
    if (data.deletedIdeaIds !== undefined && (!Array.isArray(data.deletedIdeaIds) || !data.deletedIdeaIds.every((id: unknown) => typeof id === 'string'))) return null
    if (data.deletedSessionIds !== undefined && (!Array.isArray(data.deletedSessionIds) || !data.deletedSessionIds.every((id: unknown) => typeof id === 'string'))) return null
    if (!Object.values(data.sessionIdeas).every(ideas => Array.isArray(ideas) && ideas.every(idea => idea && ['id', 'title', 'summary', 'tag', 'pattern'].every(key => typeof idea[key] === 'string') && typeof idea.votes === 'number' && (idea.thumbnail == null || typeof idea.thumbnail === 'string')))) return null
    return data as Workspace
  } catch { return null }
}

// Old capture cards contained boilerplate rather than an actual idea.
export function hasIdeaContent(idea: Pick<GeneratedIdea, 'title' | 'summary'>): boolean {
  const title = idea.title.trim()
  const summary = idea.summary.trim()
  if (summary === 'A fresh thought from the room. Add context as the conversation unfolds.'
    && /^A new idea .*shape$/i.test(title)) return false
  return Boolean(title || summary)
}

export function mergeGeneratedIdeas(current: Idea[], incoming: GeneratedIdea[]): Idea[] {
  current = current.filter(hasIdeaContent)
  incoming = incoming.filter(hasIdeaContent)
  const merged: Idea[] = incoming.map((idea, index) => {
    const previous = current.find(entry => entry.id === `engine-${idea.id}` || entry.id === String(idea.id))
    const acknowledged = Boolean(previous?.pendingTextEdit && idea.transcript_segments?.some(segment => segment.chunk_id === `text-edit:${previous.pendingTextEdit?.edit_id}`))
    const editedFields = previous ? { ...editedIdeaFields(previous) } : {}
    if (acknowledged) { editedFields.title = false; editedFields.summary = false }
    return {
      ...idea,
      rawIdea: idea,
      id: previous?.id || `engine-${idea.id}`,
      originalId: String(idea.id),
      tag: previous?.tag || 'From the conversation',
      votes: previous?.votes || 0,
      pattern: previous?.pattern || ['orbit', 'grid', 'signal'][index % 3],
      thumbnail: idea.thumbnail ?? previous?.thumbnail,
      editedFields,
      locallyEdited: Object.values(editedFields).some(Boolean),
      pendingTextEdit: acknowledged ? undefined : previous?.pendingTextEdit,
      textEditsSaved: acknowledged || previous?.textEditsSaved,
      ...(editedFields.title && previous ? { title: previous.title } : {}),
      ...(editedFields.summary && previous ? { summary: previous.summary } : {}),
    }
  })
  const updates = new Map(merged.map(idea => [idea.id, idea]))
  const existingIds = new Set(current.map(idea => idea.id))
  return [
    ...current.filter(idea => updates.has(idea.id) || !idea.id.startsWith('engine-') || idea.locallyEdited).map(idea => updates.get(idea.id) || idea),
    ...merged.filter(idea => !existingIds.has(idea.id)),
  ]
}

// Session IDs, unlike display names, never change when a storm is renamed.
export function mergeSessionIdeas(current: Record<string, Idea[]>, incoming: GeneratedIdea[], deletedIdeaIds: string[] = [], deletedSessionIds: string[] = []): Record<string, Idea[]> {
  const deleted = new Set(deletedIdeaIds)
  const deletedSessions = new Set(deletedSessionIds)
  const idOf = (idea: Idea) => idea.originalId || idea.id.replace(/^engine-/, '')
  const owners = new Map(Object.entries(current).flatMap(([sessionId, ideas]) => ideas.map(idea => [idOf(idea), sessionId] as const)))
  const grouped: Record<string, GeneratedIdea[]> = {}
  for (const idea of incoming) {
    if (deleted.has(String(idea.id))) continue
    const sessionId = idea.session_id || owners.get(String(idea.id)) || 'Hackathon'
    if (deletedSessions.has(sessionId)) continue
    ;(grouped[sessionId] ??= []).push(idea)
  }
  return Object.fromEntries([...new Set([...Object.keys(current), ...Object.keys(grouped)])].filter(id => !deletedSessions.has(id)).map(sessionId => [
    sessionId,
    mergeGeneratedIdeas((current[sessionId] || []).filter(idea => !deleted.has(idOf(idea))), grouped[sessionId] || []),
  ]))
}

export function deleteWorkspaceSession(workspace: Workspace, sessionId: string): Workspace {
  const sessions = workspace.sessions.filter(session => session.id !== sessionId)
  if (!sessions.length) sessions.push({ id: crypto.randomUUID(), name: 'New storm', date: 'Just now', ideas: 0 })
  const sessionIdeas = { ...workspace.sessionIdeas }
  const removedIdeas = sessionIdeas[sessionId] || []
  delete sessionIdeas[sessionId]
  for (const session of sessions) sessionIdeas[session.id] ??= []
  return {
    ...workspace, sessions, sessionIdeas,
    activeSession: workspace.activeSession === sessionId ? sessions[0].id : workspace.activeSession,
    deletedSessionIds: [...new Set([...(workspace.deletedSessionIds || []), sessionId])],
    deletedIdeaIds: [...new Set([...(workspace.deletedIdeaIds || []), ...removedIdeas.map(idea => idea.originalId || idea.id.replace(/^engine-/, ''))])],
  }
}

const sampleIdeaIds = [
  "idea_pr_bot_01",
  "idea_ai_powered_tiramisu_shop_8790e34f",
  "idea_ai_fashion_garment_visualization_9c201734",
  "idea_zurich_flat_finder_startup_f5b2474f",
  "idea_ai_girlfriend_avatar_consultant_80a8644b"
]
const restoredIdeaIds = new Set(['idea_product_recommendation_system_e232e478', 'idea_hackathon_networking_matchmaker_5fe7fb21', 'idea_autonomous_gaming_agent_419e45f2', 'idea_qr_code_conversation_starters_8c85c65c', 'idea_brainstorming_idea_and_decision_tracker_ee02d79b'])
const sampleSessions = new Set(['Hackathon', 'Agent onboarding', 'Community launch', 'A better daily standup'])

export function migrateWorkspace(saved: Workspace | null): Workspace {
  const deletedSessionIds = saved?.deletedSessionIds || []
  const deletedIdeaIds = [...new Set([...(saved?.deletedIdeaIds || []).filter(id => saved?.cleanupRevision === 3 || !restoredIdeaIds.has(id)), ...sampleIdeaIds])]
  const deleted = new Set(deletedIdeaIds)
  const sessions: Session[] = []
  const sessionIdeas: Record<string, Idea[]> = {}
  for (const session of saved?.sessions || []) {
    if (deletedSessionIds.includes(session.id || session.name)) continue
    const ideas = (saved?.sessionIdeas[session.id || session.name] || []).filter(idea => hasIdeaContent(idea) && !deleted.has(idea.originalId || idea.id.replace(/^engine-/, '')))
    if (!session.id && !ideas.length && (sampleSessions.has(session.name) || /^New brainstorm \d+$/.test(session.name))) continue
    const id = session.id || (session.name === 'Hackathon' ? 'team-discussion' : crypto.randomUUID())
    sessions.push({ ...session, id, name: session.name.trim() || 'New storm' })
    sessionIdeas[id] = ideas.map(queueSavedTextEdits)
  }
  if (!sessions.length) sessions.push({ id: crypto.randomUUID(), name: 'New storm', date: 'Just now', ideas: 0 })
  if (!deletedSessionIds.includes('team-discussion') && !sessions.some(session => session.id === 'team-discussion')) sessions.push({ id: 'team-discussion', name: 'Team discussion', date: 'Saved', ideas: 5 })
  for (const session of sessions) sessionIdeas[session.id] ??= []
  return { sessions, sessionIdeas, deletedIdeaIds, deletedSessionIds, cleanupRevision: 3, activeSession: sessions.some(session => session.id === saved?.activeSession) ? saved?.activeSession : sessions[0].id }
}
