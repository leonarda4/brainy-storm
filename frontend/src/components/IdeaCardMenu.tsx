import { useId, useRef } from 'react'
import { Download, MoreHorizontal, Trash2 } from 'lucide-react'
import { downloadJson } from '../downloadJson'
import type { Idea } from '../ideaWorkspace'

export function IdeaCardMenu({ idea, onDelete }: { idea: Idea; onDelete: () => void }) {
  const menuId = useId()
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  function positionMenu() {
    if (!menu.current || !trigger.current) return
    const rect = trigger.current.getBoundingClientRect()
    menu.current.style.left = `${Math.max(8, Math.min(rect.right - 188, window.innerWidth - 196))}px`
    menu.current.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 100))}px`
  }

  function closeMenu() {
    menu.current?.hidePopover()
    trigger.current?.focus()
  }

  return <div className="idea-options" onClick={event => event.stopPropagation()}>
    <button ref={trigger} className="icon-button small" type="button" aria-label="Idea options" aria-haspopup="menu" popoverTarget={menuId} onClick={positionMenu} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        positionMenu()
        menu.current?.showPopover()
      }
    }}><MoreHorizontal size={17} /></button>
    <div ref={menu} id={menuId} popover="auto" className="idea-options-menu" role="menu" aria-label="Idea actions" onToggle={event => {
      if (event.newState === 'open') menu.current?.querySelector('button')?.focus()
    }} onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const buttons = Array.from(event.currentTarget.querySelectorAll('button'))
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next]?.focus()
    }}>
      <button type="button" role="menuitem" className="idea-delete-action" onClick={() => { closeMenu(); onDelete() }}><Trash2 size={15} />Delete idea</button>
      <button type="button" role="menuitem" onClick={() => { closeMenu(); downloadJson(idea.rawIdea || idea, idea.originalId || idea.id) }}><Download size={15} />Download JSON</button>
    </div>
  </div>
}
