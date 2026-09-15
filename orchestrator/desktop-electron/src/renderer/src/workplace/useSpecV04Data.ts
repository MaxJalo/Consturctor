import { useContext } from 'react'
import type { UserProfile } from '../api/types'
import { type MeetingEvent } from '../utils/outlookMeetings'
import type { SpecSummaryTile } from './specV04Shell'
import type { SpecMailRow, SpecProcessRow, SpecProjectRow, SpecTaskRow } from './specV04DemoData'
import { SpecV04SourcesContext } from './SpecV04SourcesProvider'

export interface SpecV04SourcesState {
  /** Долгая подгрузка 1С / Turbo / Outlook (баннер). */
  sourcesLoading: boolean
  /** Только доска агентов Constructor — таблица процессов. */
  tableLoading: boolean
  /** Совместимость: баннер/таблицы на других вкладках. */
  loading: boolean
  error: string
  outlookMailbox: string
  erpFio: string
  erpTasks: SpecTaskRow[]
  erpTaskCount: number
  projects: SpecProjectRow[]
  projectCount: number
  mailRows: SpecMailRow[]
  mailCount: number
  processRows: SpecProcessRow[]
  allProcessRows: SpecProcessRow[]
  meetingCount: number
  /** Совещания с датой начала = сегодня (локальный календарь). */
  meetingCountToday: number
  meetings: MeetingEvent[]
  /** Ошибка загрузки 1С (erp_pm / документооборот), если задач нет. */
  erpError: string
  sources: {
    erp: string
    turbo: string
    mail: string
  }
  /** TurboProject API / учётка недоступны (не путать с пустым портфелем). */
  turboNoSession: boolean
  /** Пароль 1С из экрана входа в памяти renderer (не localStorage). */
  comPasswordInSession: boolean
  /** Нужен повторный ввод пароля 1С (COM / gateway / OData). */
  oneCAuthFailure: boolean
}

function pct(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((done / total) * 100)
}

function processTabKind(row: SpecProcessRow): 'reg' | 'onec' | 'proj' | 'mail' | 'meet' {
  if (row.type === 'Задача из 1С') return 'onec'
  if (row.type === 'Проект') return 'proj'
  if (row.type === 'Письмо') return 'mail'
  if (row.type === 'Совещание') return 'meet'
  return 'reg'
}

export function filterProcessRowsByTab(rows: SpecProcessRow[], tab: string): SpecProcessRow[] {
  if (tab === 'all') return rows
  return rows.filter((row) => processTabKind(row) === tab)
}

export function countProcessRowsByTab(rows: SpecProcessRow[]): Record<string, number> {
  const counts: Record<string, number> = {
    all: rows.length,
    reg: 0,
    onec: 0,
    proj: 0,
    mail: 0,
    meet: 0
  }
  for (const row of rows) {
    counts[processTabKind(row)] += 1
  }
  return counts
}

/** Данные из SpecV04SourcesProvider (App); сигнатура с user сохранена для call sites. */
export function useSpecV04Sources(_user: UserProfile | null): SpecV04SourcesState {
  return useContext(SpecV04SourcesContext)
}

export function buildProcessTiles(data: SpecV04SourcesState): SpecSummaryTile[] {
  const regRows = data.allProcessRows.filter((r) => processTabKind(r) === 'reg')
  const regTotal = regRows.length
  const regDone = regRows.filter((r) => r.status === 'Выполнен').length
  const onecTotal = data.erpTaskCount
  const onecDone = data.erpTasks.filter((t) => t.status === 'Выполнена').length
  const projTotal = data.projectCount
  const mailTotal = data.mailCount
  return [
    {
      id: 'reg',
      label: 'Регламентные процессы',
      value: regTotal ? `${regTotal} активных` : '—',
      hint: regTotal ? `${regDone} выполнено из ${regTotal}` : 'Оркестратор',
      tone: 'green',
      progress: pct(regDone, regTotal || 1),
      ring: true
    },
    {
      id: 'onec',
      label: 'Задачи из 1С',
      value: onecTotal ? `${onecTotal} активных` : '—',
      hint: onecTotal ? `${onecDone} выполнено` : data.sources.erp,
      tone: 'blue',
      progress: pct(onecDone, onecTotal || 1),
      ring: true
    },
    {
      id: 'proj',
      label: 'Проекты',
      value: projTotal ? `${projTotal} в портфеле` : '—',
      hint: data.sources.turbo,
      tone: 'purple',
      progress: projTotal ? 50 : 0,
      ring: true
    },
    {
      id: 'mail',
      label: 'Письма (Outlook)',
      value: mailTotal ? `${mailTotal} за неделю` : '—',
      hint: data.outlookMailbox || data.sources.mail,
      tone: 'orange',
      progress: mailTotal ? 30 : 0,
      ring: true
    },
    {
      id: 'meet',
      label: 'Совещания',
      value: data.meetingCount ? `${data.meetingCount} на неделе` : '—',
      hint: 'Outlook календарь',
      tone: 'yellow',
      progress: data.meetingCount ? 60 : 0,
      ring: true
    }
  ]
}

function taskTileValue(loading: boolean, count: number): string {
  if (loading) return '—'
  return count ? String(count) : '—'
}

export function buildTaskTiles(data: SpecV04SourcesState): SpecSummaryTile[] {
  const loading = data.sourcesLoading
  const overdue = data.erpTasks.filter((t) => t.urgent && t.status !== 'Выполнена').length
  const projOpen = data.projects.reduce((s, p) => s + p.tasks, 0)
  const onecHint = loading
    ? 'загрузка…'
    : data.erpTaskCount
      ? data.sources.erp
      : data.erpError || data.error || data.sources.erp
  return [
    {
      id: 'all',
      label: 'Все задачи',
      value: taskTileValue(loading, data.erpTaskCount),
      hint: onecHint,
      tone: 'blue'
    },
    {
      id: 'onec',
      label: 'Задачи из 1С',
      value: taskTileValue(loading, data.erpTaskCount),
      hint: onecHint,
      tone: 'blue'
    },
    {
      id: 'proj',
      label: 'Проектные',
      value: taskTileValue(loading, projOpen),
      hint: loading ? 'загрузка…' : data.sources.turbo,
      tone: 'purple'
    },
    {
      id: 'reg',
      label: 'Регламентные',
      value: taskTileValue(loading, data.processRows.length),
      tone: 'green'
    },
    {
      id: 'bad',
      label: 'Просроченные',
      value: taskTileValue(loading, overdue),
      tone: 'orange'
    }
  ]
}
