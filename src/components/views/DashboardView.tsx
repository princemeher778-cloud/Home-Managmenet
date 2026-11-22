import { useState, type ChangeEvent, type FC, type FormEvent } from 'react'
import {
  calculateHouseholdStats,
  DEMO_BALANCES,
  DEMO_CLEANING_DUTY_ASSIGNMENTS,
  DEMO_INVENTORY_ITEMS,
  DEMO_MEMBERS,
  DEMO_RECENT_EXPENSES,
  formatHouseholdComposition,
  formatSplitScopeLabel,
  getActiveMembers,
  getAllMembers,
} from '../../data/mockData'
import type {
  CleaningDutyAssignment,
  ExpenseItem,
  FundContribution,
  HouseholdCollectorQrConfig,
  HouseholdMember,
  InventoryItem,
  NavSection,
  TreasuryOverview,
} from '../../types'
import { generateEntityId, paiseToRupees, rupeesToPaise } from '../../utils/financial'
import { deriveDutyStatus, getTodayCalendarDate } from '../../utils/cleaning'
import { deriveStockStatus, formatInventoryQuantity } from '../../utils/inventory'
import { Badge } from '../common/Badge'
import { Card, CardContent, CardHeader } from '../common/Card'
import {
  AlertTriangleIcon,
  BankIcon,
  CashIcon,
  CleaningIcon,
  CloseIcon,
  ExpensesIcon,
  FundIcon,
  QrCodeIcon,
  ScanQrIcon,
  SettingsIcon,
} from '../common/Icons'
import { StatCard } from '../common/StatCard'

interface DashboardViewProps {
  onNavigate: (section: NavSection) => void
  currentDate?: string
  expenses?: ExpenseItem[]
  treasuryOverview?: TreasuryOverview
  members?: HouseholdMember[]
  inventoryItems?: InventoryItem[]
  cleaningDuties?: CleaningDutyAssignment[]
  onCompleteCleaningDuty?: (dutyId: string) => void
  collectorQrConfig?: HouseholdCollectorQrConfig
  onUpdateCollectorQrConfig?: (config: HouseholdCollectorQrConfig) => void
  onSubmitContribution?: (contribution: FundContribution) => void
  scannedPaymentPrefill?: {
    recipientName: string
    upiId: string
    amountRupees?: string
    note?: string
    rawText: string
  } | null
  onClearScannedPaymentPrefill?: () => void
  isQrSettingsRequested?: boolean
  onClearQrSettingsRequested?: () => void
  onOpenScanner?: () => void
}

export const DashboardView: FC<DashboardViewProps> = ({
  onNavigate,
  currentDate: propCurrentDate,
  expenses: propExpenses,
  treasuryOverview,
  members: propMembers,
  inventoryItems: propInventoryItems,
  cleaningDuties: propCleaningDuties,
  onCompleteCleaningDuty,
  collectorQrConfig: propCollectorQrConfig,
  onUpdateCollectorQrConfig,
  onSubmitContribution,
  scannedPaymentPrefill,
  onClearScannedPaymentPrefill,
  isQrSettingsRequested,
  onClearQrSettingsRequested,
  onOpenScanner,
}) => {
  const members = propMembers ?? DEMO_MEMBERS
  const expenses = propExpenses ?? DEMO_RECENT_EXPENSES
  const inventoryItems = propInventoryItems ?? DEMO_INVENTORY_ITEMS
  const cleaningDuties = propCleaningDuties ?? DEMO_CLEANING_DUTY_ASSIGNMENTS
  const todayStr = propCurrentDate ?? getTodayCalendarDate()
  const activeMembers = getActiveMembers(members)
  const allMembers = getAllMembers(members)
  const householdStats = calculateHouseholdStats(members)
  const compositionLabel = formatHouseholdComposition(householdStats)

  // Payment QR & Contribution Modals State
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [isQrSettingsModalOpen, setIsQrSettingsModalOpen] = useState(false)
  const [paymentSuccessMessage, setPaymentSuccessMessage] = useState<string | null>(null)

  // Contribution Form State
  const [payerMemberId, setPayerMemberId] = useState(activeMembers[0]?.id ?? 'm1')
  const [contributionAmountRupees, setContributionAmountRupees] = useState('5000')
  const [paymentUtrReference, setPaymentUtrReference] = useState('')
  const [paymentProofNote, setPaymentProofNote] = useState('')

  // Prefill scanned payment details when user scans QR
  const [prevScannedPrefill, setPrevScannedPrefill] = useState(scannedPaymentPrefill)
  if (scannedPaymentPrefill !== prevScannedPrefill) {
    setPrevScannedPrefill(scannedPaymentPrefill)
    if (scannedPaymentPrefill) {
      if (scannedPaymentPrefill.amountRupees) {
        setContributionAmountRupees(scannedPaymentPrefill.amountRupees)
      }
      if (scannedPaymentPrefill.note) {
        setPaymentProofNote(
          `Scanned QR Payment to ${scannedPaymentPrefill.recipientName} (${scannedPaymentPrefill.upiId}) - ${scannedPaymentPrefill.note}`
        )
      } else {
        setPaymentProofNote(
          `Scanned QR Payment to ${scannedPaymentPrefill.recipientName} (${scannedPaymentPrefill.upiId})`
        )
      }
      setIsPaymentModalOpen(true)
    }
  }

  const [prevQrRequested, setPrevQrRequested] = useState(isQrSettingsRequested)
  if (isQrSettingsRequested !== prevQrRequested) {
    setPrevQrRequested(isQrSettingsRequested)
    if (isQrSettingsRequested) {
      setIsQrSettingsModalOpen(true)
      onClearQrSettingsRequested?.()
    }
  }

  // Settings Form State
  const [settingsCollectorName, setSettingsCollectorName] = useState(
    propCollectorQrConfig?.collectorName ?? 'Arjun Verma'
  )
  const [settingsUpiId, setSettingsUpiId] = useState(
    propCollectorQrConfig?.upiId ?? 'arjun.verma@okhdfcbank'
  )
  const [settingsNotes, setSettingsNotes] = useState(
    propCollectorQrConfig?.notes ?? 'Primary household utility & fund collector.'
  )
  const [settingsQrPreviewUrl, setSettingsQrPreviewUrl] = useState<string | undefined>(
    propCollectorQrConfig?.qrCodeImageUrl
  )

  // Derived dynamic inventory restock alerts
  const activeRestockAlerts = inventoryItems
    .filter((item) => !item.isArchived)
    .map((item) => ({
      item,
      status: deriveStockStatus(item.currentQuantityMilli, item.minThresholdMilli),
    }))
    .filter(({ status }) => status === 'empty' || status === 'critical' || status === 'low')
    .sort((a, b) => {
      const priority = { empty: 3, critical: 2, low: 1, normal: 0 }
      return priority[b.status] - priority[a.status]
    })

  // Derived dynamic cleaning duties
  const activeCleaningDuties = cleaningDuties.filter((d) => d.status !== 'cancelled')
  const overdueDuties = activeCleaningDuties.filter(
    (d) => deriveDutyStatus(d, todayStr) === 'overdue'
  )
  const todayDutiesList = activeCleaningDuties.filter(
    (d) => deriveDutyStatus(d, todayStr) === 'pending' && d.dueDate === todayStr
  )
  const upcomingDutiesList = activeCleaningDuties
    .filter((d) => deriveDutyStatus(d, todayStr) === 'pending' && d.dueDate > todayStr)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  const prioritizedDuties = [
    ...overdueDuties,
    ...todayDutiesList,
    ...upcomingDutiesList,
  ].slice(0, 5)

  // Dynamic household duty progress calculation (Strictly computed from actual duty state)
  const totalDutiesCount = activeCleaningDuties.length || 1
  const completedDutiesCount = activeCleaningDuties.filter(
    (d) => d.status === 'completed' || deriveDutyStatus(d, todayStr) === 'completed'
  ).length
  const dutyProgressPercent = Math.max(
    0,
    Math.min(100, Math.round((completedDutiesCount / totalDutiesCount) * 100))
  )

  // Circular gauge geometry
  const gaugeRadius = 34
  const gaugeCircumference = 2 * Math.PI * gaugeRadius
  const gaugeOffset = gaugeCircumference * (1 - dutyProgressPercent / 100)

  // Dynamic hero status text based on live duty schedule
  const heroStatusText =
    overdueDuties.length > 0
      ? `${overdueDuties.length} overdue cleaning ${
          overdueDuties.length === 1 ? 'duty requires' : 'duties require'
        } attention`
      : todayDutiesList.length > 0
      ? `${todayDutiesList.length} cleaning ${
          todayDutiesList.length === 1 ? 'duty' : 'duties'
        } scheduled for today`
      : 'All cleaning duties are up to date'

  // Derive live balance numbers if treasuryOverview is provided
  const upiAccountSummary = treasuryOverview?.accounts.find(
    (a) => a.account.accountType === 'personal_upi'
  )
  const cashAccountSummary = treasuryOverview?.accounts.find(
    (a) => a.account.accountType === 'cash_box'
  )

  const totalBalance = treasuryOverview
    ? treasuryOverview.totalAvailableBalance
    : DEMO_BALANCES.totalBalance
  const bankBalance = upiAccountSummary
    ? upiAccountSummary.currentBalance
    : DEMO_BALANCES.bankBalance
  const cashBalance = cashAccountSummary
    ? cashAccountSummary.currentBalance
    : DEMO_BALANCES.cashBalance

  // Map for quick member lookup by ID to check active vs departed status
  const memberMap = new Map(allMembers.map((m) => [m.id, m]))

  // Handle QR Image File Upload via HTML5 FileReader
  const handleQrImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSettingsQrPreviewUrl(reader.result)
      }
    }
    reader.readAsDataURL(file)
  }

  // Handle Save Payment Settings
  const handleSaveSettings = (e: FormEvent) => {
    e.preventDefault()
    if (onUpdateCollectorQrConfig) {
      onUpdateCollectorQrConfig({
        collectorMembershipId: propCollectorQrConfig?.collectorMembershipId ?? 'm2',
        collectorName: settingsCollectorName.trim() || 'Arjun Verma',
        upiId: settingsUpiId.trim() || undefined,
        qrCodeImageUrl: settingsQrPreviewUrl,
        notes: settingsNotes.trim() || undefined,
      })
    }
    setIsQrSettingsModalOpen(false)
  }

  // Handle Contribution Submission from QR Card
  const handleContributionSubmit = (e: FormEvent) => {
    e.preventDefault()
    const amountPaise = rupeesToPaise(contributionAmountRupees)
    if (amountPaise <= 0) return

    const contributor = activeMembers.find((m) => m.id === payerMemberId)
    const newContribution: FundContribution = {
      id: generateEntityId('cnt'),
      accountId: 'acc-upi',
      contributorMembershipId: payerMemberId,
      contributorName: contributor?.name ?? 'Household Member',
      amount: paiseToRupees(amountPaise),
      date: '22 Nov 2026',
      status: 'pending_confirmation',
      transactionReference: paymentUtrReference.trim() || undefined,
      note: paymentProofNote.trim() || 'Payment via Household QR code',
    }

    if (onSubmitContribution) {
      onSubmitContribution(newContribution)
    }

    setPaymentSuccessMessage(
      `Contribution of ₹${contributionAmountRupees} submitted. Status is pending confirmation until verified by ${
        propCollectorQrConfig?.collectorName ?? 'the custodian'
      }.`
    )
    setIsPaymentModalOpen(false)
    setPaymentUtrReference('')
    setPaymentProofNote('')
    onClearScannedPaymentPrefill?.()
  }

  return (
    <div className="dashboard-view-container">
      {/* Success Notification Banner */}
      {paymentSuccessMessage && (
        <div className="demo-notice-banner" style={{ borderColor: 'var(--color-success-border)', backgroundColor: 'var(--color-success-bg)' }}>
          <span className="notice-pill" style={{ backgroundColor: 'var(--color-success-text)' }}>Payment Submitted</span>
          <span className="notice-text" style={{ color: 'var(--color-success-text)' }}>{paymentSuccessMessage}</span>
          <button
            type="button"
            className="modal-close-btn"
            onClick={() => setPaymentSuccessMessage(null)}
            style={{ marginLeft: 'auto' }}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      {/* Responsive Dashboard Layout */}
      <div className="dashboard-responsive-flow">
        {/* Left Column / Mobile Stack Top: Hero, Payment QR & Financial Balances */}
        <div className="dashboard-main-column">
          {/* 1. Household Pulse Hero Card (Purple Gradient & Dynamic Progress) */}
          <div className="tasknur-hero-card">
            <div className="tasknur-hero-content">
              <span className="tasknur-hero-eyebrow">Household Pulse</span>
              <h2 className="tasknur-hero-title">Your shared home is on track!</h2>
              <p className="tasknur-hero-subtitle">
                {heroStatusText} · ₹{totalBalance.toLocaleString('en-IN')} treasury pool
              </p>
              <button
                type="button"
                className="tasknur-hero-action-btn"
                onClick={() => onNavigate('cleaning')}
              >
                View Tasks
              </button>
            </div>
            <div className="tasknur-hero-progress-ring">
              <svg className="progress-ring-svg" width="84" height="84" viewBox="0 0 84 84">
                <circle
                  className="progress-ring-bg"
                  cx="42"
                  cy="42"
                  r={gaugeRadius}
                  strokeWidth="6"
                />
                <circle
                  className="progress-ring-fill"
                  cx="42"
                  cy="42"
                  r={gaugeRadius}
                  strokeWidth="6"
                  strokeDasharray={gaugeCircumference}
                  strokeDashoffset={gaugeOffset}
                />
              </svg>
              <div className="progress-ring-label">
                <span className="progress-ring-number">{dutyProgressPercent}%</span>
                <span className="progress-ring-text">Active</span>
              </div>
            </div>
          </div>

          {/* 2. Household Payment QR Card — Prominently Centered */}
          <section aria-labelledby="household-qr-heading" className="household-qr-section">
            <div className="household-qr-card">
              <div className="qr-card-header">
                <div>
                  <span className="qr-card-badge">Official Household QR</span>
                  <h3 id="household-qr-heading" className="qr-card-title">Home Fund Payment</h3>
                </div>
                <button
                  type="button"
                  className="qr-card-settings-btn"
                  onClick={() => setIsQrSettingsModalOpen(true)}
                  title="Configure Household Payment QR & Details"
                >
                  <SettingsIcon size={16} />
                  <span>Configure</span>
                </button>
              </div>

              <div className="qr-card-body">
                {propCollectorQrConfig?.qrCodeImageUrl ? (
                  <div className="qr-image-frame">
                    <img
                      src={propCollectorQrConfig.qrCodeImageUrl}
                      alt={`Household Payment QR for ${propCollectorQrConfig.collectorName}`}
                      className="qr-actual-image"
                    />
                  </div>
                ) : (
                  <div className="qr-unconfigured-placeholder">
                    <div className="qr-placeholder-icon">
                      <QrCodeIcon size={36} />
                    </div>
                    <strong className="qr-unconfigured-title">Household QR not configured</strong>
                    <p className="qr-unconfigured-text">Add a household payment QR in Payment Settings.</p>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setIsQrSettingsModalOpen(true)}
                      style={{ marginTop: 'var(--space-2)' }}
                    >
                      Configure QR in Payment Settings
                    </button>
                  </div>
                )}

                {/* Recipient Account Details */}
                <div className="qr-account-details">
                  <div className="qr-recipient-row">
                    <span className="qr-label">Recipient:</span>
                    <strong className="qr-val">{propCollectorQrConfig?.collectorName ?? 'Household Custodian'}</strong>
                  </div>
                  <div className="qr-recipient-row">
                    <span className="qr-label">UPI ID:</span>
                    <code className="qr-upi-code">{propCollectorQrConfig?.upiId ?? 'Not Configured'}</code>
                  </div>

                  {/* Prominently Displayed Contribution Amount */}
                  <div className="qr-amount-callout">
                    <span className="qr-amount-label">Suggested Monthly Contribution</span>
                    <span className="qr-amount-value">₹5,000</span>
                    <span className="qr-amount-sub">Per resident · Covers shared groceries, cook & electricity</span>
                  </div>
                </div>
              </div>

              <div className="qr-card-footer">
                <div style={{ display: 'flex', gap: 'var(--space-2)', width: '100%' }}>
                  <button
                    type="button"
                    className="btn-primary btn-purple"
                    style={{ flex: 1 }}
                    onClick={() => setIsPaymentModalOpen(true)}
                  >
                    Pay Household Contribution
                  </button>
                  {onOpenScanner && (
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      onClick={onOpenScanner}
                      title="Open mobile QR scanner"
                    >
                      <ScanQrIcon size={16} />
                      <span>Scan QR</span>
                    </button>
                  )}
                </div>
                <span className="qr-disclaimer-note">
                  Verify recipient details in your UPI app. Contributions remain pending until manually verified.
                </span>
              </div>
            </div>
          </section>

          {/* 3. Household Financial Summary (Balances) */}
          <section aria-labelledby="balances-heading" className="dashboard-balances-section">
            <div className="section-title-row">
              <div className="homebase-card-title-row">
                <h2 id="balances-heading" className="section-title">Household Treasury</h2>
                <Badge variant="neutral">Live Synchronized</Badge>
              </div>
              <span className="section-meta">
                Snapshot: {treasuryOverview?.asOfDate ?? DEMO_BALANCES.asOfDate}
              </span>
            </div>

            <div className="balances-grid">
              <StatCard
                label="Total Household Balance"
                amount={totalBalance}
                subtitle="Combined liquid funds across cash and UPI"
                icon={<FundIcon size={20} />}
                accent
                highlightTag="Available Total"
              />
              <StatCard
                label="UPI / Bank Balance"
                amount={bankBalance}
                subtitle="Funds held in custodian's personal UPI account"
                icon={<BankIcon size={20} />}
                highlightTag="Personal UPI"
              />
              <StatCard
                label="Cash in Hand"
                amount={cashBalance}
                subtitle="Physical cash held in household cash box"
                icon={<CashIcon size={20} />}
                highlightTag="Cash Box"
              />
            </div>
          </section>
        </div>

        {/* Right Column / Mobile Stack Bottom: Team Members & Operational History */}
        <div className="dashboard-side-column">
          {/* Household Roommates Avatar Row */}
          <div className="tasknur-members-strip">
            <div className="section-title-row" style={{ marginBottom: 'var(--space-2)' }}>
              <h3 className="section-title" style={{ fontSize: '0.875rem' }}>Household Roommates</h3>
              <span className="section-meta">{compositionLabel}</span>
            </div>
            <div className="tasknur-members-row">
              {activeMembers.map((m) => (
                <div key={m.id} className="tasknur-member-chip" title={`${m.name} (${m.roomLabel ?? 'Member'})`}>
                  <div className="tasknur-member-avatar-circle">
                    {m.avatarInitial}
                  </div>
                  <span className="tasknur-member-name">{m.name.split(' ')[0]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Shared Expenses */}
          <section aria-labelledby="recent-expenses-heading" className="dashboard-expenses-section">
            <Card>
              <CardHeader
                title="Recent Shared Expenses"
                subtitle="Synchronized expenditures with dynamic split resolution"
                badge={<Badge variant="neutral">{expenses.length} Entries</Badge>}
                action={
                  <button
                    type="button"
                    className="card-text-button"
                    onClick={() => onNavigate('expenses')}
                  >
                    View all
                  </button>
                }
              />
              <CardContent>
                <div className="expenses-list">
                  {expenses.slice(0, 4).map((expense) => {
                    const payer = memberMap.get(expense.payerMemberId)
                    const isPayerDeparted = payer?.status === 'departed'
                    const participantCount = expense.participantMemberIds.length
                    const displayAmount =
                      expense.amountPaise !== undefined
                        ? paiseToRupees(expense.amountPaise)
                        : expense.amount

                    return (
                      <div key={expense.id} className="expense-row-item">
                        <div className="expense-item-left">
                          <div className="expense-icon-badge">
                            <ExpensesIcon size={16} />
                          </div>
                          <div className="expense-item-info">
                            <span className="expense-title">{expense.title}</span>
                            <div className="expense-meta-line">
                              <span>
                                Paid by <strong>{expense.paidBy}</strong>
                                {isPayerDeparted && (
                                  <span className="nav-item-badge" style={{ marginLeft: '4px' }}>
                                    Departed
                                  </span>
                                )}
                              </span>
                              <span className="bullet-sep">·</span>
                              <span>{expense.date}</span>
                              {expense.disbursementChannel === 'member_out_of_pocket' && (
                                <>
                                  <span className="bullet-sep">·</span>
                                  <span style={{ color: 'var(--color-accent-primary)' }}>Out-of-Pocket</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="expense-item-right">
                          <span className="expense-amount">
                            ₹{displayAmount.toLocaleString('en-IN')}
                          </span>
                          <span className="expense-split-tag">
                            {formatSplitScopeLabel(expense.splitScopeType, participantCount)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Cleaning Schedule */}
          <section aria-labelledby="cleaning-heading" className="dashboard-cleaning-section" style={{ marginTop: 'var(--space-6)' }}>
            <Card>
              <CardHeader
                title="Upcoming Cleaning Duties"
                subtitle="Scheduled chores & rotating roster"
                badge={<Badge variant="neutral">{prioritizedDuties.length} Active</Badge>}
                action={
                  <button
                    type="button"
                    className="card-text-button"
                    onClick={() => onNavigate('cleaning')}
                  >
                    View roster
                  </button>
                }
              />
              <CardContent>
                <div className="duties-list">
                  {prioritizedDuties.length === 0 ? (
                    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>
                      All duties cleared. Household is clean!
                    </p>
                  ) : (
                    prioritizedDuties.map((duty) => {
                      const dutyStatus = deriveDutyStatus(duty, todayStr)
                      const isOverdue = dutyStatus === 'overdue'
                      const isToday = dutyStatus === 'pending' && duty.dueDate === todayStr

                      return (
                        <div key={duty.id} className="duty-row-item">
                          <div className="duty-item-left">
                            <div className={`duty-icon-badge ${isOverdue ? 'duty-badge-overdue' : ''}`}>
                              <CleaningIcon size={16} />
                            </div>
                            <div className="duty-item-info">
                              <span className="duty-title">{duty.title}</span>
                              <div className="duty-meta-line">
                                <span>{duty.area}</span>
                                <span className="bullet-sep">·</span>
                                <span>Assigned to <strong>{duty.assignedMemberNames.join(', ')}</strong></span>
                              </div>
                            </div>
                          </div>

                          <div className="duty-item-right">
                            <Badge variant={isOverdue ? 'danger' : isToday ? 'warning' : 'neutral'}>
                              {isOverdue ? 'Overdue' : isToday ? 'Due Today' : duty.dueDate}
                            </Badge>
                            {onCompleteCleaningDuty && duty.status === 'pending' && (
                              <button
                                type="button"
                                className="btn-secondary btn-sm"
                                onClick={() => onCompleteCleaningDuty(duty.id)}
                              >
                                Complete
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Inventory Restock Alerts (if any) */}
          {activeRestockAlerts.length > 0 && (
            <section aria-labelledby="restock-heading" className="dashboard-inventory-section" style={{ marginTop: 'var(--space-6)' }}>
              <Card>
                <CardHeader
                  title="Inventory Restock Alerts"
                  subtitle="Provisions running below minimum threshold"
                  badge={<Badge variant="warning">{activeRestockAlerts.length} Alerts</Badge>}
                  action={
                    <button
                      type="button"
                      className="card-text-button"
                      onClick={() => onNavigate('inventory')}
                    >
                      Inventory
                    </button>
                  }
                />
                <CardContent>
                  <div className="duties-list">
                    {activeRestockAlerts.map(({ item, status }) => (
                      <div key={item.id} className="duty-row-item">
                        <div className="duty-item-left">
                          <div className="duty-icon-badge duty-badge-overdue">
                            <AlertTriangleIcon size={16} />
                          </div>
                          <div className="duty-item-info">
                            <span className="duty-title">{item.name}</span>
                            <div className="duty-meta-line">
                              <span>
                                In Stock:{' '}
                                <strong>{formatInventoryQuantity(item.currentQuantityMilli, item.unit)}</strong>
                              </span>
                              <span className="bullet-sep">·</span>
                              <span>
                                Min:{' '}
                                {formatInventoryQuantity(item.minThresholdMilli, item.unit)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <Badge variant={status === 'empty' ? 'danger' : 'warning'}>
                          {status.toUpperCase()}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </section>
          )}
        </div>
      </div>

      {/* ======================================================================
         MODAL 1: Household Contribution Payment Modal
         ====================================================================== */}
      {isPaymentModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h3 className="modal-title">Pay Household Contribution</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  setIsPaymentModalOpen(false)
                  onClearScannedPaymentPrefill?.()
                }}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <form onSubmit={handleContributionSubmit}>
              <div className="modal-body">
                {/* Critical Payment Verification Banner */}
                <div className="audit-notice-banner" style={{ borderLeftColor: 'var(--color-accent-primary)', backgroundColor: 'var(--color-accent-light)' }}>
                  <strong>Important:</strong> Please verify recipient{' '}
                  <strong>{propCollectorQrConfig?.collectorName ?? 'Household Custodian'}</strong> and UPI ID{' '}
                  <code>{propCollectorQrConfig?.upiId ?? 'arjun.verma@okhdfcbank'}</code> in your UPI app before completing payment.
                </div>

                <div className="form-group">
                  <label className="form-label">Paying Member</label>
                  <select
                    className="form-select"
                    value={payerMemberId}
                    onChange={(e) => setPayerMemberId(e.target.value)}
                  >
                    {activeMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.roomLabel ?? 'Resident'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Contribution Amount (₹)</label>
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    required
                    className="form-input"
                    value={contributionAmountRupees}
                    onChange={(e) => setContributionAmountRupees(e.target.value)}
                  />
                  <span className="form-helper">
                    Standard monthly share is ₹5,000. You may adjust if making partial or advance payment.
                  </span>
                </div>

                <div className="form-group">
                  <label className="form-label">Bank Reference / UPI UTR Number</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="e.g. 430291823719"
                    value={paymentUtrReference}
                    onChange={(e) => setPaymentUtrReference(e.target.value)}
                  />
                  <span className="form-helper">
                    12-digit transaction ID from Google Pay, PhonePe, Paytm, or your banking app.
                  </span>
                </div>

                <div className="form-group">
                  <label className="form-label">Payment Proof Note / Confirmation</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Sent via GPay to Arjun · Screenshot saved"
                    value={paymentProofNote}
                    onChange={(e) => setPaymentProofNote(e.target.value)}
                  />
                  <span className="form-helper">
                    Notes will be attached to the immutable ledger record for custodian verification.
                  </span>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setIsPaymentModalOpen(false)
                    onClearScannedPaymentPrefill?.()
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary btn-purple">
                  Submit Contribution
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================================
         MODAL 2: Household Payment & QR Settings Modal
         ====================================================================== */}
      {isQrSettingsModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h3 className="modal-title">Payment & QR Settings</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsQrSettingsModalOpen(false)}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveSettings}>
              <div className="modal-body">
                <p className="section-meta" style={{ marginBottom: 'var(--space-3)' }}>
                  Configure the official household bank account QR code and recipient identifiers.
                </p>

                {/* QR Code Upload & Preview */}
                <div className="form-group">
                  <label className="form-label">Upload Household Bank QR Code Image</label>
                  <input
                    type="file"
                    accept="image/*"
                    className="form-input"
                    onChange={handleQrImageUpload}
                  />
                  <span className="form-helper">
                    Upload an image or screenshot of the QR code obtained from the household's bank account or payment app.
                  </span>
                </div>

                {settingsQrPreviewUrl ? (
                  <div className="qr-preview-box">
                    <span className="qr-label">QR Code Preview:</span>
                    <div className="qr-image-frame" style={{ width: 140, height: 140, margin: '8px auto' }}>
                      <img
                        src={settingsQrPreviewUrl}
                        alt="QR Code Preview"
                        className="qr-actual-image"
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setSettingsQrPreviewUrl(undefined)}
                    >
                      Remove QR Image
                    </button>
                  </div>
                ) : (
                  <div className="audit-notice-banner" style={{ margin: 'var(--space-2) 0' }}>
                    No QR code image uploaded yet. The dashboard will show the unconfigured state until an image is attached.
                  </div>
                )}

                <div className="form-group" style={{ marginTop: 'var(--space-3)' }}>
                  <label className="form-label">Account Holder / Custodian Name</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    value={settingsCollectorName}
                    onChange={(e) => setSettingsCollectorName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Household UPI ID</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="e.g. household@okhdfcbank"
                    value={settingsUpiId}
                    onChange={(e) => setSettingsUpiId(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Payment Instructions / Bank Notes</label>
                  <textarea
                    rows={2}
                    className="form-textarea"
                    placeholder="e.g. HDFC Bank Greenwood Heights Pool A/C"
                    value={settingsNotes}
                    onChange={(e) => setSettingsNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsQrSettingsModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary btn-purple">
                  Save Payment Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
