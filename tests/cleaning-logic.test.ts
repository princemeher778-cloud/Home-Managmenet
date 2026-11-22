import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import type {
  CleaningDutyAssignment,
  CleaningTaskTemplate,
  HouseholdMember,
  RecurrencePattern,
} from '../src/types/index.ts'
import {
  addDaysToDate,
  calculateCleaningFairnessScores,
  cancelCleaningDuty,
  completeCleaningDuty,
  createAdHocDutyAssignment,
  createCleaningTemplate,
  daysBetween,
  deriveDutyStatus,
  formatDateComponents,
  generateDutiesForTemplate,
  generateUpcomingDutiesForTemplates,
  getCalendarWeekday,
  getDaysInMonth,
  getTodayCalendarDate,
  isLeapYear,
  isSameRecurrenceConfig,
  isValidCalendarDate,
  parseDateComponents,
  reassignCleaningDuty,
  recommendFairAssignees,
  updateCleaningTemplate,
  validateRecurrencePattern,
} from '../src/utils/cleaning.ts'

describe('HOMEBASE Stage 5 Cleaning Domain Logic & Invariant Tests', () => {
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
      id: 'm3',
      name: 'Karthik Nair',
      avatarInitial: 'KN',
      status: 'active',
      participationTier: 'resident',
      joinedDate: '2026-01-01',
      isResident: true,
      isFoodEligible: true,
      isCleaningEligible: true,
      isGeneralExpenseEligible: true,
      isRentEligible: true,
    },
    // Paused member
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
    // Departed member
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
    // Food-only member (cleaning ineligible)
    {
      id: 'm8',
      name: 'Vikram Mehta',
      avatarInitial: 'VM',
      status: 'active',
      participationTier: 'food_only',
      joinedDate: '2026-02-01',
      isResident: false,
      isFoodEligible: true,
      isCleaningEligible: false,
      isGeneralExpenseEligible: false,
      isRentEligible: false,
    },
  ]

  // =========================================================================
  // Section A: C1-C9 Architecture Specification Verification Tests
  // =========================================================================

  test('C1. Strict date validation rejects invalid calendar dates without silent normalization', () => {
    // Valid dates
    assert.equal(isValidCalendarDate('2026-02-28'), true)
    assert.equal(isValidCalendarDate('2024-02-29'), true) // Leap year 2024
    assert.equal(isValidCalendarDate('2026-12-31'), true)

    // Invalid dates that native Date.parse silently rolls over
    assert.equal(isValidCalendarDate('2026-02-31'), false) // February 31
    assert.equal(isValidCalendarDate('2025-02-29'), false) // 2025 is not a leap year
    assert.equal(isValidCalendarDate('2026-13-01'), false) // Month 13
    assert.equal(isValidCalendarDate('2026-00-10'), false) // Month 0
    assert.equal(isValidCalendarDate('2026-04-31'), false) // April has only 30 days
    assert.equal(isValidCalendarDate('invalid-date'), false)
    assert.equal(isValidCalendarDate('2026/02/28'), false) // Slash format rejected
    assert.equal(isValidCalendarDate('1999-12-31'), false) // Outside 2000-2100
    assert.equal(isValidCalendarDate('2101-01-01'), false) // Outside 2000-2100

    // Component functions
    assert.equal(isLeapYear(2024), true)
    assert.equal(isLeapYear(2025), false)
    assert.equal(isLeapYear(2000), true)
    assert.equal(isLeapYear(1900), false)
    assert.equal(getDaysInMonth(2026, 2), 28)
    assert.equal(getDaysInMonth(2024, 2), 29)
    assert.equal(getDaysInMonth(2026, 4), 30)
    assert.equal(getDaysInMonth(2026, 5), 31)

    // parseDateComponents & formatDateComponents
    const parsed = parseDateComponents('2026-11-21')
    assert.deepEqual(parsed, { year: 2026, month: 11, day: 21 })
    assert.equal(formatDateComponents(2026, 11, 21), '2026-11-21')

    // addDaysToDate & daysBetween
    assert.equal(addDaysToDate('2026-11-21', 5), '2026-11-26')
    assert.equal(addDaysToDate('2026-11-21', -5), '2026-11-16')
    assert.equal(daysBetween('2026-11-21', '2026-11-26'), 5)
  })

  test('C2. Monday-anchored weekday representation (Monday = 1 ... Sunday = 7)', () => {
    // 2026-11-23 is Monday -> 1
    assert.equal(getCalendarWeekday('2026-11-23'), 1)
    // 2026-11-24 is Tuesday -> 2
    assert.equal(getCalendarWeekday('2026-11-24'), 2)
    // 2026-11-25 is Wednesday -> 3
    assert.equal(getCalendarWeekday('2026-11-25'), 3)
    // 2026-11-26 is Thursday -> 4
    assert.equal(getCalendarWeekday('2026-11-26'), 4)
    // 2026-11-27 is Friday -> 5
    assert.equal(getCalendarWeekday('2026-11-27'), 5)
    // 2026-11-28 is Saturday -> 6
    assert.equal(getCalendarWeekday('2026-11-28'), 6)
    // 2026-11-29 is Sunday -> 7
    assert.equal(getCalendarWeekday('2026-11-29'), 7)

    // Throws on invalid date
    assert.throws(() => getCalendarWeekday('2026-02-31'), /Invalid calendar date/)
  })

  test('C3. Mid-week weekly recurrence anchor (Monday = 1, Week 0 contains startDate)', () => {
    // startDate: Wednesday 2026-11-18. Week Zero is Mon Nov 16 to Sun Nov 22.
    // weekInterval: 2 (every 2 weeks). selectedWeekdays: [1, 3, 5] (Mon, Wed, Fri)
    const schedule: RecurrencePattern = {
      type: 'weekly_weekdays',
      startDate: '2026-11-18', // Wednesday
      weekInterval: 2,
      selectedWeekdays: [1, 3, 5],
    }

    const template: CleaningTaskTemplate = {
      id: 'cln-tmpl-midweek',
      title: 'Common Area Cleaning',
      area: 'Living Room',
      estimatedMinutes: 30,
      schedule,
      scheduleVersion: 1,
      isActive: true,
      defaultAssigneeMemberIds: ['m1'],
      createdAt: '2026-11-18T10:00:00.000Z',
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
    }

    // Look-ahead window covering 3 full weeks: Nov 16 to Dec 06, 2026
    const res = generateDutiesForTemplate(template, [], testMembers, '2026-11-16', '2026-12-06')

    const dueDates = res.generatedDuties.map((d) => d.dueDate)

    // Week 0 (Nov 16 - Nov 22):
    // - Monday Nov 16 is before startDate Nov 18 -> SKIPPED
    // - Wednesday Nov 18 is startDate -> SCHEDULED
    // - Friday Nov 20 -> SCHEDULED
    assert.ok(!dueDates.includes('2026-11-16'))
    assert.ok(dueDates.includes('2026-11-18'))
    assert.ok(dueDates.includes('2026-11-20'))

    // Week 1 (Nov 23 - Nov 29):
    // Elapsed weeks = 1 -> 1 % 2 != 0 -> ENTIRE WEEK SKIPPED
    assert.ok(!dueDates.includes('2026-11-23'))
    assert.ok(!dueDates.includes('2026-11-25'))
    assert.ok(!dueDates.includes('2026-11-27'))

    // Week 2 (Nov 30 - Dec 06):
    // Elapsed weeks = 2 -> 2 % 2 == 0 -> SCHEDULED for Mon, Wed, Fri
    assert.ok(dueDates.includes('2026-11-30'))
    assert.ok(dueDates.includes('2026-12-02'))
    assert.ok(dueDates.includes('2026-12-04'))

    assert.equal(dueDates.length, 5)
  })

  test('C4. Monthly clamping deduplication in February produces exactly one occurrence for day 28', () => {
    // Schedule configured for monthDays: [30, 31] with clamp_to_last_day
    const schedule: RecurrencePattern = {
      type: 'monthly_dates',
      startDate: '2026-01-01',
      monthDays: [30, 31],
      handleShorterMonths: 'clamp_to_last_day',
    }

    const template: CleaningTaskTemplate = {
      id: 'cln-tmpl-clamp',
      title: 'Month-End Utility Scrub',
      area: 'Balcony & Utility',
      estimatedMinutes: 45,
      schedule,
      scheduleVersion: 1,
      isActive: true,
      defaultAssigneeMemberIds: ['m1'],
      createdAt: '2026-01-01T10:00:00.000Z',
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
    }

    // Window covering February 2026 (28 days)
    const res = generateDutiesForTemplate(template, [], testMembers, '2026-02-01', '2026-02-28')

    // Both day 30 and day 31 clamp to 2026-02-28. Deduplication must yield exactly ONE occurrence!
    const febDates = res.generatedDuties.map((d) => d.dueDate)
    assert.deepEqual(febDates, ['2026-02-28'])
    assert.equal(res.count, 1)
  })

  test('C5. maxOccurrences increase across schedule versions resumes generation up to new budget', () => {
    // Version 1 has maxOccurrences: 3
    const scheduleV1: RecurrencePattern = {
      type: 'interval_days',
      startDate: '2026-11-01',
      intervalDays: 2,
      maxOccurrences: 3,
    }

    const templateV1: CleaningTaskTemplate = {
      id: 'cln-tmpl-v-budget',
      title: 'Dusting',
      area: 'Living Room',
      estimatedMinutes: 20,
      schedule: scheduleV1,
      scheduleVersion: 1,
      isActive: true,
      defaultAssigneeMemberIds: ['m1'],
      createdAt: '2026-11-01T10:00:00.000Z',
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
    }

    // Generate V1 instances (Nov 01, Nov 03, Nov 05 -> exactly 3 instances)
    const genV1 = generateDutiesForTemplate(templateV1, [], testMembers, '2026-11-01', '2026-11-30')
    assert.equal(genV1.count, 3)
    const duties = [...genV1.generatedDuties]

    // Now edit template to Version 2: increase maxOccurrences to 6
    const scheduleV2: RecurrencePattern = {
      ...scheduleV1,
      maxOccurrences: 6,
    }

    const updateRes = updateCleaningTemplate(
      templateV1,
      {
        title: templateV1.title,
        area: templateV1.area,
        estimatedMinutes: templateV1.estimatedMinutes,
        schedule: scheduleV2,
        defaultAssigneeMemberIds: templateV1.defaultAssigneeMemberIds,
        isActive: true,
      },
      testMembers
    )

    assert.equal(updateRes.success, true)
    assert.equal(updateRes.updatedTemplate?.scheduleVersion, 2)

    // Generate with V2 over the same window: should generate exactly 3 more (Nov 07, Nov 09, Nov 11)
    const genV2 = generateDutiesForTemplate(
      updateRes.updatedTemplate!,
      duties,
      testMembers,
      '2026-11-01',
      '2026-11-30'
    )

    assert.equal(genV2.count, 3)
    assert.deepEqual(
      genV2.generatedDuties.map((d) => d.dueDate),
      ['2026-11-07', '2026-11-09', '2026-11-11']
    )

    // Combined unique dates count is exactly 6
    const allDuties = [...duties, ...genV2.generatedDuties]
    const allDates = new Set(allDuties.map((d) => d.dueDate))
    assert.equal(allDates.size, 6)
  })

  test('C6. maxOccurrences decrease across versions halts future generation while preserving existing duties', () => {
    // Initial: 4 instances generated
    const scheduleV1: RecurrencePattern = {
      type: 'interval_days',
      startDate: '2026-11-01',
      intervalDays: 2,
      maxOccurrences: 4,
    }

    const templateV1: CleaningTaskTemplate = {
      id: 'cln-tmpl-v-decrease',
      title: 'Mopping',
      area: 'Kitchen',
      estimatedMinutes: 25,
      schedule: scheduleV1,
      scheduleVersion: 1,
      isActive: true,
      defaultAssigneeMemberIds: ['m1'],
      createdAt: '2026-11-01T10:00:00.000Z',
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
    }

    const genV1 = generateDutiesForTemplate(templateV1, [], testMembers, '2026-11-01', '2026-11-30')
    assert.equal(genV1.count, 4)
    const existingDuties = [...genV1.generatedDuties]

    // Update template: decrease maxOccurrences to 2
    const updateRes = updateCleaningTemplate(
      templateV1,
      {
        title: templateV1.title,
        area: templateV1.area,
        estimatedMinutes: templateV1.estimatedMinutes,
        schedule: { ...scheduleV1, maxOccurrences: 2 },
        defaultAssigneeMemberIds: templateV1.defaultAssigneeMemberIds,
        isActive: true,
      },
      testMembers
    )

    assert.equal(updateRes.success, true)
    assert.equal(updateRes.updatedTemplate?.scheduleVersion, 2)

    // Generate with V2: remaining budget is max(0, 2 - 4) = 0.
    // Zero new duties generated, existing 4 duties remain untouched!
    const genV2 = generateDutiesForTemplate(
      updateRes.updatedTemplate!,
      existingDuties,
      testMembers,
      '2026-11-01',
      '2026-11-30'
    )
    assert.equal(genV2.count, 0)
    assert.equal(existingDuties.length, 4)
  })

  test('C7. Fairness score: 30-day completed window vs lifetime outstanding window', () => {
    const asOfDate = '2026-11-21'

    const duties: CleaningDutyAssignment[] = [
      // 1. Completed 10 days ago (2026-11-11) -> within 30-day window -> counts towards W_completed
      {
        id: 'd-comp-recent',
        idempotencyKey: 'k1',
        title: 'Recent Clean',
        area: 'Kitchen',
        estimatedMinutes: 60,
        assignedMemberIds: ['m1'],
        assignedMemberNames: ['Rohan Sharma'],
        assignedByMembershipId: 'm1',
        assignedByName: 'Rohan Sharma',
        assignedAt: '2026-11-10T10:00:00.000Z',
        dueDate: '2026-11-11',
        status: 'completed',
        completedAt: '2026-11-11T12:00:00.000Z',
        completedByMembershipId: 'm1',
        completedByName: 'Rohan Sharma',
        reassignmentHistory: [],
      },
      // 2. Completed 45 days ago (2026-10-07) -> OUTSIDE 30-day window -> EXCLUDED from W_completed
      {
        id: 'd-comp-old',
        idempotencyKey: 'k2',
        title: 'Old Clean',
        area: 'Living Room',
        estimatedMinutes: 100,
        assignedMemberIds: ['m1'],
        assignedMemberNames: ['Rohan Sharma'],
        assignedByMembershipId: 'm1',
        assignedByName: 'Rohan Sharma',
        assignedAt: '2026-10-05T10:00:00.000Z',
        dueDate: '2026-10-07',
        status: 'completed',
        completedAt: '2026-10-07T12:00:00.000Z',
        completedByMembershipId: 'm1',
        completedByName: 'Rohan Sharma',
        reassignmentHistory: [],
      },
      // 3. Overdue duty from 45 days ago (2026-10-07) -> pending -> INCLUDED in W_outstanding
      {
        id: 'd-overdue-old',
        idempotencyKey: 'k3',
        title: 'Overdue Deep Clean',
        area: 'Bathrooms',
        estimatedMinutes: 40,
        assignedMemberIds: ['m2'],
        assignedMemberNames: ['Arjun Verma'],
        assignedByMembershipId: 'm1',
        assignedByName: 'Rohan Sharma',
        assignedAt: '2026-10-05T10:00:00.000Z',
        dueDate: '2026-10-07',
        status: 'pending', // Pending/Overdue
        reassignmentHistory: [],
      },
    ]

    const fairness = calculateCleaningFairnessScores(duties, testMembers, asOfDate)
    const m1Score = fairness.scores.find((s) => s.memberId === 'm1')
    const m2Score = fairness.scores.find((s) => s.memberId === 'm2')

    // m1: completed = 60 (the 100 min duty is outside 30 days), outstanding = 0
    assert.equal(m1Score?.completedWorkloadMinutes, 60)
    assert.equal(m1Score?.outstandingWorkloadMinutes, 0)
    assert.equal(m1Score?.fairnessScore, 60)

    // m2: completed = 0, outstanding = 40 (even though due 45 days ago)
    // fairnessScore = 0 + 1.25 * 40 = 50
    assert.equal(m2Score?.completedWorkloadMinutes, 0)
    assert.equal(m2Score?.outstandingWorkloadMinutes, 40)
    assert.equal(m2Score?.fairnessScore, 50)
  })

  test('C8. Reassignment transfers outstanding workload immediately to new assignees', () => {
    const asOfDate = '2026-11-21'

    const duty: CleaningDutyAssignment = {
      id: 'd-transfer',
      idempotencyKey: 'k-trans',
      title: 'Kitchen Exhaust Cleaning',
      area: 'Kitchen',
      estimatedMinutes: 60,
      assignedMemberIds: ['m1'], // Initially assigned to m1
      assignedMemberNames: ['Rohan Sharma'],
      assignedByMembershipId: 'm1',
      assignedByName: 'Rohan Sharma',
      assignedAt: '2026-11-20T10:00:00.000Z',
      dueDate: '2026-11-22',
      status: 'pending',
      reassignmentHistory: [],
    }

    // Before reassignment: m1 has 60 outstanding
    const initialFairness = calculateCleaningFairnessScores([duty], testMembers, asOfDate)
    assert.equal(
      initialFairness.scores.find((s) => s.memberId === 'm1')?.outstandingWorkloadMinutes,
      60
    )
    assert.equal(
      initialFairness.scores.find((s) => s.memberId === 'm2')?.outstandingWorkloadMinutes,
      0
    )

    // Reassign duty to m2
    const reassignRes = reassignCleaningDuty(
      duty,
      ['m2'],
      'm1',
      testMembers,
      'Office deadline this weekend'
    )
    assert.equal(reassignRes.success, true)
    assert.ok(reassignRes.updatedDuty)

    // After reassignment: outstanding transferred to m2
    const postFairness = calculateCleaningFairnessScores(
      [reassignRes.updatedDuty!],
      testMembers,
      asOfDate
    )
    assert.equal(
      postFairness.scores.find((s) => s.memberId === 'm1')?.outstandingWorkloadMinutes,
      0
    )
    assert.equal(
      postFairness.scores.find((s) => s.memberId === 'm2')?.outstandingWorkloadMinutes,
      60
    )
  })

  test('C9. scheduleVersion increments ONLY on recurrence edits, not on cosmetic metadata edits', () => {
    const initialSchedule: RecurrencePattern = {
      type: 'interval_days',
      startDate: '2026-11-20',
      intervalDays: 3,
    }

    const createdTmpl = createCleaningTemplate(
      {
        title: 'Old Title',
        area: 'Kitchen',
        estimatedMinutes: 30,
        schedule: initialSchedule,
        defaultAssigneeMemberIds: ['m1'],
        createdByMembershipId: 'm1',
      },
      testMembers
    )
    assert.equal(createdTmpl.success, true)
    const template = createdTmpl.template!
    assert.equal(template.scheduleVersion, 1)

    // Edit 1: Title and estimated minutes changed (schedule unchanged) -> scheduleVersion remains 1
    const edit1 = updateCleaningTemplate(
      template,
      {
        title: 'New Improved Title',
        area: 'Kitchen Deep',
        estimatedMinutes: 45,
        schedule: initialSchedule,
        defaultAssigneeMemberIds: ['m1', 'm2'],
        isActive: true,
      },
      testMembers
    )
    assert.equal(edit1.success, true)
    assert.equal(edit1.updatedTemplate?.scheduleVersion, 1)

    // Edit 2: Recurrence schedule changed from 3 days to 4 days -> scheduleVersion increments to 2
    const edit2 = updateCleaningTemplate(
      edit1.updatedTemplate!,
      {
        title: edit1.updatedTemplate!.title,
        area: edit1.updatedTemplate!.area,
        estimatedMinutes: edit1.updatedTemplate!.estimatedMinutes,
        schedule: { ...initialSchedule, intervalDays: 4 },
        defaultAssigneeMemberIds: edit1.updatedTemplate!.defaultAssigneeMemberIds,
        isActive: true,
      },
      testMembers
    )
    assert.equal(edit2.success, true)
    assert.equal(edit2.updatedTemplate?.scheduleVersion, 2)

    // Edit 3: Semantically identical schedule with different array ordering does NOT increment
    const weeklyScheduleA: RecurrencePattern = {
      type: 'weekly_weekdays',
      startDate: '2026-11-20',
      weekInterval: 1,
      selectedWeekdays: [5, 2], // Friday, Tuesday
    }
    const weeklyScheduleB: RecurrencePattern = {
      type: 'weekly_weekdays',
      startDate: '2026-11-20',
      weekInterval: 1,
      selectedWeekdays: [2, 5], // Tuesday, Friday
    }
    assert.equal(isSameRecurrenceConfig(weeklyScheduleA, weeklyScheduleB), true)
  })

  // =========================================================================
  // Section B: Validation, Assignment Integrity & Lifecycle Tests
  // =========================================================================

  test('Recurrence validation rejects invalid configurations across all types', () => {
    // 1. Invalid month interval
    const invalidMonthInt = validateRecurrencePattern({
      type: 'monthly_dates',
      startDate: '2026-11-01',
      monthInterval: 0, // Invalid: must be >= 1
      monthDays: [15],
      handleShorterMonths: 'clamp_to_last_day',
    })
    assert.equal(invalidMonthInt.isValid, false)
    assert.match(invalidMonthInt.errorMessage ?? '', /Month interval/i)

    // 2. Duplicate month days
    const dupMonthDays = validateRecurrencePattern({
      type: 'monthly_dates',
      startDate: '2026-11-01',
      monthDays: [15, 15], // Duplicate day 15
      handleShorterMonths: 'clamp_to_last_day',
    })
    assert.equal(dupMonthDays.isValid, false)
    assert.match(dupMonthDays.errorMessage ?? '', /duplicate/i)

    // 3. Duplicate selected weekdays
    const dupWeekdays = validateRecurrencePattern({
      type: 'weekly_weekdays',
      startDate: '2026-11-01',
      weekInterval: 1,
      selectedWeekdays: [1, 1], // Duplicate Monday
    })
    assert.equal(dupWeekdays.isValid, false)
    assert.match(dupWeekdays.errorMessage ?? '', /duplicate/i)

    // 4. One-off targetDate earlier than startDate
    const earlyTarget = validateRecurrencePattern({
      type: 'one_off',
      startDate: '2026-11-20',
      targetDate: '2026-11-10', // Precedes startDate
    })
    assert.equal(earlyTarget.isValid, false)
    assert.match(earlyTarget.errorMessage ?? '', /earlier than start date/i)

    // 5. endDate earlier than startDate
    const invertedDates = validateRecurrencePattern({
      type: 'interval_days',
      startDate: '2026-11-20',
      endDate: '2026-11-10',
      intervalDays: 2,
    })
    assert.equal(invertedDates.isValid, false)
    assert.match(invertedDates.errorMessage ?? '', /earlier than start date/i)

    // 6. Duplicate custom dates
    const dupCustom = validateRecurrencePattern({
      type: 'custom_dates',
      startDate: '2026-11-20',
      explicitDates: ['2026-11-25', '2026-11-25'],
    })
    assert.equal(dupCustom.isValid, false)
    assert.match(dupCustom.errorMessage ?? '', /duplicate/i)
  })

  test('Assignment integrity rejects duplicate assignees, inactive members, and cleaning-ineligible members', () => {
    // 1. Duplicate assignee IDs
    const dupRes = createAdHocDutyAssignment(
      {
        title: 'Trash Clearance',
        area: 'Kitchen',
        estimatedMinutes: 15,
        assignedMemberIds: ['m1', 'm1'], // Duplicate
        dueDate: '2026-11-25',
        createdByMembershipId: 'm1',
      },
      testMembers
    )
    assert.equal(dupRes.success, false)
    assert.match(dupRes.errorMessage ?? '', /duplicate member IDs/i)

    // 2. Cleaning-ineligible member (m8 is food-only contributor)
    const ineligRes = createAdHocDutyAssignment(
      {
        title: 'Trash Clearance',
        area: 'Kitchen',
        estimatedMinutes: 15,
        assignedMemberIds: ['m8'], // Ineligible
        dueDate: '2026-11-25',
        createdByMembershipId: 'm1',
      },
      testMembers
    )
    assert.equal(ineligRes.success, false)
    assert.match(ineligRes.errorMessage ?? '', /not eligible for cleaning duties/i)

    // 3. Paused member
    const pausedRes = createAdHocDutyAssignment(
      {
        title: 'Trash Clearance',
        area: 'Kitchen',
        estimatedMinutes: 15,
        assignedMemberIds: ['m-paused'], // Paused
        dueDate: '2026-11-25',
        createdByMembershipId: 'm1',
      },
      testMembers
    )
    assert.equal(pausedRes.success, false)
    assert.match(pausedRes.errorMessage ?? '', /active household member/i)

    // 4. Departed member
    const departedRes = createAdHocDutyAssignment(
      {
        title: 'Trash Clearance',
        area: 'Kitchen',
        estimatedMinutes: 15,
        assignedMemberIds: ['m-departed'], // Departed
        dueDate: '2026-11-25',
        createdByMembershipId: 'm1',
      },
      testMembers
    )
    assert.equal(departedRes.success, false)
    assert.match(departedRes.errorMessage ?? '', /active household member/i)

    // 5. Invalid duration (0 or negative)
    const zeroDurRes = createAdHocDutyAssignment(
      {
        title: 'Trash Clearance',
        area: 'Kitchen',
        estimatedMinutes: 0,
        assignedMemberIds: ['m1'],
        dueDate: '2026-11-25',
        createdByMembershipId: 'm1',
      },
      testMembers
    )
    assert.equal(zeroDurRes.success, false)
    assert.match(zeroDurRes.errorMessage ?? '', /positive integer/i)
  })

  test('Lifecycle guardrails: cancelled duties cannot be completed or reassigned, completed duties cannot be cancelled or reassigned', () => {
    const duty: CleaningDutyAssignment = {
      id: 'd-lifecycle',
      idempotencyKey: 'k-life',
      title: 'Balcony Sweep',
      area: 'Balcony',
      estimatedMinutes: 20,
      assignedMemberIds: ['m1'],
      assignedMemberNames: ['Rohan Sharma'],
      assignedByMembershipId: 'm1',
      assignedByName: 'Rohan Sharma',
      assignedAt: '2026-11-20T10:00:00.000Z',
      dueDate: '2026-11-22',
      status: 'pending',
      reassignmentHistory: [],
    }

    // Cancel duty
    const cancelRes = cancelCleaningDuty(duty, 'm1', testMembers, 'Raining heavily today')
    assert.equal(cancelRes.success, true)
    const cancelledDuty = cancelRes.updatedDuty!

    // Attempt to complete cancelled duty -> FAILS
    const failComplete = completeCleaningDuty(cancelledDuty, 'm1', testMembers)
    assert.equal(failComplete.success, false)
    assert.match(failComplete.errorMessage ?? '', /Cannot complete a cancelled duty/i)

    // Attempt to reassign cancelled duty -> FAILS
    const failReassign = reassignCleaningDuty(
      cancelledDuty,
      ['m2'],
      'm1',
      testMembers,
      'Try next day'
    )
    assert.equal(failReassign.success, false)
    assert.match(failReassign.errorMessage ?? '', /Cannot reassign a cancelled duty/i)

    // Now test a completed duty
    const completeRes = completeCleaningDuty(duty, 'm1', testMembers)
    assert.equal(completeRes.success, true)
    const completedDuty = completeRes.updatedDuty!

    // Attempt to cancel completed duty -> FAILS
    const failCancel = cancelCleaningDuty(completedDuty, 'm1', testMembers, 'Cancelled after done')
    assert.equal(failCancel.success, false)
    assert.match(failCancel.errorMessage ?? '', /Cannot cancel a completed duty/i)

    // Attempt to reassign completed duty -> FAILS
    const failReassignComp = reassignCleaningDuty(
      completedDuty,
      ['m2'],
      'm1',
      testMembers,
      'Change assignee'
    )
    assert.equal(failReassignComp.success, false)
    assert.match(failReassignComp.errorMessage ?? '', /Cannot reassign a completed duty/i)
  })

  test('Reassignment & cancellation reasons require minimum 4 characters', () => {
    const duty: CleaningDutyAssignment = {
      id: 'd-reason-test',
      idempotencyKey: 'k-reason',
      title: 'Counter Wipe',
      area: 'Kitchen',
      estimatedMinutes: 10,
      assignedMemberIds: ['m1'],
      assignedMemberNames: ['Rohan Sharma'],
      assignedByMembershipId: 'm1',
      assignedByName: 'Rohan Sharma',
      assignedAt: '2026-11-20T10:00:00.000Z',
      dueDate: '2026-11-22',
      status: 'pending',
      reassignmentHistory: [],
    }

    // Reassignment with 2 chars -> FAILS
    const shortReassign = reassignCleaningDuty(duty, ['m2'], 'm1', testMembers, 'no')
    assert.equal(shortReassign.success, false)
    assert.match(shortReassign.errorMessage ?? '', /minimum 4 characters/i)

    // Cancellation with 3 chars -> FAILS
    const shortCancel = cancelCleaningDuty(duty, 'm1', testMembers, 'nah')
    assert.equal(shortCancel.success, false)
    assert.match(shortCancel.errorMessage ?? '', /minimum 4 characters/i)
  })

  test('Derived duty status correctly evaluates overdue based on calendar date', () => {
    const duty: CleaningDutyAssignment = {
      id: 'd-status',
      idempotencyKey: 'k-status',
      title: 'Dusting',
      area: 'Living Room',
      estimatedMinutes: 20,
      assignedMemberIds: ['m1'],
      assignedMemberNames: ['Rohan Sharma'],
      assignedByMembershipId: 'm1',
      assignedByName: 'Rohan Sharma',
      assignedAt: '2026-11-15T10:00:00.000Z',
      dueDate: '2026-11-20',
      status: 'pending',
      reassignmentHistory: [],
    }

    // Today is Nov 20: dueDate == today -> pending
    assert.equal(deriveDutyStatus(duty, '2026-11-20'), 'pending')

    // Today is Nov 21: dueDate < today and status is pending -> OVERDUE
    assert.equal(deriveDutyStatus(duty, '2026-11-21'), 'overdue')

    // Completed duty is never overdue even if dueDate < today
    assert.equal(deriveDutyStatus({ ...duty, status: 'completed' }, '2026-11-21'), 'completed')

    // Cancelled duty is never overdue
    assert.equal(deriveDutyStatus({ ...duty, status: 'cancelled' }, '2026-11-21'), 'cancelled')
  })

  test('Paused templates stop generating duties without deleting existing duties', () => {
    const template: CleaningTaskTemplate = {
      id: 'cln-tmpl-paused',
      title: 'Weekly Deep Clean',
      area: 'Bathrooms',
      estimatedMinutes: 45,
      schedule: {
        type: 'interval_days',
        startDate: '2026-11-20',
        intervalDays: 2,
      },
      scheduleVersion: 1,
      isActive: false, // Paused!
      defaultAssigneeMemberIds: ['m1'],
      createdAt: '2026-11-20T10:00:00.000Z',
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
    }

    const res = generateDutiesForTemplate(template, [], testMembers, '2026-11-20', '2026-11-30')
    assert.equal(res.count, 0)
    assert.equal(res.generatedDuties.length, 0)
  })

  test('Multi-member duties divide workload equally and fair recommendation breaks ties deterministically', () => {
    const duties: CleaningDutyAssignment[] = [
      // 60-min duty assigned to 2 members (m1 and m2) -> 30 mins each
      {
        id: 'd-split',
        idempotencyKey: 'k-split',
        title: 'Deep Kitchen Degreasing',
        area: 'Kitchen',
        estimatedMinutes: 60,
        assignedMemberIds: ['m1', 'm2'],
        assignedMemberNames: ['Rohan Sharma', 'Arjun Verma'],
        assignedByMembershipId: 'm1',
        assignedByName: 'Rohan Sharma',
        assignedAt: '2026-11-20T10:00:00.000Z',
        dueDate: '2026-11-20',
        status: 'completed',
        completedAt: '2026-11-20T12:00:00.000Z',
        completedByMembershipId: 'm1',
        completedByName: 'Rohan Sharma',
        reassignmentHistory: [],
      },
    ]

    const fairness = calculateCleaningFairnessScores(duties, testMembers, '2026-11-21')
    const m1Score = fairness.scores.find((s) => s.memberId === 'm1')
    const m2Score = fairness.scores.find((s) => s.memberId === 'm2')
    const m3Score = fairness.scores.find((s) => s.memberId === 'm3')

    assert.equal(m1Score?.completedWorkloadMinutes, 30) // 60 / 2 = 30
    assert.equal(m2Score?.completedWorkloadMinutes, 30) // 60 / 2 = 30
    assert.equal(m3Score?.completedWorkloadMinutes, 0)

    // m3 has 0 workload -> should be recommended first
    const recommended = recommendFairAssignees(testMembers, fairness, 1)
    assert.equal(recommended.length, 1)
    assert.equal(recommended[0].id, 'm3')

    // If m1 and m2 have identical scores, tie is broken deterministically by member ID ('m1' < 'm2')
    const top2 = recommendFairAssignees(testMembers, fairness, 3)
    assert.equal(top2[0].id, 'm3')
    assert.equal(top2[1].id, 'm1') // Alphabetical tie-break: m1 before m2
    assert.equal(top2[2].id, 'm2')
  })

  test('Cross-version duplicate date prevention prevents scheduling on the same date twice for one template', () => {
    const existingDuty: CleaningDutyAssignment = {
      id: 'd-v1',
      idempotencyKey: 'cln-tmpl-dup-check-v1-2026-11-25',
      templateId: 'cln-tmpl-dup-check',
      templateScheduleVersion: 1,
      title: 'Window Wash',
      area: 'Living Room',
      estimatedMinutes: 30,
      assignedMemberIds: ['m1'],
      assignedMemberNames: ['Rohan Sharma'],
      assignedByMembershipId: 'm1',
      assignedByName: 'Rohan Sharma',
      assignedAt: '2026-11-20T10:00:00.000Z',
      dueDate: '2026-11-25', // Already scheduled on Nov 25 under v1
      status: 'pending',
      reassignmentHistory: [],
    }

    const templateV2: CleaningTaskTemplate = {
      id: 'cln-tmpl-dup-check',
      title: 'Window Wash',
      area: 'Living Room',
      estimatedMinutes: 30,
      schedule: {
        type: 'one_off',
        startDate: '2026-11-20',
        targetDate: '2026-11-25', // Targets the exact same date under v2
      },
      scheduleVersion: 2,
      isActive: true,
      defaultAssigneeMemberIds: ['m1'],
      createdAt: '2026-11-20T10:00:00.000Z',
      createdByMembershipId: 'm1',
      createdByName: 'Rohan Sharma',
    }

    // Generator must detect that Nov 25 already has a duty for this template and skip it
    const res = generateDutiesForTemplate(
      templateV2,
      [existingDuty],
      testMembers,
      '2026-11-20',
      '2026-11-30'
    )
    assert.equal(res.count, 0)
    assert.equal(res.generatedDuties.length, 0)
  })

  test('Audit Correction: getTodayCalendarDate derives local date and handles date arithmetic without timezone drift', () => {
    // 1. Fixed known Date object
    const sampleDate = new Date(2026, 10, 21, 14, 30, 0) // Nov 21, 2026 (month index 10)
    assert.equal(getTodayCalendarDate(sampleDate), '2026-11-21')

    // 2. Midnight local boundary: verify it formats correctly
    const midnightDate = new Date(2027, 0, 1, 0, 5, 0) // Jan 1, 2027
    assert.equal(getTodayCalendarDate(midnightDate), '2027-01-01')

    // 3. Timezone-safe date arithmetic across leap year boundary
    const leapEnd = '2024-02-28'
    assert.equal(addDaysToDate(leapEnd, 1), '2024-02-29')
    assert.equal(addDaysToDate(leapEnd, 2), '2024-03-01')

    // 4. Rolling 14-calendar-day window: today through today + 13 days
    const today = '2026-11-21'
    const windowEnd = addDaysToDate(today, 13)
    assert.equal(windowEnd, '2026-12-04')
    // Inclusive count of days
    assert.equal(daysBetween(today, windowEnd) + 1, 14)
  })

  test('Audit Correction: Recurring template creation and resume generate upcoming duties across rolling 14-day window', () => {
    const today = '2026-11-21'
    const eligibleMembers = testMembers.filter((m) => m.status === 'active' && m.isCleaningEligible)

    // 1. Create active template: Daily kitchen wipe (interval_days = 1)
    const tmplRes = createCleaningTemplate(
      {
        title: 'Daily Countertop Wipe',
        area: 'Kitchen',
        estimatedMinutes: 15,
        schedule: {
          type: 'interval_days',
          startDate: today,
          intervalDays: 1,
        },
        defaultAssigneeMemberIds: ['m1'],
        createdByMembershipId: 'm1',
      },
      testMembers
    )
    assert.equal(tmplRes.success, true)
    const template = tmplRes.template!

    // Generate upcoming duties using rolling 14-day window
    const genRes = generateUpcomingDutiesForTemplates([template], [], eligibleMembers, today)
    // 14 days interval 1 => 14 duties
    assert.equal(genRes.newCount, 14)
    assert.equal(genRes.updatedDuties.length, 14)
    assert.equal(genRes.updatedDuties[0].dueDate, '2026-11-21')
    assert.equal(genRes.updatedDuties[13].dueDate, '2026-12-04')

    // 2. Repeated generation produces zero duplicates
    const repeatRes = generateUpcomingDutiesForTemplates(
      [template],
      genRes.updatedDuties,
      eligibleMembers,
      today
    )
    assert.equal(repeatRes.newCount, 0)
    assert.equal(repeatRes.updatedDuties.length, 14)

    // 3. Paused template generates 0 duties
    const pausedTmpl: CleaningTaskTemplate = {
      ...template,
      isActive: false,
    }
    const pausedGen = generateUpcomingDutiesForTemplates([pausedTmpl], [], eligibleMembers, today)
    assert.equal(pausedGen.newCount, 0)
    assert.equal(pausedGen.updatedDuties.length, 0)

    // 4. Resuming paused template immediately generates duties
    const resumedTmpl: CleaningTaskTemplate = {
      ...pausedTmpl,
      isActive: true,
    }
    const resumedGen = generateUpcomingDutiesForTemplates([resumedTmpl], [], eligibleMembers, today)
    assert.equal(resumedGen.newCount, 14)
    assert.equal(resumedGen.updatedDuties.length, 14)
  })

  test('Audit Correction: Recurrence edits increment version and generate new-version duties without duplicating existing dates', () => {
    const today = '2026-11-21'
    const eligibleMembers = testMembers.filter((m) => m.status === 'active' && m.isCleaningEligible)

    // Initial template v1: every Saturday (weekday 6)
    const initialTmpl: CleaningTaskTemplate = {
      id: 'tmpl-v-edit',
      title: 'Bathroom Deep Clean',
      area: 'Bathrooms',
      estimatedMinutes: 45,
      schedule: {
        type: 'weekly_weekdays',
        startDate: today,
        weekInterval: 1,
        selectedWeekdays: [6], // Saturday
      },
      scheduleVersion: 1,
      isActive: true,
      defaultAssigneeMemberIds: ['m1'],
      createdAt: '2026-11-21T10:00:00.000Z',
      createdByMembershipId: 'm1',
    }

    // Generate v1 duties across 14-day window
    const v1Res = generateUpcomingDutiesForTemplates([initialTmpl], [], eligibleMembers, today)
    assert.equal(v1Res.newCount, 2) // Nov 21 and Nov 28
    assert.ok(v1Res.updatedDuties.every((d) => d.templateScheduleVersion === 1))

    // Edit template recurrence to add Sunday (weekday 7)
    const editRes = updateCleaningTemplate(
      initialTmpl,
      {
        title: 'Bathroom Deep Clean',
        area: 'Bathrooms',
        estimatedMinutes: 45,
        schedule: {
          type: 'weekly_weekdays',
          startDate: today,
          weekInterval: 1,
          selectedWeekdays: [6, 7], // Saturday + Sunday
        },
        defaultAssigneeMemberIds: ['m1'],
        isActive: true,
      },
      testMembers
    )
    assert.equal(editRes.success, true)
    const updatedTmpl = editRes.updatedTemplate!
    assert.equal(updatedTmpl.scheduleVersion, 2)

    // Generate new duties with updated template v2
    const v2Res = generateUpcomingDutiesForTemplates(
      [updatedTmpl],
      v1Res.updatedDuties,
      eligibleMembers,
      today
    )
    // Sundays (Nov 22 and Nov 29) are newly generated under v2; Saturdays (Nov 21 and 28) are preserved under v1 without duplicate
    assert.equal(v2Res.newCount, 2)
    assert.equal(v2Res.updatedDuties.length, 4)

    const v2Duties = v2Res.updatedDuties.filter((d) => d.templateScheduleVersion === 2)
    assert.equal(v2Duties.length, 2)
    assert.equal(v2Duties[0].dueDate, '2026-11-22')
    assert.equal(v2Duties[1].dueDate, '2026-11-29')
  })

  test('Audit Correction: Fairness panel dataset includes zero-workload eligible members and excludes paused/ineligible members', () => {
    const eligibleMembers = testMembers.filter((m) => m.status === 'active' && m.isCleaningEligible)
    assert.equal(eligibleMembers.length, 3) // m1, m2, m3

    const duties: CleaningDutyAssignment[] = [
      {
        id: 'd-fair-1',
        idempotencyKey: 'k-f1',
        title: 'Kitchen Clean',
        area: 'Kitchen',
        estimatedMinutes: 60,
        assignedMemberIds: ['m1'],
        assignedMemberNames: ['Rohan Sharma'],
        assignedByMembershipId: 'm1',
        assignedByName: 'Rohan Sharma',
        assignedAt: '2026-11-15T10:00:00.000Z',
        dueDate: '2026-11-15',
        status: 'completed',
        completedAt: '2026-11-15T11:00:00.000Z',
        completedByMembershipId: 'm1',
        completedByName: 'Rohan Sharma',
        reassignmentHistory: [],
      },
      {
        id: 'd-fair-2',
        idempotencyKey: 'k-f2',
        title: 'Hall Mopping',
        area: 'Living Room',
        estimatedMinutes: 40,
        assignedMemberIds: ['m2'],
        assignedMemberNames: ['Priya Patel'],
        assignedByMembershipId: 'm1',
        assignedByName: 'Rohan Sharma',
        assignedAt: '2026-11-20T10:00:00.000Z',
        dueDate: '2026-11-22',
        status: 'pending',
        reassignmentHistory: [],
      },
    ]

    const fairness = calculateCleaningFairnessScores(duties, eligibleMembers, '2026-11-21')
    assert.equal(fairness.scores.length, 3)

    const m1Score = fairness.scores.find((s) => s.memberId === 'm1')
    const m2Score = fairness.scores.find((s) => s.memberId === 'm2')
    const m3Score = fairness.scores.find((s) => s.memberId === 'm3')

    // m1: 60 completed, 0 pending => score = 60 + 1.25 * 0 = 60
    assert.equal(m1Score?.completedWorkloadMinutes, 60)
    assert.equal(m1Score?.outstandingWorkloadMinutes, 0)
    assert.equal(m1Score?.fairnessScore, 60)

    // m2: 0 completed, 40 pending => score = 0 + 1.25 * 40 = 50
    assert.equal(m2Score?.completedWorkloadMinutes, 0)
    assert.equal(m2Score?.outstandingWorkloadMinutes, 40)
    assert.equal(m2Score?.fairnessScore, 50)

    // m3: zero-workload eligible member must be included with 0 completed, 0 outstanding, score 0
    assert.equal(m3Score?.completedWorkloadMinutes, 0)
    assert.equal(m3Score?.outstandingWorkloadMinutes, 0)
    assert.equal(m3Score?.fairnessScore, 0)

    // Food-only, paused, and departed members must NOT be in the scores
    assert.equal(fairness.scores.some((s) => s.memberId === 'm-food'), false)
    assert.equal(fairness.scores.some((s) => s.memberId === 'm-paused'), false)
    assert.equal(fairness.scores.some((s) => s.memberId === 'm-departed'), false)
  })
})
