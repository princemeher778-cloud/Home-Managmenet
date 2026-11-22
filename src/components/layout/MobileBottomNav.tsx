import { useState, type FC } from 'react'
import type { NavSection } from '../../types'
import {
  ActivityIcon,
  BankIcon,
  CleaningIcon,
  CloseIcon,
  DashboardIcon,
  ExpensesIcon,
  FundIcon,
  InventoryIcon,
  MembersIcon,
  MoreHorizontalIcon,
  ScanQrIcon,
  SettingsIcon,
} from '../common/Icons'

interface MobileBottomNavProps {
  activeSection: NavSection
  onSelectSection: (section: NavSection) => void
  onOpenScanner?: () => void
  onOpenQrSettings?: () => void
}

export const MobileBottomNav: FC<MobileBottomNavProps> = ({
  activeSection,
  onSelectSection,
  onOpenScanner,
  onOpenQrSettings,
}) => {
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false)

  const handleNavClick = (section: NavSection) => {
    onSelectSection(section)
    setIsMoreMenuOpen(false)
  }

  const isMoreActive = [
    'inventory',
    'cleaning',
    'bills-rent',
    'members',
    'activity',
  ].includes(activeSection)

  return (
    <>
      <nav className="mobile-bottom-bar" aria-label="Mobile Navigation">
        {/* 1. Home */}
        <button
          type="button"
          className={`bottom-nav-item ${activeSection === 'dashboard' ? 'active' : ''}`}
          onClick={() => handleNavClick('dashboard')}
        >
          <DashboardIcon size={20} />
          <span>Home</span>
        </button>

        {/* 2. Fund */}
        <button
          type="button"
          className={`bottom-nav-item ${activeSection === 'home-fund' ? 'active' : ''}`}
          onClick={() => handleNavClick('home-fund')}
        >
          <FundIcon size={20} />
          <span>Fund</span>
        </button>

        {/* 3. Central Floating QR Scanner Action Button */}
        <div className="bottom-nav-fab-container">
          <button
            type="button"
            className="bottom-nav-fab bottom-nav-scanner-fab"
            onClick={onOpenScanner}
            aria-label="Scan payment QR code"
            title="Scan household or payment QR code"
          >
            <ScanQrIcon size={24} />
          </button>
        </div>

        {/* 4. Expenses */}
        <button
          type="button"
          className={`bottom-nav-item ${activeSection === 'expenses' ? 'active' : ''}`}
          onClick={() => handleNavClick('expenses')}
        >
          <ExpensesIcon size={20} />
          <span>Expenses</span>
        </button>

        {/* 5. More */}
        <button
          type="button"
          className={`bottom-nav-item ${isMoreActive ? 'active' : ''}`}
          onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
        >
          <MoreHorizontalIcon size={20} />
          <span>More</span>
        </button>
      </nav>

      {/* More Modules Bottom Sheet */}
      {isMoreMenuOpen && (
        <div
          className="bottom-sheet-overlay"
          onClick={() => setIsMoreMenuOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="bottom-sheet-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bottom-sheet-header">
              <div>
                <h3 className="bottom-sheet-title">Household Modules</h3>
                <p className="bottom-sheet-subtitle">All remaining sections and tools</p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsMoreMenuOpen(false)}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div className="more-menu-list">
              <button
                type="button"
                className={`more-menu-row ${activeSection === 'bills-rent' ? 'selected' : ''}`}
                onClick={() => handleNavClick('bills-rent')}
              >
                <div className="more-row-icon">
                  <BankIcon size={20} />
                </div>
                <div className="more-row-content">
                  <strong>Bills & Rent</strong>
                  <span>Utility obligations and peer claims</span>
                </div>
                <span className="more-row-arrow">›</span>
              </button>

              <button
                type="button"
                className={`more-menu-row ${activeSection === 'inventory' ? 'selected' : ''}`}
                onClick={() => handleNavClick('inventory')}
              >
                <div className="more-row-icon">
                  <InventoryIcon size={20} />
                </div>
                <div className="more-row-content">
                  <strong>Shared Inventory</strong>
                  <span>Pantry consumables & restocking alerts</span>
                </div>
                <span className="more-row-arrow">›</span>
              </button>

              <button
                type="button"
                className={`more-menu-row ${activeSection === 'cleaning' ? 'selected' : ''}`}
                onClick={() => handleNavClick('cleaning')}
              >
                <div className="more-row-icon">
                  <CleaningIcon size={20} />
                </div>
                <div className="more-row-content">
                  <strong>Cleaning & Rosters</strong>
                  <span>Rotating duty rosters and schedules</span>
                </div>
                <span className="more-row-arrow">›</span>
              </button>

              <button
                type="button"
                className={`more-menu-row ${activeSection === 'members' ? 'selected' : ''}`}
                onClick={() => handleNavClick('members')}
              >
                <div className="more-row-icon">
                  <MembersIcon size={20} />
                </div>
                <div className="more-row-content">
                  <strong>Household Members</strong>
                  <span>Roommates, participation & capabilities</span>
                </div>
                <span className="more-row-arrow">›</span>
              </button>

              <button
                type="button"
                className={`more-menu-row ${activeSection === 'activity' ? 'selected' : ''}`}
                onClick={() => handleNavClick('activity')}
              >
                <div className="more-row-icon">
                  <ActivityIcon size={20} />
                </div>
                <div className="more-row-content">
                  <strong>Activity History</strong>
                  <span>Immutable audit record of all transactions</span>
                </div>
                <span className="more-row-arrow">›</span>
              </button>

              <button
                type="button"
                className="more-menu-row"
                onClick={() => {
                  setIsMoreMenuOpen(false)
                  if (onOpenQrSettings) {
                    onOpenQrSettings()
                  }
                }}
              >
                <div className="more-row-icon">
                  <SettingsIcon size={20} />
                </div>
                <div className="more-row-content">
                  <strong>Household Payment QR Settings</strong>
                  <span>Configure official UPI ID & recipient</span>
                </div>
                <span className="more-row-arrow">›</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
