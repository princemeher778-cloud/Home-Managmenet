import type {
  CleaningActivityEvent,
  CleaningDutyAssignment,
  CleaningTaskTemplate,
  CleaningValidationResult,
  DerivedDutyStatus,
  FairnessScoreSummary,
  HouseholdMember,
  MemberWorkloadShare,
  NthWeekdayOccurrence,
  RecurrencePattern,
  StandardCleaningArea,
  WeekdayIndex,
} from '../types/index.ts'
import { generateEntityId } from './financial.ts'

export const STANDARD_CLEANING_AREAS: readonly StandardCleaningArea[] = [
  'Kitchen',
  'Living Room & Dining',
  'Bathrooms',
  'Balcony & Utility',
  'Bedrooms',
  'Entrance & Passages',
  'Custom Area',
] as const

/* ==========================================================================
   1. Date and Weekday Utilities (Strict Calendar Component Validation)
   ========================================================================== */

/**
 * Returns true if the specified 4-digit Gregorian year is a leap year.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * Returns the exact number of calendar days in the given month (1..12).
 */
export function getDaysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31
    case 4:
    case 6:
    case 9:
    case 11:
      return 30
    case 2:
      return isLeapYear(year) ? 29 : 28
    default:
      return 0
  }
}

/**
 * Validates calendar date strictly without silent JavaScript Date rollover.
 * Rejects:
 * - Malformed strings (must be exact YYYY-MM-DD).
 * - Years outside 2000..2100.
 * - Months outside 1..12 (e.g. 2026-13-01, 2026-00-10).
 * - Days outside 1..getDaysInMonth(year, month) (e.g. 2026-02-31, 2025-02-29).
 */
export function isValidCalendarDate(dateStr: string): boolean {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false
  }

  const parts = dateStr.split('-')
  const year = parseInt(parts[0], 10)
  const month = parseInt(parts[1], 10)
  const day = parseInt(parts[2], 10)

  if (isNaN(year) || year < 2000 || year > 2100) return false
  if (isNaN(month) || month < 1 || month > 12) return false

  const maxDays = getDaysInMonth(year, month)
  return !isNaN(day) && day >= 1 && day <= maxDays
}

/**
 * Parses a valid calendar date string into year, month, and day integers.
 */
export function parseDateComponents(dateStr: string): {
  year: number
  month: number
  day: number
} {
  if (!isValidCalendarDate(dateStr)) {
    throw new Error(`Invalid calendar date string: "${dateStr}". Must be YYYY-MM-DD within 2000-2100.`)
  }
  const parts = dateStr.split('-')
  return {
    year: parseInt(parts[0], 10),
    month: parseInt(parts[1], 10),
    day: parseInt(parts[2], 10),
  }
}

/**
 * Formats year, month, and day into a zero-padded calendar date string (YYYY-MM-DD).
 */
export function formatDateComponents(year: number, month: number, day: number): string {
  const yStr = year.toString().padStart(4, '0')
  const mStr = month.toString().padStart(2, '0')
  const dStr = day.toString().padStart(2, '0')
  return `${yStr}-${mStr}-${dStr}`
}

/**
 * Returns today's calendar date in YYYY-MM-DD format based on local calendar components.
 * Derives year, month, and day from local time rather than toISOString() to avoid UTC midnight shifting.
 */
export function getTodayCalendarDate(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const day = now.getDate()
  return formatDateComponents(year, month, day)
}

/**
 * Converts a valid calendar date string to its ISO weekday (Monday = 1 ... Sunday = 7).
 * Rejects invalid dates upfront without silent normalization.
 */
export function getCalendarWeekday(dateStr: string): WeekdayIndex {
  const { year, month, day } = parseDateComponents(dateStr)
  // Use UTC midnight to calculate deterministic day of week without timezone drift
  const utcDate = new Date(Date.UTC(year, month - 1, day))
  const jsDay = utcDate.getUTCDay() // 0 = Sun, 1 = Mon, ..., 6 = Sat
  return (jsDay === 0 ? 7 : jsDay) as WeekdayIndex
}

/**
 * Adds or subtracts integer calendar days without local timezone shifting.
 */
export function addDaysToDate(dateStr: string, days: number): string {
  const { year, month, day } = parseDateComponents(dateStr)
  const utcDate = new Date(Date.UTC(year, month - 1, day + days))
  return formatDateComponents(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth() + 1,
    utcDate.getUTCDate()
  )
}

/**
 * Calculates calendar days between two valid dates (to - from).
 */
export function daysBetween(fromStr: string, toStr: string): number {
  const from = parseDateComponents(fromStr)
  const to = parseDateComponents(toStr)
  const fromUtc = Date.UTC(from.year, from.month - 1, from.day)
  const toUtc = Date.UTC(to.year, to.month - 1, to.day)
  const diffMs = toUtc - fromUtc
  return Math.round(diffMs / (1000 * 60 * 60 * 24))
}

/**
 * Returns the calendar date of the Monday of the week containing dateStr.
 * Week runs from Monday (1) to Sunday (7).
 */
export function getMondayOfWeek(dateStr: string): string {
  const weekday = getCalendarWeekday(dateStr)
  return addDaysToDate(dateStr, -(weekday - 1))
}

/* ==========================================================================
   2. Recurrence Engine & Validation Invariants
   ========================================================================== */

/**
 * Validates any RecurrencePattern against strict structural and boundary invariants.
 */
export function validateRecurrencePattern(pattern: RecurrencePattern): CleaningValidationResult {
  if (!pattern || typeof pattern !== 'object') {
    return { isValid: false, errorMessage: 'Recurrence pattern configuration is required.' }
  }

  // 1. Start date check
  if (!isValidCalendarDate(pattern.startDate)) {
    return {
      isValid: false,
      errorMessage: `Start date "${pattern.startDate}" is not a valid calendar date in YYYY-MM-DD format.`,
    }
  }

  // 2. End date check
  if (pattern.endDate !== undefined) {
    if (!isValidCalendarDate(pattern.endDate)) {
      return {
        isValid: false,
        errorMessage: `End date "${pattern.endDate}" is not a valid calendar date in YYYY-MM-DD format.`,
      }
    }
    if (pattern.endDate < pattern.startDate) {
      return { isValid: false, errorMessage: 'End date cannot be earlier than start date.' }
    }
  }

  // 3. Max occurrences check
  if (pattern.maxOccurrences !== undefined) {
    if (!Number.isInteger(pattern.maxOccurrences) || pattern.maxOccurrences < 1) {
      return {
        isValid: false,
        errorMessage: 'Maximum occurrences must be an integer greater than or equal to 1.',
      }
    }
  }

  // 4. Type-specific checks
  switch (pattern.type) {
    case 'one_off': {
      if (!isValidCalendarDate(pattern.targetDate)) {
        return {
          isValid: false,
          errorMessage: `Target date "${pattern.targetDate}" is not a valid calendar date in YYYY-MM-DD format.`,
        }
      }
      if (pattern.targetDate < pattern.startDate) {
        return { isValid: false, errorMessage: 'One-off target date cannot be earlier than start date.' }
      }
      if (pattern.endDate && pattern.targetDate > pattern.endDate) {
        return { isValid: false, errorMessage: 'One-off target date cannot be later than end date.' }
      }
      break
    }

    case 'interval_days': {
      if (!Number.isInteger(pattern.intervalDays) || pattern.intervalDays < 1) {
        return {
          isValid: false,
          errorMessage: 'Day interval must be an integer greater than or equal to 1.',
        }
      }
      break
    }

    case 'weekly_weekdays': {
      if (!Number.isInteger(pattern.weekInterval) || pattern.weekInterval < 1) {
        return {
          isValid: false,
          errorMessage: 'Week interval must be an integer greater than or equal to 1.',
        }
      }
      if (!Array.isArray(pattern.selectedWeekdays) || pattern.selectedWeekdays.length === 0) {
        return {
          isValid: false,
          errorMessage: 'At least one weekday must be selected for weekly schedules.',
        }
      }
      const uniqueWeekdays = new Set(pattern.selectedWeekdays)
      if (uniqueWeekdays.size !== pattern.selectedWeekdays.length) {
        return { isValid: false, errorMessage: 'Selected weekdays must not contain duplicate days.' }
      }
      for (const wd of pattern.selectedWeekdays) {
        if (!Number.isInteger(wd) || wd < 1 || wd > 7) {
          return {
            isValid: false,
            errorMessage: 'Weekdays must be integers between 1 (Monday) and 7 (Sunday).',
          }
        }
      }
      break
    }

    case 'monthly_dates': {
      if (
        pattern.monthInterval !== undefined &&
        (!Number.isInteger(pattern.monthInterval) || pattern.monthInterval < 1)
      ) {
        return {
          isValid: false,
          errorMessage: 'Month interval must be an integer greater than or equal to 1.',
        }
      }
      if (!Array.isArray(pattern.monthDays) || pattern.monthDays.length === 0) {
        return {
          isValid: false,
          errorMessage: 'At least one calendar day must be selected for monthly date schedules.',
        }
      }
      const uniqueDays = new Set(pattern.monthDays)
      if (uniqueDays.size !== pattern.monthDays.length) {
        return { isValid: false, errorMessage: 'Configured month days must not contain duplicates.' }
      }
      for (const d of pattern.monthDays) {
        if (!Number.isInteger(d) || d < 1 || d > 31) {
          return {
            isValid: false,
            errorMessage: 'Configured month days must be integers between 1 and 31.',
          }
        }
      }
      if (
        pattern.handleShorterMonths !== 'clamp_to_last_day' &&
        pattern.handleShorterMonths !== 'skip'
      ) {
        return {
          isValid: false,
          errorMessage: 'Policy for shorter months must be either "clamp_to_last_day" or "skip".',
        }
      }
      break
    }

    case 'monthly_nth_weekday': {
      if (
        pattern.monthInterval !== undefined &&
        (!Number.isInteger(pattern.monthInterval) || pattern.monthInterval < 1)
      ) {
        return {
          isValid: false,
          errorMessage: 'Month interval must be an integer greater than or equal to 1.',
        }
      }
      const validNths: NthWeekdayOccurrence[] = ['first', 'second', 'third', 'fourth', 'last']
      if (!validNths.includes(pattern.nthOccurrence)) {
        return {
          isValid: false,
          errorMessage: 'Invalid nth-occurrence selector for monthly weekday schedule.',
        }
      }
      if (!Number.isInteger(pattern.weekday) || pattern.weekday < 1 || pattern.weekday > 7) {
        return {
          isValid: false,
          errorMessage: 'Weekday must be an integer between 1 (Monday) and 7 (Sunday).',
        }
      }
      break
    }

    case 'custom_dates': {
      if (!Array.isArray(pattern.explicitDates) || pattern.explicitDates.length === 0) {
        return {
          isValid: false,
          errorMessage: 'At least one explicit date must be specified for custom date schedules.',
        }
      }
      const uniqueDates = new Set(pattern.explicitDates)
      if (uniqueDates.size !== pattern.explicitDates.length) {
        return { isValid: false, errorMessage: 'Custom dates list must not contain duplicate dates.' }
      }
      for (const d of pattern.explicitDates) {
        if (!isValidCalendarDate(d)) {
          return {
            isValid: false,
            errorMessage: `Invalid calendar date in custom dates: "${d}". Must be YYYY-MM-DD.`,
          }
        }
        if (d < pattern.startDate) {
          return {
            isValid: false,
            errorMessage: `Custom date "${d}" cannot be earlier than start date.`,
          }
        }
        if (pattern.endDate && d > pattern.endDate) {
          return {
            isValid: false,
            errorMessage: `Custom date "${d}" cannot be later than end date.`,
          }
        }
      }
      break
    }

    default:
      return { isValid: false, errorMessage: `Unsupported recurrence type: ${(pattern as { type: string }).type}` }
  }

  return { isValid: true }
}

/**
 * Normalizes a RecurrencePattern into a canonical serialized string.
 * Semantically identical patterns with different array ordering or property ordering
 * will produce identical strings, avoiding false scheduleVersion increments.
 */
export function normalizeRecurrenceConfig(pattern: RecurrencePattern): string {
  const base = {
    type: pattern.type,
    startDate: pattern.startDate,
    endDate: pattern.endDate ?? null,
    maxOccurrences: pattern.maxOccurrences ?? null,
  }

  switch (pattern.type) {
    case 'one_off':
      return JSON.stringify({ ...base, targetDate: pattern.targetDate })
    case 'interval_days':
      return JSON.stringify({ ...base, intervalDays: pattern.intervalDays })
    case 'weekly_weekdays':
      return JSON.stringify({
        ...base,
        weekInterval: pattern.weekInterval,
        selectedWeekdays: [...pattern.selectedWeekdays].sort((a, b) => a - b),
      })
    case 'monthly_dates':
      return JSON.stringify({
        ...base,
        monthInterval: pattern.monthInterval ?? 1,
        monthDays: [...pattern.monthDays].sort((a, b) => a - b),
        handleShorterMonths: pattern.handleShorterMonths,
      })
    case 'monthly_nth_weekday':
      return JSON.stringify({
        ...base,
        monthInterval: pattern.monthInterval ?? 1,
        nthOccurrence: pattern.nthOccurrence,
        weekday: pattern.weekday,
      })
    case 'custom_dates':
      return JSON.stringify({
        ...base,
        explicitDates: [...pattern.explicitDates].sort(),
      })
  }
}

/**
 * Compares two RecurrencePatterns for semantic equality.
 */
export function isSameRecurrenceConfig(a: RecurrencePattern, b: RecurrencePattern): boolean {
  return normalizeRecurrenceConfig(a) === normalizeRecurrenceConfig(b)
}

/* ==========================================================================
   3. Recurrence Occurrence Generation (Deterministic Look-Ahead Engine)
   ========================================================================== */

/**
 * Resolves the N-th weekday (or last weekday) in a given year and month.
 * Returns the calendar date string (YYYY-MM-DD), or undefined if not found.
 */
export function resolveNthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: WeekdayIndex,
  nthOccurrence: NthWeekdayOccurrence
): string | undefined {
  const maxDays = getDaysInMonth(year, month)
  const matches: string[] = []

  for (let d = 1; d <= maxDays; d++) {
    const dateStr = formatDateComponents(year, month, d)
    if (getCalendarWeekday(dateStr) === weekday) {
      matches.push(dateStr)
    }
  }

  if (matches.length === 0) return undefined

  switch (nthOccurrence) {
    case 'first':
      return matches[0]
    case 'second':
      return matches.length >= 2 ? matches[1] : undefined
    case 'third':
      return matches.length >= 3 ? matches[2] : undefined
    case 'fourth':
      return matches.length >= 4 ? matches[3] : undefined
    case 'last':
      return matches[matches.length - 1]
  }
}

/**
 * Calculates candidate occurrence dates for a pattern within a look-ahead window [windowStart, windowEnd].
 * Guarantees:
 * - Deterministic output.
 * - Monday-anchored weekly recurrence (Calendar week containing startDate is Week 0).
 * - Deduplicates clamped dates in shorter months (e.g. [30, 31] in Feb -> one Feb 28 duty).
 * - Skips missed historical dates prior to max(windowStart, startDate); no phantom duties.
 * - Stops once total scheduled unique dates reaches maxOccurrences.
 * - Never returns dates already in existingDueDatesForTemplate.
 */
export function generateCandidateOccurrenceDates(
  pattern: RecurrencePattern,
  windowStart: string,
  windowEnd: string,
  existingDueDatesForTemplate: Set<string>
): string[] {
  const validation = validateRecurrencePattern(pattern)
  if (!validation.isValid) {
    throw new Error(validation.errorMessage ?? 'Invalid recurrence pattern.')
  }

  const effectiveStart = windowStart > pattern.startDate ? windowStart : pattern.startDate
  const effectiveEnd =
    pattern.endDate && pattern.endDate < windowEnd ? pattern.endDate : windowEnd

  if (effectiveStart > effectiveEnd) {
    return []
  }

  // Lifetime occurrence cap check
  const totalConsumed = existingDueDatesForTemplate.size
  if (pattern.maxOccurrences !== undefined && totalConsumed >= pattern.maxOccurrences) {
    return []
  }

  const remainingBudget =
    pattern.maxOccurrences !== undefined ? pattern.maxOccurrences - totalConsumed : Infinity

  const scheduledDates: string[] = []

  const tryAddDate = (dateStr: string): boolean => {
    if (scheduledDates.length >= remainingBudget) return false
    if (dateStr >= effectiveStart && dateStr <= effectiveEnd) {
      if (!existingDueDatesForTemplate.has(dateStr) && !scheduledDates.includes(dateStr)) {
        scheduledDates.push(dateStr)
      }
    }
    return scheduledDates.length < remainingBudget
  }

  switch (pattern.type) {
    case 'one_off': {
      tryAddDate(pattern.targetDate)
      break
    }

    case 'interval_days': {
      // Step from startDate by intervalDays until past effectiveEnd
      let curr = pattern.startDate
      while (curr <= effectiveEnd) {
        if (curr >= effectiveStart) {
          const keepGoing = tryAddDate(curr)
          if (!keepGoing) break
        }
        curr = addDaysToDate(curr, pattern.intervalDays)
      }
      break
    }

    case 'weekly_weekdays': {
      // Week Zero is the calendar week (Mon-Sun) containing startDate
      const weekZeroMonday = getMondayOfWeek(pattern.startDate)
      let currDate = effectiveStart

      while (currDate <= effectiveEnd) {
        if (currDate >= pattern.startDate) {
          const currMonday = getMondayOfWeek(currDate)
          const daysFromWeekZero = daysBetween(weekZeroMonday, currMonday)
          const elapsedWeeks = Math.floor(daysFromWeekZero / 7)

          if (elapsedWeeks >= 0 && elapsedWeeks % pattern.weekInterval === 0) {
            const weekday = getCalendarWeekday(currDate)
            if (pattern.selectedWeekdays.includes(weekday)) {
              const keepGoing = tryAddDate(currDate)
              if (!keepGoing) break
            }
          }
        }
        currDate = addDaysToDate(currDate, 1)
      }
      break
    }

    case 'monthly_dates': {
      const startComp = parseDateComponents(effectiveStart)
      const endComp = parseDateComponents(effectiveEnd)
      const monthInterval = pattern.monthInterval ?? 1

      // Start from startComp.year, startComp.month
      let y = startComp.year
      let m = startComp.month

      while (y < endComp.year || (y === endComp.year && m <= endComp.month)) {
        // Calculate months elapsed from pattern.startDate
        const patternStartComp = parseDateComponents(pattern.startDate)
        const totalMonthsElapsed = (y - patternStartComp.year) * 12 + (m - patternStartComp.month)

        if (totalMonthsElapsed >= 0 && totalMonthsElapsed % monthInterval === 0) {
          const daysInMonth = getDaysInMonth(y, m)
          const resolvedDaysInMonth = new Set<string>()

          for (const targetDay of pattern.monthDays) {
            let actualDay = targetDay
            if (targetDay > daysInMonth) {
              if (pattern.handleShorterMonths === 'clamp_to_last_day') {
                actualDay = daysInMonth
              } else {
                continue // skip
              }
            }
            resolvedDaysInMonth.add(formatDateComponents(y, m, actualDay))
          }

          // Sort resolved days in this month
          const sortedDays = Array.from(resolvedDaysInMonth).sort()
          for (const dStr of sortedDays) {
            const keepGoing = tryAddDate(dStr)
            if (!keepGoing) break
          }
        }

        m++
        if (m > 12) {
          m = 1
          y++
        }
      }
      break
    }

    case 'monthly_nth_weekday': {
      const startComp = parseDateComponents(effectiveStart)
      const endComp = parseDateComponents(effectiveEnd)
      const monthInterval = pattern.monthInterval ?? 1

      let y = startComp.year
      let m = startComp.month

      while (y < endComp.year || (y === endComp.year && m <= endComp.month)) {
        const patternStartComp = parseDateComponents(pattern.startDate)
        const totalMonthsElapsed = (y - patternStartComp.year) * 12 + (m - patternStartComp.month)

        if (totalMonthsElapsed >= 0 && totalMonthsElapsed % monthInterval === 0) {
          const resolvedDate = resolveNthWeekdayOfMonth(y, m, pattern.weekday, pattern.nthOccurrence)
          if (resolvedDate) {
            const keepGoing = tryAddDate(resolvedDate)
            if (!keepGoing) break
          }
        }

        m++
        if (m > 12) {
          m = 1
          y++
        }
      }
      break
    }

    case 'custom_dates': {
      const sortedExplicit = [...pattern.explicitDates].sort()
      for (const d of sortedExplicit) {
        const keepGoing = tryAddDate(d)
        if (!keepGoing) break
      }
      break
    }
  }

  return scheduledDates.sort()
}

/**
 * Human-readable sentence description of a RecurrencePattern for UI cards & previews.
 */
export function describeRecurrencePattern(pattern: RecurrencePattern): string {
  const weekdayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  let desc = ''

  switch (pattern.type) {
    case 'one_off':
      desc = `One-off task on ${pattern.targetDate}`
      break
    case 'interval_days':
      desc = pattern.intervalDays === 1 ? 'Every day' : `Every ${pattern.intervalDays} days`
      break
    case 'weekly_weekdays': {
      const days = pattern.selectedWeekdays.map((d) => weekdayNames[d]).join(', ')
      desc =
        pattern.weekInterval === 1
          ? `Weekly on ${days}`
          : `Every ${pattern.weekInterval} weeks on ${days}`
      break
    }
    case 'monthly_dates': {
      const days = pattern.monthDays.map((d) => `${d}${getOrdinalSuffix(d)}`).join(', ')
      const interval = (pattern.monthInterval ?? 1) === 1 ? 'Monthly' : `Every ${pattern.monthInterval} months`
      desc = `${interval} on the ${days}`
      break
    }
    case 'monthly_nth_weekday': {
      const nth = pattern.nthOccurrence.charAt(0).toUpperCase() + pattern.nthOccurrence.slice(1)
      const day = weekdayNames[pattern.weekday]
      const interval = (pattern.monthInterval ?? 1) === 1 ? 'Monthly' : `Every ${pattern.monthInterval} months`
      desc = `${interval} on the ${nth} ${day}`
      break
    }
    case 'custom_dates':
      desc = `Custom schedule (${pattern.explicitDates.length} specific dates)`
      break
  }

  desc += `, starting ${pattern.startDate}`
  if (pattern.endDate) desc += ` until ${pattern.endDate}`
  if (pattern.maxOccurrences) desc += ` (max ${pattern.maxOccurrences} occurrences)`

  return desc
}

/**
 * Safely computes the next K candidate dates for recurrence preview.
 */
export function previewNextUpcomingDates(
  pattern: RecurrencePattern,
  count: number = 5,
  fromDateStr: string = getTodayCalendarDate()
): string[] {
  try {
    const val = validateRecurrencePattern(pattern)
    if (!val.isValid) return []
    const windowEnd = addDaysToDate(fromDateStr, 365)
    const dates = generateCandidateOccurrenceDates(pattern, fromDateStr, windowEnd, new Set())
    return dates.slice(0, count)
  } catch {
    return []
  }
}

function getOrdinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return 'th'
  switch (n % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}

/* ==========================================================================
   4. Assignment & Duty Lifecycle Logic
   ========================================================================== */

export interface CreateTemplatePayload {
  title: string
  area: string
  description?: string
  instructions?: string
  estimatedMinutes: number
  schedule: RecurrencePattern
  defaultAssigneeMemberIds?: string[]
  createdByMembershipId: string
  createdByName?: string
}

export interface UpdateTemplatePayload {
  title: string
  area: string
  description?: string
  instructions?: string
  estimatedMinutes: number
  schedule: RecurrencePattern
  defaultAssigneeMemberIds?: string[]
  isActive: boolean
}

export interface CreateAdHocDutyPayload {
  title: string
  area: string
  instructions?: string
  estimatedMinutes: number
  assignedMemberIds: string[]
  dueDate: string
  createdByMembershipId: string
  createdByName?: string
}

/**
 * Validates and creates a new master CleaningTaskTemplate.
 * Starts with scheduleVersion = 1.
 */
export function createCleaningTemplate(
  payload: CreateTemplatePayload,
  members: HouseholdMember[]
): { success: boolean; template?: CleaningTaskTemplate; errorMessage?: string } {
  // Title
  const titleTrimmed = payload.title?.trim() ?? ''
  if (titleTrimmed.length < 2) {
    return { success: false, errorMessage: 'Task template title must be at least 2 characters long.' }
  }

  // Area
  const areaTrimmed = payload.area?.trim() ?? ''
  if (areaTrimmed.length < 2) {
    return { success: false, errorMessage: 'Cleaning area must be specified.' }
  }

  // Estimated Minutes
  if (
    !Number.isInteger(payload.estimatedMinutes) ||
    payload.estimatedMinutes < 1 ||
    payload.estimatedMinutes > 720
  ) {
    return {
      success: false,
      errorMessage: 'Estimated duration must be a positive integer between 1 and 720 minutes.',
    }
  }

  // Active creator check
  const creator = members.find((m) => m.id === payload.createdByMembershipId && m.status === 'active')
  if (!creator) {
    return { success: false, errorMessage: 'Template creator must be an active household member.' }
  }

  // Recurrence pattern validation
  const scheduleVal = validateRecurrencePattern(payload.schedule)
  if (!scheduleVal.isValid) {
    return { success: false, errorMessage: scheduleVal.errorMessage }
  }

  // Default assignees validation (if provided)
  if (payload.defaultAssigneeMemberIds && payload.defaultAssigneeMemberIds.length > 0) {
    const uniqueIds = new Set(payload.defaultAssigneeMemberIds)
    if (uniqueIds.size !== payload.defaultAssigneeMemberIds.length) {
      return { success: false, errorMessage: 'Default assignee list must not contain duplicate member IDs.' }
    }
    for (const id of payload.defaultAssigneeMemberIds) {
      const m = members.find((mem) => mem.id === id)
      if (!m || m.status !== 'active') {
        return { success: false, errorMessage: `Default assignee "${id}" must be an active household member.` }
      }
      if (!m.isCleaningEligible) {
        return { success: false, errorMessage: `Member "${m.name}" is not eligible for cleaning duties.` }
      }
    }
  }

  const nowIso = new Date().toISOString()
  const template: CleaningTaskTemplate = {
    id: generateEntityId('cln-tmpl'),
    title: titleTrimmed,
    area: areaTrimmed,
    description: payload.description?.trim() || undefined,
    instructions: payload.instructions?.trim() || undefined,
    estimatedMinutes: payload.estimatedMinutes,
    schedule: payload.schedule,
    scheduleVersion: 1,
    isActive: true,
    defaultAssigneeMemberIds: payload.defaultAssigneeMemberIds ?? [],
    createdAt: nowIso,
    createdByMembershipId: payload.createdByMembershipId,
    createdByName: payload.createdByName ?? creator.name,
  }

  return { success: true, template }
}

/**
 * Updates an existing CleaningTaskTemplate.
 * Increments scheduleVersion IF AND ONLY IF the normalized recurrence pattern changed.
 */
export function updateCleaningTemplate(
  existingTemplate: CleaningTaskTemplate,
  payload: UpdateTemplatePayload,
  members: HouseholdMember[]
): { success: boolean; updatedTemplate?: CleaningTaskTemplate; errorMessage?: string } {
  const titleTrimmed = payload.title?.trim() ?? ''
  if (titleTrimmed.length < 2) {
    return { success: false, errorMessage: 'Task template title must be at least 2 characters long.' }
  }

  const areaTrimmed = payload.area?.trim() ?? ''
  if (areaTrimmed.length < 2) {
    return { success: false, errorMessage: 'Cleaning area must be specified.' }
  }

  if (
    !Number.isInteger(payload.estimatedMinutes) ||
    payload.estimatedMinutes < 1 ||
    payload.estimatedMinutes > 720
  ) {
    return {
      success: false,
      errorMessage: 'Estimated duration must be a positive integer between 1 and 720 minutes.',
    }
  }

  const scheduleVal = validateRecurrencePattern(payload.schedule)
  if (!scheduleVal.isValid) {
    return { success: false, errorMessage: scheduleVal.errorMessage }
  }

  if (payload.defaultAssigneeMemberIds && payload.defaultAssigneeMemberIds.length > 0) {
    const uniqueIds = new Set(payload.defaultAssigneeMemberIds)
    if (uniqueIds.size !== payload.defaultAssigneeMemberIds.length) {
      return { success: false, errorMessage: 'Default assignee list must not contain duplicate member IDs.' }
    }
    for (const id of payload.defaultAssigneeMemberIds) {
      const m = members.find((mem) => mem.id === id)
      if (!m || m.status !== 'active') {
        return { success: false, errorMessage: `Default assignee "${id}" must be an active household member.` }
      }
      if (!m.isCleaningEligible) {
        return { success: false, errorMessage: `Member "${m.name}" is not eligible for cleaning duties.` }
      }
    }
  }

  // Increment version only if recurrence config changed
  const recurrenceChanged = !isSameRecurrenceConfig(existingTemplate.schedule, payload.schedule)
  const newVersion = recurrenceChanged
    ? existingTemplate.scheduleVersion + 1
    : existingTemplate.scheduleVersion

  const updatedTemplate: CleaningTaskTemplate = {
    ...existingTemplate,
    title: titleTrimmed,
    area: areaTrimmed,
    description: payload.description?.trim() || undefined,
    instructions: payload.instructions?.trim() || undefined,
    estimatedMinutes: payload.estimatedMinutes,
    schedule: payload.schedule,
    scheduleVersion: newVersion,
    isActive: payload.isActive,
    defaultAssigneeMemberIds: payload.defaultAssigneeMemberIds ?? [],
  }

  return { success: true, updatedTemplate }
}

/**
 * Generates due duty instances for a template within [windowStart, windowEnd].
 * Prevents cross-version duplicates on the same date.
 * Does not overwrite existing duties.
 */
export function generateDutiesForTemplate(
  template: CleaningTaskTemplate,
  existingDuties: CleaningDutyAssignment[],
  members: HouseholdMember[],
  windowStart: string,
  windowEnd: string
): { generatedDuties: CleaningDutyAssignment[]; count: number } {
  if (!template.isActive) {
    return { generatedDuties: [], count: 0 }
  }

  // Find all dates already scheduled for this template across all versions
  const existingDates = new Set(
    existingDuties.filter((d) => d.templateId === template.id).map((d) => d.dueDate)
  )

  const candidateDates = generateCandidateOccurrenceDates(
    template.schedule,
    windowStart,
    windowEnd,
    existingDates
  )

  if (candidateDates.length === 0) {
    return { generatedDuties: [], count: 0 }
  }

  // Resolve assignees: filter active cleaning-eligible default assignees
  const activeEligibleDefaults = (template.defaultAssigneeMemberIds ?? [])
    .map((id) => members.find((m) => m.id === id && m.status === 'active' && m.isCleaningEligible))
    .filter((m): m is HouseholdMember => m !== undefined)

  const assignedMemberIds = activeEligibleDefaults.map((m) => m.id)
  const assignedMemberNames = activeEligibleDefaults.map((m) => m.name)

  const nowIso = new Date().toISOString()
  const generated: CleaningDutyAssignment[] = []

  let currentLifetimeCount = existingDates.size

  for (const date of candidateDates) {
    currentLifetimeCount++
    const duty: CleaningDutyAssignment = {
      id: generateEntityId('duty'),
      idempotencyKey: `cln-${template.id}-v${template.scheduleVersion}-${date}`,
      templateId: template.id,
      templateScheduleVersion: template.scheduleVersion,
      title: template.title,
      area: template.area,
      instructions: template.instructions,
      estimatedMinutes: template.estimatedMinutes,
      assignedMemberIds,
      assignedMemberNames,
      assignedByMembershipId: template.createdByMembershipId,
      assignedByName: template.createdByName,
      assignedAt: nowIso,
      dueDate: date,
      occurrenceOrdinal: currentLifetimeCount,
      status: 'pending',
      reassignmentHistory: [],
    }
    generated.push(duty)
  }

  return { generatedDuties: generated, count: generated.length }
}

/**
 * Generates upcoming duties for all active templates across the rolling 14-calendar-day window
 * [todayStr, todayStr + 13 days] (14 days inclusive).
 * Preserves all existing duties, deduplicates dates, and respects active status and lifetime limits.
 */
export function generateUpcomingDutiesForTemplates(
  templates: CleaningTaskTemplate[],
  existingDuties: CleaningDutyAssignment[],
  members: HouseholdMember[],
  todayStr: string = getTodayCalendarDate()
): { updatedDuties: CleaningDutyAssignment[]; newCount: number } {
  const windowStart = todayStr
  const windowEnd = addDaysToDate(todayStr, 13)
  let currentDuties = [...existingDuties]
  let totalNew = 0

  for (const template of templates) {
    if (!template.isActive) continue
    const result = generateDutiesForTemplate(
      template,
      currentDuties,
      members,
      windowStart,
      windowEnd
    )
    if (result.count > 0) {
      currentDuties = [...currentDuties, ...result.generatedDuties]
      totalNew += result.count
    }
  }

  return { updatedDuties: currentDuties, newCount: totalNew }
}

/**
 * Creates an ad-hoc one-off cleaning duty assignment with full validation.
 */
export function createAdHocDutyAssignment(
  payload: CreateAdHocDutyPayload,
  members: HouseholdMember[]
): {
  success: boolean
  duty?: CleaningDutyAssignment
  activityEvent?: CleaningActivityEvent
  errorMessage?: string
} {
  const titleTrimmed = payload.title?.trim() ?? ''
  if (titleTrimmed.length < 2) {
    return { success: false, errorMessage: 'Duty title must be at least 2 characters long.' }
  }

  const areaTrimmed = payload.area?.trim() ?? ''
  if (areaTrimmed.length < 2) {
    return { success: false, errorMessage: 'Cleaning area must be specified.' }
  }

  if (
    !Number.isInteger(payload.estimatedMinutes) ||
    payload.estimatedMinutes < 1 ||
    payload.estimatedMinutes > 720
  ) {
    return {
      success: false,
      errorMessage: 'Estimated duration must be a positive integer between 1 and 720 minutes.',
    }
  }

  if (!isValidCalendarDate(payload.dueDate)) {
    return {
      success: false,
      errorMessage: `Due date "${payload.dueDate}" is not a valid calendar date in YYYY-MM-DD format.`,
    }
  }

  const creator = members.find((m) => m.id === payload.createdByMembershipId && m.status === 'active')
  if (!creator) {
    return { success: false, errorMessage: 'Creator must be an active household member.' }
  }

  // Assignees validation: non-empty, unique, active, eligible
  if (!Array.isArray(payload.assignedMemberIds) || payload.assignedMemberIds.length === 0) {
    return { success: false, errorMessage: 'At least one cleaning-eligible assignee must be assigned.' }
  }

  const uniqueAssigneeIds = new Set(payload.assignedMemberIds)
  if (uniqueAssigneeIds.size !== payload.assignedMemberIds.length) {
    return { success: false, errorMessage: 'Assignee list must not contain duplicate member IDs.' }
  }

  const assignedNames: string[] = []
  for (const id of payload.assignedMemberIds) {
    const mem = members.find((m) => m.id === id)
    if (!mem || mem.status !== 'active') {
      return { success: false, errorMessage: `Assignee "${id}" must be an active household member.` }
    }
    if (!mem.isCleaningEligible) {
      return { success: false, errorMessage: `Member "${mem.name}" is not eligible for cleaning duties.` }
    }
    assignedNames.push(mem.name)
  }

  const nowIso = new Date().toISOString()
  const dutyId = generateEntityId('duty')

  const duty: CleaningDutyAssignment = {
    id: dutyId,
    idempotencyKey: `cln-adhoc-${generateEntityId('token')}-${payload.dueDate}`,
    title: titleTrimmed,
    area: areaTrimmed,
    instructions: payload.instructions?.trim() || undefined,
    estimatedMinutes: payload.estimatedMinutes,
    assignedMemberIds: payload.assignedMemberIds,
    assignedMemberNames: assignedNames,
    assignedByMembershipId: payload.createdByMembershipId,
    assignedByName: payload.createdByName ?? creator.name,
    assignedAt: nowIso,
    dueDate: payload.dueDate,
    status: 'pending',
    reassignmentHistory: [],
  }

  const activityEvent: CleaningActivityEvent = {
    eventId: generateEntityId('act'),
    entityType: 'cleaning',
    entityId: dutyId,
    action: 'created',
    performedByMemberId: creator.id,
    performedByName: creator.name,
    timestamp: nowIso,
    summary: `${creator.name} scheduled cleaning duty "${duty.title}" for ${duty.dueDate}`,
  }

  return { success: true, duty, activityEvent }
}

/**
 * Derives visual/operational status level dynamically.
 * Overdue is NOT a stored database status.
 */
export function deriveDutyStatus(duty: CleaningDutyAssignment, todayDateStr: string): DerivedDutyStatus {
  if (duty.status === 'completed') return 'completed'
  if (duty.status === 'cancelled') return 'cancelled'
  if (duty.status === 'pending' && duty.dueDate < todayDateStr) {
    return 'overdue'
  }
  return 'pending'
}

/**
 * Single shared completion action for a duty.
 * Rejects completion of cancelled or already completed duties.
 */
export function completeCleaningDuty(
  duty: CleaningDutyAssignment,
  completedByMemberId: string,
  members: HouseholdMember[],
  completionNotes?: string
): {
  success: boolean
  updatedDuty?: CleaningDutyAssignment
  activityEvent?: CleaningActivityEvent
  errorMessage?: string
} {
  if (duty.status === 'cancelled') {
    return { success: false, errorMessage: 'Cannot complete a cancelled duty.' }
  }
  if (duty.status === 'completed') {
    return { success: false, errorMessage: 'Duty is already completed.' }
  }

  const actor = members.find((m) => m.id === completedByMemberId && m.status === 'active')
  if (!actor) {
    return { success: false, errorMessage: 'Completing member must be an active household member.' }
  }

  const nowIso = new Date().toISOString()
  const updatedDuty: CleaningDutyAssignment = {
    ...duty,
    status: 'completed',
    completedAt: nowIso,
    completedByMembershipId: actor.id,
    completedByName: actor.name,
    completionNotes: completionNotes?.trim() || undefined,
  }

  const activityEvent: CleaningActivityEvent = {
    eventId: generateEntityId('act'),
    entityType: 'cleaning',
    entityId: duty.id,
    action: 'completed',
    performedByMemberId: actor.id,
    performedByName: actor.name,
    timestamp: nowIso,
    summary: `${actor.name} marked cleaning duty "${duty.title}" as completed`,
  }

  return { success: true, updatedDuty, activityEvent }
}

/**
 * Cancels a duty assignment with a mandatory reason (>= 4 characters).
 * Rejects cancellation of completed or already cancelled duties.
 */
export function cancelCleaningDuty(
  duty: CleaningDutyAssignment,
  cancelledByMemberId: string,
  members: HouseholdMember[],
  reason: string
): {
  success: boolean
  updatedDuty?: CleaningDutyAssignment
  activityEvent?: CleaningActivityEvent
  errorMessage?: string
} {
  if (duty.status === 'completed') {
    return { success: false, errorMessage: 'Cannot cancel a completed duty.' }
  }
  if (duty.status === 'cancelled') {
    return { success: false, errorMessage: 'Duty is already cancelled.' }
  }

  const actor = members.find((m) => m.id === cancelledByMemberId && m.status === 'active')
  if (!actor) {
    return { success: false, errorMessage: 'Cancelling member must be an active household member.' }
  }

  const reasonTrimmed = reason?.trim() ?? ''
  if (reasonTrimmed.length < 4) {
    return {
      success: false,
      errorMessage: 'A mandatory cancellation reason (minimum 4 characters) is required.',
    }
  }

  const nowIso = new Date().toISOString()
  const updatedDuty: CleaningDutyAssignment = {
    ...duty,
    status: 'cancelled',
    cancelledAt: nowIso,
    cancelledByMembershipId: actor.id,
    cancelledByName: actor.name,
    cancellationReason: reasonTrimmed,
  }

  const activityEvent: CleaningActivityEvent = {
    eventId: generateEntityId('act'),
    entityType: 'cleaning',
    entityId: duty.id,
    action: 'cancelled',
    performedByMemberId: actor.id,
    performedByName: actor.name,
    timestamp: nowIso,
    summary: `${actor.name} cancelled cleaning duty "${duty.title}" (${reasonTrimmed})`,
  }

  return { success: true, updatedDuty, activityEvent }
}

/**
 * Reassigns a pending duty to a new list of assignees.
 * Requires a mandatory reason (>= 4 characters).
 * Rejects reassignment of completed or cancelled duties.
 */
export function reassignCleaningDuty(
  duty: CleaningDutyAssignment,
  newAssigneeMemberIds: string[],
  reassignedByMemberId: string,
  members: HouseholdMember[],
  reason: string
): {
  success: boolean
  updatedDuty?: CleaningDutyAssignment
  activityEvent?: CleaningActivityEvent
  errorMessage?: string
} {
  if (duty.status === 'completed') {
    return { success: false, errorMessage: 'Cannot reassign a completed duty.' }
  }
  if (duty.status === 'cancelled') {
    return { success: false, errorMessage: 'Cannot reassign a cancelled duty.' }
  }

  const actor = members.find((m) => m.id === reassignedByMemberId && m.status === 'active')
  if (!actor) {
    return { success: false, errorMessage: 'Reassigning member must be an active household member.' }
  }

  const reasonTrimmed = reason?.trim() ?? ''
  if (reasonTrimmed.length < 4) {
    return {
      success: false,
      errorMessage: 'A mandatory reassignment reason (minimum 4 characters) is required.',
    }
  }

  if (!Array.isArray(newAssigneeMemberIds) || newAssigneeMemberIds.length === 0) {
    return { success: false, errorMessage: 'At least one new cleaning-eligible assignee must be assigned.' }
  }

  const uniqueAssigneeIds = new Set(newAssigneeMemberIds)
  if (uniqueAssigneeIds.size !== newAssigneeMemberIds.length) {
    return { success: false, errorMessage: 'Assignee list must not contain duplicate member IDs.' }
  }

  const newNames: string[] = []
  for (const id of newAssigneeMemberIds) {
    const mem = members.find((m) => m.id === id)
    if (!mem || mem.status !== 'active') {
      return { success: false, errorMessage: `New assignee "${id}" must be an active household member.` }
    }
    if (!mem.isCleaningEligible) {
      return { success: false, errorMessage: `Member "${mem.name}" is not eligible for cleaning duties.` }
    }
    newNames.push(mem.name)
  }

  const nowIso = new Date().toISOString()
  const reassignmentRecord = {
    id: generateEntityId('reassign'),
    previousAssigneeMemberIds: [...duty.assignedMemberIds],
    previousAssigneeNames: [...duty.assignedMemberNames],
    newAssigneeMemberIds: [...newAssigneeMemberIds],
    newAssigneeNames: newNames,
    reassignedByMembershipId: actor.id,
    reassignedByName: actor.name,
    reassignedAt: nowIso,
    reason: reasonTrimmed,
  }

  const updatedDuty: CleaningDutyAssignment = {
    ...duty,
    assignedMemberIds: [...newAssigneeMemberIds],
    assignedMemberNames: newNames,
    reassignmentHistory: [reassignmentRecord, ...duty.reassignmentHistory],
  }

  const activityEvent: CleaningActivityEvent = {
    eventId: generateEntityId('act'),
    entityType: 'cleaning',
    entityId: duty.id,
    action: 'reassigned',
    performedByMemberId: actor.id,
    performedByName: actor.name,
    timestamp: nowIso,
    summary: `${actor.name} reassigned "${duty.title}" to ${newNames.join(', ')} (${reasonTrimmed})`,
  }

  return { success: true, updatedDuty, activityEvent }
}

/* ==========================================================================
   5. Two-Factor Fairness Engine & Recommender
   ========================================================================== */

/**
 * Pure calculation of the two-factor workload fairness scores across all members.
 * Definitions:
 * - Completed Workload: completed duties completed within [asOfDate - 30 days, asOfDate].
 *   Attributed permanently to the members assigned when the duty was completed.
 * - Outstanding Workload: all currently pending duties (including overdue), regardless of age.
 *   Attributed to current assignees.
 * - Per-member share: estimatedMinutes / assignedMemberIds.length.
 * - Combined Score = Completed Workload + 1.25 * Outstanding Workload.
 */
export function calculateCleaningFairnessScores(
  duties: CleaningDutyAssignment[],
  members: HouseholdMember[],
  asOfDateStr: string
): FairnessScoreSummary {
  if (!isValidCalendarDate(asOfDateStr)) {
    throw new Error(`Invalid asOfDateStr: "${asOfDateStr}". Must be YYYY-MM-DD.`)
  }

  const thirtyDayWindowStart = addDaysToDate(asOfDateStr, -30)

  // Map memberId -> { completed: number, outstanding: number }
  const completedMap = new Map<string, number>()
  const outstandingMap = new Map<string, number>()

  for (const m of members) {
    completedMap.set(m.id, 0)
    outstandingMap.set(m.id, 0)
  }

  for (const duty of duties) {
    if (duty.assignedMemberIds.length === 0) continue
    const perMemberShare = duty.estimatedMinutes / duty.assignedMemberIds.length

    if (duty.status === 'completed' && duty.completedAt) {
      const completedDate = duty.completedAt.slice(0, 10)
      if (isValidCalendarDate(completedDate)) {
        if (completedDate >= thirtyDayWindowStart && completedDate <= asOfDateStr) {
          for (const memberId of duty.assignedMemberIds) {
            const prev = completedMap.get(memberId) ?? 0
            completedMap.set(memberId, prev + perMemberShare)
          }
        }
      }
    } else if (duty.status === 'pending') {
      for (const memberId of duty.assignedMemberIds) {
        const prev = outstandingMap.get(memberId) ?? 0
        outstandingMap.set(memberId, prev + perMemberShare)
      }
    }
  }

  const scores: MemberWorkloadShare[] = members.map((m) => {
    const completed = completedMap.get(m.id) ?? 0
    const outstanding = outstandingMap.get(m.id) ?? 0
    const fairness = completed + 1.25 * outstanding
    return {
      memberId: m.id,
      memberName: m.name,
      completedWorkloadMinutes: Math.round(completed * 100) / 100,
      outstandingWorkloadMinutes: Math.round(outstanding * 100) / 100,
      fairnessScore: Math.round(fairness * 100) / 100,
    }
  })

  return {
    asOfDate: asOfDateStr,
    thirtyDayWindowStart,
    scores,
  }
}

/**
 * Pure recommendation function for fair chore allocation.
 * Returns the active, cleaning-eligible members with the lowest combined fairness score.
 * Tie-breaker is 100% deterministic:
 * 1. Lowest fairnessScore
 * 2. Lowest outstandingWorkloadMinutes
 * 3. Lowest completedWorkloadMinutes
 * 4. Member ID alphabetically
 */
export function recommendFairAssignees(
  members: HouseholdMember[],
  fairnessSummary: FairnessScoreSummary,
  count: number = 1
): HouseholdMember[] {
  const eligible = members.filter((m) => m.status === 'active' && m.isCleaningEligible)
  if (eligible.length === 0) return []

  const scoreMap = new Map(fairnessSummary.scores.map((s) => [s.memberId, s]))

  const sorted = [...eligible].sort((a, b) => {
    const scoreA = scoreMap.get(a.id)?.fairnessScore ?? 0
    const scoreB = scoreMap.get(b.id)?.fairnessScore ?? 0
    if (scoreA !== scoreB) return scoreA - scoreB

    const outA = scoreMap.get(a.id)?.outstandingWorkloadMinutes ?? 0
    const outB = scoreMap.get(b.id)?.outstandingWorkloadMinutes ?? 0
    if (outA !== outB) return outA - outB

    const compA = scoreMap.get(a.id)?.completedWorkloadMinutes ?? 0
    const compB = scoreMap.get(b.id)?.completedWorkloadMinutes ?? 0
    if (compA !== compB) return compA - compB

    return a.id.localeCompare(b.id)
  })

  return sorted.slice(0, count)
}
