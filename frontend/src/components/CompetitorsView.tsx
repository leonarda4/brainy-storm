import { useId } from 'react'
import { ExternalLink } from 'lucide-react'
import type { CompetitorEnrichment } from '../ideaWorkspace'
import './ProsConsView.css'

export function CompetitorsView({ data }: { data?: CompetitorEnrichment | null }) {
  const headingId = useId()
  if (!data) return null
  const landscape = data.market_landscape || data.summary
  const competitors = data.competitors || []
  if (!landscape && !competitors.length && !data.our_positioning && !data.groundingSources?.length) return null

  return <section className="competitors-panel" aria-labelledby={headingId}>
    <div className="panel-header">
      <h2 className="panel-title" id={headingId}>Competition research</h2>
    </div>
    {landscape && <p className="panel-summary-narrative">{landscape}</p>}
    {competitors.length > 0 && <div className="comparison-table-wrap">
      <table className="comparison-table competitors-table" aria-labelledby={headingId}>
        <thead><tr><th scope="col">Competitor</th><th scope="col">What they do</th><th scope="col">How we differ</th></tr></thead>
        <tbody>
      {competitors.map((comp, idx) => {
        const ideaText = comp.idea || comp.summary || comp.shortBio
        const diffText = comp.howWeDiffer || comp.differentiator
        return <tr key={idx}>
          <th scope="row" className="competitor-name">{comp.name}</th>
          <td><span className="stacked-column-label" aria-hidden="true">What they do</span><p>{ideaText || 'Not available yet.'}</p></td>
          <td><span className="stacked-column-label" aria-hidden="true">How we differ</span><p>{diffText || 'Still to explore.'}</p></td>
        </tr>
      })}
        </tbody>
      </table>
    </div>}
    {data.our_positioning && data.our_positioning !== landscape && <div className="market-positioning"><h3 className="detail-heading">Our positioning</h3><p>{data.our_positioning}</p></div>}
    {Boolean(data.groundingSources?.length) && <div className="grounding-sources-row">
      <span className="sources-label">Sources</span>
      <div className="sources-chips">{data.groundingSources?.map((url, i) => {
        let domain = url
        try { domain = new URL(url).hostname.replace(/^www\./, '') } catch { /* Display the original source. */ }
        return <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="source-chip"><span>{domain}</span><ExternalLink size={11} /></a>
      })}</div>
    </div>}
  </section>
}
