import { useState, type FC, type FormEvent } from 'react'
import { getActiveMembers, getAllMembers } from '../../data/mockData.ts'
import type {
  ExpenseItem,
  HouseholdMember,
  InventoryCategory,
  InventoryItem,
  InventoryUnit,
  NavSection,
  StockActionPayload,
  StockChangeType,
  StockLogRecord,
} from '../../types/index.ts'
import { generateEntityId } from '../../utils/financial.ts'
import {
  applyStockOperation,
  archiveInventoryItem,
  CONTINUOUS_UNITS,
  createInventoryItemAtomic,
  deriveStockStatus,
  DISCRETE_UNITS,
  formatInventoryQuantity,
  formatInventoryTimestamp,
  INVENTORY_CATEGORIES,
  isDiscreteUnit,
  milliToDisplay,
} from '../../utils/inventory.ts'
import { Badge } from '../common/Badge'
import { Card, CardContent, CardHeader } from '../common/Card'
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  CloseIcon,
  InventoryIcon,
} from '../common/Icons'
import { StatCard } from '../common/StatCard'

interface InventoryViewProps {
  onNavigate: (section: NavSection) => void
  inventoryItems: InventoryItem[]
  setInventoryItems: React.Dispatch<React.SetStateAction<InventoryItem[]>>
  inventoryLogs: StockLogRecord[]
  setInventoryLogs: React.Dispatch<React.SetStateAction<StockLogRecord[]>>
  expenses: ExpenseItem[]
  members: HouseholdMember[]
}

type InventoryFilterTab = 'active' | 'alerts' | 'archived'

export const InventoryView: FC<InventoryViewProps> = ({
  onNavigate: _onNavigate,
  inventoryItems,
  setInventoryItems,
  inventoryLogs,
  setInventoryLogs,
  expenses,
  members,
}) => {
  const activeMembers = getActiveMembers(members)
  const allMembers = getAllMembers(members)
  const memberMap = new Map(allMembers.map((m) => [m.id, m]))
  const expenseMap = new Map(expenses.map((e) => [e.id, e]))

  // UI state
  const [filterTab, setFilterTab] = useState<InventoryFilterTab>('active')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [actionItem, setActionItem] = useState<InventoryItem | null>(null)
  const [selectedDetailItem, setSelectedDetailItem] = useState<InventoryItem | null>(null)
  const [actionType, setActionType] = useState<StockChangeType>('restock')
  const [modalError, setModalError] = useState<string | null>(null)

  // Client Idempotency Keys (generated per open action modal)
  const [actionIdempotencyKey, setActionIdempotencyKey] = useState('')
  const [createIdempotencyKey, setCreateIdempotencyKey] = useState('')

  // Create Form State
  const [createName, setCreateName] = useState('')
  const [createCategory, setCreateCategory] = useState<InventoryCategory>(
    'Kitchen Groceries & Staples'
  )
  const [createUnit, setCreateUnit] = useState<InventoryUnit>('kg')
  const [createInitialQty, setCreateInitialQty] = useState('0')
  const [createMinThreshold, setCreateMinThreshold] = useState('1')
  const [createIdealQty, setCreateIdealQty] = useState('')
  const [createLocation, setCreateLocation] = useState('')
  const [createNotes, setCreateNotes] = useState('')
  const [createMemberId, setCreateMemberId] = useState(activeMembers[0]?.id ?? 'm1')

  // Stock Action Form State
  const [actionQuantityStr, setActionQuantityStr] = useState('')
  const [actionMemberId, setActionMemberId] = useState(activeMembers[0]?.id ?? 'm1')
  const [actionReason, setActionReason] = useState('')
  const [actionLinkedExpenseId, setActionLinkedExpenseId] = useState<string>('')

  // Archive Safeguard Modal State
  const [isArchivePromptOpen, setIsArchivePromptOpen] = useState(false)
  const [archiveReason, setArchiveReason] = useState('')
  const [confirmWithStock, setConfirmWithStock] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)

  // Derived Aggregates
  const activeItems = inventoryItems.filter((i) => !i.isArchived)
  const archivedItems = inventoryItems.filter((i) => i.isArchived)

  const alertItems = activeItems.filter((item) => {
    const status = deriveStockStatus(item.currentQuantityMilli, item.minThresholdMilli)
    return status === 'low' || status === 'critical' || status === 'empty'
  })

  const emptyItems = activeItems.filter(
    (item) => deriveStockStatus(item.currentQuantityMilli, item.minThresholdMilli) === 'empty'
  )

  // Filtered Items for Main Table
  const displayItems = inventoryItems.filter((item) => {
    // Tab filter
    if (filterTab === 'active' && item.isArchived) return false
    if (filterTab === 'archived' && !item.isArchived) return false
    if (filterTab === 'alerts') {
      if (item.isArchived) return false
      const status = deriveStockStatus(item.currentQuantityMilli, item.minThresholdMilli)
      if (status === 'normal') return false
    }

    // Category filter
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false

    // Search query
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase()
      const matchName = item.name.toLowerCase().includes(q)
      const matchLoc = item.storageLocation?.toLowerCase().includes(q) ?? false
      if (!matchName && !matchLoc) return false
    }

    return true
  })

  // Open Create Modal with fresh Idempotency Key
  const handleOpenCreateModal = () => {
    setCreateName('')
    setCreateCategory('Kitchen Groceries & Staples')
    setCreateUnit('kg')
    setCreateInitialQty('0')
    setCreateMinThreshold('1')
    setCreateIdealQty('')
    setCreateLocation('')
    setCreateNotes('')
    setCreateMemberId(activeMembers[0]?.id ?? 'm1')
    setModalError(null)
    setCreateIdempotencyKey(generateEntityId('idemp-create'))
    setIsCreateModalOpen(true)
  }

  // Open Action Modal with fresh Idempotency Key
  const handleOpenActionModal = (item: InventoryItem, type: StockChangeType) => {
    setActionItem(item)
    setActionType(type)
    setActionQuantityStr('')
    setActionReason('')
    setActionLinkedExpenseId('')
    setActionMemberId(activeMembers[0]?.id ?? 'm1')
    setModalError(null)
    setActionIdempotencyKey(generateEntityId(`idemp-${type}`))
  }

  // Handle Create Item Submit
  const handleCreateSubmit = (e: FormEvent) => {
    e.preventDefault()
    setModalError(null)

    const creator = memberMap.get(createMemberId)
    const result = createInventoryItemAtomic(
      {
        idempotencyKey: createIdempotencyKey,
        name: createName,
        category: createCategory,
        unit: createUnit,
        initialQuantityString: createInitialQty,
        minThresholdString: createMinThreshold,
        idealQuantityString: createIdealQty,
        storageLocation: createLocation,
        notes: createNotes,
        createdByMembershipId: createMemberId,
        createdByName: creator?.name ?? 'Household Member',
      },
      members,
      inventoryItems,
      inventoryLogs
    )

    if (!result.success || !result.item || !result.log) {
      setModalError(result.errorMessage ?? 'Failed to create inventory item.')
      return
    }

    // Atomic commit to both state collections
    setInventoryItems((prev) => [result.item!, ...prev])
    setInventoryLogs((prev) => [result.log!, ...prev])
    setIsCreateModalOpen(false)
  }

  // Handle Stock Action Submit (Restock, Consume, Audit, Waste)
  const handleActionSubmit = (e: FormEvent) => {
    e.preventDefault()
    setModalError(null)
    if (!actionItem) return

    const actor = memberMap.get(actionMemberId)
    const payload: StockActionPayload = {
      idempotencyKey: actionIdempotencyKey,
      itemId: actionItem.id,
      changeType: actionType,
      inputQuantityString: actionQuantityStr,
      performedByMembershipId: actionMemberId,
      performedByName: actor?.name ?? 'Household Member',
      reason: actionReason,
      linkedExpenseId: actionLinkedExpenseId || undefined,
    }

    const result = applyStockOperation(
      payload,
      members,
      inventoryItems,
      inventoryLogs,
      expenses
    )

    if (!result.success || !result.updatedItem || !result.newLog) {
      setModalError(result.errorMessage ?? 'Stock operation failed.')
      return
    }

    // Atomic commit to both collections
    setInventoryItems((prev) =>
      prev.map((i) => (i.id === result.updatedItem!.id ? result.updatedItem! : i))
    )
    setInventoryLogs((prev) => [result.newLog!, ...prev])
    setActionItem(null)
  }

  // Handle Archive Confirmation
  const handleArchiveConfirm = () => {
    if (!selectedDetailItem) return
    setArchiveError(null)

    const actor = activeMembers[0] // Default custodian or active member
    const result = archiveInventoryItem(
      selectedDetailItem.id,
      actor?.id ?? 'm1',
      archiveReason,
      confirmWithStock,
      members,
      inventoryItems
    )

    if (!result.success || !result.updatedItem) {
      setArchiveError(result.errorMessage ?? 'Failed to archive item.')
      return
    }

    setInventoryItems((prev) =>
      prev.map((i) => (i.id === result.updatedItem!.id ? result.updatedItem! : i))
    )
    setIsArchivePromptOpen(false)
    setSelectedDetailItem(null)
    setArchiveReason('')
    setConfirmWithStock(false)
  }

  // Get Chronological Logs for an Item
  const getItemHistory = (itemId: string): StockLogRecord[] => {
    return inventoryLogs
      .filter((l) => l.itemId === itemId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }

  const healthyCount = activeItems.length - alertItems.length
  const healthyPercent = activeItems.length > 0 ? Math.round((healthyCount / activeItems.length) * 100) : 100

  return (
    <div className="home-fund-view-container">
      {/* 1. Tasknur Household Supplies Hero Card */}
      <div className="tasknur-hero-card">
        <div className="tasknur-hero-content">
          <span className="tasknur-hero-eyebrow">Household Provisions</span>
          <h2 className="tasknur-hero-title">
            {activeItems.length} Supplies Tracked
          </h2>
          <p className="tasknur-hero-subtitle">
            {alertItems.length > 0
              ? `${alertItems.length} items below minimum safety threshold · ${emptyItems.length} depleted`
              : 'All pantry and cleaning supplies adequate · No restock alerts'}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button
              type="button"
              className="tasknur-hero-action-btn"
              onClick={handleOpenCreateModal}
            >
              + Register New Item
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
              strokeDashoffset={213.63 * (1 - healthyPercent / 100)}
            />
          </svg>
          <div className="progress-ring-label">
            <span className="progress-ring-number">{healthyPercent}%</span>
            <span className="progress-ring-text">Stocked</span>
          </div>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="dashboard-stats-grid">
        <StatCard
          label="Tracked Supplies"
          amount={activeItems.length}
          subtitle="Active items in household inventory"
          icon={<InventoryIcon size={20} />}
          highlightTag={`${activeItems.length} Active`}
        />
        <StatCard
          label="Low / Critical Stock"
          amount={alertItems.length}
          subtitle="Items below safety threshold"
          icon={<AlertTriangleIcon size={20} />}
          accent={alertItems.length > 0}
          highlightTag={alertItems.length > 0 ? 'Restock Needed' : 'Well Stocked'}
        />
        <StatCard
          label="Empty / Depleted"
          amount={emptyItems.length}
          subtitle="Zero on-hand quantity"
          icon={<CloseIcon size={20} />}
          highlightTag={emptyItems.length > 0 ? 'Urgent' : 'None'}
        />
        <StatCard
          label="Stock Change Events"
          amount={inventoryLogs.length}
          subtitle="Authoritative historical log entries"
          icon={<CheckCircleIcon size={20} />}
          highlightTag={`${inventoryLogs.length} Logs`}
        />
      </div>

      {/* Main Inventory Card */}
      <Card>
        <CardHeader
          title="Household Inventory & Pantry"
          subtitle="Track on-hand quantities, log restocks & usage, and audit pantry supplies"
          action={
            <button type="button" className="btn-primary" onClick={handleOpenCreateModal}>
              + Register New Item
            </button>
          }
        />
        <CardContent>
          {/* Action Bar & Filters */}
          <div className="home-fund-action-bar" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="filter-tabs-row" style={{ margin: 0, padding: 0, border: 'none' }}>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'active' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('active')}
              >
                Active Items ({activeItems.length})
              </button>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'alerts' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('alerts')}
              >
                Restock Alerts ({alertItems.length})
              </button>
              <button
                type="button"
                className={`filter-tab-btn ${filterTab === 'archived' ? 'filter-tab-btn-active' : ''}`}
                onClick={() => setFilterTab('archived')}
              >
                Archived ({archivedItems.length})
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {/* Search */}
              <input
                type="text"
                placeholder="Search items or location..."
                className="form-input"
                style={{ width: '180px', padding: '4px 8px', fontSize: '0.7813rem' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              {/* Category Dropdown Filter */}
              <select
                className="form-select"
                style={{ width: 'auto', padding: '4px 8px', fontSize: '0.7813rem' }}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="all">All Categories</option>
                {INVENTORY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Item Table / List */}
          {displayItems.length === 0 ? (
            <div className="queue-empty-state">
              No inventory items found matching the selected filter.
            </div>
          ) : (
            <div className="ledger-list">
              {displayItems.map((item) => {
                const status = deriveStockStatus(
                  item.currentQuantityMilli,
                  item.minThresholdMilli
                )
                const isAlert = status === 'low' || status === 'critical' || status === 'empty'

                return (
                  <div
                    key={item.id}
                    className={`ledger-item-row ${status === 'empty' ? 'ledger-row-refund' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedDetailItem(item)}
                  >
                    <div className="ledger-item-left">
                      <div
                        className="expense-icon-badge"
                        style={{
                          backgroundColor:
                            status === 'empty'
                              ? 'var(--color-danger-bg)'
                              : status === 'critical'
                              ? 'var(--color-warning-bg)'
                              : 'var(--color-bg-surface)',
                          color:
                            status === 'empty'
                              ? 'var(--color-danger-text)'
                              : status === 'critical'
                              ? 'var(--color-warning-text)'
                              : 'var(--color-accent-primary)',
                        }}
                      >
                        <InventoryIcon size={16} />
                      </div>

                      <div className="ledger-item-details">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span className="expense-title">{item.name}</span>
                          <Badge variant="neutral">{item.category}</Badge>
                          {item.isArchived && <Badge variant="neutral">Archived</Badge>}
                          {!item.isArchived && status === 'empty' && (
                            <Badge variant="danger">Empty (0 {item.unit})</Badge>
                          )}
                          {!item.isArchived && status === 'critical' && (
                            <Badge variant="danger">Critical Stock</Badge>
                          )}
                          {!item.isArchived && status === 'low' && (
                            <Badge variant="warning">Low Stock</Badge>
                          )}
                        </div>

                        <div className="expense-meta-line">
                          <span>
                            Location: <strong>{item.storageLocation ?? 'Pantry'}</strong>
                          </span>
                          <span className="bullet-sep">·</span>
                          <span>
                            Min Alert: {milliToDisplay(item.minThresholdMilli, item.isDiscrete)}{' '}
                            {item.unit}
                          </span>
                          {item.notes && (
                            <>
                              <span className="bullet-sep">·</span>
                              <span>{item.notes}</span>
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
                            color: isAlert ? 'var(--color-danger-text)' : 'var(--color-text-primary)',
                          }}
                        >
                          {formatInventoryQuantity(item.currentQuantityMilli, item.unit)}
                        </span>
                        <span className="expense-split-tag">
                          {status === 'normal' ? 'Well Stocked' : `Status: ${status.toUpperCase()}`}
                        </span>
                      </div>

                      {/* Quick Actions (only for active items) */}
                      {!item.isArchived && (
                        <div style={{ display: 'flex', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            style={{ color: 'var(--color-success-text)' }}
                            title="Restock stock"
                            onClick={() => handleOpenActionModal(item, 'restock')}
                          >
                            + Restock
                          </button>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            title="Log usage"
                            onClick={() => handleOpenActionModal(item, 'consumption')}
                            disabled={item.currentQuantityMilli <= 0}
                          >
                            - Use
                          </button>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            title="Count / Audit stock"
                            onClick={() => handleOpenActionModal(item, 'correction')}
                          >
                            Audit
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
          Create New Inventory Item Modal
          ========================================================================== */}
      {isCreateModalOpen && (
        <div className="modal-overlay" onClick={() => setIsCreateModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '580px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Register New Inventory Supply</h3>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setIsCreateModalOpen(false)}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
                {modalError && (
                  <div
                    className="demo-notice-banner"
                    style={{
                      margin: 0,
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
                  <label className="form-label" htmlFor="inv-name">
                    Item Name *
                  </label>
                  <input
                    id="inv-name"
                    type="text"
                    placeholder="e.g. Sona Masoori Raw Rice (25kg)"
                    className="form-input"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="inv-cat">
                      Category *
                    </label>
                    <select
                      id="inv-cat"
                      className="form-select"
                      value={createCategory}
                      onChange={(e) => setCreateCategory(e.target.value as InventoryCategory)}
                    >
                      {INVENTORY_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="inv-unit">
                      Unit of Measurement *
                    </label>
                    <select
                      id="inv-unit"
                      className="form-select"
                      value={createUnit}
                      onChange={(e) => setCreateUnit(e.target.value as InventoryUnit)}
                    >
                      <optgroup label="Continuous Metric (max 3 decimals)">
                        {CONTINUOUS_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Discrete Units (whole numbers only)">
                        {DISCRETE_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    <span className="form-helper">
                      {isDiscreteUnit(createUnit)
                        ? 'Discrete unit: accepts whole numbers only.'
                        : 'Continuous metric unit: accepts up to 3 decimal places (0.001).'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="inv-init-qty">
                      Initial Quantity ({createUnit}) *
                    </label>
                    <input
                      id="inv-init-qty"
                      type="text"
                      placeholder={isDiscreteUnit(createUnit) ? 'e.g. 5' : 'e.g. 2.5'}
                      className="form-input"
                      value={createInitialQty}
                      onChange={(e) => setCreateInitialQty(e.target.value)}
                      required
                    />
                    <span className="form-helper">
                      Enter 0 if registering before purchasing. An initial stock log will be created.
                    </span>
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="inv-threshold">
                      Low-Stock Alert Threshold ({createUnit}) *
                    </label>
                    <input
                      id="inv-threshold"
                      type="text"
                      placeholder={isDiscreteUnit(createUnit) ? 'e.g. 2' : 'e.g. 1.0'}
                      className="form-input"
                      value={createMinThreshold}
                      onChange={(e) => setCreateMinThreshold(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="inv-location">
                      Storage Location
                    </label>
                    <input
                      id="inv-location"
                      type="text"
                      placeholder="e.g. Kitchen Lower Shelf"
                      className="form-input"
                      value={createLocation}
                      onChange={(e) => setCreateLocation(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="inv-creator">
                      Registered By *
                    </label>
                    <select
                      id="inv-creator"
                      className="form-select"
                      value={createMemberId}
                      onChange={(e) => setCreateMemberId(e.target.value)}
                    >
                      {activeMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="inv-notes">
                    Notes / Brand Preferences
                  </label>
                  <input
                    id="inv-notes"
                    type="text"
                    placeholder="e.g. Prefer Fortune Sunlite brand"
                    className="form-input"
                    value={createNotes}
                    onChange={(e) => setCreateNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setIsCreateModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Commit Registration & Initial Log
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================================================
          Stock Action Modal (Restock, Consume, Audit, Waste)
          ========================================================================== */}
      {actionItem && (
        <div className="modal-overlay" onClick={() => setActionItem(null)}>
          <div className="modal-card" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                {actionType === 'restock' && `Restock: ${actionItem.name}`}
                {actionType === 'consumption' && `Log Usage: ${actionItem.name}`}
                {actionType === 'correction' && `Audit Count: ${actionItem.name}`}
                {actionType === 'waste' && `Record Spoilage / Waste: ${actionItem.name}`}
              </h3>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setActionItem(null)}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <form onSubmit={handleActionSubmit}>
              <div className="modal-body">
                {modalError && (
                  <div
                    className="demo-notice-banner"
                    style={{
                      margin: 0,
                      borderColor: 'var(--color-danger-border)',
                      backgroundColor: 'var(--color-danger-bg)',
                    }}
                  >
                    <span className="notice-text" style={{ color: 'var(--color-danger-text)' }}>
                      <strong>Operation Error:</strong> {modalError}
                    </span>
                  </div>
                )}

                {/* Status Callout */}
                <div
                  style={{
                    padding: 'var(--space-3)',
                    backgroundColor: 'var(--color-bg-canvas)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block' }}>
                      Current On-Hand Stock
                    </span>
                    <span style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                      {formatInventoryQuantity(actionItem.currentQuantityMilli, actionItem.unit)}
                    </span>
                  </div>

                  <div>
                    <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block' }}>
                      Min Threshold
                    </span>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                      {milliToDisplay(actionItem.minThresholdMilli, actionItem.isDiscrete)}{' '}
                      {actionItem.unit}
                    </span>
                  </div>
                </div>

                {/* Action Type Toggle */}
                <div className="form-group" style={{ marginTop: 'var(--space-3)' }}>
                  <label className="form-label">Action Mode</label>
                  <div className="filter-tabs-row" style={{ margin: 0, padding: 0, border: 'none' }}>
                    <button
                      type="button"
                      className={`filter-tab-btn ${actionType === 'restock' ? 'filter-tab-btn-active' : ''}`}
                      onClick={() => setActionType('restock')}
                    >
                      + Restock
                    </button>
                    <button
                      type="button"
                      className={`filter-tab-btn ${actionType === 'consumption' ? 'filter-tab-btn-active' : ''}`}
                      onClick={() => setActionType('consumption')}
                    >
                      - Consume
                    </button>
                    <button
                      type="button"
                      className={`filter-tab-btn ${actionType === 'correction' ? 'filter-tab-btn-active' : ''}`}
                      onClick={() => setActionType('correction')}
                    >
                      Audit Count
                    </button>
                    <button
                      type="button"
                      className={`filter-tab-btn ${actionType === 'waste' ? 'filter-tab-btn-active' : ''}`}
                      onClick={() => setActionType('waste')}
                    >
                      Waste / Spoilage
                    </button>
                  </div>
                </div>

                {/* Input Quantity */}
                <div className="form-group">
                  <label className="form-label" htmlFor="action-qty">
                    {actionType === 'restock' && `Quantity Added (${actionItem.unit}) *`}
                    {actionType === 'consumption' && `Quantity Used (${actionItem.unit}) *`}
                    {actionType === 'correction' && `New Audited Physical Count (${actionItem.unit}) *`}
                    {actionType === 'waste' && `Quantity Discarded (${actionItem.unit}) *`}
                  </label>
                  <input
                    id="action-qty"
                    type="text"
                    placeholder={actionItem.isDiscrete ? 'e.g. 2' : 'e.g. 1.25'}
                    className="form-input"
                    value={actionQuantityStr}
                    onChange={(e) => setActionQuantityStr(e.target.value)}
                    required
                  />
                  <span className="form-helper">
                    {actionItem.isDiscrete
                      ? 'Whole numbers only (no decimal places).'
                      : 'Max 3 decimal places (0.001 precision).'}
                  </span>
                </div>

                {/* Active Member */}
                <div className="form-group">
                  <label className="form-label" htmlFor="action-member">
                    Performed By (Active Member) *
                  </label>
                  <select
                    id="action-member"
                    className="form-select"
                    value={actionMemberId}
                    onChange={(e) => setActionMemberId(e.target.value)}
                  >
                    {activeMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Optional Expense Link for Restock */}
                {actionType === 'restock' && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="action-expense">
                      Link to Household Expense (Optional)
                    </label>
                    <select
                      id="action-expense"
                      className="form-select"
                      value={actionLinkedExpenseId}
                      onChange={(e) => setActionLinkedExpenseId(e.target.value)}
                    >
                      <option value="">None (Not linked to an expense)</option>
                      {expenses
                        .filter((e) => !e.isVoided)
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.title} (₹{e.amount} · {e.date})
                          </option>
                        ))}
                    </select>
                    <span className="form-helper">
                      Referential link only. Linking an expense does not modify financial totals or splits.
                    </span>
                  </div>
                )}

                {/* Mandatory Reason for Correction & Waste */}
                {(actionType === 'correction' || actionType === 'waste') && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="action-reason">
                      Mandatory Reason (min 4 characters) *
                    </label>
                    <input
                      id="action-reason"
                      type="text"
                      placeholder={
                        actionType === 'correction'
                          ? 'e.g. Weekend kitchen audit count reconciled'
                          : 'e.g. Milk packet spoiled due to power cut'
                      }
                      className="form-input"
                      value={actionReason}
                      onChange={(e) => setActionReason(e.target.value)}
                      required
                    />
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setActionItem(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  Commit Stock Operation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==========================================================================
          Item Detail & Chronological History Modal
          ========================================================================== */}
      {selectedDetailItem && (
        <div className="modal-overlay" onClick={() => setSelectedDetailItem(null)}>
          <div className="modal-card" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 className="modal-title">{selectedDetailItem.name}</h3>
                {selectedDetailItem.isArchived ? (
                  <Badge variant="neutral">Archived Item</Badge>
                ) : (
                  <Badge
                    variant={
                      deriveStockStatus(
                        selectedDetailItem.currentQuantityMilli,
                        selectedDetailItem.minThresholdMilli
                      ) === 'empty'
                        ? 'danger'
                        : deriveStockStatus(
                            selectedDetailItem.currentQuantityMilli,
                            selectedDetailItem.minThresholdMilli
                          ) === 'critical'
                        ? 'danger'
                        : deriveStockStatus(
                            selectedDetailItem.currentQuantityMilli,
                            selectedDetailItem.minThresholdMilli
                          ) === 'low'
                        ? 'warning'
                        : 'success'
                    }
                  >
                    {deriveStockStatus(
                      selectedDetailItem.currentQuantityMilli,
                      selectedDetailItem.minThresholdMilli
                    ).toUpperCase()}
                  </Badge>
                )}
              </div>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setSelectedDetailItem(null)}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
              {/* Archive Alert if Archived */}
              {selectedDetailItem.isArchived && (
                <div
                  className="demo-notice-banner"
                  style={{
                    margin: 0,
                    marginBottom: 'var(--space-4)',
                    borderColor: 'var(--color-border-subtle)',
                    backgroundColor: 'var(--color-bg-subtle)',
                  }}
                >
                  <span className="notice-text">
                    <strong>Archived Item:</strong> {selectedDetailItem.archivedReason ?? 'Archived'} (Archived on {formatInventoryTimestamp(selectedDetailItem.archivedAt ?? '')} by {selectedDetailItem.archivedByName ?? 'Member'})
                  </span>
                </div>
              )}

              {/* Item Metadata Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3)',
                  backgroundColor: 'var(--color-bg-canvas)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border-subtle)',
                  marginBottom: 'var(--space-4)',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block' }}>
                    Current Balance
                  </span>
                  <span style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                    {formatInventoryQuantity(
                      selectedDetailItem.currentQuantityMilli,
                      selectedDetailItem.unit
                    )}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block' }}>
                    Alert Threshold
                  </span>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {milliToDisplay(selectedDetailItem.minThresholdMilli, selectedDetailItem.isDiscrete)}{' '}
                    {selectedDetailItem.unit}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block' }}>
                    Category & Storage
                  </span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                    {selectedDetailItem.category} · {selectedDetailItem.storageLocation ?? 'Pantry'}
                  </span>
                </div>

                <div>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', display: 'block' }}>
                    Registered By & Date
                  </span>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                    {selectedDetailItem.createdByName} · {formatInventoryTimestamp(selectedDetailItem.createdAt)}
                  </span>
                </div>
              </div>

              {selectedDetailItem.notes && (
                <div style={{ marginBottom: 'var(--space-4)', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                  <strong>Notes:</strong> {selectedDetailItem.notes}
                </div>
              )}

              {/* Authoritative Single-Source History Logs */}
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-primary)', display: 'block', marginBottom: '8px' }}>
                  Authoritative Stock History Trail ({getItemHistory(selectedDetailItem.id).length} Events)
                </span>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {getItemHistory(selectedDetailItem.id).map((log) => {
                    const linkedExp = log.linkedExpenseId ? expenseMap.get(log.linkedExpenseId) : null
                    const isExpVoided = linkedExp?.isVoided

                    return (
                      <div
                        key={log.id}
                        style={{
                          padding: '8px 12px',
                          backgroundColor: 'var(--color-bg-canvas)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-border-subtle)',
                          fontSize: '0.7813rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Badge
                              variant={
                                log.changeType === 'restock'
                                  ? 'success'
                                  : log.changeType === 'consumption'
                                  ? 'neutral'
                                  : log.changeType === 'waste'
                                  ? 'danger'
                                  : log.changeType === 'correction'
                                  ? 'warning'
                                  : 'info'
                              }
                            >
                              {log.changeType.toUpperCase()}
                            </Badge>
                            <span style={{ fontWeight: 600 }}>
                              {log.quantityChangedMilli > 0 ? '+' : ''}
                              {milliToDisplay(log.quantityChangedMilli, isDiscreteUnit(log.unit))}{' '}
                              {log.unit}
                            </span>
                          </div>

                          <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-muted)', fontSize: '0.7188rem' }}>
                            {formatInventoryTimestamp(log.timestamp)}
                          </span>
                        </div>

                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                          <span>
                            {milliToDisplay(log.previousQuantityMilli, isDiscreteUnit(log.unit))} →{' '}
                            <strong>{milliToDisplay(log.newQuantityMilli, isDiscreteUnit(log.unit))} {log.unit}</strong>
                          </span>
                          <span className="bullet-sep"> · </span>
                          <span>By: {log.performedByName}</span>
                          {log.reason && (
                            <>
                              <span className="bullet-sep"> · </span>
                              <span>{log.reason}</span>
                            </>
                          )}
                        </div>

                        {/* Linked Expense Status Reference */}
                        {log.linkedExpenseId && (
                          <div style={{ marginTop: '4px', fontSize: '0.6875rem', color: 'var(--color-accent-primary)' }}>
                            📎 Linked Expense: {linkedExp?.title ?? log.linkedExpenseId}{' '}
                            {isExpVoided ? (
                              <span style={{ color: 'var(--color-danger-text)', fontWeight: 600 }}>
                                (Voided)
                              </span>
                            ) : linkedExp?.disbursementStatus === 'pending' ? (
                              <span style={{ color: 'var(--color-warning-text)' }}>(Pending)</span>
                            ) : (
                              <span style={{ color: 'var(--color-success-text)' }}>(Disbursed)</span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Archive Safeguard Prompt */}
              {isArchivePromptOpen && (
                <div
                  style={{
                    padding: 'var(--space-3)',
                    backgroundColor: 'var(--color-bg-subtle)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border-default)',
                    marginBottom: 'var(--space-4)',
                  }}
                >
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-danger-text)', display: 'block', marginBottom: '6px' }}>
                    Archive Inventory Item Safeguard
                  </span>

                  {archiveError && (
                    <div style={{ color: 'var(--color-danger-text)', fontSize: '0.75rem', marginBottom: '6px' }}>
                      {archiveError}
                    </div>
                  )}

                  {selectedDetailItem.currentQuantityMilli > 0 && (
                    <div style={{ marginBottom: '8px' }}>
                      <p style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', margin: '0 0 6px 0' }}>
                        This item currently has{' '}
                        <strong>
                          {formatInventoryQuantity(
                            selectedDetailItem.currentQuantityMilli,
                            selectedDetailItem.unit
                          )}
                        </strong>{' '}
                        on hand. Archiving will freeze this balance and remove it from active lists.
                      </p>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={confirmWithStock}
                          onChange={(e) => setConfirmWithStock(e.target.checked)}
                        />
                        <span>Confirm archiving despite remaining stock</span>
                      </label>
                    </div>
                  )}

                  <input
                    type="text"
                    placeholder="Mandatory archive reason (e.g. Brand discontinued, switched to new size)..."
                    className="form-input"
                    value={archiveReason}
                    onChange={(e) => setArchiveReason(e.target.value)}
                    style={{ marginBottom: '8px' }}
                  />

                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setIsArchivePromptOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-danger btn-sm"
                      onClick={handleArchiveConfirm}
                    >
                      Confirm Archive
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <div>
                {!selectedDetailItem.isArchived && !isArchivePromptOpen && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    style={{ color: 'var(--color-danger-text)' }}
                    onClick={() => {
                      setArchiveReason('')
                      setConfirmWithStock(false)
                      setArchiveError(null)
                      setIsArchivePromptOpen(true)
                    }}
                  >
                    Archive Item
                  </button>
                )}
              </div>

              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSelectedDetailItem(null)
                  setIsArchivePromptOpen(false)
                }}
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
