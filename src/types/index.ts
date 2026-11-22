export type NavSection =
  | 'dashboard'
  | 'home-fund'
  | 'bills-rent'
  | 'expenses'
  | 'inventory'
  | 'cleaning'
  | 'members'
  | 'activity'

export type MembershipStatus = 'active' | 'paused' | 'departed'
export type ParticipationTier = 'resident' | 'food_only' | 'guest' | 'custom'

export interface HouseholdMember {
  id: string
  name: string
  avatarInitial: string
  status: MembershipStatus
  participationTier: ParticipationTier
  roomLabel?: string
  joinedDate: string
  departedDate?: string

  // Dynamic Capability Matrix (Independently configurable)
  isResident: boolean
  isFoodEligible: boolean
  isCleaningEligible: boolean
  isGeneralExpenseEligible: boolean
  isRentEligible: boolean

  /**
   * Optional custom split weight for future advanced expense rules.
   * NOTE: This is NEVER applied globally to all expenses. It will only be
   * evaluated when an expense explicitly chooses a weighted split method.
   */
  customExpenseWeight?: number
}

/* ==========================================================================
   Home Fund & Treasury Types (Stage 2)
   ========================================================================== */

export type TreasuryAccountType = 'personal_upi' | 'cash_box'

export interface TreasuryAccount {
  id: string
  name: string
  accountType: TreasuryAccountType
  custodianMembershipId: string
  custodianName: string
  upiId?: string
  recipientName?: string
  isActive: boolean
}

export type ContributionStatus =
  | 'pending_confirmation' // Submitted by contributor; awaiting custodian verification
  | 'confirmed'            // Verified by custodian; liquid & available
  | 'rejected'             // Disputed, duplicate, or unverified
  | 'refunded'             // Refunded to contributor

export type ContributionCategory =
  | 'general'
  | 'electricity'
  | 'pipeline_gas'
  | 'house_rent'

export interface FundContribution {
  id: string
  accountId: string
  contributorMembershipId: string
  contributorName: string
  amount: number
  date: string
  status: ContributionStatus
  category?: ContributionCategory
  transactionReference?: string // 12-digit UPI UTR or bank reference
  note?: string
  confirmedByMembershipId?: string
  confirmedByName?: string
  confirmedAt?: string
  rejectionReason?: string
  isRefundAdjustment?: boolean // If true, represents an explicit refund/reversal record
  originalContributionId?: string // References original contribution if this is a refund adjustment
  isVoided?: boolean
  voidReason?: string
}

export type TreasuryTransferStatus = 'confirmed' | 'pending' | 'rejected' | 'voided'

export interface TreasuryTransfer {
  id: string
  fromAccountId: string
  toAccountId: string
  fromAccountName: string
  toAccountName: string
  amount: number
  date: string
  purpose: string
  reference?: string
  authorizedByMembershipId: string
  authorizedByName: string
  status?: TreasuryTransferStatus
}

export type DisbursementChannel =
  | 'treasury_personal_upi' // Directly reduces personal UPI treasury balance
  | 'treasury_cash_box'     // Directly reduces physical cash box balance
  | 'member_out_of_pocket'   // Paid privately by member; does NOT reduce treasury balance

export type ExpenseDisbursementStatus = 'pending' | 'disbursed'

export interface AccountBalanceSummary {
  account: TreasuryAccount
  currentBalance: number
  currentBalancePaise: number
  pendingInflow: number
  pendingInflowPaise: number
}

export interface TreasuryOverview {
  accounts: AccountBalanceSummary[]
  totalAvailableBalance: number
  totalAvailableBalancePaise: number
  totalPendingBalance: number
  totalPendingBalancePaise: number
  asOfDate: string
}

export interface TransferValidationResult {
  isValid: boolean
  errorMessage?: string
}

export interface RefundValidationResult {
  isValid: boolean
  errorMessage?: string
}

/* ==========================================================================
   Shared Expenses & Splits (Stage 3)
   ========================================================================== */

export type ExpenseCategory =
  | 'Kitchen & Groceries'
  | 'Utilities & Internet'
  | 'Drinking Water'
  | 'Cleaning & Household'
  | 'Repairs & Maintenance'
  | 'Rent & Society'
  | 'Other Shared'

export type SplitScopeType =
  | 'all_active'          // All active general-expense-eligible members
  | 'residents_only'     // Active members where isResident == true
  | 'food_participants'  // Active members where isFoodEligible == true
  | 'custom'             // Explicit custom subset of member IDs

export interface ExpenseParticipantShare {
  memberId: string
  memberName?: string
  sharePaise: number             // Authoritative stored share in integer paise
  shareAmount: number            // Computed display INR (sharePaise / 100)
  settlementStatus: 'unsettled' | 'settled'
  settledAt?: string
}

export interface ExpenseCorrectionRecord {
  id: string
  editedAt: string
  editedByMembershipId: string
  editedByName: string
  reason: string
  previousValues: {
    title: string
    category: string
    amountPaise: number
    splitScopeType: SplitScopeType
    participantMemberIds: string[]
    disbursementChannel?: DisbursementChannel
  }
}

export interface ExpenseReceipt {
  fileName: string
  fileSize?: string
  uploadedAt: string
  previewUrl?: string // Object URL or local simulated URI
}

export interface ExpenseValidationResult {
  isValid: boolean
  errorMessage?: string
}

export interface ExpenseItem {
  id: string
  title: string
  category: ExpenseCategory | string
  amount: number                 // Computed display INR: paiseToRupees(amountPaise)
  amountPaise: number            // Authoritative stored amount in integer paise
  payerMemberId: string          // Purchaser member ID
  paidBy: string                 // Purchaser display name
  date: string
  description?: string
  splitScopeType: SplitScopeType
  participantMemberIds: string[]
  splits: ExpenseParticipantShare[]
  disbursementChannel: DisbursementChannel
  disbursedFromAccountId?: string
  disbursementStatus: ExpenseDisbursementStatus
  disbursedAt?: string
  disbursedByMembershipId?: string
  isVoided?: boolean
  voidReason?: string
  voidedAt?: string
  voidedByMembershipId?: string
  correctionHistory?: ExpenseCorrectionRecord[]
  receipt?: ExpenseReceipt

  // Stage 6 Provider Payment Extensions (Optional, backward compatible with Stage 3)
  expenseSourceType?: 'general' | 'obligation_provider_payment'
  linkedObligationId?: string
}

export interface BalanceSummary {
  totalBalance: number
  bankBalance: number
  cashBalance: number
  currency: string
  asOfDate: string
}

/* ==========================================================================
   Household Inventory Types (Stage 4)
   ========================================================================== */

export type InventoryCategory =
  | 'Kitchen Groceries & Staples'
  | 'Fresh Food & Dairy'
  | 'Drinking Water'
  | 'Cleaning & Housekeeping'
  | 'Bathroom & Toiletries'
  | 'Waste Management'
  | 'Maintenance & Hardware'
  | 'Other Consumables'

export type DiscreteUnit = 'packet' | 'piece' | 'bottle' | 'can' | 'box' | 'roll'
export type ContinuousUnit = 'kg' | 'g' | 'L' | 'mL'
export type InventoryUnit = DiscreteUnit | ContinuousUnit

export type StockChangeType =
  | 'initial'       // Initial stock logged upon item registration
  | 'restock'       // Stock addition (e.g. grocery run)
  | 'consumption'   // Standard household consumption
  | 'correction'    // Physical count audit / reconciliation
  | 'waste'         // Discarded, spoiled, or damaged stock write-off

export type StockStatusLevel = 'normal' | 'low' | 'critical' | 'empty'

export interface StockLogRecord {
  id: string                      // Unique UUID ('stk-uuid')
  idempotencyKey: string          // Client/action unique token to prevent duplicate execution
  itemId: string                  // Foreign key to InventoryItem.id
  itemName: string                // Snapshot of item name at time of event
  unit: InventoryUnit             // Snapshot of item unit at time of event
  changeType: StockChangeType
  quantityChangedMilli: number    // Delta in integer milli-units (signed: + for addition, - for depletion)
  previousQuantityMilli: number   // Pre-action quantity in integer milli-units
  newQuantityMilli: number        // Post-action quantity in integer milli-units
  performedByMembershipId: string // Active member ID who performed the action
  performedByName: string         // Display name
  timestamp: string               // ISO 8601, e.g. "2026-11-20T14:30:00.000Z"
  reason?: string                 // Mandatory for correction & waste; optional for restock
  linkedExpenseId?: string        // Optional foreign key to ExpenseItem.id
}

export interface InventoryItem {
  id: string                      // Unique identifier ('inv-uuid')
  name: string                    // Item title (e.g. "Refined Sunflower Oil")
  category: InventoryCategory
  unit: InventoryUnit             // Immutable once stock logs exist
  isDiscrete: boolean             // Helper flag: true if discrete unit, false if continuous
  currentQuantityMilli: number    // Current on-hand quantity in integer milli-units
  minThresholdMilli: number       // Alert threshold in integer milli-units (>= 0)
  idealQuantityMilli?: number     // Optional target restock quantity in integer milli-units
  storageLocation?: string        // e.g. "Kitchen Pantry Lower Shelf"
  notes?: string                  // e.g. "Prefers Fortune brand"
  isArchived: boolean             // Non-destructive soft archive
  archivedAt?: string             // ISO 8601
  archivedByMembershipId?: string
  archivedByName?: string
  archivedReason?: string
  createdByMembershipId: string
  createdByName: string
  createdAt: string               // ISO 8601
  lastRestockedAt?: string        // ISO 8601
  lastConsumedAt?: string         // ISO 8601
  lastAuditedAt?: string          // ISO 8601
}

export interface StockActionPayload {
  idempotencyKey: string
  itemId: string
  changeType: StockChangeType
  inputQuantityString: string     // Raw input string (e.g. "1.25", "3")
  performedByMembershipId: string
  performedByName: string
  reason?: string
  linkedExpenseId?: string
}

export interface CreateInventoryItemPayload {
  idempotencyKey: string
  name: string
  category: InventoryCategory
  unit: InventoryUnit
  initialQuantityString: string   // Raw input string (e.g. "0", "5", "2.5")
  minThresholdString: string      // Raw input string (e.g. "1", "0.5")
  idealQuantityString?: string
  storageLocation?: string
  notes?: string
  createdByMembershipId: string
  createdByName: string
}

export interface InventoryValidationResult {
  isValid: boolean
  errorMessage?: string
}

export interface InventoryAlert {
  id: string
  name: string
  category: string
  currentLevel: 'Low' | 'Critical' | 'Empty'
  unit: string
  urgency: 'high' | 'medium'
}

export interface CleaningDuty {
  id: string
  taskName: string
  area: string
  assignedTo: string
  dueDate: string
  status: 'Pending' | 'Completed' | 'Upcoming'
}

/* ==========================================================================
   Cleaning Management Types (Stage 5)
   ========================================================================== */

export type StandardCleaningArea =
  | 'Kitchen'
  | 'Living Room & Dining'
  | 'Bathrooms'
  | 'Balcony & Utility'
  | 'Bedrooms'
  | 'Entrance & Passages'
  | 'Custom Area'

/**
 * Strict Monday-to-Sunday weekday numbering (ISO 8601):
 * 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday, 7 = Sunday.
 */
export type WeekdayIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7
export type NthWeekdayOccurrence = 'first' | 'second' | 'third' | 'fourth' | 'last'

export type CleaningDutyStatus = 'pending' | 'completed' | 'cancelled'
export type DerivedDutyStatus = 'pending' | 'overdue' | 'completed' | 'cancelled'

export type RecurrenceType =
  | 'one_off'
  | 'interval_days'
  | 'weekly_weekdays'
  | 'monthly_dates'
  | 'monthly_nth_weekday'
  | 'custom_dates'

export interface BaseRecurrenceConfig {
  startDate: string // "YYYY-MM-DD"
  endDate?: string // "YYYY-MM-DD"
  maxOccurrences?: number // Lifetime sequence cap across all schedule versions
}

export interface OneOffRecurrenceConfig extends BaseRecurrenceConfig {
  type: 'one_off'
  targetDate: string // "YYYY-MM-DD" (must be >= startDate and <= endDate)
}

export interface IntervalDaysRecurrenceConfig extends BaseRecurrenceConfig {
  type: 'interval_days'
  intervalDays: number // Integer N >= 1
}

export interface WeeklyWeekdaysRecurrenceConfig extends BaseRecurrenceConfig {
  type: 'weekly_weekdays'
  weekInterval: number // Integer N >= 1 (1 = every week, 2 = every 2 weeks)
  selectedWeekdays: WeekdayIndex[] // Distinct weekdays [1..7], Monday = 1
}

export interface MonthlyDatesRecurrenceConfig extends BaseRecurrenceConfig {
  type: 'monthly_dates'
  monthInterval?: number // Integer N >= 1 (default 1)
  monthDays: number[] // Distinct calendar day numbers [1..31]
  handleShorterMonths: 'clamp_to_last_day' | 'skip'
}

export interface MonthlyNthWeekdayRecurrenceConfig extends BaseRecurrenceConfig {
  type: 'monthly_nth_weekday'
  monthInterval?: number // Integer N >= 1 (default 1)
  nthOccurrence: NthWeekdayOccurrence
  weekday: WeekdayIndex // 1 = Monday ... 7 = Sunday
}

export interface CustomDatesRecurrenceConfig extends BaseRecurrenceConfig {
  type: 'custom_dates'
  explicitDates: string[] // Distinct "YYYY-MM-DD" calendar dates
}

export type RecurrencePattern =
  | OneOffRecurrenceConfig
  | IntervalDaysRecurrenceConfig
  | WeeklyWeekdaysRecurrenceConfig
  | MonthlyDatesRecurrenceConfig
  | MonthlyNthWeekdayRecurrenceConfig
  | CustomDatesRecurrenceConfig

export interface ReassignmentRecord {
  id: string
  previousAssigneeMemberIds: string[]
  previousAssigneeNames: string[]
  newAssigneeMemberIds: string[]
  newAssigneeNames: string[]
  reassignedByMembershipId: string
  reassignedByName: string
  reassignedAt: string // ISO 8601
  reason: string // Mandatory reason >= 4 chars
}

export interface CleaningTaskTemplate {
  id: string // 'cln-tmpl-uuid'
  title: string
  area: string
  description?: string
  instructions?: string
  estimatedMinutes: number // Integer >= 1
  schedule: RecurrencePattern
  scheduleVersion: number // Incremented iff normalized schedule changes
  isActive: boolean
  defaultAssigneeMemberIds?: string[]
  createdAt: string // ISO 8601
  createdByMembershipId: string
  createdByName: string
}

export interface CleaningDutyAssignment {
  id: string // 'duty-uuid'
  idempotencyKey: string // Version-qualified deterministic token
  templateId?: string
  templateScheduleVersion?: number
  title: string
  area: string
  instructions?: string
  estimatedMinutes: number
  assignedMemberIds: string[]
  assignedMemberNames: string[]
  assignedByMembershipId: string
  assignedByName: string
  assignedAt: string // ISO 8601
  dueDate: string // "YYYY-MM-DD"
  occurrenceOrdinal?: number
  status: CleaningDutyStatus
  completedAt?: string // ISO 8601
  completedByMembershipId?: string
  completedByName?: string
  completionNotes?: string
  cancelledAt?: string // ISO 8601
  cancelledByMembershipId?: string
  cancelledByName?: string
  cancellationReason?: string
  reassignmentHistory: ReassignmentRecord[]
}

export interface CleaningActivityEvent {
  eventId: string
  entityType: 'cleaning'
  entityId: string
  action: 'created' | 'completed' | 'reassigned' | 'cancelled'
  performedByMemberId: string
  performedByName: string
  timestamp: string
  summary: string
  metadata?: Record<string, unknown>
}

export interface CleaningValidationResult {
  isValid: boolean
  errorMessage?: string
}

export interface MemberWorkloadShare {
  memberId: string
  memberName: string
  completedWorkloadMinutes: number
  outstandingWorkloadMinutes: number
  fairnessScore: number
}

export interface FairnessScoreSummary {
  asOfDate: string
  thirtyDayWindowStart: string
  scores: MemberWorkloadShare[]
}

export interface HouseholdStats {
  totalActiveMembers: number
  activeResidentsCount: number
  activeFoodOnlyCount: number
  totalFoodParticipantsCount: number
  activeCleaningEligibleCount: number
}

/* ==========================================================================
   Bills & Rent Financial Management Types (Stage 6)
   ========================================================================== */

export type ObligationCategory = 'electricity_bill' | 'gas_bill' | 'rent_cycle'

export type ObligationStatus =
  | 'draft'               // Initial draft, awaiting review
  | 'active'              // Open for collections and payments
  | 'partially_funded'    // Partially collected from members
  | 'fully_funded'        // 100% collected from members
  | 'paid_to_provider'    // Disbursed in full to utility or landlord
  | 'completed'           // Fully funded AND paid in full to provider
  | 'voided'              // Cancelled with immutable audit reason

export type ProviderPaymentStatus = 'unpaid' | 'partially_paid' | 'paid'

export interface ObligationParticipantShare {
  memberId: string
  sharePaise: number             // Authoritative stored share in integer paise
  notes?: string
}

export interface ObligationCorrectionRecord {
  id: string
  obligationId: string
  correctionType: 'amount_corrected' | 'shares_reallocated' | 'metadata_updated' | 'voided'
  previousTotalPaise: number
  newTotalPaise: number
  previousShares: ObligationParticipantShare[]
  newShares: ObligationParticipantShare[]
  reason: string
  correctedByMembershipId: string
  correctedAt: string            // ISO 8601 UTC
}

export interface FinancialObligation {
  id: string                     // e.g. 'ob-elec-2026-11', 'ob-rent-2026-12'
  category: ObligationCategory
  title: string
  billingPeriodStart: string     // YYYY-MM-DD
  billingPeriodEnd: string       // YYYY-MM-DD
  dueDate: string                // YYYY-MM-DD
  totalAmountPaise: number       // Authoritative integer paise
  totalAmount: number            // Computed display INR: paiseToRupees(totalAmountPaise)
  currency: 'INR'
  shares: ObligationParticipantShare[]
  providerName: string           // e.g. "Tata Power", "Mahanagar Gas", "Landlord (Mr. Sharma)"
  consumerAccountNumber?: string
  billDocumentUrl?: string
  notes?: string
  createdByMembershipId: string
  createdAt: string              // ISO 8601 UTC
  isVoided?: boolean
  voidReason?: string
  voidedAt?: string
  voidedByMembershipId?: string
  correctionHistory?: ObligationCorrectionRecord[]
}

export interface ObligationContributionAllocation {
  id: string                     // 'alloc-xxx'
  contributionId: string         // References parent FundContribution.id
  obligationId: string           // References FinancialObligation.id
  targetMemberId: string         // Household member whose share liability is reduced
  amountPaise: number            // Positive integer in paise
  allocatedAt: string            // ISO 8601 UTC
  allocatedByMembershipId: string
  isVoided?: boolean
  voidReason?: string
  voidedAt?: string
  voidedByMembershipId?: string
}

export interface DerivedPeerClaim {
  id: string                     // Deterministic: "claim-" + expenseId + "-" + debtorMemberId
  expenseId: string              // Originating out-of-pocket ExpenseItem.id
  obligationId: string           // References FinancialObligation.id
  debtorMemberId: string         // Member who owes reimbursement
  creditorMemberId: string       // Member who paid out-of-pocket in excess of own share
  claimAmountPaise: number       // Authoritative amount in paise
  createdAt: string              // ISO 8601 UTC
}

export type SettlementStatus =
  | 'pending_confirmation'
  | 'confirmed'
  | 'rejected'
  | 'voided'

export interface MemberSettlementRecord {
  id: string                     // 'settle-xxx'
  idempotencyKey: string         // Client/action unique token to prevent duplicate execution
  obligationId: string           // References FinancialObligation.id
  claimId: string                // References DerivedPeerClaim.id
  debtorMemberId: string         // Member paying reimbursement
  creditorMemberId: string       // Member receiving reimbursement
  amountPaise: number            // Positive integer in paise
  paymentMethod: 'upi' | 'cash' | 'bank_transfer'
  paymentReference?: string      // Bank UTR or cash voucher note
  paymentDate: string            // YYYY-MM-DD
  proofReceiptUrl?: string       // Optional payment proof screenshot or bank receipt URI
  notes?: string
  status: SettlementStatus       // Authoritative single-field lifecycle
  submittedAt: string            // ISO 8601 UTC
  confirmedAt?: string
  confirmedByMemberId?: string
  rejectedAt?: string
  rejectedByMemberId?: string
  rejectionReason?: string
  voidedAt?: string
  voidedByMemberId?: string
  voidReason?: string
}

export interface HouseholdCollectorQrConfig {
  collectorMembershipId: string
  collectorName: string
  upiId?: string
  qrCodeImageUrl?: string        // Optional URI, supports initially empty state
  notes?: string
}

/* ==========================================================================
   Root Financial State & Reducer Types (Stage 6 Step 2)
   ========================================================================== */

export interface MemberSettlementReversalRecord {
  id: string
  settlementId: string
  obligationId: string
  claimId: string
  debtorMemberId: string
  creditorMemberId: string
  reversalAmountPaise: number
  reason: string
  reversedByMemberId: string
  reversedAt: string
  idempotencyKey: string
}

export interface MemberSettlementReversalOfReversalRecord {
  id: string
  originalReversalId: string
  settlementId: string
  restoredAmountPaise: number
  reason: string
  revertedByMemberId: string
  revertedAt: string
  idempotencyKey: string
}

export interface PeerCreditAdjustmentRecord {
  id: string
  obligationId: string
  claimId: string
  settlementId: string
  debtorMemberId: string
  creditorMemberId: string
  initialExcessPaise: number
  createdAt: string
}

export interface PeerCreditExcessExpansionRecord {
  id: string
  peerCreditId: string
  expansionAmountPaise: number
  reason: string
  sourceEventId: string
  createdAt: string
}

export type PeerCreditResolutionType = 'cash_refund' | 'future_obligation_offset'

export interface PeerCreditResolutionRecord {
  id: string
  peerCreditId: string
  resolutionType: PeerCreditResolutionType
  resolvedAmountPaise: number
  offsetObligationId?: string
  notes?: string
  resolvedByMemberId: string
  resolvedAt: string
  idempotencyKey: string
}

export interface PeerCreditResolutionReversalRecord {
  id: string
  resolutionId: string
  peerCreditId: string
  reversalAmountPaise: number
  reason: string
  reversedByMemberId: string
  reversedAt: string
  idempotencyKey: string
}

export interface PeerCreditExtinguishmentRecord {
  id: string
  peerCreditId: string
  extinguishedPaise: number
  reason: string
  sourceEventId: string
  createdAt: string
}

export interface PeerCreditRestorationOffsetRecord {
  id: string
  peerCreditId: string
  restoredPaise: number
  reason: string
  originalExtinguishmentId: string
  createdAt: string
}

export interface PeerCreditSettlementReversalAdjustmentRecord {
  id: string
  peerCreditId: string
  reductionPaise: number
  settlementReversalId: string
  reason: string
  createdAt: string
}

export interface PeerCreditSettlementReversalAdjustmentRestorationRecord {
  id: string
  peerCreditId: string
  restoredPaise: number
  originalAdjustmentId: string
  reason: string
  createdAt: string
}

export interface ObligationCorrectionApplicationRecord {
  id: string
  obligationId: string
  correctionId: string
  appliedAt: string
}

export interface OrderIndependentMemberDebtResult {
  memberId: string
  obligationId: string
  currentObligationSharePaise: number
  effectiveSettledTotalPaise: number
  effectiveSettledAllocatedToClaimPaise: number
  authoritativeLegitimateExcessPaise: number
  grossRefundsReceivedPaise: number
  refundRepaymentsPaise: number
  netRefundsReceivedPaise: number
  unpaidObligationSharePaise: number
  unbackedRefundLiabilityPaise: number
  totalOutstandingPaise: number
  excessCreditorReimbursementDuePaise: number
}

export interface RootFinancialState {
  accounts: TreasuryAccount[]
  contributions: FundContribution[]
  allocations: ObligationContributionAllocation[]
  obligations: FinancialObligation[]
  expenses: ExpenseItem[]
  transfers: TreasuryTransfer[]
  peerClaims: DerivedPeerClaim[]
  memberSettlements: MemberSettlementRecord[]
  memberSettlementReversals: MemberSettlementReversalRecord[]
  memberSettlementReversalOfReversals: MemberSettlementReversalOfReversalRecord[]
  peerCredits: PeerCreditAdjustmentRecord[]
  peerCreditExpansions: PeerCreditExcessExpansionRecord[]
  peerCreditResolutions: PeerCreditResolutionRecord[]
  peerCreditResolutionReversals: PeerCreditResolutionReversalRecord[]
  peerCreditExtinguishments: PeerCreditExtinguishmentRecord[]
  peerCreditRestorationOffsets: PeerCreditRestorationOffsetRecord[]
  peerCreditSettlementReversalAdjustments: PeerCreditSettlementReversalAdjustmentRecord[]
  peerCreditSettlementReversalAdjustmentRestorations: PeerCreditSettlementReversalAdjustmentRestorationRecord[]
  obligationCorrectionApplications: ObligationCorrectionApplicationRecord[]
  notifications: MemberNotificationItem[]
  notificationReadState: NotificationReadState
  processedActionIds: string[]
}

export type FinancialAction =
  | {
      type: 'SUBMIT_CONTRIBUTION'
      actionId?: string
      payload: {
        contribution: FundContribution
      }
    }
  | {
      type: 'CONFIRM_CONTRIBUTION'
      actionId?: string
      payload: {
        contributionId: string
        confirmedByMembershipId: string
        confirmedByName: string
        confirmedAt?: string
        allocation?: {
          id?: string
          obligationId: string
          targetMemberId: string
          amountPaise: number
          allocatedAt?: string
          allocatedByMembershipId: string
        }
      }
    }
  | {
      type: 'REJECT_CONTRIBUTION'
      actionId?: string
      payload: {
        contributionId: string
        rejectedByMembershipId: string
        rejectionReason: string
        rejectedAt?: string
      }
    }
  | {
      type: 'DISBURSE_TREASURY_PROVIDER_PAYMENT'
      actionId?: string
      payload: {
        expense: ExpenseItem
        obligationId: string
      }
    }
  | {
      type: 'CREATE_CONTRIBUTION_ALLOCATION'
      actionId?: string
      payload: {
        allocation: ObligationContributionAllocation
      }
    }
  | {
      type: 'VOID_CONTRIBUTION_ALLOCATION'
      actionId?: string
      payload: {
        allocationId: string
        voidReason: string
        voidedByMembershipId: string
        voidedAt?: string
      }
    }
  | {
      type: 'SUBMIT_MEMBER_SETTLEMENT'
      actionId?: string
      payload: {
        settlement: MemberSettlementRecord
      }
    }
  | {
      type: 'CONFIRM_MEMBER_SETTLEMENT'
      actionId?: string
      payload: {
        settlementId: string
        confirmedByMemberId: string
        confirmedAt?: string
        generatedPeerCreditId?: string
      }
    }
  | {
      type: 'REJECT_MEMBER_SETTLEMENT'
      actionId?: string
      payload: {
        settlementId: string
        rejectedByMemberId: string
        rejectionReason: string
        rejectedAt?: string
      }
    }
  | {
      type: 'REVERSE_MEMBER_SETTLEMENT'
      actionId?: string
      payload: {
        reversal: MemberSettlementReversalRecord
      }
    }
  | {
      type: 'REVERSE_SETTLEMENT_REVERSAL'
      actionId?: string
      payload: {
        reversalOfReversal: MemberSettlementReversalOfReversalRecord
      }
    }
  | {
      type: 'APPLY_UPWARD_CORRECTION_TO_OBLIGATION_CREDITS'
      actionId?: string
      payload: {
        obligationId: string
        correctionId: string
        newShares: ObligationParticipantShare[]
        reason: string
        correctedByMembershipId: string
        correctedAt?: string
      }
    }
  | {
      type: 'APPLY_DOWNWARD_CORRECTION_TO_OBLIGATION'
      actionId?: string
      payload: {
        obligationId: string
        correctionId: string
        newShares: ObligationParticipantShare[]
        reason: string
        correctedByMembershipId: string
        correctedAt?: string
      }
    }
  | {
      type: 'RESOLVE_PEER_CREDIT'
      actionId?: string
      payload: {
        resolution: PeerCreditResolutionRecord
      }
    }
  | {
      type: 'REVERSE_PEER_CREDIT_RESOLUTION'
      actionId?: string
      payload: {
        reversal: PeerCreditResolutionReversalRecord
      }
    }
  | {
      type: 'VOID_FINANCIAL_OBLIGATION'
      actionId?: string
      payload: {
        obligationId: string
        voidReason: string
        voidedByMembershipId: string
        voidedAt?: string
      }
    }
  | {
      type: 'RECORD_TREASURY_TRANSFER'
      actionId?: string
      payload: {
        transfer: TreasuryTransfer
      }
    }
  | {
      type: 'RECORD_EXPENSE'
      actionId?: string
      payload: {
        expense: ExpenseItem
      }
    }
  | {
      type: 'DISBURSE_EXPENSE'
      actionId?: string
      payload: {
        expenseId: string
        disbursedByMembershipId: string
        disbursedAt?: string
      }
    }
  | {
      type: 'VOID_EXPENSE'
      actionId?: string
      payload: {
        expenseId: string
        voidReason: string
        voidedByMembershipId: string
        voidedAt?: string
      }
    }
  | {
      type: 'APPLY_EXPENSE_CORRECTION'
      actionId?: string
      payload: {
        expenseId: string
        correctionRecord: ExpenseCorrectionRecord
        updatedFields: {
          title: string
          category: ExpenseCategory | string
          description?: string
        }
      }
    }
  | {
      type: 'RECORD_REFUND_ADJUSTMENT'
      actionId?: string
      payload: {
        refundContribution: FundContribution
      }
    }
  | {
      type: 'MARK_NOTIFICATION_READ'
      actionId?: string
      payload: {
        notificationId: string
        readAt?: string
      }
    }

export type FinancialActionResult =
  | { success: true; state: RootFinancialState; message?: string }
  | { success: false; error: string }

export interface CreditorPeerClaimSummary {
  claimId: string
  expenseId: string
  obligationId: string
  creditorMemberId: string
  debtorMemberId: string
  claimAmountPaise: number
  confirmedRepaidPaise: number
  pendingRepaidPaise: number
  remainingClaimPaise: number
}

export interface MemberObligationSummary {
  memberId: string
  baseSharePaise: number
  confirmedAllocatedPaise: number
  personalPaymentOwnSharePaise: number
  treasuryAdvanceAttributedPaise: number
  peerReceivableDebtPaise: number
  confirmedP2PRepaymentsPaise: number

  // Mutually exclusive net actionable balances
  unpaidProviderSharePaise: number
  owedToHomeFundPaise: number
  owedToCreditorsPaise: number
  totalOutstandingPaise: number
}

export interface ObligationReconciliationSummary {
  obligationId: string
  totalAmountPaise: number
  providerPaidPaise: number
  providerRemainingPaise: number
  providerPaymentStatus: ProviderPaymentStatus
  totalAllocatedContributionsPaise: number
  treasuryAdvancePaise: number
  totalPersonalDisbursedPaise: number
  totalPeerClaimsPaise: number
  totalPeerSettlementsConfirmedPaise: number
  status: ObligationStatus
  memberSummaries: MemberObligationSummary[]
}

export type NotificationEventType =
  | 'obligation_created'
  | 'share_assigned'
  | 'contribution_confirmed'
  | 'contribution_rejected'
  | 'contribution_refunded'
  | 'allocation_created'
  | 'allocation_voided'
  | 'provider_paid_treasury'
  | 'provider_paid_personal'
  | 'treasury_advance_assigned'
  | 'treasury_advance_reversed'
  | 'personal_creditor_claim'
  | 'p2p_claim_submitted'
  | 'p2p_claim_confirmed'
  | 'p2p_claim_rejected'
  | 'p2p_claim_voided'
  | 'due_date_approaching'
  | 'obligation_corrected'
  | 'obligation_voided'

export interface MemberNotificationItem {
  id: string
  idempotencyKey: string
  recipientMemberId: string
  eventType: NotificationEventType
  obligationId: string
  obligationTitle: string
  obligationCategory: ObligationCategory
  relevantAmountPaise: number
  dueDate?: string
  createdAt: string
  message: string
  sourceEntityId: string
}

export type NotificationReadState = Record<string, { isRead: boolean; readAt?: string }>
