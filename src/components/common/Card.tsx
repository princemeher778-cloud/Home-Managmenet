import type { FC, ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
}

export const Card: FC<CardProps> = ({ children, className = '' }) => {
  return <div className={`homebase-card ${className}`}>{children}</div>
}

interface CardHeaderProps {
  title: string
  subtitle?: string
  action?: ReactNode
  badge?: ReactNode
}

export const CardHeader: FC<CardHeaderProps> = ({
  title,
  subtitle,
  action,
  badge,
}) => {
  return (
    <div className="homebase-card-header">
      <div>
        <div className="homebase-card-title-row">
          <h3 className="homebase-card-title">{title}</h3>
          {badge}
        </div>
        {subtitle && <p className="homebase-card-subtitle">{subtitle}</p>}
      </div>
      {action && <div className="homebase-card-action">{action}</div>}
    </div>
  )
}

interface CardContentProps {
  children: ReactNode
  className?: string
}

export const CardContent: FC<CardContentProps> = ({ children, className = '' }) => {
  return <div className={`homebase-card-content ${className}`}>{children}</div>
}
