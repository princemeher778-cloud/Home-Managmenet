import { useState, type FC, type FormEvent } from 'react'
import type {
  ExpenseItem,
  HouseholdMember,
  MemberSettlementRecord,
  NavSection,
  ObligationReconciliationSummary,
  RootFinancialState,
} from '../../types/index.ts'
import {
  calculateAccountLiquidBalance,
  deriveObligationReconciliationSummary,
  deriveOrderIndependentMemberDebt,
  getAvailablePeerCreditPaise,
} from '../../utils/billsRent.ts'
import {
  formatPaise,
  generateEntityId,
  paiseToRupees,
  rupeesToPaise,
} from '../../utils/financial.ts'
import { Badge } from '../common/Badge.tsx'
import { Card, CardContent } from '../common/Card.tsx'
import {
  AlertTriangleIcon,
  BankIcon,
  CashIcon,
  CheckCircleIcon,
  CloseIcon,
  FlameIcon,
  HouseIcon,
  QrCodeIcon,
  ZapIcon,
} from '../common/Icons.tsx'
import { StatCard } from '../common/StatCard.tsx'

export interface BillsRentViewProps {
  onNavigate: (section: NavSection) => void
  financialState: RootFinancialState
  members: HouseholdMember[]
  currentDate?: string
  onDisburseTreasuryProviderPayment: (payload: {
    expense: ExpenseItem
    obligationId: string
  }) => void
  onRecordPersonalProviderPayment: (expense: ExpenseItem) => void
  onSubmitMemberSettlement: (settlement: MemberSettlementRecord) => void
  onConfirmMemberSettlement: (payload: {
    settlementId: string
    confirmedByMemberId: string
    confirmedAt?: string
    generatedPeerCreditId?: string
  }) => void
  onRejectMemberSettlement: (payload: {
    settlementId: string
    rejectedByMemberId: string
    rejectionReason: string
    rejectedAt?: string
  }) => void
  onVoidObligation?: (
    obligationId: string,
    voidReason: string,
    voidedByMembershipId: string
  ) => void
}

type BillsTab = 'all' | 'electricity' | 'gas' | 'rent' | 'claims' | 'credits'

export const BillsRentView: FC<BillsRentViewProps> = ({
  onNavigate: _onNavigate,
  financialState,
  members,
  currentDate = '20 Nov 2026',
  onDisburseTreasuryProviderPayment,
  onRecordPersonalProviderPayment,
  onSubmitMemberSettlement,
  onConfirmMemberSettlement,
  onRejectMemberSettlement,
}) => {
  const [activeTab, setActiveTab] = useState<BillsTab>('all')
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false)
  const [isSettlementModalOpen, setIsSettlementModalOpen] = useState(false)
  const [selectedObligationId, setSelectedObligationId] = useState<string>('')
  const [selectedClaimId, setSelectedClaimId] = useState<string>('')
  const [rejectionPromptSettlementId, setRejectionPromptSettlementId] = useState<string | null>(null)
  const [rejectionReasonInput, setRejectionReasonInput] = useState<string>('')
  const [expandedObligationId, setExpandedObligationId] = useState<string | null>(null)

  // Modals form state: Provider Payment
  const [providerSourceType, setProviderSourceType] = useState<'treasury' | 'personal'>('treasury')
  const [providerAccountId, setProviderAccountId] = useState<string>(
    financialState.accounts[0]?.id ?? 'acc-upi'
  )
  const [personalPayerId, setPersonalPayerId] = useState<string>(members[0]?.id ?? 'm1')
  const [providerPaymentAmountRupees, setProviderPaymentAmountRupees] = useState<string>('')
  const [providerPaymentDate, setProviderPaymentDate] = useState<string>(currentDate)
  const [providerPaymentRef, setProviderPaymentRef] = useState<string>('')
  const [providerPaymentNotes, setProviderPaymentNotes] = useState<string>('')
  const [providerPaymentError, setProviderPaymentError] = useState<string | null>(null)

  // Modals form state: Peer Settlement
  const [settlementDebtorId, setSettlementDebtorId] = useState<string>('')
  const [settlementAmountRupees, setSettlementAmountRupees] = useState<string>('')
  const [settlementMethod, setSettlementMethod] = useState<'upi' | 'cash'>('upi')
  const [settlementApp, setSettlementApp] = useState<string>('Google Pay')
  const [settlementRef, setSettlementRef] = useState<string>('')
  const [settlementProofNote, setSettlementProofNote] = useState<string>('')
  const [settlementNotes, setSettlementNotes] = useState<string>('')
  const [settlementError, setSettlementError] = useState<string | null>(null)

  const activeObligations = financialState.obligations.filter((o) => !o.isVoided)

  // 1. Full Obligation Reconciliations
  const obligationReconciliations = new Map<string, ObligationReconciliationSummary>()
  for (const obligation of activeObligations) {
    const recon = deriveObligationReconciliationSummary(
      obligation,
      financialState.allocations,
      financialState.contributions,
      financialState.expenses,
      financialState.memberSettlements
    )
    obligationReconciliations.set(obligation.id, recon)
  }

  // 2. High-Level Aggregated Metrics
  const totalObligationsPaise = activeObligations.reduce((sum, o) => sum + o.totalAmountPaise, 0)
  const totalProviderPaidPaise = Array.from(obligationReconciliations.values()).reduce(
    (sum, r) => sum + r.providerPaidPaise,
    0
  )
  const totalProviderRemainingPaise = Math.max(0, totalObligationsPaise - totalProviderPaidPaise)

  // Total active peer claims across household
  const totalPeerClaimsPaise = financialState.peerClaims.reduce(
    (sum, c) => sum + c.claimAmountPaise,
    0
  )
  const totalConfirmedSettledPaise = financialState.memberSettlements
    .filter((s) => s.status === 'confirmed')
    .reduce((sum, s) => sum + s.amountPaise, 0)
  const totalPendingSettledPaise = financialState.memberSettlements
    .filter((s) => s.status === 'pending_confirmation')
    .reduce((sum, s) => sum + s.amountPaise, 0)

  // 3. Tab Filtered Obligations
  const filteredObligations = activeObligations.filter((o) => {
    if (activeTab === 'electricity') return o.category === 'electricity_bill'
    if (activeTab === 'gas') return o.category === 'gas_bill'
    if (activeTab === 'rent') return o.category === 'rent_cycle'
    return true
  })

  // Open Provider Payment Modal for a specific obligation
  const handleOpenProviderModal = (obligationId?: string) => {
    const targetId = obligationId ?? activeObligations[0]?.id ?? ''
    setSelectedObligationId(targetId)
    const targetObligation = activeObligations.find((o) => o.id === targetId)
    const recon = targetObligation ? obligationReconciliations.get(targetObligation.id) : null
    const remainingRupees = recon ? paiseToRupees(recon.providerRemainingPaise).toString() : ''
    setProviderPaymentAmountRupees(remainingRupees)
    setProviderPaymentError(null)
    setIsProviderModalOpen(true)
  }

  // Handle Provider Payment Submit
  const handleProviderPaymentSubmit = (e: FormEvent) => {
    e.preventDefault()
    setProviderPaymentError(null)

    const targetObligation = activeObligations.find((o) => o.id === selectedObligationId)
    if (!targetObligation) {
      setProviderPaymentError('Please select a valid obligation.')
      return
    }

    const amountPaise = rupeesToPaise(Number(providerPaymentAmountRupees))
    if (amountPaise <= 0 || !Number.isInteger(amountPaise)) {
      setProviderPaymentError('Payment amount must be a positive number.')
      return
    }

    const recon = obligationReconciliations.get(targetObligation.id)
    const remainingPaise = recon?.providerRemainingPaise ?? targetObligation.totalAmountPaise
    if (amountPaise > remainingPaise) {
      setProviderPaymentError(
        `Payment of ₹${paiseToRupees(amountPaise)} exceeds remaining bill capacity (₹${paiseToRupees(remainingPaise)}).`
      )
      return
    }

    if (providerSourceType === 'treasury') {
      const account = financialState.accounts.find((a) => a.id === providerAccountId)
      if (!account || !account.isActive) {
        setProviderPaymentError('Selected Treasury account is invalid or inactive.')
        return
      }
      const liquidBalancePaise = calculateAccountLiquidBalance(financialState, account.id)
      if (liquidBalancePaise < amountPaise) {
        setProviderPaymentError(
          `Insufficient balance in ${account.name}. Available: ₹${paiseToRupees(liquidBalancePaise)}, Required: ₹${paiseToRupees(amountPaise)}.`
        )
        return
      }

      const expense: ExpenseItem = {
        id: generateEntityId('exp'),
        title: `${targetObligation.title} — Utility Provider Disbursal`,
        category: targetObligation.category === 'rent_cycle' ? 'Rent & Society' : 'Utilities & Internet',
        amount: paiseToRupees(amountPaise),
        amountPaise,
        payerMemberId: account.custodianMembershipId ?? 'm2',
        paidBy: `${account.custodianName} (Custodian)`,
        date: providerPaymentDate,
        description: providerPaymentNotes.trim() || undefined,
        splitScopeType: 'custom',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: account.accountType === 'cash_box' ? 'treasury_cash_box' : 'treasury_personal_upi',
        disbursedFromAccountId: account.id,
        disbursementStatus: 'disbursed',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: targetObligation.id,
      }

      onDisburseTreasuryProviderPayment({
        expense,
        obligationId: targetObligation.id,
      })
    } else {
      const payer = members.find((m) => m.id === personalPayerId)
      const expense: ExpenseItem = {
        id: generateEntityId('exp'),
        title: `${targetObligation.title} — Direct Personal Payment`,
        category: targetObligation.category === 'rent_cycle' ? 'Rent & Society' : 'Utilities & Internet',
        amount: paiseToRupees(amountPaise),
        amountPaise,
        payerMemberId: personalPayerId,
        paidBy: payer?.name ?? 'Household Member',
        date: providerPaymentDate,
        description: providerPaymentNotes.trim() || undefined,
        splitScopeType: 'custom',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: 'member_out_of_pocket',
        disbursementStatus: 'disbursed',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: targetObligation.id,
      }

      onRecordPersonalProviderPayment(expense)
    }

    setIsProviderModalOpen(false)
    setProviderPaymentAmountRupees('')
    setProviderPaymentRef('')
    setProviderPaymentNotes('')
  }

  // Open Settlement Modal
  const handleOpenSettlementModal = (claimId?: string) => {
    const targetClaim = financialState.peerClaims.find((c) => c.id === claimId) ?? financialState.peerClaims[0]
    if (targetClaim) {
      setSelectedClaimId(targetClaim.id)
      setSettlementDebtorId(targetClaim.debtorMemberId)
      const confirmedPaid = financialState.memberSettlements
        .filter((s) => s.claimId === targetClaim.id && s.status === 'confirmed')
        .reduce((sum, s) => sum + s.amountPaise, 0)
      const remainingPaise = Math.max(0, targetClaim.claimAmountPaise - confirmedPaid)
      setSettlementAmountRupees(paiseToRupees(remainingPaise).toString())
    }
    setSettlementError(null)
    setIsSettlementModalOpen(true)
  }

  // Handle Settlement Submit
  const handleSettlementSubmit = (e: FormEvent) => {
    e.preventDefault()
    setSettlementError(null)

    const claim = financialState.peerClaims.find((c) => c.id === selectedClaimId)
    if (!claim) {
      setSettlementError('Please select a valid peer claim.')
      return
    }

    const amountPaise = rupeesToPaise(Number(settlementAmountRupees))
    if (amountPaise <= 0 || !Number.isInteger(amountPaise)) {
      setSettlementError('Settlement amount must be a positive number.')
      return
    }

    if (settlementMethod === 'upi' && !settlementRef.trim()) {
      setSettlementError('UPI reference / UTR number is mandatory for online settlements.')
      return
    }

    if (!settlementProofNote.trim()) {
      setSettlementError('Payment screenshot reference or verification note is mandatory.')
      return
    }

    const newSettlement: MemberSettlementRecord = {
      id: generateEntityId('settle'),
      idempotencyKey: generateEntityId('idem-settle'),
      obligationId: claim.obligationId,
      claimId: claim.id,
      debtorMemberId: settlementDebtorId || claim.debtorMemberId,
      creditorMemberId: claim.creditorMemberId,
      amountPaise,
      paymentMethod: settlementMethod,
      paymentReference: settlementRef.trim() || undefined,
      proofReceiptUrl: settlementProofNote.trim() || undefined,
      paymentDate: currentDate,
      notes: `${settlementApp ? `[${settlementApp}] ` : ''}${settlementNotes.trim()}`.trim() || undefined,
      status: 'pending_confirmation',
      submittedAt: new Date().toISOString(),
    }

    onSubmitMemberSettlement(newSettlement)
    setIsSettlementModalOpen(false)
    setSettlementAmountRupees('')
    setSettlementRef('')
    setSettlementProofNote('')
    setSettlementNotes('')
  }

  // Confirm rejection with reason
  const handleConfirmRejection = () => {
    if (!rejectionPromptSettlementId || !rejectionReasonInput.trim()) return

    const settlement = financialState.memberSettlements.find((s) => s.id === rejectionPromptSettlementId)
    if (settlement) {
      onRejectMemberSettlement({
        settlementId: settlement.id,
        rejectedByMemberId: settlement.creditorMemberId,
        rejectionReason: rejectionReasonInput.trim(),
      })
    }
    setRejectionPromptSettlementId(null)
    setRejectionReasonInput('')
  }

  return (
    <div className="bills-rent-view-container">
      {/* Notice Banner */}
      <div className="demo-notice-banner">
        <span className="notice-pill">Stage 6 Bills & Rent</span>
        <span className="notice-text">
          Utility obligations, provider settlements, and peer reimbursement tracking. All allocations follow deterministic chronological FIFO accounting.
        </span>
      </div>

      {/* Action Header */}
      {/* 1. Tasknur Bills & Rent Obligations Hero Card */}
      <div className="tasknur-hero-card">
        <div className="tasknur-hero-content">
          <span className="tasknur-hero-eyebrow">Obligations & Rent Cycles</span>
          <h2 className="tasknur-hero-title">
            {formatPaise(totalObligationsPaise)}
          </h2>
          <p className="tasknur-hero-subtitle">
            {Math.round((totalProviderPaidPaise / (totalObligationsPaise || 1)) * 100)}% funded to providers · {formatPaise(totalPeerClaimsPaise)} peer claims · Cycle: Nov–Dec 2026
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button
              type="button"
              className="tasknur-hero-action-btn"
              onClick={() => handleOpenProviderModal()}
            >
              Pay Provider Bill
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                color: '#ffffff',
                borderColor: 'rgba(255, 255, 255, 0.3)',
                borderRadius: 'var(--radius-full)',
                fontWeight: 600,
                padding: '8px 16px',
              }}
              onClick={() => handleOpenSettlementModal()}
            >
              Settle P2P Claim
            </button>
          </div>
        </div>
        <div className="tasknur-hero-progress-ring">
          <svg className="progress-ring-svg" width="84" height="84" viewBox="0 0 84 84">
            <circle
              className="progress-ring-bg"
              cx="42"
              cy="42"
              r="34"
              strokeWidth="6"
            />
            <circle
              className="progress-ring-fill"
              cx="42"
              cy="42"
              r="34"
              strokeWidth="6"
              strokeDasharray={213.63}
              strokeDashoffset={213.63 * (1 - Math.min(1, totalProviderPaidPaise / (totalObligationsPaise || 1)))}
            />
          </svg>
          <div className="progress-ring-label">
            <span className="progress-ring-number">
              {Math.round((totalProviderPaidPaise / (totalObligationsPaise || 1)) * 100)}%
            </span>
            <span className="progress-ring-text">Funded</span>
          </div>
        </div>
      </div>

      {/* Top Aggregated Metric Cards */}
      <section aria-label="Bills & Rent Key Metrics">
        <div className="dashboard-stats-grid">
          <StatCard
            label="Total Obligations"
            amount={paiseToRupees(totalObligationsPaise)}
            icon={<BankIcon size={20} />}
            subtitle="Electricity, gas & monthly rent"
            highlightTag="Active Cycle"
          />
          <StatCard
            label="Paid to Providers"
            amount={paiseToRupees(totalProviderPaidPaise)}
            icon={<CheckCircleIcon size={20} />}
            subtitle={`Remaining: ${formatPaise(totalProviderRemainingPaise)}`}
            accent
            highlightTag={`${Math.round((totalProviderPaidPaise / (totalObligationsPaise || 1)) * 100)}% Funded`}
          />
          <StatCard
            label="Total Peer Claims"
            amount={paiseToRupees(totalPeerClaimsPaise)}
            icon={<CashIcon size={20} />}
            subtitle={`Confirmed Paid: ${formatPaise(totalConfirmedSettledPaise)}`}
            highlightTag="P2P Liabilities"
          />
          <StatCard
            label="Pending Settlement Queue"
            amount={paiseToRupees(totalPendingSettledPaise)}
            icon={<AlertTriangleIcon size={20} />}
            subtitle="Awaiting creditor verification"
            highlightTag={totalPendingSettledPaise > 0 ? `${formatPaise(totalPendingSettledPaise)} Review` : 'All Verified'}
          />
        </div>
      </section>

      {/* Filter Tabs */}
      <div className="filter-tabs-row" role="tablist">
        {(
          [
            { id: 'all', label: 'All Obligations' },
            { id: 'electricity', label: 'Electricity Bills' },
            { id: 'gas', label: 'Piped Gas' },
            { id: 'rent', label: 'House Rent' },
            { id: 'claims', label: 'Peer Claims & P2P' },
            { id: 'credits', label: 'Peer Credits & Excess' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`filter-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Obligations List View */}
      {(activeTab === 'all' || activeTab === 'electricity' || activeTab === 'gas' || activeTab === 'rent') && (
        <section aria-label="Obligation Cards List">
          <div className="obligations-grid">
            {filteredObligations.map((obligation) => {
              const recon = obligationReconciliations.get(obligation.id)
              const percentPaid = Math.min(
                100,
                Math.round(((recon?.providerPaidPaise ?? 0) / (obligation.totalAmountPaise || 1)) * 100)
              )
              const isExpanded = expandedObligationId === obligation.id

              return (
                <div key={obligation.id} className="obligation-card">
                  {/* Card Header */}
                  <div className="obligation-card-header">
                    <div className="obligation-title-block">
                      <div
                        className={`obligation-category-icon ${
                          obligation.category === 'electricity_bill'
                            ? 'electricity'
                            : obligation.category === 'gas_bill'
                              ? 'gas'
                              : 'rent'
                        }`}
                      >
                        {obligation.category === 'electricity_bill' ? (
                          <ZapIcon size={22} />
                        ) : obligation.category === 'gas_bill' ? (
                          <FlameIcon size={22} />
                        ) : (
                          <HouseIcon size={22} />
                        )}
                      </div>
                      <div>
                        <div className="homebase-card-title-row">
                          <h3 className="section-title">{obligation.title}</h3>
                          <Badge
                            variant={
                              recon?.status === 'completed' || recon?.status === 'paid_to_provider'
                                ? 'success'
                                : recon?.status === 'fully_funded'
                                  ? 'accent'
                                  : recon?.status === 'partially_funded'
                                    ? 'warning'
                                    : 'neutral'
                            }
                          >
                            {recon?.status ? recon.status.replace(/_/g, ' ').toUpperCase() : 'ACTIVE'}
                          </Badge>
                        </div>
                        <div className="obligation-info-row">
                          <span>Provider: <strong>{obligation.providerName}</strong></span>
                          {obligation.consumerAccountNumber && (
                            <>
                              <span className="bullet-sep">•</span>
                              <span>A/C: <code>{obligation.consumerAccountNumber}</code></span>
                            </>
                          )}
                          <span className="bullet-sep">•</span>
                          <span>Due: <strong>{obligation.dueDate}</strong></span>
                          <span className="bullet-sep">•</span>
                          <span>Period: {obligation.billingPeriodStart} to {obligation.billingPeriodEnd}</span>
                        </div>
                      </div>
                    </div>

                    <div className="home-fund-action-buttons">
                      {(recon?.providerRemainingPaise ?? 0) > 0 && (
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={() => handleOpenProviderModal(obligation.id)}
                        >
                          Disburse Bill
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Metrics Row */}
                  <div className="obligation-metrics-grid">
                    <div className="metric-item">
                      <span className="metric-label">Total Bill</span>
                      <span className="metric-value">{formatPaise(obligation.totalAmountPaise)}</span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Paid to Provider</span>
                      <span className="metric-value" style={{ color: 'var(--color-success-text)' }}>
                        {formatPaise(recon?.providerPaidPaise ?? 0)}
                      </span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Remaining Due</span>
                      <span
                        className="metric-value"
                        style={{
                          color:
                            (recon?.providerRemainingPaise ?? 0) > 0
                              ? 'var(--color-danger-text)'
                              : 'var(--color-text-primary)',
                        }}
                      >
                        {formatPaise(recon?.providerRemainingPaise ?? 0)}
                      </span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Treasury Advance</span>
                      <span className="metric-value">{formatPaise(recon?.treasuryAdvancePaise ?? 0)}</span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Out-of-Pocket</span>
                      <span className="metric-value">
                        {formatPaise(recon?.totalPersonalDisbursedPaise ?? 0)}
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="obligation-progress-wrap">
                    <div className="section-title-row" style={{ marginBottom: 2 }}>
                      <span className="metric-label">Provider Funding Progress</span>
                      <span className="section-meta">{percentPaid}% Settled</span>
                    </div>
                    <div className="obligation-progress-bar-bg">
                      <div
                        className="obligation-progress-bar-fill"
                        style={{ width: `${percentPaid}%` }}
                      />
                    </div>
                  </div>

                  {/* Collapsible Member Shares Breakdown */}
                  <div>
                    <button
                      type="button"
                      className="shares-section-toggle"
                      onClick={() => setExpandedObligationId(isExpanded ? null : obligation.id)}
                    >
                      <span>
                        {isExpanded ? '▼ Hide' : '▶ View'} Member Share Breakdown ({obligation.shares.length} Participants)
                      </span>
                      <span className="section-meta">
                        Per-member share: {formatPaise(obligation.shares[0]?.sharePaise ?? 0)}
                      </span>
                    </button>

                    {isExpanded && recon && (
                      <div className="table-responsive" style={{ marginTop: 'var(--space-3)' }}>
                        <table className="homebase-table">
                          <thead>
                            <tr>
                              <th>Household Member</th>
                              <th>Base Share</th>
                              <th>Allocated / Paid</th>
                              <th>Owed to Fund</th>
                              <th>Owed to Creditor</th>
                              <th>Total Outstanding</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recon.memberSummaries.map((summary) => {
                              const member = members.find((m) => m.id === summary.memberId)
                              const isSettled = summary.totalOutstandingPaise === 0
                              return (
                                <tr key={summary.memberId}>
                                  <td>
                                    <div className="table-member-cell">
                                      <span className="table-member-avatar">
                                        {member?.avatarInitial ?? summary.memberId.slice(0, 2).toUpperCase()}
                                      </span>
                                      <strong>{member?.name ?? summary.memberId}</strong>
                                    </div>
                                  </td>
                                  <td>{formatPaise(summary.baseSharePaise)}</td>
                                  <td>
                                    {formatPaise(
                                      summary.confirmedAllocatedPaise + summary.personalPaymentOwnSharePaise
                                    )}
                                  </td>
                                  <td>{formatPaise(summary.owedToHomeFundPaise)}</td>
                                  <td>{formatPaise(summary.owedToCreditorsPaise)}</td>
                                  <td style={{ fontWeight: 700 }}>
                                    {formatPaise(summary.totalOutstandingPaise)}
                                  </td>
                                  <td>
                                    <Badge variant={isSettled ? 'success' : 'warning'}>
                                      {isSettled ? 'Settled' : 'Pending'}
                                    </Badge>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Peer Claims & Settlements Tab */}
      {(activeTab === 'all' || activeTab === 'claims') && (
        <section aria-labelledby="peer-claims-heading">
          <div className="section-title-row">
            <div>
              <h3 id="peer-claims-heading" className="section-title">
                Active Peer-to-Peer Reimbursement Claims
              </h3>
              <span className="section-meta">
                Created when members pay utility bills or rent out-of-pocket on behalf of the household
              </span>
            </div>
          </div>

          <div className="claims-grid">
            {financialState.peerClaims.map((claim) => {
              const creditor = members.find((m) => m.id === claim.creditorMemberId)
              const debtor = members.find((m) => m.id === claim.debtorMemberId)
              const obligation = financialState.obligations.find((o) => o.id === claim.obligationId)

              const confirmedPaid = financialState.memberSettlements
                .filter((s) => s.claimId === claim.id && s.status === 'confirmed')
                .reduce((sum, s) => sum + s.amountPaise, 0)
              const pendingPaid = financialState.memberSettlements
                .filter((s) => s.claimId === claim.id && s.status === 'pending_confirmation')
                .reduce((sum, s) => sum + s.amountPaise, 0)
              const remainingClaim = Math.max(0, claim.claimAmountPaise - confirmedPaid)

              return (
                <div key={claim.id} className="claim-card">
                  <div className="claim-card-header">
                    <span className="metric-label">{obligation?.title ?? 'Utility Claim'}</span>
                    <Badge variant={remainingClaim === 0 ? 'success' : 'warning'}>
                      {remainingClaim === 0 ? 'Fully Reimbursed' : 'Payment Due'}
                    </Badge>
                  </div>

                  <div className="claim-parties">
                    <span>{debtor?.name ?? claim.debtorMemberId}</span>
                    <span style={{ color: 'var(--color-text-muted)' }}>owes</span>
                    <span style={{ color: 'var(--color-accent-primary)' }}>
                      {creditor?.name ?? claim.creditorMemberId}
                    </span>
                  </div>

                  <div className="obligation-metrics-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                    <div className="metric-item">
                      <span className="metric-label">Claim Total</span>
                      <span className="metric-value">{formatPaise(claim.claimAmountPaise)}</span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Confirmed</span>
                      <span className="metric-value" style={{ color: 'var(--color-success-text)' }}>
                        {formatPaise(confirmedPaid)}
                      </span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Remaining</span>
                      <span
                        className="metric-value"
                        style={{
                          color: remainingClaim > 0 ? 'var(--color-danger-text)' : 'var(--color-text-primary)',
                        }}
                      >
                        {formatPaise(remainingClaim)}
                      </span>
                    </div>
                  </div>

                  {pendingPaid > 0 && (
                    <div className="audit-notice-banner" style={{ borderLeftColor: 'var(--color-warning-text)' }}>
                      {formatPaise(pendingPaid)} submitted and awaiting creditor verification.
                    </div>
                  )}

                  {remainingClaim > 0 && (
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => handleOpenSettlementModal(claim.id)}
                    >
                      Settle Claim
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Creditor Settlements Review Card */}
          <div style={{ marginTop: 'var(--space-6)' }}>
            <Card>
              <CardContent>
                <div className="section-title-row">
                  <div>
                    <h3 className="section-title">Creditor Settlement Verification Ledger</h3>
                    <span className="section-meta">
                      Creditors verify received bank/cash transfers. Settlements remain pending until confirmed.
                    </span>
                  </div>
                </div>

                <div className="table-responsive">
                  <table className="homebase-table">
                    <thead>
                      <tr>
                        <th>Debtor</th>
                        <th>Creditor</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Reference / Proof</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {financialState.memberSettlements.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
                            No settlements logged yet.
                          </td>
                        </tr>
                      ) : (
                        financialState.memberSettlements.map((s) => {
                          const debtor = members.find((m) => m.id === s.debtorMemberId)
                          const creditor = members.find((m) => m.id === s.creditorMemberId)
                          const isPending = s.status === 'pending_confirmation'

                          return (
                            <tr key={s.id}>
                              <td>
                                <div className="table-member-cell">
                                  <span className="table-member-avatar">
                                    {debtor?.avatarInitial ?? s.debtorMemberId.slice(0, 2).toUpperCase()}
                                  </span>
                                  <strong>{debtor?.name ?? s.debtorMemberId}</strong>
                                </div>
                              </td>
                              <td>
                                <div className="table-member-cell">
                                  <span className="table-member-avatar" style={{ backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
                                    {creditor?.avatarInitial ?? s.creditorMemberId.slice(0, 2).toUpperCase()}
                                  </span>
                                  <span>{creditor?.name ?? s.creditorMemberId}</span>
                                </div>
                              </td>
                              <td style={{ fontWeight: 700 }}>{formatPaise(s.amountPaise)}</td>
                              <td>
                                <Badge variant="neutral">
                                  {s.paymentMethod === 'upi' ? 'UPI Online' : 'Cash Handover'}
                                </Badge>
                              </td>
                              <td>
                                <span style={{ fontSize: '0.75rem' }}>
                                  {s.paymentReference ?? s.proofReceiptUrl ?? 'Standard Proof'}
                                </span>
                              </td>
                              <td style={{ fontSize: '0.75rem' }}>{s.paymentDate}</td>
                              <td>
                                <Badge
                                  variant={
                                    s.status === 'confirmed'
                                      ? 'success'
                                      : s.status === 'rejected'
                                        ? 'danger'
                                        : 'warning'
                                  }
                                >
                                  {s.status.replace(/_/g, ' ').toUpperCase()}
                                </Badge>
                              </td>
                              <td>
                                {isPending ? (
                                  <div style={{ display: 'flex', gap: 6 }}>
                                    <button
                                      type="button"
                                      className="btn-action btn-action-confirm"
                                      onClick={() =>
                                        onConfirmMemberSettlement({
                                          settlementId: s.id,
                                          confirmedByMemberId: s.creditorMemberId,
                                        })
                                      }
                                    >
                                      Verify
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-action btn-action-reject"
                                      onClick={() => {
                                        setRejectionPromptSettlementId(s.id)
                                        setRejectionReasonInput('')
                                      }}
                                    >
                                      Reject
                                    </button>
                                  </div>
                                ) : (
                                  <span style={{ fontSize: '0.7188rem', color: 'var(--color-text-muted)' }}>
                                    {s.status === 'confirmed' ? 'Verified' : 'Rejected'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* Peer Credits & Excess Section */}
      {(activeTab === 'all' || activeTab === 'credits') && (
        <section aria-labelledby="peer-credits-heading">
          <div className="section-title-row">
            <div>
              <h3 id="peer-credits-heading" className="section-title">
                Peer Credit Balances & Excess Reimbursements
              </h3>
              <span className="section-meta">
                Authoritative excess tracking for member overpayments and downward obligation corrections
              </span>
            </div>
          </div>

          <div className="peer-credit-box">
            <div className="homebase-card-title-row">
              <h4 className="section-title" style={{ color: 'var(--color-accent-primary)' }}>
                Immutable Peer Credit & Order-Independent Ledger
              </h4>
              <Badge variant="accent">Order-Independent Parity</Badge>
            </div>
            <p className="notice-text">
              Under HOMEBASE financial rules, excess settlements are never discarded or deleted. If a member pays more than their final corrected share, the excess automatically forms an auditable peer credit applicable against future bills or refundable in cash.
            </p>

            {/* Active Stored Peer Credits if any */}
            {financialState.peerCredits.length > 0 && (
              <div style={{ marginTop: 'var(--space-2)' }}>
                <span className="metric-label" style={{ color: 'var(--color-accent-primary)' }}>
                  Active Generated Peer Credit Records:
                </span>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 4 }}>
                  {financialState.peerCredits.map((credit) => {
                    const avail = getAvailablePeerCreditPaise(financialState, credit.id)
                    const debtor = members.find((m) => m.id === credit.debtorMemberId)
                    return (
                      <span key={credit.id} className="app-pill selected">
                        {debtor?.name ?? credit.debtorMemberId}: Available {formatPaise(avail)}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Render Member Debt & Credit summaries */}
            <div className="table-responsive" style={{ marginTop: 'var(--space-3)' }}>
              <table className="homebase-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Obligation</th>
                    <th>Effective Settled</th>
                    <th>Legitimate Excess</th>
                    <th>Net Cash Refunds</th>
                    <th>Unpaid Share</th>
                    <th>Reimbursement Due</th>
                  </tr>
                </thead>
                <tbody>
                  {activeObligations.flatMap((obligation) =>
                    obligation.shares.map((s) => {
                      const debt = deriveOrderIndependentMemberDebt(financialState, obligation.id, s.memberId)
                      const member = members.find((m) => m.id === s.memberId)
                      if (
                        debt.effectiveSettledTotalPaise === 0 &&
                        debt.authoritativeLegitimateExcessPaise === 0 &&
                        debt.excessCreditorReimbursementDuePaise === 0
                      ) {
                        return null
                      }
                      return (
                        <tr key={`${obligation.id}-${s.memberId}`}>
                          <td><strong>{member?.name ?? s.memberId}</strong></td>
                          <td>{obligation.title}</td>
                          <td>{formatPaise(debt.effectiveSettledTotalPaise)}</td>
                          <td>{formatPaise(debt.authoritativeLegitimateExcessPaise)}</td>
                          <td>{formatPaise(debt.netRefundsReceivedPaise)}</td>
                          <td>{formatPaise(debt.unpaidObligationSharePaise)}</td>
                          <td style={{ fontWeight: 700, color: 'var(--color-accent-primary)' }}>
                            {formatPaise(debt.excessCreditorReimbursementDuePaise)}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* ======================================================================
         MODAL 1: Provider Payment Modal (Treasury / Out-of-Pocket Disbursal)
         ====================================================================== */}
      {isProviderModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title">Record Provider Bill Payment</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsProviderModalOpen(false)}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <form onSubmit={handleProviderPaymentSubmit}>
              <div className="modal-body">
                {providerPaymentError && (
                  <div className="audit-notice-banner" style={{ borderLeftColor: 'var(--color-danger-text)' }}>
                    {providerPaymentError}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Select Obligation</label>
                  <select
                    className="form-select"
                    value={selectedObligationId}
                    onChange={(e) => {
                      setSelectedObligationId(e.target.value)
                      const ob = activeObligations.find((o) => o.id === e.target.value)
                      const recon = ob ? obligationReconciliations.get(ob.id) : null
                      if (recon) {
                        setProviderPaymentAmountRupees(paiseToRupees(recon.providerRemainingPaise).toString())
                      }
                    }}
                  >
                    {activeObligations.map((o) => {
                      const recon = obligationReconciliations.get(o.id)
                      return (
                        <option key={o.id} value={o.id}>
                          {o.title} — Due: {o.dueDate} (Remaining: {formatPaise(recon?.providerRemainingPaise ?? o.totalAmountPaise)})
                        </option>
                      )
                    })}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Payment Source</label>
                  <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 4 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8438rem' }}>
                      <input
                        type="radio"
                        name="providerSourceType"
                        value="treasury"
                        checked={providerSourceType === 'treasury'}
                        onChange={() => setProviderSourceType('treasury')}
                      />
                      Household Treasury Account
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8438rem' }}>
                      <input
                        type="radio"
                        name="providerSourceType"
                        value="personal"
                        checked={providerSourceType === 'personal'}
                        onChange={() => setProviderSourceType('personal')}
                      />
                      Personal Out-of-Pocket
                    </label>
                  </div>
                </div>

                {providerSourceType === 'treasury' ? (
                  <div className="form-group">
                    <label className="form-label">Treasury Account</label>
                    <select
                      className="form-select"
                      value={providerAccountId}
                      onChange={(e) => setProviderAccountId(e.target.value)}
                    >
                      {financialState.accounts.map((acc) => {
                        const bal = calculateAccountLiquidBalance(financialState, acc.id)
                        return (
                          <option key={acc.id} value={acc.id}>
                            {acc.name} — Balance: {formatPaise(bal)}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="form-label">Payer Member</label>
                    <select
                      className="form-select"
                      value={personalPayerId}
                      onChange={(e) => setPersonalPayerId(e.target.value)}
                    >
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.participationTier})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Disbursal Amount (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    className="form-input"
                    value={providerPaymentAmountRupees}
                    onChange={(e) => setProviderPaymentAmountRupees(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Payment Date</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    value={providerPaymentDate}
                    onChange={(e) => setProviderPaymentDate(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Transaction Reference / UTR / Cheque</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. UTR-402910482910"
                    value={providerPaymentRef}
                    onChange={(e) => setProviderPaymentRef(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    placeholder="Optional details or receipt confirmation"
                    value={providerPaymentNotes}
                    onChange={(e) => setProviderPaymentNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsProviderModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Confirm Disbursal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================================
         MODAL 2: Peer Settlement Modal with QR Interface
         ====================================================================== */}
      {isSettlementModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <h3 className="modal-title">Settle Peer Claim</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsSettlementModalOpen(false)}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <form onSubmit={handleSettlementSubmit}>
              <div className="modal-body">
                {settlementError && (
                  <div className="audit-notice-banner" style={{ borderLeftColor: 'var(--color-danger-text)' }}>
                    {settlementError}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Select Claim to Settle</label>
                  <select
                    className="form-select"
                    value={selectedClaimId}
                    onChange={(e) => {
                      setSelectedClaimId(e.target.value)
                      const target = financialState.peerClaims.find((c) => c.id === e.target.value)
                      if (target) {
                        setSettlementDebtorId(target.debtorMemberId)
                        const confirmedPaid = financialState.memberSettlements
                          .filter((s) => s.claimId === target.id && s.status === 'confirmed')
                          .reduce((sum, s) => sum + s.amountPaise, 0)
                        const remaining = Math.max(0, target.claimAmountPaise - confirmedPaid)
                        setSettlementAmountRupees(paiseToRupees(remaining).toString())
                      }
                    }}
                  >
                    {financialState.peerClaims.map((claim) => {
                      const creditor = members.find((m) => m.id === claim.creditorMemberId)
                      const debtor = members.find((m) => m.id === claim.debtorMemberId)
                      return (
                        <option key={claim.id} value={claim.id}>
                          {debtor?.name} owes {creditor?.name} ({formatPaise(claim.claimAmountPaise)})
                        </option>
                      )
                    })}
                  </select>
                </div>

                {/* Recipient Details & QR Presentation Area */}
                {(() => {
                  const claim = financialState.peerClaims.find((c) => c.id === selectedClaimId)
                  const creditor = members.find((m) => m.id === claim?.creditorMemberId)
                  const debtor = members.find((m) => m.id === (settlementDebtorId || claim?.debtorMemberId))
                  const account = financialState.accounts.find((a) => a.accountType === 'personal_upi')
                  const upiId = account?.upiId ?? `${creditor?.name.toLowerCase().replace(/\s+/g, '')}@upi`

                  return (
                    <div className="qr-payment-card">
                      <div className="qr-code-graphic">
                        <QrCodeIcon size={96} style={{ color: 'var(--color-accent-primary)' }} />
                      </div>

                      <div>
                        <div style={{ fontSize: '0.9375rem', fontWeight: 700 }}>
                          Pay {creditor?.name ?? 'Creditor'}
                        </div>
                        <div style={{ fontSize: '0.7813rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                          From: {debtor?.name ?? 'Household Member'}
                        </div>
                        <div style={{ fontSize: '0.7813rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                          UPI ID: <code>{upiId}</code>
                        </div>
                        <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-accent-primary)', marginTop: 4 }}>
                          Amount: ₹{settlementAmountRupees || '0.00'}
                        </div>
                      </div>

                      {/* App Choices Strip */}
                      <div className="app-choices-strip">
                        {['Google Pay', 'PhonePe', 'Paytm', 'BHIM', 'Cash Handover'].map((appName) => (
                          <button
                            key={appName}
                            type="button"
                            className={`app-pill ${settlementApp === appName ? 'selected' : ''}`}
                            onClick={() => {
                              setSettlementApp(appName)
                              if (appName === 'Cash Handover') setSettlementMethod('cash')
                              else setSettlementMethod('upi')
                            }}
                          >
                            {appName}
                          </button>
                        ))}
                      </div>

                      <span className="form-helper">
                        Scan with your UPI mobile app. Submitting this form alerts {creditor?.name} to verify receipt in their bank statement.
                      </span>
                    </div>
                  )
                })()}

                <div className="form-group">
                  <label className="form-label">Settlement Amount (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    required
                    className="form-input"
                    value={settlementAmountRupees}
                    onChange={(e) => setSettlementAmountRupees(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Payment Method</label>
                  <select
                    className="form-select"
                    value={settlementMethod}
                    onChange={(e) => setSettlementMethod(e.target.value as 'upi' | 'cash')}
                  >
                    <option value="upi">UPI Online Transfer (PhonePe / GPay / Paytm / BHIM)</option>
                    <option value="cash">Direct Cash Handover</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">
                    {settlementMethod === 'upi' ? 'UPI Reference / UTR Number' : 'Handover Reference'} *
                  </label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="e.g. 430281094821 or Cash in person"
                    value={settlementRef}
                    onChange={(e) => setSettlementRef(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Payment Screenshot / Verification Proof Note *</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="e.g. Screenshot uploaded / Confirmed via bank message (Simulated)"
                    value={settlementProofNote}
                    onChange={(e) => setSettlementProofNote(e.target.value)}
                  />
                  <span className="form-helper">
                    Mandatory payment proof record. Creditor must verify receipt before claim liability is discharged.
                  </span>
                </div>

                <div className="form-group">
                  <label className="form-label">Additional Notes</label>
                  <textarea
                    className="form-textarea"
                    rows={2}
                    placeholder="Optional message for creditor"
                    value={settlementNotes}
                    onChange={(e) => setSettlementNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsSettlementModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Submit Settlement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================================
         MODAL 3: Rejection Prompt Modal
         ====================================================================== */}
      {rejectionPromptSettlementId && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card">
            <div className="modal-header">
              <h3 className="modal-title">Reject Settlement Submission</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setRejectionPromptSettlementId(null)}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div className="modal-body">
              <p style={{ fontSize: '0.8438rem', color: 'var(--color-text-secondary)', margin: 0 }}>
                Please provide an audit reason for rejecting this reimbursement submission. The debtor will be notified.
              </p>

              <div className="form-group">
                <label className="form-label">Rejection Reason *</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  required
                  placeholder="e.g. Amount not received in bank account / Invalid UTR reference"
                  value={rejectionReasonInput}
                  onChange={(e) => setRejectionReasonInput(e.target.value)}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setRejectionPromptSettlementId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={!rejectionReasonInput.trim()}
                onClick={handleConfirmRejection}
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
