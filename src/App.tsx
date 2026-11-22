import { useEffect, useReducer, useState } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { QrScannerModal, type DecodedPaymentData } from './components/scanner/QrScannerModal'
import { BillsRentView } from './components/views/BillsRentView'
import { CleaningView } from './components/views/CleaningView'
import { DashboardView } from './components/views/DashboardView'
import { ExpensesView } from './components/views/ExpensesView'
import { HomeFundView } from './components/views/HomeFundView'
import { InventoryView } from './components/views/InventoryView'
import { PlaceholderView } from './components/views/PlaceholderView'
import {
  calculateTreasuryOverview,
  DEMO_CLEANING_DUTY_ASSIGNMENTS,
  DEMO_CLEANING_TEMPLATES,
  DEMO_COLLECTOR_QR_CONFIG,
  DEMO_INVENTORY_ITEMS,
  DEMO_INVENTORY_LOGS,
  DEMO_MEMBERS,
  DEMO_ROOT_FINANCIAL_STATE,
} from './data/mockData'
import type {
  CleaningActivityEvent,
  CleaningDutyAssignment,
  CleaningTaskTemplate,
  ExpenseCategory,
  ExpenseCorrectionRecord,
  ExpenseItem,
  FundContribution,
  HouseholdCollectorQrConfig,
  HouseholdMember,
  InventoryItem,
  MemberSettlementRecord,
  NavSection,
  StockLogRecord,
  TreasuryTransfer,
} from './types'
import {
  rootFinancialReducer,
} from './utils/billsRent'
import {
  addDaysToDate,
  cancelCleaningDuty,
  completeCleaningDuty,
  createAdHocDutyAssignment,
  type CreateAdHocDutyPayload,
  createCleaningTemplate,
  type CreateTemplatePayload,
  generateDutiesForTemplate,
  generateUpcomingDutiesForTemplates,
  getTodayCalendarDate,
  reassignCleaningDuty,
  updateCleaningTemplate,
  type UpdateTemplatePayload,
} from './utils/cleaning'

export function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard')
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [scannedPaymentPrefill, setScannedPaymentPrefill] = useState<DecodedPaymentData | null>(null)
  const [isQrSettingsRequested, setIsQrSettingsRequested] = useState(false)

  // Dynamic calendar date reference with midnight and visibility-change auto-refresh
  const [currentDate, setCurrentDate] = useState<string>(() => getTodayCalendarDate())

  // Household Official Collector & QR Configuration (configurable by authorized custodian)
  const [collectorQrConfig, setCollectorQrConfig] =
    useState<HouseholdCollectorQrConfig>(DEMO_COLLECTOR_QR_CONFIG)

  // Authoritative centralized root financial state (Stage 6 Step 2)
  const [financialState, dispatchFinancialAction] = useReducer(
    rootFinancialReducer,
    DEMO_ROOT_FINANCIAL_STATE
  )

  const accounts = financialState.accounts
  const contributions = financialState.contributions
  const expenses = financialState.expenses
  const transfers = financialState.transfers

  // Stage 6 Intention-based Granular Financial Action Handlers
  const handleSubmitContribution = (contribution: FundContribution) => {
    dispatchFinancialAction({
      type: 'SUBMIT_CONTRIBUTION',
      payload: { contribution },
    })
  }

  const handleConfirmContribution = (
    contributionId: string,
    custodianId?: string,
    custodianName?: string
  ) => {
    dispatchFinancialAction({
      type: 'CONFIRM_CONTRIBUTION',
      payload: {
        contributionId,
        confirmedByMembershipId: custodianId ?? 'm2',
        confirmedByName: custodianName ?? 'Custodian',
      },
    })
  }

  const handleRejectContribution = (
    contributionId: string,
    custodianId?: string,
    reason?: string
  ) => {
    dispatchFinancialAction({
      type: 'REJECT_CONTRIBUTION',
      payload: {
        contributionId,
        rejectedByMembershipId: custodianId ?? 'm2',
        rejectionReason: reason ?? 'Rejected during custodian verification (Demo)',
      },
    })
  }

  const handleRecordTransfer = (transfer: TreasuryTransfer) => {
    dispatchFinancialAction({
      type: 'RECORD_TREASURY_TRANSFER',
      payload: { transfer },
    })
  }

  const handleRecordExpense = (expense: ExpenseItem) => {
    dispatchFinancialAction({
      type: 'RECORD_EXPENSE',
      payload: { expense },
    })
  }

  const handleDisburseExpense = (expenseId: string, disbursedByMembershipId?: string) => {
    dispatchFinancialAction({
      type: 'DISBURSE_EXPENSE',
      payload: {
        expenseId,
        disbursedByMembershipId: disbursedByMembershipId ?? 'm2',
      },
    })
  }

  const handleVoidExpense = (
    expenseId: string,
    reason: string,
    voidedByMembershipId?: string
  ) => {
    dispatchFinancialAction({
      type: 'VOID_EXPENSE',
      payload: {
        expenseId,
        voidReason: reason,
        voidedByMembershipId: voidedByMembershipId ?? 'm2',
      },
    })
  }

  const handleCorrectExpense = (
    expenseId: string,
    correctionRecord: ExpenseCorrectionRecord,
    updatedFields: { title: string; category: ExpenseCategory | string; description?: string }
  ) => {
    dispatchFinancialAction({
      type: 'APPLY_EXPENSE_CORRECTION',
      payload: {
        expenseId,
        correctionRecord,
        updatedFields,
      },
    })
  }

  // Stage 6 Bills & Rent Intention-based Granular Financial Action Handlers
  const handleDisburseTreasuryProviderPayment = (payload: {
    expense: ExpenseItem
    obligationId: string
  }) => {
    dispatchFinancialAction({
      type: 'DISBURSE_TREASURY_PROVIDER_PAYMENT',
      payload,
    })
  }

  const handleSubmitMemberSettlement = (settlement: MemberSettlementRecord) => {
    dispatchFinancialAction({
      type: 'SUBMIT_MEMBER_SETTLEMENT',
      payload: { settlement },
    })
  }

  const handleConfirmMemberSettlement = (payload: {
    settlementId: string
    confirmedByMemberId: string
    confirmedAt?: string
    generatedPeerCreditId?: string
  }) => {
    dispatchFinancialAction({
      type: 'CONFIRM_MEMBER_SETTLEMENT',
      payload,
    })
  }

  const handleRejectMemberSettlement = (payload: {
    settlementId: string
    rejectedByMemberId: string
    rejectionReason: string
    rejectedAt?: string
  }) => {
    dispatchFinancialAction({
      type: 'REJECT_MEMBER_SETTLEMENT',
      payload,
    })
  }

  const handleVoidObligation = (
    obligationId: string,
    voidReason: string,
    voidedByMembershipId: string
  ) => {
    dispatchFinancialAction({
      type: 'VOID_FINANCIAL_OBLIGATION',
      payload: {
        obligationId,
        voidReason,
        voidedByMembershipId,
      },
    })
  }

  const [members] = useState<HouseholdMember[]>(DEMO_MEMBERS)

  // Stage 4 Inventory Centralized State
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>(DEMO_INVENTORY_ITEMS)
  const [inventoryLogs, setInventoryLogs] = useState<StockLogRecord[]>(DEMO_INVENTORY_LOGS)

  // Stage 5 Cleaning Centralized State with 14-calendar-day lookahead auto-generation
  const [cleaningTemplates, setCleaningTemplates] = useState<CleaningTaskTemplate[]>(DEMO_CLEANING_TEMPLATES)
  const [cleaningDuties, setCleaningDuties] = useState<CleaningDutyAssignment[]>(() => {
    const initialToday = getTodayCalendarDate()
    const res = generateUpcomingDutiesForTemplates(
      DEMO_CLEANING_TEMPLATES,
      DEMO_CLEANING_DUTY_ASSIGNMENTS,
      DEMO_MEMBERS,
      initialToday
    )
    return res.updatedDuties
  })
  const [, setCleaningActivityEvents] = useState<CleaningActivityEvent[]>([])

  // Midnight & visibility-change date rollover listener
  useEffect(() => {
    const updateDateIfChanged = () => {
      const today = getTodayCalendarDate()
      setCurrentDate((prev) => {
        if (prev !== today) {
          // Date rolled over across midnight: advance lookahead generation for active routines
          setCleaningDuties((prevDuties) => {
            const res = generateUpcomingDutiesForTemplates(
              cleaningTemplates,
              prevDuties,
              members,
              today
            )
            return res.newCount > 0 ? res.updatedDuties : prevDuties
          })
          return today
        }
        return prev
      })
    }

    const interval = setInterval(updateDateIfChanged, 60000)
    window.addEventListener('focus', updateDateIfChanged)
    document.addEventListener('visibilitychange', updateDateIfChanged)

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', updateDateIfChanged)
      document.removeEventListener('visibilitychange', updateDateIfChanged)
    }
  }, [cleaningTemplates, members])

  // Centralized cleaning mutation actions
  const handleCreateTemplate = (payload: CreateTemplatePayload) => {
    const result = createCleaningTemplate(payload, members)
    if (!result.success || !result.template) return result

    const newTemplate = result.template
    setCleaningTemplates((prev) => [newTemplate, ...prev])

    if (newTemplate.isActive) {
      setCleaningDuties((prevDuties) => {
        const genResult = generateDutiesForTemplate(
          newTemplate,
          prevDuties,
          members,
          currentDate,
          addDaysToDate(currentDate, 13)
        )
        return genResult.count > 0 ? [...prevDuties, ...genResult.generatedDuties] : prevDuties
      })
    }
    return result
  }

  const handleUpdateTemplate = (template: CleaningTaskTemplate, payload: UpdateTemplatePayload) => {
    const result = updateCleaningTemplate(template, payload, members)
    if (!result.success || !result.updatedTemplate) return result

    const updated = result.updatedTemplate
    setCleaningTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))

    if (updated.isActive) {
      setCleaningDuties((prevDuties) => {
        const genResult = generateDutiesForTemplate(
          updated,
          prevDuties,
          members,
          currentDate,
          addDaysToDate(currentDate, 13)
        )
        return genResult.count > 0 ? [...prevDuties, ...genResult.generatedDuties] : prevDuties
      })
    }
    return result
  }

  const handleToggleTemplateActive = (template: CleaningTaskTemplate) => {
    const willBeActive = !template.isActive
    const updated = { ...template, isActive: willBeActive }
    setCleaningTemplates((prev) => prev.map((t) => (t.id === template.id ? updated : t)))

    if (willBeActive) {
      setCleaningDuties((prevDuties) => {
        const genResult = generateDutiesForTemplate(
          updated,
          prevDuties,
          members,
          currentDate,
          addDaysToDate(currentDate, 13)
        )
        return genResult.count > 0 ? [...prevDuties, ...genResult.generatedDuties] : prevDuties
      })
    }
  }

  const handleCreateAdHocDuty = (payload: CreateAdHocDutyPayload) => {
    const result = createAdHocDutyAssignment(payload, members)
    if (result.success && result.duty) {
      setCleaningDuties((prev) => [result.duty!, ...prev])
      if (result.activityEvent) {
        setCleaningActivityEvents((prev) => [result.activityEvent!, ...prev])
      }
    }
    return result
  }

  const handleCompleteCleaningDuty = (dutyId: string, actorId?: string, notes?: string) => {
    const target = cleaningDuties.find((d) => d.id === dutyId)
    if (!target) return { success: false, errorMessage: 'Duty not found.' }
    const completingActor = actorId ?? target.assignedMemberIds[0] ?? members[0]?.id ?? 'm1'
    const result = completeCleaningDuty(target, completingActor, members, notes)
    if (result.success && result.updatedDuty && result.activityEvent) {
      setCleaningDuties((prev) => prev.map((d) => (d.id === dutyId ? result.updatedDuty! : d)))
      setCleaningActivityEvents((prev) => [result.activityEvent!, ...prev])
    }
    return result
  }

  const handleReassignCleaningDuty = (dutyId: string, newAssigneeIds: string[], actorId: string, reason: string) => {
    const target = cleaningDuties.find((d) => d.id === dutyId)
    if (!target) return { success: false, errorMessage: 'Duty not found.' }
    const result = reassignCleaningDuty(target, newAssigneeIds, actorId, members, reason)
    if (result.success && result.updatedDuty && result.activityEvent) {
      setCleaningDuties((prev) => prev.map((d) => (d.id === dutyId ? result.updatedDuty! : d)))
      setCleaningActivityEvents((prev) => [result.activityEvent!, ...prev])
    }
    return result
  }

  const handleCancelCleaningDuty = (dutyId: string, actorId: string, reason: string) => {
    const target = cleaningDuties.find((d) => d.id === dutyId)
    if (!target) return { success: false, errorMessage: 'Duty not found.' }
    const result = cancelCleaningDuty(target, actorId, members, reason)
    if (result.success && result.updatedDuty && result.activityEvent) {
      setCleaningDuties((prev) => prev.map((d) => (d.id === dutyId ? result.updatedDuty! : d)))
      setCleaningActivityEvents((prev) => [result.activityEvent!, ...prev])
    }
    return result
  }

  // Pure zero-stale treasury balance calculations across accounts in integer paise
  const treasuryOverview = calculateTreasuryOverview(
    accounts,
    contributions,
    expenses,
    transfers
  )

  return (
    <>
      <AppLayout
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        onOpenScanner={() => setIsScannerOpen(true)}
        onOpenQrSettings={() => {
          setActiveSection('dashboard')
          setIsQrSettingsRequested(true)
        }}
      >
        {activeSection === 'dashboard' ? (
          <DashboardView
            onNavigate={setActiveSection}
            currentDate={currentDate}
            expenses={expenses}
            treasuryOverview={treasuryOverview}
            members={members}
            inventoryItems={inventoryItems}
            cleaningDuties={cleaningDuties}
            onCompleteCleaningDuty={(dutyId) => handleCompleteCleaningDuty(dutyId)}
            collectorQrConfig={collectorQrConfig}
            onUpdateCollectorQrConfig={setCollectorQrConfig}
            onSubmitContribution={handleSubmitContribution}
            scannedPaymentPrefill={scannedPaymentPrefill}
            onClearScannedPaymentPrefill={() => setScannedPaymentPrefill(null)}
            isQrSettingsRequested={isQrSettingsRequested}
            onClearQrSettingsRequested={() => setIsQrSettingsRequested(false)}
            onOpenScanner={() => setIsScannerOpen(true)}
          />
      ) : activeSection === 'home-fund' ? (
        <HomeFundView
          onNavigate={setActiveSection}
          contributions={contributions}
          transfers={transfers}
          accounts={accounts}
          expenses={expenses}
          treasuryOverview={treasuryOverview}
          members={members}
          onSubmitContribution={handleSubmitContribution}
          onConfirmContribution={handleConfirmContribution}
          onRejectContribution={handleRejectContribution}
          onRecordTransfer={handleRecordTransfer}
          collectorQrConfig={collectorQrConfig}
        />
      ) : activeSection === 'expenses' ? (
        <ExpensesView
          onNavigate={setActiveSection}
          expenses={expenses}
          accounts={accounts}
          treasuryOverview={treasuryOverview}
          members={members}
          onRecordExpense={handleRecordExpense}
          onDisburseExpense={handleDisburseExpense}
          onVoidExpense={handleVoidExpense}
          onCorrectExpense={handleCorrectExpense}
        />
      ) : activeSection === 'inventory' ? (
        <InventoryView
          onNavigate={setActiveSection}
          inventoryItems={inventoryItems}
          setInventoryItems={setInventoryItems}
          inventoryLogs={inventoryLogs}
          setInventoryLogs={setInventoryLogs}
          expenses={expenses}
          members={members}
        />
      ) : activeSection === 'cleaning' ? (
        <CleaningView
          onNavigate={setActiveSection}
          currentDate={currentDate}
          cleaningDuties={cleaningDuties}
          setCleaningDuties={setCleaningDuties}
          cleaningTemplates={cleaningTemplates}
          setCleaningTemplates={setCleaningTemplates}
          setCleaningActivityEvents={setCleaningActivityEvents}
          members={members}
          onCreateTemplate={handleCreateTemplate}
          onUpdateTemplate={handleUpdateTemplate}
          onToggleTemplateActive={handleToggleTemplateActive}
          onCreateAdHocDuty={handleCreateAdHocDuty}
          onCompleteDuty={(duty, actor, notes) => handleCompleteCleaningDuty(duty.id, actor, notes)}
          onReassignDuty={(duty, newAssignees, actor, reason) =>
            handleReassignCleaningDuty(duty.id, newAssignees, actor, reason)
          }
          onCancelDuty={(duty, actor, reason) => handleCancelCleaningDuty(duty.id, actor, reason)}
        />
      ) : activeSection === 'bills-rent' ? (
        <BillsRentView
          onNavigate={setActiveSection}
          financialState={financialState}
          members={members}
          currentDate={currentDate}
          onDisburseTreasuryProviderPayment={handleDisburseTreasuryProviderPayment}
          onRecordPersonalProviderPayment={handleRecordExpense}
          onSubmitMemberSettlement={handleSubmitMemberSettlement}
          onConfirmMemberSettlement={handleConfirmMemberSettlement}
          onRejectMemberSettlement={handleRejectMemberSettlement}
          onVoidObligation={handleVoidObligation}
        />
      ) : (
        <PlaceholderView section={activeSection} onNavigate={setActiveSection} />
      )}
    </AppLayout>

    {/* Dedicated Mobile / Universal QR Scanner Modal */}
    <QrScannerModal
      isOpen={isScannerOpen}
      onClose={() => setIsScannerOpen(false)}
      collectorQrConfig={collectorQrConfig}
      onProceedToPayment={(decoded) => {
        setScannedPaymentPrefill(decoded)
        setActiveSection('dashboard')
      }}
    />
  </>
  )
}

export default App
