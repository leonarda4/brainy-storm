import { useId, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ProsConsEnrichment, ProConItem } from '../ideaWorkspace'
import './ProsConsView.css'
import { OpenQuestionsView } from './OpenQuestionsView'

function Argument({ item, kind, index }: { item: ProConItem | string; kind: 'impact' | 'risk'; index: number }) {
  const point = typeof item === 'string' ? item : item.point
  const details = typeof item === 'string' ? null : item
  const level = details?.severity_or_impact
  return <div className="pros-cons-entry">
    {details && <div className="argument-meta">
      {level && <span className={`${kind}-badge ${kind}-${level.toLowerCase()}`}>{level} {kind}</span>}
      {details.category && <span className="argument-category">{details.category}</span>}
    </div>}
    <div className="pros-cons-point-row">
      <span className="pros-cons-number" aria-hidden="true">{index + 1}.</span>
      <p className="argument-point">{point}</p>
    </div>
    {details?.source_context && <details className="argument-source">
      <summary>Source</summary>
      <blockquote>{details.source_context.replace(/^["“”]|["“”]$/g, '').trim()}</blockquote>
    </details>}
  </div>
}

export function ProsConsView({ data }: { data?: ProsConsEnrichment | null }) {
  const headingId = useId()
  const extendedId = useId()
  const [showExtended, setShowExtended] = useState(false)
  if (!data) return null
  const pros = data.pros || []
  const cons = data.cons || []
  const hasExtended = Boolean(data.key_risks?.length || data.assumptions?.length)
  if (!data.summary && !pros.length && !cons.length && !hasExtended && !data.open_questions?.length) return null

  return <section className="pros-cons-panel" aria-labelledby={headingId}>
    <h2 className="panel-title" id={headingId}>Pros and cons</h2>
    {data.summary && <p className="panel-summary-narrative">{data.summary}</p>}
    {(pros.length > 0 || cons.length > 0) && <div className="comparison-table-wrap">
      <table className="comparison-table pros-cons-table" aria-labelledby={headingId}>
        <thead>
          <tr>
            <th scope="col">
              Pros
            </th>
            <th scope="col">
              Cons
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.max(pros.length, cons.length) }, (_, index) => <tr key={index}>
            <td className={pros[index] === undefined ? 'pros-cons-empty' : undefined}>
              {(pros[index] !== undefined || index === 0) && <span className="stacked-column-label" aria-hidden="true">Pros</span>}
              {pros[index] !== undefined ? <Argument item={pros[index]} index={index} kind="impact" /> : index === 0 && <p className="no-items-hint">No pros recorded yet.</p>}
            </td>
            <td className={cons[index] === undefined ? 'pros-cons-empty' : undefined}>
              {(cons[index] !== undefined || index === 0) && <span className="stacked-column-label" aria-hidden="true">Cons</span>}
              {cons[index] !== undefined ? <Argument item={cons[index]} index={index} kind="risk" /> : index === 0 && <p className="no-items-hint">No cons recorded yet.</p>}
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>}
    {hasExtended && <div className="extended-governance-section">
      <button type="button" className="extended-toggle-button" onClick={() => setShowExtended(!showExtended)} aria-expanded={showExtended} aria-controls={extendedId}>
        <span>Risks &amp; assumptions <span className="section-count">({(data.key_risks?.length || 0) + (data.assumptions?.length || 0)})</span></span>
        {showExtended ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
      {showExtended && <div className="extended-grid" id={extendedId}>
        {Boolean(data.key_risks?.length) && <div><h3 className="detail-heading">Key risks</h3><ul>{data.key_risks?.map((risk, index) => <li key={index}>{risk}</li>)}</ul></div>}
        {Boolean(data.assumptions?.length) && <div><h3 className="detail-heading">Assumptions</h3><ul>{data.assumptions?.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      </div>}
    </div>}
    <OpenQuestionsView questions={data.open_questions} />
  </section>
}
