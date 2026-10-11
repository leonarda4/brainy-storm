import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from './Avatar'
import './AvatarGroup.css'

type Participant = {
  initials: string
  color: string
  name?: string
  person?: string
}

type AvatarGroupProps = {
  participants: Participant[]
  maxVisible?: number
  label?: string
  className?: string
  prefix?: ReactNode
}

const participantName = (participant: Participant) => participant.name?.trim() || participant.person?.trim() || participant.initials.trim() || 'Unknown speaker'

export function AvatarGroup({ participants, maxVisible = 3, label, className = '', prefix }: AvatarGroupProps) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLDivElement>(null)
  const tooltip = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const tooltipId = useId()
  const visible = participants.slice(0, maxVisible)
  const remaining = participants.length - visible.length

  const cancelClose = () => clearTimeout(closeTimer.current)
  const show = () => { cancelClose(); setOpen(true) }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => {
      if (document.activeElement !== trigger.current) setOpen(false)
    }, 120)
  }

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  useLayoutEffect(() => {
    if (!open || !trigger.current || !tooltip.current) return
    const anchor = trigger.current
    const popup = tooltip.current
    const position = () => {
      const bounds = anchor.getBoundingClientRect()
      const margin = 12
      const gap = 8
      const below = window.innerHeight - bounds.bottom - margin - gap
      const above = bounds.top - margin - gap
      const placeBelow = below >= Math.min(popup.scrollHeight, 320) || below >= above
      popup.style.maxHeight = `${Math.max(0, Math.min(320, placeBelow ? below : above))}px`
      const left = Math.max(margin, Math.min(bounds.left, window.innerWidth - popup.offsetWidth - margin))
      const top = placeBelow ? bounds.bottom + gap : bounds.top - popup.offsetHeight - gap
      popup.style.left = `${left}px`
      popup.style.top = `${Math.max(margin, top)}px`
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { cancelClose(); setOpen(false) }
    }
    position()
    const observer = new ResizeObserver(position)
    observer.observe(anchor)
    observer.observe(popup)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    document.addEventListener('keydown', dismiss)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      document.removeEventListener('keydown', dismiss)
    }
  }, [open])

  if (!participants.length) return null

  return (
    <div
      ref={trigger}
      className={`people-badge ${className}`.trim()}
      role="group"
      tabIndex={0}
      aria-label={label || `${participants.length} ${participants.length === 1 ? 'participant' : 'participants'}`}
      aria-describedby={open ? tooltipId : undefined}
      onMouseEnter={show}
      onMouseLeave={scheduleClose}
      onFocus={show}
      onBlur={() => { cancelClose(); setOpen(false) }}
    >
      {prefix}
      <div className="member-stack" aria-hidden="true">
        {visible.map((participant, index) => (
          <Avatar key={`${participant.initials}-${index}`} className="member-avatar" initials={participant.initials} color={participant.color} />
        ))}
        {remaining > 0 && <span className="member-more">+{remaining}</span>}
      </div>
      {open && createPortal(
        <div ref={tooltip} id={tooltipId} role="tooltip" className="people-tooltip" onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
          <ul>
            {participants.map((participant, index) => (
              <li key={`${participant.initials}-${index}`}>
                <Avatar initials={participant.initials} color={participant.color} aria-hidden="true" />
                <span>{participantName(participant)}</span>
              </li>
            ))}
          </ul>
        </div>, document.body,
      )}
    </div>
  )
}
