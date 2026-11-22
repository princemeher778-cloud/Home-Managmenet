import { useState, type ChangeEvent, type FC, type FormEvent } from 'react'
import {
  formatSplitScopeLabel,
  getActiveMembers,
  getAllMembers,
  resolveEligibleParticipants,
} from '../../data/mockData.ts'
import type {
  DisbursementChannel,
  ExpenseCategory,
  ExpenseCorrectionRecord,
  ExpenseDisbursementStatus,
  ExpenseItem,
  ExpenseReceipt,
  HouseholdMember,
  NavSection,
  SplitScopeType,
  TreasuryAccount,
  TreasuryOverview,
} from '../../types/index.ts'
import {
  calculateEqualExpenseSplits,
  formatPaise,
  generateEntityId,
  paiseToRupees,
  rupeesToPaise,
  validateExpense,
} from '../../utils/financial.ts'
import { Badge } from '../common/Badge'
import { Card, CardContent, CardHeader } from '../common/Card'
import {
  AlertTriangleIcon,
  BankIcon,
  CashIcon,
  CloseIcon,
  ExpensesIcon,
} from '../common/Icons'
import { StatCard } from '../common/StatCard'

const CATEGORIES: ExpenseCategory[] = [
  'Kitchen & Groceries',
  'Utilities & Internet',
  'Drinking Water',
  'Cleaning & Household',
  'Repairs & Maintenance',
  'Rent & Society',
  'Other Shared',
]

interface ExpensesViewProps {
  onNavigate: (section: NavSection) => void
  expenses: ExpenseItem[]
  setExpenses?: React.Dispatch<React.SetStateAction<ExpenseItem[]>>
  accounts: TreasuryAccount[]
  treasuryOverview: TreasuryOverview
  members: HouseholdMember[]
  onRecordExpense?: (expense: ExpenseItem) => void
  onDisburseExpense?: (expenseId: string, disbursedByMembershipId?: string) => void
  onVoidExpense?: (expenseId: string, reason: string, voidedByMembershipId?: string) => void
  onCorrectExpense?: (
    expenseId: string,
    correctionRecord: ExpenseCorrectionRecord,
    updatedFields: { title: string; category: ExpenseCategory | string; description?: string }
  ) => void
}

type FilterTab = 'all' | 'disbursed' | 'out_of_pocket' | 'pending' | 'voided'

export const ExpensesView: FC<ExpensesViewProps> = ({
  onNavigate: _onNavigate,
  expenses,
  setExpenses,
  accounts,
  treasuryOverview,
  members,
  onRecordExpense,
  onDisburseExpense,
  onVoidExpense,
  onCorrectExpense,
}) => {
  const activeMembers = getActiveMembers(members)
  const allMembers = getAllMembers(members)
  const memberMap = new Map(allMembers.map((m) => [m.id, m]))

  // UI state
  const [filterTab, setFilterTab] = useState<FilterTab>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [selectedExpense, setSelectedExpense] = useState<ExpenseItem | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)

  // Void & Edit Modal State
  const [isVoidPromptOpen, setIsVoidPromptOpen] = useState(false)
  const [voidReasonInput, setVoidReasonInput] = useState('')
  const [isEditingExpense, setIsEditingExpense] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editReason, setEditReason] = useState('')

  // Create Form State
  const [formTitle, setFormTitle] = useState('')
  const [formCategory, setFormCategory] = useState<ExpenseCategory>('Kitchen & Groceries')
  const [formAmountRupees, setFormAmountRupees] = useState('')
  const [formDate, setFormDate] = useState('20 Nov 2026')
  const [formPayerId, setFormPayerId] = useState(activeMembers[0]?.id ?? 'm1')
  const [formChannel, setFormChannel] = useState<DisbursementChannel>('treasury_personal_upi')
  const [formAccountId, setFormAccountId] = useState(accounts[0]?.id ?? 'acc-upi')
  const [formStatus, setFormStatus] = useState<ExpenseDisbursementStatus>('disbursed')
  const [formScope, setFormScope] = useState<SplitScopeType>('all_active')
  const [formCustomMemberIds, setFormCustomMemberIds] = useState<string[]>(
    activeMembers.map((m) => m.id)
  )
  const [formDescription, setFormDescription] = useState('')
  const [formReceipt, setFormReceipt] = useState<ExpenseReceipt | null>(null)

  // Synchronous derivation of eligible participants for Create Form
  const eligibleFormParticipants = resolveEligibleParticipants(
    members,
    formScope,
    formCustomMemberIds
  )

  const formAmountPaise = rupeesToPaise(formAmountRupees)
  const liveFormSplits = calculateEqualExpenseSplits(
    formAmountPaise,
    eligibleFormParticipants,
    formPayerId,
    formChannel
  )

  // Aggregate Statistics (using authoritative integer paise)
  const nonVoidedExpenses = expenses.filter((e) => !e.isVoided)
  const totalSharedSpendPaise = nonVoidedExpenses.reduce(
    (sum, e) => sum + (e.amountPaise ?? rupeesToPaise(e.amount)),
    0
  )

  const treasuryDisbursedPaise = nonVoidedExpenses
    .filter(
      (e) =>
        e.disbursementStatus === 'disbursed' &&
        e.disbursementChannel !== 'member_out_of_pocket'
    )
    .reduce((sum, e) => sum + (e.amountPaise ?? rupeesToPaise(e.amount)), 0)

  const outOfPocketPaise = nonVoidedExpenses
    .filter((e) => e.disbursementChannel === 'member_out_of_pocket')
    .reduce((sum, e) => sum + (e.amountPaise ?? rupeesToPaise(e.amount)), 0)

  const pendingDisbursementsPaise = nonVoidedExpenses
    .filter(
      (e) =>
        e.disbursementStatus === 'pending' &&
        e.disbursementChannel !== 'member_out_of_pocket'
    )
    .reduce((sum, e) => sum + (e.amountPaise ?? rupeesToPaise(e.amount)), 0)

  // Filtered expenses list
  const filteredExpenses = expenses.filter((e) => {
    // Category filter
    if (categoryFilter !== 'all' && e.category !== categoryFilter) return false

    // Tab filter
    if (filterTab === 'disbursed') {
      return (
        e.disbursementStatus === 'disbursed' &&
        e.disbursementChannel !== 'member_out_of_pocket' &&
        !e.isVoided
      )
    }
    if (filterTab === 'out_of_pocket') {
      return e.disbursementChannel === 'member_out_of_pocket' && !e.isVoided
    }
    if (filterTab === 'pending') {
      return e.disbursementStatus === 'pending' && !e.isVoided
    }
    if (filterTab === 'voided') {
      return e.isVoided
    }
    return true
  })

  // Handle Receipt File Selection
  const handleReceiptChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      setFormReceipt(null)
      return
    }
    const receiptMeta: ExpenseReceipt = {
      fileName: file.name,
      fileSize: `${(file.size / 1024).toFixed(1)} KB`,
      uploadedAt: 'Just now (Local Session)',
      previewUrl: URL.createObjectURL(file),
    }
    setFormReceipt(receiptMeta)
  }

  // Handle Custom Participant Toggle
  const toggleCustomMember = (memberId: string) => {
    if (formCustomMemberIds.includes(memberId)) {
      setFormCustomMemberIds(formCustomMemberIds.filter((id) => id !== memberId))
    } else {
      setFormCustomMemberIds([...formCustomMemberIds, memberId])
    }
  }

  // Submit New Expense
  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault()
    setCreateError(null)

    const payer = memberMap.get(formPayerId)
    const newExpenseCandidate: Partial<ExpenseItem> = {
      title: formTitle.trim(),
      category: formCategory,
      amountPaise: formAmountPaise,
      amount: paiseToRupees(formAmountPaise),
      payerMemberId: formPayerId,
      paidBy: payer?.name ?? 'Household Member',
      date: formDate.trim() || '20 Nov 2026',
      description: formDescription.trim() || undefined,
      splitScopeType: formScope,
      participantMemberIds: eligibleFormParticipants.map((m) => m.id),
      splits: liveFormSplits,
      disbursementChannel: formChannel,
      disbursedFromAccountId:
        formChannel !== 'member_out_of_pocket' ? formAccountId : undefined,
      disbursementStatus: formStatus,
      receipt: formReceipt ?? undefined,
    }

    const validation = validateExpense(newExpenseCandidate, accounts, treasuryOverview)
    if (!validation.isValid) {
      setCreateError(validation.errorMessage ?? 'Expense validation failed.')
      return
    }

    const committedExpense: ExpenseItem = {
      ...(newExpenseCandidate as ExpenseItem),
      id: generateEntityId('exp'),
    }

    if (onRecordExpense) {
      onRecordExpense(committedExpense)
    } else if (setExpenses) {
      setExpenses((prev) => [committedExpense, ...prev])
    }
    setIsCreateModalOpen(false)
    resetCreateForm()
  }

  const resetCreateForm = () => {
    setFormTitle('')
    setFormCategory('Kitchen & Groceries')
    setFormAmountRupees('')
    setFormDate('20 Nov 2026')
    setFormDescription('')
    setFormReceipt(null)
    setCreateError(null)
  }

  // Handle Void Expense
  const handleConfirmVoid = () => {
    if (!selectedExpense || !voidReasonInput.trim()) return

    if (onVoidExpense) {
      onVoidExpense(selectedExpense.id, voidReasonInput.trim(), 'm2')
    } else if (setExpenses) {
      setExpenses((prev) =>
        prev.map((e) => {
          if (e.id === selectedExpense.id) {
            return {
              ...e,
              isVoided: true,
              voidReason: voidReasonInput.trim(),
              voidedAt: '20 Nov 2026 (Demo Action)',
              voidedByMembershipId: 'm2', // Demo custodian Arjun
            }
          }
          return e
        })
      )
    }

    setIsVoidPromptOpen(false)
    setVoidReasonInput('')
    setSelectedExpense(null)
  }

  // Handle Edit Expense (Correction with History)
  const handleSaveCorrection = () => {
    if (!selectedExpense || !editReason.trim() || !editTitle.trim()) return

    const correctionRecord: ExpenseCorrectionRecord = {
      id: generateEntityId('cor'),
      editedAt: '20 Nov 2026 (Demo Action)',
      editedByMembershipId: 'm2',
      editedByName: 'Arjun Verma (Custodian)',
      reason: editReason.trim(),
      previousValues: {
        title: selectedExpense.title,
        category: selectedExpense.category,
        amountPaise: selectedExpense.amountPaise,
        splitScopeType: selectedExpense.splitScopeType,
        participantMemberIds: [...selectedExpense.participantMemberIds],
        disbursementChannel: selectedExpense.disbursementChannel,
      },
    }

    if (onCorrectExpense) {
      onCorrectExpense(
        selectedExpense.id,
        correctionRecord,
        {
          title: editTitle.trim(),
          category: editCategory,
          description: editDescription.trim() || undefined,
        }
      )
    } else if (setExpenses) {
      setExpenses((prev) =>
        prev.map((e) => {
          if (e.id === selectedExpense.id) {
            return {
              ...e,
              title: editTitle.trim(),
              category: editCategory,
              description: editDescription.trim() || undefined,
              correctionHistory: [
                ...(e.correctionHistory ?? []),
                correctionRecord,
              ],
            }
          }
          return e
        })
      )
    }

    setIsEditingExpense(false)
    setSelectedExpense(null)
  }

  // Handle Disbursing a Pending Expense
  const handleDisbursePending = (expense: ExpenseItem) => {
    if (expense.disbursementStatus !== 'pending') return

    // Pre-validate treasury balance
    const targetAccountId = expense.disbursedFromAccountId ?? accounts[0]?.id
    const targetAccount = accounts.find((a) => a.id === targetAccountId)
    const summary = treasuryOverview.accounts.find((s) => s.account.id === targetAccountId)
    const availablePaise = summary?.currentBalancePaise ?? 0

    if (expense.amountPaise > availablePaise) {
      alert(
        `Cannot disburse: Insufficient balance in ${targetAccount?.name}. Available: ₹${paiseToRupees(availablePaise)}, required: ₹${expense.amount}.`
      )
      return
    }

    if (onDisburseExpense) {
      onDisburseExpense(expense.id, targetAccount?.custodianMembershipId ?? 'm2')
    } else if (setExpenses) {
      setExpenses((prev) =>
        prev.map((e) => {
          if (e.id === expense.id) {
            return {
              ...e,
              disbursementStatus: 'disbursed' as const,
              disbursedAt: 'Just now (Demo Action)',
              disbursedByMembershipId: targetAccount?.custodianMembershipId ?? 'm2',
            }
          }
          return e
        })
      )
    }
  }

  return (
    <div className="home-fund-view-container">
      {/* 1. Tasknur Shared Expenses Hero Card */}
      <div className="tasknur-hero-card">
        <div className="tasknur-hero-content">
          <span className="tasknur-hero-eyebrow">Shared Spend & Split Engine</span>
          <h2 className="tasknur-hero-title">
            {formatPaise(totalSharedSpendPaise)}
          </h2>
          <p className="tasknur-hero-subtitle">
            {nonVoidedExpenses.length} expenditures recorded · {formatPaise(treasuryDisbursedPaise)} treasury pool · {formatPaise(outOfPocketPaise)} out-of-pocket
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button
              type="button"
              className="tasknur-hero-action-btn"
              onClick={() => {
                resetCreateForm()
                setIsCreateModalOpen(true)
              }}
            >
              + Record Expense
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
              strokeDashoffset={213.63 * (1 - Math.min(1, treasuryDisbursedPaise / (totalSharedSpendPaise || 1)))}
            />
          </svg>
          <div className="progress-ring-label">
            <span className="progress-ring-number">
              {Math.round((treasuryDisbursedPaise / (totalSharedSpendPaise || 1)) * 100)}%
            </span>
            <span className="progress-ring-text">Treasury</span>
          </div>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="dashboard-stats-grid">
        <StatCard
          label="Total Shared Spend"
          amount={paiseToRupees(totalSharedSpendPaise)}
          subtitle="Non-voided household expenditures"
          icon={<ExpensesIcon size={20} />}
          highlightTag={`${nonVoidedExpenses.length} Records`}
        />
        <StatCard
          label="Treasury Disbursed"
          amount={paiseToRupees(treasuryDisbursedPaise)}
          subtitle="Deducted from House UPI & Cash Box"
          icon={<BankIcon size={20} />}
          accent
          highlightTag="Active Liquid"
        />
        <StatCard
          label="Member Out-of-Pocket"
          amount={paiseToRupees(outOfPocketPaise)}
          subtitle="Privately funded; no treasury impact"
          icon={<CashIcon size={20} />}
          highlightTag="Reimbursements"
        />
        <StatCard
          label="Pending Approval"
          amount={paiseToRupees(pendingDisbursementsPaise)}
          subtitle="Undisbursed quotes and requests"
          icon={<AlertTriangleIcon size={20} />}
          highlightTag={pendingDisbursementsPaise > 0 ? 'Action Needed' : 'Clear'}
        />
      </div>

      {/* Action Bar & Filter Tabs */}
      <Card>
        <CardHeader
          title="Shared Expenses Ledger"
          subtitle="Filter expenditures by payment source, category, and disbursement status"
          action={
            <div className="home-fund-action-buttons">
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  resetCreateForm()
                  setIsCreateModalOpen(true)
                }}
              >
                + Record Expense
              </button>
            </div>
          }
        />
        <CardContent>
          <div className="home-fund-action-bar" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="filter-tabs-row" style={{ margin: 0, padding: 0, border: 'none' }}>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'all' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('all')}
              >
                All ({expenses.length})
              </button>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'disbursed' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('disbursed')}
              >
                House Disbursed
              </button>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'out_of_pocket' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('out_of_pocket')}
              >
                Out of Pocket
              </button>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'pending' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('pending')}
              >
                Pending
              </button>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'voided' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('voided')}
              >
                Voided
              </button>
            </div>

            {/* Category Dropdown Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label htmlFor="cat-filter" style={{ fontSize: '0.7813rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                Category:
              </label>
              <select
                id="cat-filter"
                className="form-select"
                style={{ width: 'auto', padding: '4px 8px', fontSize: '0.7813rem' }}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="all">All Categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Expenses List */}
          {filteredExpenses.length === 0 ? (
            <div className="queue-empty-state">
              No expense records found matching the active filter.
            </div>
          ) : (
            <div className="ledger-list">
              {filteredExpenses.map((expense) => {
                const payer = memberMap.get(expense.payerMemberId)
                const isPayerDeparted = payer?.status === 'departed'
                const participantCount = expense.participantMemberIds.length

                return (
                  <div
                    key={expense.id}
                    className={`ledger-item-row ${expense.isVoided ? 'ledger-row-refund' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedExpense(expense)}
                  >
                    <div className="ledger-item-left">
                      <div className="expense-icon-badge">
                        <ExpensesIcon size={16} />
                      </div>
                      <div className="ledger-item-details">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span className="expense-title">{expense.title}</span>
                          <Badge variant="neutral">{expense.category}</Badge>
                          {expense.isVoided && <Badge variant="danger">Voided</Badge>}
                          {!expense.isVoided && expense.disbursementStatus === 'pending' && (
                            <Badge variant="warning">Pending Approval</Badge>
                          )}
                          {!expense.isVoided && expense.disbursementChannel === 'member_out_of_pocket' && (
                            <Badge variant="info">Out-of-Pocket</Badge>
                          )}
                          {expense.receipt && (
                            <span style={{ fontSize: '0.6875rem', color: 'var(--color-accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                              📎 Receipt
                            </span>
                          )}
                        </div>

                        <div className="expense-meta-line">
                          <span>
                            Purchased by <strong>{expense.paidBy}</strong>
                            {isPayerDeparted && (
                              <span className="nav-item-badge" style={{ marginLeft: '4px' }}>
                                Departed
                              </span>
                            )}
                          </span>
                          <span className="bullet-sep">·</span>
                          <span>{expense.date}</span>
                          <span className="bullet-sep">·</span>
                          <span>
                            {expense.disbursementChannel === 'treasury_personal_upi'
                              ? "Personal UPI"
                              : expense.disbursementChannel === 'treasury_cash_box'
                              ? 'Cash Box'
                              : 'Member Private Funds'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <div className="expense-item-right">
                        <span className="expense-amount">
                          {formatPaise(expense.amountPaise ?? rupeesToPaise(expense.amount))}
                        </span>
                        <span className="expense-split-tag">
                          {formatSplitScopeLabel(expense.splitScopeType, participantCount)}
                        </span>
                      </div>

                      {expense.disbursementStatus === 'pending' && !expense.isVoided && (
                        <button
                          type="button"
                          className="btn-primary btn-sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDisbursePending(expense)
                          }}
                        >
                          Disburse
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ==========================================================================
          Create Expense Modal
          ========================================================================== */}
      {isCreateModalOpen && (
        <div className="modal-overlay" onClick={() => setIsCreateModalOpen(false)}>
          <div
            className="modal-card"
            style={{ maxWidth: '640px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3 className="modal-title">Record Shared Expense</h3>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setIsCreateModalOpen(false)}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
                {createError && (
                  <div
                    className="demo-notice-banner"
                    style={{
                      margin: 0,
                      borderColor: 'var(--color-danger-border)',
                      backgroundColor: 'var(--color-danger-bg)',
                    }}
                  >
                    <span className="notice-text" style={{ color: 'var(--color-danger-text)' }}>
                      <strong>Validation Error:</strong> {createError}
                    </span>
                  </div>
                )}

                {/* Title */}
                <div className="form-group">
                  <label className="form-label" htmlFor="exp-title">
                    Expense Title *
                  </label>
                  <input
                    id="exp-title"
                    type="text"
                    placeholder="e.g. Monthly Kitchen Groceries"
                    className="form-input"
                    value={formTitle}
                    onChange={(e) => {
                      setFormTitle(e.target.value)
                      setCreateError(null)
                    }}
                    required
                  />
                </div>

                {/* Category & Amount */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="exp-category">
                      Category *
                    </label>
                    <select
                      id="exp-category"
                      className="form-select"
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value as ExpenseCategory)}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="exp-amount">
                      Total Amount (₹) *
                    </label>
                    <input
                      id="exp-amount"
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="e.g. 149.50"
                      className="form-input"
                      value={formAmountRupees}
                      onChange={(e) => {
                        setFormAmountRupees(e.target.value)
                        setCreateError(null)
                      }}
                      required
                    />
                  </div>
                </div>

                {/* Purchaser & Date */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="exp-payer">
                      Purchased By (Active Member) *
                    </label>
                    <select
                      id="exp-payer"
                      className="form-select"
                      value={formPayerId}
                      onChange={(e) => setFormPayerId(e.target.value)}
                    >
                      {activeMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.isResident ? 'Resident' : 'Food Contributor'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="exp-date">
                      Expense Date *
                    </label>
                    <input
                      id="exp-date"
                      type="text"
                      className="form-input"
                      value={formDate}
                      onChange={(e) => setFormDate(e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* Payment Source */}
                <div className="form-group">
                  <label className="form-label" htmlFor="exp-channel">
                    Payment Source *
                  </label>
                  <select
                    id="exp-channel"
                    className="form-select"
                    value={formChannel}
                    onChange={(e) => {
                      const channel = e.target.value as DisbursementChannel
                      setFormChannel(channel)
                      setCreateError(null)
                      if (channel === 'treasury_cash_box') {
                        setFormAccountId('acc-cash')
                      } else if (channel === 'treasury_personal_upi') {
                        setFormAccountId('acc-upi')
                      }
                    }}
                  >
                    <option value="treasury_personal_upi">
                      Household Personal UPI Account (Reduces UPI Fund)
                    </option>
                    <option value="treasury_cash_box">
                      Household Cash Box (Reduces Physical Cash Fund)
                    </option>
                    <option value="member_out_of_pocket">
                      Member Out-of-Pocket (Privately Paid; No House Fund Impact)
                    </option>
                  </select>
                </div>

                {/* Treasury Account and Disbursement Status if Treasury-funded */}
                {formChannel !== 'member_out_of_pocket' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                    <div className="form-group">
                      <label className="form-label" htmlFor="exp-account">
                        Treasury Account
                      </label>
                      <select
                        id="exp-account"
                        className="form-select"
                        value={formAccountId}
                        onChange={(e) => setFormAccountId(e.target.value)}
                      >
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="exp-status">
                        Disbursement Status
                      </label>
                      <select
                        id="exp-status"
                        className="form-select"
                        value={formStatus}
                        onChange={(e) =>
                          setFormStatus(e.target.value as ExpenseDisbursementStatus)
                        }
                      >
                        <option value="disbursed">Disbursed (Deducts Available Balance)</option>
                        <option value="pending">Pending (Awaiting Custodian Approval)</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Split Scope */}
                <div className="form-group">
                  <label className="form-label" htmlFor="exp-scope">
                    Participant Split Scope *
                  </label>
                  <select
                    id="exp-scope"
                    className="form-select"
                    value={formScope}
                    onChange={(e) => {
                      setFormScope(e.target.value as SplitScopeType)
                      setCreateError(null)
                    }}
                  >
                    <option value="all_active">All Eligible Active Members</option>
                    <option value="residents_only">Residents Only</option>
                    <option value="food_participants">Food-Eligible Participants</option>
                    <option value="custom">Custom Participant Selection</option>
                  </select>
                </div>

                {/* Custom Participant Selection Checklist */}
                {formScope === 'custom' && (
                  <div
                    style={{
                      padding: 'var(--space-3)',
                      backgroundColor: 'var(--color-bg-canvas)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border-subtle)',
                      marginBottom: 'var(--space-4)',
                    }}
                  >
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '8px' }}>
                      Select Active Eligible Participants ({formCustomMemberIds.length} selected):
                    </span>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
                      {activeMembers.map((m) => (
                        <label
                          key={m.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '0.7813rem',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={formCustomMemberIds.includes(m.id)}
                            onChange={() => toggleCustomMember(m.id)}
                          />
                          <span>{m.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Live Split Calculation Preview */}
                <div
                  style={{
                    padding: 'var(--space-3)',
                    backgroundColor: 'var(--color-bg-subtle)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border-default)',
                    marginBottom: 'var(--space-4)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      Live Split Preview ({liveFormSplits.length} Participants)
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      Exact Integer Paise Precision
                    </span>
                  </div>

                  {liveFormSplits.length === 0 ? (
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-danger-text)' }}>
                      No participants eligible for the selected scope.
                    </span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {liveFormSplits.map((s) => (
                        <div
                          key={s.memberId}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '0.75rem',
                            padding: '2px 0',
                          }}
                        >
                          <span>
                            {s.memberName}
                            {s.memberId === formPayerId && (
                              <strong style={{ color: 'var(--color-accent-primary)', marginLeft: '4px' }}>
                                (Purchaser)
                              </strong>
                            )}
                          </span>
                          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                            {formatPaise(s.sharePaise)} ({s.settlementStatus})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Optional Description */}
                <div className="form-group">
                  <label className="form-label" htmlFor="exp-desc">
                    Description / Item Details (Optional)
                  </label>
                  <input
                    id="exp-desc"
                    type="text"
                    placeholder="e.g. Receipt #4812, 5kg rice, spices, detergent"
                    className="form-input"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                  />
                </div>

                {/* Optional Receipt Attachment */}
                <div className="form-group">
                  <label className="form-label" htmlFor="exp-receipt">
                    Receipt Attachment (Optional)
                  </label>
                  <input
                    id="exp-receipt"
                    type="file"
                    accept="image/*,.pdf"
                    className="form-input"
                    onChange={handleReceiptChange}
                  />
                  <span className="form-helper">
                    Local browser preview only. Cloud storage is not connected in this preview.
                  </span>
                  {formReceipt && (
                    <div
                      style={{
                        marginTop: '6px',
                        padding: '6px 10px',
                        backgroundColor: 'var(--color-bg-canvas)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border-subtle)',
                        fontSize: '0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>
                        📎 <strong>{formReceipt.fileName}</strong> ({formReceipt.fileSize})
                      </span>
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', color: 'var(--color-danger-text)', cursor: 'pointer', fontSize: '0.75rem' }}
                        onClick={() => setFormReceipt(null)}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary btn-purple">
                  Commit Expense Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================================================
          Expense Details & Audit Modal
          ========================================================================== */}
      {selectedExpense && (
        <div className="modal-overlay" onClick={() => setSelectedExpense(null)}>
          <div
            className="modal-card"
            style={{ maxWidth: '640px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 className="modal-title">{selectedExpense.title}</h3>
                {selectedExpense.isVoided && <Badge variant="danger">Voided Record</Badge>}
                {!selectedExpense.isVoided && selectedExpense.disbursementStatus === 'pending' && (
                  <Badge variant="warning">Pending Approval</Badge>
                )}
              </div>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setSelectedExpense(null)}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
              {/* Void Banner if Voided */}
              {selectedExpense.isVoided && (
                <div
                  className="demo-notice-banner"
                  style={{
                    margin: 0,
                    marginBottom: 'var(--space-4)',
                    borderColor: 'var(--color-danger-border)',
                    backgroundColor: 'var(--color-danger-bg)',
                  }}
                >
                  <span className="notice-text" style={{ color: 'var(--color-danger-text)' }}>
                    <strong>Voided Transaction:</strong> {selectedExpense.voidReason} (Voided on {selectedExpense.voidedAt})
                  </span>
                </div>
              )}

              {/* Main Metadata Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3)',
                  backgroundColor: 'var(--color-bg-canvas)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border-subtle)',
                  marginBottom: 'var(--space-4)',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block' }}>
                    Total Amount
                  </span>
                  <span style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {formatPaise(selectedExpense.amountPaise ?? rupeesToPaise(selectedExpense.amount))}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block' }}>
                    Purchased By
                  </span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {selectedExpense.paidBy}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block' }}>
                    Date & Category
                  </span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                    {selectedExpense.date} · {selectedExpense.category}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block' }}>
                    Payment Channel
                  </span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                    {selectedExpense.disbursementChannel === 'treasury_personal_upi'
                      ? 'Household Personal UPI'
                      : selectedExpense.disbursementChannel === 'treasury_cash_box'
                      ? 'Living Room Cash Box'
                      : 'Member Out-of-Pocket'}
                  </span>
                </div>
              </div>

              {selectedExpense.description && (
                <div style={{ marginBottom: 'var(--space-4)', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                  <strong>Description:</strong> {selectedExpense.description}
                </div>
              )}

              {/* Receipt Preview */}
              {selectedExpense.receipt && (
                <div
                  style={{
                    padding: 'var(--space-3)',
                    backgroundColor: 'var(--color-bg-subtle)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border-subtle)',
                    marginBottom: 'var(--space-4)',
                  }}
                >
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-primary)', display: 'block', marginBottom: '4px' }}>
                    Attached Receipt
                  </span>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    📎 {selectedExpense.receipt.fileName} ({selectedExpense.receipt.fileSize ?? 'Local Attachment'})
                  </div>
                </div>
              )}

              {/* Participant Split Breakdown Table */}
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-primary)', display: 'block', marginBottom: '8px' }}>
                  Participant Split Shares ({selectedExpense.splits?.length ?? 0} Members)
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {selectedExpense.splits?.map((split) => (
                    <div
                      key={split.memberId}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        backgroundColor: 'var(--color-bg-canvas)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border-subtle)',
                        fontSize: '0.7813rem',
                      }}
                    >
                      <span>
                        {split.memberName ?? split.memberId}
                        {split.memberId === selectedExpense.payerMemberId && (
                          <span style={{ color: 'var(--color-accent-primary)', marginLeft: '4px', fontWeight: 600 }}>
                            (Purchaser)
                          </span>
                        )}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          {formatPaise(split.sharePaise)}
                        </span>
                        <Badge variant={split.settlementStatus === 'settled' ? 'success' : 'neutral'}>
                          {split.settlementStatus}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Correction History Trail */}
              {selectedExpense.correctionHistory && selectedExpense.correctionHistory.length > 0 && (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-primary)', display: 'block', marginBottom: '6px' }}>
                    Audit Correction Trail
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {selectedExpense.correctionHistory.map((h) => (
                      <div
                        key={h.id}
                        style={{
                          padding: '6px 10px',
                          backgroundColor: 'var(--color-bg-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.7188rem',
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        <strong>{h.editedAt}:</strong> {h.reason} (Edited by {h.editedByName})
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Inline Edit Form if triggered */}
              {isEditingExpense && (
                <div
                  style={{
                    marginTop: 'var(--space-4)',
                    padding: 'var(--space-3)',
                    backgroundColor: 'var(--color-bg-subtle)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border-default)',
                  }}
                >
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-primary)', display: 'block', marginBottom: '8px' }}>
                    Correct Expense Details (Non-Destructive)
                  </span>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-title">
                      Title
                    </label>
                    <input
                      id="edit-title"
                      type="text"
                      className="form-input"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-desc">
                      Description
                    </label>
                    <input
                      id="edit-desc"
                      type="text"
                      className="form-input"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-reason">
                      Mandatory Correction Reason *
                    </label>
                    <input
                      id="edit-reason"
                      type="text"
                      placeholder="e.g. Corrected typo in store item description"
                      className="form-input"
                      value={editReason}
                      onChange={(e) => setEditReason(e.target.value)}
                      required
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setIsEditingExpense(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={handleSaveCorrection}
                      disabled={!editReason.trim() || !editTitle.trim()}
                    >
                      Save Correction
                    </button>
                  </div>
                </div>
              )}

              {/* Void Prompt Box */}
              {isVoidPromptOpen && (
                <div
                  style={{
                    marginTop: 'var(--space-4)',
                    padding: 'var(--space-3)',
                    backgroundColor: 'var(--color-danger-bg)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-danger-border)',
                  }}
                >
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-danger-text)', display: 'block', marginBottom: '6px' }}>
                    Void Financial Record
                  </span>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-danger-text)', margin: '0 0 8px 0' }}>
                    Voiding excludes this expense from treasury deductions while preserving the record in audit history.
                  </p>
                  <input
                    type="text"
                    placeholder="Enter mandatory reason for voiding this expense..."
                    className="form-input"
                    value={voidReasonInput}
                    onChange={(e) => setVoidReasonInput(e.target.value)}
                    style={{ marginBottom: '8px' }}
                  />
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setIsVoidPromptOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      onClick={handleConfirmVoid}
                      disabled={!voidReasonInput.trim()}
                    >
                      Confirm Void
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <div>
                {!selectedExpense.isVoided && !isVoidPromptOpen && !isEditingExpense && (
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    onClick={() => setIsVoidPromptOpen(true)}
                  >
                    Void Record
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                {!selectedExpense.isVoided && !isEditingExpense && !isVoidPromptOpen && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      setEditTitle(selectedExpense.title)
                      setEditCategory(selectedExpense.category)
                      setEditDescription(selectedExpense.description ?? '')
                      setEditReason('')
                      setIsEditingExpense(true)
                    }}
                  >
                    Edit Details
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setSelectedExpense(null)
                    setIsEditingExpense(false)
                    setIsVoidPromptOpen(false)
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
