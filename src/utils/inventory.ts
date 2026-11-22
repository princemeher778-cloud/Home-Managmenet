import type {
  ContinuousUnit,
  CreateInventoryItemPayload,
  DiscreteUnit,
  ExpenseItem,
  HouseholdMember,
  InventoryCategory,
  InventoryItem,
  InventoryUnit,
  StockActionPayload,
  StockLogRecord,
  StockStatusLevel,
} from '../types/index.ts'
import { generateEntityId } from './financial.ts'

export const INVENTORY_CATEGORIES: readonly InventoryCategory[] = [
  'Kitchen Groceries & Staples',
  'Fresh Food & Dairy',
  'Drinking Water',
  'Cleaning & Housekeeping',
  'Bathroom & Toiletries',
  'Waste Management',
  'Maintenance & Hardware',
  'Other Consumables',
] as const

export const DISCRETE_UNITS: readonly DiscreteUnit[] = [
  'packet',
  'piece',
  'bottle',
  'can',
  'box',
  'roll',
] as const

export const CONTINUOUS_UNITS: readonly ContinuousUnit[] = [
  'kg',
  'g',
  'L',
  'mL',
] as const

/**
 * Returns true if the unit represents discrete indivisible counts (e.g. bottles, packets).
 */
export function isDiscreteUnit(unit: InventoryUnit): boolean {
  return (DISCRETE_UNITS as readonly string[]).includes(unit)
}

/**
 * Parses and validates raw quantity input strings without silent rounding or premature float conversion.
 * 
 * Rules:
 * - Discrete units: Whole numbers only (/^(0|[1-9]\d*)$/). Rejects decimal points.
 * - Continuous units: At most 3 decimal places (/^(0|[1-9]\d*)(\.\d{1,3})?$/). Rejects excess precision.
 * - Returns scaled integer milli-units (1 unit = 1000 milli-units).
 */
export function parseQuantityInput(
  rawInput: string,
  isDiscrete: boolean
): { isValid: boolean; milliUnits?: number; errorMessage?: string } {
  const trimmed = rawInput.trim()

  if (trimmed === '') {
    return { isValid: false, errorMessage: 'Quantity is required.' }
  }

  if (isDiscrete) {
    // Discrete unit: whole integer only
    const discreteRegex = /^(0|[1-9]\d*)$/
    if (!discreteRegex.test(trimmed)) {
      return {
        isValid: false,
        errorMessage: 'Discrete items accept whole numbers only (decimal places are not permitted).',
      }
    }
    const wholeVal = parseInt(trimmed, 10)
    return { isValid: true, milliUnits: wholeVal * 1000 }
  }

  // Continuous unit: accepts up to 3 decimal places
  const continuousRegex = /^(0|[1-9]\d*)(\.\d{1,3})?$/
  if (!continuousRegex.test(trimmed)) {
    // Check if it failed due to excessive decimals
    if (/^\d+\.\d{4,}$/.test(trimmed)) {
      return {
        isValid: false,
        errorMessage: 'Precision is limited to at most 3 decimal places (0.001 of a unit). Excessive precision is not permitted.',
      }
    }
    return {
      isValid: false,
      errorMessage: 'Quantity must be a valid non-negative number with at most 3 decimal places.',
    }
  }

  const floatVal = parseFloat(trimmed)
  if (isNaN(floatVal) || floatVal < 0) {
    return { isValid: false, errorMessage: 'Quantity must be a valid positive number.' }
  }

  return { isValid: true, milliUnits: Math.round(floatVal * 1000) }
}

/**
 * Converts integer milli-units back to clean readable display strings.
 */
export function milliToDisplay(milliUnits: number, isDiscrete: boolean): string {
  if (isDiscrete) {
    return Math.round(milliUnits / 1000).toString()
  }
  const floatVal = milliUnits / 1000
  if (Number.isInteger(floatVal)) {
    return floatVal.toString()
  }
  return floatVal.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })
}

/**
 * Formats integer milli-units with unit label (e.g. "1.25 kg" or "3 packets").
 */
export function formatInventoryQuantity(milliUnits: number, unit: InventoryUnit): string {
  const isDisc = isDiscreteUnit(unit)
  const qtyStr = milliToDisplay(milliUnits, isDisc)
  return `${qtyStr} ${unit}${isDisc && milliUnits !== 1000 && !unit.endsWith('s') ? 's' : ''}`
}

/**
 * Pure derived status level function used uniformly by Dashboard and Inventory modules.
 */
export function deriveStockStatus(
  currentQuantityMilli: number,
  minThresholdMilli: number
): StockStatusLevel {
  if (currentQuantityMilli <= 0) {
    return 'empty'
  }
  if (minThresholdMilli > 0 && currentQuantityMilli <= minThresholdMilli * 0.5) {
    return 'critical'
  }
  if (currentQuantityMilli <= minThresholdMilli) {
    return 'low'
  }
  return 'normal'
}

/**
 * Formats ISO 8601 timestamps into human-readable display strings.
 */
export function formatInventoryTimestamp(isoString: string): string {
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return isoString
    return d.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return isoString
  }
}

/**
 * Atomic creation of a new inventory item and its required single 'initial' stock log.
 * Both records are created together or neither is committed.
 * Validates against duplicate active item names and verifies creation idempotency.
 */
export function createInventoryItemAtomic(
  payload: CreateInventoryItemPayload,
  members: HouseholdMember[],
  items: InventoryItem[],
  logs: StockLogRecord[]
): { success: boolean; item?: InventoryItem; log?: StockLogRecord; errorMessage?: string } {
  // 1. Duplicate creation protection via idempotency key in logs
  if (logs.some((l) => l.idempotencyKey === payload.idempotencyKey)) {
    return {
      success: false,
      errorMessage: 'Duplicate item creation rejected: this operation has already been processed.',
    }
  }

  // 2. Name validation & active duplicate check
  const nameTrimmed = payload.name.trim()
  if (nameTrimmed.length < 2) {
    return { success: false, errorMessage: 'Item name must be at least 2 characters long.' }
  }

  const normalizedName = nameTrimmed.toLowerCase()
  const duplicateActive = items.find(
    (i) => !i.isArchived && i.name.trim().toLowerCase() === normalizedName
  )
  if (duplicateActive) {
    return {
      success: false,
      errorMessage: `An active inventory item with the name "${duplicateActive.name}" already exists. Re-registration is only allowed if the previous item was archived.`,
    }
  }

  // 3. Active member attribution
  const activeMember = members.find(
    (m) => m.id === payload.createdByMembershipId && m.status === 'active'
  )
  if (!activeMember) {
    return { success: false, errorMessage: 'Item creation requires an active household member.' }
  }

  const isDiscrete = isDiscreteUnit(payload.unit)

  // 4. Initial quantity parsing & validation
  const initialQtyRes = parseQuantityInput(payload.initialQuantityString, isDiscrete)
  if (!initialQtyRes.isValid || initialQtyRes.milliUnits === undefined) {
    return {
      success: false,
      errorMessage: `Invalid initial quantity: ${initialQtyRes.errorMessage}`,
    }
  }

  // 5. Min threshold parsing & validation
  const thresholdRes = parseQuantityInput(payload.minThresholdString, isDiscrete)
  if (!thresholdRes.isValid || thresholdRes.milliUnits === undefined) {
    return {
      success: false,
      errorMessage: `Invalid minimum threshold: ${thresholdRes.errorMessage}`,
    }
  }

  let idealMilli: number | undefined
  if (payload.idealQuantityString && payload.idealQuantityString.trim() !== '') {
    const idealRes = parseQuantityInput(payload.idealQuantityString, isDiscrete)
    if (!idealRes.isValid || idealRes.milliUnits === undefined) {
      return {
        success: false,
        errorMessage: `Invalid ideal quantity: ${idealRes.errorMessage}`,
      }
    }
    idealMilli = idealRes.milliUnits
  }

  const nowIso = new Date().toISOString()
  const itemId = generateEntityId('inv')
  const initialMilli = initialQtyRes.milliUnits

  const newItem: InventoryItem = {
    id: itemId,
    name: nameTrimmed,
    category: payload.category,
    unit: payload.unit,
    isDiscrete,
    currentQuantityMilli: initialMilli,
    minThresholdMilli: thresholdRes.milliUnits,
    idealQuantityMilli: idealMilli,
    storageLocation: payload.storageLocation?.trim() || undefined,
    notes: payload.notes?.trim() || undefined,
    isArchived: false,
    createdByMembershipId: payload.createdByMembershipId,
    createdByName: activeMember.name,
    createdAt: nowIso,
    lastRestockedAt: initialMilli > 0 ? nowIso : undefined,
  }

  // Exactly one initial log record is created, even for zero initial quantity
  const initialLog: StockLogRecord = {
    id: generateEntityId('stk'),
    idempotencyKey: payload.idempotencyKey,
    itemId,
    itemName: newItem.name,
    unit: newItem.unit,
    changeType: 'initial',
    quantityChangedMilli: initialMilli,
    previousQuantityMilli: 0,
    newQuantityMilli: initialMilli,
    performedByMembershipId: payload.createdByMembershipId,
    performedByName: activeMember.name,
    timestamp: nowIso,
    reason: initialMilli > 0 ? 'Initial catalog stock entry' : 'Initial registration with zero stock',
  }

  return { success: true, item: newItem, log: initialLog }
}

/**
 * Atomic execution of restock, consumption, correction, and waste operations.
 * Validates active member, checks duplicate idempotencyKey against the authoritative log collection,
 * prevents negative quantities, and commits atomically.
 */
export function applyStockOperation(
  payload: StockActionPayload,
  members: HouseholdMember[],
  items: InventoryItem[],
  logs: StockLogRecord[],
  expenses: ExpenseItem[]
): { success: boolean; updatedItem?: InventoryItem; newLog?: StockLogRecord; errorMessage?: string } {
  // 1. Authoritative Duplicate Check
  if (logs.some((l) => l.idempotencyKey === payload.idempotencyKey)) {
    return {
      success: false,
      errorMessage: 'Duplicate stock action rejected: this operation has already been processed.',
    }
  }

  // 2. Active member attribution
  const activeMember = members.find(
    (m) => m.id === payload.performedByMembershipId && m.status === 'active'
  )
  if (!activeMember) {
    return { success: false, errorMessage: 'Stock operations require an active household member.' }
  }

  // 3. Target Item Existence & Archive Guard
  const item = items.find((i) => i.id === payload.itemId)
  if (!item) {
    return { success: false, errorMessage: 'Target inventory item not found.' }
  }

  if (item.isArchived) {
    return {
      success: false,
      errorMessage: `Item "${item.name}" is archived. Cannot perform stock operations on archived items.`,
    }
  }

  // 4. Quantity Precision Parsing
  const qtyRes = parseQuantityInput(payload.inputQuantityString, item.isDiscrete)
  if (!qtyRes.isValid || qtyRes.milliUnits === undefined) {
    return { success: false, errorMessage: qtyRes.errorMessage ?? 'Invalid quantity.' }
  }

  const deltaMilli = qtyRes.milliUnits
  const prevMilli = item.currentQuantityMilli
  let newMilli = prevMilli
  let logDeltaMilli = 0

  // 5. Operation Specific Invariants
  switch (payload.changeType) {
    case 'restock':
      if (deltaMilli <= 0) {
        return { success: false, errorMessage: 'Restock quantity must be greater than zero.' }
      }
      logDeltaMilli = deltaMilli
      newMilli = prevMilli + deltaMilli
      break

    case 'consumption':
      if (deltaMilli <= 0) {
        return { success: false, errorMessage: 'Consumption quantity must be greater than zero.' }
      }
      if (deltaMilli > prevMilli) {
        const availDisplay = formatInventoryQuantity(prevMilli, item.unit)
        const reqDisplay = formatInventoryQuantity(deltaMilli, item.unit)
        return {
          success: false,
          errorMessage: `Cannot consume ${reqDisplay}. Only ${availDisplay} currently available in stock.`,
        }
      }
      logDeltaMilli = -deltaMilli
      newMilli = prevMilli - deltaMilli
      break

    case 'waste':
      if (deltaMilli <= 0) {
        return { success: false, errorMessage: 'Discarded waste quantity must be greater than zero.' }
      }
      if (deltaMilli > prevMilli) {
        const availDisplay = formatInventoryQuantity(prevMilli, item.unit)
        return {
          success: false,
          errorMessage: `Cannot write off more than on-hand stock (${availDisplay}).`,
        }
      }
      if (!payload.reason || payload.reason.trim().length < 4) {
        return {
          success: false,
          errorMessage: 'A mandatory reason (minimum 4 characters) is required for waste write-offs.',
        }
      }
      logDeltaMilli = -deltaMilli
      newMilli = prevMilli - deltaMilli
      break

    case 'correction':
      // For correction, input quantity is the new physical audited count
      if (!payload.reason || payload.reason.trim().length < 4) {
        return {
          success: false,
          errorMessage: 'A mandatory reason (minimum 4 characters) is required for inventory physical count audits.',
        }
      }
      newMilli = deltaMilli
      logDeltaMilli = newMilli - prevMilli
      break

    default:
      return { success: false, errorMessage: `Unsupported stock action type: ${payload.changeType}` }
  }

  // 6. Strict Negative Floor
  if (newMilli < 0) {
    return { success: false, errorMessage: 'Operation rejected: inventory quantity cannot fall below zero.' }
  }

  // 7. Referential Expense Link Validation
  if (payload.linkedExpenseId) {
    const expense = expenses.find((e) => e.id === payload.linkedExpenseId)
    if (!expense) {
      return { success: false, errorMessage: 'Referenced expense record not found.' }
    }
    if (expense.isVoided) {
      return {
        success: false,
        errorMessage: 'Cannot link stock operation to a voided expense record.',
      }
    }
    // Expense linkage is strictly referential; zero financial mutation occurs
  }

  const nowIso = new Date().toISOString()

  // 8. Construct New Authoritative Log Record
  const newLog: StockLogRecord = {
    id: generateEntityId('stk'),
    idempotencyKey: payload.idempotencyKey,
    itemId: item.id,
    itemName: item.name,
    unit: item.unit,
    changeType: payload.changeType,
    quantityChangedMilli: logDeltaMilli,
    previousQuantityMilli: prevMilli,
    newQuantityMilli: newMilli,
    performedByMembershipId: payload.performedByMembershipId,
    performedByName: activeMember.name,
    timestamp: nowIso,
    reason: payload.reason?.trim() || undefined,
    linkedExpenseId: payload.linkedExpenseId,
  }

  // 9. Construct Updated Item Record
  const updatedItem: InventoryItem = {
    ...item,
    currentQuantityMilli: newMilli,
    lastRestockedAt: payload.changeType === 'restock' ? nowIso : item.lastRestockedAt,
    lastConsumedAt:
      payload.changeType === 'consumption' || payload.changeType === 'waste'
        ? nowIso
        : item.lastConsumedAt,
    lastAuditedAt: payload.changeType === 'correction' ? nowIso : item.lastAuditedAt,
  }

  return { success: true, updatedItem, newLog }
}

/**
 * Safely archives an inventory item.
 * If the item has remaining stock, requires confirmWithStock: true and a mandatory reason >= 4 chars.
 * Preserves the remaining quantity and historical logs.
 */
export function archiveInventoryItem(
  itemId: string,
  memberId: string,
  reason: string | undefined,
  confirmWithStock: boolean,
  members: HouseholdMember[],
  items: InventoryItem[]
): { success: boolean; updatedItem?: InventoryItem; errorMessage?: string } {
  const activeMember = members.find((m) => m.id === memberId && m.status === 'active')
  if (!activeMember) {
    return { success: false, errorMessage: 'Archiving requires an active household member.' }
  }

  const item = items.find((i) => i.id === itemId)
  if (!item) {
    return { success: false, errorMessage: 'Inventory item not found.' }
  }

  if (item.isArchived) {
    return { success: false, errorMessage: 'Item is already archived.' }
  }

  // Safeguard: remaining stock check
  if (item.currentQuantityMilli > 0) {
    if (!confirmWithStock) {
      return {
        success: false,
        errorMessage: `Item has ${formatInventoryQuantity(item.currentQuantityMilli, item.unit)} on hand. Explicit confirmation is required to archive items with remaining stock.`,
      }
    }
    if (!reason || reason.trim().length < 4) {
      return {
        success: false,
        errorMessage: 'A mandatory reason (minimum 4 characters) is required to archive an item with remaining stock.',
      }
    }
  }

  const nowIso = new Date().toISOString()
  const updatedItem: InventoryItem = {
    ...item,
    isArchived: true,
    archivedAt: nowIso,
    archivedByMembershipId: memberId,
    archivedByName: activeMember.name,
    archivedReason: reason?.trim() || undefined,
  }

  return { success: true, updatedItem }
}

/**
 * Validates unit immutability.
 * An item's unit cannot be modified once stock history logs exist for that item.
 */
export function updateInventoryItemUnit(
  itemId: string,
  newUnit: InventoryUnit,
  items: InventoryItem[],
  logs: StockLogRecord[]
): { success: boolean; updatedItem?: InventoryItem; errorMessage?: string } {
  const item = items.find((i) => i.id === itemId)
  if (!item) {
    return { success: false, errorMessage: 'Inventory item not found.' }
  }

  if (item.unit === newUnit) {
    return { success: true, updatedItem: item }
  }

  const hasHistory = logs.some((l) => l.itemId === itemId)
  if (hasHistory) {
    return {
      success: false,
      errorMessage: `Cannot change unit of measurement for "${item.name}". Unit is immutable once stock history logs exist.`,
    }
  }

  const updatedItem: InventoryItem = {
    ...item,
    unit: newUnit,
    isDiscrete: isDiscreteUnit(newUnit),
  }

  return { success: true, updatedItem }
}
