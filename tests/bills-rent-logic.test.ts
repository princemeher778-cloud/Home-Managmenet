import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import type {
  ExpenseItem,
  FinancialAction,
  FinancialObligation,
  FundContribution,
  HouseholdMember,
  MemberSettlementRecord,
  ObligationContributionAllocation,
  ObligationParticipantShare,
  RootFinancialState,
  TreasuryAccount,
  TreasuryOverview,
  TreasuryTransfer,
} from '../src/types/index.ts'
import {
  attributeTreasuryAdvance,
  calculateAccountLiquidBalance,
  calculateClaimFIFOAllocations,
  calculateContributionUnallocatedPaise,
  calculateEqualObligationShares,
  calculateTreasuryAdvance,
  confirmMemberSettlement,
  correctFinancialObligation,
  createContributionAllocation,
  createFinancialObligation,
  createMemberSettlement,
  createProviderPaymentExpense,
  deriveCreditorClaimSummaries,
  deriveMemberObligationSummary,
  deriveObligationNotifications,
  deriveObligationReconciliationSummary,
  deriveOrderIndependentMemberDebt,
  derivePeerClaims,
  financialStateReducer,
  getAvailablePeerCreditPaise,
  rejectMemberSettlement,
  rootFinancialReducer,
  validateContributionAllocation,
  validateMemberSettlement,
  validateObligationDates,
  validateObligationShares,
  validateProviderPaymentExpense,
  voidContributionAllocation,
  voidFinancialObligation,
  voidMemberSettlement,
} from '../src/utils/billsRent.ts'
import {
  validateExpense,
} from '../src/utils/financial.ts'
import {
  calculateTreasuryOverview,
  DEMO_ROOT_FINANCIAL_STATE,
} from '../src/data/mockData.ts'

describe('HOMEBASE Stage 6 Bills & Rent Domain Logic & Accounting Invariant Tests', () => {
  // Test household members
  const testMembers: HouseholdMember[] = [
    {
      id: 'mem_arjun',
      name: 'Arjun Verma',
      avatarInitial: 'AV',
      status: 'active',
      participationTier: 'resident',
      joinedDate: '2026-01-01',
      isResident: true,
      isFoodEligible: true,
      isCleaningEligible: true,
      isGeneralExpenseEligible: true,
      isRentEligible: true,
    },
    {
      id: 'mem_rohan',
      name: 'Rohan Sharma',
      avatarInitial: 'RS',
      status: 'active',
      participationTier: 'resident',
      joinedDate: '2026-01-01',
      isResident: true,
      isFoodEligible: true,
      isCleaningEligible: true,
      isGeneralExpenseEligible: true,
      isRentEligible: true,
    },
    {
      id: 'mem_priya',
      name: 'Priya Patel',
      avatarInitial: 'PP',
      status: 'active',
      participationTier: 'resident',
      joinedDate: '2026-01-01',
      isResident: true,
      isFoodEligible: true,
      isCleaningEligible: true,
      isGeneralExpenseEligible: true,
      isRentEligible: true,
    },
    {
      id: 'mem_vikram',
      name: 'Vikram Sengupta',
      avatarInitial: 'VS',
      status: 'active',
      participationTier: 'resident',
      joinedDate: '2026-01-01',
      isResident: true,
      isFoodEligible: true,
      isCleaningEligible: true,
      isGeneralExpenseEligible: true,
      isRentEligible: true,
    },
    {
      id: 'mem_guest',
      name: 'Tanmay Gupta',
      avatarInitial: 'TG',
      status: 'active',
      participationTier: 'guest',
      joinedDate: '2026-02-01',
      isResident: false,
      isFoodEligible: false,
      isCleaningEligible: false,
      isGeneralExpenseEligible: true,
      isRentEligible: false, // Ineligible for rent
    },
    {
      id: 'mem_paused',
      name: 'Karthik Nair',
      avatarInitial: 'KN',
      status: 'paused',
      participationTier: 'resident',
      joinedDate: '2026-01-01',
      isResident: true,
      isFoodEligible: true,
      isCleaningEligible: true,
      isGeneralExpenseEligible: true,
      isRentEligible: true,
    },
  ]

  // Test Treasury accounts
  const testAccounts: TreasuryAccount[] = [
    {
      id: 'acc-upi',
      name: 'Personal UPI (Custodial)',
      accountType: 'personal_upi',
      custodianMembershipId: 'mem_arjun',
      custodianName: 'Arjun Verma',
      upiId: 'arjun@upi',
      isActive: true,
    },
    {
      id: 'acc-cash',
      name: 'Physical Cash Box',
      accountType: 'cash_box',
      custodianMembershipId: 'mem_arjun',
      custodianName: 'Arjun Verma',
      isActive: true,
    },
    {
      id: 'acc-inactive',
      name: 'Old Bank Account',
      accountType: 'personal_upi',
      custodianMembershipId: 'mem_rohan',
      custodianName: 'Rohan Sharma',
      isActive: false,
    },
  ]

  /* ==========================================================================
     1. Financial Obligations Tests
     ========================================================================== */

  test('Obligations: Validates billing periods and calendar dates strictly', () => {
    // Valid dates
    const valid = validateObligationDates('2026-11-01', '2026-11-30', '2026-12-05')
    assert.strictEqual(valid.isValid, true)

    // Invalid start date format
    const invalidStart = validateObligationDates('2026/11/01', '2026-11-30', '2026-12-05')
    assert.strictEqual(invalidStart.isValid, false)

    // Non-existent calendar date (February 31)
    const invalidDate = validateObligationDates('2026-02-31', '2026-03-31', '2026-04-05')
    assert.strictEqual(invalidDate.isValid, false)

    // Start date after end date
    const inverted = validateObligationDates('2026-12-01', '2026-11-30', '2026-12-05')
    assert.strictEqual(inverted.isValid, false)

    // Due date before start date
    const prematureDue = validateObligationDates('2026-11-01', '2026-11-30', '2026-10-25')
    assert.strictEqual(prematureDue.isValid, false)
  })

  test('Obligations: Equal split distributes remainder paise deterministically with exact total', () => {
    // ₹100 (10,000 paise) among 3 participants -> 3334, 3333, 3333 paise
    const participants = [{ id: 'mem_arjun' }, { id: 'mem_rohan' }, { id: 'mem_priya' }]
    const shares = calculateEqualObligationShares(10000, participants)

    assert.strictEqual(shares.length, 3)
    assert.strictEqual(shares[0].sharePaise, 3334)
    assert.strictEqual(shares[1].sharePaise, 3333)
    assert.strictEqual(shares[2].sharePaise, 3333)

    const sum = shares.reduce((acc, s) => acc + s.sharePaise, 0)
    assert.strictEqual(sum, 10000)
  })

  test('Obligations: Custom split validation verifies exact total, positive paise, and eligibility', () => {
    const totalPaise = 240000 // ₹2,400

    // Valid equal shares
    const validShares: ObligationParticipantShare[] = [
      { memberId: 'mem_arjun', sharePaise: 60000 },
      { memberId: 'mem_rohan', sharePaise: 60000 },
      { memberId: 'mem_priya', sharePaise: 60000 },
      { memberId: 'mem_vikram', sharePaise: 60000 },
    ]
    const validRes = validateObligationShares(totalPaise, validShares, testMembers, 'electricity_bill')
    assert.strictEqual(validRes.isValid, true)

    // Sum mismatch
    const mismatchShares: ObligationParticipantShare[] = [
      { memberId: 'mem_arjun', sharePaise: 60000 },
      { memberId: 'mem_rohan', sharePaise: 60000 },
      { memberId: 'mem_priya', sharePaise: 60000 },
      { memberId: 'mem_vikram', sharePaise: 50000 }, // sum 230,000 != 240,000
    ]
    const mismatchRes = validateObligationShares(totalPaise, mismatchShares, testMembers, 'electricity_bill')
    assert.strictEqual(mismatchRes.isValid, false)

    // Paused member inclusion rejected
    const pausedShares: ObligationParticipantShare[] = [
      { memberId: 'mem_arjun', sharePaise: 120000 },
      { memberId: 'mem_paused', sharePaise: 120000 },
    ]
    const pausedRes = validateObligationShares(totalPaise, pausedShares, testMembers, 'electricity_bill')
    assert.strictEqual(pausedRes.isValid, false)

    // Rent ineligible member inclusion rejected for rent_cycle
    const rentIneligibleShares: ObligationParticipantShare[] = [
      { memberId: 'mem_arjun', sharePaise: 120000 },
      { memberId: 'mem_guest', sharePaise: 120000 },
    ]
    const rentIneligibleRes = validateObligationShares(totalPaise, rentIneligibleShares, testMembers, 'rent_cycle')
    assert.strictEqual(rentIneligibleRes.isValid, false)
    assert.match(rentIneligibleRes.errorMessage!, /not eligible for rent/i)

    // Zero or negative paise share rejected
    const zeroShares: ObligationParticipantShare[] = [
      { memberId: 'mem_arjun', sharePaise: 240000 },
      { memberId: 'mem_rohan', sharePaise: 0 },
    ]
    const zeroRes = validateObligationShares(totalPaise, zeroShares, testMembers, 'electricity_bill')
    assert.strictEqual(zeroRes.isValid, false)
  })

  test('Obligations: createFinancialObligation builds authoritative record', () => {
    const shares: ObligationParticipantShare[] = [
      { memberId: 'mem_arjun', sharePaise: 1000000 },
      { memberId: 'mem_rohan', sharePaise: 1000000 },
      { memberId: 'mem_priya', sharePaise: 1000000 },
      { memberId: 'mem_vikram', sharePaise: 1000000 },
    ]

    const { obligation, error } = createFinancialObligation({
      id: 'ob-rent-2026-11',
      category: 'rent_cycle',
      title: 'November 2026 House Rent',
      billingPeriodStart: '2026-11-01',
      billingPeriodEnd: '2026-11-30',
      dueDate: '2026-12-05',
      totalAmountPaise: 4000000,
      shares,
      providerName: 'Landlord (Mr. Sharma)',
      consumerAccountNumber: 'RENT-AGR-402',
      createdByMembershipId: 'mem_arjun',
      members: testMembers,
    })

    assert.strictEqual(error, undefined)
    assert.ok(obligation)
    assert.strictEqual(obligation.id, 'ob-rent-2026-11')
    assert.strictEqual(obligation.totalAmountPaise, 4000000)
    assert.strictEqual(obligation.totalAmount, 40000)
    assert.strictEqual(obligation.isVoided, false)
    assert.strictEqual(obligation.shares.length, 4)
  })

  /* ==========================================================================
     2. Contribution Allocation Logic Tests
     ========================================================================== */

  test('Contribution Allocations: Validates parent status, capacity, and target member ceiling', () => {
    const obligation: FinancialObligation = {
      id: 'ob-elec-01',
      category: 'electricity_bill',
      title: 'October Electricity',
      billingPeriodStart: '2026-10-01',
      billingPeriodEnd: '2026-10-31',
      dueDate: '2026-11-10',
      totalAmountPaise: 240000,
      totalAmount: 2400,
      currency: 'INR',
      shares: [
        { memberId: 'mem_rohan', sharePaise: 60000 },
        { memberId: 'mem_arjun', sharePaise: 60000 },
        { memberId: 'mem_priya', sharePaise: 60000 },
        { memberId: 'mem_vikram', sharePaise: 60000 },
      ],
      providerName: 'Tata Power',
      createdByMembershipId: 'mem_arjun',
      createdAt: '2026-11-01T10:00:00Z',
    }

    const contributionConfirmed: FundContribution = {
      id: 'cnt-01',
      accountId: 'acc-upi',
      contributorMembershipId: 'mem_arjun',
      contributorName: 'Arjun Verma',
      amount: 1000, // ₹1,000 = 100,000 paise
      date: '2026-11-02',
      status: 'confirmed',
    }

    const contributionPending: FundContribution = {
      ...contributionConfirmed,
      id: 'cnt-02',
      status: 'pending_confirmation',
    }

    const contributionRefunded: FundContribution = {
      ...contributionConfirmed,
      id: 'cnt-03',
      status: 'refunded',
    }

    // 1. Pending contribution allocation is rejected
    const pendingAlloc = validateContributionAllocation(
      { amountPaise: 60000, targetMemberId: 'mem_rohan' },
      contributionPending,
      obligation,
      []
    )
    assert.strictEqual(pendingAlloc.isValid, false)
    assert.match(pendingAlloc.errorMessage!, /Must be "confirmed"/i)

    // 2. Refunded contribution allocation is rejected
    const refundAlloc = validateContributionAllocation(
      { amountPaise: 60000, targetMemberId: 'mem_rohan' },
      contributionRefunded,
      obligation,
      []
    )
    assert.strictEqual(refundAlloc.isValid, false)
    assert.match(refundAlloc.errorMessage!, /refunded contribution/i)

    // 3. Valid confirmed allocation
    const validAlloc = validateContributionAllocation(
      { amountPaise: 60000, targetMemberId: 'mem_rohan' },
      contributionConfirmed,
      obligation,
      []
    )
    assert.strictEqual(validAlloc.isValid, true)

    // 4. Over-allocation of parent contribution rejected (asking 120,000 from 100,000 contribution)
    const overAlloc = validateContributionAllocation(
      { amountPaise: 120000, targetMemberId: 'mem_rohan' },
      contributionConfirmed,
      obligation,
      []
    )
    assert.strictEqual(overAlloc.isValid, false)
    assert.match(overAlloc.errorMessage!, /exceeds available unallocated contribution/i)

    // 5. Allocation exceeding target member's remaining share ceiling rejected (Rohan share is 60,000; asking 70,000)
    const overCeilingAlloc = validateContributionAllocation(
      { amountPaise: 70000, targetMemberId: 'mem_rohan' },
      contributionConfirmed,
      obligation,
      []
    )
    assert.strictEqual(overCeilingAlloc.isValid, false)
    assert.match(overCeilingAlloc.errorMessage!, /exceeds target member's remaining share ceiling/i)

    // 6. Non-participant target member rejected
    const nonPartAlloc = validateContributionAllocation(
      { amountPaise: 30000, targetMemberId: 'mem_guest' },
      contributionConfirmed,
      obligation,
      []
    )
    assert.strictEqual(nonPartAlloc.isValid, false)
    assert.match(nonPartAlloc.errorMessage!, /not a participant/i)
  })

  test('Contribution Allocations: Tracks unallocated balance and supports non-destructive voiding', () => {
    const contribution: FundContribution = {
      id: 'cnt-multi',
      accountId: 'acc-upi',
      contributorMembershipId: 'mem_arjun',
      contributorName: 'Arjun Verma',
      amount: 1000, // 100,000 paise
      date: '2026-11-02',
      status: 'confirmed',
    }

    const alloc1 = createContributionAllocation({
      contributionId: 'cnt-multi',
      obligationId: 'ob-elec-01',
      targetMemberId: 'mem_rohan',
      amountPaise: 60000,
      allocatedByMembershipId: 'mem_arjun',
    })

    const alloc2 = createContributionAllocation({
      contributionId: 'cnt-multi',
      obligationId: 'ob-elec-01',
      targetMemberId: 'mem_arjun',
      amountPaise: 30000,
      allocatedByMembershipId: 'mem_arjun',
    })

    // Total allocated = 90,000 paise -> unallocated = 10,000 paise (₹100)
    let unallocated = calculateContributionUnallocatedPaise(contribution, [alloc1, alloc2])
    assert.strictEqual(unallocated, 10000)

    // Void alloc1 -> unallocated restores to 70,000 paise
    const updatedAllocs = voidContributionAllocation(alloc1.id, [alloc1, alloc2], 'mem_arjun', 'Mistaken allocation target')
    assert.strictEqual(updatedAllocs.find((a) => a.id === alloc1.id)?.isVoided, true)
    assert.strictEqual(updatedAllocs.find((a) => a.id === alloc1.id)?.voidReason, 'Mistaken allocation target')

    unallocated = calculateContributionUnallocatedPaise(contribution, updatedAllocs)
    assert.strictEqual(unallocated, 70000)
  })

  /* ==========================================================================
     3. Provider Payments via ExpenseItem Tests
     ========================================================================== */

  test('Provider Payments: validateProviderPaymentExpense enforces account type, balance, and overpayment checks', () => {
    const obligation: FinancialObligation = {
      id: 'ob-rent-01',
      category: 'rent_cycle',
      title: 'Rent Cycle',
      billingPeriodStart: '2026-11-01',
      billingPeriodEnd: '2026-11-30',
      dueDate: '2026-12-05',
      totalAmountPaise: 4000000, // ₹40,000
      totalAmount: 40000,
      currency: 'INR',
      shares: [
        { memberId: 'mem_arjun', sharePaise: 1000000 },
        { memberId: 'mem_rohan', sharePaise: 1000000 },
        { memberId: 'mem_priya', sharePaise: 1000000 },
        { memberId: 'mem_vikram', sharePaise: 1000000 },
      ],
      providerName: 'Landlord',
      createdByMembershipId: 'mem_arjun',
      createdAt: '2026-11-01T10:00:00Z',
    }

    // Mock treasury overview with ₹30,000 liquid in UPI and ₹5,000 in Cash
    const mockOverview: TreasuryOverview = {
      accounts: [
        {
          account: testAccounts[0], // acc-upi
          currentBalance: 30000,
          currentBalancePaise: 3000000,
          pendingInflow: 0,
          pendingInflowPaise: 0,
        },
        {
          account: testAccounts[1], // acc-cash
          currentBalance: 5000,
          currentBalancePaise: 500000,
          pendingInflow: 0,
          pendingInflowPaise: 0,
        },
      ],
      totalAvailableBalance: 35000,
      totalAvailableBalancePaise: 3500000,
      totalPendingBalance: 0,
      totalPendingBalancePaise: 0,
      asOfDate: '2026-11-20',
    }

    // 1. Valid Treasury UPI Payment within balance
    const validUPI = validateProviderPaymentExpense(
      {
        amountPaise: 2500000, // ₹25,000 <= ₹30,000
        disbursementChannel: 'treasury_personal_upi',
        disbursedFromAccountId: 'acc-upi',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: 'ob-rent-01',
      },
      obligation,
      [],
      testAccounts,
      mockOverview
    )
    assert.strictEqual(validUPI.isValid, true)

    // 2. Insufficient Treasury Balance rejected (asking ₹35,000 from acc-upi with ₹30,000)
    const insufficientBalance = validateProviderPaymentExpense(
      {
        amountPaise: 3500000,
        disbursementChannel: 'treasury_personal_upi',
        disbursedFromAccountId: 'acc-upi',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: 'ob-rent-01',
      },
      obligation,
      [],
      testAccounts,
      mockOverview
    )
    assert.strictEqual(insufficientBalance.isValid, false)
    assert.match(insufficientBalance.errorMessage!, /Insufficient liquid funds/i)

    // 3. Mismatched channel and account type rejected (UPI channel with cash account)
    const channelMismatch = validateProviderPaymentExpense(
      {
        amountPaise: 50000,
        disbursementChannel: 'treasury_personal_upi',
        disbursedFromAccountId: 'acc-cash',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: 'ob-rent-01',
      },
      obligation,
      [],
      testAccounts,
      mockOverview
    )
    assert.strictEqual(channelMismatch.isValid, false)
    assert.match(channelMismatch.errorMessage!, /does not match personal UPI/i)

    // 4. Inactive account rejected
    const inactiveAccount = validateProviderPaymentExpense(
      {
        amountPaise: 50000,
        disbursementChannel: 'treasury_personal_upi',
        disbursedFromAccountId: 'acc-inactive',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: 'ob-rent-01',
      },
      obligation,
      [],
      testAccounts,
      mockOverview
    )
    assert.strictEqual(inactiveAccount.isValid, false)
    assert.match(inactiveAccount.errorMessage!, /invalid or inactive/i)

    // 5. Provider Overpayment rejected
    const existingPayment: ExpenseItem = {
      id: 'exp-prev',
      title: 'Previous payment',
      category: 'Rent & Society',
      amount: 30000,
      amountPaise: 3000000,
      payerMemberId: 'mem_arjun',
      paidBy: 'Arjun',
      date: '2026-11-02',
      splitScopeType: 'custom',
      participantMemberIds: [],
      splits: [],
      disbursementChannel: 'treasury_personal_upi',
      disbursedFromAccountId: 'acc-upi',
      disbursementStatus: 'disbursed',
      linkedObligationId: 'ob-rent-01',
      expenseSourceType: 'obligation_provider_payment',
    }

    // Previous ₹30,000 + new ₹15,000 = ₹45,000 > ₹40,000 total bill
    const overpayment = validateProviderPaymentExpense(
      {
        amountPaise: 1500000,
        disbursementChannel: 'member_out_of_pocket',
        payerMemberId: 'mem_arjun',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: 'ob-rent-01',
      },
      obligation,
      [existingPayment],
      testAccounts,
      mockOverview
    )
    assert.strictEqual(overpayment.isValid, false)
    assert.match(overpayment.errorMessage!, /exceeds remaining provider bill balance/i)
  })

  test('Provider Payments: createProviderPaymentExpense sets splits: [] and participantMemberIds: [] for Treasury calculation compatibility', () => {
    const obligation: FinancialObligation = {
      id: 'ob-rent-01',
      category: 'rent_cycle',
      title: 'November Rent',
      billingPeriodStart: '2026-11-01',
      billingPeriodEnd: '2026-11-30',
      dueDate: '2026-12-05',
      totalAmountPaise: 4000000,
      totalAmount: 40000,
      currency: 'INR',
      shares: [],
      providerName: 'Landlord',
      createdByMembershipId: 'mem_arjun',
      createdAt: '2026-11-01T10:00:00Z',
    }

    const exp = createProviderPaymentExpense({
      obligation,
      amountPaise: 2500000,
      payerMemberId: 'mem_arjun',
      paidByName: 'Arjun Verma',
      date: '2026-11-05',
      disbursementChannel: 'treasury_personal_upi',
      disbursedFromAccountId: 'acc-upi',
      createdByMembershipId: 'mem_arjun',
    })

    assert.strictEqual(exp.expenseSourceType, 'obligation_provider_payment')
    assert.strictEqual(exp.linkedObligationId, 'ob-rent-01')
    assert.deepStrictEqual(exp.participantMemberIds, [])
    assert.deepStrictEqual(exp.splits, [])
    assert.strictEqual(exp.disbursementChannel, 'treasury_personal_upi')
    assert.strictEqual(exp.disbursedFromAccountId, 'acc-upi')
    assert.strictEqual(exp.amountPaise, 2500000)

    // Verify calculateTreasuryOverview debits this expense without error
    const overview = calculateTreasuryOverview(
      testAccounts,
      [
        {
          id: 'cnt-initial',
          accountId: 'acc-upi',
          contributorMembershipId: 'mem_arjun',
          contributorName: 'Arjun Verma',
          amount: 30000,
          date: '2026-11-01',
          status: 'confirmed',
        },
      ],
      [exp],
      []
    )

    const upiSummary = overview.accounts.find((a) => a.account.id === 'acc-upi')
    // ₹30,000 inflow - ₹25,000 provider expense = ₹5,000 remaining
    assert.strictEqual(upiSummary?.currentBalancePaise, 500000)
    assert.strictEqual(upiSummary?.currentBalance, 5000)
  })

  /* ==========================================================================
     4. Treasury Advance Attribution Tests
     ========================================================================== */

  test('Treasury Advance: Attributes advance across unfunded members with exact integer-paise Largest Remainder Method', () => {
    const obligation: FinancialObligation = {
      id: 'ob-rent-adv',
      category: 'rent_cycle',
      title: 'Rent Cycle with Advance',
      billingPeriodStart: '2026-11-01',
      billingPeriodEnd: '2026-11-30',
      dueDate: '2026-12-05',
      totalAmountPaise: 4000000,
      totalAmount: 40000,
      currency: 'INR',
      shares: [
        { memberId: 'mem_arjun', sharePaise: 1000000 },
        { memberId: 'mem_rohan', sharePaise: 1000000 },
        { memberId: 'mem_priya', sharePaise: 1000000 },
        { memberId: 'mem_vikram', sharePaise: 1000000 },
      ],
      providerName: 'Landlord',
      createdByMembershipId: 'mem_arjun',
      createdAt: '2026-11-01T10:00:00Z',
    }

    // Suppose Priya paid her ₹10,000. Rohan, Arjun, and Vikram owe ₹10,000 each (Total unfunded: ₹30,000).
    const unfundedMap = new Map<string, number>([
      ['mem_priya', 0],
      ['mem_arjun', 1000000],
      ['mem_rohan', 1000000],
      ['mem_vikram', 1000000],
    ])

    // Scenario: Treasury advances ₹10,000 (1,000,000 paise) from pooled reserves
    // 1,000,000 / 3 = 333,333.333 paise.
    // Largest remainder method allocates: 333,334 to first member, 333,333 to next two members.
    const advanceMap = attributeTreasuryAdvance(obligation, 1000000, unfundedMap)

    assert.strictEqual(advanceMap.get('mem_priya'), 0) // Funded member gets 0 advance debt
    const arjunAdv = advanceMap.get('mem_arjun')!
    const rohanAdv = advanceMap.get('mem_rohan')!
    const vikramAdv = advanceMap.get('mem_vikram')!

    assert.strictEqual(arjunAdv + rohanAdv + vikramAdv, 1000000)
    assert.ok(arjunAdv === 333334 || rohanAdv === 333334 || vikramAdv === 333334)
    assert.ok(arjunAdv <= 1000000)
    assert.ok(rohanAdv <= 1000000)
    assert.ok(vikramAdv <= 1000000)

    // Rejection on invalid state: Advance exceeding eligible unfunded shares throws fatal error
    assert.throws(
      () => attributeTreasuryAdvance(obligation, 3500000, unfundedMap), // 35k > 30k unfunded
      /exceeds total eligible unfunded shares/i
    )
  })

  /* ==========================================================================
     5. Mandatory Accounting Scenarios Tests
     ========================================================================== */

  test('Scenario: Example C (₹40,000 Rent, ₹25,000 Treasury, ₹15,000 Arjun out-of-pocket, Rohan owes Arjun ₹5,000)', () => {
    // 1. Obligation
    const obligation: FinancialObligation = {
      id: 'ob-rent-ex-c',
      category: 'rent_cycle',
      title: 'November Rent (Example C)',
      billingPeriodStart: '2026-11-01',
      billingPeriodEnd: '2026-11-30',
      dueDate: '2026-12-05',
      totalAmountPaise: 4000000, // ₹40,000
      totalAmount: 40000,
      currency: 'INR',
      shares: [
        { memberId: 'mem_arjun', sharePaise: 1000000 },
        { memberId: 'mem_rohan', sharePaise: 1000000 },
        { memberId: 'mem_priya', sharePaise: 1000000 },
        { memberId: 'mem_vikram', sharePaise: 1000000 },
      ],
      providerName: 'Landlord (Mr. Sharma)',
      createdByMembershipId: 'mem_arjun',
      createdAt: '2026-11-01T10:00:00Z',
    }

    // 2. Contributions: Priya (₹10,000), Vikram (₹10,000), Rohan (₹5,000) = ₹25,000 total
    const contributions: FundContribution[] = [
      {
        id: 'cnt-priya',
        accountId: 'acc-upi',
        contributorMembershipId: 'mem_priya',
        contributorName: 'Priya Patel',
        amount: 10000,
        date: '2026-11-02',
        status: 'confirmed',
      },
      {
        id: 'cnt-vikram',
        accountId: 'acc-upi',
        contributorMembershipId: 'mem_vikram',
        contributorName: 'Vikram Sengupta',
        amount: 10000,
        date: '2026-11-02',
        status: 'confirmed',
      },
      {
        id: 'cnt-rohan',
        accountId: 'acc-upi',
        contributorMembershipId: 'mem_rohan',
        contributorName: 'Rohan Sharma',
        amount: 5000,
        date: '2026-11-03',
        status: 'confirmed',
      },
    ]

    const allocations: ObligationContributionAllocation[] = [
      {
        id: 'alloc-priya',
        contributionId: 'cnt-priya',
        obligationId: obligation.id,
        targetMemberId: 'mem_priya',
        amountPaise: 1000000,
        allocatedAt: '2026-11-02T10:00:00Z',
        allocatedByMembershipId: 'mem_priya',
      },
      {
        id: 'alloc-vikram',
        contributionId: 'cnt-vikram',
        obligationId: obligation.id,
        targetMemberId: 'mem_vikram',
        amountPaise: 1000000,
        allocatedAt: '2026-11-02T10:00:00Z',
        allocatedByMembershipId: 'mem_vikram',
      },
      {
        id: 'alloc-rohan',
        contributionId: 'cnt-rohan',
        obligationId: obligation.id,
        targetMemberId: 'mem_rohan',
        amountPaise: 500000,
        allocatedAt: '2026-11-03T10:00:00Z',
        allocatedByMembershipId: 'mem_rohan',
      },
    ]

    // 3. Provider Payments:
    // - Treasury pays ₹25,000
    // - Arjun pays ₹15,000 out-of-pocket
    const providerExpenses: ExpenseItem[] = [
      {
        id: 'exp-treasury-rent',
        title: 'Rent Provider Payment - Treasury',
        category: 'Rent & Society',
        amount: 25000,
        amountPaise: 2500000,
        payerMemberId: 'mem_arjun',
        paidBy: 'Arjun Verma',
        date: '2026-11-05',
        splitScopeType: 'custom',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: 'treasury_personal_upi',
        disbursedFromAccountId: 'acc-upi',
        disbursementStatus: 'disbursed',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: obligation.id,
      },
      {
        id: 'exp-arjun-rent',
        title: 'Rent Provider Payment - Arjun Personal',
        category: 'Rent & Society',
        amount: 15000,
        amountPaise: 1500000,
        payerMemberId: 'mem_arjun',
        paidBy: 'Arjun Verma',
        date: '2026-11-05',
        splitScopeType: 'custom',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: 'member_out_of_pocket',
        disbursementStatus: 'disbursed',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: obligation.id,
      },
    ]

    // Verify Treasury advance: exactly ₹0
    const { treasuryAdvancePaise, totalTreasuryPaidPaise, validAllocationsTotalPaise } =
      calculateTreasuryAdvance(obligation.id, providerExpenses, contributions, allocations)
    assert.strictEqual(totalTreasuryPaidPaise, 2500000)
    assert.strictEqual(validAllocationsTotalPaise, 2500000)
    assert.strictEqual(treasuryAdvancePaise, 0) // Zero Treasury advance

    // Derive Peer Claims
    const { claims, memberTreasuryDebts } = derivePeerClaims(
      obligation,
      providerExpenses,
      allocations,
      contributions
    )

    // Treasury debts are ₹0 for all
    for (const [_, debt] of memberTreasuryDebts.entries()) {
      assert.strictEqual(debt, 0)
    }

    // Exactly one peer claim: Rohan owes Arjun ₹5,000
    assert.strictEqual(claims.length, 1)
    const claim = claims[0]
    assert.strictEqual(claim.debtorMemberId, 'mem_rohan')
    assert.strictEqual(claim.creditorMemberId, 'mem_arjun')
    assert.strictEqual(claim.claimAmountPaise, 500000) // ₹5,000
    assert.strictEqual(claim.id, 'claim-exp-arjun-rent-mem_rohan')

    // Verify Member Summaries
    const rohanSummary = deriveMemberObligationSummary(
      'mem_rohan',
      obligation,
      allocations,
      contributions,
      providerExpenses,
      []
    )
    assert.strictEqual(rohanSummary.baseSharePaise, 1000000)
    assert.strictEqual(rohanSummary.confirmedAllocatedPaise, 500000)
    assert.strictEqual(rohanSummary.unpaidProviderSharePaise, 0) // Provider is fully paid!
    assert.strictEqual(rohanSummary.owedToHomeFundPaise, 0)
    assert.strictEqual(rohanSummary.owedToCreditorsPaise, 500000)
    assert.strictEqual(rohanSummary.totalOutstandingPaise, 500000)

    const arjunSummary = deriveMemberObligationSummary(
      'mem_arjun',
      obligation,
      allocations,
      contributions,
      providerExpenses,
      []
    )
    assert.strictEqual(arjunSummary.baseSharePaise, 1000000)
    assert.strictEqual(arjunSummary.personalPaymentOwnSharePaise, 1000000) // ₹10k settled own share
    assert.strictEqual(arjunSummary.totalOutstandingPaise, 0)

    const priyaSummary = deriveMemberObligationSummary(
      'mem_priya',
      obligation,
      allocations,
      contributions,
      providerExpenses,
      []
    )
    assert.strictEqual(priyaSummary.confirmedAllocatedPaise, 1000000)
    assert.strictEqual(priyaSummary.totalOutstandingPaise, 0)

    const vikramSummary = deriveMemberObligationSummary(
      'mem_vikram',
      obligation,
      allocations,
      contributions,
      providerExpenses,
      []
    )
    assert.strictEqual(vikramSummary.confirmedAllocatedPaise, 1000000)
    assert.strictEqual(vikramSummary.totalOutstandingPaise, 0)

    // Full Reconciliation Summary
    const recon = deriveObligationReconciliationSummary(
      obligation,
      allocations,
      contributions,
      providerExpenses,
      []
    )
    assert.strictEqual(recon.providerPaidPaise, 4000000)
    assert.strictEqual(recon.providerRemainingPaise, 0)
    assert.strictEqual(recon.providerPaymentStatus, 'paid')
    assert.strictEqual(recon.treasuryAdvancePaise, 0)
    assert.strictEqual(recon.status, 'paid_to_provider')
  })

  test('Scenario: Example H (Two Personal Payers + Partial Treasury Payment Reconciles Exactly)', () => {
    // ₹40,000 rent. 4 shares of ₹10,000.
    // Priya pays ₹12,000 out-of-pocket
    // Arjun pays ₹18,000 out-of-pocket
    // Treasury pays ₹10,000 (funded by Rohan ₹5k, Vikram ₹5k)
    const obligation: FinancialObligation = {
      id: 'ob-rent-ex-h',
      category: 'rent_cycle',
      title: 'Rent Example H',
      billingPeriodStart: '2026-11-01',
      billingPeriodEnd: '2026-11-30',
      dueDate: '2026-12-05',
      totalAmountPaise: 4000000,
      totalAmount: 40000,
      currency: 'INR',
      shares: [
        { memberId: 'mem_arjun', sharePaise: 1000000 },
        { memberId: 'mem_rohan', sharePaise: 1000000 },
        { memberId: 'mem_priya', sharePaise: 1000000 },
        { memberId: 'mem_vikram', sharePaise: 1000000 },
      ],
      providerName: 'Landlord',
      createdByMembershipId: 'mem_arjun',
      createdAt: '2026-11-01T10:00:00Z',
    }

    const contributions: FundContribution[] = [
      {
        id: 'cnt-rohan-h',
        accountId: 'acc-upi',
        contributorMembershipId: 'mem_rohan',
        contributorName: 'Rohan',
        amount: 5000,
        date: '2026-11-02',
        status: 'confirmed',
      },
      {
        id: 'cnt-vikram-h',
        accountId: 'acc-upi',
        contributorMembershipId: 'mem_vikram',
        contributorName: 'Vikram',
        amount: 5000,
        date: '2026-11-02',
        status: 'confirmed',
      },
    ]

    const allocations: ObligationContributionAllocation[] = [
      {
        id: 'alloc-rohan-h',
        contributionId: 'cnt-rohan-h',
        obligationId: obligation.id,
        targetMemberId: 'mem_rohan',
        amountPaise: 500000,
        allocatedAt: '2026-11-02T10:00:00Z',
        allocatedByMembershipId: 'mem_rohan',
      },
      {
        id: 'alloc-vikram-h',
        contributionId: 'cnt-vikram-h',
        obligationId: obligation.id,
        targetMemberId: 'mem_vikram',
        amountPaise: 500000,
        allocatedAt: '2026-11-02T10:00:00Z',
        allocatedByMembershipId: 'mem_vikram',
      },
    ]

    const providerExpenses: ExpenseItem[] = [
      // Priya paid ₹12k first on 2026-11-03
      {
        id: 'exp-priya-h',
        title: 'Priya Rent Payment',
        category: 'Rent & Society',
        amount: 12000,
        amountPaise: 1200000,
        payerMemberId: 'mem_priya',
        paidBy: 'Priya Patel',
        date: '2026-11-03',
        splitScopeType: 'custom',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: 'member_out_of_pocket',
        disbursementStatus: 'disbursed',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: obligation.id,
      },
      // Arjun paid ₹18k on 2026-11-04
      {
        id: 'exp-arjun-h',
        title: 'Arjun Rent Payment',
        category: 'Rent & Society',
        amount: 18000,
        amountPaise: 1800000,
        payerMemberId: 'mem_arjun',
        paidBy: 'Arjun Verma',
        date: '2026-11-04',
        splitScopeType: 'custom',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: 'member_out_of_pocket',
        disbursementStatus: 'disbursed',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: obligation.id,
      },
      // Treasury paid ₹10k on 2026-11-05
      {
        id: 'exp-treasury-h',
        title: 'Treasury Rent Payment',
        category: 'Rent & Society',
        amount: 10000,
        amountPaise: 1000000,
        payerMemberId: 'mem_arjun',
        paidBy: 'Arjun Verma',
        date: '2026-11-05',
        splitScopeType: 'custom',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: 'treasury_personal_upi',
        disbursedFromAccountId: 'acc-upi',
        disbursementStatus: 'disbursed',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: obligation.id,
      },
    ]

    const { claims, memberTreasuryDebts } = derivePeerClaims(
      obligation,
      providerExpenses,
      allocations,
      contributions
    )

    // Treasury advance is ₹0
    for (const [_, debt] of memberTreasuryDebts.entries()) {
      assert.strictEqual(debt, 0)
    }

    // Chronological claim verification:
    // Priya paid ₹12k: ₹10k own share, ₹2k excess -> goes to Rohan (Rohan owes Priya ₹2k)
    // Arjun paid ₹18k: ₹10k own share, ₹8k excess -> Rohan owes Arjun ₹3k (Rohan debt closed) + Vikram owes Arjun ₹5k (Vikram debt closed)
    const priyaToRohan = claims.find((c) => c.creditorMemberId === 'mem_priya' && c.debtorMemberId === 'mem_rohan')
    assert.ok(priyaToRohan)
    assert.strictEqual(priyaToRohan.claimAmountPaise, 200000) // ₹2,000

    const arjunToRohan = claims.find((c) => c.creditorMemberId === 'mem_arjun' && c.debtorMemberId === 'mem_rohan')
    assert.ok(arjunToRohan)
    assert.strictEqual(arjunToRohan.claimAmountPaise, 300000) // ₹3,000

    const arjunToVikram = claims.find((c) => c.creditorMemberId === 'mem_arjun' && c.debtorMemberId === 'mem_vikram')
    assert.ok(arjunToVikram)
    assert.strictEqual(arjunToVikram.claimAmountPaise, 500000) // ₹5,000

    // Total claims = ₹2k + ₹3k + ₹5k = ₹10,000
    const totalClaims = claims.reduce((sum, c) => sum + c.claimAmountPaise, 0)
    assert.strictEqual(totalClaims, 1000000)

    // Rohan total owed to creditors: ₹5,000
    const rohanSummary = deriveMemberObligationSummary('mem_rohan', obligation, allocations, contributions, providerExpenses, [])
    assert.strictEqual(rohanSummary.owedToCreditorsPaise, 500000)
    assert.strictEqual(rohanSummary.owedToHomeFundPaise, 0)
    assert.strictEqual(rohanSummary.totalOutstandingPaise, 500000)

    // Vikram total owed to creditors: ₹5,000
    const vikramSummary = deriveMemberObligationSummary('mem_vikram', obligation, allocations, contributions, providerExpenses, [])
    assert.strictEqual(vikramSummary.owedToCreditorsPaise, 500000)
    assert.strictEqual(vikramSummary.owedToHomeFundPaise, 0)
    assert.strictEqual(vikramSummary.totalOutstandingPaise, 500000)
  })

  test('Scenario: One Debtor Owing Two Creditors & Partial Repayment to One', () => {
    const claimPriya = {
      id: 'claim-exp-1-mem_rohan',
      expenseId: 'exp-1',
      obligationId: 'ob-rent-01',
      debtorMemberId: 'mem_rohan',
      creditorMemberId: 'mem_priya',
      claimAmountPaise: 200000, // ₹2,000
      createdAt: '2026-11-03T10:00:00Z',
    }

    const claimArjun = {
      id: 'claim-exp-2-mem_rohan',
      expenseId: 'exp-2',
      obligationId: 'ob-rent-01',
      debtorMemberId: 'mem_rohan',
      creditorMemberId: 'mem_arjun',
      claimAmountPaise: 300000, // ₹3,000
      createdAt: '2026-11-04T10:00:00Z',
    }

    // Step 1: Rohan submits partial repayment of ₹1,200 to Priya
    const settlementPriya = createMemberSettlement({
      id: 'settle-01',
      idempotencyKey: 'idemp-rohan-priya-01',
      obligationId: 'ob-rent-01',
      claimId: claimPriya.id,
      debtorMemberId: 'mem_rohan',
      creditorMemberId: 'mem_priya',
      amountPaise: 120000,
      paymentMethod: 'upi',
      paymentReference: 'UPI-UTR-9911',
      paymentDate: '2026-11-06',
    })

    // Validate settlement against claim
    const valRes = validateMemberSettlement(settlementPriya, claimPriya, [])
    assert.strictEqual(valRes.isValid, true)

    // Over-settlement validation (trying to pay ₹1,500 more on claimPriya where only ₹800 remains)
    const overSettlement = validateMemberSettlement(
      { ...settlementPriya, id: 'settle-02', idempotencyKey: 'idemp-02', amountPaise: 150000 },
      claimPriya,
      [settlementPriya]
    )
    assert.strictEqual(overSettlement.isValid, false)
    assert.match(overSettlement.errorMessage!, /exceeds available claim capacity/i)

    // Creditor Confirmation: Only Priya can confirm
    assert.throws(
      () => confirmMemberSettlement(settlementPriya.id, [settlementPriya], 'mem_arjun'), // Wrong creditor
      /Only designated creditor "mem_priya" can confirm/i
    )

    const confirmedSettlements = confirmMemberSettlement(settlementPriya.id, [settlementPriya], 'mem_priya')
    assert.strictEqual(confirmedSettlements[0].status, 'confirmed')

    // Creditor Summaries:
    // Priya claim: ₹2,000 base, ₹1,200 repaid -> ₹800 remaining
    const priyaSummaries = deriveCreditorClaimSummaries('mem_priya', 'ob-rent-01', [claimPriya, claimArjun], confirmedSettlements)
    assert.strictEqual(priyaSummaries.length, 1)
    assert.strictEqual(priyaSummaries[0].remainingClaimPaise, 80000) // ₹800

    // Arjun claim: ₹3,000 base, ₹0 repaid -> ₹3,000 remaining (100% unaffected by payment to Priya!)
    const arjunSummaries = deriveCreditorClaimSummaries('mem_arjun', 'ob-rent-01', [claimPriya, claimArjun], confirmedSettlements)
    assert.strictEqual(arjunSummaries.length, 1)
    assert.strictEqual(arjunSummaries[0].remainingClaimPaise, 300000) // ₹3,000

    // Step 2: Rohan submits settlement of ₹500 with invalid reference to Arjun
    const settlementBad = createMemberSettlement({
      id: 'settle-bad',
      idempotencyKey: 'idemp-bad-01',
      obligationId: 'ob-rent-01',
      claimId: claimArjun.id,
      debtorMemberId: 'mem_rohan',
      creditorMemberId: 'mem_arjun',
      amountPaise: 50000,
      paymentMethod: 'upi',
      paymentReference: 'FAKE-UTR',
      paymentDate: '2026-11-06',
    })

    // Arjun rejects the settlement
    const rejectedSettlements = rejectMemberSettlement(
      settlementBad.id,
      [settlementBad],
      'mem_arjun',
      'Transaction reference not found in bank statement'
    )
    assert.strictEqual(rejectedSettlements[0].status, 'rejected')
    assert.strictEqual(rejectedSettlements[0].rejectionReason, 'Transaction reference not found in bank statement')

    // Rejection immediately releases pending reservation
    const arjunSummariesAfterReject = deriveCreditorClaimSummaries('mem_arjun', 'ob-rent-01', [claimArjun], rejectedSettlements)
    assert.strictEqual(arjunSummariesAfterReject[0].pendingRepaidPaise, 0)
    assert.strictEqual(arjunSummariesAfterReject[0].remainingClaimPaise, 300000)

    // Step 3: Voiding a confirmed settlement restores claim capacity
    const voidedSettlements = voidMemberSettlement(
      settlementPriya.id,
      confirmedSettlements,
      'mem_priya',
      'Bank transfer bounced after initial clearance'
    )
    assert.strictEqual(voidedSettlements[0].status, 'voided')
    const priyaSummariesAfterVoid = deriveCreditorClaimSummaries('mem_priya', 'ob-rent-01', [claimPriya], voidedSettlements)
    assert.strictEqual(priyaSummariesAfterVoid[0].confirmedRepaidPaise, 0)
    assert.strictEqual(priyaSummariesAfterVoid[0].remainingClaimPaise, 200000) // Restored back to full ₹2,000!
  })

  /* ==========================================================================
     6. Corrections, Voiding & Notifications Tests
     ========================================================================== */

  test('Corrections: Share increase after partial payment preserves audit history and recalculates remaining', () => {
    const obligation: FinancialObligation = {
      id: 'ob-elec-corr',
      category: 'electricity_bill',
      title: 'Electricity with Surcharge',
      billingPeriodStart: '2026-11-01',
      billingPeriodEnd: '2026-11-30',
      dueDate: '2026-12-05',
      totalAmountPaise: 240000,
      totalAmount: 2400,
      currency: 'INR',
      shares: [
        { memberId: 'mem_rohan', sharePaise: 60000 },
        { memberId: 'mem_arjun', sharePaise: 60000 },
        { memberId: 'mem_priya', sharePaise: 60000 },
        { memberId: 'mem_vikram', sharePaise: 60000 },
      ],
      providerName: 'Tata Power',
      createdByMembershipId: 'mem_arjun',
      createdAt: '2026-11-01T10:00:00Z',
    }

    // Meter audit: Rohan used AC heavily; total bill increases to ₹2,550 with Rohan's share becoming ₹750
    const newShares: ObligationParticipantShare[] = [
      { memberId: 'mem_rohan', sharePaise: 75000 },
      { memberId: 'mem_arjun', sharePaise: 60000 },
      { memberId: 'mem_priya', sharePaise: 60000 },
      { memberId: 'mem_vikram', sharePaise: 60000 },
    ]

    const { updatedObligation, correctionRecord } = correctFinancialObligation(
      obligation,
      255000,
      newShares,
      'AC usage surcharge on Rohan',
      'mem_arjun',
      testMembers
    )

    assert.strictEqual(updatedObligation.totalAmountPaise, 255000)
    assert.strictEqual(updatedObligation.shares.find((s) => s.memberId === 'mem_rohan')?.sharePaise, 75000)
    assert.strictEqual(updatedObligation.correctionHistory?.length, 1)
    assert.strictEqual(correctionRecord.previousTotalPaise, 240000)
    assert.strictEqual(correctionRecord.newTotalPaise, 255000)

    // Rohan had paid ₹300 confirmed contribution
    const contribution: FundContribution = {
      id: 'cnt-rohan-corr',
      accountId: 'acc-upi',
      contributorMembershipId: 'mem_rohan',
      contributorName: 'Rohan Sharma',
      amount: 300,
      date: '2026-11-02',
      status: 'confirmed',
    }
    const allocation: ObligationContributionAllocation = {
      id: 'alloc-rohan-corr',
      contributionId: 'cnt-rohan-corr',
      obligationId: updatedObligation.id,
      targetMemberId: 'mem_rohan',
      amountPaise: 30000,
      allocatedAt: '2026-11-02T10:00:00Z',
      allocatedByMembershipId: 'mem_rohan',
    }

    const summary = deriveMemberObligationSummary(
      'mem_rohan',
      updatedObligation,
      [allocation],
      [contribution],
      [],
      []
    )

    // Base share: ₹750, Allocated: ₹300 -> Remaining: ₹450
    assert.strictEqual(summary.baseSharePaise, 75000)
    assert.strictEqual(summary.confirmedAllocatedPaise, 30000)
    assert.strictEqual(summary.totalOutstandingPaise, 45000) // ₹450
  })

  test('Voiding: Preserves historical base shares, sets active debt to 0, and logs correction record', () => {
    const obligation: FinancialObligation = {
      id: 'ob-gas-void',
      category: 'gas_bill',
      title: 'Erroneous Gas Bill',
      billingPeriodStart: '2026-11-01',
      billingPeriodEnd: '2026-11-30',
      dueDate: '2026-12-05',
      totalAmountPaise: 120000,
      totalAmount: 1200,
      currency: 'INR',
      shares: [
        { memberId: 'mem_rohan', sharePaise: 30000 },
        { memberId: 'mem_arjun', sharePaise: 30000 },
        { memberId: 'mem_priya', sharePaise: 30000 },
        { memberId: 'mem_vikram', sharePaise: 30000 },
      ],
      providerName: 'Mahanagar Gas',
      createdByMembershipId: 'mem_arjun',
      createdAt: '2026-11-01T10:00:00Z',
    }

    const voidedOb = voidFinancialObligation(obligation, 'Duplicate bill received from utility', 'mem_arjun')
    assert.strictEqual(voidedOb.isVoided, true)
    assert.strictEqual(voidedOb.voidReason, 'Duplicate bill received from utility')
    assert.strictEqual(voidedOb.shares.length, 4) // Stored base shares are NOT zeroed!
    assert.strictEqual(voidedOb.shares[0].sharePaise, 30000)

    // Derived member summaries evaluate active outstanding to 0
    const summary = deriveMemberObligationSummary('mem_rohan', voidedOb, [], [], [], [])
    assert.strictEqual(summary.totalOutstandingPaise, 0)
    assert.strictEqual(summary.unpaidProviderSharePaise, 0)
    assert.strictEqual(summary.baseSharePaise, 30000) // Historical baseline is intact
  })

  test('Notifications: Pure deterministic generator produces unique keys, personalized amounts, and preserves read status', () => {
    const obligation: FinancialObligation = {
      id: 'ob-notif-01',
      category: 'electricity_bill',
      title: 'Power Bill',
      billingPeriodStart: '2026-11-01',
      billingPeriodEnd: '2026-11-30',
      dueDate: '2026-11-23', // 2 days from today (2026-11-21)
      totalAmountPaise: 240000,
      totalAmount: 2400,
      currency: 'INR',
      shares: [
        { memberId: 'mem_rohan', sharePaise: 60000 },
        { memberId: 'mem_arjun', sharePaise: 60000 },
      ],
      providerName: 'Tata Power',
      createdByMembershipId: 'mem_arjun',
      createdAt: '2026-11-01T10:00:00Z',
    }

    const notifications1 = deriveObligationNotifications({
      obligation,
      allocations: [],
      contributions: [],
      providerExpenses: [],
      settlements: [],
      claims: [],
      todayDate: '2026-11-21',
    })

    const notifications2 = deriveObligationNotifications({
      obligation,
      allocations: [],
      contributions: [],
      providerExpenses: [],
      settlements: [],
      claims: [],
      todayDate: '2026-11-21',
    })

    // Deterministic generation: identical keys across calls
    assert.strictEqual(notifications1.length, notifications2.length)
    for (let i = 0; i < notifications1.length; i++) {
      assert.strictEqual(notifications1[i].idempotencyKey, notifications2[i].idempotencyKey)
      assert.strictEqual(notifications1[i].id, notifications2[i].id)
    }

    // Rohan's notification has Rohan's personalized amount (₹600)
    const rohanNotif = notifications1.find((n) => n.recipientMemberId === 'mem_rohan' && n.eventType === 'share_assigned')
    assert.ok(rohanNotif)
    assert.strictEqual(rohanNotif.relevantAmountPaise, 60000)

    // Approaching due date notification generated
    const dueNotif = notifications1.find((n) => n.eventType === 'due_date_approaching')
    assert.ok(dueNotif)
    assert.match(dueNotif.message, /due in 2 day\(s\)/i)
  })

  /* ==========================================================================
     7. Stage 3 ExpenseItem Backward Compatibility & Regression Tests
     ========================================================================== */

  test('Stage 3 Compatibility: Ordinary shared expenses retain existing behavior, validateExpense works unchanged', () => {
    const ordinaryExpense: ExpenseItem = {
      id: 'exp-groceries',
      title: 'Weekly Groceries',
      category: 'Kitchen & Groceries',
      amount: 1500,
      amountPaise: 150000,
      payerMemberId: 'mem_arjun',
      paidBy: 'Arjun Verma',
      date: '2026-11-15',
      splitScopeType: 'all_active',
      participantMemberIds: ['mem_arjun', 'mem_rohan'],
      splits: [
        { memberId: 'mem_arjun', sharePaise: 75000, shareAmount: 750, settlementStatus: 'settled' },
        { memberId: 'mem_rohan', sharePaise: 75000, shareAmount: 750, settlementStatus: 'unsettled' },
      ],
      disbursementChannel: 'member_out_of_pocket',
      disbursementStatus: 'disbursed',
    }

    const valResult = validateExpense(ordinaryExpense, testAccounts, {
      accounts: [],
      totalAvailableBalance: 0,
      totalAvailableBalancePaise: 0,
      totalPendingBalance: 0,
      totalPendingBalancePaise: 0,
      asOfDate: '2026-11-20',
    })

    assert.strictEqual(valResult.isValid, true)
  })

  /* ==========================================================================
     8. Stage 6 Step 2.2 Root Financial Reducer & Lifecycle Invariant Tests
     ========================================================================== */

  describe('Root Financial State Reducer & Transaction Lifecycle', () => {
    const baseState: RootFinancialState = {
      accounts: [
        {
          id: 'acc_treasury_upi',
          name: 'Home Fund UPI',
          accountType: 'personal_upi',
          custodianMembershipId: 'mem_arjun',
          custodianName: 'Arjun Verma',
          upiId: 'demo-collector@upi.invalid',
          isActive: true,
        },
        {
          id: 'acc_inactive',
          name: 'Old Cash Box',
          accountType: 'cash_box',
          custodianMembershipId: 'mem_arjun',
          custodianName: 'Arjun Verma',
          isActive: false,
        },
      ],
      contributions: [],
      allocations: [],
      obligations: [],
      expenses: [],
      transfers: [],
      peerClaims: [],
      memberSettlements: [],
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

    test('1. Atomic contribution confirmation and allocation', () => {
      const obligation: FinancialObligation = {
        id: 'ob_test_rent',
        category: 'rent_cycle',
        title: 'Rent Cycle',
        billingPeriodStart: '2026-12-01',
        billingPeriodEnd: '2026-12-31',
        dueDate: '2026-12-05',
        totalAmountPaise: 20000,
        totalAmount: 200,
        currency: 'INR',
        shares: [
          { memberId: 'mem_rohan', sharePaise: 10000 },
          { memberId: 'mem_arjun', sharePaise: 10000 },
        ],
        providerName: 'Landlord',
        createdByMembershipId: 'mem_arjun',
        createdAt: '2026-11-20T10:00:00.000Z',
      }

      const pendingContribution: FundContribution = {
        id: 'cnt_atomic_1',
        accountId: 'acc_treasury_upi',
        contributorMembershipId: 'mem_rohan',
        contributorName: 'Rohan Sharma',
        amount: 100, // ₹100 = 10,000 paise
        date: '2026-11-20',
        status: 'pending_confirmation',
      }

      const stateWithOb: RootFinancialState = {
        ...baseState,
        obligations: [obligation],
        contributions: [pendingContribution],
      }

      const action: FinancialAction = {
        type: 'CONFIRM_CONTRIBUTION',
        actionId: 'act_confirm_atomic_1',
        payload: {
          contributionId: 'cnt_atomic_1',
          confirmedByMembershipId: 'mem_arjun',
          confirmedByName: 'Arjun Verma',
          confirmedAt: '2026-11-20T11:00:00.000Z',
          allocation: {
            id: 'alloc_atomic_1',
            obligationId: 'ob_test_rent',
            targetMemberId: 'mem_rohan',
            amountPaise: 4000,
            allocatedAt: '2026-11-20T11:00:00.000Z',
            allocatedByMembershipId: 'mem_arjun',
          },
        },
      }

      const res = financialStateReducer(stateWithOb, action)
      assert.strictEqual(res.success, true)
      if (!res.success) return

      const updatedCnt = res.state.contributions.find((c) => c.id === 'cnt_atomic_1')
      assert.strictEqual(updatedCnt?.status, 'confirmed')
      assert.strictEqual(calculateAccountLiquidBalance(res.state, 'acc_treasury_upi'), 10000)

      assert.strictEqual(res.state.allocations.length, 1)
      assert.strictEqual(res.state.allocations[0].id, 'alloc_atomic_1')
      assert.strictEqual(res.state.allocations[0].amountPaise, 4000)
      assert.strictEqual(res.state.allocations[0].targetMemberId, 'mem_rohan')
    })

    test('2. Pending contribution does not affect Treasury or confirmed allocations', () => {
      const pendingContribution: FundContribution = {
        id: 'cnt_pending_1',
        accountId: 'acc_treasury_upi',
        contributorMembershipId: 'mem_rohan',
        contributorName: 'Rohan Sharma',
        amount: 500, // ₹500 = 50,000 paise
        date: '2026-11-20',
        status: 'pending_confirmation',
      }

      const action: FinancialAction = {
        type: 'SUBMIT_CONTRIBUTION',
        actionId: 'act_submit_1',
        payload: {
          contribution: pendingContribution,
        },
      }

      const res = financialStateReducer(baseState, action)
      assert.strictEqual(res.success, true)
      if (!res.success) return

      const cnt = res.state.contributions.find((c) => c.id === 'cnt_pending_1')
      assert.strictEqual(cnt?.status, 'pending_confirmation')
      assert.strictEqual(calculateAccountLiquidBalance(res.state, 'acc_treasury_upi'), 0)
      assert.strictEqual(res.state.allocations.length, 0)
    })

    test('3. Contribution rejection releases reservations', () => {
      const pendingContribution: FundContribution = {
        id: 'cnt_to_reject',
        accountId: 'acc_treasury_upi',
        contributorMembershipId: 'mem_rohan',
        contributorName: 'Rohan Sharma',
        amount: 300,
        date: '2026-11-20',
        status: 'pending_confirmation',
      }

      const stateWithPending: RootFinancialState = {
        ...baseState,
        contributions: [pendingContribution],
      }

      const action: FinancialAction = {
        type: 'REJECT_CONTRIBUTION',
        actionId: 'act_reject_1',
        payload: {
          contributionId: 'cnt_to_reject',
          rejectedByMembershipId: 'mem_arjun',
          rejectionReason: 'Invalid payment screenshot reference',
          rejectedAt: '2026-11-20T12:00:00.000Z',
        },
      }

      const res = financialStateReducer(stateWithPending, action)
      assert.strictEqual(res.success, true)
      if (!res.success) return

      const rejectedCnt = res.state.contributions.find((c) => c.id === 'cnt_to_reject')
      assert.strictEqual(rejectedCnt?.status, 'rejected')
      assert.strictEqual(rejectedCnt?.rejectionReason, 'Invalid payment screenshot reference')
      assert.strictEqual(calculateAccountLiquidBalance(res.state, 'acc_treasury_upi'), 0)
    })

    test('4. Duplicate confirmation is idempotent', () => {
      const confirmedContribution: FundContribution = {
        id: 'cnt_already_confirmed',
        accountId: 'acc_treasury_upi',
        contributorMembershipId: 'mem_rohan',
        contributorName: 'Rohan Sharma',
        amount: 200,
        date: '2026-11-20',
        status: 'confirmed',
        confirmedByMembershipId: 'mem_arjun',
        confirmedByName: 'Arjun Verma',
        confirmedAt: '2026-11-20T10:00:00.000Z',
      }

      const state: RootFinancialState = {
        ...baseState,
        contributions: [confirmedContribution],
      }

      const action: FinancialAction = {
        type: 'CONFIRM_CONTRIBUTION',
        actionId: 'act_repeat_confirm',
        payload: {
          contributionId: 'cnt_already_confirmed',
          confirmedByMembershipId: 'mem_arjun',
          confirmedByName: 'Arjun Verma',
        },
      }

      const res1 = financialStateReducer(state, action)
      assert.strictEqual(res1.success, true)

      // Repeating with the same actionId triggers processedActionIds idempotency guard
      const res2 = financialStateReducer(res1.state, action)
      assert.strictEqual(res2.success, true)
      assert.deepStrictEqual(res1.state, res2.state)
    })

    test('5. Treasury provider payment succeeds with sufficient balance', () => {
      const confirmedContribution: FundContribution = {
        id: 'cnt_seed_funds',
        accountId: 'acc_treasury_upi',
        contributorMembershipId: 'mem_arjun',
        contributorName: 'Arjun Verma',
        amount: 100, // ₹100 = 10,000 paise
        date: '2026-11-20',
        status: 'confirmed',
      }

      const obligation: FinancialObligation = {
        id: 'ob_elec_test',
        category: 'electricity_bill',
        title: 'Electricity Bill',
        billingPeriodStart: '2026-11-01',
        billingPeriodEnd: '2026-11-30',
        dueDate: '2026-12-05',
        totalAmountPaise: 10000,
        totalAmount: 100,
        currency: 'INR',
        shares: [{ memberId: 'mem_arjun', sharePaise: 10000 }],
        providerName: 'Tata Power',
        createdByMembershipId: 'mem_arjun',
        createdAt: '2026-11-20T10:00:00.000Z',
      }

      const state: RootFinancialState = {
        ...baseState,
        obligations: [obligation],
        contributions: [confirmedContribution],
      }

      const providerExpense: ExpenseItem = {
        id: 'exp_provider_1',
        title: 'Tata Power Disbursal',
        category: 'electricity_bill',
        amount: 60,
        amountPaise: 6000,
        payerMemberId: 'mem_arjun',
        paidBy: 'Home Fund Custodian',
        date: '2026-11-20',
        splitScopeType: 'all_active',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: 'treasury_online_upi',
        disbursedFromAccountId: 'acc_treasury_upi',
        disbursementStatus: 'disbursed',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: 'ob_elec_test',
      }

      const action: FinancialAction = {
        type: 'DISBURSE_TREASURY_PROVIDER_PAYMENT',
        actionId: 'act_disburse_1',
        payload: {
          expense: providerExpense,
          obligationId: 'ob_elec_test',
        },
      }

      const res = financialStateReducer(state, action)
      assert.strictEqual(res.success, true)
      if (!res.success) return

      assert.strictEqual(res.state.expenses.length, 1)
      assert.strictEqual(res.state.expenses[0].splits.length, 0)
      assert.strictEqual(res.state.expenses[0].participantMemberIds.length, 0)
      assert.strictEqual(calculateAccountLiquidBalance(res.state, 'acc_treasury_upi'), 4000)
    })

    test('6. Treasury payment fails with insufficient balance', () => {
      const confirmedContribution: FundContribution = {
        id: 'cnt_small_seed',
        accountId: 'acc_treasury_upi',
        contributorMembershipId: 'mem_arjun',
        contributorName: 'Arjun Verma',
        amount: 40, // ₹40 = 4,000 paise
        date: '2026-11-20',
        status: 'confirmed',
      }

      const obligation: FinancialObligation = {
        id: 'ob_elec_test',
        category: 'electricity_bill',
        title: 'Electricity Bill',
        billingPeriodStart: '2026-11-01',
        billingPeriodEnd: '2026-11-30',
        dueDate: '2026-12-05',
        totalAmountPaise: 10000,
        totalAmount: 100,
        currency: 'INR',
        shares: [{ memberId: 'mem_arjun', sharePaise: 10000 }],
        providerName: 'Tata Power',
        createdByMembershipId: 'mem_arjun',
        createdAt: '2026-11-20T10:00:00.000Z',
      }

      const state: RootFinancialState = {
        ...baseState,
        obligations: [obligation],
        contributions: [confirmedContribution],
      }

      const overpayingExpense: ExpenseItem = {
        id: 'exp_provider_excess',
        title: 'Tata Power Disbursal',
        category: 'electricity_bill',
        amount: 60,
        amountPaise: 6000, // 6,000 > 4,000 available
        payerMemberId: 'mem_arjun',
        paidBy: 'Home Fund Custodian',
        date: '2026-11-20',
        splitScopeType: 'all_active',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: 'treasury_online_upi',
        disbursedFromAccountId: 'acc_treasury_upi',
        disbursementStatus: 'disbursed',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: 'ob_elec_test',
      }

      const action: FinancialAction = {
        type: 'DISBURSE_TREASURY_PROVIDER_PAYMENT',
        actionId: 'act_disburse_overdraft',
        payload: {
          expense: overpayingExpense,
          obligationId: 'ob_elec_test',
        },
      }

      const res = financialStateReducer(state, action)
      assert.strictEqual(res.success, false)
      if (res.success) return
      assert.match(res.error, /insufficient treasury balance/i)
      assert.strictEqual(calculateAccountLiquidBalance(state, 'acc_treasury_upi'), 4000)
    })

    test('7. Inactive or incompatible Treasury account is rejected', () => {
      const obligation: FinancialObligation = {
        id: 'ob_dummy',
        category: 'rent_cycle',
        title: 'Rent',
        billingPeriodStart: '2026-11-01',
        billingPeriodEnd: '2026-11-30',
        dueDate: '2026-12-05',
        totalAmountPaise: 10000,
        totalAmount: 100,
        currency: 'INR',
        shares: [{ memberId: 'mem_arjun', sharePaise: 10000 }],
        providerName: 'Landlord',
        createdByMembershipId: 'mem_arjun',
        createdAt: '2026-11-20T10:00:00.000Z',
      }

      const inactiveExpense: ExpenseItem = {
        id: 'exp_inactive',
        title: 'Disbursal via Inactive',
        category: 'rent_cycle',
        amount: 50,
        amountPaise: 5000,
        payerMemberId: 'mem_arjun',
        paidBy: 'Arjun',
        date: '2026-11-20',
        splitScopeType: 'all_active',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: 'cash_box',
        disbursedFromAccountId: 'acc_inactive',
        disbursementStatus: 'disbursed',
      }

      const res = financialStateReducer(
        { ...baseState, obligations: [obligation] },
        {
          type: 'DISBURSE_TREASURY_PROVIDER_PAYMENT',
          payload: { expense: inactiveExpense, obligationId: 'ob_dummy' },
        }
      )
      assert.strictEqual(res.success, false)
      if (res.success) return
      assert.match(res.error, /inactive/i)
    })

    test('8. Repeated/rapid Treasury payment cannot double-spend', () => {
      const seed: FundContribution = {
        id: 'cnt_seed_50',
        accountId: 'acc_treasury_upi',
        contributorMembershipId: 'mem_arjun',
        contributorName: 'Arjun Verma',
        amount: 50, // 5,000 paise
        date: '2026-11-20',
        status: 'confirmed',
      }

      const obligation: FinancialObligation = {
        id: 'ob_large',
        category: 'rent_cycle',
        title: 'Rent',
        billingPeriodStart: '2026-11-01',
        billingPeriodEnd: '2026-11-30',
        dueDate: '2026-12-05',
        totalAmountPaise: 10000,
        totalAmount: 100,
        currency: 'INR',
        shares: [{ memberId: 'mem_arjun', sharePaise: 10000 }],
        providerName: 'Landlord',
        createdByMembershipId: 'mem_arjun',
        createdAt: '2026-11-20T10:00:00.000Z',
      }

      const state: RootFinancialState = {
        ...baseState,
        obligations: [obligation],
        contributions: [seed],
      }

      const expense1: ExpenseItem = {
        id: 'exp_pay_1',
        title: 'Part 1',
        category: 'rent_cycle',
        amount: 40,
        amountPaise: 4000,
        payerMemberId: 'mem_arjun',
        paidBy: 'Arjun',
        date: '2026-11-20',
        splitScopeType: 'all_active',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: 'treasury_online_upi',
        disbursedFromAccountId: 'acc_treasury_upi',
        disbursementStatus: 'disbursed',
      }

      // Step 1: 4,000p succeeds, balance becomes 1,000p
      const res1 = financialStateReducer(state, {
        type: 'DISBURSE_TREASURY_PROVIDER_PAYMENT',
        payload: { expense: expense1, obligationId: 'ob_large' },
      })
      assert.strictEqual(res1.success, true)
      if (!res1.success) return

      // Step 2: Attempting another 4,000p against remaining 1,000p fails
      const expense2: ExpenseItem = {
        id: 'exp_pay_2',
        title: 'Part 2',
        category: 'rent_cycle',
        amount: 40,
        amountPaise: 4000,
        payerMemberId: 'mem_arjun',
        paidBy: 'Arjun',
        date: '2026-11-20',
        splitScopeType: 'all_active',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: 'treasury_online_upi',
        disbursedFromAccountId: 'acc_treasury_upi',
        disbursementStatus: 'disbursed',
      }

      const res2 = financialStateReducer(res1.state, {
        type: 'DISBURSE_TREASURY_PROVIDER_PAYMENT',
        payload: { expense: expense2, obligationId: 'ob_large' },
      })
      assert.strictEqual(res2.success, false)
      if (res2.success) return
      assert.match(res2.error, /insufficient treasury balance/i)
    })

    test('9. Personal provider payment never debits Treasury', () => {
      const obligation: FinancialObligation = {
        id: 'ob_personal',
        category: 'electricity_bill',
        title: 'Electricity',
        billingPeriodStart: '2026-11-01',
        billingPeriodEnd: '2026-11-30',
        dueDate: '2026-12-05',
        totalAmountPaise: 10000,
        totalAmount: 100,
        currency: 'INR',
        shares: [{ memberId: 'mem_arjun', sharePaise: 10000 }],
        providerName: 'Tata Power',
        createdByMembershipId: 'mem_arjun',
        createdAt: '2026-11-20T10:00:00.000Z',
      }

      const personalExpense: ExpenseItem = {
        id: 'exp_out_of_pocket',
        title: 'Arjun Paid Tata Power Out of Pocket',
        category: 'electricity_bill',
        amount: 50,
        amountPaise: 5000,
        payerMemberId: 'mem_arjun',
        paidBy: 'Arjun Verma',
        date: '2026-11-20',
        splitScopeType: 'all_active',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: 'member_out_of_pocket',
        disbursedFromAccountId: 'acc_treasury_upi',
        disbursementStatus: 'disbursed',
      }

      // Trying to disburse personal out of pocket from treasury account must fail
      const res = financialStateReducer(
        { ...baseState, obligations: [obligation] },
        {
          type: 'DISBURSE_TREASURY_PROVIDER_PAYMENT',
          payload: { expense: personalExpense, obligationId: 'ob_personal' },
        }
      )
      assert.strictEqual(res.success, false)
      if (res.success) return
      assert.match(res.error, /personal out-of-pocket/i)
    })

    test('10. Allocation cannot exceed contribution capacity or member share', () => {
      const contribution: FundContribution = {
        id: 'cnt_cap_check',
        accountId: 'acc_treasury_upi',
        contributorMembershipId: 'mem_rohan',
        contributorName: 'Rohan Sharma',
        amount: 50, // 5,000 paise
        date: '2026-11-20',
        status: 'confirmed',
      }

      const obligation: FinancialObligation = {
        id: 'ob_cap_check',
        category: 'rent_cycle',
        title: 'Rent',
        billingPeriodStart: '2026-11-01',
        billingPeriodEnd: '2026-11-30',
        dueDate: '2026-12-05',
        totalAmountPaise: 10000,
        totalAmount: 100,
        currency: 'INR',
        shares: [
          { memberId: 'mem_rohan', sharePaise: 3000 },
          { memberId: 'mem_arjun', sharePaise: 7000 },
        ],
        providerName: 'Landlord',
        createdByMembershipId: 'mem_arjun',
        createdAt: '2026-11-20T10:00:00.000Z',
      }

      const state: RootFinancialState = {
        ...baseState,
        obligations: [obligation],
        contributions: [contribution],
      }

      // Exceeds contribution capacity (6,000p > 5,000p)
      const res1 = financialStateReducer(state, {
        type: 'CREATE_CONTRIBUTION_ALLOCATION',
        payload: {
          allocation: {
            id: 'alloc_fail_1',
            contributionId: 'cnt_cap_check',
            obligationId: 'ob_cap_check',
            targetMemberId: 'mem_arjun',
            amountPaise: 6000,
            allocatedAt: '2026-11-20T10:00:00.000Z',
            allocatedByMembershipId: 'mem_arjun',
          },
        },
      })
      assert.strictEqual(res1.success, false)
      if (res1.success) return
      assert.match(res1.error, /exceeds contribution remaining capacity/i)

      // Exceeds member share ceiling (4,000p > 3,000p share of Rohan)
      const res2 = financialStateReducer(state, {
        type: 'CREATE_CONTRIBUTION_ALLOCATION',
        payload: {
          allocation: {
            id: 'alloc_fail_2',
            contributionId: 'cnt_cap_check',
            obligationId: 'ob_cap_check',
            targetMemberId: 'mem_rohan',
            amountPaise: 4000,
            allocatedAt: '2026-11-20T10:00:00.000Z',
            allocatedByMembershipId: 'mem_arjun',
          },
        },
      })
      assert.strictEqual(res2.success, false)
      if (res2.success) return
      assert.match(res2.error, /exceeds target member share ceiling/i)
    })

    test('11. Creditor-specific partial settlement and pending reservation', () => {
      const claimArjun = {
        id: 'claim_arjun',
        expenseId: 'exp_elec',
        obligationId: 'ob_elec',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_arjun',
        claimAmountPaise: 5000,
        createdAt: '2026-11-15T10:00:00.000Z',
      }

      const claimPriya = {
        id: 'claim_priya',
        expenseId: 'exp_gas',
        obligationId: 'ob_gas',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_priya',
        claimAmountPaise: 3000,
        createdAt: '2026-11-15T10:00:00.000Z',
      }

      const state: RootFinancialState = {
        ...baseState,
        peerClaims: [claimArjun, claimPriya],
      }

      // Submit partial settlement to Arjun (2,000p)
      const settlementRecord: MemberSettlementRecord = {
        id: 'settle_rohan_arjun_1',
        idempotencyKey: 'idem_settle_1',
        obligationId: 'ob_elec',
        claimId: 'claim_arjun',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_arjun',
        amountPaise: 2000,
        paymentMethod: 'upi',
        paymentReference: 'DEMO-SIMULATED-UPI-REF-01',
        paymentDate: '2026-11-20',
        status: 'pending_confirmation',
        submittedAt: '2026-11-20T12:00:00.000Z',
      }

      const res = financialStateReducer(state, {
        type: 'SUBMIT_MEMBER_SETTLEMENT',
        payload: { settlement: settlementRecord },
      })
      assert.strictEqual(res.success, true)
      if (!res.success) return

      // Assert FIFO allocations helper returns correct deterministic metrics
      const fifoCheck = calculateClaimFIFOAllocations(res.state, 'claim_arjun')
      assert.strictEqual(fifoCheck.claimAmountPaise, 5000)
      assert.strictEqual(fifoCheck.allocatedToClaimPaise, 0) // pending is not confirmed yet

      // Attempting another settlement of 4,000p to Arjun fails because 2,000p is reserved (capacity = 3,000p)
      const valArjun = validateMemberSettlement(
        {
          idempotencyKey: 'idem_settle_2',
          claimId: 'claim_arjun',
          debtorMemberId: 'mem_rohan',
          creditorMemberId: 'mem_arjun',
          amountPaise: 4000,
        },
        claimArjun,
        res.state.memberSettlements
      )
      assert.strictEqual(valArjun.isValid, false)
      assert.match(valArjun.errorMessage!, /exceeds available claim capacity/i)

      // Priya's claim capacity remains fully unreserved (3,000p available)
      const valPriya = validateMemberSettlement(
        {
          idempotencyKey: 'idem_settle_priya',
          claimId: 'claim_priya',
          debtorMemberId: 'mem_rohan',
          creditorMemberId: 'mem_priya',
          amountPaise: 3000,
        },
        claimPriya,
        res.state.memberSettlements
      )
      assert.strictEqual(valPriya.isValid, true)

      // Priya cannot confirm Arjun's settlement
      const confirmAttempt = financialStateReducer(res.state, {
        type: 'CONFIRM_MEMBER_SETTLEMENT',
        payload: {
          settlementId: 'settle_rohan_arjun_1',
          confirmedByMemberId: 'mem_priya', // Not the creditor!
        },
      })
      assert.strictEqual(confirmAttempt.success, false)
      if (confirmAttempt.success) return
      assert.match(confirmAttempt.error, /only designated creditor/i)
    })

    test('12. Rejected settlement releases reservation', () => {
      const claim = {
        id: 'claim_to_reject',
        expenseId: 'exp_test',
        obligationId: 'ob_test',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_arjun',
        claimAmountPaise: 5000,
        createdAt: '2026-11-15T10:00:00.000Z',
      }

      const pendingSettlement: MemberSettlementRecord = {
        id: 'settle_pending_rej',
        idempotencyKey: 'idem_rej_1',
        obligationId: 'ob_test',
        claimId: 'claim_to_reject',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_arjun',
        amountPaise: 2000,
        paymentMethod: 'upi',
        paymentReference: 'DEMO-SIMULATED-UPI-REF-02',
        paymentDate: '2026-11-20',
        status: 'pending_confirmation',
        submittedAt: '2026-11-20T12:00:00.000Z',
      }

      const state: RootFinancialState = {
        ...baseState,
        peerClaims: [claim],
        memberSettlements: [pendingSettlement],
      }

      const res = financialStateReducer(state, {
        type: 'REJECT_MEMBER_SETTLEMENT',
        payload: {
          settlementId: 'settle_pending_rej',
          rejectedByMemberId: 'mem_arjun',
          rejectionReason: 'Payment not received in account',
          rejectedAt: '2026-11-20T13:00:00.000Z',
        },
      })
      assert.strictEqual(res.success, true)
      if (!res.success) return

      // Now reservation is released, full 5,000p capacity is available again
      const val = validateMemberSettlement(
        {
          idempotencyKey: 'idem_new_sub',
          claimId: 'claim_to_reject',
          debtorMemberId: 'mem_rohan',
          creditorMemberId: 'mem_arjun',
          amountPaise: 5000,
        },
        claim,
        res.state.memberSettlements
      )
      assert.strictEqual(val.isValid, true)
    })

    test('13. Confirmed settlement reversal preserves history', () => {
      const claim = {
        id: 'claim_rev',
        expenseId: 'exp_rev',
        obligationId: 'ob_rev',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_arjun',
        claimAmountPaise: 5000,
        createdAt: '2026-11-15T10:00:00.000Z',
      }

      const confirmedSettlement: MemberSettlementRecord = {
        id: 'settle_confirmed_rev',
        idempotencyKey: 'idem_rev_1',
        obligationId: 'ob_rev',
        claimId: 'claim_rev',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_arjun',
        amountPaise: 3000,
        paymentMethod: 'upi',
        paymentReference: 'DEMO-SIMULATED-UPI-REF-01',
        paymentDate: '2026-11-18',
        status: 'confirmed',
        submittedAt: '2026-11-18T10:00:00.000Z',
        confirmedAt: '2026-11-18T10:30:00.000Z',
        confirmedByMemberId: 'mem_arjun',
      }

      const state: RootFinancialState = {
        ...baseState,
        peerClaims: [claim],
        memberSettlements: [confirmedSettlement],
      }

      const res = financialStateReducer(state, {
        type: 'REVERSE_MEMBER_SETTLEMENT',
        payload: {
          reversal: {
            id: 'rev_1',
            settlementId: 'settle_confirmed_rev',
            obligationId: 'ob_rev',
            claimId: 'claim_rev',
            debtorMemberId: 'mem_rohan',
            creditorMemberId: 'mem_arjun',
            reversalAmountPaise: 1000,
            reason: 'Bank bounced or partial chargeback',
            reversedByMemberId: 'mem_arjun',
            reversedAt: '2026-11-20T10:00:00.000Z',
            idempotencyKey: 'idem_rev_op_1',
          },
        },
      })
      assert.strictEqual(res.success, true)
      if (!res.success) return

      // History preserved: confirmed settlement is NOT deleted or modified
      const original = res.state.memberSettlements.find((s) => s.id === 'settle_confirmed_rev')
      assert.strictEqual(original?.status, 'confirmed')
      assert.strictEqual(original?.amountPaise, 3000)

      // Reversal record added
      assert.strictEqual(res.state.memberSettlementReversals.length, 1)
      assert.strictEqual(res.state.memberSettlementReversals[0].reversalAmountPaise, 1000)
    })

    test('14. Correction and reversal in both event orders produce identical final debt classifications', () => {
      // Setup identical base state for Sequence A and Sequence B:
      // Base share = 1,000p.
      // Confirmed settlement = 1,500p (creating 500p peer credit).
      // Cash refund = 500p to debtor.
      // Economic changes to apply in both orders:
      // 1. Upward correction of +300p (share becomes 1,300p).
      // 2. Settlement reversal of 400p.

      const obligationInit: FinancialObligation = {
        id: 'ob_symm',
        category: 'rent_cycle',
        title: 'Symmetry Rent',
        billingPeriodStart: '2026-11-01',
        billingPeriodEnd: '2026-11-30',
        dueDate: '2026-12-05',
        totalAmountPaise: 1000,
        totalAmount: 10,
        currency: 'INR',
        shares: [{ memberId: 'mem_rohan', sharePaise: 1000 }],
        providerName: 'Landlord',
        createdByMembershipId: 'mem_arjun',
        createdAt: '2026-11-01T10:00:00.000Z',
      }

      const settlementInit: MemberSettlementRecord = {
        id: 'settle_symm',
        idempotencyKey: 'idem_symm',
        obligationId: 'ob_symm',
        claimId: 'claim_symm',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_arjun',
        amountPaise: 1500,
        paymentMethod: 'upi',
        paymentReference: 'DEMO-SIMULATED-UPI-REF-01',
        paymentDate: '2026-11-05',
        status: 'confirmed',
        submittedAt: '2026-11-05T10:00:00.000Z',
        confirmedAt: '2026-11-05T10:30:00.000Z',
        confirmedByMemberId: 'mem_arjun',
      }

      const peerCreditInit = {
        id: 'pc_symm',
        obligationId: 'ob_symm',
        claimId: 'claim_symm',
        settlementId: 'settle_symm',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_arjun',
        initialExcessPaise: 500,
        createdAt: '2026-11-05T10:30:00.000Z',
      }

      const refundResolutionInit = {
        id: 'res_symm',
        peerCreditId: 'pc_symm',
        resolutionType: 'cash_refund' as const,
        resolvedAmountPaise: 500,
        resolvedByMemberId: 'mem_arjun',
        resolvedAt: '2026-11-06T10:00:00.000Z',
        idempotencyKey: 'idem_res_symm',
      }

      const initialSharedState: RootFinancialState = {
        ...baseState,
        obligations: [obligationInit],
        memberSettlements: [settlementInit],
        peerCredits: [peerCreditInit],
        peerCreditResolutions: [refundResolutionInit],
      }

      // Verify available peer credit balance selector: 500p initial - 500p resolution = 0p available
      assert.strictEqual(getAvailablePeerCreditPaise(initialSharedState, 'pc_symm'), 0)

      // SEQUENCE A: Upward correction first, then Settlement reversal
      const seqA_step1 = financialStateReducer(initialSharedState, {
        type: 'APPLY_UPWARD_CORRECTION_TO_OBLIGATION_CREDITS',
        payload: {
          obligationId: 'ob_symm',
          correctionId: 'corr_up_300',
          newShares: [{ memberId: 'mem_rohan', sharePaise: 1300 }],
          reason: 'Landlord increased maintenance component by 300p',
          correctedByMembershipId: 'mem_arjun',
        },
      })
      assert.strictEqual(seqA_step1.success, true)

      const seqA_final = financialStateReducer(seqA_step1.state, {
        type: 'REVERSE_MEMBER_SETTLEMENT',
        payload: {
          reversal: {
            id: 'rev_400',
            settlementId: 'settle_symm',
            obligationId: 'ob_symm',
            claimId: 'claim_symm',
            debtorMemberId: 'mem_rohan',
            creditorMemberId: 'mem_arjun',
            reversalAmountPaise: 400,
            reason: 'Bank chargeback of 400p',
            reversedByMemberId: 'mem_arjun',
            reversedAt: '2026-11-10T10:00:00.000Z',
            idempotencyKey: 'idem_rev_400',
          },
        },
      })
      assert.strictEqual(seqA_final.success, true)

      // SEQUENCE B: Settlement reversal first, then Upward correction
      const seqB_step1 = financialStateReducer(initialSharedState, {
        type: 'REVERSE_MEMBER_SETTLEMENT',
        payload: {
          reversal: {
            id: 'rev_400',
            settlementId: 'settle_symm',
            obligationId: 'ob_symm',
            claimId: 'claim_symm',
            debtorMemberId: 'mem_rohan',
            creditorMemberId: 'mem_arjun',
            reversalAmountPaise: 400,
            reason: 'Bank chargeback of 400p',
            reversedByMemberId: 'mem_arjun',
            reversedAt: '2026-11-10T10:00:00.000Z',
            idempotencyKey: 'idem_rev_400',
          },
        },
      })
      assert.strictEqual(seqB_step1.success, true)

      const seqB_final = financialStateReducer(seqB_step1.state, {
        type: 'APPLY_UPWARD_CORRECTION_TO_OBLIGATION_CREDITS',
        payload: {
          obligationId: 'ob_symm',
          correctionId: 'corr_up_300',
          newShares: [{ memberId: 'mem_rohan', sharePaise: 1300 }],
          reason: 'Landlord increased maintenance component by 300p',
          correctedByMembershipId: 'mem_arjun',
        },
      })
      assert.strictEqual(seqB_final.success, true)

      // Derive debt classifications in both sequences
      const resultA = deriveOrderIndependentMemberDebt(seqA_final.state, 'ob_symm', 'mem_rohan')
      const resultB = deriveOrderIndependentMemberDebt(seqB_final.state, 'ob_symm', 'mem_rohan')

      // Assert identical order-independent debt classification in both event orders
      assert.strictEqual(resultA.unpaidObligationSharePaise, 200)
      assert.strictEqual(resultB.unpaidObligationSharePaise, 200)

      assert.strictEqual(resultA.unbackedRefundLiabilityPaise, 500)
      assert.strictEqual(resultB.unbackedRefundLiabilityPaise, 500)

      assert.strictEqual(resultA.totalOutstandingPaise, 700)
      assert.strictEqual(resultB.totalOutstandingPaise, 700)

      assert.deepStrictEqual(resultA, resultB)
    })

    test('15. The approved 1,000p / 1,500p / 500p / +300p / -400p worked example reconciles to 700p total outstanding', () => {
      // Exact reconciliation formula check:
      // L_current = 1,300p
      // EffectiveSettledTotal = 1,500p - 400p = 1,100p
      // NetRefundsReceived = 500p
      // EffectiveSettledAllocatedToClaim = min(1,300p, 1,100p) = 1,100p
      // AuthoritativeLegitimateExcess = max(0, 1,100p - 1,300p) = 0p
      // unpaidObligationSharePaise = 1,300p - 1,100p = 200p
      // unbackedRefundLiabilityPaise = 500p - 0p = 500p
      // TotalOutstanding = 200p + 500p = 700p

      const obligation: FinancialObligation = {
        id: 'ob_worked_ex',
        category: 'rent_cycle',
        title: 'Worked Example Rent',
        billingPeriodStart: '2026-11-01',
        billingPeriodEnd: '2026-11-30',
        dueDate: '2026-12-05',
        totalAmountPaise: 1300,
        totalAmount: 13,
        currency: 'INR',
        shares: [{ memberId: 'mem_rohan', sharePaise: 1300 }],
        providerName: 'Landlord',
        createdByMembershipId: 'mem_arjun',
        createdAt: '2026-11-01T10:00:00.000Z',
      }

      const settlement: MemberSettlementRecord = {
        id: 'settle_worked_ex',
        idempotencyKey: 'idem_worked',
        obligationId: 'ob_worked_ex',
        claimId: 'claim_worked',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_arjun',
        amountPaise: 1500,
        paymentMethod: 'upi',
        paymentReference: 'DEMO-SIMULATED-UPI-REF-01',
        paymentDate: '2026-11-05',
        status: 'confirmed',
        submittedAt: '2026-11-05T10:00:00.000Z',
        confirmedAt: '2026-11-05T10:30:00.000Z',
        confirmedByMemberId: 'mem_arjun',
      }

      const reversal = {
        id: 'rev_worked_400',
        settlementId: 'settle_worked_ex',
        obligationId: 'ob_worked_ex',
        claimId: 'claim_worked',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_arjun',
        reversalAmountPaise: 400,
        reason: 'Reversal',
        reversedByMemberId: 'mem_arjun',
        reversedAt: '2026-11-10T10:00:00.000Z',
        idempotencyKey: 'idem_rev_400',
      }

      const peerCredit = {
        id: 'pc_worked',
        obligationId: 'ob_worked_ex',
        claimId: 'claim_worked',
        settlementId: 'settle_worked_ex',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_arjun',
        initialExcessPaise: 500,
        createdAt: '2026-11-05T10:30:00.000Z',
      }

      const refundResolution = {
        id: 'res_worked_500',
        peerCreditId: 'pc_worked',
        resolutionType: 'cash_refund' as const,
        resolvedAmountPaise: 500,
        resolvedByMemberId: 'mem_arjun',
        resolvedAt: '2026-11-06T10:00:00.000Z',
        idempotencyKey: 'idem_res_worked',
      }

      const state: RootFinancialState = {
        ...baseState,
        obligations: [obligation],
        memberSettlements: [settlement],
        memberSettlementReversals: [reversal],
        peerCredits: [peerCredit],
        peerCreditResolutions: [refundResolution],
      }

      const debt = deriveOrderIndependentMemberDebt(state, 'ob_worked_ex', 'mem_rohan')

      assert.strictEqual(debt.currentObligationSharePaise, 1300)
      assert.strictEqual(debt.effectiveSettledTotalPaise, 1100)
      assert.strictEqual(debt.effectiveSettledAllocatedToClaimPaise, 1100)
      assert.strictEqual(debt.authoritativeLegitimateExcessPaise, 0)
      assert.strictEqual(debt.netRefundsReceivedPaise, 500)

      assert.strictEqual(debt.unpaidObligationSharePaise, 200)
      assert.strictEqual(debt.unbackedRefundLiabilityPaise, 500)
      assert.strictEqual(debt.totalOutstandingPaise, 700)
      assert.strictEqual(debt.excessCreditorReimbursementDuePaise, 0)
    })

    test('16. Excess creditor reimbursement is explicitly derived and auditable', () => {
      // Rohan's share is 1,000p. Rohan settled 1,500p.
      // Rohan received 0 refunds.
      // Creditor Arjun owes Rohan 500p reimbursement.
      const obligation: FinancialObligation = {
        id: 'ob_excess_cred',
        category: 'rent_cycle',
        title: 'Rent',
        billingPeriodStart: '2026-11-01',
        billingPeriodEnd: '2026-11-30',
        dueDate: '2026-12-05',
        totalAmountPaise: 1000,
        totalAmount: 10,
        currency: 'INR',
        shares: [{ memberId: 'mem_rohan', sharePaise: 1000 }],
        providerName: 'Landlord',
        createdByMembershipId: 'mem_arjun',
        createdAt: '2026-11-01T10:00:00.000Z',
      }

      const settlement: MemberSettlementRecord = {
        id: 'settle_overpay',
        idempotencyKey: 'idem_overpay',
        obligationId: 'ob_excess_cred',
        claimId: 'claim_overpay',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_arjun',
        amountPaise: 1500,
        paymentMethod: 'upi',
        paymentReference: 'DEMO-SIMULATED-UPI-REF-01',
        paymentDate: '2026-11-05',
        status: 'confirmed',
        submittedAt: '2026-11-05T10:00:00.000Z',
        confirmedAt: '2026-11-05T10:30:00.000Z',
        confirmedByMemberId: 'mem_arjun',
      }

      const peerCredit = {
        id: 'pc_overpay',
        obligationId: 'ob_excess_cred',
        claimId: 'claim_overpay',
        settlementId: 'settle_overpay',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_arjun',
        initialExcessPaise: 500,
        createdAt: '2026-11-05T10:30:00.000Z',
      }

      const state: RootFinancialState = {
        ...baseState,
        obligations: [obligation],
        memberSettlements: [settlement],
        peerCredits: [peerCredit],
      }

      const debt = deriveOrderIndependentMemberDebt(state, 'ob_excess_cred', 'mem_rohan')

      assert.strictEqual(debt.unpaidObligationSharePaise, 0)
      assert.strictEqual(debt.unbackedRefundLiabilityPaise, 0)
      assert.strictEqual(debt.totalOutstandingPaise, 0)
      // Creditor owes Debtor 500p reimbursement
      assert.strictEqual(debt.excessCreditorReimbursementDuePaise, 500)
    })

    test('17. A dedicated downward-share-correction test verifies that confirmed repayments remain preserved and excess reimbursement is not silently discarded', () => {
      // Rohan had share 1,000p. Rohan settled 1,000p.
      // Later, downward share correction reduces Rohan's share to 800p.
      // Confirmed settlement remains preserved, creating 200p excess reimbursement due.
      const obligation: FinancialObligation = {
        id: 'ob_downward',
        category: 'electricity_bill',
        title: 'Electricity',
        billingPeriodStart: '2026-11-01',
        billingPeriodEnd: '2026-11-30',
        dueDate: '2026-12-05',
        totalAmountPaise: 1000,
        totalAmount: 10,
        currency: 'INR',
        shares: [{ memberId: 'mem_rohan', sharePaise: 1000 }],
        providerName: 'Tata Power',
        createdByMembershipId: 'mem_arjun',
        createdAt: '2026-11-01T10:00:00.000Z',
      }

      const confirmedSettlement: MemberSettlementRecord = {
        id: 'settle_full',
        idempotencyKey: 'idem_full',
        obligationId: 'ob_downward',
        claimId: 'claim_downward',
        debtorMemberId: 'mem_rohan',
        creditorMemberId: 'mem_arjun',
        amountPaise: 1000,
        paymentMethod: 'upi',
        paymentReference: 'DEMO-SIMULATED-UPI-REF-01',
        paymentDate: '2026-11-05',
        status: 'confirmed',
        submittedAt: '2026-11-05T10:00:00.000Z',
        confirmedAt: '2026-11-05T10:30:00.000Z',
        confirmedByMemberId: 'mem_arjun',
      }

      const state: RootFinancialState = {
        ...baseState,
        obligations: [obligation],
        memberSettlements: [confirmedSettlement],
      }

      const res = financialStateReducer(state, {
        type: 'APPLY_DOWNWARD_CORRECTION_TO_OBLIGATION',
        payload: {
          obligationId: 'ob_downward',
          correctionId: 'corr_down_200',
          newShares: [{ memberId: 'mem_rohan', sharePaise: 800 }],
          reason: 'Subsidy rebate applied retroactively',
          correctedByMembershipId: 'mem_arjun',
        },
      })
      assert.strictEqual(res.success, true)
      if (!res.success) return

      // Confirmed settlement remains in history
      const originalSettlement = res.state.memberSettlements.find((s) => s.id === 'settle_full')
      assert.strictEqual(originalSettlement?.status, 'confirmed')
      assert.strictEqual(originalSettlement?.amountPaise, 1000)

      // Peer credit expansion created
      assert.strictEqual(res.state.peerCreditExpansions.length, 1)
      assert.strictEqual(res.state.peerCreditExpansions[0].expansionAmountPaise, 200)

      // Debt summary reflects 0 unpaid obligation, and 200p excess reimbursement due
      const debt = deriveOrderIndependentMemberDebt(res.state, 'ob_downward', 'mem_rohan')
      assert.strictEqual(debt.currentObligationSharePaise, 800)
      assert.strictEqual(debt.effectiveSettledTotalPaise, 1000)
      assert.strictEqual(debt.effectiveSettledAllocatedToClaimPaise, 800)
      assert.strictEqual(debt.authoritativeLegitimateExcessPaise, 200)
      assert.strictEqual(debt.unpaidObligationSharePaise, 0)
      assert.strictEqual(debt.excessCreditorReimbursementDuePaise, 200)
    })

    test('18. Voiding an obligation does not fabricate a provider refund', () => {
      const seedContribution: FundContribution = {
        id: 'cnt_seed_void',
        accountId: 'acc_treasury_upi',
        contributorMembershipId: 'mem_arjun',
        contributorName: 'Arjun Verma',
        amount: 200, // 20,000 paise
        date: '2026-11-01',
        status: 'confirmed',
      }

      const obligation: FinancialObligation = {
        id: 'ob_to_void',
        category: 'rent_cycle',
        title: 'Cancelled Obligation',
        billingPeriodStart: '2026-11-01',
        billingPeriodEnd: '2026-11-30',
        dueDate: '2026-12-05',
        totalAmountPaise: 10000,
        totalAmount: 100,
        currency: 'INR',
        shares: [{ memberId: 'mem_rohan', sharePaise: 10000 }],
        providerName: 'Landlord',
        createdByMembershipId: 'mem_arjun',
        createdAt: '2026-11-01T10:00:00.000Z',
      }

      const providerExpense: ExpenseItem = {
        id: 'exp_real_provider_payment',
        title: 'Paid to Landlord',
        category: 'rent_cycle',
        amount: 100,
        amountPaise: 10000,
        payerMemberId: 'mem_arjun',
        paidBy: 'Arjun Verma',
        date: '2026-11-05',
        splitScopeType: 'all_active',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: 'treasury_online_upi',
        disbursedFromAccountId: 'acc_treasury_upi',
        disbursementStatus: 'disbursed',
        linkedObligationId: 'ob_to_void',
      }

      const state: RootFinancialState = {
        ...baseState,
        contributions: [seedContribution],
        obligations: [obligation],
        expenses: [providerExpense],
      }

      // Balance before voiding: 20,000p inflow - 10,000p expense = 10,000p
      assert.strictEqual(calculateAccountLiquidBalance(state, 'acc_treasury_upi'), 10000)

      // Void the obligation
      const res = financialStateReducer(state, {
        type: 'VOID_FINANCIAL_OBLIGATION',
        payload: {
          obligationId: 'ob_to_void',
          voidReason: 'Tenancy agreement cancelled by landlord',
          voidedByMembershipId: 'mem_arjun',
          voidedAt: '2026-11-10T10:00:00.000Z',
        },
      })
      assert.strictEqual(res.success, true)
      if (!res.success) return

      // Obligation is marked voided
      const updatedOb = res.state.obligations.find((o) => o.id === 'ob_to_void')
      assert.strictEqual(updatedOb?.isVoided, true)

      // Treasury balance remains strictly 10,000p (NO fake refund created!)
      assert.strictEqual(calculateAccountLiquidBalance(res.state, 'acc_treasury_upi'), 10000)

      // Active member liability becomes 0
      const debt = deriveOrderIndependentMemberDebt(res.state, 'ob_to_void', 'mem_rohan')
      assert.strictEqual(debt.currentObligationSharePaise, 0)
      assert.strictEqual(debt.unpaidObligationSharePaise, 0)
    })

    test('19. Existing Stage 1–5 behavior remains unaffected', () => {
      // Treasury balance calculation across accounts matches Stage 2
      const overview = calculateTreasuryOverview(
        baseState.accounts,
        baseState.contributions,
        baseState.expenses,
        []
      )
      assert.strictEqual(overview.totalAvailableBalancePaise, 0)

      // Equal splits match Stage 3
      const splits = calculateEqualObligationShares(10000, [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }])
      assert.strictEqual(splits.length, 3)
      assert.strictEqual(splits[0].sharePaise + splits[1].sharePaise + splits[2].sharePaise, 10000)
    })

    test('20. All monetary calculations preserve integer paise', () => {
      const oddAmountPaise = 10001
      const shares = calculateEqualObligationShares(oddAmountPaise, [
        { id: 'm1' },
        { id: 'm2' },
        { id: 'm3' },
      ])
      assert.strictEqual(shares[0].sharePaise, 3334)
      assert.strictEqual(shares[1].sharePaise, 3334)
      assert.strictEqual(shares[2].sharePaise, 3333)
      assert.strictEqual(shares.reduce((s, x) => s + x.sharePaise, 0), oddAmountPaise)

      for (const s of shares) {
        assert.ok(Number.isInteger(s.sharePaise))
      }
    })
  })

  /* ==========================================================================
     9. Stage 6 Step 2.2 Root-State Integration & Treasury Transfer Integrity
     ========================================================================== */

  describe('Stage 6 Step 2.2 Root-State Integration & Treasury Transfer Integrity', () => {
    test('Root-state: Initializes from DEMO_ROOT_FINANCIAL_STATE with single authoritative source', () => {
      assert.ok(DEMO_ROOT_FINANCIAL_STATE)
      assert.ok(Array.isArray(DEMO_ROOT_FINANCIAL_STATE.accounts))
      assert.ok(Array.isArray(DEMO_ROOT_FINANCIAL_STATE.contributions))
      assert.ok(Array.isArray(DEMO_ROOT_FINANCIAL_STATE.transfers))
      assert.ok(Array.isArray(DEMO_ROOT_FINANCIAL_STATE.expenses))
      assert.ok(Array.isArray(DEMO_ROOT_FINANCIAL_STATE.obligations))
      assert.ok(Array.isArray(DEMO_ROOT_FINANCIAL_STATE.allocations))
      assert.ok(Array.isArray(DEMO_ROOT_FINANCIAL_STATE.peerClaims))
      assert.ok(Array.isArray(DEMO_ROOT_FINANCIAL_STATE.memberSettlements))

      // Verify transfers fixture is present
      assert.strictEqual(DEMO_ROOT_FINANCIAL_STATE.transfers.length, 1)
      assert.strictEqual(DEMO_ROOT_FINANCIAL_STATE.transfers[0].id, 'trf-1')
      assert.strictEqual(DEMO_ROOT_FINANCIAL_STATE.transfers[0].status, 'confirmed')

      // rootFinancialReducer returns updated state on success and existing state on failure
      const testState = DEMO_ROOT_FINANCIAL_STATE
      const invalidAction: FinancialAction = {
        type: 'SUBMIT_CONTRIBUTION',
        payload: {
          contribution: {
            id: 'cnt_invalid',
            accountId: 'acc_nonexistent',
            contributorMembershipId: 'mem_rohan',
            contributorName: 'Rohan',
            amount: 100,
            date: '2026-11-20',
            status: 'pending_confirmation',
          },
        },
      }
      const nextState = rootFinancialReducer(testState, invalidAction)
      assert.strictEqual(nextState, testState)
    })

    test('Root-state: Granular intention-based actions dispatch through root reducer without array replacement', () => {
      let state = DEMO_ROOT_FINANCIAL_STATE

      // 1. Submit and confirm contribution via granular actions
      const newContribution: FundContribution = {
        id: 'cnt_granular_test',
        accountId: 'acc-upi',
        contributorMembershipId: 'm1',
        contributorName: 'Rohan Sharma',
        amount: 150,
        date: '2026-11-21',
        status: 'pending_confirmation',
      }
      state = rootFinancialReducer(state, {
        type: 'SUBMIT_CONTRIBUTION',
        payload: { contribution: newContribution },
      })
      assert.strictEqual(state.contributions.length, DEMO_ROOT_FINANCIAL_STATE.contributions.length + 1)
      assert.strictEqual(state.contributions[0].id, 'cnt_granular_test')
      assert.strictEqual(state.contributions[0].status, 'pending_confirmation')

      // Confirm contribution
      state = rootFinancialReducer(state, {
        type: 'CONFIRM_CONTRIBUTION',
        payload: {
          contributionId: 'cnt_granular_test',
          confirmedByMembershipId: 'm2',
          confirmedByName: 'Arjun Verma (Custodian)',
        },
      })
      const confirmedContrib = state.contributions.find((c) => c.id === 'cnt_granular_test')
      assert.strictEqual(confirmedContrib?.status, 'confirmed')
      assert.strictEqual(confirmedContrib?.confirmedByMembershipId, 'm2')

      // 2. Record new expense via RECORD_EXPENSE
      const newExpense: ExpenseItem = {
        id: 'exp_granular_test',
        title: 'Granular Out-of-Pocket Expense',
        category: 'Other Shared',
        amount: 25,
        amountPaise: 2500,
        payerMemberId: 'm1',
        paidBy: 'Rohan Sharma',
        date: '2026-11-21',
        splitScopeType: 'all_active',
        participantMemberIds: ['m1', 'm2'],
        splits: [],
        disbursementChannel: 'member_out_of_pocket',
        disbursementStatus: 'disbursed',
      }
      state = rootFinancialReducer(state, {
        type: 'RECORD_EXPENSE',
        payload: { expense: newExpense },
      })
      assert.strictEqual(state.expenses.length, DEMO_ROOT_FINANCIAL_STATE.expenses.length + 1)
      assert.strictEqual(state.expenses[0].id, 'exp_granular_test')

      // 3. Apply correction to expense via APPLY_EXPENSE_CORRECTION
      state = rootFinancialReducer(state, {
        type: 'APPLY_EXPENSE_CORRECTION',
        payload: {
          expenseId: 'exp_granular_test',
          correctionRecord: {
            id: 'cor_test_1',
            editedAt: '2026-11-21T12:00:00Z',
            editedByMembershipId: 'm2',
            editedByName: 'Arjun Verma',
            reason: 'Correcting title and category',
            previousValues: {
              title: newExpense.title,
              category: newExpense.category,
              amountPaise: newExpense.amountPaise,
              splitScopeType: newExpense.splitScopeType,
              participantMemberIds: newExpense.participantMemberIds,
              disbursementChannel: newExpense.disbursementChannel,
            },
          },
          updatedFields: {
            title: 'Corrected Title',
            category: 'Kitchen & Groceries',
          },
        },
      })
      const correctedExpense = state.expenses.find((e) => e.id === 'exp_granular_test')
      assert.strictEqual(correctedExpense?.title, 'Corrected Title')
      assert.strictEqual(correctedExpense?.category, 'Kitchen & Groceries')
      assert.strictEqual(correctedExpense?.correctionHistory?.length, 1)

      // 4. Void expense via VOID_EXPENSE
      state = rootFinancialReducer(state, {
        type: 'VOID_EXPENSE',
        payload: {
          expenseId: 'exp_granular_test',
          voidReason: 'Recorded in duplicate',
          voidedByMembershipId: 'm2',
        },
      })
      const voidedExpense = state.expenses.find((e) => e.id === 'exp_granular_test')
      assert.strictEqual(voidedExpense?.isVoided, true)
      assert.strictEqual(voidedExpense?.voidReason, 'Recorded in duplicate')
    })

    test('Financial integrity: Duplicate IDs and overdraft expenses are strictly rejected', () => {
      const state = DEMO_ROOT_FINANCIAL_STATE

      // Duplicate contribution ID rejection
      const dupContribResult = financialStateReducer(state, {
        type: 'SUBMIT_CONTRIBUTION',
        payload: { contribution: state.contributions[0] },
      })
      assert.strictEqual(dupContribResult.success, false)
      if (!dupContribResult.success) {
        assert.match(dupContribResult.error, /already exists/i)
      }

      // Duplicate expense ID rejection
      const dupExpenseResult = financialStateReducer(state, {
        type: 'RECORD_EXPENSE',
        payload: { expense: state.expenses[0] },
      })
      assert.strictEqual(dupExpenseResult.success, false)
      if (!dupExpenseResult.success) {
        assert.match(dupExpenseResult.error, /already exists/i)
      }

      // Treasury expense exceeding liquid balance rejection
      const overdraftExpenseResult = financialStateReducer(state, {
        type: 'RECORD_EXPENSE',
        payload: {
          expense: {
            id: 'exp_overdraft_test',
            title: 'Gigantic Bill',
            category: 'Utilities & Internet',
            amount: 9999999,
            amountPaise: 999999900,
            payerMemberId: 'm2',
            paidBy: 'Arjun Verma',
            date: '2026-11-21',
            splitScopeType: 'all_active',
            participantMemberIds: ['m1', 'm2'],
            splits: [],
            disbursementChannel: 'personal_upi',
            disbursedFromAccountId: 'acc-upi',
            disbursementStatus: 'disbursed',
          },
        },
      })
      assert.strictEqual(overdraftExpenseResult.success, false)
      if (!overdraftExpenseResult.success) {
        assert.match(overdraftExpenseResult.error, /insufficient balance/i)
      }
    })

    test('Stale-state protection: Sequential granular actions do not overwrite each other', () => {
      // Given initial state
      let state = DEMO_ROOT_FINANCIAL_STATE

      // Member 1 records an expense
      const action1: FinancialAction = {
        type: 'RECORD_EXPENSE',
        payload: {
          expense: {
            id: 'exp_seq_1',
            title: 'Milk & Eggs',
            category: 'Kitchen & Groceries',
            amount: 100,
            amountPaise: 10000,
            payerMemberId: 'm1',
            paidBy: 'Rohan Sharma',
            date: '2026-11-21',
            splitScopeType: 'all_active',
            participantMemberIds: ['m1', 'm2'],
            splits: [],
            disbursementChannel: 'member_out_of_pocket',
            disbursementStatus: 'disbursed',
          },
        },
      }
      state = rootFinancialReducer(state, action1)

      // Member 2 submits a contribution
      const action2: FinancialAction = {
        type: 'SUBMIT_CONTRIBUTION',
        payload: {
          contribution: {
            id: 'cnt_seq_2',
            accountId: 'acc-upi',
            contributorMembershipId: 'm2',
            contributorName: 'Arjun Verma',
            amount: 500,
            date: '2026-11-21',
            status: 'pending_confirmation',
          },
        },
      }
      state = rootFinancialReducer(state, action2)

      // Both records exist and neither wiped out the other!
      assert(state.expenses.some((e) => e.id === 'exp_seq_1'))
      assert(state.contributions.some((c) => c.id === 'cnt_seq_2'))
    })

    test('Transfer: Confirmed transfer from UPI to cash debits source and credits destination', () => {
      const stateWithAccounts: RootFinancialState = {
        accounts: [
          {
            id: 'acc_upi_1',
            name: 'Primary UPI',
            accountType: 'personal_upi',
            custodianMembershipId: 'mem_arjun',
            custodianName: 'Arjun Verma',
            isActive: true,
          },
          {
            id: 'acc_cash_1',
            name: 'Cash Box',
            accountType: 'cash_box',
            custodianMembershipId: 'mem_arjun',
            custodianName: 'Arjun Verma',
            isActive: true,
          },
        ],
        contributions: [
          {
            id: 'cnt_seed_upi',
            accountId: 'acc_upi_1',
            contributorMembershipId: 'mem_arjun',
            contributorName: 'Arjun',
            amount: 100, // 10,000 paise
            date: '2026-11-20',
            status: 'confirmed',
          },
          {
            id: 'cnt_seed_cash',
            accountId: 'acc_cash_1',
            contributorMembershipId: 'mem_arjun',
            contributorName: 'Arjun',
            amount: 20, // 2,000 paise
            date: '2026-11-20',
            status: 'confirmed',
          },
        ],
        allocations: [],
        obligations: [],
        expenses: [],
        transfers: [],
        peerClaims: [],
        memberSettlements: [],
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

      assert.strictEqual(calculateAccountLiquidBalance(stateWithAccounts, 'acc_upi_1'), 10000)
      assert.strictEqual(calculateAccountLiquidBalance(stateWithAccounts, 'acc_cash_1'), 2000)

      const transferRecord: TreasuryTransfer = {
        id: 'trf_upi_to_cash',
        fromAccountId: 'acc_upi_1',
        toAccountId: 'acc_cash_1',
        fromAccountName: 'Primary UPI',
        toAccountName: 'Cash Box',
        amount: 50, // 5,000 paise
        date: '2026-11-21',
        purpose: 'Replenish physical cash box for groceries',
        authorizedByMembershipId: 'mem_arjun',
        authorizedByName: 'Arjun Verma',
        status: 'confirmed',
      }

      const res = financialStateReducer(stateWithAccounts, {
        type: 'RECORD_TREASURY_TRANSFER',
        actionId: 'act_trf_1',
        payload: { transfer: transferRecord },
      })
      assert.strictEqual(res.success, true)
      if (!res.success) return

      // Outgoing transfer decreases source
      assert.strictEqual(calculateAccountLiquidBalance(res.state, 'acc_upi_1'), 5000)
      // Incoming transfer increases destination
      assert.strictEqual(calculateAccountLiquidBalance(res.state, 'acc_cash_1'), 7000)
      // Combined household balance remains unchanged at 12,000 paise
      const totalBalance =
        calculateAccountLiquidBalance(res.state, 'acc_upi_1') +
        calculateAccountLiquidBalance(res.state, 'acc_cash_1')
      assert.strictEqual(totalBalance, 12000)
    })

    test('Transfer: Confirmed transfer from cash to UPI debits cash and credits UPI', () => {
      const stateWithCash: RootFinancialState = {
        accounts: [
          {
            id: 'acc_upi_2',
            name: 'Primary UPI',
            accountType: 'personal_upi',
            custodianMembershipId: 'mem_arjun',
            custodianName: 'Arjun Verma',
            isActive: true,
          },
          {
            id: 'acc_cash_2',
            name: 'Cash Box',
            accountType: 'cash_box',
            custodianMembershipId: 'mem_arjun',
            custodianName: 'Arjun Verma',
            isActive: true,
          },
        ],
        contributions: [
          {
            id: 'cnt_cash_seed',
            accountId: 'acc_cash_2',
            contributorMembershipId: 'mem_arjun',
            contributorName: 'Arjun',
            amount: 70, // 7,000 paise
            date: '2026-11-20',
            status: 'confirmed',
          },
          {
            id: 'cnt_upi_seed',
            accountId: 'acc_upi_2',
            contributorMembershipId: 'mem_arjun',
            contributorName: 'Arjun',
            amount: 50, // 5,000 paise
            date: '2026-11-20',
            status: 'confirmed',
          },
        ],
        allocations: [],
        obligations: [],
        expenses: [],
        transfers: [],
        peerClaims: [],
        memberSettlements: [],
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

      const transferRecord: TreasuryTransfer = {
        id: 'trf_cash_to_upi',
        fromAccountId: 'acc_cash_2',
        toAccountId: 'acc_upi_2',
        fromAccountName: 'Cash Box',
        toAccountName: 'Primary UPI',
        amount: 30, // 3,000 paise
        date: '2026-11-21',
        purpose: 'Deposit excess cash into bank UPI pool',
        authorizedByMembershipId: 'mem_arjun',
        authorizedByName: 'Arjun Verma',
        status: 'confirmed',
      }

      const res = financialStateReducer(stateWithCash, {
        type: 'RECORD_TREASURY_TRANSFER',
        actionId: 'act_trf_cash_upi',
        payload: { transfer: transferRecord },
      })
      assert.strictEqual(res.success, true)
      if (!res.success) return

      // Cash debited by 3,000p -> 4,000p
      assert.strictEqual(calculateAccountLiquidBalance(res.state, 'acc_cash_2'), 4000)
      // UPI credited by 3,000p -> 8,000p
      assert.strictEqual(calculateAccountLiquidBalance(res.state, 'acc_upi_2'), 8000)
    })

    test('Transfer: Non-confirmed transfers (pending, rejected, voided) have no balance effect', () => {
      const state: RootFinancialState = {
        accounts: [
          {
            id: 'acc_src',
            name: 'Source Account',
            accountType: 'personal_upi',
            custodianMembershipId: 'mem_arjun',
            custodianName: 'Arjun Verma',
            isActive: true,
          },
          {
            id: 'acc_dest',
            name: 'Dest Account',
            accountType: 'cash_box',
            custodianMembershipId: 'mem_arjun',
            custodianName: 'Arjun Verma',
            isActive: true,
          },
        ],
        contributions: [
          {
            id: 'cnt_init',
            accountId: 'acc_src',
            contributorMembershipId: 'mem_arjun',
            contributorName: 'Arjun',
            amount: 100, // 10,000 paise
            date: '2026-11-20',
            status: 'confirmed',
          },
        ],
        allocations: [],
        obligations: [],
        expenses: [],
        transfers: [
          {
            id: 'trf_pending',
            fromAccountId: 'acc_src',
            toAccountId: 'acc_dest',
            fromAccountName: 'Source Account',
            toAccountName: 'Dest Account',
            amount: 20,
            date: '2026-11-21',
            purpose: 'Pending transfer',
            authorizedByMembershipId: 'mem_arjun',
            authorizedByName: 'Arjun Verma',
            status: 'pending',
          },
          {
            id: 'trf_rejected',
            fromAccountId: 'acc_src',
            toAccountId: 'acc_dest',
            fromAccountName: 'Source Account',
            toAccountName: 'Dest Account',
            amount: 30,
            date: '2026-11-21',
            purpose: 'Rejected transfer',
            authorizedByMembershipId: 'mem_arjun',
            authorizedByName: 'Arjun Verma',
            status: 'rejected',
          },
          {
            id: 'trf_voided',
            fromAccountId: 'acc_src',
            toAccountId: 'acc_dest',
            fromAccountName: 'Source Account',
            toAccountName: 'Dest Account',
            amount: 40,
            date: '2026-11-21',
            purpose: 'Voided transfer',
            authorizedByMembershipId: 'mem_arjun',
            authorizedByName: 'Arjun Verma',
            status: 'voided',
          },
        ],
        peerClaims: [],
        memberSettlements: [],
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

      // Non-confirmed transfers do not reduce source or increase dest
      assert.strictEqual(calculateAccountLiquidBalance(state, 'acc_src'), 10000)
      assert.strictEqual(calculateAccountLiquidBalance(state, 'acc_dest'), 0)
    })

    test('Transfer: Insufficient source balance rejects transfer and leaves state unchanged', () => {
      const state: RootFinancialState = {
        accounts: [
          {
            id: 'acc_low',
            name: 'Low Balance UPI',
            accountType: 'personal_upi',
            custodianMembershipId: 'mem_arjun',
            custodianName: 'Arjun Verma',
            isActive: true,
          },
          {
            id: 'acc_target',
            name: 'Target Cash Box',
            accountType: 'cash_box',
            custodianMembershipId: 'mem_arjun',
            custodianName: 'Arjun Verma',
            isActive: true,
          },
        ],
        contributions: [
          {
            id: 'cnt_small',
            accountId: 'acc_low',
            contributorMembershipId: 'mem_arjun',
            contributorName: 'Arjun',
            amount: 20, // 2,000 paise
            date: '2026-11-20',
            status: 'confirmed',
          },
        ],
        allocations: [],
        obligations: [],
        expenses: [],
        transfers: [],
        peerClaims: [],
        memberSettlements: [],
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

      const res = financialStateReducer(state, {
        type: 'RECORD_TREASURY_TRANSFER',
        payload: {
          transfer: {
            id: 'trf_overdraft',
            fromAccountId: 'acc_low',
            toAccountId: 'acc_target',
            fromAccountName: 'Low Balance UPI',
            toAccountName: 'Target Cash Box',
            amount: 30, // 3,000 paise > 2,000 paise available
            date: '2026-11-21',
            purpose: 'Overdraft attempt',
            authorizedByMembershipId: 'mem_arjun',
            authorizedByName: 'Arjun Verma',
            status: 'confirmed',
          },
        },
      })

      assert.strictEqual(res.success, false)
      if (res.success) return
      assert.match(res.error, /insufficient available balance/i)
      assert.strictEqual(calculateAccountLiquidBalance(state, 'acc_low'), 2000)
    })

    test('Transfer: Inactive, invalid or identical accounts reject transfer', () => {
      const state: RootFinancialState = {
        accounts: [
          {
            id: 'acc_active_1',
            name: 'Active 1',
            accountType: 'personal_upi',
            custodianMembershipId: 'mem_arjun',
            custodianName: 'Arjun Verma',
            isActive: true,
          },
          {
            id: 'acc_inactive_1',
            name: 'Inactive Cash Box',
            accountType: 'cash_box',
            custodianMembershipId: 'mem_arjun',
            custodianName: 'Arjun Verma',
            isActive: false,
          },
        ],
        contributions: [
          {
            id: 'cnt_seed',
            accountId: 'acc_active_1',
            contributorMembershipId: 'mem_arjun',
            contributorName: 'Arjun',
            amount: 100,
            date: '2026-11-20',
            status: 'confirmed',
          },
        ],
        allocations: [],
        obligations: [],
        expenses: [],
        transfers: [],
        peerClaims: [],
        memberSettlements: [],
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

      // Same source and destination
      const resSame = financialStateReducer(state, {
        type: 'RECORD_TREASURY_TRANSFER',
        payload: {
          transfer: {
            id: 'trf_same',
            fromAccountId: 'acc_active_1',
            toAccountId: 'acc_active_1',
            fromAccountName: 'Active 1',
            toAccountName: 'Active 1',
            amount: 10,
            date: '2026-11-21',
            purpose: 'Self transfer',
            authorizedByMembershipId: 'mem_arjun',
            authorizedByName: 'Arjun Verma',
            status: 'confirmed',
          },
        },
      })
      assert.strictEqual(resSame.success, false)
      if (resSame.success) return
      assert.match(resSame.error, /must be different/i)

      // Inactive destination account
      const resInactive = financialStateReducer(state, {
        type: 'RECORD_TREASURY_TRANSFER',
        payload: {
          transfer: {
            id: 'trf_inactive',
            fromAccountId: 'acc_active_1',
            toAccountId: 'acc_inactive_1',
            fromAccountName: 'Active 1',
            toAccountName: 'Inactive Cash Box',
            amount: 10,
            date: '2026-11-21',
            purpose: 'Transfer to inactive',
            authorizedByMembershipId: 'mem_arjun',
            authorizedByName: 'Arjun Verma',
            status: 'confirmed',
          },
        },
      })
      assert.strictEqual(resInactive.success, false)
      if (resInactive.success) return
      assert.match(resInactive.error, /inactive/i)
    })

    test('Transfer: Duplicate action ID and double-spending prevention', () => {
      const state: RootFinancialState = {
        accounts: [
          {
            id: 'acc_dup_src',
            name: 'Source UPI',
            accountType: 'personal_upi',
            custodianMembershipId: 'mem_arjun',
            custodianName: 'Arjun Verma',
            isActive: true,
          },
          {
            id: 'acc_dup_dest',
            name: 'Dest Cash Box',
            accountType: 'cash_box',
            custodianMembershipId: 'mem_arjun',
            custodianName: 'Arjun Verma',
            isActive: true,
          },
        ],
        contributions: [
          {
            id: 'cnt_dup_seed',
            accountId: 'acc_dup_src',
            contributorMembershipId: 'mem_arjun',
            contributorName: 'Arjun',
            amount: 60, // 6,000 paise
            date: '2026-11-20',
            status: 'confirmed',
          },
        ],
        allocations: [],
        obligations: [],
        expenses: [],
        transfers: [],
        peerClaims: [],
        memberSettlements: [],
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

      const transferAction: FinancialAction = {
        type: 'RECORD_TREASURY_TRANSFER',
        actionId: 'act_trf_idempotency_1',
        payload: {
          transfer: {
            id: 'trf_step_1',
            fromAccountId: 'acc_dup_src',
            toAccountId: 'acc_dup_dest',
            fromAccountName: 'Source UPI',
            toAccountName: 'Dest Cash Box',
            amount: 50, // 5,000 paise
            date: '2026-11-21',
            purpose: 'Step 1 Transfer',
            authorizedByMembershipId: 'mem_arjun',
            authorizedByName: 'Arjun Verma',
            status: 'confirmed',
          },
        },
      }

      // Step 1: Transfer 5,000p succeeds, source balance becomes 1,000p
      const res1 = financialStateReducer(state, transferAction)
      assert.strictEqual(res1.success, true)
      if (!res1.success) return
      assert.strictEqual(calculateAccountLiquidBalance(res1.state, 'acc_dup_src'), 1000)

      // Step 2: Replaying the same actionId returns idempotent success without transferring twice
      const resDup = financialStateReducer(res1.state, transferAction)
      assert.strictEqual(resDup.success, true)
      assert.strictEqual(calculateAccountLiquidBalance(resDup.state, 'acc_dup_src'), 1000)
      assert.strictEqual(resDup.state.transfers.length, 1)

      // Step 3: Attempting a second 5,000p transfer fails due to insufficient balance (1,000p available)
      const resDoubleSpend = financialStateReducer(res1.state, {
        type: 'RECORD_TREASURY_TRANSFER',
        actionId: 'act_trf_idempotency_2',
        payload: {
          transfer: {
            id: 'trf_step_2',
            fromAccountId: 'acc_dup_src',
            toAccountId: 'acc_dup_dest',
            fromAccountName: 'Source UPI',
            toAccountName: 'Dest Cash Box',
            amount: 50, // 5,000 paise > 1,000 paise
            date: '2026-11-21',
            purpose: 'Double spend attempt',
            authorizedByMembershipId: 'mem_arjun',
            authorizedByName: 'Arjun Verma',
            status: 'confirmed',
          },
        },
      })
      assert.strictEqual(resDoubleSpend.success, false)
      if (resDoubleSpend.success) return
      assert.match(resDoubleSpend.error, /insufficient available balance/i)
    })

    test('Reconciliation: Stage 2 calculateTreasuryOverview() and calculateAccountLiquidBalance() agree exactly', () => {
      // Create a complex state with confirmed contributions, refund adjustments, expenses, and transfers
      const complexState: RootFinancialState = {
        accounts: [
          {
            id: 'acc_rec_upi',
            name: 'Reconciliation UPI',
            accountType: 'personal_upi',
            custodianMembershipId: 'mem_arjun',
            custodianName: 'Arjun Verma',
            isActive: true,
          },
          {
            id: 'acc_rec_cash',
            name: 'Reconciliation Cash Box',
            accountType: 'cash_box',
            custodianMembershipId: 'mem_arjun',
            custodianName: 'Arjun Verma',
            isActive: true,
          },
        ],
        contributions: [
          // UPI inflow: ₹250 (25,000p)
          {
            id: 'cnt_rec_1',
            accountId: 'acc_rec_upi',
            contributorMembershipId: 'mem_rohan',
            contributorName: 'Rohan',
            amount: 250,
            date: '2026-11-10',
            status: 'confirmed',
          },
          // UPI refund outflow: ₹30 (3,000p)
          {
            id: 'cnt_rec_ref',
            accountId: 'acc_rec_upi',
            contributorMembershipId: 'mem_rohan',
            contributorName: 'Rohan',
            amount: 30,
            date: '2026-11-12',
            status: 'confirmed',
            isRefundAdjustment: true,
            originalContributionId: 'cnt_rec_1',
          },
          // Cash inflow: ₹100 (10,000p)
          {
            id: 'cnt_rec_cash',
            accountId: 'acc_rec_cash',
            contributorMembershipId: 'mem_arjun',
            contributorName: 'Arjun',
            amount: 100,
            date: '2026-11-10',
            status: 'confirmed',
          },
        ],
        allocations: [],
        obligations: [],
        expenses: [
          // UPI expense: ₹50 (5,000p)
          {
            id: 'exp_rec_upi',
            title: 'Internet Bill',
            category: 'Utilities & Internet',
            amount: 50,
            amountPaise: 5000,
            payerMemberId: 'mem_arjun',
            paidBy: 'Arjun',
            date: '2026-11-15',
            splitScopeType: 'all_active',
            participantMemberIds: ['mem_arjun'],
            splits: [],
            disbursementChannel: 'treasury_personal_upi',
            disbursedFromAccountId: 'acc_rec_upi',
            disbursementStatus: 'disbursed',
          },
          // Cash expense: ₹20 (2,000p)
          {
            id: 'exp_rec_cash',
            title: 'Cleaning Mop',
            category: 'Cleaning & Household',
            amount: 20,
            amountPaise: 2000,
            payerMemberId: 'mem_arjun',
            paidBy: 'Arjun',
            date: '2026-11-15',
            splitScopeType: 'all_active',
            participantMemberIds: ['mem_arjun'],
            splits: [],
            disbursementChannel: 'treasury_cash_box',
            disbursedFromAccountId: 'acc_rec_cash',
            disbursementStatus: 'disbursed',
          },
        ],
        transfers: [
          // Transfer: ₹40 (4,000p) from UPI to Cash
          {
            id: 'trf_rec_1',
            fromAccountId: 'acc_rec_upi',
            toAccountId: 'acc_rec_cash',
            fromAccountName: 'Reconciliation UPI',
            toAccountName: 'Reconciliation Cash Box',
            amount: 40,
            date: '2026-11-14',
            purpose: 'Replenish Cash',
            authorizedByMembershipId: 'mem_arjun',
            authorizedByName: 'Arjun Verma',
            status: 'confirmed',
          },
        ],
        peerClaims: [],
        memberSettlements: [],
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

      // Calculate overview using Stage 2 calculateTreasuryOverview()
      const stage2Overview = calculateTreasuryOverview(
        complexState.accounts,
        complexState.contributions,
        complexState.expenses,
        complexState.transfers
      )

      const upiSummary = stage2Overview.accounts.find((a) => a.account.id === 'acc_rec_upi')
      const cashSummary = stage2Overview.accounts.find((a) => a.account.id === 'acc_rec_cash')

      // Calculate balance using calculateAccountLiquidBalance()
      const upiLiquidBalance = calculateAccountLiquidBalance(complexState, 'acc_rec_upi')
      const cashLiquidBalance = calculateAccountLiquidBalance(complexState, 'acc_rec_cash')

      // Expected UPI balance: 25,000p - 3,000p refund - 4,000p transfer out - 5,000p expense = 13,000p
      assert.strictEqual(upiLiquidBalance, 13000)
      assert.strictEqual(upiSummary?.currentBalancePaise, 13000)
      assert.strictEqual(upiLiquidBalance, upiSummary?.currentBalancePaise)

      // Expected Cash balance: 10,000p + 4,000p transfer in - 2,000p expense = 12,000p
      assert.strictEqual(cashLiquidBalance, 12000)
      assert.strictEqual(cashSummary?.currentBalancePaise, 12000)
      assert.strictEqual(cashLiquidBalance, cashSummary?.currentBalancePaise)

      // Total available balance across household reconciles exactly
      const totalLiquidPaise = upiLiquidBalance + cashLiquidBalance
      assert.strictEqual(totalLiquidPaise, stage2Overview.totalAvailableBalancePaise)
      assert.strictEqual(totalLiquidPaise, 25000)
    })
  })

  describe('Stage 6 Step 2.3: Bills & Rent UI Integration & View Interactions', () => {
    test('UI Aggregation: Obligation reconciliation accurately aggregates metrics across all active demo obligations', () => {
      const state = DEMO_ROOT_FINANCIAL_STATE
      const activeObligations = state.obligations.filter((o) => !o.isVoided)

      const reconciliations = activeObligations.map((ob) =>
        deriveObligationReconciliationSummary(
          ob,
          state.allocations,
          state.contributions,
          state.expenses,
          state.memberSettlements
        )
      )

      assert.strictEqual(reconciliations.length, 3) // Electricity, Gas, Rent

      // Check Electricity Bill (ob-demo-elec-2026-11)
      const elecRecon = reconciliations.find((r) => r.obligationId === 'ob-demo-elec-2026-11')
      assert.ok(elecRecon)
      assert.strictEqual(elecRecon.totalAmountPaise, 420000) // ₹4,200.00
      assert.strictEqual(elecRecon.memberSummaries.length, 7)

      // Check Gas Bill (ob-demo-gas-2026-11)
      const gasRecon = reconciliations.find((r) => r.obligationId === 'ob-demo-gas-2026-11')
      assert.ok(gasRecon)
      assert.strictEqual(gasRecon.totalAmountPaise, 140000) // ₹1,400.00
      assert.strictEqual(gasRecon.totalAllocatedContributionsPaise, 60000) // ₹600 allocated from contributions
      assert.strictEqual(gasRecon.status, 'partially_funded')

      // Check Rent Cycle (ob-demo-rent-2026-12)
      const rentRecon = reconciliations.find((r) => r.obligationId === 'ob-demo-rent-2026-12')
      assert.ok(rentRecon)
      assert.strictEqual(rentRecon.totalAmountPaise, 7000000) // ₹70,000.00
      assert.strictEqual(rentRecon.status, 'active')
    })

    test('UI Provider Payment: Disbursing bill from Treasury account validates balance and debits liquid pool', () => {
      let state = DEMO_ROOT_FINANCIAL_STATE
      const gasObligation = state.obligations.find((o) => o.id === 'ob-demo-gas-2026-11')!
      assert.ok(gasObligation)

      const initialUpiBalance = calculateAccountLiquidBalance(state, 'acc-upi')
      const paymentAmountPaise = 50000 // ₹500.00

      const providerExpense: ExpenseItem = {
        id: 'exp_ui_test_provider',
        title: 'Mahanagar Gas — Utility Provider Disbursal',
        category: 'Utilities & Internet',
        amount: 500,
        amountPaise: paymentAmountPaise,
        payerMemberId: 'm2',
        paidBy: 'Arjun Verma (Custodian)',
        date: '2026-11-20',
        splitScopeType: 'custom',
        participantMemberIds: [],
        splits: [],
        disbursementChannel: 'treasury_personal_upi',
        disbursedFromAccountId: 'acc-upi',
        disbursementStatus: 'disbursed',
        expenseSourceType: 'obligation_provider_payment',
        linkedObligationId: gasObligation.id,
      }

      state = rootFinancialReducer(state, {
        type: 'DISBURSE_TREASURY_PROVIDER_PAYMENT',
        payload: {
          expense: providerExpense,
          obligationId: gasObligation.id,
        },
      })

      // Account liquid balance debited by exactly paymentAmountPaise
      const updatedUpiBalance = calculateAccountLiquidBalance(state, 'acc-upi')
      assert.strictEqual(updatedUpiBalance, initialUpiBalance - paymentAmountPaise)

      // Obligation provider remaining balance reduced
      const recon = deriveObligationReconciliationSummary(
        gasObligation,
        state.allocations,
        state.contributions,
        state.expenses,
        state.memberSettlements
      )
      assert.strictEqual(recon.providerPaidPaise, paymentAmountPaise)
      assert.strictEqual(recon.providerRemainingPaise, gasObligation.totalAmountPaise - paymentAmountPaise)
    })

    test('UI Peer Settlement: Submitting, confirming, and rejecting P2P settlements updates claim status without leaking state', () => {
      let state = DEMO_ROOT_FINANCIAL_STATE
      // Select an unsettled claim: claim-demo-elec-m5 (debtor: m5, creditor: m1, amount: 60,000p)
      const claim = state.peerClaims.find((c) => c.id === 'claim-demo-elec-m5')
      assert.ok(claim)

      // 1. Submit settlement for ₹400.00 (within ₹600.00 capacity)
      const newSettlement: MemberSettlementRecord = {
        id: 'settle_ui_test_1',
        idempotencyKey: 'idem_settle_ui_test_1',
        obligationId: claim.obligationId,
        claimId: claim.id,
        debtorMemberId: claim.debtorMemberId,
        creditorMemberId: claim.creditorMemberId,
        amountPaise: 40000,
        paymentMethod: 'upi',
        paymentReference: '430291048291',
        proofReceiptUrl: 'Screenshot verified',
        paymentDate: '2026-11-20',
        status: 'pending_confirmation',
        submittedAt: '2026-11-20T12:00:00.000Z',
      }

      state = rootFinancialReducer(state, {
        type: 'SUBMIT_MEMBER_SETTLEMENT',
        payload: { settlement: newSettlement },
      })

      const submitted = state.memberSettlements.find((s) => s.id === 'settle_ui_test_1')
      assert.ok(submitted)
      assert.strictEqual(submitted.status, 'pending_confirmation')

      // Pending settlement does NOT reduce debtor claim liability
      const fifoBeforeConfirm = calculateClaimFIFOAllocations(state, claim.id)
      const confirmedBefore = state.memberSettlements
        .filter((s) => s.claimId === claim.id && s.status === 'confirmed')
        .reduce((sum, s) => sum + s.amountPaise, 0)
      assert.strictEqual(fifoBeforeConfirm.allocatedToClaimPaise, confirmedBefore)

      // 2. Creditor verifies and confirms settlement
      state = rootFinancialReducer(state, {
        type: 'CONFIRM_MEMBER_SETTLEMENT',
        payload: {
          settlementId: 'settle_ui_test_1',
          confirmedByMemberId: claim.creditorMemberId,
          confirmedAt: '2026-11-20T12:30:00.000Z',
        },
      })

      const confirmed = state.memberSettlements.find((s) => s.id === 'settle_ui_test_1')
      assert.strictEqual(confirmed?.status, 'confirmed')

      // After confirmation, FIFO allocated to claim increases
      const fifoAfterConfirm = calculateClaimFIFOAllocations(state, claim.id)
      assert.strictEqual(fifoAfterConfirm.allocatedToClaimPaise, 40000)

      // 3. Submit and reject remaining settlement
      const rejectedSettlement: MemberSettlementRecord = {
        id: 'settle_ui_test_2',
        idempotencyKey: 'idem_settle_ui_test_2',
        obligationId: claim.obligationId,
        claimId: claim.id,
        debtorMemberId: claim.debtorMemberId,
        creditorMemberId: claim.creditorMemberId,
        amountPaise: 20000,
        paymentMethod: 'cash',
        paymentReference: 'Invalid cash claim',
        paymentDate: '2026-11-20',
        status: 'pending_confirmation',
        submittedAt: '2026-11-20T13:00:00.000Z',
      }

      state = rootFinancialReducer(state, {
        type: 'SUBMIT_MEMBER_SETTLEMENT',
        payload: { settlement: rejectedSettlement },
      })

      state = rootFinancialReducer(state, {
        type: 'REJECT_MEMBER_SETTLEMENT',
        payload: {
          settlementId: 'settle_ui_test_2',
          rejectedByMemberId: claim.creditorMemberId,
          rejectionReason: 'Cash not handed over',
        },
      })

      const rejected = state.memberSettlements.find((s) => s.id === 'settle_ui_test_2')
      assert.strictEqual(rejected?.status, 'rejected')
      assert.strictEqual(rejected?.rejectionReason, 'Cash not handed over')
    })
  })
})
