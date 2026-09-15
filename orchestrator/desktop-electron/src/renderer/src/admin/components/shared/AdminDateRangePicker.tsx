import { useEffect, useRef, useState } from 'react'
import {
  ADMIN_MOCK_TODAY,
  buildMonthGrid,
  formatAdminDateRange,
  isDateInRange,
  isRangeEdge,
  isSameDay,
  MONTH_LABELS,
  startOfDay,
  type AdminDateRange
} from '../../utils/dateRange'

interface AdminDateRangePickerProps {
  value: AdminDateRange
  onChange: (value: AdminDateRange) => void
}

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function AdminDateRangePicker({ value, onChange }: AdminDateRangePickerProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [draftStart, setDraftStart] = useState<Date | null>(null)
  const [viewMonth, setViewMonth] = useState(value.end.getMonth())
  const [viewYear, setViewYear] = useState(value.end.getFullYear())

  useEffect(() => {
    function handleClick(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleDayClick(date: Date): void {
    const day = startOfDay(date)
    if (!draftStart) {
      setDraftStart(day)
      onChange({ start: day, end: day })
      return
    }
    const start = day.getTime() <= draftStart.getTime() ? day : draftStart
    const end = day.getTime() >= draftStart.getTime() ? day : draftStart
    onChange({ start, end })
    setDraftStart(null)
    setOpen(false)
  }

  function openCalendar(): void {
    setDraftStart(null)
    setViewMonth(value.end.getMonth())
    setViewYear(value.end.getFullYear())
    setOpen((prev) => !prev)
  }

  const cells = buildMonthGrid(viewYear, viewMonth)

  return (
    <div ref={rootRef} className={`admin-dropdown admin-date-range ${open ? 'is-open' : ''}`}>
      <button type="button" className="admin-filter-pill admin-filter-pill--date" onClick={openCalendar}>
        <svg viewBox="0 0 16 16" aria-hidden>
          <rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <path d="M5 2v2M11 2v2M2.5 6h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        {formatAdminDateRange(value)}
      </button>
      {open ? (
        <div className="admin-date-range__popup">
          <div className="admin-date-range__head">
            <button type="button" className="admin-pagination__nav" onClick={() => {
              if (viewMonth === 0) {
                setViewMonth(11)
                setViewYear((year) => year - 1)
              } else setViewMonth((month) => month - 1)
            }}>‹</button>
            <strong>{MONTH_LABELS[viewMonth]} {viewYear}</strong>
            <button type="button" className="admin-pagination__nav" onClick={() => {
              if (viewMonth === 11) {
                setViewMonth(0)
                setViewYear((year) => year + 1)
              } else setViewMonth((month) => month + 1)
            }}>›</button>
          </div>
          <div className="admin-date-range__weekdays">
            {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
          </div>
          <div className="admin-date-range__grid">
            {cells.map(({ date, muted }) => {
              const inRange = isDateInRange(date, value)
              const edge = isRangeEdge(date, value)
              const today = isSameDay(date, ADMIN_MOCK_TODAY)
              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  className={[
                    muted ? 'muted' : '',
                    inRange ? 'in-range' : '',
                    edge ? 'edge' : '',
                    today ? 'today' : ''
                  ].filter(Boolean).join(' ')}
                  onClick={() => handleDayClick(date)}
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>
          <div className="admin-date-range__hint">Выберите начало и конец периода</div>
        </div>
      ) : null}
    </div>
  )
}
