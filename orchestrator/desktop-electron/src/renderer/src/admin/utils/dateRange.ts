export interface AdminDateRange {
  start: Date
  end: Date
}

export const ADMIN_MOCK_TODAY = new Date(2026, 8, 14)

export function formatAdminDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}.${month}.${year}`
}

export function formatAdminDateRange(range: AdminDateRange): string {
  return `${formatAdminDate(range.start)} — ${formatAdminDate(range.end)}`
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return startOfDay(next)
}

export function getWeekRange(anchor: Date): AdminDateRange {
  const day = anchor.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const start = addDays(anchor, mondayOffset)
  return { start, end: addDays(start, 6) }
}

export function getMonthRange(anchor: Date): AdminDateRange {
  const start = startOfDay(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  const end = startOfDay(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0))
  return { start, end }
}

export function enumerateRangeDays(range: AdminDateRange): Date[] {
  const days: Date[] = []
  let cursor = startOfDay(range.start)
  const endTime = startOfDay(range.end).getTime()
  while (cursor.getTime() <= endTime) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return days
}

export function rangeDayCount(range: AdminDateRange): number {
  return enumerateRangeDays(range).length
}

export function getPeriodRange(periodId: string, anchor = ADMIN_MOCK_TODAY): AdminDateRange {
  if (periodId === 'day') {
    const day = startOfDay(anchor)
    return { start: day, end: day }
  }
  if (periodId === 'week') {
    return getWeekRange(anchor)
  }
  if (periodId === 'month') {
    return { start: new Date(anchor.getFullYear(), anchor.getMonth(), 1), end: startOfDay(anchor) }
  }
  if (periodId === 'quarter') {
    const quarterStartMonth = Math.floor(anchor.getMonth() / 3) * 3
    return {
      start: new Date(anchor.getFullYear(), quarterStartMonth, 1),
      end: startOfDay(anchor)
    }
  }
  return {
    start: new Date(anchor.getFullYear(), 0, 1),
    end: startOfDay(anchor)
  }
}

export function isSameDay(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

export function isDateInRange(date: Date, range: AdminDateRange): boolean {
  const value = startOfDay(date).getTime()
  return value >= startOfDay(range.start).getTime() && value <= startOfDay(range.end).getTime()
}

export function isRangeEdge(date: Date, range: AdminDateRange): boolean {
  return isSameDay(date, range.start) || isSameDay(date, range.end)
}

export const MONTH_LABELS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
]

export function buildMonthGrid(year: number, month: number): Array<{ date: Date; muted: boolean }> {
  const first = new Date(year, month, 1)
  const startOffset = (first.getDay() + 6) % 7
  const start = addDays(first, -startOffset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index)
    return { date, muted: date.getMonth() !== month }
  })
}

export function formatWeekDayLabel(date: Date): string {
  const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${weekdays[date.getDay()]} ${day}.${month}`
}
