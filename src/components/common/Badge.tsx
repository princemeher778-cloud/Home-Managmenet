import type { FC, ReactNode } from 'react'

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent'

interface BadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  className?: string
}

export const Badge: FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  className = '',
}) => {
  return (
    <span className={`homebase-badge badge-${variant} ${className}`}>
      {children}
    </span>
  )
}
