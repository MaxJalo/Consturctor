import type { AgentRunHistoryItem } from '../api/types'
import { parseIso } from '../utils/calendar'
import { historyRunStatus } from '../utils/historyDisplay'

export type HistoryStatusFilter = '' | 'ok' | 'error' | 'canceled' | 'started'
export type HistoryEventTypeKey = 'schedule' | 'event' | 'manual' | 'chat' | 'hitl'

export type HistoryRunFilters = {
  query?: string
  agentId?: string
  eventTypes?: HistoryEventTypeKey[]
  initiator?: string
  status?: HistoryStatusFilter
  correlationId?: string
  agentVersion?: string
  durationMin?: string
  durationMax?: string
  sort?: 'newest' | 'oldest'
}

export function dayKeyFromDate(stamp: Date): string {
  return `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}`
}

export function todayDayKey(): string {
  return dayKeyFromDate(new Date())
}

function orderedDayKeys(from: string, to: string): { from: string; to: string } {
  return from <= to ? { from, to } : { from: to, to: from }
}

export function runInDateRange(run: AgentRunHistoryItem, from: string, to: string): boolean {
  if (!from || !to) return false
  const stamp = parseIso(run.startedAt || run.finishedAt)
  if (!stamp) return false
  const key = dayKeyFromDate(stamp)
  const range = orderedDayKeys(from, to)
  return key >= range.from && key <= range.to
}

export function runEventType(run: AgentRunHistoryItem): HistoryEventTypeKey {
  const source = (run.source || '').toLowerCase()
  const kind = (run.triggerKind || '').toLowerCase()
  if (source === 'chat' || kind === 'chat') return 'chat'
  if (source === 'manual' || kind === 'manual') return 'manual'
  if (source === 'event' || kind === 'event') return 'event'
  if (source.includes('hitl') || kind.includes('hitl') || source.includes('human')) return 'hitl'
  return 'schedule'
}

export function runInitiator(run: AgentRunHistoryItem): string {
  const source = (run.source || '').toLowerCase()
  const kind = (run.triggerKind || '').toLowerCase()
  if (source === 'manual' || source === 'chat' || kind === 'manual' || kind === 'chat') return 'employee'
  if (source === 'schedule' || kind === 'schedule') return 'schedule'
  if (source === 'event') return 'system'
  return 'agent'
}

export function runDurationSec(run: AgentRunHistoryItem): number | null {
  const total = Number(run.agentWorkMs || 0) + Number(run.humanWaitMs || 0)
  if (total > 0) return Math.round(total / 1000)
  const start = parseIso(run.startedAt)
  const end = parseIso(run.finishedAt)
  if (start && end && end >= start) return Math.round((end.getTime() - start.getTime()) / 1000)
  return null
}

export function filterHistoryRuns(
  runs: AgentRunHistoryItem[],
  period: { from: string; to: string },
  filters: HistoryRunFilters,
  titleOf: (workflowId: string) => string,
  eventTitleForRun?: (run: AgentRunHistoryItem) => string
): AgentRunHistoryItem[] {
  const q = (filters.query || '').trim().toLowerCase()
  const minSec = (filters.durationMin || '').trim() ? Number(filters.durationMin) : null
  const maxSec = (filters.durationMax || '').trim() ? Number(filters.durationMax) : null
  const eventTypes = filters.eventTypes || []
  const rows = runs.filter((item) => {
    if (!runInDateRange(item, period.from, period.to)) return false
    if (filters.agentId && item.workflowId !== filters.agentId) return false
    if (eventTypes.length && !eventTypes.includes(runEventType(item))) return false
    if (filters.initiator && runInitiator(item) !== filters.initiator) return false
    const key = historyRunStatus(item)
    const status = filters.status || ''
    if (status === 'canceled' && key !== 'canceled' && key !== 'cancelled') return false
    if (status === 'started' && key !== 'started' && key !== 'running') return false
    if (status === 'ok' && key !== 'ok') return false
    if (status === 'error' && key !== 'error') return false
    const correlationId = (filters.correlationId || '').trim()
    if (correlationId && !item.runId.toLowerCase().includes(correlationId.toLowerCase())) {
      return false
    }
    const agentVersion = (filters.agentVersion || '').trim()
    if (agentVersion) {
      const blob = `${item.summary || ''} ${item.message || ''}`.toLowerCase()
      if (!blob.includes(agentVersion.toLowerCase())) return false
    }
    const duration = runDurationSec(item)
    if (minSec != null && Number.isFinite(minSec) && (duration == null || duration < minSec)) return false
    if (maxSec != null && Number.isFinite(maxSec) && (duration == null || duration > maxSec)) return false
    if (!q) return true
    const title = titleOf(item.workflowId).toLowerCase()
    const eventName = (eventTitleForRun ? eventTitleForRun(item) : '').toLowerCase()
    return (
      title.includes(q) ||
      eventName.includes(q) ||
      item.runId.toLowerCase().includes(q) ||
      item.workflowId.toLowerCase().includes(q)
    )
  })
  const sort = filters.sort || 'newest'
  rows.sort((left, right) => {
    const cmp = (right.startedAt || '').localeCompare(left.startedAt || '')
    return sort === 'newest' ? cmp : -cmp
  })
  return rows
}

/** Previous period of the same length, ending the day before `from`. */
export function previousPeriodRange(from: string, to: string): { from: string; to: string } {
  const start = parseIso(`${from}T12:00:00`)
  const end = parseIso(`${to}T12:00:00`)
  if (!start || !end) return { from, to }
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
  const prevEnd = new Date(start)
  prevEnd.setDate(prevEnd.getDate() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setDate(prevStart.getDate() - (days - 1))
  return { from: dayKeyFromDate(prevStart), to: dayKeyFromDate(prevEnd) }
}
