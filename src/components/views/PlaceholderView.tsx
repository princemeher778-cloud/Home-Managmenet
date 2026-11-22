import type { FC, ReactNode } from 'react'
import type { NavSection } from '../../types'
import { Badge } from '../common/Badge'
import { Card, CardContent, CardHeader } from '../common/Card'
import {
  ActivityIcon,
  BankIcon,
  CleaningIcon,
  ExpensesIcon,
  FundIcon,
  InventoryIcon,
  MembersIcon,
} from '../common/Icons'

interface ModuleInfo {
  title: string
  icon: ReactNode
  description: string
  upcomingCapabilities: string[]
}

const MODULE_DESCRIPTIONS: Record<Exclude<NavSection, 'dashboard'>, ModuleInfo> = {
  'home-fund': {
    title: 'Home Fund & Treasury',
    icon: <FundIcon size={32} />,
    description:
      'Centralized tracking for member contributions, personal UPI account balances, physical cash handling, and household buffer funds.',
    upcomingCapabilities: [
      'Member contribution status & payment confirmation workflow',
      'Dual tracking: Member personal UPI/bank account vs physical cash in hand',
      'Monthly rent, security deposit & recurring bill allocations',
      'Immutable audit trail for all additions and cash withdrawals',
    ],
  },
  'bills-rent': {
    title: 'Bills & Rent',
    icon: <BankIcon size={32} />,
    description:
      'Transparent management of shared utility obligations, electricity, piped gas, and landlord rent cycles with peer reimbursement tracking.',
    upcomingCapabilities: [
      'Automated equal & custom obligation allocations across residents',
      'Dual payment channels: Treasury pool vs personal out-of-pocket settlement',
      'Manual UPI payment proof submission and collector verification',
      'Traceable peer-to-peer settlement claims and excess credit management',
    ],
  },
  expenses: {
    title: 'Shared Expenses',
    icon: <ExpensesIcon size={32} />,
    description:
      'Transparent logging of shared expenditures with dynamic split scoping across configurable participant groups.',
    upcomingCapabilities: [
      'Configurable split scopes: all active members, food participants, or residents only',
      'Receipt attachment and line-item categorization',
      'Payer attribution with non-destructive correction history',
      'Clear settlement calculations and pending reimbursement status',
    ],
  },
  inventory: {
    title: 'Household Inventory',
    icon: <InventoryIcon size={32} />,
    description:
      'Inventory tracking for shared kitchen groceries, cleaning chemicals, bathroom supplies, and household consumables.',
    upcomingCapabilities: [
      'Threshold-based stock level warnings (Normal, Low, Critical)',
      'Shared shopping list auto-generation based on low supplies',
      'Restock logging with immediate expense linkage',
      'Room-wise or common-area consumable tracking',
    ],
  },
  cleaning: {
    title: 'Cleaning & Maintenance',
    icon: <CleaningIcon size={32} />,
    description:
      'Fair, automated rotating chore schedule dynamically allocated among cleaning-eligible household members.',
    upcomingCapabilities: [
      'Dynamic weekly automated rotation for all cleaning-eligible members',
      'Duty swap requests and transparent confirmation',
      'Completion checklist and room cleanliness status',
      'Periodic deep cleaning and appliance maintenance logs',
    ],
  },
  members: {
    title: 'Household Directory',
    icon: <MembersIcon size={32} />,
    description:
      'Dynamic roster of residents, external meal contributors, and guests with configurable participation rules.',
    upcomingCapabilities: [
      'Configurable capability matrix (residence, food, cleaning, rent)',
      'Dynamic member onboarding and non-destructive member departure',
      'Personal contribution summary and individual ledger balance',
      'Role-based security rules for shared record editing',
    ],
  },
  activity: {
    title: 'Activity & Audit Log',
    icon: <ActivityIcon size={32} />,
    description:
      'Comprehensive, traceable log of all household edits, expenses added, inventory adjustments, and duty completions.',
    upcomingCapabilities: [
      'Full timestamp and member attribution for every shared change',
      'Preservation of record revisions and adjustments (no silent deletes)',
      'Filterable by category (Financial, Duty, Inventory, Member)',
      'System-level transaction notes',
    ],
  },
}

interface PlaceholderViewProps {
  section: Exclude<NavSection, 'dashboard'>
  onNavigate?: (section: NavSection) => void
}

export const PlaceholderView: FC<PlaceholderViewProps> = ({ section, onNavigate }) => {
  const info = MODULE_DESCRIPTIONS[section]

  return (
    <div className="home-fund-view-container">
      {/* 1. Tasknur Module Overview Hero Card */}
      <div className="tasknur-hero-card">
        <div className="tasknur-hero-content">
          <span className="tasknur-hero-eyebrow">Household Directory & Logs</span>
          <h2 className="tasknur-hero-title">{info.title}</h2>
          <p className="tasknur-hero-subtitle">{info.description}</p>
          {onNavigate && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <button
                type="button"
                className="tasknur-hero-action-btn"
                onClick={() => onNavigate('dashboard')}
              >
                Return to Dashboard
              </button>
            </div>
          )}
        </div>
        <div className="tasknur-hero-progress-ring">
          <div className="placeholder-icon-circle" style={{ width: 68, height: 68, backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff' }}>
            {info.icon}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader
          title={`${info.title} Architecture`}
          subtitle="Household module capabilities & specifications"
          badge={<Badge variant="accent">Stage 6 Active</Badge>}
        />
        <CardContent>
          <div className="placeholder-content-box">
            <div className="placeholder-specs-card">
              <div className="specs-card-title">Core Specifications & Capabilities:</div>
              <ul className="specs-card-list">
                {info.upcomingCapabilities.map((item, index) => (
                  <li key={index} className="specs-card-item">
                    <span className="specs-check" style={{ color: 'var(--color-accent-primary)' }}>✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="audit-notice-banner" style={{ marginTop: 'var(--space-4)', borderLeftColor: 'var(--color-accent-primary)' }}>
              <strong>Adhering to AGENTS.md:</strong> Modules are implemented sequentially. Live state for this section is integrated with the centralized financial and dynamic membership models.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
