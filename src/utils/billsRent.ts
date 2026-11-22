import type {
  CreditorPeerClaimSummary,
  DerivedPeerClaim,
  ExpenseCategory,
  ExpenseItem,
  FinancialAction,
  FinancialActionResult,
  FinancialObligation,
  FundContribution,
  HouseholdMember,
  MemberNotificationItem,
  MemberObligationSummary,
  MemberSettlementRecord,
  NotificationEventType,
  ObligationCategory,
  ObligationContributionAllocation,
  ObligationCorrectionRecord,
  ObligationParticipantShare,
  ObligationReconciliationSummary,
  ObligationStatus,
  OrderIndependentMemberDebtResult,
  PeerCreditAdjustmentRecord,
  ProviderPaymentStatus,
  RootFinancialState,
  SettlementStatus,
  TreasuryAccount,
  TreasuryOverview,
  TreasuryTransfer,
} from '../types/index.ts'
import {
  generateEntityId,
  paiseToRupees,
  rupeesToPaise,
} from './financial.ts'
import {
  getTodayCalendarDate,
  isValidCalendarDate,
} from './cleaning.ts'

/* ==========================================================================
   1. Validation & Obligation Creation Utilities
   ========================================================================== */

/**
 * Validates billing period start, end, and due dates strictly.
 */
export function validateObligationDates(
  billingPeriodStart: string,
  billingPeriodEnd: string,
  dueDate: string
): { isValid: boolean; errorMessage?: string } {
  if (!isValidCalendarDate(billingPeriodStart)) {
    return { isValid: false, errorMessage: `Invalid billingPeriodStart: "${billingPeriodStart}". Must be YYYY-MM-DD between 2000-2100.` }
  }
  if (!isValidCalendarDate(billingPeriodEnd)) {
    return { isValid: false, errorMessage: `Invalid billingPeriodEnd: "${billingPeriodEnd}". Must be YYYY-MM-DD between 2000-2100.` }
  }
  if (!isValidCalendarDate(dueDate)) {
    return { isValid: false, errorMessage: `Invalid dueDate: "${dueDate}". Must be YYYY-MM-DD between 2000-2100.` }
  }
  if (billingPeriodStart > billingPeriodEnd) {
    return { isValid: false, errorMessage: 'Billing period start date cannot be after end date.' }
  }
  if (dueDate < billingPeriodStart) {
    return { isValid: false, errorMessage: 'Due date cannot be before billing period start date.' }
  }
  return { isValid: true }
}

/**
 * Calculates equal participant splits in integer paise with deterministic remainder distribution
 * using the Largest Remainder Method (Hare-Niemeyer).
 */
export function calculateEqualObligationShares(
  totalAmountPaise: number,
  participants: { id: string }[]
): ObligationParticipantShare[] {
  if (!participants || participants.length === 0) return []
  if (totalAmountPaise <= 0) {
    return participants.map((p) => ({ memberId: p.id, sharePaise: 0 }))
  }

  const count = participants.length
  const baseShare = Math.floor(totalAmountPaise / count)
  const remainder = totalAmountPaise % count

  return participants.map((p, index) => {
    // Distribute remainder 1 paise each to the first 'remainder' participants
    const sharePaise = baseShare + (index < remainder ? 1 : 0)
    return {
      memberId: p.id,
      sharePaise,
    }
  })
}

/**
 * Validates participant shares against the total obligation amount and active members.
 */
export function validateObligationShares(
  totalAmountPaise: number,
  shares: ObligationParticipantShare[],
  members: HouseholdMember[],
  category: ObligationCategory
): { isValid: boolean; errorMessage?: string } {
  if (!shares || shares.length === 0) {
    return { isValid: false, errorMessage: 'At least one participant share is required.' }
  }

  if (totalAmountPaise <= 0 || !Number.isInteger(totalAmountPaise)) {
    return { isValid: false, errorMessage: 'Total amount must be a positive integer in paise.' }
  }

  const seenMembers = new Set<string>()
  let sumShares = 0

  for (const s of shares) {
    if (!s.memberId) {
      return { isValid: false, errorMessage: 'Participant share must include a valid memberId.' }
    }
    if (seenMembers.has(s.memberId)) {
      return { isValid: false, errorMessage: `Duplicate participant found in shares: member "${s.memberId}".` }
    }
    seenMembers.add(s.memberId)

    if (s.sharePaise <= 0 || !Number.isInteger(s.sharePaise)) {
      return { isValid: false, errorMessage: `Share for member "${s.memberId}" must be a positive integer in paise.` }
    }
    sumShares += s.sharePaise

    const member = members.find((m) => m.id === s.memberId)
    if (!member) {
      return { isValid: false, errorMessage: `Member "${s.memberId}" does not exist in household.` }
    }
    if (member.status !== 'active') {
      return { isValid: false, errorMessage: `Member "${member.name}" is ${member.status} and cannot be assigned an obligation.` }
    }
    if (category === 'rent_cycle' && member.isRentEligible === false) {
      return { isValid: false, errorMessage: `Member "${member.name}" is not eligible for rent obligations.` }
    }
  }

  if (sumShares !== totalAmountPaise) {
    return {
      isValid: false,
      errorMessage: `Sum of participant shares (${sumShares} paise) does not equal total obligation amount (${totalAmountPaise} paise).`,
    }
  }

  return { isValid: true }
}

/**
 * Pure creator for FinancialObligation.
 */
export function createFinancialObligation(params: {
  id?: string
  category: ObligationCategory
  title: string
  billingPeriodStart: string
  billingPeriodEnd: string
  dueDate: string
  totalAmountPaise: number
  shares: ObligationParticipantShare[]
  providerName: string
  consumerAccountNumber?: string
  billDocumentUrl?: string
  notes?: string
  createdByMembershipId: string
  members: HouseholdMember[]
  createdAt?: string
}): { obligation?: FinancialObligation; error?: string } {
  const dateCheck = validateObligationDates(
    params.billingPeriodStart,
    params.billingPeriodEnd,
    params.dueDate
  )
  if (!dateCheck.isValid) {
    return { error: dateCheck.errorMessage }
  }

  if (!params.title || params.title.trim().length === 0) {
    return { error: 'Obligation title is required.' }
  }
  if (!params.providerName || params.providerName.trim().length === 0) {
    return { error: 'Provider name is required.' }
  }

  const shareCheck = validateObligationShares(
    params.totalAmountPaise,
    params.shares,
    params.members,
    params.category
  )
  if (!shareCheck.isValid) {
    return { error: shareCheck.errorMessage }
  }

  const obligation: FinancialObligation = {
    id: params.id ?? generateEntityId('ob'),
    category: params.category,
    title: params.title.trim(),
    billingPeriodStart: params.billingPeriodStart,
    billingPeriodEnd: params.billingPeriodEnd,
    dueDate: params.dueDate,
    totalAmountPaise: params.totalAmountPaise,
    totalAmount: paiseToRupees(params.totalAmountPaise),
    currency: 'INR',
    shares: params.shares,
    providerName: params.providerName.trim(),
    consumerAccountNumber: params.consumerAccountNumber?.trim(),
    billDocumentUrl: params.billDocumentUrl?.trim(),
    notes: params.notes?.trim(),
    createdByMembershipId: params.createdByMembershipId,
    createdAt: params.createdAt ?? new Date().toISOString(),
    isVoided: false,
    correctionHistory: [],
  }

  return { obligation }
}

/* ==========================================================================
   2. Contribution Allocation Logic
   ========================================================================== */

/**
 * Validates a contribution allocation against its parent contribution and target obligation.
 */
export function validateContributionAllocation(
  allocation: Partial<ObligationContributionAllocation>,
  parentContribution: FundContribution,
  obligation: FinancialObligation,
  existingAllocations: ObligationContributionAllocation[]
): { isValid: boolean; errorMessage?: string } {
  if (obligation.isVoided) {
    return { isValid: false, errorMessage: 'Cannot allocate contribution to a voided obligation.' }
  }

  if (parentContribution.isVoided) {
    return { isValid: false, errorMessage: 'Cannot allocate from a voided contribution.' }
  }

  if (parentContribution.isRefundAdjustment || parentContribution.status === 'refunded') {
    return { isValid: false, errorMessage: 'Cannot allocate from a refunded contribution.' }
  }

  if (parentContribution.status !== 'confirmed') {
    return { isValid: false, errorMessage: `Cannot allocate from contribution with status "${parentContribution.status}". Must be "confirmed".` }
  }

  const amountPaise = allocation.amountPaise ?? 0
  if (amountPaise <= 0 || !Number.isInteger(amountPaise)) {
    return { isValid: false, errorMessage: 'Allocation amount must be a positive integer in paise.' }
  }

  if (!allocation.targetMemberId) {
    return { isValid: false, errorMessage: 'Target memberId is required for allocation.' }
  }

  const targetShare = obligation.shares.find((s) => s.memberId === allocation.targetMemberId)
  if (!targetShare) {
    return { isValid: false, errorMessage: `Target member "${allocation.targetMemberId}" is not a participant in obligation "${obligation.title}".` }
  }

  // 1. Check parent contribution available unallocated capacity
  const otherAllocOnContribution = existingAllocations
    .filter(
      (a) =>
        a.contributionId === parentContribution.id &&
        a.id !== allocation.id &&
        !a.isVoided
    )
    .reduce((sum, a) => sum + a.amountPaise, 0)

  const parentTotalPaise = rupeesToPaise(parentContribution.amount)
  if (otherAllocOnContribution + amountPaise > parentTotalPaise) {
    const availPaise = parentTotalPaise - otherAllocOnContribution
    return {
      isValid: false,
      errorMessage: `Allocation of ₹${paiseToRupees(amountPaise)} exceeds available unallocated contribution amount of ₹${paiseToRupees(availPaise)}.`,
    }
  }

  // 2. Check target member's remaining unallocated share ceiling on this obligation
  const alreadyAllocatedToTarget = existingAllocations
    .filter(
      (a) =>
        a.obligationId === obligation.id &&
        a.targetMemberId === allocation.targetMemberId &&
        a.id !== allocation.id &&
        !a.isVoided
    )
    .reduce((sum, a) => sum + a.amountPaise, 0)

  const remainingShareCeiling = targetShare.sharePaise - alreadyAllocatedToTarget
  if (amountPaise > remainingShareCeiling) {
    return {
      isValid: false,
      errorMessage: `Allocation of ₹${paiseToRupees(amountPaise)} exceeds target member's remaining share ceiling of ₹${paiseToRupees(remainingShareCeiling)}.`,
    }
  }

  return { isValid: true }
}

/**
 * Calculates unallocated paise remaining on a FundContribution.
 */
export function calculateContributionUnallocatedPaise(
  contribution: FundContribution,
  allocations: ObligationContributionAllocation[]
): number {
  if (contribution.status !== 'confirmed' || contribution.isVoided || contribution.isRefundAdjustment) {
    return 0
  }
  const totalPaise = rupeesToPaise(contribution.amount)
  const allocatedPaise = allocations
    .filter((a) => a.contributionId === contribution.id && !a.isVoided)
    .reduce((sum, a) => sum + a.amountPaise, 0)

  return Math.max(0, totalPaise - allocatedPaise)
}

/**
 * Creates an authoritative ObligationContributionAllocation record.
 */
export function createContributionAllocation(params: {
  id?: string
  contributionId: string
  obligationId: string
  targetMemberId: string
  amountPaise: number
  allocatedByMembershipId: string
  allocatedAt?: string
}): ObligationContributionAllocation {
  return {
    id: params.id ?? generateEntityId('alloc'),
    contributionId: params.contributionId,
    obligationId: params.obligationId,
    targetMemberId: params.targetMemberId,
    amountPaise: params.amountPaise,
    allocatedByMembershipId: params.allocatedByMembershipId,
    allocatedAt: params.allocatedAt ?? new Date().toISOString(),
    isVoided: false,
  }
}

/**
 * Voids an allocation non-destructively, preserving audit history.
 */
export function voidContributionAllocation(
  allocationId: string,
  allocations: ObligationContributionAllocation[],
  voidedByMembershipId: string,
  voidReason: string,
  voidedAt?: string
): ObligationContributionAllocation[] {
  return allocations.map((a) => {
    if (a.id === allocationId) {
      return {
        ...a,
        isVoided: true,
        voidedByMembershipId,
        voidReason,
        voidedAt: voidedAt ?? new Date().toISOString(),
      }
    }
    return a
  })
}

/* ==========================================================================
   3. Provider Payments via ExpenseItem
   ========================================================================== */

/**
 * Validates a provider payment ExpenseItem.
 * - Out-of-pocket payments bypass treasury checks.
 * - Treasury payments require valid, active account with sufficient liquid funds.
 * - Enforces zero provider overpayment.
 */
export function validateProviderPaymentExpense(
  payment: Partial<ExpenseItem>,
  obligation: FinancialObligation,
  existingExpenses: ExpenseItem[],
  accounts: TreasuryAccount[],
  treasuryOverview: TreasuryOverview
): { isValid: boolean; errorMessage?: string } {
  if (obligation.isVoided) {
    return { isValid: false, errorMessage: 'Cannot disburse payment for a voided obligation.' }
  }

  const amountPaise = payment.amountPaise ?? 0
  if (amountPaise <= 0 || !Number.isInteger(amountPaise)) {
    return { isValid: false, errorMessage: 'Payment amount must be a positive integer in paise.' }
  }

  // Check provider overpayment
  const alreadyDisbursedPaise = existingExpenses
    .filter(
      (e) =>
        e.linkedObligationId === obligation.id &&
        e.disbursementStatus === 'disbursed' &&
        !e.isVoided &&
        e.id !== payment.id
    )
    .reduce((sum, e) => sum + e.amountPaise, 0)

  if (alreadyDisbursedPaise + amountPaise > obligation.totalAmountPaise) {
    const remainingBillPaise = obligation.totalAmountPaise - alreadyDisbursedPaise
    return {
      isValid: false,
      errorMessage: `Payment of ₹${paiseToRupees(amountPaise)} exceeds remaining provider bill balance of ₹${paiseToRupees(remainingBillPaise)}.`,
    }
  }

  if (payment.expenseSourceType !== 'obligation_provider_payment') {
    return { isValid: false, errorMessage: 'expenseSourceType must be "obligation_provider_payment".' }
  }

  if (payment.linkedObligationId !== obligation.id) {
    return { isValid: false, errorMessage: 'linkedObligationId must match the target obligation ID.' }
  }

  // Personal out-of-pocket payment
  if (payment.disbursementChannel === 'member_out_of_pocket') {
    if (!payment.payerMemberId) {
      return { isValid: false, errorMessage: 'A valid purchaser/payer member ID is required for out-of-pocket payments.' }
    }
    return { isValid: true }
  }

  // Treasury disbursement channel
  if (
    payment.disbursementChannel === 'treasury_personal_upi' ||
    payment.disbursementChannel === 'treasury_cash_box'
  ) {
    if (!payment.disbursedFromAccountId) {
      return { isValid: false, errorMessage: 'A valid treasury disbursement account must be selected.' }
    }

    const account = accounts.find((a) => a.id === payment.disbursedFromAccountId && a.isActive)
    if (!account) {
      return { isValid: false, errorMessage: 'Selected treasury account is invalid or inactive.' }
    }

    if (payment.disbursementChannel === 'treasury_personal_upi' && account.accountType !== 'personal_upi') {
      return { isValid: false, errorMessage: 'Selected account does not match personal UPI disbursement channel.' }
    }
    if (payment.disbursementChannel === 'treasury_cash_box' && account.accountType !== 'cash_box') {
      return { isValid: false, errorMessage: 'Selected account does not match cash box disbursement channel.' }
    }

    // Strict Liquid Available Balance check (No negative / overdraft balance)
    const summary = treasuryOverview.accounts.find((s) => s.account.id === payment.disbursedFromAccountId)
    const availablePaise = summary?.currentBalancePaise ?? 0

    if (amountPaise > availablePaise) {
      return {
        isValid: false,
        errorMessage: `Insufficient liquid funds in ${account.name}. Available: ₹${paiseToRupees(availablePaise).toLocaleString('en-IN')}, Requested: ₹${paiseToRupees(amountPaise).toLocaleString('en-IN')}.`,
      }
    }

    return { isValid: true }
  }

  return { isValid: false, errorMessage: `Unsupported disbursement channel: "${payment.disbursementChannel}".` }
}

/**
 * Creates an authoritative ExpenseItem for an obligation provider payment.
 * Guarantees participantMemberIds: [] and splits: [] to avoid duplicate shared expense ledger entries.
 */
export function createProviderPaymentExpense(params: {
  id?: string
  obligation: FinancialObligation
  amountPaise: number
  payerMemberId: string
  paidByName: string
  date: string
  disbursementChannel: 'treasury_personal_upi' | 'treasury_cash_box' | 'member_out_of_pocket'
  disbursedFromAccountId?: string
  description?: string
  createdByMembershipId: string
}): ExpenseItem {
  return {
    id: params.id ?? generateEntityId('exp-prov'),
    title: `${params.obligation.title} — Provider Payment`,
    category: params.obligation.category === 'rent_cycle' ? 'Rent & Society' : 'Utilities & Internet',
    amount: paiseToRupees(params.amountPaise),
    amountPaise: params.amountPaise,
    payerMemberId: params.payerMemberId,
    paidBy: params.paidByName,
    date: params.date,
    description: params.description ?? `Direct payment to provider ${params.obligation.providerName}.`,
    splitScopeType: 'custom',
    participantMemberIds: [], // Dedicated provider payment: no individual expense split
    splits: [],               // Authoritative empty array prevents duplicate shared expense splits
    disbursementChannel: params.disbursementChannel,
    disbursedFromAccountId: params.disbursedFromAccountId,
    disbursementStatus: 'disbursed',
    isVoided: false,
    correctionHistory: [],
    expenseSourceType: 'obligation_provider_payment',
    linkedObligationId: params.obligation.id,
  }
}

/* ==========================================================================
   4. Treasury Advance & Attribution Logic
   ========================================================================== */

/**
 * Calculates Treasury advance metrics for a specific obligation.
 * Advance = max(0, TreasuryDisbursements - ValidConfirmedAllocations)
 */
export function calculateTreasuryAdvance(
  obligationId: string,
  providerExpenses: ExpenseItem[],
  contributions: FundContribution[],
  allocations: ObligationContributionAllocation[]
): {
  totalTreasuryPaidPaise: number
  validAllocationsTotalPaise: number
  treasuryAdvancePaise: number
} {
  // Sum disbursed, non-voided provider payments from treasury accounts
  const totalTreasuryPaidPaise = providerExpenses
    .filter(
      (e) =>
        e.linkedObligationId === obligationId &&
        e.disbursementStatus === 'disbursed' &&
        e.disbursementChannel !== 'member_out_of_pocket' &&
        !e.isVoided
    )
    .reduce((sum, e) => sum + e.amountPaise, 0)

  // Filter valid confirmed allocations
  const contributionMap = new Map<string, FundContribution>()
  for (const c of contributions) {
    contributionMap.set(c.id, c)
  }

  const validAllocationsTotalPaise = allocations
    .filter((a) => {
      if (a.obligationId !== obligationId || a.isVoided) return false
      const parent = contributionMap.get(a.contributionId)
      if (!parent) return false
      return parent.status === 'confirmed' && !parent.isVoided && !parent.isRefundAdjustment
    })
    .reduce((sum, a) => sum + a.amountPaise, 0)

  const treasuryAdvancePaise = Math.max(0, totalTreasuryPaidPaise - validAllocationsTotalPaise)

  return {
    totalTreasuryPaidPaise,
    validAllocationsTotalPaise,
    treasuryAdvancePaise,
  }
}

/**
 * Attributes a Treasury advance across eligible unfunded member shares using the Largest Remainder Method.
 * Enforces:
 * - Sum of attributed amounts equals treasuryAdvancePaise exactly.
 * - No member's attributed debt exceeds their unfunded base share.
 * - Throws an error on unreconciled or inconsistent states (no silent clamping).
 */
export function attributeTreasuryAdvance(
  obligation: FinancialObligation,
  treasuryAdvancePaise: number,
  memberUnfundedShares: Map<string, number>
): Map<string, number> {
  const result = new Map<string, number>()
  for (const s of obligation.shares) {
    result.set(s.memberId, 0)
  }

  if (treasuryAdvancePaise <= 0) {
    return result
  }

  // Filter members with positive unfunded shares
  const eligibleMembers: { id: string; unfundedPaise: number }[] = []
  let totalEligibleUnfundedPaise = 0

  for (const s of obligation.shares) {
    const unfunded = memberUnfundedShares.get(s.memberId) ?? 0
    if (unfunded > 0) {
      eligibleMembers.push({ id: s.memberId, unfundedPaise: unfunded })
      totalEligibleUnfundedPaise += unfunded
    }
  }

  if (treasuryAdvancePaise > totalEligibleUnfundedPaise) {
    throw new Error(
      `Treasury advance (${treasuryAdvancePaise} paise) exceeds total eligible unfunded shares (${totalEligibleUnfundedPaise} paise). Reconcile transaction state.`
    )
  }

  // Largest Remainder Method (Hare-Niemeyer) for exact integer paise attribution
  const rawShares: { id: string; basePaise: number; remainder: number; cap: number }[] = []
  let allocatedBaseSum = 0

  for (const m of eligibleMembers) {
    const exactShare = (m.unfundedPaise / totalEligibleUnfundedPaise) * treasuryAdvancePaise
    const basePaise = Math.floor(exactShare)
    const remainder = exactShare - basePaise
    rawShares.push({ id: m.id, basePaise, remainder, cap: m.unfundedPaise })
    allocatedBaseSum += basePaise
  }

  let remainderPaiseToDistribute = treasuryAdvancePaise - allocatedBaseSum

  // Sort by largest remainder descending; break ties by memberId ascending
  rawShares.sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder
    return a.id.localeCompare(b.id)
  })

  for (const item of rawShares) {
    let finalPaise = item.basePaise
    if (remainderPaiseToDistribute > 0 && finalPaise < item.cap) {
      finalPaise += 1
      remainderPaiseToDistribute -= 1
    }
    result.set(item.id, finalPaise)
  }

  // Final verification assertion
  let totalAttributed = 0
  for (const [memberId, attributedPaise] of result.entries()) {
    totalAttributed += attributedPaise
    const unfundedCap = memberUnfundedShares.get(memberId) ?? 0
    if (attributedPaise > unfundedCap) {
      throw new Error(`Attributed advance for member "${memberId}" (${attributedPaise} paise) exceeds unfunded cap (${unfundedCap} paise).`)
    }
  }

  if (totalAttributed !== treasuryAdvancePaise) {
    throw new Error(`Attributed advance total (${totalAttributed} paise) does not match treasury advance (${treasuryAdvancePaise} paise).`)
  }

  return result
}

/* ==========================================================================
   5. Deterministic Peer Claims & P2P Settlement
   ========================================================================== */

/**
 * Derives stable peer claims and member treasury debts for an obligation.
 * Algorithm:
 * 1. Calculate confirmed allocations per member (C_i).
 * 2. Calculate personal payments per member (P_j). Payer's own share is settled first (P_own,j = min(S_j - C_j, P_j)).
 * 3. Excess personal payment P_excess,j = P_j - P_own,j.
 * 4. Unfunded base share U_i = max(0, S_i - C_i - P_own,i).
 * 5. Calculate and attribute Treasury advance D_treasury,i across members with U_i > 0.
 * 6. Remaining gap eligible for peer claims: EligiblePeerGap_i = U_i - D_treasury,i.
 * 7. In chronological order of out-of-pocket expenses, attribute P_excess,j to members with EligiblePeerGap_i > 0.
 * 8. Creates DerivedPeerClaim with stable ID: "claim-" + expenseId + "-" + debtorMemberId.
 */
export function derivePeerClaims(
  obligation: FinancialObligation,
  providerExpenses: ExpenseItem[],
  allocations: ObligationContributionAllocation[],
  contributions: FundContribution[]
): {
  claims: DerivedPeerClaim[]
  memberTreasuryDebts: Map<string, number>
} {
  const contributionMap = new Map<string, FundContribution>()
  for (const c of contributions) {
    contributionMap.set(c.id, c)
  }

  // 1. Confirmed allocations per member
  const memberAllocations = new Map<string, number>()
  for (const s of obligation.shares) {
    memberAllocations.set(s.memberId, 0)
  }

  for (const a of allocations) {
    if (a.obligationId !== obligation.id || a.isVoided) continue
    const parent = contributionMap.get(a.contributionId)
    if (!parent || parent.status !== 'confirmed' || parent.isVoided || parent.isRefundAdjustment) continue

    const current = memberAllocations.get(a.targetMemberId) ?? 0
    memberAllocations.set(a.targetMemberId, current + a.amountPaise)
  }

  // 2. Personal out-of-pocket expenses
  const personalExpenses = providerExpenses
    .filter(
      (e) =>
        e.linkedObligationId === obligation.id &&
        e.disbursementStatus === 'disbursed' &&
        e.disbursementChannel === 'member_out_of_pocket' &&
        !e.isVoided
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))

  // Personal payments applied to own share and excess
  const memberPersonalPayments = new Map<string, number>()
  for (const s of obligation.shares) {
    memberPersonalPayments.set(s.memberId, 0)
  }

  for (const e of personalExpenses) {
    const current = memberPersonalPayments.get(e.payerMemberId) ?? 0
    memberPersonalPayments.set(e.payerMemberId, current + e.amountPaise)
  }

  const memberOwnPaid = new Map<string, number>()
  const memberUnfundedShares = new Map<string, number>()

  for (const s of obligation.shares) {
    const C_i = memberAllocations.get(s.memberId) ?? 0
    const P_i = memberPersonalPayments.get(s.memberId) ?? 0
    const P_own_i = Math.min(Math.max(0, s.sharePaise - C_i), P_i)
    memberOwnPaid.set(s.memberId, P_own_i)
    const U_i = Math.max(0, s.sharePaise - C_i - P_own_i)
    memberUnfundedShares.set(s.memberId, U_i)
  }

  // 3. Treasury Advance Attribution
  const { treasuryAdvancePaise } = calculateTreasuryAdvance(
    obligation.id,
    providerExpenses,
    contributions,
    allocations
  )

  const memberTreasuryDebts = attributeTreasuryAdvance(
    obligation,
    treasuryAdvancePaise,
    memberUnfundedShares
  )

  // 4. Remaining gaps eligible for peer claims
  const remainingPeerGaps = new Map<string, number>()
  for (const s of obligation.shares) {
    const U_i = memberUnfundedShares.get(s.memberId) ?? 0
    const D_treasury_i = memberTreasuryDebts.get(s.memberId) ?? 0
    remainingPeerGaps.set(s.memberId, Math.max(0, U_i - D_treasury_i))
  }

  // 5. Attribute personal payer excess chronologically
  const claims: DerivedPeerClaim[] = []

  // Track each payer's remaining excess to attribute across their personal expenses
  for (const e of personalExpenses) {
    const payerId = e.payerMemberId
    const payerShare = obligation.shares.find((s) => s.memberId === payerId)
    const payerBaseSharePaise = payerShare?.sharePaise ?? 0
    const payerAllocated = memberAllocations.get(payerId) ?? 0
    const neededForOwn = Math.max(0, payerBaseSharePaise - payerAllocated)

    // For this expense, how much goes to own share vs excess?
    // If payer has multiple expenses, account for own share fulfillment
    const previouslyCreditedToOwn = memberOwnPaid.get(`${payerId}_used`) ?? 0
    const availableForOwn = Math.max(0, neededForOwn - previouslyCreditedToOwn)
    const thisExpenseForOwn = Math.min(availableForOwn, e.amountPaise)
    memberOwnPaid.set(`${payerId}_used`, previouslyCreditedToOwn + thisExpenseForOwn)

    let expenseExcess = e.amountPaise - thisExpenseForOwn

    if (expenseExcess > 0) {
      for (const s of obligation.shares) {
        if (s.memberId === payerId) continue
        const debtorGap = remainingPeerGaps.get(s.memberId) ?? 0
        if (debtorGap > 0 && expenseExcess > 0) {
          const claimAmount = Math.min(debtorGap, expenseExcess)
          if (claimAmount > 0) {
            claims.push({
              id: `claim-${e.id}-${s.memberId}`,
              expenseId: e.id,
              obligationId: obligation.id,
              debtorMemberId: s.memberId,
              creditorMemberId: payerId,
              claimAmountPaise: claimAmount,
              createdAt: e.date,
            })
            remainingPeerGaps.set(s.memberId, debtorGap - claimAmount)
            expenseExcess -= claimAmount
          }
        }
        if (expenseExcess === 0) break
      }
    }
  }

  return { claims, memberTreasuryDebts }
}

/**
 * Validates a member settlement record against its target peer claim.
 */
export function validateMemberSettlement(
  settlement: Partial<MemberSettlementRecord>,
  claim: DerivedPeerClaim,
  existingSettlements: MemberSettlementRecord[]
): { isValid: boolean; errorMessage?: string } {
  if (!settlement.claimId || settlement.claimId !== claim.id) {
    return { isValid: false, errorMessage: 'Settlement must link to a valid DerivedPeerClaim.' }
  }

  if (settlement.debtorMemberId !== claim.debtorMemberId) {
    return { isValid: false, errorMessage: `Debtor member "${settlement.debtorMemberId}" does not match claim debtor "${claim.debtorMemberId}".` }
  }

  if (settlement.creditorMemberId !== claim.creditorMemberId) {
    return { isValid: false, errorMessage: `Creditor member "${settlement.creditorMemberId}" does not match claim creditor "${claim.creditorMemberId}".` }
  }

  const amountPaise = settlement.amountPaise ?? 0
  if (amountPaise <= 0 || !Number.isInteger(amountPaise)) {
    return { isValid: false, errorMessage: 'Settlement amount must be a positive integer in paise.' }
  }

  if (!settlement.idempotencyKey || settlement.idempotencyKey.trim().length === 0) {
    return { isValid: false, errorMessage: 'Settlement requires a unique idempotencyKey.' }
  }

  // Check duplicate idempotency key
  const duplicate = existingSettlements.find(
    (s) => s.idempotencyKey === settlement.idempotencyKey && s.id !== settlement.id
  )
  if (duplicate) {
    return { isValid: false, errorMessage: `Duplicate settlement submission detected with idempotencyKey "${settlement.idempotencyKey}".` }
  }

  // Calculate available capacity on this claim
  const confirmedPaid = existingSettlements
    .filter((s) => s.claimId === claim.id && s.status === 'confirmed' && s.id !== settlement.id)
    .reduce((sum, s) => sum + s.amountPaise, 0)

  const pendingReserved = existingSettlements
    .filter((s) => s.claimId === claim.id && s.status === 'pending_confirmation' && s.id !== settlement.id)
    .reduce((sum, s) => sum + s.amountPaise, 0)

  const availableCapacity = claim.claimAmountPaise - confirmedPaid - pendingReserved
  if (amountPaise > availableCapacity) {
    return {
      isValid: false,
      errorMessage: `Settlement of ₹${paiseToRupees(amountPaise)} exceeds available claim capacity of ₹${paiseToRupees(availableCapacity)} (Claim total: ₹${paiseToRupees(claim.claimAmountPaise)}, Confirmed: ₹${paiseToRupees(confirmedPaid)}, Pending: ₹${paiseToRupees(pendingReserved)}).`,
    }
  }

  return { isValid: true }
}

/**
 * Creates a MemberSettlementRecord in 'pending_confirmation' status.
 */
export function createMemberSettlement(params: {
  id?: string
  idempotencyKey: string
  obligationId: string
  claimId: string
  debtorMemberId: string
  creditorMemberId: string
  amountPaise: number
  paymentMethod: 'upi' | 'cash' | 'bank_transfer'
  paymentReference?: string
  paymentDate: string
  notes?: string
  submittedAt?: string
}): MemberSettlementRecord {
  return {
    id: params.id ?? generateEntityId('settle'),
    idempotencyKey: params.idempotencyKey,
    obligationId: params.obligationId,
    claimId: params.claimId,
    debtorMemberId: params.debtorMemberId,
    creditorMemberId: params.creditorMemberId,
    amountPaise: params.amountPaise,
    paymentMethod: params.paymentMethod,
    paymentReference: params.paymentReference?.trim(),
    paymentDate: params.paymentDate,
    notes: params.notes?.trim(),
    status: 'pending_confirmation',
    submittedAt: params.submittedAt ?? new Date().toISOString(),
  }
}

/**
 * Confirms a settlement claim. Strictly gates confirmation to the designated creditor.
 */
export function confirmMemberSettlement(
  settlementId: string,
  settlements: MemberSettlementRecord[],
  confirmedByMemberId: string,
  confirmedAt?: string
): MemberSettlementRecord[] {
  return settlements.map((s) => {
    if (s.id === settlementId) {
      if (s.creditorMemberId !== confirmedByMemberId) {
        throw new Error(`Only designated creditor "${s.creditorMemberId}" can confirm this settlement.`)
      }
      if (s.status !== 'pending_confirmation') {
        throw new Error(`Cannot confirm settlement with status "${s.status}". Must be "pending_confirmation".`)
      }
      return {
        ...s,
        status: 'confirmed' as SettlementStatus,
        confirmedByMemberId,
        confirmedAt: confirmedAt ?? new Date().toISOString(),
      }
    }
    return s
  })
}

/**
 * Rejects a settlement claim. Strictly gates rejection to the designated creditor.
 */
export function rejectMemberSettlement(
  settlementId: string,
  settlements: MemberSettlementRecord[],
  rejectedByMemberId: string,
  rejectionReason: string,
  rejectedAt?: string
): MemberSettlementRecord[] {
  return settlements.map((s) => {
    if (s.id === settlementId) {
      if (s.creditorMemberId !== rejectedByMemberId) {
        throw new Error(`Only designated creditor "${s.creditorMemberId}" can reject this settlement.`)
      }
      if (s.status !== 'pending_confirmation') {
        throw new Error(`Cannot reject settlement with status "${s.status}". Must be "pending_confirmation".`)
      }
      return {
        ...s,
        status: 'rejected' as SettlementStatus,
        rejectedByMemberId,
        rejectionReason,
        rejectedAt: rejectedAt ?? new Date().toISOString(),
      }
    }
    return s
  })
}

/**
 * Voids a confirmed settlement non-destructively, restoring claim debt.
 */
export function voidMemberSettlement(
  settlementId: string,
  settlements: MemberSettlementRecord[],
  voidedByMemberId: string,
  voidReason: string,
  voidedAt?: string
): MemberSettlementRecord[] {
  return settlements.map((s) => {
    if (s.id === settlementId) {
      return {
        ...s,
        status: 'voided' as SettlementStatus,
        voidedByMemberId,
        voidReason,
        voidedAt: voidedAt ?? new Date().toISOString(),
      }
    }
    return s
  })
}

/* ==========================================================================
   6. Member Financial Summaries & Reconciliation
   ========================================================================== */

/**
 * Derives the comprehensive, non-overlapping financial summary for a member on an obligation.
 */
export function deriveMemberObligationSummary(
  memberId: string,
  obligation: FinancialObligation,
  allocations: ObligationContributionAllocation[],
  contributions: FundContribution[],
  providerExpenses: ExpenseItem[],
  settlements: MemberSettlementRecord[]
): MemberObligationSummary {
  const share = obligation.shares.find((s) => s.memberId === memberId)
  const baseSharePaise = share?.sharePaise ?? 0

  if (obligation.isVoided) {
    return {
      memberId,
      baseSharePaise,
      confirmedAllocatedPaise: 0,
      personalPaymentOwnSharePaise: 0,
      treasuryAdvanceAttributedPaise: 0,
      peerReceivableDebtPaise: 0,
      confirmedP2PRepaymentsPaise: 0,
      unpaidProviderSharePaise: 0,
      owedToHomeFundPaise: 0,
      owedToCreditorsPaise: 0,
      totalOutstandingPaise: 0,
    }
  }

  // 1. Confirmed allocations for this member
  const contributionMap = new Map<string, FundContribution>()
  for (const c of contributions) {
    contributionMap.set(c.id, c)
  }

  const confirmedAllocatedPaise = allocations
    .filter((a) => {
      if (a.obligationId !== obligation.id || a.targetMemberId !== memberId || a.isVoided) return false
      const parent = contributionMap.get(a.contributionId)
      return parent && parent.status === 'confirmed' && !parent.isVoided && !parent.isRefundAdjustment
    })
    .reduce((sum, a) => sum + a.amountPaise, 0)

  // 2. Personal out-of-pocket payments applied to own share
  const memberPersonalExpenses = providerExpenses
    .filter(
      (e) =>
        e.linkedObligationId === obligation.id &&
        e.payerMemberId === memberId &&
        e.disbursementStatus === 'disbursed' &&
        e.disbursementChannel === 'member_out_of_pocket' &&
        !e.isVoided
    )
    .reduce((sum, e) => sum + e.amountPaise, 0)

  const neededForOwn = Math.max(0, baseSharePaise - confirmedAllocatedPaise)
  const personalPaymentOwnSharePaise = Math.min(neededForOwn, memberPersonalExpenses)

  // 3. Derived Peer Claims & Treasury Debts
  const { claims, memberTreasuryDebts } = derivePeerClaims(
    obligation,
    providerExpenses,
    allocations,
    contributions
  )

  const treasuryAdvanceAttributedPaise = memberTreasuryDebts.get(memberId) ?? 0

  // Peer debt owed by this member to creditors
  const memberClaims = claims.filter((c) => c.debtorMemberId === memberId)
  const peerReceivableDebtPaise = memberClaims.reduce((sum, c) => sum + c.claimAmountPaise, 0)

  // 4. Confirmed P2P repayments made by this member
  const confirmedP2PRepaymentsPaise = settlements
    .filter(
      (s) =>
        s.obligationId === obligation.id &&
        s.debtorMemberId === memberId &&
        s.status === 'confirmed'
    )
    .reduce((sum, s) => sum + s.amountPaise, 0)

  // 5. Actionable Net Balances (Mutually Exclusive Breakdown)
  const unpaidProviderSharePaise = Math.max(
    0,
    baseSharePaise -
      confirmedAllocatedPaise -
      personalPaymentOwnSharePaise -
      treasuryAdvanceAttributedPaise -
      peerReceivableDebtPaise
  )

  const owedToHomeFundPaise = treasuryAdvanceAttributedPaise
  const owedToCreditorsPaise = Math.max(0, peerReceivableDebtPaise - confirmedP2PRepaymentsPaise)
  const totalOutstandingPaise = unpaidProviderSharePaise + owedToHomeFundPaise + owedToCreditorsPaise

  return {
    memberId,
    baseSharePaise,
    confirmedAllocatedPaise,
    personalPaymentOwnSharePaise,
    treasuryAdvanceAttributedPaise,
    peerReceivableDebtPaise,
    confirmedP2PRepaymentsPaise,
    unpaidProviderSharePaise,
    owedToHomeFundPaise,
    owedToCreditorsPaise,
    totalOutstandingPaise,
  }
}

/**
 * Derives creditor-specific peer claim summaries for a creditor on an obligation.
 */
export function deriveCreditorClaimSummaries(
  creditorMemberId: string,
  obligationId: string,
  claims: DerivedPeerClaim[],
  settlements: MemberSettlementRecord[]
): CreditorPeerClaimSummary[] {
  const creditorClaims = claims.filter(
    (c) => c.obligationId === obligationId && c.creditorMemberId === creditorMemberId
  )

  return creditorClaims.map((claim) => {
    const confirmedRepaidPaise = settlements
      .filter((s) => s.claimId === claim.id && s.status === 'confirmed')
      .reduce((sum, s) => sum + s.amountPaise, 0)

    const pendingRepaidPaise = settlements
      .filter((s) => s.claimId === claim.id && s.status === 'pending_confirmation')
      .reduce((sum, s) => sum + s.amountPaise, 0)

    const remainingClaimPaise = Math.max(0, claim.claimAmountPaise - confirmedRepaidPaise)

    return {
      claimId: claim.id,
      expenseId: claim.expenseId,
      obligationId: claim.obligationId,
      creditorMemberId: claim.creditorMemberId,
      debtorMemberId: claim.debtorMemberId,
      claimAmountPaise: claim.claimAmountPaise,
      confirmedRepaidPaise,
      pendingRepaidPaise,
      remainingClaimPaise,
    }
  })
}

/**
 * Derives full obligation reconciliation summary.
 */
export function deriveObligationReconciliationSummary(
  obligation: FinancialObligation,
  allocations: ObligationContributionAllocation[],
  contributions: FundContribution[],
  providerExpenses: ExpenseItem[],
  settlements: MemberSettlementRecord[]
): ObligationReconciliationSummary {
  const memberSummaries = obligation.shares.map((s) =>
    deriveMemberObligationSummary(
      s.memberId,
      obligation,
      allocations,
      contributions,
      providerExpenses,
      settlements
    )
  )

  const providerPaidPaise = providerExpenses
    .filter(
      (e) =>
        e.linkedObligationId === obligation.id &&
        e.disbursementStatus === 'disbursed' &&
        !e.isVoided
    )
    .reduce((sum, e) => sum + e.amountPaise, 0)

  const providerRemainingPaise = obligation.isVoided
    ? 0
    : Math.max(0, obligation.totalAmountPaise - providerPaidPaise)

  const providerPaymentStatus: ProviderPaymentStatus =
    providerPaidPaise >= obligation.totalAmountPaise
      ? 'paid'
      : providerPaidPaise > 0
        ? 'partially_paid'
        : 'unpaid'

  const { validAllocationsTotalPaise, treasuryAdvancePaise } = calculateTreasuryAdvance(
    obligation.id,
    providerExpenses,
    contributions,
    allocations
  )

  const totalPersonalDisbursedPaise = providerExpenses
    .filter(
      (e) =>
        e.linkedObligationId === obligation.id &&
        e.disbursementStatus === 'disbursed' &&
        e.disbursementChannel === 'member_out_of_pocket' &&
        !e.isVoided
    )
    .reduce((sum, e) => sum + e.amountPaise, 0)

  const { claims } = derivePeerClaims(
    obligation,
    providerExpenses,
    allocations,
    contributions
  )

  const totalPeerClaimsPaise = claims.reduce((sum, c) => sum + c.claimAmountPaise, 0)

  const totalPeerSettlementsConfirmedPaise = settlements
    .filter((s) => s.obligationId === obligation.id && s.status === 'confirmed')
    .reduce((sum, s) => sum + s.amountPaise, 0)

  let status: ObligationStatus = 'active'
  if (obligation.isVoided) {
    status = 'voided'
  } else if (providerPaymentStatus === 'paid' && memberSummaries.every((m) => m.totalOutstandingPaise === 0)) {
    status = 'completed'
  } else if (providerPaymentStatus === 'paid') {
    status = 'paid_to_provider'
  } else if (validAllocationsTotalPaise >= obligation.totalAmountPaise) {
    status = 'fully_funded'
  } else if (validAllocationsTotalPaise > 0) {
    status = 'partially_funded'
  }

  return {
    obligationId: obligation.id,
    totalAmountPaise: obligation.totalAmountPaise,
    providerPaidPaise,
    providerRemainingPaise,
    providerPaymentStatus,
    totalAllocatedContributionsPaise: validAllocationsTotalPaise,
    treasuryAdvancePaise,
    totalPersonalDisbursedPaise,
    totalPeerClaimsPaise,
    totalPeerSettlementsConfirmedPaise,
    status,
    memberSummaries,
  }
}

/* ==========================================================================
   7. Corrections and Voiding
   ========================================================================== */

/**
 * Corrects an obligation's total amount or share distribution non-destructively.
 */
export function correctFinancialObligation(
  obligation: FinancialObligation,
  newTotalAmountPaise: number,
  newShares: ObligationParticipantShare[],
  reason: string,
  correctedByMembershipId: string,
  members: HouseholdMember[],
  correctedAt?: string
): { updatedObligation: FinancialObligation; correctionRecord: ObligationCorrectionRecord } {
  if (obligation.isVoided) {
    throw new Error('Cannot correct a voided obligation.')
  }

  const shareCheck = validateObligationShares(
    newTotalAmountPaise,
    newShares,
    members,
    obligation.category
  )
  if (!shareCheck.isValid) {
    throw new Error(`Correction share validation failed: ${shareCheck.errorMessage}`)
  }

  const record: ObligationCorrectionRecord = {
    id: generateEntityId('corr-ob'),
    obligationId: obligation.id,
    correctionType:
      newTotalAmountPaise !== obligation.totalAmountPaise ? 'amount_corrected' : 'shares_reallocated',
    previousTotalPaise: obligation.totalAmountPaise,
    newTotalPaise: newTotalAmountPaise,
    previousShares: [...obligation.shares],
    newShares: [...newShares],
    reason: reason.trim(),
    correctedByMembershipId,
    correctedAt: correctedAt ?? new Date().toISOString(),
  }

  const updatedObligation: FinancialObligation = {
    ...obligation,
    totalAmountPaise: newTotalAmountPaise,
    totalAmount: paiseToRupees(newTotalAmountPaise),
    shares: newShares,
    correctionHistory: [...(obligation.correctionHistory ?? []), record],
  }

  return { updatedObligation, correctionRecord: record }
}

/**
 * Voids an obligation non-destructively, preserving historical base shares.
 */
export function voidFinancialObligation(
  obligation: FinancialObligation,
  reason: string,
  voidedByMembershipId: string,
  voidedAt?: string
): FinancialObligation {
  const record: ObligationCorrectionRecord = {
    id: generateEntityId('corr-ob-void'),
    obligationId: obligation.id,
    correctionType: 'voided',
    previousTotalPaise: obligation.totalAmountPaise,
    newTotalPaise: 0,
    previousShares: [...obligation.shares],
    newShares: [...obligation.shares], // Stored base shares are preserved for historical audit!
    reason: reason.trim(),
    correctedByMembershipId: voidedByMembershipId,
    correctedAt: voidedAt ?? new Date().toISOString(),
  }

  return {
    ...obligation,
    isVoided: true,
    voidReason: reason.trim(),
    voidedByMembershipId,
    voidedAt: voidedAt ?? new Date().toISOString(),
    correctionHistory: [...(obligation.correctionHistory ?? []), record],
  }
}

/* ==========================================================================
   8. Notification Event Derivation
   ========================================================================== */

/**
 * Pure generator for deterministic member notification items.
 */
export function deriveObligationNotifications(params: {
  obligation: FinancialObligation
  allocations: ObligationContributionAllocation[]
  contributions: FundContribution[]
  providerExpenses: ExpenseItem[]
  settlements: MemberSettlementRecord[]
  claims: DerivedPeerClaim[]
  todayDate?: string
}): MemberNotificationItem[] {
  const { obligation, providerExpenses, settlements, claims } = params
  const today = params.todayDate ?? getTodayCalendarDate()
  const notifications: MemberNotificationItem[] = []

  // 1. Share assigned notification for all participants
  for (const s of obligation.shares) {
    notifications.push({
      id: `notif-share_assigned-${obligation.id}-${s.memberId}-v${obligation.correctionHistory?.length ?? 0}`,
      idempotencyKey: `notif-share_assigned-${obligation.id}-${s.memberId}-v${obligation.correctionHistory?.length ?? 0}`,
      recipientMemberId: s.memberId,
      eventType: 'share_assigned',
      obligationId: obligation.id,
      obligationTitle: obligation.title,
      obligationCategory: obligation.category,
      relevantAmountPaise: s.sharePaise,
      dueDate: obligation.dueDate,
      createdAt: obligation.createdAt,
      message: `You have been assigned a share of ₹${paiseToRupees(s.sharePaise)} for ${obligation.title}, due on ${obligation.dueDate}.`,
      sourceEntityId: obligation.id,
    })
  }

  // 2. Provider payment notifications
  for (const exp of providerExpenses.filter((e) => e.linkedObligationId === obligation.id && !e.isVoided)) {
    const isTreasury = exp.disbursementChannel !== 'member_out_of_pocket'
    const eventType: NotificationEventType = isTreasury ? 'provider_paid_treasury' : 'provider_paid_personal'
    for (const s of obligation.shares) {
      notifications.push({
        id: `notif-${eventType}-${exp.id}-${s.memberId}`,
        idempotencyKey: `notif-${eventType}-${exp.id}-${s.memberId}`,
        recipientMemberId: s.memberId,
        eventType,
        obligationId: obligation.id,
        obligationTitle: obligation.title,
        obligationCategory: obligation.category,
        relevantAmountPaise: exp.amountPaise,
        createdAt: exp.date,
        message: isTreasury
          ? `₹${paiseToRupees(exp.amountPaise)} was paid to ${obligation.providerName} from Home Fund for ${obligation.title}.`
          : `${exp.paidBy} paid ₹${paiseToRupees(exp.amountPaise)} directly to ${obligation.providerName} for ${obligation.title}.`,
        sourceEntityId: exp.id,
      })
    }
  }

  // 3. Peer claims notifications (to debtor and creditor)
  for (const claim of claims.filter((c) => c.obligationId === obligation.id)) {
    notifications.push({
      id: `notif-personal_creditor_claim-${claim.id}-${claim.debtorMemberId}`,
      idempotencyKey: `notif-personal_creditor_claim-${claim.id}-${claim.debtorMemberId}`,
      recipientMemberId: claim.debtorMemberId,
      eventType: 'personal_creditor_claim',
      obligationId: obligation.id,
      obligationTitle: obligation.title,
      obligationCategory: obligation.category,
      relevantAmountPaise: claim.claimAmountPaise,
      createdAt: claim.createdAt,
      message: `You owe ₹${paiseToRupees(claim.claimAmountPaise)} to roommate for out-of-pocket payment on ${obligation.title}.`,
      sourceEntityId: claim.id,
    })
  }

  // 4. P2P settlement status notifications
  for (const settle of settlements.filter((s) => s.obligationId === obligation.id)) {
    if (settle.status === 'pending_confirmation') {
      notifications.push({
        id: `notif-p2p_claim_submitted-${settle.id}-${settle.creditorMemberId}`,
        idempotencyKey: `notif-p2p_claim_submitted-${settle.id}-${settle.creditorMemberId}`,
        recipientMemberId: settle.creditorMemberId,
        eventType: 'p2p_claim_submitted',
        obligationId: obligation.id,
        obligationTitle: obligation.title,
        obligationCategory: obligation.category,
        relevantAmountPaise: settle.amountPaise,
        createdAt: settle.submittedAt,
        message: `Roommate submitted a reimbursement of ₹${paiseToRupees(settle.amountPaise)} for ${obligation.title}. Please confirm receipt.`,
        sourceEntityId: settle.id,
      })
    } else if (settle.status === 'confirmed') {
      notifications.push({
        id: `notif-p2p_claim_confirmed-${settle.id}-${settle.debtorMemberId}`,
        idempotencyKey: `notif-p2p_claim_confirmed-${settle.id}-${settle.debtorMemberId}`,
        recipientMemberId: settle.debtorMemberId,
        eventType: 'p2p_claim_confirmed',
        obligationId: obligation.id,
        obligationTitle: obligation.title,
        obligationCategory: obligation.category,
        relevantAmountPaise: settle.amountPaise,
        createdAt: settle.confirmedAt ?? settle.submittedAt,
        message: `Your reimbursement of ₹${paiseToRupees(settle.amountPaise)} for ${obligation.title} was confirmed by the creditor.`,
        sourceEntityId: settle.id,
      })
    } else if (settle.status === 'rejected') {
      notifications.push({
        id: `notif-p2p_claim_rejected-${settle.id}-${settle.debtorMemberId}`,
        idempotencyKey: `notif-p2p_claim_rejected-${settle.id}-${settle.debtorMemberId}`,
        recipientMemberId: settle.debtorMemberId,
        eventType: 'p2p_claim_rejected',
        obligationId: obligation.id,
        obligationTitle: obligation.title,
        obligationCategory: obligation.category,
        relevantAmountPaise: settle.amountPaise,
        createdAt: settle.rejectedAt ?? settle.submittedAt,
        message: `Your reimbursement of ₹${paiseToRupees(settle.amountPaise)} was rejected: "${settle.rejectionReason}".`,
        sourceEntityId: settle.id,
      })
    }
  }

  // 5. Due date approaching notifications (within 3 days of due date)
  if (!obligation.isVoided && obligation.dueDate >= today) {
    const diffDays = Math.round((new Date(obligation.dueDate).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays >= 0 && diffDays <= 3) {
      for (const s of obligation.shares) {
        notifications.push({
          id: `notif-due_date_approaching-${obligation.id}-${s.memberId}-${obligation.dueDate}`,
          idempotencyKey: `notif-due_date_approaching-${obligation.id}-${s.memberId}-${obligation.dueDate}`,
          recipientMemberId: s.memberId,
          eventType: 'due_date_approaching',
          obligationId: obligation.id,
          obligationTitle: obligation.title,
          obligationCategory: obligation.category,
          relevantAmountPaise: s.sharePaise,
          dueDate: obligation.dueDate,
          createdAt: today,
          message: `${obligation.title} is due in ${diffDays} day(s) on ${obligation.dueDate}.`,
          sourceEntityId: obligation.id,
        })
      }
    }
  }

  return notifications
}

/* ==========================================================================
   9. Root Financial State Reducer & Pure Selectors (Stage 6 Step 2.2)
   ========================================================================== */

/**
 * Calculates current liquid balance for a Treasury account in integer paise.
 */
export function calculateAccountLiquidBalance(
  state: RootFinancialState,
  accountId: string
): number {
  // Confirmed inflows into this account
  const inflowsPaise = state.contributions
    .filter(
      (c) =>
        c.accountId === accountId &&
        c.status === 'confirmed' &&
        !c.isVoided &&
        !c.isRefundAdjustment
    )
    .reduce((sum, c) => sum + Math.round(c.amount * 100), 0)

  // Confirmed refund adjustments out of this account
  const refundOutflowsPaise = state.contributions
    .filter(
      (c) =>
        c.accountId === accountId &&
        c.status === 'confirmed' &&
        !c.isVoided &&
        c.isRefundAdjustment === true
    )
    .reduce((sum, c) => sum + Math.round(c.amount * 100), 0)

  // Confirmed transfers into this account (pending, rejected, or voided transfers are EXCLUDED)
  const transfersInPaise = (state.transfers ?? [])
    .filter((t) => t.toAccountId === accountId && t.status === 'confirmed')
    .reduce((sum, t) => sum + Math.round(t.amount * 100), 0)

  // Confirmed transfers out of this account (pending, rejected, or voided transfers are EXCLUDED)
  const transfersOutPaise = (state.transfers ?? [])
    .filter((t) => t.fromAccountId === accountId && t.status === 'confirmed')
    .reduce((sum, t) => sum + Math.round(t.amount * 100), 0)

  // Disbursed expenses paid out of this treasury account
  const expenseOutflowsPaise = state.expenses
    .filter(
      (e) =>
        e.disbursedFromAccountId === accountId &&
        e.disbursementStatus === 'disbursed' &&
        e.disbursementChannel !== 'member_out_of_pocket' &&
        !e.isVoided
    )
    .reduce((sum, e) => sum + e.amountPaise, 0)

  return inflowsPaise - refundOutflowsPaise + transfersInPaise - transfersOutPaise - expenseOutflowsPaise
}

/**
 * Calculates available peer credit balance in integer paise.
 */
export function getAvailablePeerCreditPaise(
  state: RootFinancialState,
  peerCreditId: string
): number {
  const credit = state.peerCredits.find((c) => c.id === peerCreditId)
  if (!credit) return 0

  const initialExcess = credit.initialExcessPaise

  const expansions = state.peerCreditExpansions
    .filter((e) => e.peerCreditId === peerCreditId)
    .reduce((sum, e) => sum + e.expansionAmountPaise, 0)

  const extinguishments = state.peerCreditExtinguishments
    .filter((e) => e.peerCreditId === peerCreditId)
    .reduce((sum, e) => sum + e.extinguishedPaise, 0)

  const restorations = state.peerCreditRestorationOffsets
    .filter((r) => r.peerCreditId === peerCreditId)
    .reduce((sum, r) => sum + r.restoredPaise, 0)

  const settlementReversalReductions = state.peerCreditSettlementReversalAdjustments
    .filter((a) => a.peerCreditId === peerCreditId)
    .reduce((sum, a) => sum + a.reductionPaise, 0)

  const settlementReversalRestorations = state.peerCreditSettlementReversalAdjustmentRestorations
    .filter((r) => r.peerCreditId === peerCreditId)
    .reduce((sum, r) => sum + r.restoredPaise, 0)

  const resolutions = state.peerCreditResolutions
    .filter((r) => r.peerCreditId === peerCreditId)
    .reduce((sum, r) => sum + r.resolvedAmountPaise, 0)

  const resolutionReversals = state.peerCreditResolutionReversals
    .filter((rr) => rr.peerCreditId === peerCreditId)
    .reduce((sum, rr) => sum + rr.reversalAmountPaise, 0)

  const net =
    initialExcess +
    expansions -
    extinguishments +
    restorations -
    settlementReversalReductions +
    settlementReversalRestorations -
    resolutions +
    resolutionReversals

  return Math.max(0, net)
}

/**
 * Deterministically calculates chronological FIFO allocation of confirmed settlements
 * against a specific peer claim liability.
 */
export function calculateClaimFIFOAllocations(
  state: RootFinancialState,
  claimId: string
): {
  claimId: string
  claimAmountPaise: number
  totalEffectiveSettledPaise: number
  allocatedToClaimPaise: number
  excessPaise: number
  settlementAllocations: {
    settlementId: string
    effectiveAmountPaise: number
    allocatedToClaimPaise: number
    excessPaise: number
  }[]
} {
  const claim = state.peerClaims.find((c) => c.id === claimId)
  const claimAmountPaise = claim?.claimAmountPaise ?? 0

  // Find all confirmed settlements for this claim
  const settlements = state.memberSettlements
    .filter((s) => s.claimId === claimId && s.status === 'confirmed')
    .sort((a, b) => {
      const timeDiff = (a.confirmedAt ?? a.submittedAt).localeCompare(b.confirmedAt ?? b.submittedAt)
      if (timeDiff !== 0) return timeDiff
      return a.id.localeCompare(b.id)
    })

  let remainingClaimLiability = claimAmountPaise
  let totalEffectiveSettledPaise = 0
  let totalAllocatedToClaimPaise = 0

  const settlementAllocations = settlements.map((s) => {
    // Effective amount of this settlement accounting for reversals and reversal-of-reversals
    const reversals = state.memberSettlementReversals
      .filter((r) => r.settlementId === s.id)
      .reduce((sum, r) => sum + r.reversalAmountPaise, 0)

    const reversalOfReversals = state.memberSettlementReversalOfReversals
      .filter((rr) => rr.settlementId === s.id)
      .reduce((sum, rr) => sum + rr.restoredAmountPaise, 0)

    const effectiveAmountPaise = Math.max(0, s.amountPaise - reversals + reversalOfReversals)
    totalEffectiveSettledPaise += effectiveAmountPaise

    const allocatedToClaimPaise = Math.min(remainingClaimLiability, effectiveAmountPaise)
    remainingClaimLiability = Math.max(0, remainingClaimLiability - allocatedToClaimPaise)
    totalAllocatedToClaimPaise += allocatedToClaimPaise

    const excessPaise = effectiveAmountPaise - allocatedToClaimPaise

    return {
      settlementId: s.id,
      effectiveAmountPaise,
      allocatedToClaimPaise,
      excessPaise,
    }
  })

  return {
    claimId,
    claimAmountPaise,
    totalEffectiveSettledPaise,
    allocatedToClaimPaise: totalAllocatedToClaimPaise,
    excessPaise: Math.max(0, totalEffectiveSettledPaise - claimAmountPaise),
    settlementAllocations,
  }
}

/**
 * Derives order-independent member debt classification and excess creditor reimbursement.
 * Enforces:
 *   unpaidObligationSharePaise = max(0, L_current - EffectiveSettledAllocatedToClaim)
 *   unbackedRefundLiabilityPaise = max(0, NetRefundsReceived - AuthoritativeLegitimateExcess)
 *   AuthoritativeLegitimateExcess = max(0, EffectiveSettledTotal - L_current)
 *   TotalOutstanding = unpaidObligationSharePaise + unbackedRefundLiabilityPaise
 *   Equivalent: TotalOutstanding = L_current - (EffectiveSettledTotal - NetRefundsReceived)
 */
export function deriveOrderIndependentMemberDebt(
  state: RootFinancialState,
  obligationId: string,
  memberId: string
): OrderIndependentMemberDebtResult {
  const obligation = state.obligations.find((o) => o.id === obligationId)
  const isVoided = obligation?.isVoided ?? false
  const share = obligation?.shares.find((s) => s.memberId === memberId)
  const currentObligationSharePaise = isVoided ? 0 : (share?.sharePaise ?? 0)

  // 1. Effective settled across confirmed settlements on this obligation
  const memberSettlements = state.memberSettlements.filter(
    (s) => s.obligationId === obligationId && s.debtorMemberId === memberId && s.status === 'confirmed'
  )

  let grossSettledPaise = 0
  let reversalsPaise = 0
  let reversalOfReversalsPaise = 0

  for (const s of memberSettlements) {
    grossSettledPaise += s.amountPaise
    const revs = state.memberSettlementReversals
      .filter((r) => r.settlementId === s.id)
      .reduce((sum, r) => sum + r.reversalAmountPaise, 0)
    reversalsPaise += revs

    const rrs = state.memberSettlementReversalOfReversals
      .filter((rr) => rr.settlementId === s.id)
      .reduce((sum, rr) => sum + rr.restoredAmountPaise, 0)
    reversalOfReversalsPaise += rrs
  }

  const effectiveSettledTotalPaise = Math.max(
    0,
    grossSettledPaise - reversalsPaise + reversalOfReversalsPaise
  )

  // 2. FIFO allocated to claim vs legitimate excess
  const effectiveSettledAllocatedToClaimPaise = Math.min(
    currentObligationSharePaise,
    effectiveSettledTotalPaise
  )
  const authoritativeLegitimateExcessPaise = Math.max(
    0,
    effectiveSettledTotalPaise - currentObligationSharePaise
  )

  // 3. Refunds received (peer credit cash refund resolutions) and repayments
  const debtorCredits = state.peerCredits.filter(
    (pc) => pc.obligationId === obligationId && pc.debtorMemberId === memberId
  )
  const creditIds = new Set(debtorCredits.map((pc) => pc.id))

  const cashResolutions = state.peerCreditResolutions.filter(
    (r) => creditIds.has(r.peerCreditId) && r.resolutionType === 'cash_refund'
  )
  const grossRefundsReceivedPaise = cashResolutions.reduce(
    (sum, r) => sum + r.resolvedAmountPaise,
    0
  )

  const resIds = new Set(cashResolutions.map((r) => r.id))
  const resolutionReversals = state.peerCreditResolutionReversals.filter((rr) =>
    resIds.has(rr.resolutionId)
  )
  const refundRepaymentsPaise = resolutionReversals.reduce(
    (sum, rr) => sum + rr.reversalAmountPaise,
    0
  )

  const netRefundsReceivedPaise = Math.max(0, grossRefundsReceivedPaise - refundRepaymentsPaise)

  // 4. Order-Independent Debt Classifications
  const unpaidObligationSharePaise = Math.max(
    0,
    currentObligationSharePaise - effectiveSettledAllocatedToClaimPaise
  )
  const unbackedRefundLiabilityPaise = Math.max(
    0,
    netRefundsReceivedPaise - authoritativeLegitimateExcessPaise
  )
  const totalOutstandingPaise = unpaidObligationSharePaise + unbackedRefundLiabilityPaise

  // 5. Excess Creditor Reimbursement Due (Creditor owes Debtor)
  const excessCreditorReimbursementDuePaise = Math.max(
    0,
    authoritativeLegitimateExcessPaise - netRefundsReceivedPaise
  )

  return {
    memberId,
    obligationId,
    currentObligationSharePaise,
    effectiveSettledTotalPaise,
    effectiveSettledAllocatedToClaimPaise,
    authoritativeLegitimateExcessPaise,
    grossRefundsReceivedPaise,
    refundRepaymentsPaise,
    netRefundsReceivedPaise,
    unpaidObligationSharePaise,
    unbackedRefundLiabilityPaise,
    totalOutstandingPaise,
    excessCreditorReimbursementDuePaise,
  }
}

/**
 * Root Centralized Financial State Reducer for Stage 6.
 * Pure state transition mechanism enforcing atomic validation and zero-stale calculations.
 */
export function financialStateReducer(
  state: RootFinancialState,
  action: FinancialAction
): FinancialActionResult {
  // Idempotency check: if action has an actionId that was already processed, return current state
  if (action.actionId && state.processedActionIds.includes(action.actionId)) {
    return {
      success: true,
      state,
      message: `Action "${action.actionId}" has already been processed (idempotent).`,
    }
  }

  const markProcessed = (nextState: RootFinancialState, msg?: string): FinancialActionResult => {
    if (action.actionId) {
      return {
        success: true,
        state: {
          ...nextState,
          processedActionIds: [...nextState.processedActionIds, action.actionId],
        },
        message: msg,
      }
    }
    return { success: true, state: nextState, message: msg }
  }

  switch (action.type) {
    case 'SUBMIT_CONTRIBUTION': {
      const { contribution } = action.payload
      if (!contribution || contribution.amount <= 0) {
        return { success: false, error: 'Contribution amount must be greater than zero.' }
      }
      const account = state.accounts.find((a) => a.id === contribution.accountId)
      if (!account || !account.isActive) {
        return { success: false, error: `Account "${contribution.accountId}" does not exist or is inactive.` }
      }
      // Check duplicate contribution ID
      if (state.contributions.some((c) => c.id === contribution.id)) {
        return { success: false, error: `Contribution with ID "${contribution.id}" already exists.` }
      }
      const newContribution: FundContribution = {
        ...contribution,
        status: 'pending_confirmation',
      }
      return markProcessed({
        ...state,
        contributions: [newContribution, ...state.contributions],
      })
    }

    case 'CONFIRM_CONTRIBUTION': {
      const { contributionId, confirmedByMembershipId, confirmedByName, confirmedAt, allocation } =
        action.payload
      const contribution = state.contributions.find((c) => c.id === contributionId)
      if (!contribution) {
        return { success: false, error: `Contribution "${contributionId}" not found.` }
      }
      if (contribution.status === 'confirmed') {
        // Idempotent confirmation
        return markProcessed(state, 'Contribution already confirmed.')
      }
      if (contribution.status !== 'pending_confirmation') {
        return {
          success: false,
          error: `Cannot confirm contribution with status "${contribution.status}". Must be "pending_confirmation".`,
        }
      }

      const confirmedTime = confirmedAt ?? new Date().toISOString()
      const updatedContribution: FundContribution = {
        ...contribution,
        status: 'confirmed',
        confirmedByMembershipId,
        confirmedByName,
        confirmedAt: confirmedTime,
      }

      let updatedAllocations = [...state.allocations]

      if (allocation) {
        const obligation = state.obligations.find((o) => o.id === allocation.obligationId)
        if (!obligation || obligation.isVoided) {
          return { success: false, error: `Obligation "${allocation.obligationId}" not found or voided.` }
        }
        const memberShare = obligation.shares.find((s) => s.memberId === allocation.targetMemberId)
        if (!memberShare) {
          return {
            success: false,
            error: `Target member "${allocation.targetMemberId}" is not a participant in obligation "${obligation.id}".`,
          }
        }
        if (allocation.amountPaise <= 0 || !Number.isInteger(allocation.amountPaise)) {
          return { success: false, error: 'Allocation amount must be a positive integer in paise.' }
        }

        const contributionPaiseCapacity = Math.round(contribution.amount * 100)
        const existingAllocated = state.allocations
          .filter((a) => a.contributionId === contributionId && !a.isVoided)
          .reduce((sum, a) => sum + a.amountPaise, 0)
        if (existingAllocated + allocation.amountPaise > contributionPaiseCapacity) {
          return {
            success: false,
            error: `Allocation (${allocation.amountPaise}p) exceeds contribution unallocated balance (${contributionPaiseCapacity - existingAllocated}p).`,
          }
        }

        const existingMemberAllocated = state.allocations
          .filter(
            (a) =>
              a.obligationId === allocation.obligationId &&
              a.targetMemberId === allocation.targetMemberId &&
              !a.isVoided
          )
          .reduce((sum, a) => sum + a.amountPaise, 0)
        if (existingMemberAllocated + allocation.amountPaise > memberShare.sharePaise) {
          return {
            success: false,
            error: `Allocation exceeds member share ceiling (${memberShare.sharePaise}p). Current allocated: ${existingMemberAllocated}p.`,
          }
        }

        const newAlloc: ObligationContributionAllocation = {
          id: allocation.id ?? generateEntityId('alloc'),
          contributionId,
          obligationId: allocation.obligationId,
          targetMemberId: allocation.targetMemberId,
          amountPaise: allocation.amountPaise,
          allocatedAt: allocation.allocatedAt ?? confirmedTime,
          allocatedByMembershipId: allocation.allocatedByMembershipId,
        }
        updatedAllocations.push(newAlloc)
      }

      return markProcessed({
        ...state,
        contributions: state.contributions.map((c) =>
          c.id === contributionId ? updatedContribution : c
        ),
        allocations: updatedAllocations,
      })
    }

    case 'REJECT_CONTRIBUTION': {
      const { contributionId, rejectedByMembershipId, rejectionReason, rejectedAt } = action.payload
      const contribution = state.contributions.find((c) => c.id === contributionId)
      if (!contribution) {
        return { success: false, error: `Contribution "${contributionId}" not found.` }
      }
      if (contribution.status === 'rejected') {
        return markProcessed(state, 'Contribution already rejected.')
      }
      if (contribution.status !== 'pending_confirmation') {
        return {
          success: false,
          error: `Cannot reject contribution with status "${contribution.status}". Must be "pending_confirmation".`,
        }
      }

      const updatedContribution: FundContribution = {
        ...contribution,
        status: 'rejected',
        confirmedByMembershipId: rejectedByMembershipId,
        rejectionReason,
        confirmedAt: rejectedAt ?? new Date().toISOString(),
      }

      return markProcessed({
        ...state,
        contributions: state.contributions.map((c) =>
          c.id === contributionId ? updatedContribution : c
        ),
      })
    }

    case 'DISBURSE_TREASURY_PROVIDER_PAYMENT': {
      const { expense, obligationId } = action.payload
      const obligation = state.obligations.find((o) => o.id === obligationId)
      if (!obligation || obligation.isVoided) {
        return { success: false, error: `Obligation "${obligationId}" not found or voided.` }
      }
      if (expense.amountPaise <= 0 || !Number.isInteger(expense.amountPaise)) {
        return { success: false, error: 'Payment amount must be a positive integer in paise.' }
      }
      if (!expense.disbursedFromAccountId) {
        return { success: false, error: 'Treasury provider payment must specify disbursedFromAccountId.' }
      }
      const account = state.accounts.find((a) => a.id === expense.disbursedFromAccountId)
      if (!account || !account.isActive) {
        return {
          success: false,
          error: `Treasury account "${expense.disbursedFromAccountId}" not found or inactive.`,
        }
      }
      if (expense.disbursementChannel === 'member_out_of_pocket') {
        return {
          success: false,
          error: 'Personal out-of-pocket provider payment cannot debit Treasury account.',
        }
      }

      // Check current liquid balance of treasury account
      const liquidBalancePaise = calculateAccountLiquidBalance(state, account.id)
      if (liquidBalancePaise < expense.amountPaise) {
        return {
          success: false,
          error: `Insufficient Treasury balance in account "${account.name}". Available: ${liquidBalancePaise}p, Requested: ${expense.amountPaise}p. Overdraft prevented.`,
        }
      }

      // Check remaining obligation provider payment limit
      const alreadyPaidPaise = state.expenses
        .filter(
          (e) =>
            e.linkedObligationId === obligationId &&
            e.disbursementStatus === 'disbursed' &&
            !e.isVoided
        )
        .reduce((sum, e) => sum + e.amountPaise, 0)

      if (alreadyPaidPaise + expense.amountPaise > obligation.totalAmountPaise) {
        return {
          success: false,
          error: `Payment of ${expense.amountPaise}p exceeds remaining provider bill capacity (${obligation.totalAmountPaise - alreadyPaidPaise}p).`,
        }
      }

      // Record provider payment expense with splits: [] and participantMemberIds: []
      // ensuring compatibility with Treasury calculations and zero-leakage into household splits
      const committedExpense: ExpenseItem = {
        ...expense,
        linkedObligationId: obligationId,
        disbursementStatus: 'disbursed',
        splits: [],
        participantMemberIds: [],
      }

      return markProcessed({
        ...state,
        expenses: [...state.expenses, committedExpense],
      })
    }

    case 'CREATE_CONTRIBUTION_ALLOCATION': {
      const { allocation } = action.payload
      const parent = state.contributions.find((c) => c.id === allocation.contributionId)
      if (!parent || parent.status !== 'confirmed' || parent.isVoided || parent.isRefundAdjustment) {
        return {
          success: false,
          error: `Cannot allocate unconfirmed, voided, or refund contribution "${allocation.contributionId}".`,
        }
      }
      const obligation = state.obligations.find((o) => o.id === allocation.obligationId)
      if (!obligation || obligation.isVoided) {
        return { success: false, error: `Obligation "${allocation.obligationId}" not found or voided.` }
      }
      const memberShare = obligation.shares.find((s) => s.memberId === allocation.targetMemberId)
      if (!memberShare) {
        return {
          success: false,
          error: `Member "${allocation.targetMemberId}" is not a participant in obligation "${obligation.id}".`,
        }
      }
      if (allocation.amountPaise <= 0 || !Number.isInteger(allocation.amountPaise)) {
        return { success: false, error: 'Allocation amount must be a positive integer in paise.' }
      }

      const parentCapacity = Math.round(parent.amount * 100)
      const existingAllocated = state.allocations
        .filter((a) => a.contributionId === allocation.contributionId && !a.isVoided)
        .reduce((sum, a) => sum + a.amountPaise, 0)
      if (existingAllocated + allocation.amountPaise > parentCapacity) {
        return {
          success: false,
          error: `Allocation (${allocation.amountPaise}p) exceeds contribution remaining capacity (${parentCapacity - existingAllocated}p).`,
        }
      }

      const existingMemberAllocated = state.allocations
        .filter(
          (a) =>
            a.obligationId === allocation.obligationId &&
            a.targetMemberId === allocation.targetMemberId &&
            !a.isVoided
        )
        .reduce((sum, a) => sum + a.amountPaise, 0)
      if (existingMemberAllocated + allocation.amountPaise > memberShare.sharePaise) {
        return {
          success: false,
          error: `Allocation exceeds target member share ceiling (${memberShare.sharePaise}p). Current allocated: ${existingMemberAllocated}p.`,
        }
      }

      return markProcessed({
        ...state,
        allocations: [...state.allocations, allocation],
      })
    }

    case 'VOID_CONTRIBUTION_ALLOCATION': {
      const { allocationId, voidReason, voidedByMembershipId, voidedAt } = action.payload
      const target = state.allocations.find((a) => a.id === allocationId)
      if (!target) {
        return { success: false, error: `Allocation "${allocationId}" not found.` }
      }
      if (target.isVoided) {
        return markProcessed(state, 'Allocation already voided.')
      }

      const updated = {
        ...target,
        isVoided: true,
        voidReason,
        voidedByMembershipId,
        voidedAt: voidedAt ?? new Date().toISOString(),
      }

      return markProcessed({
        ...state,
        allocations: state.allocations.map((a) => (a.id === allocationId ? updated : a)),
      })
    }

    case 'SUBMIT_MEMBER_SETTLEMENT': {
      const { settlement } = action.payload
      const claim = state.peerClaims.find((c) => c.id === settlement.claimId)
      if (!claim) {
        return { success: false, error: `Peer claim "${settlement.claimId}" not found.` }
      }
      const val = validateMemberSettlement(settlement, claim, state.memberSettlements)
      if (!val.isValid) {
        return { success: false, error: val.errorMessage ?? 'Invalid settlement submission.' }
      }

      const pendingSettlement: MemberSettlementRecord = {
        ...settlement,
        status: 'pending_confirmation',
      }

      return markProcessed({
        ...state,
        memberSettlements: [...state.memberSettlements, pendingSettlement],
      })
    }

    case 'CONFIRM_MEMBER_SETTLEMENT': {
      const { settlementId, confirmedByMemberId, confirmedAt, generatedPeerCreditId } = action.payload
      const settlement = state.memberSettlements.find((s) => s.id === settlementId)
      if (!settlement) {
        return { success: false, error: `Settlement "${settlementId}" not found.` }
      }
      if (settlement.status === 'confirmed') {
        return markProcessed(state, 'Settlement already confirmed.')
      }
      if (settlement.status !== 'pending_confirmation') {
        return {
          success: false,
          error: `Cannot confirm settlement with status "${settlement.status}". Must be "pending_confirmation".`,
        }
      }
      if (settlement.creditorMemberId !== confirmedByMemberId) {
        return {
          success: false,
          error: `Only designated creditor "${settlement.creditorMemberId}" can confirm this settlement.`,
        }
      }

      const claim = state.peerClaims.find((c) => c.id === settlement.claimId)
      const claimAmountPaise = claim?.claimAmountPaise ?? 0
      const priorConfirmedPaid = state.memberSettlements
        .filter((s) => s.claimId === settlement.claimId && s.status === 'confirmed' && s.id !== settlementId)
        .reduce((sum, s) => sum + s.amountPaise, 0)

      const remainingClaimCapacity = Math.max(0, claimAmountPaise - priorConfirmedPaid)
      const confirmedTime = confirmedAt ?? new Date().toISOString()

      const updatedSettlement: MemberSettlementRecord = {
        ...settlement,
        status: 'confirmed',
        confirmedByMemberId,
        confirmedAt: confirmedTime,
      }

      let updatedPeerCredits = [...state.peerCredits]

      // If settlement creates excess beyond the claim capacity, generate peer credit
      if (settlement.amountPaise > remainingClaimCapacity) {
        const excessPaise = settlement.amountPaise - remainingClaimCapacity
        const peerCredit: PeerCreditAdjustmentRecord = {
          id: generatedPeerCreditId ?? generateEntityId('peer-credit'),
          obligationId: settlement.obligationId,
          claimId: settlement.claimId,
          settlementId: settlement.id,
          debtorMemberId: settlement.debtorMemberId,
          creditorMemberId: settlement.creditorMemberId,
          initialExcessPaise: excessPaise,
          createdAt: confirmedTime,
        }
        updatedPeerCredits.push(peerCredit)
      }

      return markProcessed({
        ...state,
        memberSettlements: state.memberSettlements.map((s) =>
          s.id === settlementId ? updatedSettlement : s
        ),
        peerCredits: updatedPeerCredits,
      })
    }

    case 'REJECT_MEMBER_SETTLEMENT': {
      const { settlementId, rejectedByMemberId, rejectionReason, rejectedAt } = action.payload
      const settlement = state.memberSettlements.find((s) => s.id === settlementId)
      if (!settlement) {
        return { success: false, error: `Settlement "${settlementId}" not found.` }
      }
      if (settlement.status === 'rejected') {
        return markProcessed(state, 'Settlement already rejected.')
      }
      if (settlement.status !== 'pending_confirmation') {
        return {
          success: false,
          error: `Cannot reject settlement with status "${settlement.status}". Must be "pending_confirmation".`,
        }
      }
      if (settlement.creditorMemberId !== rejectedByMemberId) {
        return {
          success: false,
          error: `Only designated creditor "${settlement.creditorMemberId}" can reject this settlement.`,
        }
      }

      const updatedSettlement: MemberSettlementRecord = {
        ...settlement,
        status: 'rejected',
        rejectedByMemberId,
        rejectionReason,
        rejectedAt: rejectedAt ?? new Date().toISOString(),
      }

      return markProcessed({
        ...state,
        memberSettlements: state.memberSettlements.map((s) =>
          s.id === settlementId ? updatedSettlement : s
        ),
      })
    }

    case 'REVERSE_MEMBER_SETTLEMENT': {
      const { reversal } = action.payload
      const settlement = state.memberSettlements.find((s) => s.id === reversal.settlementId)
      if (!settlement || settlement.status !== 'confirmed') {
        return { success: false, error: `Confirmed settlement "${reversal.settlementId}" not found.` }
      }
      if (reversal.reversalAmountPaise <= 0 || !Number.isInteger(reversal.reversalAmountPaise)) {
        return { success: false, error: 'Reversal amount must be a positive integer in paise.' }
      }

      // Calculate effective remaining amount on this settlement
      const priorReversals = state.memberSettlementReversals
        .filter((r) => r.settlementId === settlement.id)
        .reduce((sum, r) => sum + r.reversalAmountPaise, 0)
      const priorReversalsOfReversal = state.memberSettlementReversalOfReversals
        .filter((rr) => rr.settlementId === settlement.id)
        .reduce((sum, rr) => sum + rr.restoredAmountPaise, 0)

      const effectiveSettled = settlement.amountPaise - priorReversals + priorReversalsOfReversal
      if (reversal.reversalAmountPaise > effectiveSettled) {
        return {
          success: false,
          error: `Reversal amount (${reversal.reversalAmountPaise}p) exceeds net effective settlement (${effectiveSettled}p).`,
        }
      }

      // Check if peer credit was created on this settlement
      const peerCredit = state.peerCredits.find((c) => c.settlementId === settlement.id)
      let updatedSettlementReversalAdjustments = [...state.peerCreditSettlementReversalAdjustments]

      if (peerCredit) {
        const availableCredit = getAvailablePeerCreditPaise(state, peerCredit.id)
        if (availableCredit > 0) {
          const reductionPaise = Math.min(availableCredit, reversal.reversalAmountPaise)
          updatedSettlementReversalAdjustments.push({
            id: generateEntityId('pc-rev-adj'),
            peerCreditId: peerCredit.id,
            reductionPaise,
            settlementReversalId: reversal.id,
            reason: reversal.reason,
            createdAt: reversal.reversedAt,
          })
        }
      }

      return markProcessed({
        ...state,
        memberSettlementReversals: [...state.memberSettlementReversals, reversal],
        peerCreditSettlementReversalAdjustments: updatedSettlementReversalAdjustments,
      })
    }

    case 'REVERSE_SETTLEMENT_REVERSAL': {
      const { reversalOfReversal } = action.payload
      const originalReversal = state.memberSettlementReversals.find(
        (r) => r.id === reversalOfReversal.originalReversalId
      )
      if (!originalReversal) {
        return { success: false, error: `Original reversal "${reversalOfReversal.originalReversalId}" not found.` }
      }
      if (reversalOfReversal.restoredAmountPaise <= 0 || !Number.isInteger(reversalOfReversal.restoredAmountPaise)) {
        return { success: false, error: 'Restored amount must be a positive integer in paise.' }
      }

      const priorRestorations = state.memberSettlementReversalOfReversals
        .filter((rr) => rr.originalReversalId === originalReversal.id)
        .reduce((sum, rr) => sum + rr.restoredAmountPaise, 0)

      if (priorRestorations + reversalOfReversal.restoredAmountPaise > originalReversal.reversalAmountPaise) {
        return {
          success: false,
          error: `Restoration (${reversalOfReversal.restoredAmountPaise}p) exceeds original reversal amount (${originalReversal.reversalAmountPaise}p).`,
        }
      }

      // Check if there was an associated peer credit settlement reversal reduction
      const associatedReduction = state.peerCreditSettlementReversalAdjustments.find(
        (a) => a.settlementReversalId === originalReversal.id
      )
      let updatedAdjustmentRestorations = [...state.peerCreditSettlementReversalAdjustmentRestorations]

      if (associatedReduction) {
        const restoredPaise = Math.min(
          associatedReduction.reductionPaise,
          reversalOfReversal.restoredAmountPaise
        )
        updatedAdjustmentRestorations.push({
          id: generateEntityId('pc-rev-rest'),
          peerCreditId: associatedReduction.peerCreditId,
          restoredPaise,
          originalAdjustmentId: associatedReduction.id,
          reason: reversalOfReversal.reason,
          createdAt: reversalOfReversal.revertedAt,
        })
      }

      return markProcessed({
        ...state,
        memberSettlementReversalOfReversals: [
          ...state.memberSettlementReversalOfReversals,
          reversalOfReversal,
        ],
        peerCreditSettlementReversalAdjustmentRestorations: updatedAdjustmentRestorations,
      })
    }

    case 'APPLY_UPWARD_CORRECTION_TO_OBLIGATION_CREDITS': {
      const { obligationId, correctionId, newShares, reason, correctedByMembershipId, correctedAt } =
        action.payload
      const obligation = state.obligations.find((o) => o.id === obligationId)
      if (!obligation || obligation.isVoided) {
        return { success: false, error: `Obligation "${obligationId}" not found or voided.` }
      }

      const newTotalPaise = newShares.reduce((sum, s) => sum + s.sharePaise, 0)
      const correctionTime = correctedAt ?? new Date().toISOString()

      // Calculate share increases for debtors with existing peer credits
      let updatedExtinguishments = [...state.peerCreditExtinguishments]

      for (const newS of newShares) {
        const oldS = obligation.shares.find((s) => s.memberId === newS.memberId)
        const oldShare = oldS?.sharePaise ?? 0
        if (newS.sharePaise > oldShare) {
          const shareIncrease = newS.sharePaise - oldShare
          // Check if debtor has peer credit on this obligation
          const debtorCredits = state.peerCredits.filter(
            (c) => c.obligationId === obligationId && c.debtorMemberId === newS.memberId
          )
          let remainingToExtinguish = shareIncrease
          for (const credit of debtorCredits) {
            const avail = getAvailablePeerCreditPaise(
              { ...state, peerCreditExtinguishments: updatedExtinguishments },
              credit.id
            )
            if (avail > 0 && remainingToExtinguish > 0) {
              const extinguishAmount = Math.min(avail, remainingToExtinguish)
              updatedExtinguishments.push({
                id: generateEntityId('pc-ext'),
                peerCreditId: credit.id,
                extinguishedPaise: extinguishAmount,
                reason: `Extinguished by upward obligation correction: ${reason}`,
                sourceEventId: correctionId,
                createdAt: correctionTime,
              })
              remainingToExtinguish -= extinguishAmount
            }
          }
        }
      }

      const updatedObligation: FinancialObligation = {
        ...obligation,
        totalAmountPaise: newTotalPaise,
        totalAmount: paiseToRupees(newTotalPaise),
        shares: newShares,
        correctionHistory: [
          ...(obligation.correctionHistory ?? []),
          {
            id: correctionId,
            obligationId,
            correctionType: 'amount_corrected',
            previousTotalPaise: obligation.totalAmountPaise,
            newTotalPaise,
            previousShares: [...obligation.shares],
            newShares: [...newShares],
            reason,
            correctedByMembershipId,
            correctedAt: correctionTime,
          },
        ],
      }

      return markProcessed({
        ...state,
        obligations: state.obligations.map((o) => (o.id === obligationId ? updatedObligation : o)),
        peerCreditExtinguishments: updatedExtinguishments,
        obligationCorrectionApplications: [
          ...state.obligationCorrectionApplications,
          {
            id: generateEntityId('corr-app'),
            obligationId,
            correctionId,
            appliedAt: correctionTime,
          },
        ],
      })
    }

    case 'APPLY_DOWNWARD_CORRECTION_TO_OBLIGATION': {
      const { obligationId, correctionId, newShares, reason, correctedByMembershipId, correctedAt } =
        action.payload
      const obligation = state.obligations.find((o) => o.id === obligationId)
      if (!obligation || obligation.isVoided) {
        return { success: false, error: `Obligation "${obligationId}" not found or voided.` }
      }

      const newTotalPaise = newShares.reduce((sum, s) => sum + s.sharePaise, 0)
      const correctionTime = correctedAt ?? new Date().toISOString()

      // Calculate downward excess expansions for debtors whose settlements now exceed new share
      let updatedCredits = [...state.peerCredits]
      let updatedExpansions = [...state.peerCreditExpansions]

      for (const newS of newShares) {
        const oldS = obligation.shares.find((s) => s.memberId === newS.memberId)
        const oldShare = oldS?.sharePaise ?? 0
        if (newS.sharePaise < oldShare) {
          const shareDecrease = oldShare - newS.sharePaise
          // Find confirmed settlements for this debtor
          const memberSettlements = state.memberSettlements.filter(
            (s) => s.obligationId === obligationId && s.debtorMemberId === newS.memberId && s.status === 'confirmed'
          )
          const totalSettled = memberSettlements.reduce((sum, s) => sum + s.amountPaise, 0)
          if (totalSettled > newS.sharePaise) {
            // Expansion amount created
            const newExcess = Math.min(shareDecrease, totalSettled - newS.sharePaise)
            let existingCredit = updatedCredits.find(
              (c) => c.obligationId === obligationId && c.debtorMemberId === newS.memberId
            )
            if (!existingCredit && memberSettlements.length > 0) {
              const primary = memberSettlements[0]
              existingCredit = {
                id: generateEntityId('peer-credit'),
                obligationId,
                claimId: primary.claimId,
                settlementId: primary.id,
                debtorMemberId: primary.debtorMemberId,
                creditorMemberId: primary.creditorMemberId,
                initialExcessPaise: 0,
                createdAt: correctionTime,
              }
              updatedCredits.push(existingCredit)
            }
            if (existingCredit) {
              updatedExpansions.push({
                id: generateEntityId('pc-exp'),
                peerCreditId: existingCredit.id,
                expansionAmountPaise: newExcess,
                reason: `Expanded by downward obligation correction: ${reason}`,
                sourceEventId: correctionId,
                createdAt: correctionTime,
              })
            }
          }
        }
      }

      const updatedObligation: FinancialObligation = {
        ...obligation,
        totalAmountPaise: newTotalPaise,
        totalAmount: paiseToRupees(newTotalPaise),
        shares: newShares,
        correctionHistory: [
          ...(obligation.correctionHistory ?? []),
          {
            id: correctionId,
            obligationId,
            correctionType: 'amount_corrected',
            previousTotalPaise: obligation.totalAmountPaise,
            newTotalPaise,
            previousShares: [...obligation.shares],
            newShares: [...newShares],
            reason,
            correctedByMembershipId,
            correctedAt: correctionTime,
          },
        ],
      }

      return markProcessed({
        ...state,
        obligations: state.obligations.map((o) => (o.id === obligationId ? updatedObligation : o)),
        peerCredits: updatedCredits,
        peerCreditExpansions: updatedExpansions,
        obligationCorrectionApplications: [
          ...state.obligationCorrectionApplications,
          {
            id: generateEntityId('corr-app'),
            obligationId,
            correctionId,
            appliedAt: correctionTime,
          },
        ],
      })
    }

    case 'RESOLVE_PEER_CREDIT': {
      const { resolution } = action.payload
      const credit = state.peerCredits.find((c) => c.id === resolution.peerCreditId)
      if (!credit) {
        return { success: false, error: `Peer credit "${resolution.peerCreditId}" not found.` }
      }
      if (resolution.resolvedAmountPaise <= 0 || !Number.isInteger(resolution.resolvedAmountPaise)) {
        return { success: false, error: 'Resolution amount must be a positive integer in paise.' }
      }

      const available = getAvailablePeerCreditPaise(state, credit.id)
      if (resolution.resolvedAmountPaise > available) {
        return {
          success: false,
          error: `Resolution amount (${resolution.resolvedAmountPaise}p) exceeds available peer credit (${available}p).`,
        }
      }

      return markProcessed({
        ...state,
        peerCreditResolutions: [...state.peerCreditResolutions, resolution],
      })
    }

    case 'REVERSE_PEER_CREDIT_RESOLUTION': {
      const { reversal } = action.payload
      const resolution = state.peerCreditResolutions.find((r) => r.id === reversal.resolutionId)
      if (!resolution) {
        return { success: false, error: `Peer credit resolution "${reversal.resolutionId}" not found.` }
      }
      if (reversal.reversalAmountPaise <= 0 || !Number.isInteger(reversal.reversalAmountPaise)) {
        return { success: false, error: 'Reversal amount must be a positive integer in paise.' }
      }

      const priorReversals = state.peerCreditResolutionReversals
        .filter((rr) => rr.resolutionId === resolution.id)
        .reduce((sum, rr) => sum + rr.reversalAmountPaise, 0)

      if (priorReversals + reversal.reversalAmountPaise > resolution.resolvedAmountPaise) {
        return {
          success: false,
          error: `Reversal amount (${reversal.reversalAmountPaise}p) exceeds net resolution (${resolution.resolvedAmountPaise - priorReversals}p).`,
        }
      }

      return markProcessed({
        ...state,
        peerCreditResolutionReversals: [...state.peerCreditResolutionReversals, reversal],
      })
    }

    case 'VOID_FINANCIAL_OBLIGATION': {
      const { obligationId, voidReason, voidedByMembershipId, voidedAt } = action.payload
      const obligation = state.obligations.find((o) => o.id === obligationId)
      if (!obligation) {
        return { success: false, error: `Obligation "${obligationId}" not found.` }
      }
      if (obligation.isVoided) {
        return markProcessed(state, 'Obligation already voided.')
      }

      const voidedObligation = voidFinancialObligation(
        obligation,
        voidReason,
        voidedByMembershipId,
        voidedAt
      )

      return markProcessed({
        ...state,
        obligations: state.obligations.map((o) => (o.id === obligationId ? voidedObligation : o)),
      })
    }

    case 'RECORD_TREASURY_TRANSFER': {
      const { transfer } = action.payload
      if (!transfer || transfer.amount <= 0) {
        return { success: false, error: 'Transfer amount must be greater than zero.' }
      }
      if (transfer.fromAccountId === transfer.toAccountId) {
        return { success: false, error: 'Source and destination accounts must be different.' }
      }
      const fromAccount = state.accounts.find((a) => a.id === transfer.fromAccountId)
      const toAccount = state.accounts.find((a) => a.id === transfer.toAccountId)
      if (!fromAccount || !fromAccount.isActive) {
        return {
          success: false,
          error: `Source account "${transfer.fromAccountId}" does not exist or is inactive.`,
        }
      }
      if (!toAccount || !toAccount.isActive) {
        return {
          success: false,
          error: `Destination account "${transfer.toAccountId}" does not exist or is inactive.`,
        }
      }
      const amountPaise = Math.round(transfer.amount * 100)
      if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
        return { success: false, error: 'Transfer amount must be a positive integer in paise.' }
      }

      // Check available liquid balance in source account
      const availableBalancePaise = calculateAccountLiquidBalance(state, fromAccount.id)
      if (availableBalancePaise < amountPaise) {
        return {
          success: false,
          error: `Insufficient available balance in source account "${fromAccount.name}". Available: ${availableBalancePaise}p, Requested: ${amountPaise}p.`,
        }
      }

      if (state.transfers.some((t) => t.id === transfer.id)) {
        return markProcessed(state, 'Transfer already recorded (idempotent).')
      }

      const committedTransfer: TreasuryTransfer = {
        ...transfer,
        status: transfer.status ?? 'confirmed',
      }

      return markProcessed({
        ...state,
        transfers: [committedTransfer, ...state.transfers],
      })
    }

    case 'RECORD_EXPENSE': {
      const { expense } = action.payload
      if (!expense || expense.amountPaise <= 0 || !Number.isInteger(expense.amountPaise)) {
        return { success: false, error: 'Expense amount must be a positive integer in paise.' }
      }
      if (state.expenses.some((e) => e.id === expense.id)) {
        return { success: false, error: `Expense with ID "${expense.id}" already exists.` }
      }
      if (expense.disbursementStatus === 'disbursed' && expense.disbursementChannel !== 'member_out_of_pocket') {
        const accountId = expense.disbursedFromAccountId
        if (!accountId) {
          return { success: false, error: 'Treasury expense must specify disbursedFromAccountId.' }
        }
        const account = state.accounts.find((a) => a.id === accountId)
        if (!account || !account.isActive) {
          return { success: false, error: `Account "${accountId}" does not exist or is inactive.` }
        }
        const liquidBalancePaise = calculateAccountLiquidBalance(state, account.id)
        if (liquidBalancePaise < expense.amountPaise) {
          return {
            success: false,
            error: `Insufficient balance in account "${account.name}". Available: ${liquidBalancePaise}p, Required: ${expense.amountPaise}p.`,
          }
        }
      }
      return markProcessed({
        ...state,
        expenses: [expense, ...state.expenses],
      })
    }

    case 'DISBURSE_EXPENSE': {
      const { expenseId, disbursedByMembershipId, disbursedAt } = action.payload
      const expense = state.expenses.find((e) => e.id === expenseId)
      if (!expense) {
        return { success: false, error: `Expense "${expenseId}" not found.` }
      }
      if (expense.isVoided) {
        return { success: false, error: `Cannot disburse voided expense "${expenseId}".` }
      }
      if (expense.disbursementStatus === 'disbursed') {
        return markProcessed(state, 'Expense already disbursed.')
      }
      if (expense.disbursementStatus !== 'pending') {
        return {
          success: false,
          error: `Cannot disburse expense with status "${expense.disbursementStatus}". Must be "pending".`,
        }
      }
      if (expense.disbursementChannel !== 'member_out_of_pocket') {
        const accountId = expense.disbursedFromAccountId ?? state.accounts[0]?.id
        const account = state.accounts.find((a) => a.id === accountId)
        if (!account || !account.isActive) {
          return { success: false, error: `Treasury account "${accountId}" does not exist or is inactive.` }
        }
        const liquidBalancePaise = calculateAccountLiquidBalance(state, account.id)
        if (liquidBalancePaise < expense.amountPaise) {
          return {
            success: false,
            error: `Insufficient balance in account "${account.name}". Available: ${liquidBalancePaise}p, Required: ${expense.amountPaise}p.`,
          }
        }
      }
      const updatedExpense: ExpenseItem = {
        ...expense,
        disbursementStatus: 'disbursed',
        disbursedAt: disbursedAt ?? new Date().toISOString(),
        disbursedByMembershipId,
      }
      return markProcessed({
        ...state,
        expenses: state.expenses.map((e) => (e.id === expenseId ? updatedExpense : e)),
      })
    }

    case 'VOID_EXPENSE': {
      const { expenseId, voidReason, voidedByMembershipId, voidedAt } = action.payload
      const expense = state.expenses.find((e) => e.id === expenseId)
      if (!expense) {
        return { success: false, error: `Expense "${expenseId}" not found.` }
      }
      if (expense.isVoided) {
        return markProcessed(state, 'Expense already voided.')
      }
      const voidTime = voidedAt ?? new Date().toISOString()
      const updatedExpense: ExpenseItem = {
        ...expense,
        isVoided: true,
        voidReason,
        voidedByMembershipId,
        voidedAt: voidTime,
      }
      return markProcessed({
        ...state,
        expenses: state.expenses.map((e) => (e.id === expenseId ? updatedExpense : e)),
      })
    }

    case 'APPLY_EXPENSE_CORRECTION': {
      const { expenseId, correctionRecord, updatedFields } = action.payload
      const expense = state.expenses.find((e) => e.id === expenseId)
      if (!expense) {
        return { success: false, error: `Expense "${expenseId}" not found.` }
      }
      if (expense.isVoided) {
        return { success: false, error: `Cannot correct voided expense "${expenseId}".` }
      }
      const updatedExpense: ExpenseItem = {
        ...expense,
        title: updatedFields.title,
        category: updatedFields.category as ExpenseCategory,
        description: updatedFields.description,
        correctionHistory: [
          ...(expense.correctionHistory ?? []),
          correctionRecord,
        ],
      }
      return markProcessed({
        ...state,
        expenses: state.expenses.map((e) => (e.id === expenseId ? updatedExpense : e)),
      })
    }

    case 'RECORD_REFUND_ADJUSTMENT': {
      const { refundContribution } = action.payload
      if (!refundContribution || refundContribution.amount <= 0) {
        return { success: false, error: 'Refund amount must be greater than zero.' }
      }
      if (state.contributions.some((c) => c.id === refundContribution.id)) {
        return { success: false, error: `Contribution with ID "${refundContribution.id}" already exists.` }
      }
      const refundPaise = rupeesToPaise(refundContribution.amount)
      const account = state.accounts.find((a) => a.id === refundContribution.accountId)
      if (!account || !account.isActive) {
        return { success: false, error: `Account "${refundContribution.accountId}" does not exist or is inactive.` }
      }
      if (refundContribution.originalContributionId) {
        const original = state.contributions.find((c) => c.id === refundContribution.originalContributionId)
        if (!original || original.status !== 'confirmed' || original.isVoided) {
          return {
            success: false,
            error: `Original contribution "${refundContribution.originalContributionId}" not found, not confirmed, or voided.`,
          }
        }
        const originalPaise = rupeesToPaise(original.amount)
        const priorRefundsPaise = state.contributions
          .filter((c) => c.originalContributionId === original.id && !c.isVoided)
          .reduce((sum, c) => sum + rupeesToPaise(c.amount), 0)
        if (priorRefundsPaise + refundPaise > originalPaise) {
          return {
            success: false,
            error: `Refund of ${refundPaise}p exceeds original contribution remaining capacity (${originalPaise - priorRefundsPaise}p).`,
          }
        }
      }
      const liquidBalancePaise = calculateAccountLiquidBalance(state, account.id)
      if (liquidBalancePaise < refundPaise) {
        return {
          success: false,
          error: `Insufficient balance in account "${account.name}". Available: ${liquidBalancePaise}p, Required: ${refundPaise}p.`,
        }
      }
      const committedRefund: FundContribution = {
        ...refundContribution,
        isRefundAdjustment: true,
        status: refundContribution.status ?? 'confirmed',
      }
      return markProcessed({
        ...state,
        contributions: [committedRefund, ...state.contributions],
      })
    }

    case 'MARK_NOTIFICATION_READ': {
      const { notificationId, readAt } = action.payload
      const readState = {
        ...state.notificationReadState,
        [notificationId]: {
          isRead: true,
          readAt: readAt ?? new Date().toISOString(),
        },
      }
      return markProcessed({
        ...state,
        notificationReadState: readState,
      })
    }

    default:
      return { success: false, error: `Unknown financial action type: ${(action as any).type}` }
  }
}

/**
 * React useReducer adapter for root financial state.
 * Returns next state on success, or preserves existing state on failure.
 */
export function rootFinancialReducer(
  state: RootFinancialState,
  action: FinancialAction
): RootFinancialState {
  const result = financialStateReducer(state, action)
  return result.success ? result.state : state
}
