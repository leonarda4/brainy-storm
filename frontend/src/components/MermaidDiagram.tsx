import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { Code, Eye, Maximize2, Minus, Plus, X } from 'lucide-react'

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  securityLevel: 'strict',
  flowchart: { curve: 'basis', htmlLabels: true },
  themeVariables: {
    darkMode: false,
    background: '#ffffff',
    primaryColor: '#9ff6ee',
    primaryTextColor: '#171717',
    primaryBorderColor: '#171717',
    lineColor: '#737373',
    secondaryColor: '#f47aff',
    tertiaryColor: '#f4ff61',
    fontFamily: 'Supreme, Arial, sans-serif',
  },
})

export function MermaidDiagram({ code, idPrefix = 'mermaid', label = 'Diagram' }: { code?: string | null; idPrefix?: string; label?: string }) {
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [zoom, setZoom] = useState(1)
  const viewer = useRef<HTMLDialogElement>(null)
  const normalizedCode = code
    ?.trim()
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  useEffect(() => {
    let isMounted = true
    const renderDiagram = async () => {
      if (!normalizedCode) {
        setSvg('')
        setError(null)
        return
      }
      try {
        const id = `${idPrefix}-${Math.random().toString(36).substring(2, 9)}`
        const result = await mermaid.render(id, normalizedCode)
        if (isMounted) {
          setSvg(result.svg)
          setError(null)
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'Failed to render diagram')
        }
      }
    }
    renderDiagram()
    return () => {
      isMounted = false
    }
  }, [normalizedCode, idPrefix])

  useEffect(() => {
    if (expanded && normalizedCode) viewer.current?.showModal()
    else viewer.current?.close()
  }, [expanded, normalizedCode])

  if (!normalizedCode) return null

  return (
    <div className="mermaid-container" aria-label={label}>
      <div className="mermaid-header-bar">
        {svg && !error && <button type="button" className="code-toggle-btn" onClick={() => { setZoom(1); setExpanded(true) }} aria-label={`View ${label.toLowerCase()} full screen`}><Maximize2 size={13} /> Full screen</button>}
        <button
          type="button"
          className="code-toggle-btn"
          onClick={() => setShowRaw(!showRaw)}
          title={showRaw ? 'Switch to visual diagram' : 'View mermaid source syntax'}
          aria-pressed={showRaw}
        >
          {showRaw ? <><Eye size={13} /> Show diagram</> : <><Code size={13} /> View source</>}
        </button>
      </div>

      {expanded ? null : showRaw ? (
        <pre className="diagram-raw-pre">
          <code>{normalizedCode}</code>
        </pre>
      ) : error ? (
        <div className="diagram-fallback">
          <p className="diagram-error-hint">Rendering fallback (syntax view):</p>
          <pre className="diagram-raw-pre">
            <code>{normalizedCode}</code>
          </pre>
        </div>
      ) : (
        <div
          className="mermaid-rendered-svg"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      <dialog ref={viewer} className="diagram-viewer" aria-label={`${label} full screen`} onClose={() => setExpanded(false)}>
        <div className="diagram-viewer-toolbar">
          <strong>{label}</strong>
          <div className="diagram-viewer-actions">
            <button type="button" className="icon-button" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}><Minus size={18} /></button>
            <button type="button" className="code-toggle-btn" onClick={() => setZoom(1)} title="Fit diagram to screen">{Math.round(zoom * 100)}% · Fit</button>
            <button type="button" className="icon-button" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.25))}><Plus size={18} /></button>
            <button type="button" className="icon-button" aria-label="Close full screen" autoFocus onClick={() => viewer.current?.close()}><X size={20} /></button>
          </div>
        </div>
        <div className="diagram-viewer-canvas">
          {expanded && <div className="diagram-viewer-svg" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }} dangerouslySetInnerHTML={{ __html: svg }} />}
        </div>
      </dialog>
    </div>
  )
}
