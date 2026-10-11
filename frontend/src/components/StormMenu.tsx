import { useId, useRef } from 'react'
import { MoreHorizontal, Trash2 } from 'lucide-react'

export function StormMenu({ name, disabled, onDelete }: { name: string; disabled: boolean; onDelete: () => void }) {
  const id = useId()
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  function positionMenu() {
    if (!menu.current || !trigger.current) return
    const rect = trigger.current.getBoundingClientRect()
    menu.current.style.left = `${Math.max(8, Math.min(rect.right - 188, window.innerWidth - 196))}px`
    menu.current.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 60))}px`
  }

  return <div className="storm-options">
    <button ref={trigger} className="icon-button small" type="button" disabled={disabled} aria-label={`Options for ${name}`} aria-haspopup="menu" popoverTarget={id} onClick={positionMenu} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        positionMenu()
        menu.current?.showPopover()
      }
    }}><MoreHorizontal size={16} /></button>
    <div ref={menu} id={id} popover="auto" className="idea-options-menu" role="menu" aria-label={`${name} actions`} onToggle={event => {
      if (event.newState === 'open') menu.current?.querySelector('button')?.focus()
    }}>
      <button type="button" role="menuitem" className="idea-delete-action" disabled={disabled} onClick={() => {
        menu.current?.hidePopover()
        trigger.current?.focus()
        onDelete()
      }}><Trash2 size={15} />Delete storm</button>
    </div>
  </div>
}
