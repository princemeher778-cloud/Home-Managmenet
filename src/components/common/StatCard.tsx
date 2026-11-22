import type { FC, ReactNode } from 'react'

interface StatCardProps {
  label: string
  amount: number
  currency?: string
  subtitle?: string
  icon?: ReactNode
  accent?: boolean
  highlightTag?: string
}

export const StatCard: FC<StatCardProps> = ({
  label,
  amount,
  currency = '₹',
  subtitle,
  icon,
  accent = false,
  highlightTag,
}) => {
  const formattedAmount = new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount)

  return (
    <div className={`homebase-stat-card ${accent ? 'stat-card-accent' : ''}`}>
      <div className="stat-card-top">
        <span className="stat-card-label">{label}</span>
        {icon && <div className="stat-card-icon">{icon}</div>}
      </div>
      <div className="stat-card-value-row">
        {currency ? <span className="stat-card-currency">{currency}</span> : null}
        <span className="stat-card-amount">{formattedAmount}</span>
      </div>
      <div className="stat-card-footer">
        {subtitle && <span className="stat-card-subtitle">{subtitle}</span>}
        {highlightTag && <span className="stat-card-tag">{highlightTag}</span>}
      </div>
    </div>
  )
}
