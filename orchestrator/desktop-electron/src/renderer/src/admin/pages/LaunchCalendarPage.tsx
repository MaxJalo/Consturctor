import { useMemo, useState } from 'react'
import { adminLaunchCalendarMock } from '../../mocks/adminMocks'
import {
  addDays,
  ADMIN_MOCK_TODAY,
  buildMonthGrid,
  dayIsoKey,
  enumerateRangeDays,
  formatAdminDateRange,
  formatMonthDayLabel,
  formatWeekDayLabel,
  getMonthRange,
  getWeekRange,
  isDateInRange,
  isRangeEdge,
  isSameDay,
  MONTH_LABELS,
  rangeDayCount,
  startOfDay,
  type AdminDateRange
} from '../utils/dateRange'
import { AdminDateRangePicker } from '../components/shared/AdminDateRangePicker'
import { AdminOutlineButton } from '../components/shared/AdminOutlineButton'
import { AdminPageHeader } from '../components/shared/AdminPageHeader'
import { AdminPageShell } from '../components/shared/AdminPageShell'
import { AdminPrimaryButton } from '../components/shared/AdminPrimaryButton'

const EVENT_TONE: Record<string, string> = {
  green: 'admin-cal-event--green',
  blue: 'admin-cal-event--blue',
  purple: 'admin-cal-event--purple',
  yellow: 'admin-cal-event--yellow',
  red: 'admin-cal-event--red'
}

const MOCK_EVENT_WEEK_START = getWeekRange(ADMIN_MOCK_TODAY).start
const MONTH_WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
const MONTH_VISIBLE_EVENTS = 3

interface DatedLaunchEvent {
  id: string
  date: Date
  startHour: number
  endHour: number
  title: string
  tone: string
  agentId: string
}

function rangeForView(view: string, anchor: Date): AdminDateRange {
  const day = startOfDay(anchor)
  if (view === 'День') return { start: day, end: day }
  if (view === 'Месяц') return getMonthRange(day)
  if (view === 'Сегодня') {
    const today = ADMIN_MOCK_TODAY
    return { start: today, end: today }
  }
  return getWeekRange(day)
}

function viewForRange(range: AdminDateRange): string {
  const count = rangeDayCount(range)
  if (count === 1) return 'День'
  if (count <= 7) return 'Неделя'
  return 'Месяц'
}

interface LaunchMonthGridProps {
  anchor: Date
  selectedDay: Date
  events: DatedLaunchEvent[]
  onSelectDay: (day: Date) => void
}

function LaunchMonthGrid({ anchor, selectedDay, events, onSelectDay }: LaunchMonthGridProps): React.JSX.Element {
  const month = anchor.getMonth()
  const year = anchor.getFullYear()
  const cells = useMemo(() => buildMonthGrid(year, month), [year, month])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, DatedLaunchEvent[]>()
    for (const event of events) {
      const key = dayIsoKey(event.date)
      const bucket = map.get(key)
      if (bucket) bucket.push(event)
      else map.set(key, [event])
    }
    for (const bucket of map.values()) {
      bucket.sort((left, right) => left.startHour - right.startHour)
    }
    return map
  }, [events])

  return (
    <div className="admin-month-grid">
      <div className="admin-month-grid__head">
        {MONTH_WEEKDAYS.map((label) => (
          <div key={label} className="admin-month-grid__weekday">{label}</div>
        ))}
      </div>
      <div className="admin-month-grid__body">
        {cells.map(({ date, muted }) => {
          const dayEvents = eventsByDay.get(dayIsoKey(date)) ?? []
          const shown = dayEvents.slice(0, MONTH_VISIBLE_EVENTS)
          const leftover = dayEvents.length - shown.length
          const isToday = isSameDay(date, ADMIN_MOCK_TODAY)
          const isSelected = isSameDay(date, selectedDay)
          return (
            <button
              key={date.toISOString()}
              type="button"
              className={[
                'admin-month-cell',
                muted ? 'muted' : '',
                isToday ? 'today' : '',
                isSelected ? 'selected' : ''
              ].filter(Boolean).join(' ')}
              onClick={() => onSelectDay(date)}
            >
              <span className="admin-month-cell__day">{formatMonthDayLabel(date)}</span>
              <div className="admin-month-cell__events">
                {shown.map((event) => (
                  <div key={event.id} className={`admin-month-event ${EVENT_TONE[event.tone]}`}>
                    <span className="admin-month-event__time">{`${String(event.startHour).padStart(2, '0')}:00`}</span>
                    <span className="admin-month-event__title">{event.title}</span>
                  </div>
                ))}
              </div>
              {leftover > 0 ? <span className="admin-month-cell__more">▼</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function LaunchCalendarPage(): React.JSX.Element {
  const mock = adminLaunchCalendarMock
  const rowHeight = 56
  const [activeView, setActiveView] = useState(mock.activeView)
  const [selectedDay, setSelectedDay] = useState(ADMIN_MOCK_TODAY)
  const [range, setRange] = useState<AdminDateRange>(() => getWeekRange(ADMIN_MOCK_TODAY))
  const [miniMonth, setMiniMonth] = useState(ADMIN_MOCK_TODAY.getMonth())
  const [miniYear, setMiniYear] = useState(ADMIN_MOCK_TODAY.getFullYear())
  const [agentChecked, setAgentChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(mock.agentFilters.map((item) => [item.id, item.checked]))
  )

  const visibleDays = useMemo(() => {
    if (activeView === 'Сегодня') return [ADMIN_MOCK_TODAY]
    return enumerateRangeDays(range)
  }, [activeView, range])

  const dayLabels = visibleDays.map((day) => formatWeekDayLabel(day))
  const columnCount = visibleDays.length
  const gridColumns = { gridTemplateColumns: `56px repeat(${columnCount}, minmax(${columnCount > 7 ? 52 : 0}, 1fr))` }

  const activeAgentIds = useMemo(
    () => mock.agentFilters.filter((item) => item.id !== 'all' && agentChecked[item.id]).map((item) => item.id),
    [agentChecked, mock.agentFilters]
  )

  const isMonthView = activeView === 'Месяц'

  const datedEvents = useMemo(() => {
    const base = isMonthView ? getMonthRange(selectedDay).start : MOCK_EVENT_WEEK_START
    return mock.events.map((event) => ({
      ...event,
      date: addDays(base, event.dayIndex)
    }))
  }, [isMonthView, mock.events, selectedDay])

  const visibleEvents = useMemo(
    () => datedEvents.filter((event) => activeAgentIds.includes(event.agentId)),
    [activeAgentIds, datedEvents]
  )

  const miniCells = useMemo(() => buildMonthGrid(miniYear, miniMonth), [miniYear, miniMonth])

  function syncSelection(day: Date, nextRange: AdminDateRange, view?: string): void {
    const normalized = startOfDay(day)
    setSelectedDay(normalized)
    setRange(nextRange)
    setMiniMonth(normalized.getMonth())
    setMiniYear(normalized.getFullYear())
    if (view) setActiveView(view)
  }

  function handleViewChange(mode: string): void {
    if (mode === 'Сегодня') {
      syncSelection(ADMIN_MOCK_TODAY, { start: ADMIN_MOCK_TODAY, end: ADMIN_MOCK_TODAY }, mode)
      return
    }
    const anchor = mode === 'День' || mode === 'Неделя' || mode === 'Месяц' ? selectedDay : ADMIN_MOCK_TODAY
    syncSelection(anchor, rangeForView(mode, anchor), mode)
  }

  function handleRangeChange(next: AdminDateRange): void {
    syncSelection(next.start, next, viewForRange(next))
  }

  function selectMiniDay(date: Date): void {
    const day = startOfDay(date)
    syncSelection(day, rangeForView(activeView, day))
  }

  function shiftPeriod(delta: number): void {
    if (activeView === 'День' || activeView === 'Сегодня') {
      const anchor = activeView === 'Сегодня' ? ADMIN_MOCK_TODAY : selectedDay
      const next = addDays(anchor, delta)
      syncSelection(next, { start: next, end: next }, activeView === 'Сегодня' ? 'День' : activeView)
      return
    }
    if (activeView === 'Месяц') {
      const anchor = new Date(selectedDay.getFullYear(), selectedDay.getMonth() + delta, 1)
      syncSelection(anchor, getMonthRange(anchor), activeView)
      return
    }
    const nextStart = addDays(range.start, delta * 7)
    const nextRange = getWeekRange(nextStart)
    syncSelection(nextStart, nextRange, activeView)
  }

  function toggleAgent(id: string, checked: boolean): void {
    if (id === 'all') {
      setAgentChecked(Object.fromEntries(mock.agentFilters.map((item) => [item.id, checked])))
      return
    }
    setAgentChecked((prev) => {
      const next = { ...prev, [id]: checked }
      next.all = mock.agentFilters.filter((item) => item.id !== 'all').every((item) => next[item.id])
      return next
    })
  }

  return (
    <AdminPageShell breadcrumb={mock.breadcrumb} className="admin-page--fill">
      <AdminPageHeader
        title={mock.title}
        subtitle={mock.subtitle}
        actions={<AdminPrimaryButton label={mock.createLabel} icon="plus" />}
      />
      <div className="admin-calendar-layout">
        <div className="admin-calendar-col">
        <section className="admin-panel admin-calendar-main">
          <div className="admin-calendar-toolbar">
            <div className="admin-view-toggle">
              {mock.viewModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={mode === activeView ? 'active' : ''}
                  onClick={() => handleViewChange(mode)}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div className="admin-calendar-toolbar__nav">
              <button type="button" className="admin-pagination__nav" onClick={() => shiftPeriod(-1)}>‹</button>
              <AdminDateRangePicker value={range} onChange={handleRangeChange} />
              <button type="button" className="admin-pagination__nav" onClick={() => shiftPeriod(1)}>›</button>
            </div>
          </div>
          {isMonthView ? (
            <LaunchMonthGrid
              anchor={selectedDay}
              selectedDay={selectedDay}
              events={visibleEvents}
              onSelectDay={selectMiniDay}
            />
          ) : (
            <div className={`admin-calendar-grid ${columnCount > 7 ? 'admin-calendar-grid--scroll' : ''}`}>
              <div className="admin-calendar-grid__head" style={gridColumns}>
                <div className="admin-calendar-grid__time-col" />
                {dayLabels.map((day) => (
                  <div key={day} className="admin-calendar-grid__day-head">{day}</div>
                ))}
              </div>
              <div className="admin-calendar-grid__body">
                {mock.hours.map((hour) => (
                  <div key={hour} className="admin-calendar-grid__row" style={gridColumns}>
                    <div className="admin-calendar-grid__time">{hour}</div>
                    {visibleDays.map((day) => (
                      <div key={`${day.toISOString()}-${hour}`} className="admin-calendar-grid__cell">
                        {visibleEvents
                          .filter(
                            (event) =>
                              isSameDay(event.date, day) && event.startHour === Number(hour.slice(0, 2))
                          )
                          .map((event) => (
                            <div
                              key={event.id}
                              className={`admin-cal-event ${EVENT_TONE[event.tone]}`}
                              style={{ height: `${(event.endHour - event.startHour) * rowHeight - 8}px` }}
                            >
                              <strong>{event.title}</strong>
                              <span>{`${String(event.startHour).padStart(2, '0')}:00–${String(event.endHour).padStart(2, '0')}:00`}</span>
                            </div>
                          ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
        <section className="admin-panel admin-unscheduled">
          <div className="admin-unscheduled__head">
            <div>
              <h3>Незапланированные запуски</h3>
              <p>Задачи, ожидающие планирования</p>
            </div>
            <AdminOutlineButton label={mock.scheduleAllLabel} icon="calendar" />
          </div>
          <div className="admin-unscheduled__list">
            {mock.unscheduled.map((item) => (
              <article key={item.id} className={`admin-unscheduled__item admin-unscheduled__item--${item.tone}`}>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.subtitle}</p>
                </div>
                <button type="button" className="admin-link-btn">Запланировать</button>
              </article>
            ))}
          </div>
        </section>
        </div>
        <aside className="admin-calendar-side">
          <section className="admin-panel admin-panel--overflow-visible">
            <h3 className="admin-side-title">ИИ-агенты</h3>
            <ul className="admin-check-list">
              {mock.agentFilters.map((item) => (
                <li key={item.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(agentChecked[item.id])}
                      onChange={(event) => toggleAgent(item.id, event.target.checked)}
                    />
                    <i style={{ background: item.color }} />
                    {item.label}
                  </label>
                </li>
              ))}
            </ul>
          </section>
          <section className="admin-panel admin-mini-calendar admin-panel--overflow-visible">
            <div className="admin-mini-calendar__head">
              <button
                type="button"
                className="admin-pagination__nav"
                onClick={() => {
                  if (miniMonth === 0) {
                    setMiniMonth(11)
                    setMiniYear((year) => year - 1)
                  } else setMiniMonth((month) => month - 1)
                }}
              >‹</button>
              <strong>{MONTH_LABELS[miniMonth]} {miniYear}</strong>
              <button
                type="button"
                className="admin-pagination__nav"
                onClick={() => {
                  if (miniMonth === 11) {
                    setMiniMonth(0)
                    setMiniYear((year) => year + 1)
                  } else setMiniMonth((month) => month + 1)
                }}
              >›</button>
            </div>
            <div className="admin-mini-calendar__weekdays">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="admin-mini-calendar__grid">
              {miniCells.map(({ date, muted }) => {
                const inRange = isDateInRange(date, range)
                const edge = isRangeEdge(date, range)
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
                    onClick={() => selectMiniDay(date)}
                  >
                    {date.getDate()}
                  </button>
                )
              })}
            </div>
            <div className="admin-mini-calendar__range">{formatAdminDateRange(range)}</div>
          </section>
        </aside>
      </div>
    </AdminPageShell>
  )
}
