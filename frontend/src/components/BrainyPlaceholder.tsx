import type { ReactNode } from 'react'
import './BrainyPlaceholder.css'

export function BrainyPlaceholder({ active, started, control }: { active: boolean; started: boolean; control: ReactNode }) {
  return <article className={`welcome-idea-morph${started ? ' has-started' : ''}${active ? ' is-thinking' : ''}`} aria-label={started ? 'Brainy is shaping a new idea' : 'Start the session'}>
    <div className="welcome-idea-content" inert={started} aria-hidden={started}>
      <div className="welcome-memo" data-agent-target={!started ? "Memo" : undefined} />
      <strong>Start the session</strong>
      <p>Memo will listen and Brainy is going to organize your ideas here.</p>
      {control}
    </div>
    <div className="brainy-idea-content" aria-hidden={!started}>
      <h3 className="brainy-status-label" role="status">Brainy is thinking</h3>
      <div className="brainy-playground" aria-hidden="true">
        {started && <div className="brainy-work-target" data-agent-target="Brainy" data-agent-wander="inside" />}
      </div>
    </div>
  </article>
}
