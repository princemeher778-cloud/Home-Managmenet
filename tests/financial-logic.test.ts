import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import {
  calculateTreasuryOverview,
  validateRefund,
  validateTransfer,
} from '../src/data/mockData.ts'
import type {
  ExpenseItem,
  FundContribution,
  TreasuryAccount,
  TreasuryTransfer,
} from '../src/types/index.ts'
import { paiseToRupees, rupeesToPaise } from '../src/utils/financial.ts'

describe('HOMEBASE Stage 2 Financial Logic & Invariant Tests', () => {
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

  // Test 1: Pending expense excluded
  test('Pending expense is excluded from balance deduction', () => {
    const baseContributions: FundContribution[] = [
      {
        id: 'c1',
        accountId: 'acc-upi',
        contributorMembershipId: 'm1',
        contributorName: 'Rohan Sharma',
        amount: 5000,
        date: '2026-11-20',
        status: 'confirmed',
      },
    ]

    const pendingExpense: ExpenseItem = {
      id: 'e-pending',
      title: 'Pending Grocery Bill',
      category: 'Food',
      amount: 1500,
      payerMemberId: 'm1',
      paidBy: 'Rohan Sharma',
      date: '2026-11-20',
      splitScopeType: 'all_active',
      participantMemberIds: ['m1'],
      disbursementChannel: 'treasury_personal_upi',
      disbursedFromAccountId: 'acc-upi',
      disbursementStatus: 'pending',
    }

    const overview = calculateTreasuryOverview(testAccounts, baseContributions, [pendingExpense], [])
    const upiSummary = overview.accounts.find((a) => a.account.id === 'acc-upi')

    // Balance should remain full ₹5,000 because expense is pending
    assert.equal(upiSummary?.currentBalance, 5000)
    assert.equal(upiSummary?.currentBalancePaise, 500000)
  })

  // Test 2: Disbursed expense deducted
  test('Disbursed expense is deducted from treasury balance', () => {
    const baseContributions: FundContribution[] = [
      {
        id: 'c1',
        accountId: 'acc-upi',
        contributorMembershipId: 'm1',
        contributorName: 'Rohan Sharma',
        amount: 5000,
        date: '2026-11-20',
        status: 'confirmed',
      },
    ]

    const disbursedExpense: ExpenseItem = {
      id: 'e-disbursed',
      title: 'Disbursed Grocery Bill',
      category: 'Food',
      amount: 1500,
      payerMemberId: 'm1',
      paidBy: 'Rohan Sharma',
      date: '2026-11-20',
      splitScopeType: 'all_active',
      participantMemberIds: ['m1'],
      disbursementChannel: 'treasury_personal_upi',
      disbursedFromAccountId: 'acc-upi',
      disbursementStatus: 'disbursed',
    }

    const overview = calculateTreasuryOverview(testAccounts, baseContributions, [disbursedExpense], [])
    const upiSummary = overview.accounts.find((a) => a.account.id === 'acc-upi')

    // 5000 - 1500 = 3500
    assert.equal(upiSummary?.currentBalance, 3500)
    assert.equal(upiSummary?.currentBalancePaise, 350000)
  })

  // Test 3: Voided expense excluded
  test('Voided expense is excluded from balance deduction even if marked disbursed', () => {
    const baseContributions: FundContribution[] = [
      {
        id: 'c1',
        accountId: 'acc-upi',
        contributorMembershipId: 'm1',
        contributorName: 'Rohan Sharma',
        amount: 5000,
        date: '2026-11-20',
        status: 'confirmed',
      },
    ]

    const voidedExpense: ExpenseItem = {
      id: 'e-voided',
      title: 'Erroneous Grocery Bill',
      category: 'Food',
      amount: 1500,
      payerMemberId: 'm1',
      paidBy: 'Rohan Sharma',
      date: '2026-11-20',
      splitScopeType: 'all_active',
      participantMemberIds: ['m1'],
      disbursementChannel: 'treasury_personal_upi',
      disbursedFromAccountId: 'acc-upi',
      disbursementStatus: 'disbursed',
      isVoided: true,
    }

    const overview = calculateTreasuryOverview(testAccounts, baseContributions, [voidedExpense], [])
    const upiSummary = overview.accounts.find((a) => a.account.id === 'acc-upi')

    // 5000 - 0 = 5000
    assert.equal(upiSummary?.currentBalance, 5000)
    assert.equal(upiSummary?.currentBalancePaise, 500000)
  })

  // Test 4: Out-of-pocket expense excluded
  test('Member out-of-pocket expense does not reduce treasury balance', () => {
    const baseContributions: FundContribution[] = [
      {
        id: 'c1',
        accountId: 'acc-upi',
        contributorMembershipId: 'm1',
        contributorName: 'Rohan Sharma',
        amount: 5000,
        date: '2026-11-20',
        status: 'confirmed',
      },
    ]

    const outOfPocketExpense: ExpenseItem = {
      id: 'e-oop',
      title: 'Water Purifier Filter AMC',
      category: 'Household',
      amount: 2400,
      payerMemberId: 'm1',
      paidBy: 'Rohan Sharma',
      date: '2026-11-20',
      splitScopeType: 'residents_only',
      participantMemberIds: ['m1'],
      disbursementChannel: 'member_out_of_pocket',
      disbursementStatus: 'disbursed',
    }

    const overview = calculateTreasuryOverview(testAccounts, baseContributions, [outOfPocketExpense], [])
    const upiSummary = overview.accounts.find((a) => a.account.id === 'acc-upi')

    // Treasury balance untouched
    assert.equal(upiSummary?.currentBalance, 5000)
  })

  // Test 5: Insufficient-balance transfer rejected
  test('Transfer exceeding source account available balance is rejected', () => {
    const baseContributions: FundContribution[] = [
      {
        id: 'c1',
        accountId: 'acc-upi',
        contributorMembershipId: 'm1',
        contributorName: 'Rohan Sharma',
        amount: 3000,
        date: '2026-11-20',
        status: 'confirmed',
      },
    ]

    const overview = calculateTreasuryOverview(testAccounts, baseContributions, [], [])

    // Try to transfer 5000 when only 3000 is available
    const validation = validateTransfer(
      'acc-upi',
      'acc-cash',
      rupeesToPaise(5000),
      testAccounts,
      overview
    )

    assert.equal(validation.isValid, false)
    assert.match(validation.errorMessage ?? '', /Insufficient funds/)
  })

  // Test 6: Valid transfer leaves combined balance unchanged
  test('Valid transfer shifts funds between accounts while leaving combined balance unchanged', () => {
    const baseContributions: FundContribution[] = [
      {
        id: 'c1',
        accountId: 'acc-upi',
        contributorMembershipId: 'm1',
        contributorName: 'Rohan Sharma',
        amount: 10000,
        date: '2026-11-20',
        status: 'confirmed',
      },
    ]

    const transfer: TreasuryTransfer = {
      id: 't1',
      fromAccountId: 'acc-upi',
      toAccountId: 'acc-cash',
      fromAccountName: 'Personal UPI Account',
      toAccountName: 'Physical Cash Box',
      amount: 3000,
      date: '2026-11-20',
      purpose: 'ATM Cash refill',
      authorizedByMembershipId: 'm2',
      authorizedByName: 'Arjun Verma',
      status: 'confirmed',
    }

    const overview = calculateTreasuryOverview(testAccounts, baseContributions, [], [transfer])
    const upiSummary = overview.accounts.find((a) => a.account.id === 'acc-upi')
    const cashSummary = overview.accounts.find((a) => a.account.id === 'acc-cash')

    // UPI: 10000 - 3000 = 7000
    assert.equal(upiSummary?.currentBalance, 7000)
    // Cash: 0 + 3000 = 3000
    assert.equal(cashSummary?.currentBalance, 3000)
    // Combined total: 7000 + 3000 = 10000 (Exact preservation)
    assert.equal(overview.totalAvailableBalance, 10000)
    assert.equal(overview.totalAvailableBalancePaise, 1000000)
  })

  // Test 7: Pending refund excluded
  test('Pending refund adjustment is excluded from balance deduction', () => {
    const contributions: FundContribution[] = [
      {
        id: 'c1',
        accountId: 'acc-upi',
        contributorMembershipId: 'm1',
        contributorName: 'Rohan Sharma',
        amount: 5000,
        date: '2026-11-20',
        status: 'confirmed',
      },
      {
        id: 'r1',
        accountId: 'acc-upi',
        contributorMembershipId: 'm1',
        contributorName: 'Rohan Sharma',
        amount: 1000,
        date: '2026-11-20',
        status: 'pending_confirmation', // Pending refund
        isRefundAdjustment: true,
        originalContributionId: 'c1',
      },
    ]

    const overview = calculateTreasuryOverview(testAccounts, contributions, [], [])
    const upiSummary = overview.accounts.find((a) => a.account.id === 'acc-upi')

    // Pending refund must NOT reduce balance yet
    assert.equal(upiSummary?.currentBalance, 5000)
  })

  // Test 8: Confirmed refund deducted
  test('Confirmed refund adjustment is deducted from balance while preserving original deposit', () => {
    const contributions: FundContribution[] = [
      {
        id: 'c1',
        accountId: 'acc-upi',
        contributorMembershipId: 'm1',
        contributorName: 'Rohan Sharma',
        amount: 5000,
        date: '2026-11-20',
        status: 'confirmed',
      },
      {
        id: 'r1',
        accountId: 'acc-upi',
        contributorMembershipId: 'm1',
        contributorName: 'Rohan Sharma',
        amount: 1000,
        date: '2026-11-20',
        status: 'confirmed', // Confirmed refund
        isRefundAdjustment: true,
        originalContributionId: 'c1',
      },
    ]

    const overview = calculateTreasuryOverview(testAccounts, contributions, [], [])
    const upiSummary = overview.accounts.find((a) => a.account.id === 'acc-upi')

    // 5000 - 1000 = 4000
    assert.equal(upiSummary?.currentBalance, 4000)
    assert.equal(upiSummary?.currentBalancePaise, 400000)

    // Original contribution is preserved in array
    assert.equal(contributions.find((c) => c.id === 'c1')?.amount, 5000)
  })

  // Test 9: Refund exceeding original contribution rejected
  test('Refund validation rejects refund amount exceeding the original confirmed deposit', () => {
    const contributions: FundContribution[] = [
      {
        id: 'c1',
        accountId: 'acc-upi',
        contributorMembershipId: 'm1',
        contributorName: 'Rohan Sharma',
        amount: 2000,
        date: '2026-11-20',
        status: 'confirmed',
      },
    ]

    const excessiveRefund: Partial<FundContribution> = {
      id: 'r-excess',
      accountId: 'acc-upi',
      originalContributionId: 'c1',
      amount: 2500, // Exceeds 2000
      isRefundAdjustment: true,
      status: 'confirmed',
    }

    const validation = validateRefund(excessiveRefund, contributions, testAccounts)
    assert.equal(validation.isValid, false)
    assert.match(validation.errorMessage ?? '', /Total refunds cannot exceed/)
  })

  // Test 10: Duplicate confirmation does not duplicate a contribution
  test('Duplicate acknowledgment does not count a contribution more than once', () => {
    const singleContribution: FundContribution = {
      id: 'c-unique',
      accountId: 'acc-upi',
      contributorMembershipId: 'm1',
      contributorName: 'Rohan Sharma',
      amount: 4000,
      date: '2026-11-20',
      status: 'confirmed',
    }

    // Array contains the single contribution once
    const contributionsList = [singleContribution]

    const overview1 = calculateTreasuryOverview(testAccounts, contributionsList, [], [])
    assert.equal(overview1.totalAvailableBalance, 4000)

    // Simulate calling update on the same object again (idempotent status set)
    contributionsList[0].status = 'confirmed'

    const overview2 = calculateTreasuryOverview(testAccounts, contributionsList, [], [])
    assert.equal(overview2.totalAvailableBalance, 4000)
  })

  // Test 11: Fractional amounts such as ₹10.25 calculate correctly without floating-point errors
  test('Amounts such as ₹10.25 calculate with exact integer paise precision', () => {
    assert.equal(rupeesToPaise(10.25), 1025)
    assert.equal(paiseToRupees(1025), 10.25)

    // Classic floating-point hazard in JS: 0.1 + 0.2 != 0.3
    const p1 = rupeesToPaise(10.1)
    const p2 = rupeesToPaise(20.2)
    const sumPaise = p1 + p2
    assert.equal(sumPaise, 3030)
    assert.equal(paiseToRupees(sumPaise), 30.3)

    const fractionalContributions: FundContribution[] = [
      {
        id: 'c-frac1',
        accountId: 'acc-cash',
        contributorMembershipId: 'm1',
        contributorName: 'Rohan Sharma',
        amount: 10.25,
        date: '2026-11-20',
        status: 'confirmed',
      },
      {
        id: 'c-frac2',
        accountId: 'acc-cash',
        contributorMembershipId: 'm2',
        contributorName: 'Arjun Verma',
        amount: 20.75,
        date: '2026-11-20',
        status: 'confirmed',
      },
    ]

    const fractionalExpense: ExpenseItem = {
      id: 'e-frac',
      title: 'Postage Stamps',
      category: 'Admin',
      amount: 15.5,
      payerMemberId: 'm1',
      paidBy: 'Rohan Sharma',
      date: '2026-11-20',
      splitScopeType: 'all_active',
      participantMemberIds: ['m1', 'm2'],
      disbursementChannel: 'treasury_cash_box',
      disbursedFromAccountId: 'acc-cash',
      disbursementStatus: 'disbursed',
    }

    const overview = calculateTreasuryOverview(
      testAccounts,
      fractionalContributions,
      [fractionalExpense],
      []
    )
    const cashSummary = overview.accounts.find((a) => a.account.id === 'acc-cash')

    // 10.25 + 20.75 - 15.50 = 15.50 INR = 1550 paise
    assert.equal(cashSummary?.currentBalancePaise, 1550)
    assert.equal(cashSummary?.currentBalance, 15.5)
  })
})
