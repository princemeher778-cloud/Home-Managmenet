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
  DashboardIcon,
  ExpensesIcon,
  FundIcon,
  HouseIcon,
  InventoryIcon,
  MembersIcon,
} from '../common/Icons'

interface NavItem {
  id: NavSection
  label: string
  icon: FC<{ size?: number; className?: string }>
  badge?: string
}

interface SidebarProps {
  activeSection: NavSection
  onSelectSection: (section: NavSection) => void
}

export const Sidebar: FC<SidebarProps> = ({ activeSection, onSelectSection }) => {
  const stats = calculateHouseholdStats(DEMO_MEMBERS)
  const householdComposition = formatHouseholdComposition(stats)

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: DashboardIcon },
    { id: 'home-fund', label: 'Home Fund', icon: FundIcon },
    { id: 'bills-rent', label: 'Bills & Rent', icon: BankIcon },
    { id: 'expenses', label: 'Expenses', icon: ExpensesIcon },
    { id: 'inventory', label: 'Inventory', icon: InventoryIcon, badge: '3 Low' },
    { id: 'cleaning', label: 'Cleaning', icon: CleaningIcon },
    { id: 'members', label: 'Members', icon: MembersIcon, badge: `${stats.totalActiveMembers}` },
    { id: 'activity', label: 'Activity History', icon: ActivityIcon },
  ]

  return (
    <aside className="homebase-sidebar" aria-label="Main Navigation">
      {/* Brand & Household Header */}
      <div className="sidebar-brand-block">
        <div className="brand-logo-mark">
          <HouseIcon size={20} />
        </div>
        <div className="brand-info">
          <span className="brand-name">HOMEBASE</span>
          <span className="brand-sub">Shared House Operations</span>
        </div>
      </div>

      {/* Household Profile Pill */}
      <div className="household-meta-card">
        <div className="household-meta-title">Greenwood Heights #302</div>
        <div className="household-meta-sub">{householdComposition}</div>
      </div>

      {/* Navigation List */}
      <nav className="sidebar-nav">
        <div className="nav-group-label">OPERATIONS</div>
        <ul className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = activeSection === item.id
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`nav-button ${isActive ? 'nav-button-active' : ''}`}
                  onClick={() => onSelectSection(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="nav-icon-wrap">
                    <Icon size={18} />
                  </span>
                  <span className="nav-label">{item.label}</span>
                  {item.badge && (
                    <span className={`nav-item-badge ${isActive ? 'nav-item-badge-active' : ''}`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Current Active User Indicator */}
      <div className="sidebar-user-footer">
        <div className="user-avatar-circle">RS</div>
        <div className="user-info">
          <span className="user-name">Rohan Sharma <span className="nav-item-badge">Demo</span></span>
          <span className="user-role">Resident · Sample Profile</span>
        </div>
      </div>
    </aside>
  )
}
