import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { SpecPillTone } from './specV04DemoData'
import type { SpecV04SourcesState } from './useSpecV04Data'
import { turboProjectTaskToTodayRow } from './specV04Mappers'
import {
  turboPinnedProjectFileIds,
  turboProjectFetchCandidates
} from './orchestratorTaskSources'
import { parseIso, sameDay } from '../utils/calendar'
import { useGridRefreshGeneration } from './GridDataRefreshContext'
import { readGridCache, shouldRunGridFetch, writeGridCache } from './gridDataCache'
import { hasTurboSessionCredentials, turboProjectInvokeArgs } from './userContext'
import { isTechnicalTurboMessage } from './turboSession'
import { turboTaskAssignedToActor } from './turboAssigneeMatch'

export type TodayProjectTaskRow = {
  id: string
  title: string
  deadline: string
  status: string
  statusTone: SpecPillTone
  assignee: string
  assigneeTone: SpecPillTone
  progress: number
}

function isOpenTask(task: Record<string, unknown>): boolean {
  const percent = Number(task.percent_complete ?? 0)
  return !Number.isFinite(percent) || percent < 1
}

function taskRelevantForToday(task: Record<string, unknown>, day: Date): boolean {
  if (!isOpenTask(task)) return false
  const delayDays = Number(task.delay_days ?? 0)
  if (Number.isFinite(delayDays) && delayDays > 0) return true
  const finish = String(task.finish_date || '').trim()
  if (!finish) return true
  const stamp = parseIso(finish) || parseIso(finish.replace(' ', 'T'))
  if (!stamp) return true
  return sameDay(stamp, day)
}

function taskVisibleForToday(
  task: Record<string, unknown>,
  day: Date,
  projectId: string
): boolean {
  if (!isOpenTask(task)) return false
  if (turboPinnedProjectFileIds().includes(projectId)) return true
  return taskRelevantForToday(task, day)
}

export interface TodayProjectTasksState {
  loading: boolean
  noSession: boolean
  error: string
  rows: TodayProjectTaskRow[]
  showingAllAssignees: boolean
}

export function useTodayProjectTasks(
  periodDay: Date,
  spec: Pick<
    SpecV04SourcesState,
    'turboLoading' | 'turboNoSession' | 'projects' | 'erpFio' | 'user'
  >
): TodayProjectTasksState {
  const generation = useGridRefreshGeneration()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<TodayProjectTaskRow[]>([])
  const [showingAllAssignees, setShowingAllAssignees] = useState(false)

  const dayKey = `${periodDay.getFullYear()}-${periodDay.getMonth()}-${periodDay.getDate()}`
  const portfolioKey = spec.projects.map((item) => `${item.id}:${item.tasks}`).join('|')

  useEffect(() => {
    if (spec.turboLoading && !spec.projects.length) {
      setError('')
      return
    }
    const candidates = turboProjectFetchCandidates(spec.projects, 8)
    // #region agent log
    fetch('http://127.0.0.1:7847/ingest/b2a622e9-6027-4fae-9a68-3d036eb3c49e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d8a6bb'},body:JSON.stringify({sessionId:'d8a6bb',runId:'pre-fix',hypothesisId:'H3',location:'useTodayProjectTasks.ts:candidates',message:'today project task fetch',data:{projects:spec.projects.length,candidates:candidates.length,generation},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    if (!candidates.length) {
      setLoading(false)
      setError('')
      setRows([])
      setShowingAllAssignees(false)
      return
    }

    let alive = true
    const cacheKey = `today-project-tasks:${dayKey}:${portfolioKey}`
    const cached = readGridCache<TodayProjectTaskRow[]>(cacheKey)
    if (!shouldRunGridFetch(cacheKey, generation) && cached) {
      setRows(cached)
      setLoading(false)
      return
    }
    if (cached) setRows(cached)
    setLoading(!cached)
    setError('')
    ;(async () => {
      let fetchError = ''
      try {
        const batches = await Promise.all(
          candidates.map(async (project) => {
            const res = await api.invokeServerTool(
              'turboproject.get_project_tasks',
              turboProjectInvokeArgs(spec.user, {
                project_id: project.id,
                status: 'open',
                limit: 40
              })
            )
            if (!res.ok || !res.result || typeof res.result !== 'object') {
              const hint = (res.error || '').trim()
              if (hint && !fetchError && !isTechnicalTurboMessage(hint)) fetchError = hint
              return { projectId: project.id, tasks: [] as Record<string, unknown>[] }
            }
            const payload = res.result as Record<string, unknown>
            const raw = Array.isArray(payload.tasks) ? payload.tasks : []
            return {
              projectId: project.id,
              tasks: raw.filter(
                (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object'
              )
            }
          })
        )
        if (!alive) return
        const visible = batches.flatMap((batch) =>
          batch.tasks
            .filter((task) => taskVisibleForToday(task, periodDay, batch.projectId))
            .map((task) => ({ task, projectId: batch.projectId }))
        )
        const mine = spec.erpFio.trim()
          ? visible.filter((item) => turboTaskAssignedToActor(item.task, spec.erpFio))
          : visible
        const fallbackAll = Boolean(mine.length === 0 && visible.length > 0)
        const picked = fallbackAll ? visible : mine
        const merged = picked
          .sort((left, right) => {
            const leftDelay = Number(left.task.delay_days ?? 0)
            const rightDelay = Number(right.task.delay_days ?? 0)
            if (rightDelay !== leftDelay) return rightDelay - leftDelay
            return String(left.task.finish_date || '').localeCompare(String(right.task.finish_date || ''))
          })
          .map(({ task, projectId }) => turboProjectTaskToTodayRow(task, projectId, spec.erpFio))
        setShowingAllAssignees(fallbackAll)
        setRows(merged)
        setError(fetchError)
        writeGridCache(cacheKey, merged)
      } catch (err) {
        if (!alive) return
        setRows([])
        setShowingAllAssignees(false)
        setError(err instanceof Error ? err.message : 'Не удалось загрузить задачи TurboProject')
      } finally {
        if (alive) setLoading(false)
      }
    })()

    return () => {
      alive = false
    }
  }, [
    dayKey,
    portfolioKey,
    generation,
    spec.turboLoading,
    spec.erpFio,
    spec.user?.id,
    periodDay
  ])

  return {
    loading: ((spec.turboLoading && !spec.projects.length) || loading) && rows.length === 0,
    noSession: !hasTurboSessionCredentials(spec.user),
    error,
    rows,
    showingAllAssignees
  }
}
