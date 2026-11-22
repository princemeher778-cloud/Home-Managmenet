import { useState, type FC, type FormEvent } from 'react'
import { getActiveMembers, getAllMembers } from '../../data/mockData.ts'
import type {
  CleaningActivityEvent,
  CleaningDutyAssignment,
  CleaningTaskTemplate,
  HouseholdMember,
  NavSection,
  NthWeekdayOccurrence,
  RecurrencePattern,
  StandardCleaningArea,
  WeekdayIndex,
} from '../../types/index.ts'
import {
  calculateCleaningFairnessScores,
  cancelCleaningDuty,
  completeCleaningDuty,
  createAdHocDutyAssignment,
  type CreateAdHocDutyPayload,
  createCleaningTemplate,
  type CreateTemplatePayload,
  describeRecurrencePattern,
  deriveDutyStatus,
  getTodayCalendarDate,
  isValidCalendarDate,
  previewNextUpcomingDates,
  reassignCleaningDuty,
  recommendFairAssignees,
  STANDARD_CLEANING_AREAS,
  updateCleaningTemplate,
  type UpdateTemplatePayload,
  validateRecurrencePattern,
} from '../../utils/cleaning.ts'
import { Badge } from '../common/Badge'
import { Card, CardContent, CardHeader } from '../common/Card'
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CleaningIcon,
  CloseIcon,
} from '../common/Icons'
import { StatCard } from '../common/StatCard'

interface CleaningViewProps {
  onNavigate: (section: NavSection) => void
  currentDate?: string
  cleaningDuties: CleaningDutyAssignment[]
  setCleaningDuties?: React.Dispatch<React.SetStateAction<CleaningDutyAssignment[]>>
  cleaningTemplates: CleaningTaskTemplate[]
  setCleaningTemplates?: React.Dispatch<React.SetStateAction<CleaningTaskTemplate[]>>
  setCleaningActivityEvents?: React.Dispatch<React.SetStateAction<CleaningActivityEvent[]>>
  members: HouseholdMember[]
  onCreateTemplate?: (payload: CreateTemplatePayload) => { success: boolean; template?: CleaningTaskTemplate; errorMessage?: string }
  onUpdateTemplate?: (template: CleaningTaskTemplate, payload: UpdateTemplatePayload) => { success: boolean; updatedTemplate?: CleaningTaskTemplate; errorMessage?: string }
  onToggleTemplateActive?: (template: CleaningTaskTemplate) => void
  onCreateAdHocDuty?: (payload: CreateAdHocDutyPayload) => { success: boolean; duty?: CleaningDutyAssignment; errorMessage?: string }
  onCompleteDuty?: (duty: CleaningDutyAssignment, actorId?: string, notes?: string) => { success: boolean; errorMessage?: string }
  onReassignDuty?: (duty: CleaningDutyAssignment, newAssigneeIds: string[], actorId: string, reason: string) => { success: boolean; errorMessage?: string }
  onCancelDuty?: (duty: CleaningDutyAssignment, actorId: string, reason: string) => { success: boolean; errorMessage?: string }
}

type CleaningFilterTab = 'all' | 'today' | 'upcoming' | 'overdue' | 'completed' | 'cancelled'

export const CleaningView: FC<CleaningViewProps> = ({
  onNavigate: _onNavigate,
  currentDate,
  cleaningDuties,
  setCleaningDuties,
  cleaningTemplates,
  setCleaningTemplates,
  setCleaningActivityEvents,
  members,
  onCreateTemplate,
  onUpdateTemplate,
  onToggleTemplateActive,
  onCreateAdHocDuty,
  onCompleteDuty,
  onReassignDuty,
  onCancelDuty,
}) => {
  const todayStr = currentDate ?? getTodayCalendarDate()

  const allMembers = getAllMembers(members)
  const activeMembers = getActiveMembers(members)
  const cleaningEligibleMembers = activeMembers.filter((m) => m.isCleaningEligible)
  const memberMap = new Map(allMembers.map((m) => [m.id, m]))

  // UI Filter State
  const [filterTab, setFilterTab] = useState<CleaningFilterTab>('all')
  const [areaFilter, setAreaFilter] = useState<string>('all')
  const [memberFilter, setMemberFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Modals & Panels State
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false)
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(false)
  const [isEditTemplateModalOpen, setIsEditTemplateModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<CleaningTaskTemplate | null>(null)

  const [activeActionDuty, setActiveActionDuty] = useState<CleaningDutyAssignment | null>(null)
  const [actionModalType, setActionModalType] = useState<'complete' | 'reassign' | 'cancel' | 'detail' | null>(null)
  const [modalError, setModalError] = useState<string | null>(null)

  // Completion Form State
  const [completeNotes, setCompleteNotes] = useState('')
  const [completeActorId, setCompleteActorId] = useState(activeMembers[0]?.id ?? 'm1')

  // Reassignment Form State
  const [reassignNewAssigneeIds, setReassignNewAssigneeIds] = useState<string[]>([])
  const [reassignReason, setReassignReason] = useState('')
  const [reassignActorId, setReassignActorId] = useState(activeMembers[0]?.id ?? 'm1')
  const [reassignSuggestionNote, setReassignSuggestionNote] = useState<string | null>(null)

  // Cancellation Form State
  const [cancelReason, setCancelReason] = useState('')
  const [cancelActorId, setCancelActorId] = useState(activeMembers[0]?.id ?? 'm1')

  // Schedule Duty / Template Form State
  const [formIsTemplate, setFormIsTemplate] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formArea, setFormArea] = useState<StandardCleaningArea>('Kitchen')
  const [formDescription, setFormDescription] = useState('')
  const [formInstructions, setFormInstructions] = useState('')
  const [formEstimatedMinutes, setFormEstimatedMinutes] = useState('30')
  const [formAssigneeIds, setFormAssigneeIds] = useState<string[]>([cleaningEligibleMembers[0]?.id ?? 'm1'])
  const [formDueDate, setFormDueDate] = useState(todayStr)
  const [formCreatorId, setFormCreatorId] = useState(activeMembers[0]?.id ?? 'm1')
  const [formFairnessSuggestionNote, setFormFairnessSuggestionNote] = useState<string | null>(null)

  // Recurrence Form State (for recurring tasks / templates)
  const [recurrenceType, setRecurrenceType] = useState<RecurrencePattern['type']>('weekly_weekdays')
  const [recStartDate, setRecStartDate] = useState(todayStr)
  const [recEndDate, setRecEndDate] = useState('')
  const [recMaxOccurrences, setRecMaxOccurrences] = useState('')
  const [recIntervalDays, setRecIntervalDays] = useState('2')
  const [recWeekInterval, setRecWeekInterval] = useState('1')
  const [recSelectedWeekdays, setRecSelectedWeekdays] = useState<WeekdayIndex[]>([6]) // Saturday
  const [recMonthInterval, setRecMonthInterval] = useState('1')
  const [recMonthDays, setRecMonthDays] = useState<number[]>([1, 15])
  const [recShorterMonthPolicy, setRecShorterMonthPolicy] = useState<'clamp_to_last_day' | 'skip'>('clamp_to_last_day')
  const [recNthOccurrence, setRecNthOccurrence] = useState<NthWeekdayOccurrence>('first')
  const [recNthWeekday, setRecNthWeekday] = useState<WeekdayIndex>(6)
  const [recExplicitDates, setRecExplicitDates] = useState<string[]>([])
  const [newExplicitDateInput, setNewExplicitDateInput] = useState('')

  // Build current active RecurrencePattern from form state
  const buildCurrentRecurrencePattern = (): RecurrencePattern => {
    const base = {
      startDate: recStartDate,
      endDate: recEndDate.trim() !== '' ? recEndDate.trim() : undefined,
      maxOccurrences: recMaxOccurrences.trim() !== '' ? parseInt(recMaxOccurrences, 10) : undefined,
    }

    switch (recurrenceType) {
      case 'one_off':
        return { ...base, type: 'one_off', targetDate: formDueDate }
      case 'interval_days':
        return { ...base, type: 'interval_days', intervalDays: parseInt(recIntervalDays, 10) || 1 }
      case 'weekly_weekdays':
        return {
          ...base,
          type: 'weekly_weekdays',
          weekInterval: parseInt(recWeekInterval, 10) || 1,
          selectedWeekdays: recSelectedWeekdays.length > 0 ? recSelectedWeekdays : [6],
        }
      case 'monthly_dates':
        return {
          ...base,
          type: 'monthly_dates',
          monthInterval: parseInt(recMonthInterval, 10) || 1,
          monthDays: recMonthDays.length > 0 ? recMonthDays : [1],
          handleShorterMonths: recShorterMonthPolicy,
        }
      case 'monthly_nth_weekday':
        return {
          ...base,
          type: 'monthly_nth_weekday',
          monthInterval: parseInt(recMonthInterval, 10) || 1,
          nthOccurrence: recNthOccurrence,
          weekday: recNthWeekday,
        }
      case 'custom_dates':
        return {
          ...base,
          type: 'custom_dates',
          explicitDates: recExplicitDates.length > 0 ? recExplicitDates : [todayStr],
        }
    }
  }

  // Derived Overview Counts
  const activeDuties = cleaningDuties.filter((d) => d.status === 'pending')
  const todayDuties = activeDuties.filter((d) => d.dueDate === todayStr)
  const overdueDuties = activeDuties.filter((d) => deriveDutyStatus(d, todayStr) === 'overdue')
  const upcomingDuties = activeDuties.filter((d) => d.dueDate > todayStr)
  const completedDuties = cleaningDuties.filter((d) => d.status === 'completed')
  const cancelledDuties = cleaningDuties.filter((d) => d.status === 'cancelled')

  // Filtered Duties for Display List
  const filteredDuties = cleaningDuties.filter((d) => {
    const derivedStatus = deriveDutyStatus(d, todayStr)

    // Tab filter
    if (filterTab === 'today') {
      if (d.status !== 'pending' || d.dueDate !== todayStr) return false
    } else if (filterTab === 'upcoming') {
      if (d.status !== 'pending' || d.dueDate <= todayStr) return false
    } else if (filterTab === 'overdue') {
      if (derivedStatus !== 'overdue') return false
    } else if (filterTab === 'completed') {
      if (d.status !== 'completed') return false
    } else if (filterTab === 'cancelled') {
      if (d.status !== 'cancelled') return false
    }

    // Area filter
    if (areaFilter !== 'all' && d.area !== areaFilter) return false

    // Member filter
    if (memberFilter !== 'all' && !d.assignedMemberIds.includes(memberFilter)) return false

    // Search query
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase()
      const matchTitle = d.title.toLowerCase().includes(q)
      const matchArea = d.area.toLowerCase().includes(q)
      const matchAssignee = d.assignedMemberNames.some((n) => n.toLowerCase().includes(q))
      if (!matchTitle && !matchArea && !matchAssignee) return false
    }

    return true
  }).sort((a, b) => {
    // Sort: Overdue first, then Today, then Upcoming by due date, completed at the end
    const statusA = deriveDutyStatus(a, todayStr)
    const statusB = deriveDutyStatus(b, todayStr)
    const rank = { overdue: 4, pending: 3, completed: 1, cancelled: 0 }
    if (rank[statusA] !== rank[statusB]) {
      return rank[statusB] - rank[statusA]
    }
    return a.dueDate.localeCompare(b.dueDate)
  })

  // Open Schedule Modal
  const handleOpenScheduleModal = () => {
    setFormIsTemplate(false)
    setFormTitle('')
    setFormArea('Kitchen')
    setFormDescription('')
    setFormInstructions('')
    setFormEstimatedMinutes('30')
    setFormAssigneeIds([cleaningEligibleMembers[0]?.id ?? 'm1'])
    setFormDueDate(todayStr)
    setFormCreatorId(activeMembers[0]?.id ?? 'm1')
    setFormFairnessSuggestionNote(null)
    setRecurrenceType('weekly_weekdays')
    setRecStartDate(todayStr)
    setRecEndDate('')
    setRecMaxOccurrences('')
    setRecIntervalDays('2')
    setRecWeekInterval('1')
    setRecSelectedWeekdays([6])
    setModalError(null)
    setIsScheduleModalOpen(true)
  }

  // Fairness Score Calculation for Eligible Active Members
  const fairnessSummary = calculateCleaningFairnessScores(
    cleaningDuties,
    cleaningEligibleMembers,
    todayStr
  )

  // Handle Fairness Suggestion Click
  const handleAutoSuggestFairAssignee = (mode: 'form' | 'reassign') => {
    const recommended = recommendFairAssignees(cleaningEligibleMembers, fairnessSummary, 1)

    if (recommended.length > 0) {
      const best = recommended[0]
      const score = fairnessSummary.scores.find((s) => s.memberId === best.id)
      const note = `Suggested: ${best.name} (${score?.completedWorkloadMinutes ?? 0}m done, ${score?.outstandingWorkloadMinutes ?? 0}m pending)`

      if (mode === 'form') {
        setFormAssigneeIds([best.id])
        setFormFairnessSuggestionNote(note)
      } else {
        setReassignNewAssigneeIds([best.id])
        setReassignSuggestionNote(note)
      }
    }
  }

  // Submit Schedule / Create Modal
  const handleScheduleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setModalError(null)

    const creator = memberMap.get(formCreatorId)
    const parsedMinutes = parseInt(formEstimatedMinutes, 10)

    if (formIsTemplate) {
      // Create master recurring template
      const schedulePattern = buildCurrentRecurrencePattern()
      if (onCreateTemplate) {
        const result = onCreateTemplate({
          title: formTitle,
          area: formArea,
          description: formDescription,
          instructions: formInstructions,
          estimatedMinutes: parsedMinutes,
          schedule: schedulePattern,
          defaultAssigneeMemberIds: formAssigneeIds,
          createdByMembershipId: formCreatorId,
          createdByName: creator?.name ?? 'Household Member',
        })

        if (!result.success) {
          setModalError(result.errorMessage ?? 'Failed to create task template.')
          return
        }
        setIsScheduleModalOpen(false)
      } else {
        const result = createCleaningTemplate(
          {
            title: formTitle,
            area: formArea,
            description: formDescription,
            instructions: formInstructions,
            estimatedMinutes: parsedMinutes,
            schedule: schedulePattern,
            defaultAssigneeMemberIds: formAssigneeIds,
            createdByMembershipId: formCreatorId,
            createdByName: creator?.name ?? 'Household Member',
          },
          members
        )

        if (!result.success || !result.template) {
          setModalError(result.errorMessage ?? 'Failed to create task template.')
          return
        }

        if (setCleaningTemplates) {
          setCleaningTemplates((prev) => [result.template!, ...prev])
        }
        setIsScheduleModalOpen(false)
      }
    } else {
      // Create Ad-Hoc Duty Instance
      if (onCreateAdHocDuty) {
        const result = onCreateAdHocDuty({
          title: formTitle,
          area: formArea,
          instructions: formInstructions,
          estimatedMinutes: parsedMinutes,
          assignedMemberIds: formAssigneeIds,
          dueDate: formDueDate,
          createdByMembershipId: formCreatorId,
          createdByName: creator?.name ?? 'Household Member',
        })

        if (!result.success) {
          setModalError(result.errorMessage ?? 'Failed to schedule duty.')
          return
        }
        setIsScheduleModalOpen(false)
      } else {
        const result = createAdHocDutyAssignment(
          {
            title: formTitle,
            area: formArea,
            instructions: formInstructions,
            estimatedMinutes: parsedMinutes,
            assignedMemberIds: formAssigneeIds,
            dueDate: formDueDate,
            createdByMembershipId: formCreatorId,
            createdByName: creator?.name ?? 'Household Member',
          },
          members
        )

        if (!result.success || !result.duty) {
          setModalError(result.errorMessage ?? 'Failed to schedule duty.')
          return
        }

        if (setCleaningDuties) {
          setCleaningDuties((prev) => [result.duty!, ...prev])
        }
        if (result.activityEvent && setCleaningActivityEvents) {
          setCleaningActivityEvents((prev) => [result.activityEvent!, ...prev])
        }
        setIsScheduleModalOpen(false)
      }
    }
  }

  // Open Complete Modal
  const handleOpenCompleteModal = (duty: CleaningDutyAssignment) => {
    setActiveActionDuty(duty)
    setActionModalType('complete')
    setCompleteNotes('')
    setCompleteActorId(activeMembers[0]?.id ?? 'm1')
    setModalError(null)
  }

  // Commit Complete
  const handleCompleteSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!activeActionDuty) return
    setModalError(null)

    if (onCompleteDuty) {
      const result = onCompleteDuty(activeActionDuty, completeActorId, completeNotes)
      if (!result.success) {
        setModalError(result.errorMessage ?? 'Failed to mark duty as completed.')
        return
      }
    } else {
      const result = completeCleaningDuty(
        activeActionDuty,
        completeActorId,
        members,
        completeNotes
      )

      if (!result.success || !result.updatedDuty) {
        setModalError(result.errorMessage ?? 'Failed to mark duty as completed.')
        return
      }

      if (setCleaningDuties) {
        setCleaningDuties((prev) =>
          prev.map((d) => (d.id === result.updatedDuty!.id ? result.updatedDuty! : d))
        )
      }
      if (result.activityEvent && setCleaningActivityEvents) {
        setCleaningActivityEvents((prev) => [result.activityEvent!, ...prev])
      }
    }
    setActionModalType(null)
    setActiveActionDuty(null)
  }

  // Open Reassign Modal
  const handleOpenReassignModal = (duty: CleaningDutyAssignment) => {
    setActiveActionDuty(duty)
    setActionModalType('reassign')
    setReassignNewAssigneeIds([])
    setReassignReason('')
    setReassignActorId(activeMembers[0]?.id ?? 'm1')
    setReassignSuggestionNote(null)
    setModalError(null)
  }

  // Commit Reassign
  const handleReassignSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!activeActionDuty) return
    setModalError(null)

    if (onReassignDuty) {
      const result = onReassignDuty(
        activeActionDuty,
        reassignNewAssigneeIds,
        reassignActorId,
        reassignReason
      )
      if (!result.success) {
        setModalError(result.errorMessage ?? 'Failed to reassign duty.')
        return
      }
    } else {
      const result = reassignCleaningDuty(
        activeActionDuty,
        reassignNewAssigneeIds,
        reassignActorId,
        members,
        reassignReason
      )

      if (!result.success || !result.updatedDuty) {
        setModalError(result.errorMessage ?? 'Failed to reassign duty.')
        return
      }

      if (setCleaningDuties) {
        setCleaningDuties((prev) =>
          prev.map((d) => (d.id === result.updatedDuty!.id ? result.updatedDuty! : d))
        )
      }
      if (result.activityEvent && setCleaningActivityEvents) {
        setCleaningActivityEvents((prev) => [result.activityEvent!, ...prev])
      }
    }
    setActionModalType(null)
    setActiveActionDuty(null)
  }

  // Open Cancel Modal
  const handleOpenCancelModal = (duty: CleaningDutyAssignment) => {
    setActiveActionDuty(duty)
    setActionModalType('cancel')
    setCancelReason('')
    setCancelActorId(activeMembers[0]?.id ?? 'm1')
    setModalError(null)
  }

  // Commit Cancel
  const handleCancelSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!activeActionDuty) return
    setModalError(null)

    if (onCancelDuty) {
      const result = onCancelDuty(activeActionDuty, cancelActorId, cancelReason)
      if (!result.success) {
        setModalError(result.errorMessage ?? 'Failed to cancel duty.')
        return
      }
    } else {
      const result = cancelCleaningDuty(
        activeActionDuty,
        cancelActorId,
        members,
        cancelReason
      )

      if (!result.success || !result.updatedDuty) {
        setModalError(result.errorMessage ?? 'Failed to cancel duty.')
        return
      }

      if (setCleaningDuties) {
        setCleaningDuties((prev) =>
          prev.map((d) => (d.id === result.updatedDuty!.id ? result.updatedDuty! : d))
        )
      }
      if (result.activityEvent && setCleaningActivityEvents) {
        setCleaningActivityEvents((prev) => [result.activityEvent!, ...prev])
      }
    }
    setActionModalType(null)
    setActiveActionDuty(null)
  }

  // Open Detail Drawer
  const handleOpenDetail = (duty: CleaningDutyAssignment) => {
    setActiveActionDuty(duty)
    setActionModalType('detail')
  }

  // Open Edit Template Modal
  const handleOpenEditTemplate = (tmpl: CleaningTaskTemplate) => {
    setEditingTemplate(tmpl)
    setFormTitle(tmpl.title)
    setFormArea((tmpl.area as StandardCleaningArea) || 'Kitchen')
    setFormDescription(tmpl.description ?? '')
    setFormInstructions(tmpl.instructions ?? '')
    setFormEstimatedMinutes(tmpl.estimatedMinutes.toString())
    setFormAssigneeIds(tmpl.defaultAssigneeMemberIds ?? [])

    setRecurrenceType(tmpl.schedule.type)
    setRecStartDate(tmpl.schedule.startDate)
    setRecEndDate(tmpl.schedule.endDate ?? '')
    setRecMaxOccurrences(tmpl.schedule.maxOccurrences ? tmpl.schedule.maxOccurrences.toString() : '')

    if (tmpl.schedule.type === 'interval_days') {
      setRecIntervalDays(tmpl.schedule.intervalDays.toString())
    } else if (tmpl.schedule.type === 'weekly_weekdays') {
      setRecWeekInterval(tmpl.schedule.weekInterval.toString())
      setRecSelectedWeekdays(tmpl.schedule.selectedWeekdays)
    } else if (tmpl.schedule.type === 'monthly_dates') {
      setRecMonthInterval((tmpl.schedule.monthInterval ?? 1).toString())
      setRecMonthDays(tmpl.schedule.monthDays)
      setRecShorterMonthPolicy(tmpl.schedule.handleShorterMonths)
    } else if (tmpl.schedule.type === 'monthly_nth_weekday') {
      setRecMonthInterval((tmpl.schedule.monthInterval ?? 1).toString())
      setRecNthOccurrence(tmpl.schedule.nthOccurrence)
      setRecNthWeekday(tmpl.schedule.weekday)
    } else if (tmpl.schedule.type === 'custom_dates') {
      setRecExplicitDates(tmpl.schedule.explicitDates)
    }

    setModalError(null)
    setIsEditTemplateModalOpen(true)
  }

  // Commit Edit Template
  const handleEditTemplateSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!editingTemplate) return
    setModalError(null)

    const updatedSchedule = buildCurrentRecurrencePattern()
    if (onUpdateTemplate) {
      const result = onUpdateTemplate(editingTemplate, {
        title: formTitle,
        area: formArea,
        description: formDescription,
        instructions: formInstructions,
        estimatedMinutes: parseInt(formEstimatedMinutes, 10) || 30,
        schedule: updatedSchedule,
        defaultAssigneeMemberIds: formAssigneeIds,
        isActive: editingTemplate.isActive,
      })

      if (!result.success) {
        setModalError(result.errorMessage ?? 'Failed to update template.')
        return
      }
      setIsEditTemplateModalOpen(false)
      setEditingTemplate(null)
    } else {
      const result = updateCleaningTemplate(
        editingTemplate,
        {
          title: formTitle,
          area: formArea,
          description: formDescription,
          instructions: formInstructions,
          estimatedMinutes: parseInt(formEstimatedMinutes, 10) || 30,
          schedule: updatedSchedule,
          defaultAssigneeMemberIds: formAssigneeIds,
          isActive: editingTemplate.isActive,
        },
        members
      )

      if (!result.success || !result.updatedTemplate) {
        setModalError(result.errorMessage ?? 'Failed to update template.')
        return
      }

      if (setCleaningTemplates) {
        setCleaningTemplates((prev) =>
          prev.map((t) => (t.id === result.updatedTemplate!.id ? result.updatedTemplate! : t))
        )
      }
      setIsEditTemplateModalOpen(false)
      setEditingTemplate(null)
    }
  }

  // Toggle Template Active State
  const handleToggleTemplateActive = (tmpl: CleaningTaskTemplate) => {
    if (onToggleTemplateActive) {
      onToggleTemplateActive(tmpl)
    } else if (setCleaningTemplates) {
      setCleaningTemplates((prev) =>
        prev.map((t) => (t.id === tmpl.id ? { ...t, isActive: !t.isActive } : t))
      )
    }
  }

  // Preview next 5 upcoming dates
  const activePattern = buildCurrentRecurrencePattern()
  const patternValidation = validateRecurrencePattern(activePattern)
  const previewDates = patternValidation.isValid
    ? previewNextUpcomingDates(activePattern, 5, todayStr)
    : []

  const totalTrackedDuties = cleaningDuties.length || 1
  const completionRatePercent = Math.round((completedDuties.length / totalTrackedDuties) * 100)

  return (
    <div className="home-fund-view-container">
      {/* 1. Tasknur Cleaning & Rosters Hero Card */}
      <div className="tasknur-hero-card">
        <div className="tasknur-hero-content">
          <span className="tasknur-hero-eyebrow">Cleaning & Duty Rosters</span>
          <h2 className="tasknur-hero-title">
            {todayDuties.length + overdueDuties.length > 0
              ? `${todayDuties.length + overdueDuties.length} Chores Pending Action`
              : 'All Household Chores Complete!'}
          </h2>
          <p className="tasknur-hero-subtitle">
            {overdueDuties.length > 0
              ? `${overdueDuties.length} overdue chores need urgent attention · ${todayDuties.length} due today`
              : `${todayDuties.length} chores due today · ${completedDuties.length} completed chores logged`}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button
              type="button"
              className="tasknur-hero-action-btn"
              onClick={handleOpenScheduleModal}
            >
              + Schedule Chore
            </button>
          </div>
        </div>
        <div className="tasknur-hero-progress-ring">
          <svg className="progress-ring-svg" width="84" height="84" viewBox="0 0 84 84">
            <circle
              className="progress-ring-bg"
              cx="42"
              cy="42"
              r="34"
              strokeWidth="6"
            />
            <circle
              className="progress-ring-fill"
              cx="42"
              cy="42"
              r="34"
              strokeWidth="6"
              strokeDasharray={213.63}
              strokeDashoffset={213.63 * (1 - completionRatePercent / 100)}
            />
          </svg>
          <div className="progress-ring-label">
            <span className="progress-ring-number">{completionRatePercent}%</span>
            <span className="progress-ring-text">Clean</span>
          </div>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="dashboard-stats-grid">
        <StatCard
          label="Due Today"
          amount={todayDuties.length}
          currency=""
          subtitle={todayDuties.length === 1 ? '1 chore due today' : `${todayDuties.length} chores due today`}
          icon={<CleaningIcon size={20} />}
          highlightTag={todayDuties.length > 0 ? 'Action Needed' : 'All Clear'}
        />
        <StatCard
          label="Overdue Chores"
          amount={overdueDuties.length}
          currency=""
          subtitle={overdueDuties.length === 1 ? '1 overdue chore' : `${overdueDuties.length} overdue chores`}
          icon={<AlertTriangleIcon size={20} />}
          accent={overdueDuties.length > 0}
          highlightTag={overdueDuties.length > 0 ? 'Urgent' : 'None'}
        />
        <StatCard
          label="Upcoming Chores"
          amount={upcomingDuties.length}
          currency=""
          subtitle={upcomingDuties.length === 1 ? '1 upcoming chore' : `${upcomingDuties.length} upcoming chores`}
          icon={<CleaningIcon size={20} />}
          highlightTag={upcomingDuties.length === 1 ? '1 Scheduled' : `${upcomingDuties.length} Scheduled`}
        />
        <StatCard
          label="Completed Chores"
          amount={completedDuties.length}
          currency=""
          subtitle={completedDuties.length === 1 ? '1 completed chore' : `${completedDuties.length} completed chores`}
          icon={<CheckCircleIcon size={20} />}
          highlightTag={completedDuties.length === 1 ? '1 Done' : `${completedDuties.length} Done`}
        />
      </div>

      {/* Main Cleaning Management Card */}
      <Card>
        <CardHeader
          title="Household Cleaning Schedule & Roster"
          subtitle="Fair chore distribution, recurring routines, and multi-member audit trails"
          action={
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setIsTemplatesModalOpen(true)}
              >
                Manage Templates ({cleaningTemplates.length})
              </button>
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={handleOpenScheduleModal}
              >
                + Schedule Duty
              </button>
            </div>
          }
        />
        <CardContent>
          {/* Action Bar & Filter Tabs */}
          <div className="home-fund-action-bar" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="filter-tabs-row" style={{ margin: 0, padding: 0, border: 'none' }}>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'all' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('all')}
              >
                All ({cleaningDuties.length})
              </button>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'today' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('today')}
              >
                Today ({todayDuties.length})
              </button>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'overdue' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('overdue')}
              >
                Overdue ({overdueDuties.length})
              </button>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'upcoming' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('upcoming')}
              >
                Upcoming ({upcomingDuties.length})
              </button>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'completed' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('completed')}
              >
                Completed ({completedDuties.length})
              </button>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'cancelled' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('cancelled')}
              >
                Cancelled ({cancelledDuties.length})
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {/* Search */}
              <input
                type="text"
                placeholder="Search duties or member..."
                className="form-input"
                style={{ width: '180px', padding: '4px 8px', fontSize: '0.7813rem' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              {/* Area Filter */}
              <select
                className="form-select"
                style={{ width: 'auto', padding: '4px 8px', fontSize: '0.7813rem' }}
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
              >
                <option value="all">All Areas</option>
                {STANDARD_CLEANING_AREAS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>

              {/* Member Filter */}
              <select
                className="form-select"
                style={{ width: 'auto', padding: '4px 8px', fontSize: '0.7813rem' }}
                value={memberFilter}
                onChange={(e) => setMemberFilter(e.target.value)}
              >
                <option value="all">All Members</option>
                {activeMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {!m.isCleaningEligible ? '(Ineligible)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Duty List / Ledger */}
          {filteredDuties.length === 0 ? (
            <div className="queue-empty-state">
              No cleaning duties found matching the selected filter criteria.
            </div>
          ) : (
            <div className="ledger-list">
              {filteredDuties.map((duty) => {
                const derivedStatus = deriveDutyStatus(duty, todayStr)
                const isOverdue = derivedStatus === 'overdue'

                return (
                  <div
                    key={duty.id}
                    className={`ledger-item-row ${isOverdue ? 'ledger-row-refund' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleOpenDetail(duty)}
                  >
                    <div className="ledger-item-left">
                      <div
                        className="expense-icon-badge"
                        style={{
                          backgroundColor:
                            duty.status === 'completed'
                              ? 'var(--color-success-bg)'
                              : isOverdue
                              ? 'var(--color-danger-bg)'
                              : duty.status === 'cancelled'
                              ? 'var(--color-bg-subtle)'
                              : 'var(--color-bg-surface)',
                          color:
                            duty.status === 'completed'
                              ? 'var(--color-success-text)'
                              : isOverdue
                              ? 'var(--color-danger-text)'
                              : duty.status === 'cancelled'
                              ? 'var(--color-text-muted)'
                              : 'var(--color-accent-primary)',
                        }}
                      >
                        <CleaningIcon size={16} />
                      </div>

                      <div className="ledger-item-details">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span className="expense-title">{duty.title}</span>
                          <Badge variant="neutral">{duty.area}</Badge>
                          {duty.status === 'completed' && <Badge variant="success">Completed</Badge>}
                          {duty.status === 'cancelled' && <Badge variant="neutral">Cancelled</Badge>}
                          {duty.status === 'pending' && isOverdue && <Badge variant="danger">Overdue</Badge>}
                          {duty.status === 'pending' && !isOverdue && duty.dueDate === todayStr && (
                            <Badge variant="warning">Due Today</Badge>
                          )}
                          {duty.status === 'pending' && !isOverdue && duty.dueDate > todayStr && (
                            <Badge variant="neutral">Upcoming</Badge>
                          )}
                          {duty.reassignmentHistory.length > 0 && (
                            <Badge variant="info">Reassigned ({duty.reassignmentHistory.length})</Badge>
                          )}
                        </div>

                        <div className="expense-meta-line">
                          <span>
                            Assigned to: <strong>{duty.assignedMemberNames.join(', ') || 'Unassigned'}</strong>
                          </span>
                          <span className="bullet-sep">·</span>
                          <span>Est. {duty.estimatedMinutes} mins</span>
                          {duty.status === 'completed' && duty.completedByName && (
                            <>
                              <span className="bullet-sep">·</span>
                              <span>Done by {duty.completedByName}</span>
                            </>
                          )}
                          {duty.status === 'cancelled' && duty.cancellationReason && (
                            <>
                              <span className="bullet-sep">·</span>
                              <span>Reason: {duty.cancellationReason}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <div className="expense-item-right">
                        <span
                          className="expense-amount"
                          style={{
                            fontSize: '0.9375rem',
                            color: isOverdue ? 'var(--color-danger-text)' : 'var(--color-text-primary)',
                          }}
                        >
                          Due: {duty.dueDate === todayStr ? 'Today' : duty.dueDate}
                        </span>
                        <span className="expense-split-tag">
                          {duty.status === 'pending'
                            ? isOverdue
                              ? 'Action Overdue'
                              : 'Pending'
                            : duty.status.toUpperCase()}
                        </span>
                      </div>

                      {/* Quick Actions (only for pending duties) */}
                      {duty.status === 'pending' && (
                        <div style={{ display: 'flex', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            style={{ color: 'var(--color-success-text)' }}
                            title="Mark duty completed"
                            onClick={() => handleOpenCompleteModal(duty)}
                          >
                            ✓ Done
                          </button>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            title="Reassign duty to another member"
                            onClick={() => handleOpenReassignModal(duty)}
                          >
                            Reassign
                          </button>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            style={{ color: 'var(--color-danger-text)' }}
                            title="Cancel duty with reason"
                            onClick={() => handleOpenCancelModal(duty)}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ==========================================================================
          Fairness Workload Panel
          ========================================================================== */}
      <Card>
        <CardHeader
          title="Cleaning Workload & Fairness Distribution"
          subtitle={`Rolling 30-day completed workload (${fairnessSummary.thirtyDayWindowStart} to ${todayStr}) and lifetime outstanding workload`}
          badge={<Badge variant="neutral">{fairnessSummary.scores.length} Eligible Members</Badge>}
        />
        <CardContent>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--space-3)' }}>
            {fairnessSummary.scores.map((score) => {
              const mem = memberMap.get(score.memberId)
              return (
                <div
                  key={score.memberId}
                  style={{
                    padding: 'var(--space-3)',
                    backgroundColor: 'var(--color-bg-canvas)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <div className="member-avatar" style={{ width: '28px', height: '28px', fontSize: '0.75rem' }}>
                        {mem?.avatarInitial ?? score.memberName.slice(0, 1)}
                      </div>
                      <div>
                        <span style={{ fontWeight: 600, fontSize: '0.875rem', display: 'block' }}>{score.memberName}</span>
                        <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                          {mem?.isResident ? `Resident (${mem.roomLabel ?? 'Room'})` : 'Participant'}
                        </span>
                      </div>
                    </div>
                    <Badge variant="neutral">Score: {score.fairnessScore}</Badge>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', fontSize: '0.75rem', marginTop: 'var(--space-1)' }}>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)', display: 'block' }}>30-Day Completed</span>
                      <span style={{ fontWeight: 600, color: 'var(--color-success-text)' }}>
                        {score.completedWorkloadMinutes} mins
                      </span>
                    </div>
                    <div>
                      <span style={{ color: 'var(--color-text-muted)', display: 'block' }}>Outstanding Workload</span>
                      <span style={{ fontWeight: 600, color: 'var(--color-warning-text)' }}>
                        {score.outstandingWorkloadMinutes} mins
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* ==========================================================================
          Schedule Duty / Create Template Modal
          ========================================================================== */}
      {isScheduleModalOpen && (
        <div className="modal-overlay" onClick={() => setIsScheduleModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '620px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                {formIsTemplate ? 'Create Recurring Cleaning Template' : 'Schedule Cleaning Duty'}
              </h3>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setIsScheduleModalOpen(false)}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleScheduleSubmit}>
              <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
                {modalError && (
                  <div
                    className="demo-notice-banner"
                    style={{
                      margin: 0,
                      marginBottom: 'var(--space-3)',
                      borderColor: 'var(--color-danger-border)',
                      backgroundColor: 'var(--color-danger-bg)',
                    }}
                  >
                    <span className="notice-text" style={{ color: 'var(--color-danger-text)' }}>
                      <strong>Validation Error:</strong> {modalError}
                    </span>
                  </div>
                )}

                {/* Mode Selector Toggle */}
                <div className="form-group" style={{ marginBottom: 'var(--space-3)' }}>
                  <label className="form-label">Scheduling Type</label>
                  <div className="filter-tabs-row" style={{ margin: 0, padding: 0, border: 'none' }}>
                    <button
                      type="button"
                      className={`filter-tab-btn ${!formIsTemplate ? 'filter-tab-btn-active' : ''}`}
                      onClick={() => setFormIsTemplate(false)}
                    >
                      Single Chore Instance
                    </button>
                    <button
                      type="button"
                      className={`filter-tab-btn ${formIsTemplate ? 'filter-tab-btn-active' : ''}`}
                      onClick={() => setFormIsTemplate(true)}
                    >
                      Recurring Template Routine
                    </button>
                  </div>
                </div>

                {/* Title */}
                <div className="form-group">
                  <label className="form-label" htmlFor="cln-title">
                    Chore Title *
                  </label>
                  <input
                    id="cln-title"
                    type="text"
                    placeholder="e.g. Kitchen Counters, Stove & Sink Deep Scrub"
                    className="form-input"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    required
                  />
                </div>

                {/* Area & Duration */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="cln-area">
                      Cleaning Area *
                    </label>
                    <select
                      id="cln-area"
                      className="form-select"
                      value={formArea}
                      onChange={(e) => setFormArea(e.target.value as StandardCleaningArea)}
                    >
                      {STANDARD_CLEANING_AREAS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="cln-est">
                      Estimated Duration (Mins) *
                    </label>
                    <input
                      id="cln-est"
                      type="number"
                      min="1"
                      max="720"
                      className="form-input"
                      value={formEstimatedMinutes}
                      onChange={(e) => setFormEstimatedMinutes(e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* Multi-Assignee Selection with Auto-Suggest */}
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label className="form-label" style={{ margin: 0 }}>
                      Assigned Members (Active & Cleaning-Eligible) *
                    </label>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => handleAutoSuggestFairAssignee('form')}
                      style={{ fontSize: '0.6875rem', padding: '2px 8px' }}
                    >
                      ⚡ Auto-Suggest Fair Assignee
                    </button>
                  </div>

                  {formFairnessSuggestionNote && (
                    <div style={{ fontSize: '0.6875rem', color: 'var(--color-accent-primary)', marginBottom: '6px' }}>
                      {formFairnessSuggestionNote}
                    </div>
                  )}

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                    {cleaningEligibleMembers.map((m) => {
                      const isSelected = formAssigneeIds.includes(m.id)
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`filter-tab-btn ${isSelected ? 'filter-tab-btn-active' : ''}`}
                          style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                          onClick={() => {
                            if (isSelected) {
                              if (formAssigneeIds.length > 1) {
                                setFormAssigneeIds(formAssigneeIds.filter((id) => id !== m.id))
                              }
                            } else {
                              setFormAssigneeIds([...formAssigneeIds, m.id])
                            }
                          }}
                        >
                          {isSelected ? '✓ ' : '+ '}
                          {m.name}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Due Date (for single duty) */}
                {!formIsTemplate && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="cln-due-date">
                      Scheduled Due Date (YYYY-MM-DD) *
                    </label>
                    <input
                      id="cln-due-date"
                      type="text"
                      className="form-input"
                      value={formDueDate}
                      onChange={(e) => setFormDueDate(e.target.value)}
                      placeholder={`e.g. ${todayStr}`}
                      required
                    />
                  </div>
                )}

                {/* Recurrence Pattern Configuration (for recurring templates) */}
                {formIsTemplate && (
                  <div
                    style={{
                      padding: 'var(--space-3)',
                      backgroundColor: 'var(--color-bg-canvas)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border-subtle)',
                      marginBottom: 'var(--space-3)',
                    }}
                  >
                    <span style={{ fontSize: '0.7813rem', fontWeight: 600, color: 'var(--color-text-primary)', display: 'block', marginBottom: '8px' }}>
                      Recurrence Schedule Pattern
                    </span>

                    <div className="form-group">
                      <label className="form-label" htmlFor="cln-rec-type">
                        Recurrence Mode
                      </label>
                      <select
                        id="cln-rec-type"
                        className="form-select"
                        value={recurrenceType}
                        onChange={(e) => setRecurrenceType(e.target.value as RecurrencePattern['type'])}
                      >
                        <option value="weekly_weekdays">Weekly on Specific Weekday(s)</option>
                        <option value="interval_days">Every N Days</option>
                        <option value="monthly_dates">Monthly on Specific Calendar Dates</option>
                        <option value="monthly_nth_weekday">Monthly on N-th Weekday</option>
                        <option value="custom_dates">Custom Specific Dates</option>
                        <option value="one_off">One-Off Single Date</option>
                      </select>
                    </div>

                    {/* Mode Specific Controls */}
                    {recurrenceType === 'interval_days' && (
                      <div className="form-group">
                        <label className="form-label" htmlFor="rec-int-days">
                          Repeat Every N Days *
                        </label>
                        <input
                          id="rec-int-days"
                          type="number"
                          min="1"
                          className="form-input"
                          value={recIntervalDays}
                          onChange={(e) => setRecIntervalDays(e.target.value)}
                        />
                      </div>
                    )}

                    {recurrenceType === 'weekly_weekdays' && (
                      <div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="rec-week-int">
                            Week Interval (Every N Weeks) *
                          </label>
                          <input
                            id="rec-week-int"
                            type="number"
                            min="1"
                            className="form-input"
                            value={recWeekInterval}
                            onChange={(e) => setRecWeekInterval(e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">
                            Selected Weekdays (Monday = 1 ... Sunday = 7) *
                          </label>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {[
                              { idx: 1 as WeekdayIndex, label: 'Mon' },
                              { idx: 2 as WeekdayIndex, label: 'Tue' },
                              { idx: 3 as WeekdayIndex, label: 'Wed' },
                              { idx: 4 as WeekdayIndex, label: 'Thu' },
                              { idx: 5 as WeekdayIndex, label: 'Fri' },
                              { idx: 6 as WeekdayIndex, label: 'Sat' },
                              { idx: 7 as WeekdayIndex, label: 'Sun' },
                            ].map(({ idx, label }) => {
                              const isChecked = recSelectedWeekdays.includes(idx)
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  className={`filter-tab-btn ${isChecked ? 'filter-tab-btn-active' : ''}`}
                                  style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                                  onClick={() => {
                                    if (isChecked) {
                                      if (recSelectedWeekdays.length > 1) {
                                        setRecSelectedWeekdays(recSelectedWeekdays.filter((d) => d !== idx))
                                      }
                                    } else {
                                      setRecSelectedWeekdays([...recSelectedWeekdays, idx])
                                    }
                                  }}
                                >
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {recurrenceType === 'monthly_dates' && (
                      <div>
                        <div className="form-group">
                          <label className="form-label">Calendar Days of Month *</label>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', maxHeight: '100px', overflowY: 'auto' }}>
                            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => {
                              const isSelected = recMonthDays.includes(d)
                              return (
                                <button
                                  key={d}
                                  type="button"
                                  className={`filter-tab-btn ${isSelected ? 'filter-tab-btn-active' : ''}`}
                                  style={{ padding: '2px 6px', fontSize: '0.6875rem' }}
                                  onClick={() => {
                                    if (isSelected) {
                                      if (recMonthDays.length > 1) {
                                        setRecMonthDays(recMonthDays.filter((x) => x !== d))
                                      }
                                    } else {
                                      setRecMonthDays([...recMonthDays, d])
                                    }
                                  }}
                                >
                                  {d}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="rec-month-policy">
                            Shorter Month Policy (e.g. Day 31 in Feb)
                          </label>
                          <select
                            id="rec-month-policy"
                            className="form-select"
                            value={recShorterMonthPolicy}
                            onChange={(e) =>
                              setRecShorterMonthPolicy(e.target.value as 'clamp_to_last_day' | 'skip')
                            }
                          >
                            <option value="clamp_to_last_day">Clamp to last day of month (e.g. Feb 28)</option>
                            <option value="skip">Skip occurrence if day does not exist</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {recurrenceType === 'monthly_nth_weekday' && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div className="form-group">
                          <label className="form-label" htmlFor="rec-nth-occ">
                            Occurrence
                          </label>
                          <select
                            id="rec-nth-occ"
                            className="form-select"
                            value={recNthOccurrence}
                            onChange={(e) => setRecNthOccurrence(e.target.value as NthWeekdayOccurrence)}
                          >
                            <option value="first">First</option>
                            <option value="second">Second</option>
                            <option value="third">Third</option>
                            <option value="fourth">Fourth</option>
                            <option value="last">Last</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label className="form-label" htmlFor="rec-nth-wd">
                            Weekday
                          </label>
                          <select
                            id="rec-nth-wd"
                            className="form-select"
                            value={recNthWeekday}
                            onChange={(e) => setRecNthWeekday(parseInt(e.target.value, 10) as WeekdayIndex)}
                          >
                            <option value={1}>Monday</option>
                            <option value={2}>Tuesday</option>
                            <option value={3}>Wednesday</option>
                            <option value={4}>Thursday</option>
                            <option value={5}>Friday</option>
                            <option value={6}>Saturday</option>
                            <option value={7}>Sunday</option>
                          </select>
                        </div>
                      </div>
                    )}

                    {recurrenceType === 'custom_dates' && (
                      <div className="form-group">
                        <label className="form-label">Explicit Custom Dates</label>
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                          <input
                            type="text"
                            placeholder="YYYY-MM-DD"
                            className="form-input"
                            value={newExplicitDateInput}
                            onChange={(e) => setNewExplicitDateInput(e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => {
                              if (isValidCalendarDate(newExplicitDateInput) && !recExplicitDates.includes(newExplicitDateInput)) {
                                setRecExplicitDates([...recExplicitDates, newExplicitDateInput].sort())
                                setNewExplicitDateInput('')
                              }
                            }}
                          >
                            + Add Date
                          </button>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {recExplicitDates.map((d) => (
                            <Badge key={d} variant="neutral">
                              {d}{' '}
                              <span
                                style={{ cursor: 'pointer', marginLeft: '4px' }}
                                onClick={() => setRecExplicitDates(recExplicitDates.filter((x) => x !== d))}
                              >
                                ×
                              </span>
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Start Date & Bounds */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
                      <div className="form-group">
                        <label className="form-label" htmlFor="rec-start-date">
                          Start Date *
                        </label>
                        <input
                          id="rec-start-date"
                          type="text"
                          className="form-input"
                          value={recStartDate}
                          onChange={(e) => setRecStartDate(e.target.value)}
                          placeholder="YYYY-MM-DD"
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="rec-end-date">
                          End Date (Optional)
                        </label>
                        <input
                          id="rec-end-date"
                          type="text"
                          className="form-input"
                          value={recEndDate}
                          onChange={(e) => setRecEndDate(e.target.value)}
                          placeholder="YYYY-MM-DD"
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="rec-max-occ">
                        Max Lifetime Occurrences (Optional)
                      </label>
                      <input
                        id="rec-max-occ"
                        type="number"
                        min="1"
                        className="form-input"
                        value={recMaxOccurrences}
                        onChange={(e) => setRecMaxOccurrences(e.target.value)}
                        placeholder="e.g. 10 (blank for unlimited)"
                      />
                    </div>

                    {/* Live Preview Box */}
                    <div
                      style={{
                        padding: '8px',
                        backgroundColor: 'var(--color-bg-subtle)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.75rem',
                        marginTop: '8px',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', display: 'block', marginBottom: '2px' }}>
                        Schedule Preview:
                      </span>
                      <p style={{ margin: '0 0 4px 0', color: 'var(--color-text-secondary)' }}>
                        {describeRecurrencePattern(activePattern)}
                      </p>
                      <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                        Next upcoming dates:{' '}
                        <strong>{previewDates.length > 0 ? previewDates.join(', ') : 'None within window'}</strong>
                      </span>
                    </div>
                  </div>
                )}

                {/* Instructions */}
                <div className="form-group">
                  <label className="form-label" htmlFor="cln-inst">
                    Instructions / Guidelines (Optional)
                  </label>
                  <textarea
                    id="cln-inst"
                    className="form-textarea"
                    rows={2}
                    placeholder="e.g. Use Colin for glass; wear rubber gloves"
                    value={formInstructions}
                    onChange={(e) => setFormInstructions(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsScheduleModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {formIsTemplate ? 'Save Master Template' : 'Schedule Duty'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================================================
          Manage Task Templates Drawer / Modal
          ========================================================================== */}
      {isTemplatesModalOpen && (
        <div className="modal-overlay" onClick={() => setIsTemplatesModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Master Cleaning Task Templates ({cleaningTemplates.length})</h3>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setIsTemplatesModalOpen(false)}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {cleaningTemplates.map((tmpl) => (
                  <div
                    key={tmpl.id}
                    style={{
                      padding: '10px 14px',
                      backgroundColor: 'var(--color-bg-canvas)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border-subtle)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{tmpl.title}</span>
                        <Badge variant="neutral">{tmpl.area}</Badge>
                        <Badge variant={tmpl.isActive ? 'success' : 'warning'}>
                          {tmpl.isActive ? 'Active' : 'Paused'}
                        </Badge>
                        <Badge variant="info">v{tmpl.scheduleVersion}</Badge>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                        <span>{describeRecurrencePattern(tmpl.schedule)}</span>
                        <span className="bullet-sep"> · </span>
                        <span>Est. {tmpl.estimatedMinutes} mins</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => handleToggleTemplateActive(tmpl)}
                      >
                        {tmpl.isActive ? 'Pause' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => handleOpenEditTemplate(tmpl)}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => {
                  setIsTemplatesModalOpen(false)
                  setFormIsTemplate(true)
                  setIsScheduleModalOpen(true)
                }}
              >
                + New Recurring Routine
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setIsTemplatesModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          Edit Template Modal
          ========================================================================== */}
      {isEditTemplateModalOpen && editingTemplate && (
        <div className="modal-overlay" onClick={() => setIsEditTemplateModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '620px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Edit Cleaning Routine Template (v{editingTemplate.scheduleVersion})</h3>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setIsEditTemplateModalOpen(false)}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleEditTemplateSubmit}>
              <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
                {modalError && (
                  <div
                    className="demo-notice-banner"
                    style={{
                      margin: 0,
                      marginBottom: 'var(--space-3)',
                      borderColor: 'var(--color-danger-border)',
                      backgroundColor: 'var(--color-danger-bg)',
                    }}
                  >
                    <span className="notice-text" style={{ color: 'var(--color-danger-text)' }}>
                      <strong>Validation Error:</strong> {modalError}
                    </span>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" htmlFor="edit-tmpl-title">
                    Chore Title *
                  </label>
                  <input
                    id="edit-tmpl-title"
                    type="text"
                    className="form-input"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-tmpl-area">
                      Cleaning Area *
                    </label>
                    <select
                      id="edit-tmpl-area"
                      className="form-select"
                      value={formArea}
                      onChange={(e) => setFormArea(e.target.value as StandardCleaningArea)}
                    >
                      {STANDARD_CLEANING_AREAS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-tmpl-est">
                      Estimated Duration (Mins) *
                    </label>
                    <input
                      id="edit-tmpl-est"
                      type="number"
                      min="1"
                      className="form-input"
                      value={formEstimatedMinutes}
                      onChange={(e) => setFormEstimatedMinutes(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="edit-tmpl-inst">
                    Instructions / Guidelines
                  </label>
                  <textarea
                    id="edit-tmpl-inst"
                    className="form-textarea"
                    rows={2}
                    value={formInstructions}
                    onChange={(e) => setFormInstructions(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsEditTemplateModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================================================
          Complete Duty Modal
          ========================================================================== */}
      {actionModalType === 'complete' && activeActionDuty && (
        <div className="modal-overlay" onClick={() => setActionModalType(null)}>
          <div className="modal-card" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Complete Cleaning Duty</h3>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setActionModalType(null)}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleCompleteSubmit}>
              <div className="modal-body">
                {modalError && (
                  <div
                    className="demo-notice-banner"
                    style={{
                      margin: 0,
                      marginBottom: 'var(--space-3)',
                      borderColor: 'var(--color-danger-border)',
                      backgroundColor: 'var(--color-danger-bg)',
                    }}
                  >
                    <span className="notice-text" style={{ color: 'var(--color-danger-text)' }}>
                      <strong>Error:</strong> {modalError}
                    </span>
                  </div>
                )}

                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{activeActionDuty.title}</span>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                    <span>Area: {activeActionDuty.area}</span>
                    <span className="bullet-sep"> · </span>
                    <span>Assigned: {activeActionDuty.assignedMemberNames.join(', ')}</span>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="comp-actor">
                    Verified Done By (Active Member) *
                  </label>
                  <select
                    id="comp-actor"
                    className="form-select"
                    value={completeActorId}
                    onChange={(e) => setCompleteActorId(e.target.value)}
                  >
                    {activeMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="comp-notes">
                    Completion Notes (Optional)
                  </label>
                  <input
                    id="comp-notes"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Cleaned behind refrigerator as well"
                    value={completeNotes}
                    onChange={(e) => setCompleteNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setActionModalType(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ backgroundColor: 'var(--color-success-text)' }}>
                  Mark Completed
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================================================
          Reassign Duty Modal
          ========================================================================== */}
      {actionModalType === 'reassign' && activeActionDuty && (
        <div className="modal-overlay" onClick={() => setActionModalType(null)}>
          <div className="modal-card" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Reassign Cleaning Duty</h3>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setActionModalType(null)}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleReassignSubmit}>
              <div className="modal-body">
                {modalError && (
                  <div
                    className="demo-notice-banner"
                    style={{
                      margin: 0,
                      marginBottom: 'var(--space-3)',
                      borderColor: 'var(--color-danger-border)',
                      backgroundColor: 'var(--color-danger-bg)',
                    }}
                  >
                    <span className="notice-text" style={{ color: 'var(--color-danger-text)' }}>
                      <strong>Error:</strong> {modalError}
                    </span>
                  </div>
                )}

                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{activeActionDuty.title}</span>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                    <span>Currently assigned to: <strong>{activeActionDuty.assignedMemberNames.join(', ')}</strong></span>
                  </div>
                </div>

                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label className="form-label" style={{ margin: 0 }}>
                      New Assignee(s) *
                    </label>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => handleAutoSuggestFairAssignee('reassign')}
                      style={{ fontSize: '0.6875rem', padding: '2px 8px' }}
                    >
                      ⚡ Auto-Suggest Fair Assignee
                    </button>
                  </div>

                  {reassignSuggestionNote && (
                    <div style={{ fontSize: '0.6875rem', color: 'var(--color-accent-primary)', marginBottom: '6px' }}>
                      {reassignSuggestionNote}
                    </div>
                  )}

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {cleaningEligibleMembers.map((m) => {
                      const isSelected = reassignNewAssigneeIds.includes(m.id)
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`filter-tab-btn ${isSelected ? 'filter-tab-btn-active' : ''}`}
                          style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                          onClick={() => {
                            if (isSelected) {
                              setReassignNewAssigneeIds(reassignNewAssigneeIds.filter((id) => id !== m.id))
                            } else {
                              setReassignNewAssigneeIds([...reassignNewAssigneeIds, m.id])
                            }
                          }}
                        >
                          {isSelected ? '✓ ' : '+ '}
                          {m.name}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="reassign-actor">
                    Authorized By *
                  </label>
                  <select
                    id="reassign-actor"
                    className="form-select"
                    value={reassignActorId}
                    onChange={(e) => setReassignActorId(e.target.value)}
                  >
                    {activeMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="reassign-reason">
                    Mandatory Reason (min 4 characters) *
                  </label>
                  <input
                    id="reassign-reason"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Member travelling for work; swapped chore"
                    value={reassignReason}
                    onChange={(e) => setReassignReason(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setActionModalType(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Confirm Reassignment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================================================
          Cancel Duty Modal
          ========================================================================== */}
      {actionModalType === 'cancel' && activeActionDuty && (
        <div className="modal-overlay" onClick={() => setActionModalType(null)}>
          <div className="modal-card" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Cancel Cleaning Duty</h3>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setActionModalType(null)}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleCancelSubmit}>
              <div className="modal-body">
                {modalError && (
                  <div
                    className="demo-notice-banner"
                    style={{
                      margin: 0,
                      marginBottom: 'var(--space-3)',
                      borderColor: 'var(--color-danger-border)',
                      backgroundColor: 'var(--color-danger-bg)',
                    }}
                  >
                    <span className="notice-text" style={{ color: 'var(--color-danger-text)' }}>
                      <strong>Error:</strong> {modalError}
                    </span>
                  </div>
                )}

                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', margin: '0 0 var(--space-3) 0' }}>
                  Are you sure you want to cancel <strong>"{activeActionDuty.title}"</strong>?
                  Cancelled duties preserve their audit history and count toward lifetime recurrence quotas.
                </p>

                <div className="form-group">
                  <label className="form-label" htmlFor="cancel-actor">
                    Cancelled By (Active Member) *
                  </label>
                  <select
                    id="cancel-actor"
                    className="form-select"
                    value={cancelActorId}
                    onChange={(e) => setCancelActorId(e.target.value)}
                  >
                    {activeMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="cancel-reason">
                    Mandatory Cancellation Reason (min 4 characters) *
                  </label>
                  <input
                    id="cancel-reason"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Raining heavily, balcony clean postponed"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setActionModalType(null)}
                >
                  Back
                </button>
                <button type="submit" className="btn-danger">
                  Confirm Cancellation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================================================
          Duty Detail & Reassignment History Modal
          ========================================================================== */}
      {actionModalType === 'detail' && activeActionDuty && (
        <div className="modal-overlay" onClick={() => setActionModalType(null)}>
          <div className="modal-card" style={{ maxWidth: '580px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">{activeActionDuty.title}</h3>
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                  <Badge variant="neutral">{activeActionDuty.area}</Badge>
                  <Badge
                    variant={
                      activeActionDuty.status === 'completed'
                        ? 'success'
                        : activeActionDuty.status === 'cancelled'
                        ? 'neutral'
                        : deriveDutyStatus(activeActionDuty, todayStr) === 'overdue'
                        ? 'danger'
                        : 'warning'
                    }
                  >
                    {activeActionDuty.status === 'pending'
                      ? deriveDutyStatus(activeActionDuty, todayStr).toUpperCase()
                      : activeActionDuty.status.toUpperCase()}
                  </Badge>
                </div>
              </div>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setActionModalType(null)}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3)',
                  backgroundColor: 'var(--color-bg-canvas)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border-subtle)',
                  marginBottom: 'var(--space-3)',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block' }}>
                    Scheduled Due Date
                  </span>
                  <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>{activeActionDuty.dueDate}</span>
                </div>
                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block' }}>
                    Estimated Duration
                  </span>
                  <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>{activeActionDuty.estimatedMinutes} Mins</span>
                </div>
                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block' }}>
                    Current Assignees
                  </span>
                  <span style={{ fontSize: '0.8125rem' }}>{activeActionDuty.assignedMemberNames.join(', ')}</span>
                </div>
                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block' }}>
                    Scheduled By
                  </span>
                  <span style={{ fontSize: '0.8125rem' }}>{activeActionDuty.assignedByName}</span>
                </div>
              </div>

              {activeActionDuty.instructions && (
                <div style={{ marginBottom: 'var(--space-3)', fontSize: '0.8125rem' }}>
                  <strong>Guidelines:</strong> {activeActionDuty.instructions}
                </div>
              )}

              {activeActionDuty.completionNotes && (
                <div style={{ marginBottom: 'var(--space-3)', fontSize: '0.8125rem', color: 'var(--color-success-text)' }}>
                  <strong>Completion Notes:</strong> {activeActionDuty.completionNotes} (Done by {activeActionDuty.completedByName})
                </div>
              )}

              {activeActionDuty.cancellationReason && (
                <div style={{ marginBottom: 'var(--space-3)', fontSize: '0.8125rem', color: 'var(--color-danger-text)' }}>
                  <strong>Cancellation Reason:</strong> {activeActionDuty.cancellationReason} (Cancelled by {activeActionDuty.cancelledByName})
                </div>
              )}

              {/* Reassignment Audit Trail */}
              <div>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                  Reassignment Trail ({activeActionDuty.reassignmentHistory.length} events)
                </span>
                {activeActionDuty.reassignmentHistory.length === 0 ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    No reassignments have occurred for this chore.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {activeActionDuty.reassignmentHistory.map((r) => (
                      <div
                        key={r.id}
                        style={{
                          padding: '6px 10px',
                          backgroundColor: 'var(--color-bg-subtle)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.75rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                          <span style={{ fontWeight: 600 }}>
                            {r.previousAssigneeNames.join(', ')} → {r.newAssigneeNames.join(', ')}
                          </span>
                          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.6875rem' }}>
                            {r.reassignedAt.slice(0, 10)}
                          </span>
                        </div>
                        <div style={{ color: 'var(--color-text-secondary)' }}>
                          <span>By: {r.reassignedByName}</span>
                          <span className="bullet-sep"> · </span>
                          <span>Reason: {r.reason}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setActionModalType(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
