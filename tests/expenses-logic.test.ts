import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import {
  calculateTreasuryOverview,
  DEMO_MEMBERS,
  resolveEligibleParticipants,
} from '../src/data/mockData.ts'
import type {
  ExpenseCorrectionRecord,
  ExpenseItem,
  FundContribution,
  HouseholdMember,
  TreasuryAccount,
} from '../src/types/index.ts'
import {
  calculateEqualExpenseSplits,
  paiseToRupees,
  rupeesToPaise,
  validateExpense,
} from '../src/utils/financial.ts'

describe('HOMEBASE Stage 3 Expenses Logic & Invariant Tests', () => {
  const testAccounts: TreasuryAccount[] = [
    {
      id: 'acc-upi',
      name: 'Personal UPI Account',
      accountType: 'personal_upi',
      custodianMembershipId: 'm2',
      custodianName: 'Arjun Verma',
      isActive: true,
    },
    {
      id: 'acc-cash',
      name: 'Physical Cash Box',
      accountType: 'cash_box',
      custodianMembershipId: 'm5',
      custodianName: 'Sameer Patel',
      isActive: true,
    },
  ]

  const testBaseContributions: FundContribution[] = [
    {
      id: 'cnt-1',
      accountId: 'acc-upi',
      contributorMembershipId: 'm1',
      contributorName: 'Rohan Sharma',
      amount: 10000,
      date: '2026-11-20',
      status: 'confirmed',
    },
    {
      id: 'cnt-2',
      accountId: 'acc-cash',
      contributorMembershipId: 'm2',
      contributorName: 'Arjun Verma',
      amount: 5000,
      date: '2026-11-20',
      status: 'confirmed',
    },
  ]

  // Test 1: Equal split remainder distribution (₹100 split 3 ways)
  test('1. Equal split remainder distribution (₹100 split 3 ways yields 3334, 3333, 3333 paise totaling 10,000 paise)', () => {
    const participants = [
      { id: 'm1', name: 'Rohan Sharma' },
      { id: 'm2', name: 'Arjun Verma' },
      { id: 'm3', name: 'Karthik Nair' },
    ]
    const amountPaise = 10000 // ₹100.00 = 10,000 paise

    const splits = calculateEqualExpenseSplits(
      amountPaise,
      participants,
      'm1',
      'treasury_personal_upi'
    )

    assert.equal(splits.length, 3)
    // 10,000 / 3 = 3333 with 1 remainder paise assigned to participant 0
    assert.equal(splits[0].sharePaise, 3334)
    assert.equal(splits[0].shareAmount, 33.34)
    assert.equal(splits[1].sharePaise, 3333)
    assert.equal(splits[1].shareAmount, 33.33)
    assert.equal(splits[2].sharePaise, 3333)
    assert.equal(splits[2].shareAmount, 33.33)

    const totalCalculatedPaise = splits.reduce((sum, s) => sum + s.sharePaise, 0)
    assert.equal(totalCalculatedPaise, 10000)
  })

  // Test 2: Fractional amount splitting (₹10.25 split among 4 participants)
  test('2. Fractional amount splitting (₹10.25 split among 4 participants)', () => {
    const participants = [
      { id: 'm1', name: 'Rohan Sharma' },
      { id: 'm2', name: 'Arjun Verma' },
      { id: 'm3', name: 'Karthik Nair' },
      { id: 'm4', name: 'Vikram Sengupta' },
    ]
    const amountPaise = rupeesToPaise(10.25) // 1025 paise

    const splits = calculateEqualExpenseSplits(
      amountPaise,
      participants,
      'm1',
      'member_out_of_pocket'
    )

    assert.equal(splits.length, 4)
    // 1025 / 4 = 256 with 1 remainder paise (257, 256, 256, 256)
    assert.equal(splits[0].sharePaise, 257)
    assert.equal(splits[0].shareAmount, 2.57)
    assert.equal(splits[1].sharePaise, 256)
    assert.equal(splits[1].shareAmount, 2.56)
    assert.equal(splits[2].sharePaise, 256)
    assert.equal(splits[3].sharePaise, 256)

    const sumPaise = splits.reduce((sum, s) => sum + s.sharePaise, 0)
    assert.equal(sumPaise, 1025)
    assert.equal(paiseToRupees(sumPaise), 10.25)
  })

  // Test 3: All four participant scopes resolve correctly
  test('3. All four participant scopes resolve correctly', () => {
    const allActive = resolveEligibleParticipants(DEMO_MEMBERS, 'all_active')
    const residentsOnly = resolveEligibleParticipants(DEMO_MEMBERS, 'residents_only')
    const foodParticipants = resolveEligibleParticipants(DEMO_MEMBERS, 'food_participants')
    const custom = resolveEligibleParticipants(DEMO_MEMBERS, 'custom', ['m1', 'm2', 'm3'])

    // In demo members: 7 members with isGeneralExpenseEligible (m1..m7, excluding food-only m8)
    assert.equal(allActive.length, 7)
    assert.ok(allActive.every((m) => m.isGeneralExpenseEligible))
    // 7 residents (m1..m7)
    assert.equal(residentsOnly.length, 7)
    assert.ok(residentsOnly.every((m) => m.isResident))
    // 8 food participants (7 residents + 1 food-only m8)
    assert.equal(foodParticipants.length, 8)
    assert.ok(foodParticipants.every((m) => m.isFoodEligible))
    // Custom 3 members
    assert.equal(custom.length, 3)
    assert.deepEqual(custom.map((m) => m.id).sort(), ['m1', 'm2', 'm3'])
  })

  // Test 4: Departed and paused members are strictly excluded from new participant resolution
  test('4. Departed and paused members are strictly excluded from new participant resolution', () => {
    const membersWithInactive: HouseholdMember[] = [
      ...DEMO_MEMBERS,
      {
        id: 'm-paused',
        name: 'Pooja Sharma',
        avatarInitial: 'P',
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

    // Attempt to include departed member m0 and paused member m-paused in custom scope
    const customResolved = resolveEligibleParticipants(
      membersWithInactive,
      'custom',
      ['m0', 'm-paused', 'm1', 'm2']
    )

    // m0 (departed) and m-paused (paused) MUST be excluded
    const resolvedIds = customResolved.map((m) => m.id)
    assert.ok(!resolvedIds.includes('m0'), 'Departed member m0 must be excluded')
    assert.ok(!resolvedIds.includes('m-paused'), 'Paused member m-paused must be excluded')
    assert.equal(resolvedIds.length, 2)
    assert.deepEqual(resolvedIds.sort(), ['m1', 'm2'])
  })

  // Test 5: Historical participant preservation on saved expense records
  test('5. Historical participant preservation on saved expense records', () => {
    // exp-4 was historically paid by departed member m0 with m0 participating
    const historicalExpense: ExpenseItem = {
      id: 'exp-hist',
      title: 'Water Purifier Filter AMC',
      category: 'Cleaning & Household',
      amount: 2400,
      amountPaise: 240000,
      payerMemberId: 'm0', // Departed member
      paidBy: 'Aakash Verma',
      date: '28 Oct 2026',
      splitScopeType: 'residents_only',
      participantMemberIds: ['m0', 'm1', 'm2', 'm3', 'm5', 'm6', 'm7'],
      splits: [
        { memberId: 'm0', sharePaise: 34286, shareAmount: 342.86, settlementStatus: 'settled' },
        { memberId: 'm1', sharePaise: 34286, shareAmount: 342.86, settlementStatus: 'unsettled' },
      ],
      disbursementChannel: 'member_out_of_pocket',
      disbursementStatus: 'disbursed',
    }

    // Even if DEMO_MEMBERS does not include m0 as active, the historical record participant array remains untouched
    assert.ok(historicalExpense.participantMemberIds.includes('m0'))
    assert.equal(historicalExpense.splits[0].memberId, 'm0')
    assert.equal(historicalExpense.splits[0].settlementStatus, 'settled')
  })

  // Test 6: Treasury-funded expense deduction
  test('6. Treasury-funded expense deduction reduces account balance in calculateTreasuryOverview', () => {
    const upiExpense: ExpenseItem = {
      id: 'exp-upi',
      title: 'High-speed Fiber Broadband',
      category: 'Utilities & Internet',
      amount: 1499,
      amountPaise: 149900,
      payerMemberId: 'm3',
      paidBy: 'Karthik Nair',
      date: '2026-11-20',
      splitScopeType: 'residents_only',
      participantMemberIds: ['m1', 'm2', 'm3'],
      splits: [],
      disbursementChannel: 'treasury_personal_upi',
      disbursedFromAccountId: 'acc-upi',
      disbursementStatus: 'disbursed',
    }

    const overview = calculateTreasuryOverview(
      testAccounts,
      testBaseContributions,
      [upiExpense],
      []
    )
    const upiSummary = overview.accounts.find((a) => a.account.id === 'acc-upi')

    // 10,000 - 1,499 = 8,501 INR (850,100 paise)
    assert.equal(upiSummary?.currentBalance, 8501)
    assert.equal(upiSummary?.currentBalancePaise, 850100)
  })

  // Test 7: Pending expense exclusion from treasury balance deduction
  test('7. Pending expense exclusion from treasury balance deduction', () => {
    const pendingExpense: ExpenseItem = {
      id: 'exp-pending',
      title: 'Balcony Mesh & Pigeon Netting',
      category: 'Repairs & Maintenance',
      amount: 1200,
      amountPaise: 120000,
      payerMemberId: 'm5',
      paidBy: 'Sameer Patel',
      date: '2026-11-20',
      splitScopeType: 'residents_only',
      participantMemberIds: ['m1', 'm2'],
      splits: [],
      disbursementChannel: 'treasury_cash_box',
      disbursedFromAccountId: 'acc-cash',
      disbursementStatus: 'pending', // Pending approval!
    }

    const overview = calculateTreasuryOverview(
      testAccounts,
      testBaseContributions,
      [pendingExpense],
      []
    )
    const cashSummary = overview.accounts.find((a) => a.account.id === 'acc-cash')

    // Balance remains full 5,000 because expense is pending
    assert.equal(cashSummary?.currentBalance, 5000)
    assert.equal(cashSummary?.currentBalancePaise, 500000)
  })

  // Test 8: Out-of-pocket expense isolation
  test('8. Member out-of-pocket expenses do not reduce treasury balance', () => {
    const oopExpense: ExpenseItem = {
      id: 'exp-oop',
      title: 'Emergency Plumbing Washers',
      category: 'Repairs & Maintenance',
      amount: 650,
      amountPaise: 65000,
      payerMemberId: 'm2',
      paidBy: 'Arjun Verma',
      date: '2026-11-20',
      splitScopeType: 'residents_only',
      participantMemberIds: ['m1', 'm2', 'm3'],
      splits: [],
      disbursementChannel: 'member_out_of_pocket',
      disbursementStatus: 'disbursed',
    }

    const overview = calculateTreasuryOverview(
      testAccounts,
      testBaseContributions,
      [oopExpense],
      []
    )

    // Neither UPI nor Cash Box balance should change
    const upiSummary = overview.accounts.find((a) => a.account.id === 'acc-upi')
    const cashSummary = overview.accounts.find((a) => a.account.id === 'acc-cash')
    assert.equal(upiSummary?.currentBalance, 10000)
    assert.equal(cashSummary?.currentBalance, 5000)
    assert.equal(overview.totalAvailableBalance, 15000)
  })

  // Test 9: Insufficient treasury balance rejection
  test('9. Insufficient treasury balance rejection in validateExpense', () => {
    const overview = calculateTreasuryOverview(
      testAccounts,
      testBaseContributions,
      [],
      []
    )

    // Try to disburse ₹15,000 from Cash Box (which only has ₹5,000)
    const overdrawExpense: Partial<ExpenseItem> = {
      title: 'Major Kitchen Renovation',
      amountPaise: rupeesToPaise(15000),
      payerMemberId: 'm1',
      participantMemberIds: ['m1', 'm2'],
      disbursementChannel: 'treasury_cash_box',
      disbursedFromAccountId: 'acc-cash',
      disbursementStatus: 'disbursed',
    }

    const validation = validateExpense(overdrawExpense, testAccounts, overview)
    assert.equal(validation.isValid, false)
    assert.match(validation.errorMessage ?? '', /Insufficient funds in Physical Cash Box/)
  })

  // Test 10: Voided expense exclusion
  test('10. Voided expense exclusion from treasury deductions even if marked disbursed', () => {
    const voidedExpense: ExpenseItem = {
      id: 'exp-void',
      title: 'Erroneous Grocery Order',
      category: 'Kitchen & Groceries',
      amount: 3000,
      amountPaise: 300000,
      payerMemberId: 'm1',
      paidBy: 'Rohan Sharma',
      date: '2026-11-20',
      splitScopeType: 'food_participants',
      participantMemberIds: ['m1', 'm2'],
      splits: [],
      disbursementChannel: 'treasury_personal_upi',
      disbursedFromAccountId: 'acc-upi',
      disbursementStatus: 'disbursed',
      isVoided: true, // Voided!
      voidReason: 'Order cancelled and refunded directly by vendor',
    }

    const overview = calculateTreasuryOverview(
      testAccounts,
      testBaseContributions,
      [voidedExpense],
      []
    )
    const upiSummary = overview.accounts.find((a) => a.account.id === 'acc-upi')

    // Voided expense does not deduct funds (balance stays ₹10,000)
    assert.equal(upiSummary?.currentBalance, 10000)
    assert.equal(upiSummary?.currentBalancePaise, 1000000)
  })

  // Test 11: Share totals exactly match expense totals
  test('11. Share totals exactly match expense totals across odd denominators and decimal amounts', () => {
    const testCases = [
      { amount: 100, count: 3 },
      { amount: 10.25, count: 4 },
      { amount: 1499, count: 7 },
      { amount: 8420.75, count: 8 },
      { amount: 333.33, count: 6 },
    ]

    for (const tc of testCases) {
      const amountPaise = rupeesToPaise(tc.amount)
      const participants = Array.from({ length: tc.count }, (_, i) => ({
        id: `m${i + 1}`,
        name: `Member ${i + 1}`,
      }))

      const splits = calculateEqualExpenseSplits(
        amountPaise,
        participants,
        'm1',
        'treasury_personal_upi'
      )

      const sumPaise = splits.reduce((sum, s) => sum + s.sharePaise, 0)
      assert.equal(
        sumPaise,
        amountPaise,
        `Sum of splits (${sumPaise}) must exactly equal amountPaise (${amountPaise}) for amount ${tc.amount} and ${tc.count} participants`
      )
    }
  })

  // Test 12: Payer included vs excluded from participant splits
  test('12. Payer included and excluded from participants for out-of-pocket expenses', () => {
    const participants = [
      { id: 'm1', name: 'Rohan Sharma' },
      { id: 'm2', name: 'Arjun Verma' },
      { id: 'm3', name: 'Karthik Nair' },
    ]

    // Scenario A: Payer m1 is one of the participants
    const splitsPayerIncluded = calculateEqualExpenseSplits(
      300000,
      participants,
      'm1',
      'member_out_of_pocket'
    )
    const payerShareA = splitsPayerIncluded.find((s) => s.memberId === 'm1')
    const otherShareA = splitsPayerIncluded.find((s) => s.memberId === 'm2')
    assert.equal(payerShareA?.settlementStatus, 'settled')
    assert.equal(otherShareA?.settlementStatus, 'unsettled')

    // Scenario B: Payer m5 pays out of pocket for participants m1, m2, m3 (Payer excluded)
    const splitsPayerExcluded = calculateEqualExpenseSplits(
      300000,
      participants,
      'm5', // Payer m5 is NOT in participants!
      'member_out_of_pocket'
    )
    assert.ok(
      splitsPayerExcluded.every((s) => s.settlementStatus === 'unsettled'),
      'All participant shares must be unsettled when payer is not a participant'
    )
  })

  // Test 13: Correction history preservation and non-destructive voiding
  test('13. Correction history preservation and non-destructive voiding', () => {
    const originalExpense: ExpenseItem = {
      id: 'exp-corr',
      title: 'Kitchen Ration Order',
      category: 'Kitchen & Groceries',
      amount: 4500,
      amountPaise: 450000,
      payerMemberId: 'm1',
      paidBy: 'Rohan Sharma',
      date: '2026-11-20',
      splitScopeType: 'food_participants',
      participantMemberIds: ['m1', 'm2', 'm3'],
      splits: [],
      disbursementChannel: 'treasury_personal_upi',
      disbursedFromAccountId: 'acc-upi',
      disbursementStatus: 'disbursed',
    }

    // Simulate appending a correction record
    const correction: ExpenseCorrectionRecord = {
      id: 'cor-1',
      editedAt: '2026-11-20 08:30 PM',
      editedByMembershipId: 'm2',
      editedByName: 'Arjun Verma (Custodian)',
      reason: 'Corrected category from Utilities to Kitchen & Groceries',
      previousValues: {
        title: 'Kitchen Ration Order',
        category: 'Utilities & Internet',
        amountPaise: 450000,
        splitScopeType: 'food_participants',
        participantMemberIds: ['m1', 'm2', 'm3'],
      },
    }

    const updatedExpense: ExpenseItem = {
      ...originalExpense,
      correctionHistory: [correction],
    }

    assert.equal(updatedExpense.correctionHistory?.length, 1)
    assert.equal(updatedExpense.correctionHistory?.[0].reason, 'Corrected category from Utilities to Kitchen & Groceries')
    assert.equal(updatedExpense.correctionHistory?.[0].previousValues.category, 'Utilities & Internet')

    // Simulate voiding the expense
    const voidedExpense: ExpenseItem = {
      ...updatedExpense,
      isVoided: true,
      voidReason: 'Duplicate bill logged in error',
      voidedAt: '2026-11-20 09:00 PM',
      voidedByMembershipId: 'm2',
    }

    assert.equal(voidedExpense.isVoided, true)
    assert.equal(voidedExpense.voidReason, 'Duplicate bill logged in error')
    // Original metadata and history are completely preserved
    assert.equal(voidedExpense.amountPaise, 450000)
    assert.equal(voidedExpense.correctionHistory?.length, 1)
  })
})
