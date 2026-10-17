import { useLayoutEffect, useRef, useState } from 'react'

/** Abstract artwork inspired by the brand's scalloped silhouettes. */
export function BrandShape({ variant: index }: { variant: number }) {
  const variant = ((index % 9) + 9) % 9
  const stacked = variant % 2 === 1
  const dotted = variant === 0 || variant === 5 || variant === 8
  return (
    <svg className={`brand-shape shape-${variant}`} viewBox="0 0 360 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect className="shape-ground" width="360" height="180" />
      {stacked ? <g className="shape-ink">
        <ellipse cx="180" cy="50" rx="108" ry="18" />
        <ellipse cx="180" cy="76" rx="130" ry="22" />
        <ellipse cx="180" cy="110" rx="153" ry="27" />
        <ellipse cx="180" cy="151" rx="178" ry="33" />
        <path d="M0 150h360v40H0z" />
      </g> : <path className="shape-ink" d="M-20 180V120Q12 30 44 130Q77-42 110 101Q145-97 180 76Q217-43 248 115Q278 9 310 137Q340 56 380 137V180Z" />}
      {dotted && <circle className="shape-accent" cx="306" cy="29" r="9" />}
    </svg>
  )
}

export function AbstractSymbol({ className = '' }: { className?: string }) {
  return <svg className={`abstract-symbol ${className}`} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M2 34V23Q6 4 11 23Q15-9 21 19Q26 0 30 25Q35 11 38 28V34Z" />
  </svg>
}

export function RecordingShape({ active, storm = false, stormSpeaking = false }: { active: boolean; storm?: boolean; stormSpeaking?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(448)

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(1, entry.contentRect.width))
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  const diameter = 32
  const count = Math.max(1, Math.ceil(width / diameter))
  const step = count > 1 ? (width - diameter) / (count - 1) : 0

  return (
    <div className={`recording-visual ${active ? 'is-recording' : ''}${storm ? ' is-storm' : ''}${stormSpeaking ? ' is-speaking' : ''}`}>
      <span className="recording-agent" role="status">
        <strong>{storm ? 'Storm' : 'Memo'}</strong>
        <small>{storm ? 'is speaking' : active ? 'is listening' : 'is ready'}</small>
      </span>
      <svg ref={svgRef} viewBox={`0 0 ${width} 56`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <g className="recording-lobes" key={storm ? 'storm' : 'memo'}>
          {storm && <path className="storm-connector" d={`M0 28H${width}`} />}
          {Array.from({ length: count }, (_, index) => {
            const position = count > 1 ? index / (count - 1) : 0.5
            const height = 10 + 17 * (1 - Math.abs(position * 2 - 1))
            const cx = count > 1 ? diameter / 2 + index * step : width / 2
            const style = { animationDelay: `${index * -0.13}s` }
            return storm
              ? <polygon key={index} points={`${cx - diameter / 2},28 ${cx},${28 - height} ${cx + diameter / 2},28 ${cx},${28 + height}`} style={style} />
              : <ellipse key={index} cx={cx} cy="28" rx={diameter / 2} ry={height} style={style} />
          })}
        </g>
      </svg>
    </div>
  )
}
