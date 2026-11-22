import type {
  AccountBalanceSummary,
  BalanceSummary,
  CleaningDuty,
  CleaningDutyAssignment,
  CleaningTaskTemplate,
  DerivedPeerClaim,
  ExpenseItem,
  FinancialObligation,
  FundContribution,
  HouseholdCollectorQrConfig,
  HouseholdMember,
  HouseholdStats,
  InventoryAlert,
  InventoryItem,
  MemberSettlementRecord,
  ObligationContributionAllocation,
  RefundValidationResult,
  RootFinancialState,
  SplitScopeType,
  StockLogRecord,
  TransferValidationResult,
  TreasuryAccount,
  TreasuryOverview,
  TreasuryTransfer,
} from '../types/index.ts'
import {
  calculateEqualExpenseSplits,
  paiseToRupees,
  rupeesToPaise,
  validateExpense,
} from '../utils/financial.ts'

export { calculateEqualExpenseSplits, validateExpense }

/**
 * DEMO FIXTURE DATA & FINANCIAL LOGIC (Stage 2)
 * 
 * Financial Integrity Invariants:
 * 1. Integer Paise Arithmetic: All balance calculations, inflows, outflows, and validations
 *    are performed strictly in integer paise (1 INR = 100 paise) to avoid floating-point errors.
 * 2. Only Confirmed Inflows Available: Pending and rejected contributions never increment available balances.
 * 3. Confirmed Refunds Deducted: Only confirmed refund adjustments with a valid original contribution
 *    reduce liquid balance; pending refunds do not reduce available balance.
 * 4. Refund Limit Enforcement: Total confirmed refunds cannot exceed the original confirmed contribution amount.
 * 5. Disbursed Expenses Only: Only disbursed expenses from a valid treasury account reduce its balance.
 *    Pending expenses and member-out-of-pocket expenses do not deplete treasury pools.
 * 6. Inter-Account Transfer Integrity: Transfers decrease source and increase destination by equal paise,
 *    leaving the combined household balance unchanged. Source must have sufficient available balance.
 * 7. Non-Destructive History: Original records are never overwritten or deleted.
 */

/* ==========================================================================
   Household Members
   ========================================================================== */

export const DEMO_MEMBERS: HouseholdMember[] = [
  // Departed member preserved for historical financial attribution
  {
    id: 'm0',
    name: 'Aakash Verma',
    avatarInitial: 'AV',
    status: 'departed',
    participationTier: 'resident',
    roomLabel: 'Former Resident (Room 2B)',
    joinedDate: '2025-06-01',
    departedDate: '2026-10-31',
    isResident: false,
    isFoodEligible: false,
    isCleaningEligible: false,
    isGeneralExpenseEligible: false,
    isRentEligible: false,
  },
  // Active Residents (7 current residents)
  {
    id: 'm1',
    name: 'Rohan Sharma',
    avatarInitial: 'RS',
    status: 'active',
    participationTier: 'resident',
    roomLabel: 'Room 1A',
    joinedDate: '2026-01-01',
    isResident: true,
    isFoodEligible: true,
    isCleaningEligible: true,
    isGeneralExpenseEligible: true,
    isRentEligible: true,
  },
  {
    id: 'm2',
    name: 'Arjun Verma',
    avatarInitial: 'AV',
    status: 'active',
    participationTier: 'resident',
    roomLabel: 'Room 1B',
    joinedDate: '2026-01-01',
    isResident: true,
    isFoodEligible: true,
    isCleaningEligible: true,
    isGeneralExpenseEligible: true,
    isRentEligible: true,
  },
  {
    id: 'm3',
    name: 'Karthik Nair',
    avatarInitial: 'KN',
    status: 'active',
    participationTier: 'resident',
    roomLabel: 'Room 2A',
    joinedDate: '2026-01-01',
    isResident: true,
    isFoodEligible: true,
    isCleaningEligible: true,
    isGeneralExpenseEligible: true,
    isRentEligible: true,
  },
  {
    id: 'm4',
    name: 'Tanmay Gupta',
    avatarInitial: 'TG',
    status: 'active',
    participationTier: 'resident',
    roomLabel: 'Room 2B',
    joinedDate: '2026-11-01',
    isResident: true,
    isFoodEligible: true,
    isCleaningEligible: true,
    isGeneralExpenseEligible: true,
    isRentEligible: true,
  },
  {
    id: 'm5',
    name: 'Sameer Patel',
    avatarInitial: 'SP',
    status: 'active',
    participationTier: 'resident',
    roomLabel: 'Room 3A',
    joinedDate: '2026-01-01',
    isResident: true,
    isFoodEligible: true,
    isCleaningEligible: true,
    isGeneralExpenseEligible: true,
    isRentEligible: true,
  },
  {
    id: 'm6',
    name: 'Deepak Joshi',
    avatarInitial: 'DJ',
    status: 'active',
    participationTier: 'resident',
    roomLabel: 'Room 3B',
    joinedDate: '2026-01-01',
    isResident: true,
    isFoodEligible: true,
    isCleaningEligible: true,
    isGeneralExpenseEligible: true,
    isRentEligible: true,
  },
  {
    id: 'm7',
    name: 'Nikhil Roy',
    avatarInitial: 'NR',
    status: 'active',
    participationTier: 'resident',
    roomLabel: 'Room 4',
    joinedDate: '2026-01-01',
    isResident: true,
    isFoodEligible: true,
    isCleaningEligible: true,
    isGeneralExpenseEligible: true,
    isRentEligible: true,
  },
  // Active Food-Only Contributor (1 current external meal participant)
  {
    id: 'm8',
    name: 'Vikram Mehta',
    avatarInitial: 'VM',
    status: 'active',
    participationTier: 'food_only',
    roomLabel: 'External Contributor',
    joinedDate: '2026-02-01',
    isResident: false,
    isFoodEligible: true,
    isCleaningEligible: false,
    isGeneralExpenseEligible: false,
    isRentEligible: false,
  },
]

export function getAllMembers(members: HouseholdMember[] = DEMO_MEMBERS): HouseholdMember[] {
  return members
}

export function getActiveMembers(members: HouseholdMember[] = DEMO_MEMBERS): HouseholdMember[] {
  return members.filter((m) => m.status === 'active')
}

/**
 * Resolves eligible participants for a new expense.
 * Active members only; custom selections require isGeneralExpenseEligible.
 * Does NOT rewrite existing historical participant IDs on saved expenses.
 */
export function resolveEligibleParticipants(
  members: HouseholdMember[] = DEMO_MEMBERS,
  scope: SplitScopeType,
  customMemberIds?: string[]
): HouseholdMember[] {
  const active = getActiveMembers(members)

  switch (scope) {
    case 'all_active':
      return active.filter((m) => m.isGeneralExpenseEligible)
    case 'residents_only':
      return active.filter((m) => m.isResident)
    case 'food_participants':
      return active.filter((m) => m.isFoodEligible)
    case 'custom':
      if (!customMemberIds || customMemberIds.length === 0) return []
      return active.filter(
        (m) => customMemberIds.includes(m.id) && m.isGeneralExpenseEligible
      )
  }
}

export function calculateHouseholdStats(members: HouseholdMember[] = DEMO_MEMBERS): HouseholdStats {
  const active = getActiveMembers(members)
  return {
    totalActiveMembers: active.length,
    activeResidentsCount: active.filter((m) => m.isResident).length,
    activeFoodOnlyCount: active.filter((m) => m.participationTier === 'food_only').length,
    totalFoodParticipantsCount: active.filter((m) => m.isFoodEligible).length,
    activeCleaningEligibleCount: active.filter((m) => m.isCleaningEligible).length,
  }
}

export function formatHouseholdComposition(stats: HouseholdStats): string {
  const residentPart = `${stats.activeResidentsCount} Resident${stats.activeResidentsCount === 1 ? '' : 's'}`
  const foodPart =
    stats.activeFoodOnlyCount > 0
      ? ` · ${stats.activeFoodOnlyCount} Food Contributor${stats.activeFoodOnlyCount === 1 ? '' : 's'}`
      : ''
  return `${residentPart}${foodPart}`
}

export function formatSplitScopeLabel(scopeType: SplitScopeType, count: number): string {
  switch (scopeType) {
    case 'all_active':
      return `Split across all active (${count})`
    case 'food_participants':
      return `Food participants split (${count})`
    case 'residents_only':
      return `Residents only (${count})`
    case 'custom':
      return `Custom group (${count})`
  }
}

/* ==========================================================================
   Treasury Accounts & Inter-Account Transfers
   ========================================================================== */

export const DEMO_TREASURY_ACCOUNTS: TreasuryAccount[] = [
  {
    id: 'acc-upi',
    name: "Arjun's Personal UPI (House Pool)",
    accountType: 'personal_upi',
    custodianMembershipId: 'm2',
    custodianName: 'Arjun Verma',
    upiId: 'arjun.verma@okhdfcbank',
    recipientName: 'Arjun Verma',
    isActive: true,
  },
  {
    id: 'acc-cash',
    name: 'Living Room Cash Box',
    accountType: 'cash_box',
    custodianMembershipId: 'm5',
    custodianName: 'Sameer Patel',
    isActive: true,
  },
]

export const DEMO_TREASURY_TRANSFERS: TreasuryTransfer[] = [
  {
    id: 'trf-1',
    fromAccountId: 'acc-upi',
    toAccountId: 'acc-cash',
    fromAccountName: "Arjun's Personal UPI (House Pool)",
    toAccountName: 'Living Room Cash Box',
    amount: 5000,
    date: '10 Nov 2026',
    purpose: 'ATM Cash Withdrawal to replenish household Cash Box',
    reference: 'ATM-WDL-98214',
    authorizedByMembershipId: 'm2',
    authorizedByName: 'Arjun Verma',
    status: 'confirmed',
  },
]

/* ==========================================================================
   Shared Expenses with Disbursement Statuses
   ========================================================================== */

export const DEMO_RECENT_EXPENSES: ExpenseItem[] = [
  {
    id: 'exp-1',
    title: 'Monthly Groceries & Ration',
    category: 'Kitchen & Groceries',
    amount: 8420,
    amountPaise: 842000,
    payerMemberId: 'm1',
    paidBy: 'Rohan Sharma',
    date: '19 Nov 2026',
    description: 'Bulk pulses, spices, cooking oil, rice and flour from wholesale mart.',
    splitScopeType: 'food_participants',
    participantMemberIds: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'],
    splits: calculateEqualExpenseSplits(
      842000,
      [
        { id: 'm1', name: 'Rohan Sharma' },
        { id: 'm2', name: 'Arjun Verma' },
        { id: 'm3', name: 'Karthik Nair' },
        { id: 'm4', name: 'Vikram Sengupta' },
        { id: 'm5', name: 'Sameer Patel' },
        { id: 'm6', name: 'Aditya Rao' },
        { id: 'm7', name: 'Pranav Joshi' },
        { id: 'm8', name: 'Ananya Roy' },
      ],
      'm1',
      'treasury_personal_upi'
    ),
    disbursementChannel: 'treasury_personal_upi',
    disbursedFromAccountId: 'acc-upi',
    disbursementStatus: 'disbursed',
  },
  {
    id: 'exp-2',
    title: 'High-speed Fiber Broadband',
    category: 'Utilities & Internet',
    amount: 1499,
    amountPaise: 149900,
    payerMemberId: 'm3',
    paidBy: 'Karthik Nair',
    date: '18 Nov 2026',
    description: '300 Mbps unlimited optical fiber monthly connection.',
    splitScopeType: 'residents_only',
    participantMemberIds: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
    splits: calculateEqualExpenseSplits(
      149900,
      [
        { id: 'm1', name: 'Rohan Sharma' },
        { id: 'm2', name: 'Arjun Verma' },
        { id: 'm3', name: 'Karthik Nair' },
        { id: 'm4', name: 'Vikram Sengupta' },
        { id: 'm5', name: 'Sameer Patel' },
        { id: 'm6', name: 'Aditya Rao' },
        { id: 'm7', name: 'Pranav Joshi' },
      ],
      'm3',
      'treasury_personal_upi'
    ),
    disbursementChannel: 'treasury_personal_upi',
    disbursedFromAccountId: 'acc-upi',
    disbursementStatus: 'disbursed',
  },
  {
    id: 'exp-3',
    title: '20L Drinking Water Cans (5 Cans)',
    category: 'Drinking Water',
    amount: 450,
    amountPaise: 45000,
    payerMemberId: 'm2',
    paidBy: 'Arjun Verma',
    date: '17 Nov 2026',
    description: 'Refill of 5 Bisleri 20L water cans for kitchen dispenser.',
    splitScopeType: 'food_participants',
    participantMemberIds: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'],
    splits: calculateEqualExpenseSplits(
      45000,
      [
        { id: 'm1', name: 'Rohan Sharma' },
        { id: 'm2', name: 'Arjun Verma' },
        { id: 'm3', name: 'Karthik Nair' },
        { id: 'm4', name: 'Vikram Sengupta' },
        { id: 'm5', name: 'Sameer Patel' },
        { id: 'm6', name: 'Aditya Rao' },
        { id: 'm7', name: 'Pranav Joshi' },
        { id: 'm8', name: 'Ananya Roy' },
      ],
      'm2',
      'treasury_cash_box'
    ),
    disbursementChannel: 'treasury_cash_box',
    disbursedFromAccountId: 'acc-cash',
    disbursementStatus: 'disbursed',
  },
  {
    id: 'exp-4',
    title: 'Kitchen Water Purifier AMC (Annual)',
    category: 'Cleaning & Household',
    amount: 2400,
    amountPaise: 240000,
    payerMemberId: 'm0',
    paidBy: 'Aakash Verma',
    date: '28 Oct 2026',
    description: 'RO membrane and sediment filter replacement service contract.',
    splitScopeType: 'residents_only',
    participantMemberIds: ['m0', 'm1', 'm2', 'm3', 'm5', 'm6', 'm7'],
    splits: calculateEqualExpenseSplits(
      240000,
      [
        { id: 'm0', name: 'Aakash Verma' },
        { id: 'm1', name: 'Rohan Sharma' },
        { id: 'm2', name: 'Arjun Verma' },
        { id: 'm3', name: 'Karthik Nair' },
        { id: 'm5', name: 'Sameer Patel' },
        { id: 'm6', name: 'Aditya Rao' },
        { id: 'm7', name: 'Pranav Joshi' },
      ],
      'm0',
      'member_out_of_pocket'
    ),
    disbursementChannel: 'member_out_of_pocket',
    disbursementStatus: 'disbursed',
  },
  {
    id: 'exp-5',
    title: 'Balcony Mesh & Pigeon Netting (Pending Approval)',
    category: 'Repairs & Maintenance',
    amount: 1200,
    amountPaise: 120000,
    payerMemberId: 'm5',
    paidBy: 'Sameer Patel',
    date: '20 Nov 2026',
    description: 'Hardware store quote for heavy-duty netting roll and zip-ties.',
    splitScopeType: 'residents_only',
    participantMemberIds: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'],
    splits: calculateEqualExpenseSplits(
      120000,
      [
        { id: 'm1', name: 'Rohan Sharma' },
        { id: 'm2', name: 'Arjun Verma' },
        { id: 'm3', name: 'Karthik Nair' },
        { id: 'm4', name: 'Vikram Sengupta' },
        { id: 'm5', name: 'Sameer Patel' },
        { id: 'm6', name: 'Aditya Rao' },
        { id: 'm7', name: 'Pranav Joshi' },
      ],
      'm5',
      'treasury_cash_box'
    ),
    disbursementChannel: 'treasury_cash_box',
    disbursedFromAccountId: 'acc-cash',
    disbursementStatus: 'pending',
  },
]

/* ==========================================================================
   Fund Contributions (Inflows & Adjustments)
   ========================================================================== */

export const DEMO_CONTRIBUTIONS: FundContribution[] = [
  // 1. Confirmed online contribution to Personal UPI
  {
    id: 'cnt-1',
    accountId: 'acc-upi',
    contributorMembershipId: 'm1',
    contributorName: 'Rohan Sharma',
    amount: 6000,
    date: '02 Nov 2026',
    status: 'confirmed',
    transactionReference: '430291823719',
    note: 'November month maintenance contribution',
    confirmedByMembershipId: 'm2',
    confirmedByName: 'Arjun Verma (Custodian)',
    confirmedAt: '02 Nov 2026, 07:15 PM',
  },
  // 2. Confirmed online contribution to Personal UPI
  {
    id: 'cnt-2',
    accountId: 'acc-upi',
    contributorMembershipId: 'm3',
    contributorName: 'Karthik Nair',
    amount: 6000,
    date: '02 Nov 2026',
    status: 'confirmed',
    transactionReference: '430284729103',
    note: 'November share via Google Pay',
    confirmedByMembershipId: 'm2',
    confirmedByName: 'Arjun Verma (Custodian)',
    confirmedAt: '02 Nov 2026, 08:30 PM',
  },
  // 3. Confirmed online contribution to Personal UPI
  {
    id: 'cnt-3',
    accountId: 'acc-upi',
    contributorMembershipId: 'm4',
    contributorName: 'Tanmay Gupta',
    amount: 6000,
    date: '03 Nov 2026',
    status: 'confirmed',
    transactionReference: '430391204859',
    note: 'Monthly pool share via PhonePe',
    confirmedByMembershipId: 'm2',
    confirmedByName: 'Arjun Verma (Custodian)',
    confirmedAt: '03 Nov 2026, 10:12 AM',
  },
  // 4. Confirmed online contribution to Personal UPI
  {
    id: 'cnt-4',
    accountId: 'acc-upi',
    contributorMembershipId: 'm5',
    contributorName: 'Sameer Patel',
    amount: 6000,
    date: '03 Nov 2026',
    status: 'confirmed',
    transactionReference: '430381029471',
    note: 'Nov maintenance deposit',
    confirmedByMembershipId: 'm2',
    confirmedByName: 'Arjun Verma (Custodian)',
    confirmedAt: '03 Nov 2026, 11:45 AM',
  },
  // 5. Confirmed online contribution from Food-Only Contributor
  {
    id: 'cnt-5',
    accountId: 'acc-upi',
    contributorMembershipId: 'm8',
    contributorName: 'Vikram Mehta',
    amount: 4269,
    date: '04 Nov 2026',
    status: 'confirmed',
    transactionReference: '430489120482',
    note: 'Monthly food and kitchen ration contribution',
    confirmedByMembershipId: 'm2',
    confirmedByName: 'Arjun Verma (Custodian)',
    confirmedAt: '04 Nov 2026, 06:10 PM',
  },
  // 6. Confirmed cash contribution to Living Room Cash Box
  {
    id: 'cnt-6',
    accountId: 'acc-cash',
    contributorMembershipId: 'm6',
    contributorName: 'Deepak Joshi',
    amount: 1500,
    date: '05 Nov 2026',
    status: 'confirmed',
    note: 'Cash handed to Sameer for emergency vegetable/milk petty fund',
    confirmedByMembershipId: 'm5',
    confirmedByName: 'Sameer Patel (Cash Custodian)',
    confirmedAt: '05 Nov 2026, 09:20 PM',
  },
  // 7. Confirmed cash contribution to Living Room Cash Box
  {
    id: 'cnt-7',
    accountId: 'acc-cash',
    contributorMembershipId: 'm7',
    contributorName: 'Nikhil Roy',
    amount: 1500,
    date: '06 Nov 2026',
    status: 'confirmed',
    note: 'Cash deposit into household drawer',
    confirmedByMembershipId: 'm5',
    confirmedByName: 'Sameer Patel (Cash Custodian)',
    confirmedAt: '06 Nov 2026, 08:00 AM',
  },
  // 8. PENDING confirmation: Submitted by contributor, NOT YET ACKNOWLEDGED by custodian
  // MUST NEVER increase available balances per financial integrity rules!
  {
    id: 'cnt-8',
    accountId: 'acc-upi',
    contributorMembershipId: 'm6',
    contributorName: 'Deepak Joshi',
    amount: 3000,
    date: '20 Nov 2026',
    status: 'pending_confirmation',
    transactionReference: '432490812345',
    note: 'Additional grocery top-up sent via Paytm',
  },
  // 9. Original contribution that was partially overpaid & refunded
  {
    id: 'cnt-9',
    accountId: 'acc-upi',
    contributorMembershipId: 'm7',
    contributorName: 'Nikhil Roy',
    amount: 4000,
    date: '01 Nov 2026',
    status: 'confirmed',
    transactionReference: '430198273612',
    note: 'Overpaid initial advance',
    confirmedByMembershipId: 'm2',
    confirmedByName: 'Arjun Verma (Custodian)',
    confirmedAt: '01 Nov 2026, 05:00 PM',
  },
  // 10. NON-DESTRUCTIVE REFUND ADJUSTMENT: Confirmed reversal entry deducting overpayment
  // Preserves original cnt-9 intact while adjusting liquid balance
  {
    id: 'cnt-10',
    accountId: 'acc-upi',
    contributorMembershipId: 'm7',
    contributorName: 'Nikhil Roy',
    amount: 1000,
    date: '02 Nov 2026',
    status: 'confirmed',
    isRefundAdjustment: true,
    originalContributionId: 'cnt-9',
    note: 'Refund adjustment: ₹1,000 returned to Nikhil via UPI due to initial overpayment',
    confirmedByMembershipId: 'm2',
    confirmedByName: 'Arjun Verma (Custodian)',
    confirmedAt: '02 Nov 2026, 06:15 PM',
  },
]

/* ==========================================================================
   Validation Engine (Financial Guardrails)
   ========================================================================== */

/**
 * Validates a transfer before commitment:
 * 1. Source and destination accounts exist and are active.
 * 2. Source and destination must not be identical.
 * 3. Amount in paise must be positive integer.
 * 4. Source account must have sufficient available balance in paise.
 */
export function validateTransfer(
  fromAccountId: string,
  toAccountId: string,
  amountPaise: number,
  accounts: TreasuryAccount[],
  overview: TreasuryOverview
): TransferValidationResult {
  const fromAccount = accounts.find((a) => a.id === fromAccountId)
  const toAccount = accounts.find((a) => a.id === toAccountId)

  if (!fromAccount || !fromAccount.isActive) {
    return { isValid: false, errorMessage: 'Source account does not exist or is inactive.' }
  }

  if (!toAccount || !toAccount.isActive) {
    return { isValid: false, errorMessage: 'Destination account does not exist or is inactive.' }
  }

  if (fromAccountId === toAccountId) {
    return { isValid: false, errorMessage: 'Source and destination accounts must be different.' }
  }

  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    return { isValid: false, errorMessage: 'Transfer amount must be a positive valid number.' }
  }

  const fromSummary = overview.accounts.find((s) => s.account.id === fromAccountId)
  const availablePaise = fromSummary ? fromSummary.currentBalancePaise : 0

  if (amountPaise > availablePaise) {
    const availableRupees = paiseToRupees(availablePaise).toLocaleString('en-IN')
    const requestedRupees = paiseToRupees(amountPaise).toLocaleString('en-IN')
    return {
      isValid: false,
      errorMessage: `Insufficient funds in ${fromAccount.name}. Available: ₹${availableRupees}, requested: ₹${requestedRupees}.`,
    }
  }

  return { isValid: true }
}

/**
 * Validates a refund adjustment record:
 * 1. Must reference a valid original contribution in the same account.
 * 2. Original contribution must be confirmed.
 * 3. Total confirmed refunds for that original contribution cannot exceed original contribution amount.
 */
export function validateRefund(
  refund: Partial<FundContribution>,
  contributions: FundContribution[],
  accounts: TreasuryAccount[]
): RefundValidationResult {
  if (!refund.isRefundAdjustment) {
    return { isValid: true }
  }

  if (!refund.originalContributionId) {
    return { isValid: false, errorMessage: 'Refund adjustment must specify an original contribution ID.' }
  }

  const original = contributions.find((c) => c.id === refund.originalContributionId)
  if (!original) {
    return { isValid: false, errorMessage: 'Original contribution record not found.' }
  }

  const account = accounts.find((a) => a.id === refund.accountId && a.isActive)
  if (!account) {
    return { isValid: false, errorMessage: 'Refund target treasury account does not exist or is inactive.' }
  }

  if (original.status !== 'confirmed') {
    return { isValid: false, errorMessage: 'Cannot issue refund against an unconfirmed contribution.' }
  }

  if (original.accountId !== refund.accountId) {
    return { isValid: false, errorMessage: 'Refund must be issued from the same account as the original contribution.' }
  }

  const originalAmountPaise = rupeesToPaise(original.amount)
  const existingRefundsPaise = contributions
    .filter(
      (c) =>
        c.originalContributionId === original.id &&
        c.isRefundAdjustment &&
        c.status === 'confirmed' &&
        !c.isVoided &&
        c.id !== refund.id
    )
    .reduce((sum, c) => sum + rupeesToPaise(c.amount), 0)

  const thisRefundPaise = rupeesToPaise(refund.amount ?? 0)

  if (existingRefundsPaise + thisRefundPaise > originalAmountPaise) {
    const maxAllowedRupees = paiseToRupees(originalAmountPaise - existingRefundsPaise)
    return {
      isValid: false,
      errorMessage: `Total refunds cannot exceed the original contribution of ₹${original.amount}. Maximum refundable: ₹${maxAllowedRupees}.`,
    }
  }

  return { isValid: true }
}

/* ==========================================================================
   Balance Calculation Engine (Pure Integer Paise Arithmetic)
   ========================================================================== */

/**
 * Calculates current available and pending balances for all accounts strictly adhering to:
 * 1. All calculations done in integer paise (1 INR = 100 paise).
 * 2. Only confirmed, non-voided contributions count as liquid inflows.
 * 3. Pending and rejected contributions NEVER increase available balances.
 * 4. Only confirmed refund adjustments with valid original reference deduct from liquid balance.
 * 5. Disbursed expenses from a valid treasury account decrease that account;
 *    pending and out-of-pocket expenses DO NOT decrease treasury balances.
 * 6. Confirmed transfers decrease source account and increase destination account by equal paise.
 */
export function calculateTreasuryOverview(
  accounts: TreasuryAccount[] = DEMO_TREASURY_ACCOUNTS,
  contributions: FundContribution[] = DEMO_CONTRIBUTIONS,
  expenses: ExpenseItem[] = DEMO_RECENT_EXPENSES,
  transfers: TreasuryTransfer[] = DEMO_TREASURY_TRANSFERS,
  asOfDate: string = '20-Nov-2026'
): TreasuryOverview {
  const summaries: AccountBalanceSummary[] = accounts.map((account) => {
    // 1. Confirmed liquid inflows in paise
    const confirmedInflowsPaise = contributions
      .filter(
        (c) =>
          c.accountId === account.id &&
          c.status === 'confirmed' &&
          !c.isVoided &&
          !c.isRefundAdjustment
      )
      .reduce((sum, c) => sum + rupeesToPaise(c.amount), 0)

    // 2. Confirmed refund adjustment deductions in paise (pending refunds are EXCLUDED)
    const refundDeductionsPaise = contributions
      .filter(
        (c) =>
          c.accountId === account.id &&
          c.isRefundAdjustment &&
          c.status === 'confirmed' &&
          !c.isVoided
      )
      .reduce((sum, c) => sum + rupeesToPaise(c.amount), 0)

    // 3. Confirmed transfers in in paise
    const transfersInPaise = transfers
      .filter((t) => t.toAccountId === account.id && t.status === 'confirmed')
      .reduce((sum, t) => sum + rupeesToPaise(t.amount), 0)

    // 4. Confirmed transfers out in paise
    const transfersOutPaise = transfers
      .filter((t) => t.fromAccountId === account.id && t.status === 'confirmed')
      .reduce((sum, t) => sum + rupeesToPaise(t.amount), 0)

    // 5. Disbursed expenses in paise
    // Only disbursed, non-voided expenses with matching treasury account reduce balance.
    // Member out-of-pocket expenses and pending expenses are EXCLUDED.
    const disbursedExpensesPaise = expenses
      .filter(
        (e) =>
          e.disbursedFromAccountId === account.id &&
          e.disbursementStatus === 'disbursed' &&
          e.disbursementChannel !== 'member_out_of_pocket' &&
          !e.isVoided
      )
      .reduce((sum, e) => sum + (e.amountPaise ?? rupeesToPaise(e.amount)), 0)

    // Current liquid balance in integer paise
    const currentBalancePaise =
      confirmedInflowsPaise - refundDeductionsPaise + transfersInPaise - transfersOutPaise - disbursedExpensesPaise

    // Pending inflows in paise (NOT liquid / available)
    const pendingInflowPaise = contributions
      .filter(
        (c) =>
          c.accountId === account.id &&
          c.status === 'pending_confirmation' &&
          !c.isVoided
      )
      .reduce((sum, c) => sum + rupeesToPaise(c.amount), 0)

    return {
      account,
      currentBalance: paiseToRupees(currentBalancePaise),
      currentBalancePaise,
      pendingInflow: paiseToRupees(pendingInflowPaise),
      pendingInflowPaise,
    }
  })

  const totalAvailableBalancePaise = summaries.reduce((sum, s) => sum + s.currentBalancePaise, 0)
  const totalPendingBalancePaise = summaries.reduce((sum, s) => sum + s.pendingInflowPaise, 0)

  return {
    accounts: summaries,
    totalAvailableBalance: paiseToRupees(totalAvailableBalancePaise),
    totalAvailableBalancePaise,
    totalPendingBalance: paiseToRupees(totalPendingBalancePaise),
    totalPendingBalancePaise,
    asOfDate,
  }
}

// Derive unified balances dynamically using pure integer paise arithmetic
export const DEMO_TREASURY_OVERVIEW: TreasuryOverview = calculateTreasuryOverview()

export const DEMO_BALANCES: BalanceSummary = {
  totalBalance: DEMO_TREASURY_OVERVIEW.totalAvailableBalance,
  bankBalance:
    DEMO_TREASURY_OVERVIEW.accounts.find((a) => a.account.accountType === 'personal_upi')
      ?.currentBalance ?? 0,
  cashBalance:
    DEMO_TREASURY_OVERVIEW.accounts.find((a) => a.account.accountType === 'cash_box')
      ?.currentBalance ?? 0,
  currency: '₹',
  asOfDate: DEMO_TREASURY_OVERVIEW.asOfDate,
}

/* ==========================================================================
   Inventory & Cleaning Fixtures (Stage 4)
   ========================================================================== */

export const DEMO_INVENTORY_ITEMS: InventoryItem[] = [
  {
    id: 'inv-1',
    name: 'Refined Sunflower Cooking Oil',
    category: 'Kitchen Groceries & Staples',
    unit: 'L',
    isDiscrete: false,
    currentQuantityMilli: 800, // 0.8 L remaining (Low stock, threshold 2.0 L)
    minThresholdMilli: 2000,
    idealQuantityMilli: 5000,
    storageLocation: 'Kitchen Lower Shelf',
    notes: 'Fortune Sunlite 5L jar preferred',
    isArchived: false,
    createdByMembershipId: 'm1',
    createdByName: 'Rohan Sharma',
    createdAt: '2026-11-01T10:00:00.000Z',
    lastRestockedAt: '2026-11-10T14:30:00.000Z',
    lastConsumedAt: '2026-11-19T18:00:00.000Z',
  },
  {
    id: 'inv-2',
    name: 'Dishwasher Liquid Gel (500ml)',
    category: 'Cleaning & Housekeeping',
    unit: 'bottle',
    isDiscrete: true,
    currentQuantityMilli: 1000, // 1 bottle remaining (Critical! threshold 3 bottles)
    minThresholdMilli: 3000,
    idealQuantityMilli: 4000,
    storageLocation: 'Under Sink Cabinet',
    notes: 'Vim or Pril lemon gel',
    isArchived: false,
    createdByMembershipId: 'm2',
    createdByName: 'Arjun Verma',
    createdAt: '2026-11-01T10:00:00.000Z',
    lastRestockedAt: '2026-11-05T12:00:00.000Z',
    lastConsumedAt: '2026-11-18T09:30:00.000Z',
  },
  {
    id: 'inv-3',
    name: 'Heavy-Duty Garbage Bags (Pack of 30)',
    category: 'Waste Management',
    unit: 'packet',
    isDiscrete: true,
    currentQuantityMilli: 1000, // 1 packet left (Low stock, threshold 2 packets)
    minThresholdMilli: 2000,
    idealQuantityMilli: 3000,
    storageLocation: 'Utility Balcony Cupboard',
    notes: 'Black biodegradable large size',
    isArchived: false,
    createdByMembershipId: 'm5',
    createdByName: 'Sameer Patel',
    createdAt: '2026-11-01T10:00:00.000Z',
    lastConsumedAt: '2026-11-19T08:00:00.000Z',
  },
  {
    id: 'inv-4',
    name: 'Sona Masoori Raw Rice (25kg Bag)',
    category: 'Kitchen Groceries & Staples',
    unit: 'kg',
    isDiscrete: false,
    currentQuantityMilli: 18500, // 18.5 kg remaining (Normal stock, threshold 5.0 kg)
    minThresholdMilli: 5000,
    idealQuantityMilli: 25000,
    storageLocation: 'Dry Storage Drum',
    notes: 'Aged premium raw rice',
    isArchived: false,
    createdByMembershipId: 'm1',
    createdByName: 'Rohan Sharma',
    createdAt: '2026-11-01T10:00:00.000Z',
    lastRestockedAt: '2026-11-19T11:00:00.000Z',
    lastConsumedAt: '2026-11-20T13:00:00.000Z',
  },
  {
    id: 'inv-5',
    name: '20L Drinking Water Cans',
    category: 'Drinking Water',
    unit: 'can',
    isDiscrete: true,
    currentQuantityMilli: 3000, // 3 cans remaining (Normal stock, threshold 1 can)
    minThresholdMilli: 1000,
    idealQuantityMilli: 5000,
    storageLocation: 'Water Dispenser Corner',
    notes: 'Bisleri 20L delivery from vendor',
    isArchived: false,
    createdByMembershipId: 'm2',
    createdByName: 'Arjun Verma',
    createdAt: '2026-11-01T10:00:00.000Z',
    lastRestockedAt: '2026-11-17T16:00:00.000Z',
    lastConsumedAt: '2026-11-20T10:00:00.000Z',
  },
]

export const DEMO_INVENTORY_LOGS: StockLogRecord[] = [
  // inv-1 logs
  {
    id: 'stk-1',
    idempotencyKey: 'idemp-inv1-init',
    itemId: 'inv-1',
    itemName: 'Refined Sunflower Cooking Oil',
    unit: 'L',
    changeType: 'initial',
    quantityChangedMilli: 5000,
    previousQuantityMilli: 0,
    newQuantityMilli: 5000,
    performedByMembershipId: 'm1',
    performedByName: 'Rohan Sharma',
    timestamp: '2026-11-01T10:00:00.000Z',
    reason: 'Initial catalog stock entry',
  },
  {
    id: 'stk-2',
    idempotencyKey: 'idemp-inv1-use',
    itemId: 'inv-1',
    itemName: 'Refined Sunflower Cooking Oil',
    unit: 'L',
    changeType: 'consumption',
    quantityChangedMilli: -4200,
    previousQuantityMilli: 5000,
    newQuantityMilli: 800,
    performedByMembershipId: 'm2',
    performedByName: 'Arjun Verma',
    timestamp: '2026-11-19T18:00:00.000Z',
    reason: 'Household cooking consumption for the past fortnight',
  },
  // inv-2 logs
  {
    id: 'stk-3',
    idempotencyKey: 'idemp-inv2-init',
    itemId: 'inv-2',
    itemName: 'Dishwasher Liquid Gel (500ml)',
    unit: 'bottle',
    changeType: 'initial',
    quantityChangedMilli: 3000,
    previousQuantityMilli: 0,
    newQuantityMilli: 3000,
    performedByMembershipId: 'm2',
    performedByName: 'Arjun Verma',
    timestamp: '2026-11-01T10:00:00.000Z',
    reason: 'Initial catalog stock entry',
  },
  {
    id: 'stk-4',
    idempotencyKey: 'idemp-inv2-use',
    itemId: 'inv-2',
    itemName: 'Dishwasher Liquid Gel (500ml)',
    unit: 'bottle',
    changeType: 'consumption',
    quantityChangedMilli: -2000,
    previousQuantityMilli: 3000,
    newQuantityMilli: 1000,
    performedByMembershipId: 'm3',
    performedByName: 'Karthik Nair',
    timestamp: '2026-11-18T09:30:00.000Z',
    reason: 'Kitchen sink dishwashing use',
  },
  // inv-3 logs
  {
    id: 'stk-5',
    idempotencyKey: 'idemp-inv3-init',
    itemId: 'inv-3',
    itemName: 'Heavy-Duty Garbage Bags (Pack of 30)',
    unit: 'packet',
    changeType: 'initial',
    quantityChangedMilli: 2000,
    previousQuantityMilli: 0,
    newQuantityMilli: 2000,
    performedByMembershipId: 'm5',
    performedByName: 'Sameer Patel',
    timestamp: '2026-11-01T10:00:00.000Z',
    reason: 'Initial catalog stock entry',
  },
  {
    id: 'stk-6',
    idempotencyKey: 'idemp-inv3-use',
    itemId: 'inv-3',
    itemName: 'Heavy-Duty Garbage Bags (Pack of 30)',
    unit: 'packet',
    changeType: 'consumption',
    quantityChangedMilli: -1000,
    previousQuantityMilli: 2000,
    newQuantityMilli: 1000,
    performedByMembershipId: 'm5',
    performedByName: 'Sameer Patel',
    timestamp: '2026-11-19T08:00:00.000Z',
    reason: 'Kitchen and bathroom dustbin replenishment',
  },
  // inv-4 logs (with referential link to exp-1)
  {
    id: 'stk-7',
    idempotencyKey: 'idemp-inv4-init',
    itemId: 'inv-4',
    itemName: 'Sona Masoori Raw Rice (25kg Bag)',
    unit: 'kg',
    changeType: 'initial',
    quantityChangedMilli: 25000,
    previousQuantityMilli: 0,
    newQuantityMilli: 25000,
    performedByMembershipId: 'm1',
    performedByName: 'Rohan Sharma',
    timestamp: '2026-11-01T10:00:00.000Z',
    reason: 'Initial catalog stock entry',
  },
  {
    id: 'stk-8',
    idempotencyKey: 'idemp-inv4-use',
    itemId: 'inv-4',
    itemName: 'Sona Masoori Raw Rice (25kg Bag)',
    unit: 'kg',
    changeType: 'consumption',
    quantityChangedMilli: -6500,
    previousQuantityMilli: 25000,
    newQuantityMilli: 18500,
    performedByMembershipId: 'm4',
    performedByName: 'Vikram Sengupta',
    timestamp: '2026-11-20T13:00:00.000Z',
    reason: 'Daily kitchen cooking consumption',
  },
  // inv-5 logs (with referential link to exp-3)
  {
    id: 'stk-9',
    idempotencyKey: 'idemp-inv5-init',
    itemId: 'inv-5',
    itemName: '20L Drinking Water Cans',
    unit: 'can',
    changeType: 'initial',
    quantityChangedMilli: 1000,
    previousQuantityMilli: 0,
    newQuantityMilli: 1000,
    performedByMembershipId: 'm2',
    performedByName: 'Arjun Verma',
    timestamp: '2026-11-01T10:00:00.000Z',
    reason: 'Initial catalog stock entry',
  },
  {
    id: 'stk-10',
    idempotencyKey: 'idemp-inv5-restock',
    itemId: 'inv-5',
    itemName: '20L Drinking Water Cans',
    unit: 'can',
    changeType: 'restock',
    quantityChangedMilli: 5000,
    previousQuantityMilli: 1000,
    newQuantityMilli: 6000,
    performedByMembershipId: 'm2',
    performedByName: 'Arjun Verma',
    timestamp: '2026-11-17T16:00:00.000Z',
    reason: 'Water vendor refill delivered',
    linkedExpenseId: 'exp-3', // Linked to Drinking Water Cans expense
  },
  {
    id: 'stk-11',
    idempotencyKey: 'idemp-inv5-use',
    itemId: 'inv-5',
    itemName: '20L Drinking Water Cans',
    unit: 'can',
    changeType: 'consumption',
    quantityChangedMilli: -3000,
    previousQuantityMilli: 6000,
    newQuantityMilli: 3000,
    performedByMembershipId: 'm6',
    performedByName: 'Deepak Joshi',
    timestamp: '2026-11-20T10:00:00.000Z',
    reason: '3 water cans consumed over the week',
  },
]

export const DEMO_INVENTORY_ALERTS: InventoryAlert[] = [
  {
    id: 'inv-1',
    name: 'Refined Cooking Oil (5L)',
    category: 'Kitchen Essentials',
    currentLevel: 'Low',
    unit: '0.8 L remaining',
    urgency: 'high',
  },
  {
    id: 'inv-2',
    name: 'Dishwasher Gel & Bar',
    category: 'Cleaning',
    currentLevel: 'Critical',
    unit: '1 bottle left',
    urgency: 'high',
  },
  {
    id: 'inv-3',
    name: 'Heavy-duty Garbage Bags',
    category: 'Waste Management',
    currentLevel: 'Low',
    unit: '3 bags left in pack',
    urgency: 'medium',
  },
]

export const DEMO_CLEANING_DUTIES: CleaningDuty[] = [
  {
    id: 'cln-1',
    taskName: 'Kitchen Counter, Stove & Sink Deep Clean',
    area: 'Kitchen',
    assignedTo: 'Sameer Patel',
    dueDate: 'Today, 20 Nov',
    status: 'Pending',
  },
  {
    id: 'cln-2',
    taskName: 'Living Room & Dining Area Sweep/Mop',
    area: 'Common Area',
    assignedTo: 'Deepak Joshi',
    dueDate: 'Tomorrow, 21 Nov',
    status: 'Upcoming',
  },
  {
    id: 'cln-3',
    taskName: 'Waste Bin Disposal & Sanitization',
    area: 'Balcony & Utility',
    assignedTo: 'Nikhil Roy',
    dueDate: '22 Nov',
    status: 'Upcoming',
  },
]

/* ==========================================================================
   Cleaning Management Fixtures (Stage 5)
   ========================================================================== */

export const DEMO_CLEANING_TEMPLATES: CleaningTaskTemplate[] = [
  {
    id: 'cln-tmpl-1',
    title: 'Kitchen Counters, Stove & Sink Deep Scrub',
    area: 'Kitchen',
    description: 'Degrease gas stove burners, scrub sink basins, wipe granite counters and backsplash tiles.',
    instructions: 'Use Colin for stove glass surface; Vim gel and green scrub pad for sink.',
    estimatedMinutes: 35,
    schedule: {
      type: 'weekly_weekdays',
      startDate: '2026-11-01',
      weekInterval: 1,
      selectedWeekdays: [3, 6], // Wednesday and Saturday
    },
    scheduleVersion: 1,
    isActive: true,
    defaultAssigneeMemberIds: ['m1', 'm5'],
    createdAt: '2026-11-01T10:00:00.000Z',
    createdByMembershipId: 'm1',
    createdByName: 'Rohan Sharma',
  },
  {
    id: 'cln-tmpl-2',
    title: 'Living Room & Dining Area Sweep/Mop',
    area: 'Living Room & Dining',
    description: 'Dry sweep hallway and living area, followed by wet floor mopping with disinfectant floor cleaner.',
    instructions: 'Add two capfuls of Lizol citrus disinfectant to the mop bucket.',
    estimatedMinutes: 30,
    schedule: {
      type: 'weekly_weekdays',
      startDate: '2026-11-01',
      weekInterval: 1,
      selectedWeekdays: [6], // Saturday
    },
    scheduleVersion: 1,
    isActive: true,
    defaultAssigneeMemberIds: ['m6'],
    createdAt: '2026-11-01T10:00:00.000Z',
    createdByMembershipId: 'm2',
    createdByName: 'Arjun Verma',
  },
  {
    id: 'cln-tmpl-3',
    title: 'Waste Bin Disposal & Sanitization',
    area: 'Balcony & Utility',
    description: 'Clear wet and dry waste bins from kitchen and rooms, tie garbage bags, and replace bin liners.',
    instructions: 'Ensure green bin is strictly for vegetable/food waste and black bin for packaging dry waste.',
    estimatedMinutes: 15,
    schedule: {
      type: 'interval_days',
      startDate: '2026-11-01',
      intervalDays: 2,
    },
    scheduleVersion: 1,
    isActive: true,
    defaultAssigneeMemberIds: ['m7'],
    createdAt: '2026-11-01T10:00:00.000Z',
    createdByMembershipId: 'm5',
    createdByName: 'Sameer Patel',
  },
  {
    id: 'cln-tmpl-4',
    title: 'Common Bathrooms Scrub & Disinfection',
    area: 'Bathrooms',
    description: 'Scrub bathroom tiles, commodes, washbasins, and wipe dry glass mirror shelves.',
    instructions: 'Use Harpic blue for commode and Harpic red/yellow for washbasin and wall tiles.',
    estimatedMinutes: 45,
    schedule: {
      type: 'weekly_weekdays',
      startDate: '2026-11-01',
      weekInterval: 1,
      selectedWeekdays: [7], // Sunday
    },
    scheduleVersion: 1,
    isActive: true,
    defaultAssigneeMemberIds: ['m2', 'm3'],
    createdAt: '2026-11-01T10:00:00.000Z',
    createdByMembershipId: 'm1',
    createdByName: 'Rohan Sharma',
  },
  {
    id: 'cln-tmpl-5',
    title: 'Refrigerator & Microwave Deep Wipe',
    area: 'Kitchen',
    description: 'Discard expired items, wipe glass shelves with warm water and lemon, wipe microwave cavity.',
    instructions: 'Do not use harsh chemical sprays inside microwave cavity.',
    estimatedMinutes: 25,
    schedule: {
      type: 'monthly_dates',
      startDate: '2026-11-01',
      monthInterval: 1,
      monthDays: [1, 15],
      handleShorterMonths: 'clamp_to_last_day',
    },
    scheduleVersion: 1,
    isActive: true,
    defaultAssigneeMemberIds: ['m4'],
    createdAt: '2026-11-01T10:00:00.000Z',
    createdByMembershipId: 'm2',
    createdByName: 'Arjun Verma',
  },
]

export const DEMO_CLEANING_DUTY_ASSIGNMENTS: CleaningDutyAssignment[] = [
  // 1. Overdue duty (due 19 Nov, today is 20 Nov)
  {
    id: 'duty-1',
    idempotencyKey: 'cln-cln-tmpl-3-v1-2026-11-19',
    templateId: 'cln-tmpl-3',
    templateScheduleVersion: 1,
    title: 'Waste Bin Disposal & Sanitization',
    area: 'Balcony & Utility',
    instructions: 'Ensure green bin is strictly for vegetable/food waste and black bin for packaging dry waste.',
    estimatedMinutes: 15,
    assignedMemberIds: ['m7'],
    assignedMemberNames: ['Nikhil Roy'],
    assignedByMembershipId: 'm5',
    assignedByName: 'Sameer Patel',
    assignedAt: '2026-11-17T10:00:00.000Z',
    dueDate: '2026-11-19',
    occurrenceOrdinal: 10,
    status: 'pending',
    reassignmentHistory: [],
  },
  // 2. Due today (20 Nov)
  {
    id: 'duty-2',
    idempotencyKey: 'cln-cln-tmpl-1-v1-2026-11-20',
    templateId: 'cln-tmpl-1',
    templateScheduleVersion: 1,
    title: 'Kitchen Counters, Stove & Sink Deep Scrub',
    area: 'Kitchen',
    instructions: 'Use Colin for stove glass surface; Vim gel and green scrub pad for sink.',
    estimatedMinutes: 35,
    assignedMemberIds: ['m5'],
    assignedMemberNames: ['Sameer Patel'],
    assignedByMembershipId: 'm1',
    assignedByName: 'Rohan Sharma',
    assignedAt: '2026-11-18T10:00:00.000Z',
    dueDate: '2026-11-20',
    occurrenceOrdinal: 6,
    status: 'pending',
    reassignmentHistory: [],
  },
  // 3. Due tomorrow / upcoming (21 Nov)
  {
    id: 'duty-3',
    idempotencyKey: 'cln-cln-tmpl-2-v1-2026-11-21',
    templateId: 'cln-tmpl-2',
    templateScheduleVersion: 1,
    title: 'Living Room & Dining Area Sweep/Mop',
    area: 'Living Room & Dining',
    instructions: 'Add two capfuls of Lizol citrus disinfectant to the mop bucket.',
    estimatedMinutes: 30,
    assignedMemberIds: ['m6'],
    assignedMemberNames: ['Deepak Joshi'],
    assignedByMembershipId: 'm2',
    assignedByName: 'Arjun Verma',
    assignedAt: '2026-11-18T10:00:00.000Z',
    dueDate: '2026-11-21',
    occurrenceOrdinal: 3,
    status: 'pending',
    reassignmentHistory: [],
  },
  // 4. Upcoming multi-member duty (22 Nov)
  {
    id: 'duty-4',
    idempotencyKey: 'cln-cln-tmpl-4-v1-2026-11-22',
    templateId: 'cln-tmpl-4',
    templateScheduleVersion: 1,
    title: 'Common Bathrooms Scrub & Disinfection',
    area: 'Bathrooms',
    instructions: 'Use Harpic blue for commode and Harpic red/yellow for washbasin and wall tiles.',
    estimatedMinutes: 45,
    assignedMemberIds: ['m2', 'm3'],
    assignedMemberNames: ['Arjun Verma', 'Karthik Nair'],
    assignedByMembershipId: 'm1',
    assignedByName: 'Rohan Sharma',
    assignedAt: '2026-11-18T10:00:00.000Z',
    dueDate: '2026-11-22',
    occurrenceOrdinal: 3,
    status: 'pending',
    reassignmentHistory: [],
  },
  // 5. Completed duty earlier this week (17 Nov)
  {
    id: 'duty-5',
    idempotencyKey: 'cln-cln-tmpl-3-v1-2026-11-17',
    templateId: 'cln-tmpl-3',
    templateScheduleVersion: 1,
    title: 'Waste Bin Disposal & Sanitization',
    area: 'Balcony & Utility',
    instructions: 'Ensure green bin is strictly for vegetable/food waste and black bin for packaging dry waste.',
    estimatedMinutes: 15,
    assignedMemberIds: ['m7'],
    assignedMemberNames: ['Nikhil Roy'],
    assignedByMembershipId: 'm5',
    assignedByName: 'Sameer Patel',
    assignedAt: '2026-11-15T10:00:00.000Z',
    dueDate: '2026-11-17',
    occurrenceOrdinal: 9,
    status: 'completed',
    completedAt: '2026-11-17T18:45:00.000Z',
    completedByMembershipId: 'm7',
    completedByName: 'Nikhil Roy',
    completionNotes: 'Bins thoroughly washed and fresh liners placed.',
    reassignmentHistory: [],
  },
  // 6. Completed duty (14 Nov) with reassignment history
  {
    id: 'duty-6',
    idempotencyKey: 'cln-cln-tmpl-1-v1-2026-11-14',
    templateId: 'cln-tmpl-1',
    templateScheduleVersion: 1,
    title: 'Kitchen Counters, Stove & Sink Deep Scrub',
    area: 'Kitchen',
    instructions: 'Use Colin for stove glass surface; Vim gel and green scrub pad for sink.',
    estimatedMinutes: 35,
    assignedMemberIds: ['m1'],
    assignedMemberNames: ['Rohan Sharma'],
    assignedByMembershipId: 'm1',
    assignedByName: 'Rohan Sharma',
    assignedAt: '2026-11-12T10:00:00.000Z',
    dueDate: '2026-11-14',
    occurrenceOrdinal: 5,
    status: 'completed',
    completedAt: '2026-11-14T20:30:00.000Z',
    completedByMembershipId: 'm1',
    completedByName: 'Rohan Sharma',
    completionNotes: 'Burners descaled with vinegar.',
    reassignmentHistory: [
      {
        id: 'reassign-hist-1',
        previousAssigneeMemberIds: ['m5'],
        previousAssigneeNames: ['Sameer Patel'],
        newAssigneeMemberIds: ['m1'],
        newAssigneeNames: ['Rohan Sharma'],
        reassignedByMembershipId: 'm5',
        reassignedByName: 'Sameer Patel',
        reassignedAt: '2026-11-13T14:00:00.000Z',
        reason: 'Sameer was working late shift on Friday.',
      },
    ],
  },
  // 7. Cancelled duty
  {
    id: 'duty-7',
    idempotencyKey: 'cln-adhoc-balcony-plants-2026-11-18',
    title: 'Balcony Flower Pots Weeding & Scrub',
    area: 'Balcony & Utility',
    instructions: 'Clear dry fallen leaves and wipe railing ledge.',
    estimatedMinutes: 20,
    assignedMemberIds: ['m2'],
    assignedMemberNames: ['Arjun Verma'],
    assignedByMembershipId: 'm1',
    assignedByName: 'Rohan Sharma',
    assignedAt: '2026-11-16T10:00:00.000Z',
    dueDate: '2026-11-18',
    status: 'cancelled',
    cancelledAt: '2026-11-18T09:30:00.000Z',
    cancelledByMembershipId: 'm2',
    cancelledByName: 'Arjun Verma',
    cancellationReason: 'Heavy seasonal rainfall soaked the balcony; weeding postponed.',
    reassignmentHistory: [],
  },
]

/* ==========================================================================
   Bills & Rent Fixtures (Stage 6)
   ========================================================================== */

/**
 * Household Collector QR Configuration (Supports initially empty QR image state)
 * Does NOT invent or hardcode a fake QR image path.
 */
export const DEMO_COLLECTOR_QR_CONFIG: HouseholdCollectorQrConfig = {
  collectorMembershipId: 'm2',
  collectorName: 'Arjun Verma',
  upiId: 'demo-collector@upi.invalid',
  notes: 'Primary household utility collector. Manual UPI payment verification required.',
}

/**
 * Demo Financial Obligations (Electricity, Piped Gas, Rent)
 */
export const DEMO_OBLIGATIONS: FinancialObligation[] = [
  // 1. Electricity Bill (Tata Power) - Fully Allocated across 7 Residents
  {
    id: 'ob-demo-elec-2026-11',
    category: 'electricity_bill',
    title: 'Electricity Bill - November 2026',
    billingPeriodStart: '2026-10-01',
    billingPeriodEnd: '2026-10-31',
    dueDate: '2026-11-25',
    totalAmountPaise: 420000, // ₹4,200.00 (7 residents * ₹600.00)
    totalAmount: 4200,
    currency: 'INR',
    shares: [
      { memberId: 'm1', sharePaise: 60000, notes: 'Rohan share' },
      { memberId: 'm2', sharePaise: 60000, notes: 'Arjun share' },
      { memberId: 'm3', sharePaise: 60000, notes: 'Karthik share' },
      { memberId: 'm4', sharePaise: 60000, notes: 'Tanmay share' },
      { memberId: 'm5', sharePaise: 60000, notes: 'Sameer share' },
      { memberId: 'm6', sharePaise: 60000, notes: 'Deepak share' },
      { memberId: 'm7', sharePaise: 60000, notes: 'Nikhil share' },
    ],
    providerName: 'Tata Power',
    consumerAccountNumber: 'CA-9021849201',
    notes: 'Sample billing cycle for flat 302 electricity consumption.',
    createdByMembershipId: 'm1',
    createdAt: '2026-11-05T10:00:00.000Z',
  },
  // 2. Piped Gas Bill (Mahanagar Gas Ltd) - Allocated across 7 Residents
  {
    id: 'ob-demo-gas-2026-11',
    category: 'gas_bill',
    title: 'Piped Gas Bill - November 2026',
    billingPeriodStart: '2026-10-01',
    billingPeriodEnd: '2026-10-31',
    dueDate: '2026-11-28',
    totalAmountPaise: 140000, // ₹1,400.00 (7 residents * ₹200.00)
    totalAmount: 1400,
    currency: 'INR',
    shares: [
      { memberId: 'm1', sharePaise: 20000, notes: 'Rohan share' },
      { memberId: 'm2', sharePaise: 20000, notes: 'Arjun share' },
      { memberId: 'm3', sharePaise: 20000, notes: 'Karthik share' },
      { memberId: 'm4', sharePaise: 20000, notes: 'Tanmay share' },
      { memberId: 'm5', sharePaise: 20000, notes: 'Sameer share' },
      { memberId: 'm6', sharePaise: 20000, notes: 'Deepak share' },
      { memberId: 'm7', sharePaise: 20000, notes: 'Nikhil share' },
    ],
    providerName: 'Mahanagar Gas Ltd',
    consumerAccountNumber: 'MGL-40192841',
    notes: 'Bi-monthly piped gas bill for kitchen stove.',
    createdByMembershipId: 'm2',
    createdAt: '2026-11-06T11:00:00.000Z',
  },
  // 3. House Rent Cycle (December 2026) - 7 Residents
  {
    id: 'ob-demo-rent-2026-12',
    category: 'rent_cycle',
    title: 'House Rent - December 2026',
    billingPeriodStart: '2026-12-01',
    billingPeriodEnd: '2026-12-31',
    dueDate: '2026-12-05',
    totalAmountPaise: 7000000, // ₹70,000.00 (7 residents * ₹10,000.00)
    totalAmount: 70000,
    currency: 'INR',
    shares: [
      { memberId: 'm1', sharePaise: 1000000, notes: 'Room 1A' },
      { memberId: 'm2', sharePaise: 1000000, notes: 'Room 1B' },
      { memberId: 'm3', sharePaise: 1000000, notes: 'Room 2A' },
      { memberId: 'm4', sharePaise: 1000000, notes: 'Room 2B' },
      { memberId: 'm5', sharePaise: 1000000, notes: 'Room 3A' },
      { memberId: 'm6', sharePaise: 1000000, notes: 'Room 3B' },
      { memberId: 'm7', sharePaise: 1000000, notes: 'Room 4A' },
    ],
    providerName: 'Landlord (Mr. Sharma)',
    notes: 'December monthly rental for Greenwood Heights #302.',
    createdByMembershipId: 'm1',
    createdAt: '2026-11-15T09:00:00.000Z',
  },
]

/**
 * Demo Contribution Allocations
 * References confirmed contributions in DEMO_CONTRIBUTIONS:
 * - cnt-1 (m1: Rohan Sharma, confirmed)
 * - cnt-2 (m3: Karthik Nair, confirmed)
 * - cnt-3 (m4: Tanmay Gupta, confirmed)
 */
export const DEMO_ALLOCATIONS: ObligationContributionAllocation[] = [
  {
    id: 'alloc-demo-1',
    contributionId: 'cnt-1',
    obligationId: 'ob-demo-gas-2026-11',
    targetMemberId: 'm1',
    amountPaise: 20000, // ₹200.00 allocated toward Rohan gas share
    allocatedAt: '2026-11-06T12:00:00.000Z',
    allocatedByMembershipId: 'm2',
  },
  {
    id: 'alloc-demo-2',
    contributionId: 'cnt-2',
    obligationId: 'ob-demo-gas-2026-11',
    targetMemberId: 'm3',
    amountPaise: 20000, // ₹200.00 allocated toward Karthik gas share
    allocatedAt: '2026-11-06T12:05:00.000Z',
    allocatedByMembershipId: 'm2',
  },
  {
    id: 'alloc-demo-3',
    contributionId: 'cnt-3',
    obligationId: 'ob-demo-gas-2026-11',
    targetMemberId: 'm4',
    amountPaise: 20000, // ₹200.00 allocated toward Tanmay gas share
    allocatedAt: '2026-11-06T12:10:00.000Z',
    allocatedByMembershipId: 'm2',
  },
]

/**
 * Demo Derived Peer Claims
 * Represents out-of-pocket payment by Rohan Sharma (m1) for Tata Power Electricity Bill (ob-demo-elec-2026-11).
 * Rohan paid for all residents, creating claims against co-residents.
 */
export const DEMO_PEER_CLAIMS: DerivedPeerClaim[] = [
  {
    id: 'claim-demo-elec-m2',
    expenseId: 'exp-demo-elec-2026-11',
    obligationId: 'ob-demo-elec-2026-11',
    debtorMemberId: 'm2',
    creditorMemberId: 'm1',
    claimAmountPaise: 60000,
    createdAt: '2026-11-05T12:00:00.000Z',
  },
  {
    id: 'claim-demo-elec-m3',
    expenseId: 'exp-demo-elec-2026-11',
    obligationId: 'ob-demo-elec-2026-11',
    debtorMemberId: 'm3',
    creditorMemberId: 'm1',
    claimAmountPaise: 60000,
    createdAt: '2026-11-05T12:00:00.000Z',
  },
  {
    id: 'claim-demo-elec-m4',
    expenseId: 'exp-demo-elec-2026-11',
    obligationId: 'ob-demo-elec-2026-11',
    debtorMemberId: 'm4',
    creditorMemberId: 'm1',
    claimAmountPaise: 60000,
    createdAt: '2026-11-05T12:00:00.000Z',
  },
  {
    id: 'claim-demo-elec-m5',
    expenseId: 'exp-demo-elec-2026-11',
    obligationId: 'ob-demo-elec-2026-11',
    debtorMemberId: 'm5',
    creditorMemberId: 'm1',
    claimAmountPaise: 60000,
    createdAt: '2026-11-05T12:00:00.000Z',
  },
  {
    id: 'claim-demo-elec-m6',
    expenseId: 'exp-demo-elec-2026-11',
    obligationId: 'ob-demo-elec-2026-11',
    debtorMemberId: 'm6',
    creditorMemberId: 'm1',
    claimAmountPaise: 60000,
    createdAt: '2026-11-05T12:00:00.000Z',
  },
  {
    id: 'claim-demo-elec-m7',
    expenseId: 'exp-demo-elec-2026-11',
    obligationId: 'ob-demo-elec-2026-11',
    debtorMemberId: 'm7',
    creditorMemberId: 'm1',
    claimAmountPaise: 60000,
    createdAt: '2026-11-05T12:00:00.000Z',
  },
]

/**
 * Demo Member Settlements
 * Distinct settlement lifecycle states:
 * 1. Confirmed UPI reimbursement (Arjun Verma -> Rohan Sharma)
 * 2. Pending confirmation reimbursement (Karthik Nair -> Rohan Sharma)
 * 3. Confirmed Cash reimbursement (Tanmay Gupta -> Rohan Sharma)
 */
export const DEMO_SETTLEMENTS: MemberSettlementRecord[] = [
  // 1. Confirmed online reimbursement via UPI
  {
    id: 'settle-demo-1',
    idempotencyKey: 'idem-settle-demo-elec-m2',
    obligationId: 'ob-demo-elec-2026-11',
    claimId: 'claim-demo-elec-m2',
    debtorMemberId: 'm2',
    creditorMemberId: 'm1',
    amountPaise: 60000, // ₹600.00
    paymentMethod: 'upi',
    paymentReference: 'DEMO-SIMULATED-UPI-REF-01',
    paymentDate: '2026-11-12',
    notes: 'Demo: Reimbursed Rohan for electricity bill share via UPI',
    status: 'confirmed',
    submittedAt: '2026-11-12T14:30:00.000Z',
    confirmedAt: '2026-11-12T15:00:00.000Z',
    confirmedByMemberId: 'm1',
  },
  // 2. Pending confirmation: Submitted by debtor, awaiting creditor confirmation
  // MUST NOT reduce debtor claim liability until confirmed by creditor!
  {
    id: 'settle-demo-2',
    idempotencyKey: 'idem-settle-demo-elec-m3',
    obligationId: 'ob-demo-elec-2026-11',
    claimId: 'claim-demo-elec-m3',
    debtorMemberId: 'm3',
    creditorMemberId: 'm1',
    amountPaise: 60000, // ₹600.00
    paymentMethod: 'upi',
    paymentReference: 'DEMO-SIMULATED-UPI-REF-02',
    paymentDate: '2026-11-20',
    notes: 'Demo: Payment submitted, pending creditor verification',
    status: 'pending_confirmation',
    submittedAt: '2026-11-20T18:00:00.000Z',
  },
  // 3. Confirmed cash reimbursement
  {
    id: 'settle-demo-3',
    idempotencyKey: 'idem-settle-demo-elec-m4',
    obligationId: 'ob-demo-elec-2026-11',
    claimId: 'claim-demo-elec-m4',
    debtorMemberId: 'm4',
    creditorMemberId: 'm1',
    amountPaise: 60000, // ₹600.00
    paymentMethod: 'cash',
    paymentReference: 'DEMO-CASH-HANDOVER-04',
    paymentDate: '2026-11-14',
    notes: 'Demo: Cash handed over to Rohan',
    status: 'confirmed',
    submittedAt: '2026-11-14T20:00:00.000Z',
    confirmedAt: '2026-11-14T20:15:00.000Z',
    confirmedByMemberId: 'm1',
  },
]

/**
 * Demo Centralized Root Financial State (Stage 6 Step 2)
 */
export const DEMO_ROOT_FINANCIAL_STATE: RootFinancialState = {
  accounts: DEMO_TREASURY_ACCOUNTS,
  contributions: DEMO_CONTRIBUTIONS,
  allocations: DEMO_ALLOCATIONS,
  obligations: DEMO_OBLIGATIONS,
  expenses: DEMO_RECENT_EXPENSES,
  transfers: DEMO_TREASURY_TRANSFERS,
  peerClaims: DEMO_PEER_CLAIMS,
  memberSettlements: DEMO_SETTLEMENTS,
  memberSettlementReversals: [],
  memberSettlementReversalOfReversals: [],
  peerCredits: [],
  peerCreditExpansions: [],
  peerCreditResolutions: [],
  peerCreditResolutionReversals: [],
  peerCreditExtinguishments: [],
  peerCreditRestorationOffsets: [],
  peerCreditSettlementReversalAdjustments: [],
  peerCreditSettlementReversalAdjustmentRestorations: [],
  obligationCorrectionApplications: [],
  notifications: [],
  notificationReadState: {},
  processedActionIds: [],
}
