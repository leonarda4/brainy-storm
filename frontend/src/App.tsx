import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Menu,
  Columns3,
  LayoutGrid,
  AudioLines,
  Clock3,
  ChevronDown,
  ChevronRight,
  Command,
  Folder,
  FolderOpen,
  Search,
  FileText,
  MoreHorizontal,
  Play,
  Pause,
  RotateCcw,
  Download,
  Plus,
  X,
} from 'lucide-react'
import './App.css'
import brandLogo from './assets/brainy-storm-logo.svg'
import { FlyingAgent } from './FlyingAgent'
import { BrainyPlaceholder } from './components/BrainyPlaceholder'
import { IdeaThumbnail } from './components/IdeaThumbnail'
import { StormPresence } from './StormPresence'
import './enrichedView.css'
import { BrandShape, RecordingShape } from './BrandShape'
import { EditableIdea } from './EditableIdea'
import { AvatarGroup } from './AvatarGroup'
import { Avatar } from './Avatar'
import { TranscriptContent } from './TranscriptContent'
import { IdeaCardMenu } from './components/IdeaCardMenu'
import { StormMenu } from './components/StormMenu'
import { IdeaStances } from './components/IdeaStances'
import { IdeaAnalysis } from './components/IdeaAnalysis'
import { deleteWorkspaceSession, editIdea, mergeSessionIdeas, migrateWorkspace, readWorkspace, workspaceKey } from './ideaWorkspace'
import type { GeneratedIdea, Idea, Session } from './ideaWorkspace'
import { useTranscription } from './useTranscription'
import { useIdeaTextSync } from './useIdeaTextSync'
import { sessionParticipants } from './ideaParticipants'
import { createBrainyFocus } from './brainyFocus'
import { useBrainyActivity } from './useBrainyActivity'
import { stormPresentation } from './stormPresentation'

function thumbnailUrl(thumbnail?: string | null) {
  if (!thumbnail || /^(?:https?:|data:|blob:)/.test(thumbnail)) return thumbnail || ''
  const base = (import.meta.env.VITE_IDEAS_URL || import.meta.env.VITE_ENRICHMENT_URL || '/api/enrichment').replace(/\/$/, '')
  return thumbnail.startsWith('/ideas/') ? `${base}${thumbnail}` : thumbnail
}

function App() {
  const [restored] = useState(() => {
    try { return migrateWorkspace(readWorkspace(localStorage.getItem(workspaceKey))) } catch { return migrateWorkspace(null) }
  })
  const [storageError, setStorageError] = useState(false)
  const [sessions, setSessions] = useState(restored.sessions)
  const [activeSession, setActiveSession] = useState(restored.activeSession || restored.sessions[0].id)
  const [search, setSearch] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const [deletedIdeaIds, setDeletedIdeaIds] = useState<string[]>(restored.deletedIdeaIds || [])
  const [deletedSessionIds, setDeletedSessionIds] = useState<string[]>(restored.deletedSessionIds || [])
  const [sessionIdeas, setSessionIdeas] = useState<Record<string, Idea[]>>(restored.sessionIdeas)
  const [switching, setSwitching] = useState(false)
  const switchingRef = useRef(false)
  const activeProject = sessions.find(session => session.id === activeSession)!
  const textSyncErrors = useIdeaTextSync(sessionIdeas)
  const [expanded, setExpanded] = useState<string[]>([activeSession])
  const [restarting, setRestarting] = useState(false)
  const [restartError, setRestartError] = useState('')
  const restartDialog = useRef<HTMLDialogElement>(null)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const [ideaToDelete, setIdeaToDelete] = useState<Idea | null>(null)
  const stormDeleteDialog = useRef<HTMLDialogElement>(null)
  const [stormToDelete, setStormToDelete] = useState<Session | null>(null)
  const [deletingStorm, setDeletingStorm] = useState(false)
  const [deleteStormError, setDeleteStormError] = useState('')
  const pollingGeneration = useRef(0)
  const resetInProgress = useRef(false)
  const [layout, setLayout] = useState<'horizontal' | 'grid'>('horizontal')
  const ideas = sessionIdeas[activeSession] || []
  const processingNewIdea = useBrainyActivity(activeSession, ideas)
  const setIdeas = (update: (current: Idea[]) => Idea[]) => setSessionIdeas(current => ({ ...current, [activeSession]: update(current[activeSession] || []) }))
  const [selectedIdea, setSelectedIdea] = useState<string | null>(null)
  const { transcript, recording, error: transcriptionError, speakerWarning, stormWarning, storm, cancelStorm, elapsedSeconds, startRecording, stopRecording, finishRecording, restartTranscript, exportTranscript } = useTranscription(activeSession)
  const { recordingActive, emptyStormThinking, memoInWelcome } = stormPresentation(recording, ideas.length, transcript.length, processingNewIdea)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [compactNavigation, setCompactNavigation] = useState(() => window.matchMedia('(max-width: 1160px)').matches)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const navigationRef = useRef<HTMLElement>(null)
  const navigationToggleRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1160px)')
    const update = () => { setCompactNavigation(media.matches); setNavigationOpen(false); setTranscriptOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!navigationOpen) return
    const toggle = navigationToggleRef.current
    const panel = navigationRef.current
    panel?.querySelector<HTMLButtonElement>('button')?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setNavigationOpen(false); return }
      if (event.key !== 'Tab') return
      const items = Array.from(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), input, summary, [tabindex="0"]') || []).filter(item => item.getClientRects().length > 0)
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); toggle?.focus() }
  }, [navigationOpen])
  const transcriptFeedRef = useRef<HTMLDivElement>(null)
  const discussedCardRef = useRef<HTMLElement | null>(null)
  const boardRef = useRef<HTMLElement | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
  const brainyFocusRef = useRef<ReturnType<typeof createBrainyFocus> | null>(null)
  const transitioning = recording === 'connecting' || recording === 'saving' || restarting || switching || deletingStorm
  const recordingLabel = recording === 'connecting' ? 'Starting…' : recording === 'saving' ? 'Pausing…' : recording === 'recording' ? 'Pause' : recording === 'paused' ? 'Resume' : 'Start recording'
  const recordingIcon = recording === 'recording' || recording === 'saving' ? <Pause size={13} /> : <Play size={14} fill="currentColor" />
  const toggleRecording = () => recording === 'recording' ? stopRecording(true) : void startRecording()

  useEffect(() => {
    try {
      localStorage.setItem(workspaceKey, JSON.stringify({ sessions, sessionIdeas, deletedIdeaIds, deletedSessionIds, activeSession, cleanupRevision: restored.cleanupRevision }))
      // Report the result of synchronizing with browser storage.
      // oxlint-disable-next-line react/set-state-in-effect
      setStorageError(false)
    } catch { setStorageError(true) }
  }, [sessions, sessionIdeas, deletedIdeaIds, deletedSessionIds, activeSession, restored.cleanupRevision])

  useLayoutEffect(() => {
    const feed = transcriptFeedRef.current
    if (feed) feed.scrollTop = feed.scrollHeight
  }, [transcript, transcriptOpen, recording])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let refreshDelay = 3000
    async function refresh() {
      if (resetInProgress.current) { timer = setTimeout(refresh, 3000); return }
      const generation = pollingGeneration.current
      try {
        const base = (import.meta.env.VITE_ENRICHMENT_URL || '/api/enrichment').replace(/\/$/, '')
        const response = await fetch(`${base}/ideas`, {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
        })
        if (!response.ok) throw new Error('Could not load generated ideas.')
        const payload = await response.json() as GeneratedIdea[] | { ideas: GeneratedIdea[] }
        const data = Array.isArray(payload) ? payload : payload.ideas
        if (!Array.isArray(data) || data.some(idea => !idea || !['string', 'number'].includes(typeof idea.id) || typeof idea.title !== 'string' || typeof idea.summary !== 'string')) {
          throw new Error('Invalid generated ideas response.')
        }
        if (controller.signal.aborted || generation !== pollingGeneration.current) return
        setSessionIdeas(current => mergeSessionIdeas(current, data, deletedIdeaIds, deletedSessionIds))
        refreshDelay = 3000
      } catch {
        if (!controller.signal.aborted && generation === pollingGeneration.current) {
          refreshDelay = Math.min(refreshDelay * 2, 30000)
        }
      } finally {
        if (!controller.signal.aborted) {
          timer = setTimeout(refresh, refreshDelay)
        }
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [deletedIdeaIds, deletedSessionIds])

  const query = search.trim().toLowerCase()
  const matchesIdea = (idea: Idea) => `${idea.title} ${idea.summary}`.toLowerCase().includes(query)
  const visibleSessions = sessions.filter(session => session.name.toLowerCase().includes(query) || (sessionIdeas[session.id] || []).some(matchesIdea))
  const currentIdea = ideas.find(idea => idea.id === selectedIdea)

  const visibleFocusedIdeaId = !currentIdea
    ? ideas.find(idea => idea.is_currently_discussed)?.id
    : undefined
  const showingIdea = Boolean(currentIdea)

  useLayoutEffect(() => {
    if (showingIdea || !boardRef.current) return
    const focus = createBrainyFocus(boardRef.current)
    brainyFocusRef.current = focus
    return () => { focus.dispose(); brainyFocusRef.current = null }
  }, [activeSession, showingIdea])

  useLayoutEffect(() => {
    const container = layout === 'horizontal' ? railRef.current : boardRef.current
    const card = discussedCardRef.current
    brainyFocusRef.current?.setTarget(visibleFocusedIdeaId && container && card
      ? { container, card, horizontal: layout === 'horizontal' } : null)
  }, [visibleFocusedIdeaId, layout, activeSession, showingIdea])

  const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')
  const seconds = String(elapsedSeconds % 60).padStart(2, '0')

  async function createSession() {
    if (switchingRef.current || transitioning) return
    switchingRef.current = true
    setSwitching(true)
    try {
      await finishRecording()
      const id = crypto.randomUUID()
      setSessions(current => [{ id, name: 'New storm', date: 'Just now', ideas: 0 }, ...current])
      setSessionIdeas(current => ({ ...current, [id]: [] }))
      setNavigationOpen(false)
      setActiveSession(id)
      setExpanded(current => [...current, id])
      setSearch('')
      setSelectedIdea(null)
      setRestartError('')
    } catch (error) {
      setRestartError(error instanceof Error ? error.message : 'Could not finish saving this storm.')
    } finally {
      switchingRef.current = false
      setSwitching(false)
    }
  }

  function renameSession(name: string) {
    setSessions(current => current.map(session => session.id === activeSession ? { ...session, name } : session))
  }

  function downloadMemory() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ideas, transcript }, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'storm-memory.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function restartBrainstorm() {
    resetInProgress.current = true
    setRestarting(true)
    setRestartError('')
    pollingGeneration.current += 1
    try {
      await restartTranscript()
      restartDialog.current?.close()
      await startRecording()
    } catch (error) {
      setRestartError(error instanceof Error ? error.message : 'Could not restart. Please try again.')
    } finally {
      pollingGeneration.current += 1
      resetInProgress.current = false
      setRestarting(false)
    }
  }

  async function openSession(id: string, ideaId: string | null = null) {
    if (switchingRef.current || transitioning) return
    if (id === activeSession) { setSelectedIdea(ideaId); setNavigationOpen(false); return }
    switchingRef.current = true
    setSwitching(true)
    try {
      await finishRecording()
      setNavigationOpen(false)
      setActiveSession(id)
      setSelectedIdea(ideaId)
      setExpanded(current => current.includes(id) ? current : [...current, id])
      setRestartError('')
    } catch (error) {
      setRestartError(error instanceof Error ? error.message : 'Could not finish saving this storm.')
    } finally {
      switchingRef.current = false
      setSwitching(false)
    }
  }

  function deleteIdea() {
    if (!ideaToDelete) return
    const id = ideaToDelete.originalId || ideaToDelete.id.replace(/^engine-/, '')
    setDeletedIdeaIds(current => [...new Set([...current, id])])
    setSessionIdeas(current => Object.fromEntries(Object.entries(current).map(([name, entries]) => [name, entries.filter(idea => (idea.originalId || idea.id.replace(/^engine-/, '')) !== id)])))
    if (selectedIdea === ideaToDelete.id) setSelectedIdea(null)
    deleteDialog.current?.close()
  }

  async function deleteStorm() {
    if (!stormToDelete || transitioning || switchingRef.current) return
    setDeletingStorm(true)
    setDeleteStormError('')
    resetInProgress.current = true
    pollingGeneration.current += 1
    try {
      if (stormToDelete.id === activeSession) await finishRecording()
      const next = deleteWorkspaceSession({ sessions, sessionIdeas, deletedIdeaIds, deletedSessionIds, activeSession, cleanupRevision: restored.cleanupRevision }, stormToDelete.id)
      // Persist first: a storage failure must leave the storm available to retry.
      localStorage.setItem(workspaceKey, JSON.stringify(next))
      setSessions(next.sessions)
      setSessionIdeas(next.sessionIdeas)
      setDeletedIdeaIds(next.deletedIdeaIds || [])
      setDeletedSessionIds(next.deletedSessionIds || [])
      setActiveSession(next.activeSession || next.sessions[0].id)
      setExpanded(current => [...new Set([...current.filter(id => id !== stormToDelete.id), next.activeSession || next.sessions[0].id])])
      if (stormToDelete.id === activeSession) setSelectedIdea(null)
      setSearch('')
      stormDeleteDialog.current?.close()
    } catch (error) {
      setDeleteStormError(error instanceof Error ? error.message : 'Could not delete this storm. Please try again.')
    } finally {
      pollingGeneration.current += 1
      resetInProgress.current = false
      setDeletingStorm(false)
    }
  }

  const collaboratorActions = (
    <div className="collaborator-actions">
      <AvatarGroup participants={sessionParticipants(transcript, ideas.flatMap(idea => [...(idea.proponents || []), ...(idea.opponents || [])]))} />
      {!currentIdea && <div className="layout-picker" role="group" aria-label="Card layout">
        <button type="button" aria-label="Horizontal layout" title="Horizontal layout" aria-pressed={layout === 'horizontal'} onClick={() => setLayout('horizontal')}><Columns3 size={16} /></button>
        <button type="button" aria-label="Grid layout" title="Grid layout" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}><LayoutGrid size={16} /></button>
      </div>}
      <button type="button" className="icon-button transcript-toggle" onClick={() => setTranscriptOpen(true)} aria-label="Open transcript"><AudioLines size={16} /></button>
    </div>
  )

  return (
    <div className="app-shell">
      <dialog ref={stormDeleteDialog} className="restart-dialog" aria-labelledby="delete-storm-title" aria-describedby="delete-storm-description" onClose={() => setStormToDelete(null)} onCancel={event => { if (deletingStorm) event.preventDefault() }}>
        <button type="button" className="icon-button restart-dialog-close" aria-label="Cancel storm deletion" disabled={deletingStorm} onClick={() => stormDeleteDialog.current?.close()}><X size={18} /></button>
        <h2 id="delete-storm-title">Delete this storm?</h2>
        <p id="delete-storm-description">Remove “{stormToDelete?.name || 'New storm'}” and all its ideas and transcript from your workspace?</p>
        {deleteStormError && <p role="alert">{deleteStormError}</p>}
        <div className="restart-actions">
          <button type="button" className="record-control primary-control destructive-control" disabled={transitioning} onClick={() => void deleteStorm()}>{deletingStorm ? 'Deleting…' : 'Delete storm'}</button>
          <button type="button" className="outline-button" disabled={deletingStorm} onClick={() => stormDeleteDialog.current?.close()}>Cancel</button>
        </div>
      </dialog>
      <dialog ref={deleteDialog} className="restart-dialog" aria-labelledby="delete-idea-title" aria-describedby="delete-idea-description" onClose={() => setIdeaToDelete(null)}>
        <button type="button" className="icon-button restart-dialog-close" aria-label="Cancel deletion" onClick={() => deleteDialog.current?.close()}><X size={18} /></button>
        <h2 id="delete-idea-title">Are you sure?</h2>
        <p id="delete-idea-description">Delete “{ideaToDelete?.title || 'Untitled idea'}” from your workspace?</p>
        <div className="restart-actions">
          <button type="button" className="record-control primary-control" onClick={deleteIdea}>Delete idea</button>
          <button type="button" className="outline-button" onClick={() => deleteDialog.current?.close()}>Cancel</button>
        </div>
      </dialog>
      <dialog ref={restartDialog} className="restart-dialog" aria-labelledby="restart-title" onCancel={event => { if (restarting) event.preventDefault() }}>
        <button type="button" className="icon-button restart-dialog-close" aria-label="Cancel restart" disabled={restarting} onClick={() => restartDialog.current?.close()}><X size={18} /></button>
        <h2 id="restart-title">Restart recording?</h2>
        <p>Clear the transcript and start recording again?</p>
        <p>Your saved ideas stay in the sidebar. Download your memory first if you want to keep the transcript.</p>
        {restartError && <p role="alert">{restartError}</p>}
        <div className="restart-actions">
          <button className="record-control primary-control" disabled={restarting} onClick={() => void restartBrainstorm()}>{restarting ? 'Restarting…' : 'Clear transcript and restart'}</button>
          <button className="outline-button" disabled={restarting} onClick={downloadMemory}><Download size={14} /> Download memory</button>
        </div>
      </dialog>
      <aside ref={navigationRef} id="workspace-navigation" className={`session-sidebar ${navigationOpen ? 'navigation-open' : ''}`} aria-label="Your storms" role={compactNavigation ? 'dialog' : undefined} aria-modal={compactNavigation && navigationOpen ? true : undefined} inert={compactNavigation && !navigationOpen}>
        <div className="navigation-heading"><div className="wordmark"><img className="brand-logo" src={brandLogo} alt="brainy storm" width="338" height="95" /></div><button type="button" className="icon-button navigation-close" aria-label="Close navigation" onClick={() => setNavigationOpen(false)}><X size={20} /></button></div>
        <button type="button" className="new-session-button" onClick={() => void createSession()} disabled={transitioning} aria-label="New storm">
          <Plus size={16} />
          <span>New storm</span>
          <span className="shortcut"><Command size={11} /> K</span>
        </button>

        <div className="session-search">
          <Search size={16} />
          <input
            ref={searchInput}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search"
            aria-label="Search"
          />
          {search ? <button type="button" className="icon-button search-clear" aria-label="Clear search" title="Clear search" onClick={() => {
            setSearch('')
            searchInput.current?.focus()
          }}><X size={14} /></button> : <span className="search-shortcut">⌘ /</span>}
        </div>

        <nav className="session-list-area" aria-label="Your storms and ideas">
          <div className="session-list">
            {visibleSessions.map(session => {
              const open = Boolean(query) || expanded.includes(session.id)
              const children = (sessionIdeas[session.id] || []).filter(idea => !query || session.name.toLowerCase().includes(query) || matchesIdea(idea))
              return <div className="brainstorm-folder" key={session.id}>
                <div className={`folder-row ${activeSession === session.id && !currentIdea ? 'active' : ''}`}>
                  <button type="button" className="folder-toggle" aria-label={`${open ? 'Collapse' : 'Expand'} ${session.name}`} aria-expanded={open} onClick={() => setExpanded(current => current.includes(session.id) ? current.filter(id => id !== session.id) : [...current, session.id])}>
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <button type="button" className="session-item" title={session.name || 'New storm'} disabled={transitioning} onClick={() => void openSession(session.id)}>
                    {open ? <FolderOpen size={15} /> : <Folder size={15} />}<span className="session-name">{session.name || 'New storm'}</span>
                  </button>
                  <StormMenu name={session.name || 'New storm'} disabled={transitioning} onDelete={() => { setStormToDelete(session); setDeleteStormError(''); stormDeleteDialog.current?.showModal() }} />
                </div>
                {open && <div className="folder-ideas">
                  {children.map(idea => <button key={idea.id} type="button" className={`idea-nav-item ${activeSession === session.id && selectedIdea === idea.id ? 'active' : ''}`} aria-current={activeSession === session.id && selectedIdea === idea.id ? 'page' : undefined} title={idea.title} disabled={transitioning} onClick={() => void openSession(session.id, idea.id)}><span>{idea.title || 'Untitled idea'}</span></button>)}
                  {children.length === 0 && <p className="empty-folder">No ideas yet</p>}
                </div>}
              </div>
            })}
            {visibleSessions.length === 0 && <p className="empty-search">No storms or ideas found</p>}
          </div>
        </nav>
        <button type="button" className="outline-button navigation-transcript" onClick={() => { setNavigationOpen(false); setTranscriptOpen(true) }}><AudioLines size={18} /> Transcript</button>
        <div className="sidebar-bottom">
          <button type="button" className="profile-row" aria-label="Leonarda Lovrić profile">
            <Avatar className="profile-avatar" initials="LL" color="avatar-self" />
            <span className="profile-copy"><strong>Leonarda Lovrić</strong><small>Personal workspace</small></span>
            <MoreHorizontal size={17} />
          </button>
        </div>
      </aside>

      {navigationOpen && <button type="button" className="navigation-scrim" tabIndex={-1} aria-label="Close navigation" onClick={() => setNavigationOpen(false)} />}
      <main className="main-column" inert={compactNavigation && navigationOpen}>
        <header className="compact-topbar">
          <button ref={navigationToggleRef} type="button" className="icon-button" aria-label="Open navigation" aria-expanded={navigationOpen} aria-controls="workspace-navigation" onClick={() => { setTranscriptOpen(false); setNavigationOpen(true) }}><Menu size={22} /></button>
          <span className="compact-wordmark"><img className="brand-logo" src={brandLogo} alt="brainy storm" width="338" height="95" /></span>
        </header>
        <section ref={boardRef} className={`board-scroll ${!currentIdea && layout === 'horizontal' ? 'horizontal-board' : ''}`}>
          <div className="board-content">
            {currentIdea ? <article className="idea-page">
              <div className="idea-page-banner">
                <BrandShape variant={ideas.findIndex(idea => idea.id === currentIdea.id)} />
                {currentIdea.thumbnail && <IdeaThumbnail key={currentIdea.thumbnail} src={thumbnailUrl(currentIdea.thumbnail)} />}
              </div>
              <div className="idea-page-toolbar"><button type="button" className="idea-back-button" onClick={() => setSelectedIdea(null)}>← Back to {activeProject.name || 'New storm'}</button>{collaboratorActions}</div>
              <EditableIdea key={currentIdea.id} idea={currentIdea} storageError={storageError} syncError={Boolean(currentIdea.pendingTextEdit && textSyncErrors[currentIdea.id])} onChange={fields => setIdeas(current => current.map(idea => idea.id === currentIdea.id ? editIdea(idea, fields) : idea))} />
            </article> : <>
            <div className="board-heading-row">
              <div>

                <h1 className="project-title"><input aria-label="Name of this storm" value={activeProject.name} placeholder="New storm"
                  onChange={event => renameSession(event.target.value)}
                  onBlur={() => renameSession(activeProject.name.trim() || 'New storm')}
                  onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></h1>
                {storageError && <p className="transcript-warning" role="alert">Could not save your storm in this browser.</p>}
              </div>
              {collaboratorActions}
            </div>

            {ideas.length > 0 ? (
              <div ref={railRef} className={`idea-grid ${layout === 'horizontal' ? 'idea-rail' : ''}`} tabIndex={0} role="region" aria-label="Ideas">
                {ideas.map((idea, index) => (
                  <article
                    key={idea.id}
                    ref={visibleFocusedIdeaId === idea.id ? discussedCardRef : undefined}
                    className={`idea-card ${visibleFocusedIdeaId === idea.id ? 'discussion-focus' : ''}`}
                    tabIndex={0}
                    aria-label={idea.title || 'Untitled idea'}
                    aria-current={visibleFocusedIdeaId === idea.id ? 'true' : undefined}
                  >
                    <div className={`idea-art art-${idea.pattern}`}>
                      {visibleFocusedIdeaId === idea.id && <div className="brainy-status-label discussion-badge" role="status">Brainy · Discussing now</div>}
                      {!processingNewIdea && (visibleFocusedIdeaId === idea.id || (!visibleFocusedIdeaId && index === ideas.length - 1)) && <div className="card-brainy-target" data-agent-target="Brainy" data-agent-scale="0.65" data-agent-wander="near" />}
                      <BrandShape variant={index} />
                      {idea.thumbnail && <IdeaThumbnail key={idea.thumbnail} src={thumbnailUrl(idea.thumbnail)} />}
                    </div>
                    <div className="idea-card-body">
                      <div className="idea-card-topline">
                        <IdeaStances idea={idea} />
                        <IdeaCardMenu idea={idea} onDelete={() => { setIdeaToDelete(idea); deleteDialog.current?.showModal() }} />
                      </div>
                      <h3><button type="button" className="idea-title-button" onClick={() => setSelectedIdea(idea.id)}>{idea.title || 'Untitled idea'}</button></h3>
                      <p>{idea.summary}</p>
                      {layout === 'horizontal' && <div className="enriched-idea-container idea-card-analysis"><IdeaAnalysis idea={idea} /></div>}
                    </div>
                  </article>
                ))}
                {processingNewIdea && <BrainyPlaceholder key={activeSession} started active control={null} />}
              </div>
            ) : (
              <BrainyPlaceholder key={activeSession} started={emptyStormThinking} active={emptyStormThinking} control={
                <button className="record-control primary-control" type="button" disabled={transitioning} aria-busy={transitioning} onClick={toggleRecording}>{recordingIcon}<span>{memoInWelcome && !transitioning ? 'Start recording' : recordingLabel}</span></button>
              } />
            )}

            </>}
          </div>
        </section>

        <FlyingAgent name="Memo" enabled={(memoInWelcome || recordingActive) && !storm} />
        <FlyingAgent name="Brainy" />
        <StormPresence storm={storm} />
        <footer className={`recording-dock${storm ? ' storm-takeover' : ''}`}>
          <RecordingShape active={recording === 'recording'} storm={!!storm} stormSpeaking={storm?.phase === 'speaking'} />
          <span className="recording-time"><Clock3 size={14} /> {minutes}:{seconds}</span>
          {storm ? (
            <button type="button" className="record-control primary-control" onClick={cancelStorm}>Skip</button>
          ) : <>
          <button
            type="button"
            className="record-control primary-control"
            disabled={transitioning}
            aria-busy={transitioning}
            onClick={toggleRecording}
          >
            {recordingIcon}
            <span>{recordingLabel}</span>
          </button>
          <button type="button" className="record-control restart-control" disabled={transitioning} onClick={() => { setRestartError(''); restartDialog.current?.showModal() }}><RotateCcw size={14} /><span>Restart</span></button>

          </>}

        </footer>
      </main>

      <aside className={`transcript-sidebar ${transcriptOpen ? 'mobile-open' : ''}`} aria-label="Live transcript" inert={compactNavigation && (!transcriptOpen || navigationOpen)}>
        <div className="transcript-header">
          <div><div className="transcript-title-row"><h2>Transcript</h2><button type="button" className="icon-button small mobile-close" onClick={() => setTranscriptOpen(false)} aria-label="Close transcript"><X size={16} /></button></div></div>
          <div className="transcript-memo" data-agent-target={!memoInWelcome && recordingActive ? "Memo" : undefined} data-agent-scale="0.5" />
          <details className="transcript-options" onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
          }} onKeyDown={event => {
            if (event.key === 'Escape') {
              event.currentTarget.open = false
              event.currentTarget.querySelector('summary')?.focus()
            }
          }}>
            <summary className="icon-button small" aria-label="Transcript options"><MoreHorizontal size={18} /></summary>
            <div className="transcript-options-menu">
              <button type="button" className="transcript-export" onClick={event => {
                exportTranscript()
                const menu = event.currentTarget.closest('details')
                if (menu) {
                  menu.open = false
                  menu.querySelector('summary')?.focus()
                }
              }}><FileText size={14} /><span>Export transcript</span></button>
            </div>
          </details>
        </div>
        <p className="transcript-guidance">Introduce yourself naturally, for example “Hi, it’s Maya.” We’ll use your voice to recognize you as the conversation continues.</p>
        {restartError && <p className="transcript-warning" role="alert">{restartError}</p>}
        {transcriptionError && <p className="transcript-warning" role="alert">{transcriptionError}</p>}
        {speakerWarning && <p className="transcript-warning" role="status">{speakerWarning}</p>}
        {stormWarning && <p className="transcript-warning" role="status">{stormWarning}</p>}
        <div className="transcript-feed" ref={transcriptFeedRef} aria-live="polite">
          <TranscriptContent transcript={transcript} recording={recording} stormActive={storm?.phase === 'starting' || storm?.phase === 'speaking'} />
        </div>
      </aside>
      {transcriptOpen && <button type="button" className="mobile-scrim" onClick={() => setTranscriptOpen(false)} aria-label="Close transcript panel" />}
    </div>
  )
}

export default App
