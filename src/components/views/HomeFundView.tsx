import { useState, type FC, type FormEvent } from 'react'
import {
  calculateTreasuryOverview,
  DEMO_CONTRIBUTIONS,
  DEMO_MEMBERS,
  DEMO_RECENT_EXPENSES,
  DEMO_TREASURY_ACCOUNTS,
  DEMO_TREASURY_TRANSFERS,
  getActiveMembers,
  validateTransfer,
} from '../../data/mockData'
import type {
  ExpenseItem,
  FundContribution,
  HouseholdCollectorQrConfig,
  HouseholdMember,
  NavSection,
  TreasuryAccount,
  TreasuryOverview,
  TreasuryTransfer,
} from '../../types'
import { generateEntityId, paiseToRupees, rupeesToPaise } from '../../utils/financial'
import { Badge } from '../common/Badge'
import { Card, CardContent, CardHeader } from '../common/Card'
import {
  BankIcon,
  CashIcon,
  CheckCircleIcon,
  CloseIcon,
  FundIcon,
} from '../common/Icons'
import { StatCard } from '../common/StatCard'

interface HomeFundViewProps {
  onNavigate?: (section: NavSection) => void
  contributions?: FundContribution[]
  setContributions?: React.Dispatch<React.SetStateAction<FundContribution[]>>
  transfers?: TreasuryTransfer[]
  setTransfers?: React.Dispatch<React.SetStateAction<TreasuryTransfer[]>>
  accounts?: TreasuryAccount[]
  expenses?: ExpenseItem[]
  treasuryOverview?: TreasuryOverview
  members?: HouseholdMember[]
  onSubmitContribution?: (contribution: FundContribution) => void
  onConfirmContribution?: (contributionId: string, custodianId?: string, custodianName?: string) => void
  onRejectContribution?: (contributionId: string, custodianId?: string, reason?: string) => void
  onRecordTransfer?: (transfer: TreasuryTransfer) => void
  collectorQrConfig?: HouseholdCollectorQrConfig
}

type FilterTab = 'all' | 'confirmed' | 'pending' | 'refunds'

export const HomeFundView: FC<HomeFundViewProps> = ({
  contributions: propContributions,
  setContributions: propSetContributions,
  transfers: propTransfers,
  setTransfers: propSetTransfers,
  accounts: propAccounts,
  expenses: propExpenses,
  treasuryOverview: propTreasuryOverview,
  members: propMembers,
  onSubmitContribution,
  onConfirmContribution,
  onRejectContribution,
  onRecordTransfer,
  collectorQrConfig,
}) => {
  // Support either shared synchronized state (from App.tsx) or local state fallback
  const [localContributions, setLocalContributions] = useState<FundContribution[]>(DEMO_CONTRIBUTIONS)
  const [localTransfers, setLocalTransfers] = useState<TreasuryTransfer[]>(DEMO_TREASURY_TRANSFERS)
  const [filterTab, setFilterTab] = useState<FilterTab>('all')

  const contributions = propContributions ?? localContributions
  const setContributions = propSetContributions ?? setLocalContributions

  const transfers = propTransfers ?? localTransfers
  const setTransfers = propSetTransfers ?? setLocalTransfers

  const accounts = propAccounts ?? DEMO_TREASURY_ACCOUNTS
  const expenses = propExpenses ?? DEMO_RECENT_EXPENSES
  const members = propMembers ?? DEMO_MEMBERS

  // Modals state
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false)
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false)
  const [transferError, setTransferError] = useState<string | null>(null)

  // Deposit Form State
  const activeMembers = getActiveMembers(members)
  const [depositMemberId, setDepositMemberId] = useState(activeMembers[0]?.id ?? 'm1')
  const [depositAccountId, setDepositAccountId] = useState(accounts[0]?.id ?? 'acc-upi')
  const [depositAmount, setDepositAmount] = useState('5000')
  const [depositReference, setDepositReference] = useState('')
  const [depositNote, setDepositNote] = useState('')

  // Transfer Form State
  const [transferFromAccountId, setTransferFromAccountId] = useState('acc-upi')
  const [transferToAccountId, setTransferToAccountId] = useState('acc-cash')
  const [transferAmount, setTransferAmount] = useState('')
  const [transferPurpose, setTransferPurpose] = useState('')

  // Calculate live balances using the pure zero-stale integer paise engine
  const treasuryOverview = propTreasuryOverview ?? calculateTreasuryOverview(
    accounts,
    contributions,
    expenses,
    transfers
  )

  const upiAccountSummary = treasuryOverview.accounts.find(
    (a) => a.account.accountType === 'personal_upi'
  )
  const cashAccountSummary = treasuryOverview.accounts.find(
    (a) => a.account.accountType === 'cash_box'
  )

  const pendingContributions = contributions.filter(
    (c) => c.status === 'pending_confirmation' && !c.isVoided
  )

  const pendingInflowTotal = pendingContributions.reduce((sum, item) => sum + item.amount, 0)

  // Handle Custodian Acknowledgment
  const handleAcknowledge = (contributionId: string) => {
    if (onConfirmContribution) {
      const c = contributions.find((item) => item.id === contributionId)
      const account = accounts.find((a) => a.id === c?.accountId)
      onConfirmContribution(
        contributionId,
        account?.custodianMembershipId,
        account?.custodianName ? `${account.custodianName} (Custodian)` : undefined
      )
      return
    }

    setContributions((prev) =>
      prev.map((c) => {
        if (c.id === contributionId && c.status === 'pending_confirmation') {
          const account = accounts.find((a) => a.id === c.accountId)
          return {
            ...c,
            status: 'confirmed' as const,
            confirmedByMembershipId: account?.custodianMembershipId,
            confirmedByName: `${account?.custodianName} (Custodian)`,
            confirmedAt: 'Just now (Demo Verified)',
          }
        }
        return c
      })
    )
  }

  // Handle Custodian Rejection
  const handleReject = (contributionId: string) => {
    if (onRejectContribution) {
      const c = contributions.find((item) => item.id === contributionId)
      const account = accounts.find((a) => a.id === c?.accountId)
      onRejectContribution(
        contributionId,
        account?.custodianMembershipId,
        'Rejected by custodian: payment not received in bank account.'
      )
      return
    }

    setContributions((prev) =>
      prev.map((c) => {
        if (c.id === contributionId && c.status === 'pending_confirmation') {
          const account = accounts.find((a) => a.id === c.accountId)
          return {
            ...c,
            status: 'rejected' as const,
            confirmedByMembershipId: account?.custodianMembershipId,
            rejectionReason: 'Rejected by custodian: payment not received in bank account.',
          }
        }
        return c
      })
    )
  }

  // Handle Deposit Submission (Enters pending_confirmation state)
  const handleDepositSubmit = (e: FormEvent) => {
    e.preventDefault()
    const amountPaise = rupeesToPaise(depositAmount)
    if (amountPaise <= 0) return

    const member = activeMembers.find((m) => m.id === depositMemberId)
    const newContribution: FundContribution = {
      id: generateEntityId('cnt'),
      accountId: depositAccountId,
      contributorMembershipId: depositMemberId,
      contributorName: member?.name ?? 'Household Member',
      amount: paiseToRupees(amountPaise),
      date: '22 Nov 2026',
      status: 'pending_confirmation',
      transactionReference: depositReference.trim() || undefined,
      note: depositNote.trim() || undefined,
    }

    if (onSubmitContribution) {
      onSubmitContribution(newContribution)
    } else {
      setContributions([newContribution, ...contributions])
    }

    setIsDepositModalOpen(false)
    setDepositAmount('5000')
    setDepositReference('')
    setDepositNote('')
  }

  // Handle Internal Transfer Submission
  const handleTransferSubmit = (e: FormEvent) => {
    e.preventDefault()
    const amountPaise = rupeesToPaise(transferAmount)
    if (amountPaise <= 0) {
      setTransferError('Please enter a valid transfer amount.')
      return
    }

    const fromAccount = accounts.find((a) => a.id === transferFromAccountId)
    const toAccount = accounts.find((a) => a.id === transferToAccountId)

    if (!fromAccount || !toAccount) {
      setTransferError('Selected accounts are invalid.')
      return
    }

    const validation = validateTransfer(
      fromAccount.id,
      toAccount.id,
      amountPaise,
      accounts,
      treasuryOverview
    )

    if (!validation.isValid) {
      setTransferError(validation.errorMessage ?? 'Transfer validation failed.')
      return
    }

    const newTransfer: TreasuryTransfer = {
      id: generateEntityId('trf'),
      fromAccountId: fromAccount.id,
      fromAccountName: fromAccount.name,
      toAccountId: toAccount.id,
      toAccountName: toAccount.name,
      amount: paiseToRupees(amountPaise),
      date: '22 Nov 2026',
      reference: `INT-${generateEntityId('TRF').toUpperCase()}`,
      status: 'confirmed',
      authorizedByMembershipId: fromAccount.custodianMembershipId,
      authorizedByName: fromAccount.custodianName,
      purpose: transferPurpose.trim() || 'Internal treasury rebalance',
    }

    if (onRecordTransfer) {
      onRecordTransfer(newTransfer)
    } else {
      setTransfers([newTransfer, ...transfers])
    }
    setIsTransferModalOpen(false)
    setTransferAmount('')
    setTransferPurpose('')
    setTransferError(null)
  }

  // Filter contributions for the ledger
  const filteredContributions = contributions.filter((c) => {
    if (filterTab === 'confirmed') return c.status === 'confirmed' && !c.isRefundAdjustment
    if (filterTab === 'pending') return c.status === 'pending_confirmation'
    if (filterTab === 'refunds') return c.isRefundAdjustment || c.status === 'refunded'
    return true
  })

  return (
    <div className="home-fund-view-container">
      {/* 1. Tasknur-Style Treasury Pool Hero Card */}
      <div className="tasknur-hero-card">
        <div className="tasknur-hero-content">
          <span className="tasknur-hero-eyebrow">Household Treasury Pool</span>
          <h2 className="tasknur-hero-title">
            ₹{treasuryOverview.totalAvailableBalance.toLocaleString('en-IN')}
          </h2>
          <p className="tasknur-hero-subtitle">
            Dual-ledger isolation · {accounts.length} active accounts ·{' '}
            {pendingInflowTotal > 0
              ? `₹${pendingInflowTotal.toLocaleString('en-IN')} pending verification`
              : 'All funds verified liquid'}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button
              type="button"
              className="tasknur-hero-action-btn"
              onClick={() => setIsDepositModalOpen(true)}
            >
              Log Contribution
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
              onClick={() => {
                setTransferError(null)
                setIsTransferModalOpen(true)
              }}
            >
              Record Transfer
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
              strokeDashoffset={213.63 * (1 - 0.88)}
            />
          </svg>
          <div className="progress-ring-label">
            <span className="progress-ring-number">100%</span>
            <span className="progress-ring-text">Liquid</span>
          </div>
        </div>
      </div>

      {/* 2. Account Balances Grid */}
      <section aria-labelledby="treasury-balances-heading">
        <div className="section-title-row">
          <div className="homebase-card-title-row">
            <h2 id="treasury-balances-heading" className="section-title">
              Account Balances
            </h2>
            <Badge variant="neutral">Dual-Ledger Isolated</Badge>
          </div>
          <span className="section-meta">Snapshot: {treasuryOverview.asOfDate}</span>
        </div>

        <div className="balances-grid">
          {/* Combined Household Liquid Balance */}
          <StatCard
            label="Combined Available Household Balance"
            amount={treasuryOverview.totalAvailableBalance}
            subtitle="Combined liquid funds available across all accounts"
            icon={<FundIcon size={20} />}
            accent
            highlightTag="Liquid Pool"
          />

          {/* Personal UPI Treasury Account */}
          <StatCard
            label="Personal UPI Account (House Pool)"
            amount={upiAccountSummary?.currentBalance ?? 0}
            subtitle={`Custodian: ${upiAccountSummary?.account.custodianName ?? 'Arjun Verma'}`}
            icon={<BankIcon size={20} />}
            highlightTag={
              upiAccountSummary && upiAccountSummary.pendingInflow > 0
                ? `+₹${upiAccountSummary.pendingInflow.toLocaleString('en-IN')} Pending`
                : 'Confirmed Only'
            }
          />

          {/* Living Room Cash Box */}
          <StatCard
            label="Living Room Cash Box"
            amount={cashAccountSummary?.currentBalance ?? 0}
            subtitle={`Custodian: ${cashAccountSummary?.account.custodianName ?? 'Sameer Patel'}`}
            icon={<CashIcon size={20} />}
            highlightTag="Physical Cash"
          />
        </div>
      </section>

      {/* 3. Pending Custodian Verification Queue */}
      <section aria-labelledby="verification-queue-heading" style={{ marginTop: 'var(--space-6)' }}>
        <Card className="queue-card-highlight">
          <CardHeader
            title="Pending Custodian Verification Queue"
            subtitle="Contributions awaiting custodian review before liquid balance increments"
            badge={
              <Badge variant={pendingContributions.length > 0 ? 'warning' : 'neutral'}>
                {pendingContributions.length} Pending
              </Badge>
            }
          />
          <CardContent>
            {pendingContributions.length === 0 ? (
              <div className="queue-empty-state">
                <CheckCircleIcon size={32} style={{ color: 'var(--color-success-text)', marginBottom: '8px' }} />
                <div>All submitted contributions have been reviewed by custodians.</div>
              </div>
            ) : (
              <div className="queue-items-list">
                {pendingContributions.map((item) => {
                  const account = accounts.find((a) => a.id === item.accountId)
                  return (
                    <div key={item.id} className="queue-item-row">
                      <div className="queue-item-info">
                        <div className="queue-item-title">
                          <span className="table-member-avatar" style={{ marginRight: '6px' }}>
                            {item.contributorName
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .slice(0, 2)}
                          </span>
                          <span>{item.contributorName}</span>
                          <span className="ledger-amount-positive" style={{ marginLeft: 'auto' }}>
                            +₹{item.amount.toLocaleString('en-IN')}
                          </span>
                        </div>
                        <div className="queue-item-meta" style={{ marginTop: '4px' }}>
                          <span>Target: <strong>{account?.name}</strong></span>
                          <span className="bullet-sep">·</span>
                          <span>Ref / UTR: <code>{item.transactionReference ?? 'None provided'}</code></span>
                          {item.note && (
                            <>
                              <span className="bullet-sep">·</span>
                              <span>Note: {item.note}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="queue-item-actions">
                        <button
                          type="button"
                          className="btn-action btn-action-confirm"
                          onClick={() => handleAcknowledge(item.id)}
                          title="Simulate custodian checking bank app and acknowledging credit"
                        >
                          Acknowledge Credit
                        </button>
                        <button
                          type="button"
                          className="btn-action btn-action-reject"
                          onClick={() => handleReject(item.id)}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* 4. Contributions Ledger (History & Reversals) */}
      <section aria-labelledby="contributions-ledger-heading" style={{ marginTop: 'var(--space-6)' }}>
        <Card>
          <CardHeader
            title="Household Contributions Ledger"
            subtitle="Immutable record of deposits, custodian confirmations, and refund adjustments"
            badge={<Badge variant="neutral">{filteredContributions.length} Records</Badge>}
          />
          <CardContent>
            {/* Filter Tabs */}
            <div className="filter-tabs-row" role="tablist">
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'all' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('all')}
              >
                All Entries ({contributions.length})
              </button>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'confirmed' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('confirmed')}
              >
                Confirmed Deposits
              </button>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'pending' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('pending')}
              >
                Pending ({pendingContributions.length})
              </button>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'refunds' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('refunds')}
              >
                Refunds & Adjustments
              </button>
            </div>

            {/* Ledger Item Rows */}
            <div className="ledger-list">
              {filteredContributions.map((item) => {
                const account = accounts.find((a) => a.id === item.accountId)
                const isRefund = item.isRefundAdjustment || item.status === 'refunded'

                return (
                  <div
                    key={item.id}
                    className={`ledger-item-row ${isRefund ? 'ledger-row-refund' : ''}`}
                  >
                    <div className="ledger-item-left">
                      <div className="table-member-avatar" style={{ width: 34, height: 34, fontSize: '0.75rem' }}>
                        {item.contributorName
                          .split(' ')
                          .map((n) => n[0])
                          .join('')
                          .slice(0, 2)}
                      </div>
                      <div className="ledger-item-details">
                        <div className="ledger-contributor-name">
                          {item.contributorName}
                          {item.isRefundAdjustment && (
                            <span className="nav-item-badge" style={{ marginLeft: '6px' }}>
                              Refund Reversal
                            </span>
                          )}
                        </div>
                        <div className="ledger-item-subline">
                          <span>Target: {account?.name}</span>
                          <span className="bullet-sep">·</span>
                          <span>{item.date}</span>
                          {item.transactionReference && (
                            <>
                              <span className="bullet-sep">·</span>
                              <span>UTR: {item.transactionReference}</span>
                            </>
                          )}
                          {item.confirmedByName && (
                            <>
                              <span className="bullet-sep">·</span>
                              <span>Verified by: {item.confirmedByName}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="ledger-item-right">
                      <span className={isRefund ? 'ledger-amount-refund' : 'ledger-amount-positive'}>
                        {isRefund ? '-' : '+'}₹{item.amount.toLocaleString('en-IN')}
                      </span>
                      <Badge
                        variant={
                          item.status === 'confirmed'
                            ? 'success'
                            : item.status === 'pending_confirmation'
                            ? 'warning'
                            : 'danger'
                        }
                      >
                        {item.status === 'pending_confirmation'
                          ? 'Pending Review'
                          : item.status === 'confirmed'
                          ? 'Confirmed Liquid'
                          : 'Refunded / Rejected'}
                      </Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ======================================================================
         MODAL 1: Log Household Contribution with QR Guidance
         ====================================================================== */}
      {isDepositModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h3 className="modal-title">Log Contribution</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsDepositModalOpen(false)}
              >
                <CloseIcon size={18} />
              </button>
            </div>
            <form onSubmit={handleDepositSubmit}>
              <div className="modal-body">
                {/* Official Household QR Preview if available */}
                {collectorQrConfig?.qrCodeImageUrl ? (
                  <div className="qr-preview-box" style={{ marginBottom: 'var(--space-3)' }}>
                    <span className="qr-label">Scan Official Household QR:</span>
                    <div className="qr-image-frame" style={{ width: 130, height: 130, margin: '6px auto' }}>
                      <img
                        src={collectorQrConfig.qrCodeImageUrl}
                        alt="Household QR"
                        className="qr-actual-image"
                      />
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                      Recipient: <strong>{collectorQrConfig.collectorName}</strong> · UPI ID: <code>{collectorQrConfig.upiId}</code>
                    </span>
                  </div>
                ) : (
                  <div className="audit-notice-banner" style={{ borderLeftColor: 'var(--color-accent-primary)', backgroundColor: 'var(--color-accent-light)', margin: '0 0 var(--space-3) 0' }}>
                    <strong>Note:</strong> Contributions enter <strong>Pending Confirmation</strong>. They will not increase available funds until the custodian acknowledges receipt in their bank account.
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" htmlFor="contrib-member">
                    Contributor
                  </label>
                  <select
                    id="contrib-member"
                    className="form-select"
                    value={depositMemberId}
                    onChange={(e) => setDepositMemberId(e.target.value)}
                  >
                    {activeMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.isResident ? 'Resident' : 'Food Contributor'})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="contrib-account">
                    Deposit Destination Account
                  </label>
                  <select
                    id="contrib-account"
                    className="form-select"
                    value={depositAccountId}
                    onChange={(e) => setDepositAccountId(e.target.value)}
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} (Custodian: {a.custodianName})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="contrib-amount">
                    Contribution Amount (₹)
                  </label>
                  <input
                    id="contrib-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="e.g. 5000"
                    className="form-input"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="contrib-ref">
                    Bank Reference / UPI UTR Number
                  </label>
                  <input
                    id="contrib-ref"
                    type="text"
                    placeholder="e.g. 430291823719"
                    className="form-input"
                    value={depositReference}
                    onChange={(e) => setDepositReference(e.target.value)}
                  />
                  <span className="form-helper">
                    Paste the 12-digit transaction ID from your Google Pay, PhonePe, or banking app.
                  </span>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="contrib-note">
                    Note / Purpose
                  </label>
                  <input
                    id="contrib-note"
                    type="text"
                    placeholder="e.g. November month maintenance"
                    className="form-input"
                    value={depositNote}
                    onChange={(e) => setDepositNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsDepositModalOpen(false)}
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

      {/* ==========================================================================
         MODAL 2: Record Internal Treasury Transfer
         ========================================================================== */}
      {isTransferModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h3 className="modal-title">Record Treasury Transfer</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsTransferModalOpen(false)}
              >
                <CloseIcon size={18} />
              </button>
            </div>
            <form onSubmit={handleTransferSubmit}>
              <div className="modal-body">
                <div className="audit-notice-banner" style={{ margin: '0 0 var(--space-3) 0' }}>
                  Transfers shift funds between accounts (e.g. ATM withdrawal from UPI to Cash Box). The combined household balance remains unchanged.
                </div>

                {transferError && (
                  <div className="audit-notice-banner" style={{ borderLeftColor: 'var(--color-danger-text)', backgroundColor: 'var(--color-danger-bg)', margin: '0 0 var(--space-3) 0' }}>
                    <strong style={{ color: 'var(--color-danger-text)' }}>Transfer Rejected:</strong>{' '}
                    <span style={{ color: 'var(--color-danger-text)' }}>{transferError}</span>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" htmlFor="trf-from">
                    From Account (Debit)
                  </label>
                  <select
                    id="trf-from"
                    className="form-select"
                    value={transferFromAccountId}
                    onChange={(e) => {
                      setTransferFromAccountId(e.target.value)
                      setTransferError(null)
                    }}
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="trf-to">
                    To Account (Credit)
                  </label>
                  <select
                    id="trf-to"
                    className="form-select"
                    value={transferToAccountId}
                    onChange={(e) => {
                      setTransferToAccountId(e.target.value)
                      setTransferError(null)
                    }}
                  >
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="trf-amount">
                    Transfer Amount (₹)
                  </label>
                  <input
                    id="trf-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="e.g. 5000"
                    className="form-input"
                    value={transferAmount}
                    onChange={(e) => {
                      setTransferAmount(e.target.value)
                      setTransferError(null)
                    }}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="trf-purpose">
                    Purpose / Authorization Note
                  </label>
                  <input
                    id="trf-purpose"
                    type="text"
                    placeholder="e.g. ATM Cash Withdrawal to refill Cash Box"
                    className="form-input"
                    value={transferPurpose}
                    onChange={(e) => {
                      setTransferPurpose(e.target.value)
                      setTransferError(null)
                    }}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsTransferModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary btn-purple">
                  Record Transfer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
