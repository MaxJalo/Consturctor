import { parseRegistryDay } from './assignmentRegistryMappers'
import type { AssignmentRegistryRow } from './assignmentRegistryTypes'

export type RegistryLoadedSpan = {
  dateFrom: string
  dateTo: string
  complete: boolean
}

export type RegistryFetchSlice = {
  dateFrom: string
  dateTo: string
  /** Продолжить skip-пагинацию для этого интервала (тот же запрос, что уже шёл). */
  continuePagination?: boolean
}

function parseIsoDay(iso: string, end = false): Date | null {
  const text = (iso || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const [y, m, d] = text.split('-').map(Number)
  return new Date(y, m - 1, d, end ? 23 : 59, end ? 59 : 59, end ? 999 : 0)
}

export function formatIsoDay(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function dayBeforeIso(iso: string): string {
  const day = parseIsoDay(iso)
  if (!day) return iso
  day.setDate(day.getDate() - 1)
  return formatIsoDay(day)
}

export function dayAfterIso(iso: string): string {
  const day = parseIsoDay(iso)
  if (!day) return iso
  day.setDate(day.getDate() + 1)
  return formatIsoDay(day)
}

function cmpIso(left: string, right: string): number {
  return (left || '').trim().localeCompare((right || '').trim())
}

export function filterRegistryRowsByPeriod(
  rows: AssignmentRegistryRow[],
  dateFrom: string,
  dateTo: string
): AssignmentRegistryRow[] {
  const from = parseIsoDay(dateFrom)
  const to = parseIsoDay(dateTo, true)
  if (!from || !to) return rows
  return rows.filter((row) => {
    const doc = parseRegistryDay(row.date)
    return doc && doc >= from && doc <= to
  })
}

function weekDayBound(iso: string, end = false): Date | null {
  const text = (iso || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null
  const [y, m, d] = text.split('-').map(Number)
  return new Date(y, m - 1, d, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0)
}

/** Понедельник–пятница недели, в которую попадает день. */
export function currentWorkWeek(now = new Date()): { from: string; to: string } {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekday = monday.getDay()
  monday.setDate(monday.getDate() + (weekday === 0 ? -6 : 1 - weekday))
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  return { from: formatIsoDay(monday), to: formatIsoDay(friday) }
}

/**
 * Рабочая неделя: созданные в эти дни, со сроком сдачи в эти дни и просроченные
 * (даже если документ и срок раньше понедельника).
 */
export function filterRegistryWorkWeek(
  rows: AssignmentRegistryRow[],
  dateFrom: string,
  dateTo: string
): AssignmentRegistryRow[] {
  const from = weekDayBound(dateFrom)
  const to = weekDayBound(dateTo, true)
  if (!from || !to) return rows
  const inWeek = (value: Date | null): boolean => Boolean(value && value >= from && value <= to)
  return rows.filter(
    (row) => row.overdue || inWeek(parseRegistryDay(row.date)) || inWeek(parseRegistryDay(row.fullRemediationDue))
  )
}

/** Какие интервалы дат ещё нужно запросить у 1С. */
export function planRegistryFetchSlices(
  loaded: RegistryLoadedSpan | null,
  wantFrom: string,
  wantTo: string
): RegistryFetchSlice[] {
  const from = wantFrom.trim()
  const to = wantTo.trim()
  if (!from || !to) return [{ dateFrom: from, dateTo: to }]

  if (!loaded) {
    return [{ dateFrom: from, dateTo: to }]
  }

  const disjoint =
    cmpIso(to, loaded.dateFrom) < 0 || cmpIso(from, loaded.dateTo) > 0
  if (disjoint) {
    return [{ dateFrom: from, dateTo: to }]
  }

  const wantInsideLoaded =
    cmpIso(from, loaded.dateFrom) >= 0 && cmpIso(to, loaded.dateTo) <= 0
  if (wantInsideLoaded) {
    if (loaded.complete) return []
    return [{ dateFrom: loaded.dateFrom, dateTo: loaded.dateTo, continuePagination: true }]
  }

  const slices: RegistryFetchSlice[] = []
  if (cmpIso(from, loaded.dateFrom) < 0) {
    slices.push({ dateFrom: from, dateTo: dayBeforeIso(loaded.dateFrom) })
  }
  if (cmpIso(to, loaded.dateTo) > 0) {
    slices.push({ dateFrom: dayAfterIso(loaded.dateTo), dateTo: to })
  }
  if (!slices.length && !loaded.complete) {
    slices.push({ dateFrom: loaded.dateFrom, dateTo: loaded.dateTo, continuePagination: true })
  }
  return slices
}
