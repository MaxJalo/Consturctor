import { useMemo } from 'react'
import type { UserProfile } from '../api/types'
import type { SpecSummaryTile } from './specV04Shell'
import { type SpecV04SourcesState, useSpecV04Sources } from './useSpecV04Data'

function pct(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((done / total) * 100)
}

function dash(loading: boolean, text: string): string {
  return loading ? '—' : text
}

/**
 * KPI «Сегодня»: агрегаты из useSpecV04Sources (1С erp_pm, Turbo, агенты, Outlook).
 * «Выполнение дня» — композит: выполненные задачи 1С + регламентные агенты / их сумма (partial, без проектных задач Turbo).
 * «Задачи 1С» — onec.erp_tasks_current + onec.docflow_tasks (ТД_ЗадачиМне / документооборот).
 */
export function buildTodayKpiTiles(data: SpecV04SourcesState): SpecSummaryTile[] {
  const loading = data.loading

  const onecTotal = data.erpTaskCount
  const onecDone = data.erpTasks.filter((t) => t.status === 'Выполнена').length

  const regRows = data.processRows
  const regTotal = regRows.length
  const regDone = regRows.filter((r) => r.status === 'Выполнен').length

  const dayTotal = onecTotal + regTotal
  const dayDone = onecDone + regDone
  const dayPct = loading ? undefined : pct(dayDone, dayTotal || 1)

  const projTotal = data.projectCount
  const projActive = data.projects.filter(
    (p) => !/заверш|закрыт|complete|done/i.test(p.status)
  ).length
  const projHint = loading ? 'загрузка…' : data.sources.turbo

  const meetToday = data.meetingCountToday

  return [
    {
      id: 'day',
      label: 'Выполнение дня',
      value: dash(loading, dayTotal ? `${dayDone} из ${dayTotal}` : '—'),
      hint: loading
        ? 'загрузка…'
        : dayTotal
          ? '1С + регламентные агенты'
          : 'нет задач на учёте',
      tone: 'orange',
      progress: dayPct,
      ring: true
    },
    {
      id: 'onec',
      label: 'Задачи из 1С',
      value: dash(loading, onecTotal ? String(onecTotal) : '—'),
      hint: loading ? 'загрузка…' : onecTotal ? `${onecDone} выполнено` : data.sources.erp,
      tone: 'blue',
      progress: loading ? undefined : pct(onecDone, onecTotal || 1),
      ring: true
    },
    {
      id: 'reg',
      label: 'Регламентные работы',
      value: dash(loading, regTotal ? String(regTotal) : '—'),
      hint: loading
        ? 'загрузка…'
        : regTotal
          ? `${regDone} из ${regTotal} выполнено`
          : 'агенты Constructor',
      tone: 'green',
      progress: loading ? undefined : pct(regDone, regTotal || 1),
      ring: true
    },
    {
      id: 'proj',
      label: 'Проекты',
      value: dash(loading, projTotal ? String(projTotal) : '—'),
      hint: loading
        ? 'загрузка…'
        : projTotal
          ? `${projActive} активных`
          : projHint,
      tone: 'purple',
      progress: loading ? undefined : pct(projActive, projTotal || 1),
      ring: true
    },
    {
      id: 'ev',
      label: 'События дня',
      value: dash(loading, meetToday ? String(meetToday) : '—'),
      hint: loading ? 'загрузка…' : 'Outlook, сегодня',
      tone: 'yellow',
      progress: loading ? undefined : meetToday ? Math.min(100, 25 + meetToday * 15) : 0,
      ring: true
    }
  ]
}

export function useTodayKpiData(user: UserProfile | null): {
  data: SpecV04SourcesState
  tiles: SpecSummaryTile[]
} {
  const data = useSpecV04Sources(user)
  const tiles = useMemo(() => buildTodayKpiTiles(data), [data])
  return { data, tiles }
}
