import type { FC } from 'react'
import {
  calculateHouseholdStats,
  DEMO_MEMBERS,
  formatHouseholdComposition,
} from '../../data/mockData'
import type { NavSection } from '../../types'
import {
  ActivityIcon,
  BankIcon,
  CleaningIcon,
  CloseIcon,
  DashboardIcon,
  ExpensesIcon,
  FundIcon,
  HouseIcon,
  InventoryIcon,
  MembersIcon,
} from '../common/Icons'

interface MobileNavProps {
  isOpen: boolean
  activeSection: NavSection
  onClose: () => void
  onSelectSection: (section: NavSection) => void
}

interface NavItem {
  id: NavSection
  label: string
  icon: FC<{ size?: number; className?: string }>
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
  { id: 'home-fund', label: 'Home Fund', icon: FundIcon },
  { id: 'bills-rent', label: 'Bills & Rent', icon: BankIcon },
  { id: 'expenses', label: 'Expenses', icon: ExpensesIcon },
  { id: 'inventory', label: 'Inventory', icon: InventoryIcon },
  { id: 'cleaning', label: 'Cleaning', icon: CleaningIcon },
  { id: 'members', label: 'Members', icon: MembersIcon },
  { id: 'activity', label: 'Activity History', icon: ActivityIcon },
]

export const MobileNav: FC<MobileNavProps> = ({
  isOpen,
  activeSection,
  onClose,
  onSelectSection,
}) => {
  if (!isOpen) return null

  const stats = calculateHouseholdStats(DEMO_MEMBERS)
  const householdComposition = formatHouseholdComposition(stats)

  const handleSelect = (section: NavSection) => {
    onSelectSection(section)
    onClose()
  }

  return (
    <div className="mobile-drawer-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="mobile-drawer-content"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mobile-drawer-header">
          <div className="brand-logo-mark">
            <HouseIcon size={20} />
          </div>
          <div>
            <div className="brand-name">HOMEBASE</div>
            <div className="brand-sub">Greenwood Heights #302</div>
          </div>
          <button
            type="button"
            className="mobile-drawer-close"
            onClick={onClose}
            aria-label="Close menu"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <nav className="mobile-drawer-nav">
          <ul className="nav-list">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = activeSection === item.id
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`nav-button ${isActive ? 'nav-button-active' : ''}`}
                    onClick={() => handleSelect(item.id)}
                  >
                    <span className="nav-icon-wrap">
                      <Icon size={20} />
                    </span>
                    <span className="nav-label">{item.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="mobile-drawer-footer">
          <div className="household-meta-sub">{householdComposition}</div>
          <div className="user-name" style={{ marginTop: '4px' }}>
            Rohan Sharma <span className="nav-item-badge">Demo Identity</span>
          </div>
        </div>
      </div>
    </div>
  )
}
