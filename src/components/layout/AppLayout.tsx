import { useState, type FC, type ReactNode } from 'react'
import type { NavSection } from '../../types'
import { Header } from './Header'
import { MobileBottomNav } from './MobileBottomNav'
import { MobileNav } from './MobileNav'
import { Sidebar } from './Sidebar'

interface AppLayoutProps {
  activeSection: NavSection
  onSelectSection: (section: NavSection) => void
  onOpenScanner?: () => void
  onOpenQrSettings?: () => void
  children: ReactNode
}

export const AppLayout: FC<AppLayoutProps> = ({
  activeSection,
  onSelectSection,
  onOpenScanner,
  onOpenQrSettings,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="homebase-app-layout">
      {/* Desktop Persistent Sidebar */}
      <Sidebar
        activeSection={activeSection}
        onSelectSection={onSelectSection}
      />

      {/* Mobile Drawer Menu */}
      <MobileNav
        isOpen={mobileMenuOpen}
        activeSection={activeSection}
        onClose={() => setMobileMenuOpen(false)}
        onSelectSection={onSelectSection}
      />

      {/* Main Content Area */}
      <div className="homebase-main-wrapper">
        <Header
          activeSection={activeSection}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />
        <main className="homebase-content-container">
          {children}
        </main>
      </div>

      {/* Dribbble / Tasknur-Style Mobile Docked Bottom Navigation */}
      <MobileBottomNav
        activeSection={activeSection}
        onSelectSection={onSelectSection}
        onOpenScanner={onOpenScanner}
        onOpenQrSettings={onOpenQrSettings}
      />
    </div>
  )
}
