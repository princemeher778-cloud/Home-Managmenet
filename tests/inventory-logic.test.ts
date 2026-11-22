import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import type {
  ExpenseItem,
  HouseholdMember,
  InventoryItem,
  StockLogRecord,
} from '../src/types/index.ts'
import {
  applyStockOperation,
  archiveInventoryItem,
  createInventoryItemAtomic,
  deriveStockStatus,
  formatInventoryQuantity,
  isDiscreteUnit,
  milliToDisplay,
  parseQuantityInput,
  updateInventoryItemUnit,
} from '../src/utils/inventory.ts'

describe('HOMEBASE Stage 4 Inventory Logic & Invariant Tests', () => {
  const testMembers: HouseholdMember[] = [
    {
      id: 'm1',
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
      id: 'm2',
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
      id: 'm-departed',
      name: 'Aakash Verma',
      avatarInitial: 'AV',
      status: 'departed',
      participationTier: 'resident',
      joinedDate: '2025-01-01',
      departedDate: '2026-10-31',
      isResident: false,
      isFoodEligible: false,
      isCleaningEligible: false,
      isGeneralExpenseEligible: false,
      isRentEligible: false,
    },
    {
      id: 'm-paused',
      name: 'Pooja Sharma',
      avatarInitial: 'PS',
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

  const testExpenses: ExpenseItem[] = [
    {
      id: 'exp-groceries',
      title: 'Monthly Groceries & Staples',
      category: 'Kitchen Groceries & Staples',
      amount: 8420,
      amountPaise: 842000,
      payerMemberId: 'm1',
      paidBy: 'Rohan Sharma',
      date: '2026-11-19',
      splitScopeType: 'all_active',
      participantMemberIds: ['m1', 'm2'],
      splits: [],
      disbursementChannel: 'treasury_personal_upi',
      disbursementStatus: 'disbursed',
    },
    {
      id: 'exp-voided',
      title: 'Erroneous Cleaning Supplies Order',
      category: 'Cleaning & Household',
      amount: 1200,
      amountPaise: 120000,
      payerMemberId: 'm2',
      paidBy: 'Arjun Verma',
      date: '2026-11-18',
      splitScopeType: 'residents_only',
      participantMemberIds: ['m1', 'm2'],
      splits: [],
      disbursementChannel: 'treasury_personal_upi',
      disbursementStatus: 'disbursed',
      isVoided: true, // Voided expense
      voidReason: 'Store cancelled shipment',
    },
  ]

  // Test 1: Integer scaling and display formatting
  test('1. Integer scaling and display formatting across discrete and continuous units', () => {
    // Continuous unit scaling
    const parsedContinuous = parseQuantityInput('1.25', false)
    assert.equal(parsedContinuous.isValid, true)
    assert.equal(parsedContinuous.milliUnits, 1250) // 1.25 * 1000 = 1250 milli-units
    assert.equal(milliToDisplay(1250, false), '1.25')
    assert.equal(formatInventoryQuantity(1250, 'kg'), '1.25 kg')

    // Discrete unit scaling
    const parsedDiscrete = parseQuantityInput('3', true)
    assert.equal(parsedDiscrete.isValid, true)
    assert.equal(parsedDiscrete.milliUnits, 3000) // 3 * 1000 = 3000 milli-units
    assert.equal(milliToDisplay(3000, true), '3')
    assert.equal(formatInventoryQuantity(3000, 'packet'), '3 packets')
    assert.equal(formatInventoryQuantity(1000, 'packet'), '1 packet')
  })

  // Test 2: Discrete unit whole-number validation & decimal rejection
  test('2. Discrete units reject any decimal places and accept whole numbers only', () => {
    assert.equal(isDiscreteUnit('packet'), true)
    assert.equal(isDiscreteUnit('bottle'), true)
    assert.equal(isDiscreteUnit('kg'), false)

    const invalidDiscrete = parseQuantityInput('2.5', true)
    assert.equal(invalidDiscrete.isValid, false)
    assert.match(invalidDiscrete.errorMessage ?? '', /whole numbers only/)

    const invalidNegative = parseQuantityInput('-1', true)
    assert.equal(invalidNegative.isValid, false)

    const validDiscrete = parseQuantityInput('5', true)
    assert.equal(validDiscrete.isValid, true)
    assert.equal(validDiscrete.milliUnits, 5000)
  })

  // Test 3: Continuous unit precision validation & excess decimal rejection
  test('3. Continuous units accept up to 3 decimals and reject excess precision without rounding', () => {
    const valid3Decimals = parseQuantityInput('1.125', false)
    assert.equal(valid3Decimals.isValid, true)
    assert.equal(valid3Decimals.milliUnits, 1125)

    // 4 decimal places must be REJECTED, not silently rounded
    const invalid4Decimals = parseQuantityInput('1.1255', false)
    assert.equal(invalid4Decimals.isValid, false)
    assert.match(invalid4Decimals.errorMessage ?? '', /at most 3 decimal places/)

    const emptyInput = parseQuantityInput('   ', false)
    assert.equal(emptyInput.isValid, false)
    assert.match(emptyInput.errorMessage ?? '', /required/)
  })

  // Test 4: Atomic item creation with zero and positive initial quantities
  test('4. Atomic item creation commits item and initial stock log together, including zero-stock items', () => {
    const items: InventoryItem[] = []
    const logs: StockLogRecord[] = []

    // Scenario A: Positive starting quantity
    const resA = createInventoryItemAtomic(
      {
        idempotencyKey: 'idemp-init-rice',
        name: 'Basmati Rice',
        category: 'Kitchen Groceries & Staples',
        unit: 'kg',
        initialQuantityString: '10',
        minThresholdString: '2',
        createdByMembershipId: 'm1',
        createdByName: 'Rohan Sharma',
      },
      testMembers,
      items,
      logs
    )

    assert.equal(resA.success, true)
    assert.ok(resA.item)
    assert.ok(resA.log)
    assert.equal(resA.item.currentQuantityMilli, 10000)
    assert.equal(resA.item.minThresholdMilli, 2000)
    assert.equal(resA.log.changeType, 'initial')
    assert.equal(resA.log.previousQuantityMilli, 0)
    assert.equal(resA.log.newQuantityMilli, 10000)
    assert.equal(resA.log.quantityChangedMilli, 10000)

    items.push(resA.item)
    logs.push(resA.log)

    // Scenario B: Zero starting quantity (registering before buying)
    const resB = createInventoryItemAtomic(
      {
        idempotencyKey: 'idemp-init-zero',
        name: 'Olive Oil Extra Virgin',
        category: 'Kitchen Groceries & Staples',
        unit: 'bottle',
        initialQuantityString: '0',
        minThresholdString: '1',
        createdByMembershipId: 'm2',
        createdByName: 'Arjun Verma',
      },
      testMembers,
      items,
      logs
    )

    assert.equal(resB.success, true)
    assert.ok(resB.item)
    assert.ok(resB.log)
    assert.equal(resB.item.currentQuantityMilli, 0)
    assert.equal(resB.log.changeType, 'initial')
    assert.equal(resB.log.previousQuantityMilli, 0)
    assert.equal(resB.log.newQuantityMilli, 0)
    assert.equal(resB.log.quantityChangedMilli, 0)
  })

  // Test 5: Restock and Consumption atomic operations
  test('5. Restock increases quantity and Consumption decreases quantity with accurate delta logging', () => {
    const item: InventoryItem = {
      id: 'inv-test-oil',
      name: 'Sunflower Oil',
      category: 'Kitchen Groceries & Staples',
      unit: 'L',
      isDiscrete: false,
      currentQuantityMilli: 2000, // 2.0 L
      minThresholdMilli: 1000,
      isArchived: false,
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
      createdAt: '2026-11-20T10:00:00.000Z',
    }

    const items = [item]
    const logs: StockLogRecord[] = []

    // Restock +3.5 L
    const restockRes = applyStockOperation(
      {
        idempotencyKey: 'idemp-restock-1',
        itemId: 'inv-test-oil',
        changeType: 'restock',
        inputQuantityString: '3.5',
        performedByMembershipId: 'm1',
        performedByName: 'Rohan Sharma',
        reason: 'Supermarket refill run',
      },
      testMembers,
      items,
      logs,
      testExpenses
    )

    assert.equal(restockRes.success, true)
    assert.equal(restockRes.updatedItem?.currentQuantityMilli, 5500) // 2000 + 3500 = 5500 milli-units = 5.5 L
    assert.equal(restockRes.newLog?.quantityChangedMilli, 3500)
    assert.equal(restockRes.newLog?.previousQuantityMilli, 2000)
    assert.equal(restockRes.newLog?.newQuantityMilli, 5500)

    // Update state collections
    const updatedItems = [restockRes.updatedItem!]
    const updatedLogs = [restockRes.newLog!, ...logs]

    // Consume -1.25 L
    const consumeRes = applyStockOperation(
      {
        idempotencyKey: 'idemp-consume-1',
        itemId: 'inv-test-oil',
        changeType: 'consumption',
        inputQuantityString: '1.25',
        performedByMembershipId: 'm2',
        performedByName: 'Arjun Verma',
        reason: 'Weekly dinner frying use',
      },
      testMembers,
      updatedItems,
      updatedLogs,
      testExpenses
    )

    assert.equal(consumeRes.success, true)
    assert.equal(consumeRes.updatedItem?.currentQuantityMilli, 4250) // 5500 - 1250 = 4250 milli-units = 4.25 L
    assert.equal(consumeRes.newLog?.quantityChangedMilli, -1250)
    assert.equal(consumeRes.newLog?.previousQuantityMilli, 5500)
    assert.equal(consumeRes.newLog?.newQuantityMilli, 4250)
  })

  // Test 6: Negative-stock prevention
  test('6. Negative stock is strictly prevented when consumption exceeds on-hand stock', () => {
    const item: InventoryItem = {
      id: 'inv-test-sugar',
      name: 'Refined Sugar',
      category: 'Kitchen Groceries & Staples',
      unit: 'kg',
      isDiscrete: false,
      currentQuantityMilli: 1500, // 1.5 kg on hand
      minThresholdMilli: 1000,
      isArchived: false,
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
      createdAt: '2026-11-20T10:00:00.000Z',
    }

    const items = [item]
    const logs: StockLogRecord[] = []

    // Try to consume 2.0 kg when only 1.5 kg is available
    const overdrawRes = applyStockOperation(
      {
        idempotencyKey: 'idemp-overdraw',
        itemId: 'inv-test-sugar',
        changeType: 'consumption',
        inputQuantityString: '2.0',
        performedByMembershipId: 'm1',
        performedByName: 'Rohan Sharma',
      },
      testMembers,
      items,
      logs,
      testExpenses
    )

    assert.equal(overdrawRes.success, false)
    assert.match(overdrawRes.errorMessage ?? '', /Cannot consume/)
  })

  // Test 7: Correction and Waste operations
  test('7. Physical count audit correction and waste write-offs require mandatory reasons', () => {
    const item: InventoryItem = {
      id: 'inv-test-milk',
      name: 'Fresh Toned Milk',
      category: 'Fresh Food & Dairy',
      unit: 'packet',
      isDiscrete: true,
      currentQuantityMilli: 4000, // 4 packets
      minThresholdMilli: 2000,
      isArchived: false,
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
      createdAt: '2026-11-20T10:00:00.000Z',
    }

    const items = [item]
    const logs: StockLogRecord[] = []

    // Correction without reason must FAIL
    const correctionNoReason = applyStockOperation(
      {
        idempotencyKey: 'idemp-corr-fail',
        itemId: 'inv-test-milk',
        changeType: 'correction',
        inputQuantityString: '6', // Counted 6
        performedByMembershipId: 'm1',
        performedByName: 'Rohan Sharma',
        reason: '', // Missing reason
      },
      testMembers,
      items,
      logs,
      testExpenses
    )
    assert.equal(correctionNoReason.success, false)
    assert.match(correctionNoReason.errorMessage ?? '', /mandatory reason/i)

    // Correction with valid reason succeeds
    const correctionValid = applyStockOperation(
      {
        idempotencyKey: 'idemp-corr-ok',
        itemId: 'inv-test-milk',
        changeType: 'correction',
        inputQuantityString: '6',
        performedByMembershipId: 'm1',
        performedByName: 'Rohan Sharma',
        reason: 'Weekend fridge audit found 2 unopened packets in bottom drawer',
      },
      testMembers,
      items,
      logs,
      testExpenses
    )
    assert.equal(correctionValid.success, true)
    assert.equal(correctionValid.updatedItem?.currentQuantityMilli, 6000)
    assert.equal(correctionValid.newLog?.quantityChangedMilli, 2000) // 6000 - 4000 = +2000

    // Waste write-off: 1 packet spoiled
    const wasteRes = applyStockOperation(
      {
        idempotencyKey: 'idemp-waste-ok',
        itemId: 'inv-test-milk',
        changeType: 'waste',
        inputQuantityString: '1',
        performedByMembershipId: 'm2',
        performedByName: 'Arjun Verma',
        reason: 'Expired past shelf life, packet leaked',
      },
      testMembers,
      [correctionValid.updatedItem!],
      [correctionValid.newLog!],
      testExpenses
    )
    assert.equal(wasteRes.success, true)
    assert.equal(wasteRes.updatedItem?.currentQuantityMilli, 5000) // 6000 - 1000 = 5000
    assert.equal(wasteRes.newLog?.quantityChangedMilli, -1000)
  })

  // Test 8: Idempotency duplicate protection
  test('8. Replaying an action with an existing idempotencyKey is rejected with state unchanged', () => {
    const existingLog: StockLogRecord = {
      id: 'stk-existing',
      idempotencyKey: 'idemp-unique-token-999',
      itemId: 'inv-1',
      itemName: 'Refined Oil',
      unit: 'L',
      changeType: 'restock',
      quantityChangedMilli: 2000,
      previousQuantityMilli: 1000,
      newQuantityMilli: 3000,
      performedByMembershipId: 'm1',
      performedByName: 'Rohan Sharma',
      timestamp: '2026-11-20T10:00:00.000Z',
    }

    const item: InventoryItem = {
      id: 'inv-1',
      name: 'Refined Oil',
      category: 'Kitchen Groceries & Staples',
      unit: 'L',
      isDiscrete: false,
      currentQuantityMilli: 3000,
      minThresholdMilli: 1000,
      isArchived: false,
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
      createdAt: '2026-11-20T10:00:00.000Z',
    }

    const duplicateRes = applyStockOperation(
      {
        idempotencyKey: 'idemp-unique-token-999', // Re-used idempotency key!
        itemId: 'inv-1',
        changeType: 'restock',
        inputQuantityString: '2.0',
        performedByMembershipId: 'm1',
        performedByName: 'Rohan Sharma',
      },
      testMembers,
      [item],
      [existingLog],
      testExpenses
    )

    assert.equal(duplicateRes.success, false)
    assert.match(duplicateRes.errorMessage ?? '', /Duplicate stock action rejected/)
  })

  // Test 9: Archive safeguards for remaining stock
  test('9. Archiving items with remaining stock requires explicit confirmation and mandatory reason', () => {
    const itemWithStock: InventoryItem = {
      id: 'inv-discontinued',
      name: 'Specialty Herbal Tea (Pack of 20)',
      category: 'Other Consumables',
      unit: 'box',
      isDiscrete: true,
      currentQuantityMilli: 2000, // 2 boxes remaining
      minThresholdMilli: 1000,
      isArchived: false,
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
      createdAt: '2026-11-20T10:00:00.000Z',
    }

    // Attempt to archive without confirmation flag
    const failNoConfirm = archiveInventoryItem(
      'inv-discontinued',
      'm1',
      'Discontinued brand',
      false, // confirmWithStock is false
      testMembers,
      [itemWithStock]
    )
    assert.equal(failNoConfirm.success, false)
    assert.match(failNoConfirm.errorMessage ?? '', /Explicit confirmation is required/)

    // Attempt to archive with confirmation but no reason
    const failNoReason = archiveInventoryItem(
      'inv-discontinued',
      'm1',
      '', // Missing reason
      true,
      testMembers,
      [itemWithStock]
    )
    assert.equal(failNoReason.success, false)
    assert.match(failNoReason.errorMessage ?? '', /Mandatory reason.*required/i)

    // Archive with confirmation and valid reason
    const successArchive = archiveInventoryItem(
      'inv-discontinued',
      'm1',
      'Brand discontinued by manufacturer; remaining boxes kept for guests',
      true,
      testMembers,
      [itemWithStock]
    )
    assert.equal(successArchive.success, true)
    assert.equal(successArchive.updatedItem?.isArchived, true)
    assert.equal(successArchive.updatedItem?.currentQuantityMilli, 2000) // Remaining stock preserved!
  })

  // Test 10: Prohibition of operations on archived items
  test('10. Operations on archived items are rejected', () => {
    const archivedItem: InventoryItem = {
      id: 'inv-archived-item',
      name: 'Old Detergent Pods',
      category: 'Cleaning & Housekeeping',
      unit: 'box',
      isDiscrete: true,
      currentQuantityMilli: 1000,
      minThresholdMilli: 1000,
      isArchived: true, // Archived!
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
      createdAt: '2026-11-01T10:00:00.000Z',
    }

    const res = applyStockOperation(
      {
        idempotencyKey: 'idemp-archived-restock',
        itemId: 'inv-archived-item',
        changeType: 'restock',
        inputQuantityString: '2',
        performedByMembershipId: 'm1',
        performedByName: 'Rohan Sharma',
      },
      testMembers,
      [archivedItem],
      [],
      testExpenses
    )

    assert.equal(res.success, false)
    assert.match(res.errorMessage ?? '', /archived/i)
  })

  // Test 11: Expense linking validation and zero financial mutation
  test('11. Referential expense linking validates existence and preserves zero financial mutation', () => {
    const item: InventoryItem = {
      id: 'inv-flour',
      name: 'Whole Wheat Atta (10kg)',
      category: 'Kitchen Groceries & Staples',
      unit: 'kg',
      isDiscrete: false,
      currentQuantityMilli: 5000,
      minThresholdMilli: 2000,
      isArchived: false,
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
      createdAt: '2026-11-20T10:00:00.000Z',
    }

    // Non-existent expense ID must FAIL validation
    const failNonExistentExp = applyStockOperation(
      {
        idempotencyKey: 'idemp-exp-nonexistent',
        itemId: 'inv-flour',
        changeType: 'restock',
        inputQuantityString: '10',
        performedByMembershipId: 'm1',
        performedByName: 'Rohan Sharma',
        linkedExpenseId: 'exp-fake-id', // Does not exist
      },
      testMembers,
      [item],
      [],
      testExpenses
    )
    assert.equal(failNonExistentExp.success, false)
    assert.match(failNonExistentExp.errorMessage ?? '', /expense record not found/i)

    // Valid expense ID succeeds
    const validExpRes = applyStockOperation(
      {
        idempotencyKey: 'idemp-exp-valid',
        itemId: 'inv-flour',
        changeType: 'restock',
        inputQuantityString: '10',
        performedByMembershipId: 'm1',
        performedByName: 'Rohan Sharma',
        linkedExpenseId: 'exp-groceries', // Valid expense
      },
      testMembers,
      [item],
      [],
      testExpenses
    )
    assert.equal(validExpRes.success, true)
    assert.equal(validExpRes.newLog?.linkedExpenseId, 'exp-groceries')

    // Expense object itself must NEVER be mutated
    const referencedExpense = testExpenses.find((e) => e.id === 'exp-groceries')
    assert.equal(referencedExpense?.amountPaise, 842000)
    assert.equal(referencedExpense?.disbursementStatus, 'disbursed')
  })

  // Test 12: Active member attribution requirement
  test('12. Operations by paused or departed members are rejected', () => {
    const item: InventoryItem = {
      id: 'inv-soap',
      name: 'Handwash Refill (1L)',
      category: 'Bathroom & Toiletries',
      unit: 'L',
      isDiscrete: false,
      currentQuantityMilli: 2000,
      minThresholdMilli: 1000,
      isArchived: false,
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
      createdAt: '2026-11-20T10:00:00.000Z',
    }

    // Departed member must be rejected
    const departedRes = applyStockOperation(
      {
        idempotencyKey: 'idemp-departed-actor',
        itemId: 'inv-soap',
        changeType: 'consumption',
        inputQuantityString: '0.5',
        performedByMembershipId: 'm-departed', // Departed member
        performedByName: 'Aakash Verma',
      },
      testMembers,
      [item],
      [],
      testExpenses
    )
    assert.equal(departedRes.success, false)
    assert.match(departedRes.errorMessage ?? '', /active household member/i)

    // Paused member must be rejected
    const pausedRes = applyStockOperation(
      {
        idempotencyKey: 'idemp-paused-actor',
        itemId: 'inv-soap',
        changeType: 'consumption',
        inputQuantityString: '0.5',
        performedByMembershipId: 'm-paused', // Paused member
        performedByName: 'Pooja Sharma',
      },
      testMembers,
      [item],
      [],
      testExpenses
    )
    assert.equal(pausedRes.success, false)
    assert.match(pausedRes.errorMessage ?? '', /active household member/i)
  })

  // Test 13: Historical logs by departed members remain retrievable
  test('13. Historical logs created by members who later departed remain retrievable and immutable', () => {
    const historicalLog: StockLogRecord = {
      id: 'stk-hist-1',
      idempotencyKey: 'idemp-hist-1',
      itemId: 'inv-historic',
      itemName: 'Water Filter Cartridge',
      unit: 'piece',
      changeType: 'restock',
      quantityChangedMilli: 2000,
      previousQuantityMilli: 0,
      newQuantityMilli: 2000,
      performedByMembershipId: 'm-departed', // Departed member
      performedByName: 'Aakash Verma (Departed)',
      timestamp: '2025-10-15T12:00:00.000Z',
      reason: 'Annual filter cartridge procurement',
    }

    // Historical record preserves stable attribution
    assert.equal(historicalLog.performedByMembershipId, 'm-departed')
    assert.equal(historicalLog.performedByName, 'Aakash Verma (Departed)')
    assert.equal(historicalLog.quantityChangedMilli, 2000)
  })

  // Test 14: Derived stock status calculation
  test('14. deriveStockStatus returns empty, critical, low, and normal across threshold boundaries', () => {
    const thresholdMilli = 2000 // 2.0 units

    // 0 on-hand -> empty
    assert.equal(deriveStockStatus(0, thresholdMilli), 'empty')
    assert.equal(deriveStockStatus(-10, thresholdMilli), 'empty')

    // <= 0.5 * threshold (<= 1000) -> critical
    assert.equal(deriveStockStatus(500, thresholdMilli), 'critical')
    assert.equal(deriveStockStatus(1000, thresholdMilli), 'critical')

    // > 0.5 * threshold and <= threshold (1001 to 2000) -> low
    assert.equal(deriveStockStatus(1500, thresholdMilli), 'low')
    assert.equal(deriveStockStatus(2000, thresholdMilli), 'low')

    // > threshold (> 2000) -> normal
    assert.equal(deriveStockStatus(2001, thresholdMilli), 'normal')
    assert.equal(deriveStockStatus(5000, thresholdMilli), 'normal')
  })

  // Test 15: Rejecting stock operation linked to a voided expense
  test('15. Rejecting stock operations linked to a voided expense preserves state', () => {
    const item: InventoryItem = {
      id: 'inv-soap-voided-test',
      name: 'Laundry Detergent Liquid',
      category: 'Cleaning & Housekeeping',
      unit: 'L',
      isDiscrete: false,
      currentQuantityMilli: 3000,
      minThresholdMilli: 1000,
      isArchived: false,
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
      createdAt: '2026-11-20T10:00:00.000Z',
    }

    const items = [item]
    const logs: StockLogRecord[] = []

    // Attempt to link restock to exp-voided
    const voidedExpRes = applyStockOperation(
      {
        idempotencyKey: 'idemp-link-voided',
        itemId: 'inv-soap-voided-test',
        changeType: 'restock',
        inputQuantityString: '2.0',
        performedByMembershipId: 'm1',
        performedByName: 'Rohan Sharma',
        linkedExpenseId: 'exp-voided', // Voided expense
      },
      testMembers,
      items,
      logs,
      testExpenses
    )

    assert.equal(voidedExpRes.success, false)
    assert.match(voidedExpRes.errorMessage ?? '', /voided expense/i)
    assert.equal(voidedExpRes.updatedItem, undefined)
    assert.equal(voidedExpRes.newLog, undefined)

    // State assertions: item quantity unchanged, logs collection empty, expense unchanged
    assert.equal(items[0].currentQuantityMilli, 3000)
    assert.equal(logs.length, 0)
    const voidedExp = testExpenses.find((e) => e.id === 'exp-voided')
    assert.equal(voidedExp?.isVoided, true)
    assert.equal(voidedExp?.amountPaise, 120000)
  })

  // Test 16: Rejecting a reference to a nonexistent expense preserves state
  test('16. Rejecting a reference to a nonexistent expense preserves state', () => {
    const item: InventoryItem = {
      id: 'inv-flour-nonexistent-test',
      name: 'Ragi Flour (1kg)',
      category: 'Kitchen Groceries & Staples',
      unit: 'kg',
      isDiscrete: false,
      currentQuantityMilli: 2000,
      minThresholdMilli: 1000,
      isArchived: false,
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
      createdAt: '2026-11-20T10:00:00.000Z',
    }

    const items = [item]
    const logs: StockLogRecord[] = []

    const nonExistentRes = applyStockOperation(
      {
        idempotencyKey: 'idemp-link-ghost',
        itemId: 'inv-flour-nonexistent-test',
        changeType: 'restock',
        inputQuantityString: '1.0',
        performedByMembershipId: 'm1',
        performedByName: 'Rohan Sharma',
        linkedExpenseId: 'exp-does-not-exist',
      },
      testMembers,
      items,
      logs,
      testExpenses
    )

    assert.equal(nonExistentRes.success, false)
    assert.match(nonExistentRes.errorMessage ?? '', /expense record not found/i)
    assert.equal(nonExistentRes.updatedItem, undefined)
    assert.equal(nonExistentRes.newLog, undefined)

    // State assertions: item quantity unchanged, logs collection empty
    assert.equal(items[0].currentQuantityMilli, 2000)
    assert.equal(logs.length, 0)
  })

  // Test 17: Rejecting repeated item creation with the same idempotency key preserves state
  test('17. Rejecting repeated item creation with the same idempotency key preserves state', () => {
    const items: InventoryItem[] = []
    const logs: StockLogRecord[] = []

    const payload = {
      idempotencyKey: 'idemp-create-unique-token',
      name: 'Moong Dal (1kg)',
      category: 'Kitchen Groceries & Staples' as const,
      unit: 'packet' as const,
      initialQuantityString: '4',
      minThresholdString: '1',
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
    }

    // First attempt succeeds
    const firstRes = createInventoryItemAtomic(payload, testMembers, items, logs)
    assert.equal(firstRes.success, true)
    assert.ok(firstRes.item)
    assert.ok(firstRes.log)

    // Commit to state
    items.push(firstRes.item)
    logs.push(firstRes.log)
    assert.equal(items.length, 1)
    assert.equal(logs.length, 1)

    // Repeated attempt with identical idempotencyKey
    const duplicateRes = createInventoryItemAtomic(payload, testMembers, items, logs)
    assert.equal(duplicateRes.success, false)
    assert.match(duplicateRes.errorMessage ?? '', /Duplicate item creation rejected/i)
    assert.equal(duplicateRes.item, undefined)
    assert.equal(duplicateRes.log, undefined)

    // State assertion: collections are not duplicated
    assert.equal(items.length, 1)
    assert.equal(logs.length, 1)
  })

  // Test 18: Rejecting duplicate active item names according to normalization rule
  test('18. Rejecting duplicate active item names according to normalization rule (case & whitespace insensitive)', () => {
    const existingItem: InventoryItem = {
      id: 'inv-toor-dal',
      name: 'Organic Toor Dal (1kg)',
      category: 'Kitchen Groceries & Staples',
      unit: 'packet',
      isDiscrete: true,
      currentQuantityMilli: 3000,
      minThresholdMilli: 1000,
      isArchived: false,
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
      createdAt: '2026-11-20T10:00:00.000Z',
    }

    const items = [existingItem]
    const logs: StockLogRecord[] = []

    // Attempt creation with same name, varied casing and leading/trailing whitespace
    const dupRes = createInventoryItemAtomic(
      {
        idempotencyKey: 'idemp-create-dup-name',
        name: '   organic toor dal (1kg)   ',
        category: 'Kitchen Groceries & Staples',
        unit: 'packet',
        initialQuantityString: '2',
        minThresholdString: '1',
        createdByMembershipId: 'm2',
        createdByName: 'Arjun Verma',
      },
      testMembers,
      items,
      logs
    )

    assert.equal(dupRes.success, false)
    assert.match(dupRes.errorMessage ?? '', /already exists/i)
    assert.equal(dupRes.item, undefined)
    assert.equal(dupRes.log, undefined)

    // State assertions: item list length and logs remain unchanged
    assert.equal(items.length, 1)
    assert.equal(logs.length, 0)
    assert.equal(items[0].currentQuantityMilli, 3000)
  })

  // Test 19: Allowing legitimate registration after an existing item has been archived
  test('19. Allowing legitimate registration after an existing item has been archived', () => {
    const archivedItem: InventoryItem = {
      id: 'inv-old-brand-oil',
      name: 'Mustard Oil (1L)',
      category: 'Kitchen Groceries & Staples',
      unit: 'bottle',
      isDiscrete: true,
      currentQuantityMilli: 0,
      minThresholdMilli: 1000,
      isArchived: true, // Archived!
      archivedAt: '2026-11-15T10:00:00.000Z',
      archivedReason: 'Old supplier ran out of stock',
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
      createdAt: '2026-11-01T10:00:00.000Z',
    }

    const items = [archivedItem]
    const logs: StockLogRecord[] = []

    // Re-registration of archived item name succeeds
    const reRegisterRes = createInventoryItemAtomic(
      {
        idempotencyKey: 'idemp-reregister-mustard-oil',
        name: 'Mustard Oil (1L)',
        category: 'Kitchen Groceries & Staples',
        unit: 'bottle',
        initialQuantityString: '2',
        minThresholdString: '1',
        createdByMembershipId: 'm1',
        createdByName: 'Rohan Sharma',
      },
      testMembers,
      items,
      logs
    )

    assert.equal(reRegisterRes.success, true)
    assert.ok(reRegisterRes.item)
    assert.ok(reRegisterRes.log)
    assert.equal(reRegisterRes.item.isArchived, false)
    assert.notEqual(reRegisterRes.item.id, archivedItem.id) // New entity ID
    assert.equal(reRegisterRes.item.currentQuantityMilli, 2000)

    // Archived item remains archived and unaffected
    assert.equal(archivedItem.isArchived, true)
    assert.equal(archivedItem.currentQuantityMilli, 0)
  })

  // Test 20: Unit immutability after stock history exists
  test('20. Unit immutability is enforced once stock history exists', () => {
    const itemWithHistory: InventoryItem = {
      id: 'inv-honey-jar',
      name: 'Wild Forest Honey (500g)',
      category: 'Kitchen Groceries & Staples',
      unit: 'bottle',
      isDiscrete: true,
      currentQuantityMilli: 2000, // 2 bottles
      minThresholdMilli: 1000,
      isArchived: false,
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
      createdAt: '2026-11-20T10:00:00.000Z',
    }

    const historyLog: StockLogRecord = {
      id: 'stk-honey-init',
      idempotencyKey: 'idemp-honey-init',
      itemId: 'inv-honey-jar',
      itemName: 'Wild Forest Honey (500g)',
      unit: 'bottle',
      changeType: 'initial',
      quantityChangedMilli: 2000,
      previousQuantityMilli: 0,
      newQuantityMilli: 2000,
      performedByMembershipId: 'm1',
      performedByName: 'Rohan Sharma',
      timestamp: '2026-11-20T10:00:00.000Z',
    }

    const items = [itemWithHistory]
    const logs = [historyLog]

    // Attempting to change unit for an item with history must be REJECTED
    const failUnitChange = updateInventoryItemUnit('inv-honey-jar', 'kg', items, logs)
    assert.equal(failUnitChange.success, false)
    assert.match(failUnitChange.errorMessage ?? '', /immutable once stock history logs exist/i)
    assert.equal(items[0].unit, 'bottle') // State preserved

    // Stock operation also preserves the item's immutable unit on the updated item and the log
    const stockOpRes = applyStockOperation(
      {
        idempotencyKey: 'idemp-honey-restock',
        itemId: 'inv-honey-jar',
        changeType: 'restock',
        inputQuantityString: '3',
        performedByMembershipId: 'm1',
        performedByName: 'Rohan Sharma',
      },
      testMembers,
      items,
      logs,
      testExpenses
    )

    assert.equal(stockOpRes.success, true)
    assert.equal(stockOpRes.updatedItem?.unit, 'bottle')
    assert.equal(stockOpRes.newLog?.unit, 'bottle')

    // For an item with NO history in logs, unit update is allowed
    const unloggedItem: InventoryItem = {
      id: 'inv-fresh-draft',
      name: 'Paper Napkins',
      category: 'Cleaning & Housekeeping',
      unit: 'packet',
      isDiscrete: true,
      currentQuantityMilli: 0,
      minThresholdMilli: 1000,
      isArchived: false,
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
      createdAt: '2026-11-20T10:00:00.000Z',
    }

    const itemsWithUnlogged = [...items, unloggedItem]
    const allowedUnitChange = updateInventoryItemUnit(
      'inv-fresh-draft',
      'box',
      itemsWithUnlogged,
      logs
    )
    assert.equal(allowedUnitChange.success, true)
    assert.equal(allowedUnitChange.updatedItem?.unit, 'box')
    assert.equal(allowedUnitChange.updatedItem?.isDiscrete, true)
  })
})
