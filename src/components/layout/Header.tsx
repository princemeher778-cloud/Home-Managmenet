import { useState, type FC } from 'react'
import type { NavSection } from '../../types'
import { BellIcon, MenuIcon } from '../common/Icons'

interface HeaderProps {
  activeSection: NavSection
  onOpenMobileMenu: () => void
}

const SECTION_TITLES: Record<NavSection, { title: string; subtitle: string }> = {
  dashboard: {
    title: 'Dashboard',
    subtitle: 'Household balances, active duties, and inventory status (Sample Preview)',
  },
  'home-fund': {
    title: 'Home Fund',
    subtitle: 'Transparent contributions, personal UPI management & cash tracking',
  },
  'bills-rent': {
    title: 'Bills & Rent',
    subtitle: 'Transparent utility obligations, rent cycles & peer reimbursements',
  },
  expenses: {
    title: 'Expenses',
    subtitle: 'Shared expenditure logs, category review & split calculations',
  },
  inventory: {
    title: 'Inventory',
    subtitle: 'Shared provisions, kitchen consumables & restocking alerts',
  },
  cleaning: {
    title: 'Cleaning',
    subtitle: 'Rotating duty rosters, schedule tracking & completion logs',
  },
  members: {
    title: 'Members',
    subtitle: 'Active residents, external contributors & participation rules',
  },
  activity: {
    title: 'Activity History',
    subtitle: 'Immutable record of household transactions and updates',
  },
}

export const Header: FC<HeaderProps> = ({ activeSection, onOpenMobileMenu }) => {
  const current = SECTION_TITLES[activeSection]
  const [isNotificationOpen, setIsNotificationOpen] = useState(false)

  return (
    <header className="homebase-header">
      <div className="header-left">
        <button
          type="button"
          className="mobile-menu-trigger"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
        >
          <MenuIcon size={22} />
        </button>

        {/* Tasknur-Style User Greeting & Avatar */}
        <div className="header-user-greeting">
          <div className="header-avatar-circle">
            <span>AV</span>
          </div>
          <div>
            <div className="header-greeting-title">
              Hi, Arjun <span className="greeting-wave">👋</span>
            </div>
            <div className="header-greeting-date">22 Nov 2026 · {current.title}</div>
          </div>
        </div>
      </div>

      <div className="header-right" style={{ position: 'relative' }}>
        <button
          type="button"
          className="header-icon-btn"
          aria-label="Notifications"
          title="Household notifications"
          onClick={() => setIsNotificationOpen(!isNotificationOpen)}
        >
          <BellIcon size={20} />
          <span className="notification-badge-dot"></span>
        </button>

        {/* Frosted Glass Notification Popover */}
        {isNotificationOpen && (
          <div className="header-notification-popover" role="dialog" aria-label="Household Notifications">
            <div className="notification-popover-header">
              <h4 className="notification-popover-title">Notifications</h4>
              <span className="notification-popover-badge">3 New</span>
            </div>
            <div className="notification-popover-list">
              <div className="notification-item-card">
                <div>
                  <strong>Rent & Utility Cycle</strong>
                  <span>November cycle active · Settle before 5th Dec</span>
                </div>
              </div>
              <div className="notification-item-card">
                <div>
                  <strong>Kitchen Cleaning Duty</strong>
                  <span>Assigned to Arjun today · Roster status active</span>
                </div>
              </div>
              <div className="notification-item-card">
                <div>
                  <strong>Low Inventory Alert</strong>
                  <span>Cooking oil below threshold · 150ml remaining</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <span className="environment-badge">Stage 6 · Live</span>
      </div>
    </header>
  )
}
