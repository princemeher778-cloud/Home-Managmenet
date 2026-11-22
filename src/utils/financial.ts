import type {
  DisbursementChannel,
  ExpenseItem,
  ExpenseParticipantShare,
  ExpenseValidationResult,
  TreasuryAccount,
  TreasuryOverview,
} from '../types/index.ts'

/**
 * Financial Precision & Identifier Utilities
 * 
 * Rules:
 * - All financial additions, subtractions, and validations use integer paise (1 INR = 100 paise).
 * - Avoids IEEE-754 floating-point arithmetic errors.
 * - Provides collision-resistant unique identifiers.
 */

/**
 * Converts Rupees (number or decimal string, e.g. 10.25) to integer paise (e.g. 1025).
 */
export function rupeesToPaise(rupees: number | string): number {
  const num = typeof rupees === 'string' ? parseFloat(rupees) : rupees
  if (isNaN(num)) return 0
  return Math.round(num * 100)
}

/**
 * Converts integer paise back to decimal Rupees (e.g. 1025 paise -> 10.25 INR).
 */
export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100
}

/**
 * Formats integer paise as standard currency display string.
 */
export function formatPaise(paise: number, currency = '₹'): string {
  const rupees = paiseToRupees(paise)
  const isWhole = Math.abs(paise % 100) === 0
  return `${currency}${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Generates a collision-resistant unique identifier for frontend demo state.
 */
export function generateEntityId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  // Fallback for environments where crypto.randomUUID is not available
  const randomPart = Math.random().toString(36).substring(2, 10)
  const timePart = Date.now().toString(36)
  return `${prefix}-${timePart}-${randomPart}`
}

/**
 * Calculates equal participant splits in integer paise with deterministic remainder distribution.
 * 
 * Invariants:
 * 1. Sum of all sharePaise strictly equals amountPaise (no fractional penny lost).
 * 2. Remainder paise (amountPaise % count) is assigned 1-paise-per-participant starting from index 0.
 * 3. Settlement tracking:
 *    - For member_out_of_pocket: Payer's own share is 'settled' if they participate; other shares are 'unsettled'.
 *    - If payer does not participate, all shares are 'unsettled'.
 *    - For treasury disbursements: All shares begin as 'unsettled'.
 */
export function calculateEqualExpenseSplits(
  amountPaise: number,
  participants: { id: string; name: string }[],
  payerMemberId: string,
  disbursementChannel: DisbursementChannel
): ExpenseParticipantShare[] {
  const count = participants.length
  if (count === 0 || amountPaise <= 0) return []

  const baseShare = Math.floor(amountPaise / count)
  let remainder = amountPaise % count

  return participants.map((participant) => {
    const extraPaise = remainder > 0 ? 1 : 0
    if (remainder > 0) remainder--

    const sharePaise = baseShare + extraPaise
    const isPayer = participant.id === payerMemberId

    const settlementStatus: 'unsettled' | 'settled' =
      disbursementChannel === 'member_out_of_pocket' && isPayer
        ? 'settled'
        : 'unsettled'

    return {
      memberId: participant.id,
      memberName: participant.name,
      sharePaise,
      shareAmount: paiseToRupees(sharePaise),
      settlementStatus,
      settledAt: settlementStatus === 'settled' ? 'At time of purchase' : undefined,
    }
  })
}

/**
 * Validates an expense item prior to commitment.
 * Enforces positive amount, valid payer, non-empty participant list,
 * exact paise split parity, and sufficient treasury balance for disbursed treasury expenses.
 */
export function validateExpense(
  expense: Partial<ExpenseItem>,
  accounts: TreasuryAccount[],
  overview: TreasuryOverview
): ExpenseValidationResult {
  if (!expense.title || expense.title.trim().length === 0) {
    return { isValid: false, errorMessage: 'Expense title is required.' }
  }

  const amountPaise = expense.amountPaise ?? (expense.amount ? rupeesToPaise(expense.amount) : 0)
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    return { isValid: false, errorMessage: 'Expense amount must be a positive valid number.' }
  }

  if (!expense.payerMemberId) {
    return { isValid: false, errorMessage: 'A valid purchaser/payer must be selected.' }
  }

  if (!expense.participantMemberIds || expense.participantMemberIds.length === 0) {
    return { isValid: false, errorMessage: 'At least one eligible participant must be included.' }
  }

  // Exact paise split parity check
  if (expense.splits && expense.splits.length > 0) {
    const totalSplitPaise = expense.splits.reduce((sum, s) => sum + s.sharePaise, 0)
    if (totalSplitPaise !== amountPaise) {
      return {
        isValid: false,
        errorMessage: `Split allocation total (₹${paiseToRupees(totalSplitPaise)}) does not equal expense amount (₹${paiseToRupees(amountPaise)}).`,
      }
    }
  }

  // Treasury balance validation for disbursed treasury expenses
  if (
    expense.disbursementChannel !== 'member_out_of_pocket' &&
    expense.disbursementStatus === 'disbursed'
  ) {
    if (!expense.disbursedFromAccountId) {
      return { isValid: false, errorMessage: 'A treasury disbursement account must be selected.' }
    }

    const account = accounts.find((a) => a.id === expense.disbursedFromAccountId && a.isActive)
    if (!account) {
      return { isValid: false, errorMessage: 'Selected treasury account is invalid or inactive.' }
    }

    const summary = overview.accounts.find((s) => s.account.id === expense.disbursedFromAccountId)
    const availablePaise = summary?.currentBalancePaise ?? 0

    if (amountPaise > availablePaise) {
      const availRupees = paiseToRupees(availablePaise).toLocaleString('en-IN')
      const reqRupees = paiseToRupees(amountPaise).toLocaleString('en-IN')
      return {
        isValid: false,
        errorMessage: `Insufficient funds in ${account.name}. Available: ₹${availRupees}, required: ₹${reqRupees}. Please reduce amount, record as pending disbursement, or use Member Out-of-Pocket.`,
      }
    }
  }

  return { isValid: true }
}
