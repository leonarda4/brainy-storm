import { useLayoutEffect, useRef } from 'react'
import type { Idea } from './ideaWorkspace'
import { IdeaAnalysis } from './components/IdeaAnalysis'

const agentLabels: Record<string, string> = {
  summary: 'summary', pros_cons: 'pros and cons', workflow: 'workflow',
  architecture: 'system architecture', competitors: 'competition research',
}

function TextBlock({ value, label, className, placeholder, onChange, singleLine = false }: {
  value: string; label: string; className: string; placeholder: string; onChange: (value: string) => void; singleLine?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const input = ref.current
    if (!input) return
    const resize = () => { input.style.height = '0px'; input.style.height = `${input.scrollHeight}px` }
    resize()
    const observer = new ResizeObserver(resize)
    // Watch the container width, not the textarea height we are changing.
    if (input.parentElement) observer.observe(input.parentElement)
    return () => observer.disconnect()
  }, [value])
  return <textarea ref={ref} rows={1} aria-label={label} className={`editable-block ${className}`} value={value} placeholder={placeholder}
    onChange={event => onChange(singleLine ? event.target.value.replace(/[\r\n]+/g, ' ') : event.target.value)}
    onKeyDown={event => { if (singleLine && event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} />
}

export function EditableIdea({ idea, onChange, storageError, syncError = false }: {
  idea: Idea; onChange: (fields: Partial<Pick<Idea, 'title' | 'summary' | 'tag'>>) => void; storageError: boolean; syncError?: boolean
}) {
  const activeTools = (idea.active_tools || []).map((tool: string) => agentLabels[tool] || tool)
  const failures: string[] = idea.metadata?.enrichment_failures || []

  return <div className="enriched-idea-container">
    <header className="idea-intro">
      {(idea.status === 'enriching' || idea.status === 'error') && <div className="agent-progress" role="status">
        <span>{idea.status === 'enriching' ? 'Agents working' : 'Some results need another run'}</span>
        {idea.status === 'enriching' && activeTools.length > 0 && <span>Updating {activeTools.join(', ')}…</span>}
        {failures.length > 0 && <span>Could not update {failures.map(tool => agentLabels[tool] || tool).join(', ')}. Showing available results.</span>}
      </div>}
      <div className="idea-editor-title" role="heading" aria-level={1}><TextBlock label="Idea title" className="editable-title" value={idea.title} placeholder="Untitled idea" singleLine onChange={title => onChange({ title })} /></div>
      <section className="idea-summary-section" aria-labelledby="idea-summary-heading">
        <h2 id="idea-summary-heading" className="panel-title">Summary</h2>
        <div className="idea-editor-body"><TextBlock label="Idea summary" className="editable-body" value={idea.summary} placeholder="Start writing your idea…" onChange={summary => onChange({ summary })} /></div>
      </section>
      <div className="idea-edit-status">
        <small className={`editor-save-status ${storageError || syncError ? 'save-error' : ''}`} role="status">{storageError ? 'Could not save in this browser. Keep this tab open to retain your edits.' : idea.pendingTextEdit ? syncError ? 'Your text edits are saved in this browser. Context sync will retry automatically.' : 'Your text edits are saved in this browser. Adding to the conversation context…' : idea.textEditsSaved ? 'Your text edits are saved in this browser and included in the conversation context.' : 'Everything updates with the conversation. Edit to add context.'}</small>
      </div>
    </header>
    <IdeaAnalysis idea={idea} />
  </div>
}
