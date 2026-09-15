import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { AgentRunHistoryItem, AgentRunnerEvent } from '../api/types'
import type { SpecSummaryTile } from './specV04Shell'
import {
  aggregateHistoryKpi,
  formatPeriodDelta,
  formatPercent,
  HISTORY_KPI_DETAIL_RUN_LIMIT,
  type HistoryKpiCounts
} from './historyKpiAggregate'
import {
  filterHistoryRuns,
  previousPeriodRange,
  type HistoryRunFilters
} from './historyRunFilters'
import { useGridRefreshGeneration } from './GridDataRefreshContext'
import { readGridCache, shouldRunGridFetch, writeGridCache } from './gridDataCache'

export type HistoryKpiPeriod = { from: string; to: string }

type DetailCache = Map<string, AgentRunnerEvent[]>

const DETAIL_CONCURRENCY = 6

async function fetchRunEventsBatch(
  runs: AgentRunHistoryItem[],
  signal: AbortSignal
): Promise<DetailCache> {
  const map: DetailCache = new Map()
  let index = 0
  async function worker(): Promise<void> {
    while (index < runs.length) {
      if (signal.aborted) return
      const run = runs[index]
      index += 1
      try {
        const detail = await api.getAgentRunDetail(run.workflowId, run.runId)
        if (signal.aborted) return
        if (detail.events?.length) map.set(run.runId, detail.events)
      } catch {
        /* omit run from event-level pass */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, runs.length) }, () => worker()))
  return map
}

function countsToTiles(counts: HistoryKpiCounts, previousTotal: number): SpecSummaryTile[] {
  const total = counts.eventsInPeriod
  const display = (value: number): string => String(value)
  return [
    {
      id: 'ev',
      label: 'События за период',
      value: display(total),
      hint: formatPeriodDelta(total, previousTotal),
      tone: 'orange'
    },
    {
      id: 'emp',
      label: 'Действия сотрудника',
      value: display(counts.employeeActions),
      hint: formatPercent(counts.employeeActions, total),
      tone: 'blue'
    },
    {
      id: 'ai',
      label: 'Действия ИИ',
      value: display(counts.aiActions),
      hint: formatPercent(counts.aiActions, total),
      tone: 'purple'
    },
    {
      id: 'err',
      label: 'Ошибки / возвраты',
      value: display(counts.errorsReturns),
      hint: formatPercent(counts.errorsReturns, total),
      tone: 'orange'
    },
    {
      id: 'ok',
      label: 'Подтверждённые решения',
      value: display(counts.confirmedDecisions),
      tone: 'green'
    }
  ]
}

export function useHistoryKpiMetrics(
  runs: AgentRunHistoryItem[],
  period: HistoryKpiPeriod,
  filters: HistoryRunFilters,
  titleOf: (workflowId: string) => string,
  eventTitleForRun?: (run: AgentRunHistoryItem) => string
): {
  counts: HistoryKpiCounts
  tiles: SpecSummaryTile[]
  loadingDetails: boolean
  filteredRuns: AgentRunHistoryItem[]
} {
  const generation = useGridRefreshGeneration()

  const filteredRuns = useMemo(
    () => filterHistoryRuns(runs, period, filters, titleOf, eventTitleForRun),
    [runs, period.from, period.to, filters, titleOf, eventTitleForRun]
  )

  const previousFiltered = useMemo(() => {
    const prev = previousPeriodRange(period.from, period.to)
    return filterHistoryRuns(runs, prev, filters, titleOf, eventTitleForRun)
  }, [runs, period.from, period.to, filters, titleOf, eventTitleForRun])

  const detailTargets = useMemo(
    () => filteredRuns.slice(0, HISTORY_KPI_DETAIL_RUN_LIMIT),
    [filteredRuns]
  )

  const cacheKey = useMemo(() => {
    const filterKey = JSON.stringify({ period, filters, ids: detailTargets.map((r) => r.runId).join(',') })
    return `history-kpi-details:${filterKey}`
  }, [period, filters, detailTargets])

  const [runEvents, setRunEvents] = useState<DetailCache>(() => readGridCache<DetailCache>(cacheKey) || new Map())
  const [loadingDetails, setLoadingDetails] = useState(false)

  useEffect(() => {
    if (!detailTargets.length) {
      setRunEvents(new Map())
      return
    }
    const cached = readGridCache<DetailCache>(cacheKey)
    if (cached && !shouldRunGridFetch(cacheKey, generation)) {
      setRunEvents(cached)
      setLoadingDetails(false)
      return
    }

    const controller = new AbortController()
    let alive = true
    setLoadingDetails(true)
    void fetchRunEventsBatch(detailTargets, controller.signal).then((map) => {
      if (!alive) return
      writeGridCache(cacheKey, map)
      setRunEvents(map)
      setLoadingDetails(false)
    })
    return () => {
      alive = false
      controller.abort()
    }
  }, [cacheKey, detailTargets, generation])

  const counts = useMemo(
    () => aggregateHistoryKpi(filteredRuns, runEvents, titleOf),
    [filteredRuns, runEvents, titleOf]
  )

  const previousCounts = useMemo(
    () => aggregateHistoryKpi(previousFiltered, new Map(), titleOf),
    [previousFiltered, titleOf]
  )

  const tiles = useMemo(
    () => countsToTiles(counts, previousCounts.eventsInPeriod),
    [counts, previousCounts.eventsInPeriod]
  )

  return { counts, tiles, loadingDetails, filteredRuns }
}
