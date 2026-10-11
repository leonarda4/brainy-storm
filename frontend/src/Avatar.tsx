import type { ComponentPropsWithoutRef } from 'react'

type AvatarProps = Omit<ComponentPropsWithoutRef<'span'>, 'color' | 'children'> & {
  initials: string
  color?: string
}

export function Avatar({ initials, color = 'avatar-unknown', className = '', ...props }: AvatarProps) {
  return <span {...props} className={`avatar ${color} ${className}`.trim()}>{initials}</span>
}
