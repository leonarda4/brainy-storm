import { useId, useState } from 'react'
import { ArrowRight, GitBranch, Network } from 'lucide-react'
import type { ArchitectureEnrichment, WorkflowEnrichment } from '../ideaWorkspace'
import { MermaidDiagram } from './MermaidDiagram'

type DiagramTab = 'workflow' | 'architecture'

export function DiagramsView({
  workflow,
  systemGraph,
  ideaId,
}: {
  workflow?: WorkflowEnrichment | null
  systemGraph?: ArchitectureEnrichment | null
  ideaId?: string
}) {
  const headingId = useId()
  const hasWorkflow = Boolean(workflow && (workflow.steps?.length || workflow.mermaid_code || workflow.mermaidCode || workflow.summary))
  const hasArchitecture = Boolean(systemGraph && (systemGraph.nodes?.length || systemGraph.edges?.length || systemGraph.mermaid_code || systemGraph.summary))
  const [requestedTab, setRequestedTab] = useState<DiagramTab>('architecture')

  if (!hasWorkflow && !hasArchitecture) return null

  const activeTab: DiagramTab = requestedTab === 'workflow' && !hasWorkflow
    ? 'architecture'
    : requestedTab === 'architecture' && !hasArchitecture
      ? 'workflow'
      : requestedTab

  const cleanId = ideaId?.replace(/^engine-/, '') || 'idea'
  const workflowCode = workflow?.mermaid_code || workflow?.mermaidCode

  return (
    <section className="diagrams-panel" aria-labelledby={headingId}>
      <div className="diagrams-header-bar">
        <h2 className="panel-title" id={headingId}>How it works</h2>

        <div className="diagram-tabs" role="tablist" aria-label="Diagram type">
          {hasWorkflow && (
            <button type="button" role="tab" aria-selected={activeTab === 'workflow'} className={`diagram-tab-btn ${activeTab === 'workflow' ? 'active' : ''}`} onClick={() => setRequestedTab('workflow')}>
              <GitBranch size={14} /> Process
            </button>
          )}
          {hasArchitecture && (
            <button type="button" role="tab" aria-selected={activeTab === 'architecture'} className={`diagram-tab-btn ${activeTab === 'architecture' ? 'active' : ''}`} onClick={() => setRequestedTab('architecture')}>
              <Network size={14} /> Architecture
            </button>
          )}
        </div>
      </div>

      {activeTab === 'workflow' && workflow && (
        <div className="diagram-content-container" role="tabpanel">
          {workflow.summary && <p className="diagram-intro">{workflow.summary}</p>}

          {Boolean(workflow.steps?.length) && (
            <div>
              <div className="diagram-section-label">Execution flow · {workflow.steps?.length} stages</div>
              <ol className="process-flow">
                {workflow.steps?.map((step, index) => (
                  <li className="process-stage-wrap" key={`${index}-${step}`}>
                    <div className="process-stage">
                      <span className="process-stage-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                      <p>{step}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {workflowCode && (
            <div className="diagram-map-block">
              <div className="diagram-map-heading">
                <span>Detailed workflow map</span>
              </div>
              <MermaidDiagram code={workflowCode} idPrefix={`wf-${cleanId}`} label="Detailed workflow diagram" />
            </div>
          )}
        </div>
      )}

      {activeTab === 'architecture' && systemGraph && (
        <div className="diagram-content-container" role="tabpanel">
          {systemGraph.summary && <p className="diagram-intro">{systemGraph.summary}</p>}

          {Boolean(systemGraph.nodes?.length) && (
            <div>
              <div className="diagram-section-label">System components · {systemGraph.nodes?.length} modules</div>
              <div className="nodes-grid">
                {systemGraph.nodes?.map(node => (
                  <article className="component-node" key={node.id}>
                    <span className={`node-type-badge type-${node.component_type || 'service'}`}>{node.component_type || 'service'}</span>
                    <strong className="node-label">{node.label}</strong>
                    {node.description && <p className="node-desc">{node.description}</p>}
                  </article>
                ))}
              </div>
            </div>
          )}

          {systemGraph.mermaid_code && (
            <div className="diagram-map-block">
              <div className="diagram-map-heading">
                <span>System map</span>
              </div>
              <MermaidDiagram code={systemGraph.mermaid_code} idPrefix={`arch-${cleanId}`} label="System architecture diagram" />
            </div>
          )}

          {Boolean(systemGraph.edges?.length) && (
            <details className="architecture-connections">
              <summary>Connections <span className="section-count">({systemGraph.edges?.length})</span></summary>
              <div className="connection-list">
                {systemGraph.edges?.map((edge, index) => (
                  <div className="connection-row" key={`${index}-${edge.source}-${edge.target}`}>
                    <span className="connection-node">{systemGraph.nodes?.find(node => node.id === edge.source)?.label || edge.source}</span><ArrowRight size={13} aria-hidden="true" /><span className="connection-node">{systemGraph.nodes?.find(node => node.id === edge.target)?.label || edge.target}</span>
                    {edge.label && <span>{edge.label}</span>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  )
}
