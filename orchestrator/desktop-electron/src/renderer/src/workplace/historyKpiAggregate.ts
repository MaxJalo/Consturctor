import type { AgentRunHistoryItem, AgentRunnerEvent } from '../api/types'
import { historyRunStatus } from '../utils/historyDisplay'
import {
  eventLooksLikeConfirm,
  eventLooksLikeReject,
  extractToolDecisions
} from './decisionTools'
import { runEventType, runInitiator } from './historyRunFilters'

export type HistoryKpiCounts = {
  eventsInPeriod: number
  employeeActions: number
  aiActions: number
  errorsReturns: number
  confirmedDecisions: number
  /** Runs included in event-level pass (may be capped). */
  detailRuns: number
  /** Filtered runs total (journal rows). */
  filteredRuns: number
}

export const HISTORY_KPI_DETAIL_RUN_LIMIT = 120

/**
 * Event/run → KPI bucket mapping (вкладка «История»):
 *
 * | Signal | KPI tile |
 * |--------|----------|
 * | Журнальная строка (run в фильтре) | События за период (+1 на run) |
 * | run: manual / chat launch | Действия сотрудника |
 * | run: canceled/cancelled + initiator employee | Действия сотрудника |
 * | run: hitl + status ok | Подтверждённые решения; Действия сотрудника |
 * | event: user_message | Действия сотрудника |
 * | event: tool_result skipped / reject / «отклон» | Действия сотрудника |
 * | run: schedule/event/system auto start | Действия ИИ |
 * | run: status ok (completion) | Действия ИИ |
 * | event: tool_call, tool, tool_result (attempt), task | Действия ИИ |
 * | event: hitl, confirmOnly, «нужно подтверждение» (decisionTools) | Действия ИИ |
 * | run: status error | Ошибки / возвраты |
 * | event: type error | Ошибки / возвраты |
 * | event: tool_result failed / event.error | Ошибки / возвраты |
 * | extractToolDecisions → confirmed | Подтверждённые решения |
 * | event: hitl + ok tool_result after confirm | Подтверждённые решения |
 *
 * «События за период» = число строк журнала (filtered runs) + доп. runner-события
 * (tool/hitl/error/user_message), не дублирующие строку run.
 */
function isToolInvocationEvent(event: AgentRunnerEvent): boolean {
  const type = String(event.type || '').toLowerCase()
  return type === 'tool_call' || type === 'tool' || type === 'tool_result' || type === 'task'
}

function isExecutionErrorEvent(event: AgentRunnerEvent): boolean {
  const type = String(event.type || '').toLowerCase()
  if (type === 'error') return true
  if (!isToolInvocationEvent(event)) return false
  const status = String(event.status || '').toLowerCase()
  return (
    Boolean(event.error) ||
    status.includes('error') ||
    status.includes('fail') ||
    event.ok === false
  )
}

function countRunLevel(run: AgentRunHistoryItem): {
  employee: number
  ai: number
  errors: number
  confirmed: number
} {
  let employee = 0
  let ai = 0
  let errors = 0
  let confirmed = 0
  const type = runEventType(run)
  const initiator = runInitiator(run)
  const status = historyRunStatus(run)

  if (type === 'manual' || type === 'chat') employee += 1
  if ((status === 'canceled' || status === 'cancelled') && initiator === 'employee') employee += 1
  if (type === 'schedule' || type === 'event') ai += 1
  if (status === 'ok') ai += 1
  if (status === 'error') errors += 1
  if (type === 'hitl' && status === 'ok') {
    confirmed += 1
    employee += 1
  }
  return { employee, ai, errors, confirmed }
}

function countRunnerEvents(
  events: AgentRunnerEvent[],
  run: AgentRunHistoryItem,
  agentName: string
): { employee: number; ai: number; errors: number; confirmed: number; extraEvents: number } {
  let employee = 0
  let ai = 0
  let errors = 0
  let confirmed = 0
  let extraEvents = 0

  for (const event of events) {
    const type = String(event.type || '').toLowerCase()
    if (type === 'user_message') {
      employee += 1
      extraEvents += 1
      continue
    }
    if (eventLooksLikeReject(event) || event.skipped) {
      employee += 1
      extraEvents += 1
      continue
    }
    if (eventLooksLikeConfirm(event)) {
      ai += 1
      extraEvents += 1
      continue
    }
    if (isToolInvocationEvent(event)) {
      ai += 1
      extraEvents += 1
      if (isExecutionErrorEvent(event)) errors += 1
      continue
    }
    if (isExecutionErrorEvent(event)) {
      errors += 1
      extraEvents += 1
    }
  }

  const decisions = extractToolDecisions(events, {
    workflowId: run.workflowId,
    agentName,
    runId: run.runId,
    at: run.startedAt || run.finishedAt || '',
    runClosed: true
  })
  for (const item of decisions) {
    if (item.status === 'confirmed') {
      confirmed += 1
      employee += 1
    }
  }

  return { employee, ai, errors, confirmed, extraEvents }
}

export function aggregateHistoryKpi(
  filteredRuns: AgentRunHistoryItem[],
  runEvents: Map<string, AgentRunnerEvent[]>,
  titleOf: (workflowId: string) => string
): HistoryKpiCounts {
  let employeeActions = 0
  let aiActions = 0
  let errorsReturns = 0
  let confirmedDecisions = 0
  let extraEvents = 0

  for (const run of filteredRuns) {
    const events = runEvents.get(run.runId)
    if (events?.length) {
      const eventLevel = countRunnerEvents(events, run, titleOf(run.workflowId))
      employeeActions += eventLevel.employee
      aiActions += eventLevel.ai
      errorsReturns += eventLevel.errors
      confirmedDecisions += eventLevel.confirmed
      extraEvents += eventLevel.extraEvents
      // Run-level launch/cancel/completion when not represented in persisted events.
      const type = runEventType(run)
      const initiator = runInitiator(run)
      const status = historyRunStatus(run)
      if (type === 'manual' || type === 'chat') employeeActions += 1
      if ((status === 'canceled' || status === 'cancelled') && initiator === 'employee') employeeActions += 1
      if (type === 'schedule' || type === 'event') aiActions += 1
      if (status === 'error') errorsReturns += 1
    } else {
      const runLevel = countRunLevel(run)
      employeeActions += runLevel.employee
      aiActions += runLevel.ai
      errorsReturns += runLevel.errors
      confirmedDecisions += runLevel.confirmed
    }
  }

  const eventsInPeriod = filteredRuns.length + extraEvents

  return {
    eventsInPeriod,
    employeeActions,
    aiActions,
    errorsReturns,
    confirmedDecisions,
    detailRuns: runEvents.size,
    filteredRuns: filteredRuns.length
  }
}

export function formatPercent(part: number, total: number): string | undefined {
  if (total <= 0 || part <= 0) return undefined
  const value = (part / total) * 100
  if (!Number.isFinite(value)) return undefined
  return `${value < 10 ? value.toFixed(1).replace('.', ',') : Math.round(value).toString()}% от общего`
}

export function formatPeriodDelta(current: number, previous: number): string | undefined {
  if (previous <= 0) return undefined
  const delta = ((current - previous) / previous) * 100
  if (!Number.isFinite(delta)) return undefined
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${Math.round(delta)}% к прошлому`
}
