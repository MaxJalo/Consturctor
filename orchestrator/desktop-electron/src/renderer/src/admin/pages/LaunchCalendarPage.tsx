import { adminLaunchCalendarMock } from '../../mocks/adminMocks'
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

export function LaunchCalendarPage(): React.JSX.Element {
  const mock = adminLaunchCalendarMock
  const rowHeight = 56

  return (
    <AdminPageShell breadcrumb={mock.breadcrumb}>
      <AdminPageHeader
        title={mock.title}
        subtitle={mock.subtitle}
        actions={<AdminPrimaryButton label={mock.createLabel} icon="plus" />}
      />
      <div className="admin-calendar-layout">
        <section className="admin-panel admin-calendar-main">
          <div className="admin-calendar-toolbar">
            <div className="admin-view-toggle">
              {mock.viewModes.map((mode) => (
                <button key={mode} type="button" className={mode === mock.activeView ? 'active' : ''}>
                  {mode}
                </button>
              ))}
            </div>
            <div className="admin-calendar-toolbar__nav">
              <button type="button" className="admin-pagination__nav">‹</button>
              <button type="button" className="admin-filter-pill admin-filter-pill--date">{mock.weekRange}</button>
              <button type="button" className="admin-pagination__nav">›</button>
            </div>
          </div>
          <div className="admin-calendar-grid">
            <div className="admin-calendar-grid__head">
              <div className="admin-calendar-grid__time-col" />
              {mock.days.map((day) => (
                <div key={day} className="admin-calendar-grid__day-head">{day}</div>
              ))}
            </div>
            <div className="admin-calendar-grid__body">
              {mock.hours.map((hour) => (
                <div key={hour} className="admin-calendar-grid__row">
                  <div className="admin-calendar-grid__time">{hour}</div>
                  {mock.days.map((day, dayIndex) => (
                    <div key={`${day}-${hour}`} className="admin-calendar-grid__cell">
                      {mock.events
                        .filter((event) => event.dayIndex === dayIndex && event.startHour === Number(hour.slice(0, 2)))
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
          <section className="admin-unscheduled">
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
        </section>
        <aside className="admin-calendar-side">
          <section className="admin-panel">
            <h3 className="admin-side-title">ИИ-агенты</h3>
            <ul className="admin-check-list">
              {mock.agentFilters.map((item) => (
                <li key={item.id}>
                  <label>
                    <input type="checkbox" defaultChecked={item.checked} />
                    <i style={{ background: item.color }} />
                    {item.label}
                  </label>
                </li>
              ))}
            </ul>
          </section>
          <section className="admin-panel admin-mini-calendar">
            <div className="admin-mini-calendar__head">
              <button type="button" className="admin-pagination__nav">‹</button>
              <strong>{mock.miniMonth}</strong>
              <button type="button" className="admin-pagination__nav">›</button>
            </div>
            <div className="admin-mini-calendar__grid">
              {mock.miniDays.map((item) => (
                <span key={item.day} className={[item.active ? 'active' : '', item.muted ? 'muted' : ''].filter(Boolean).join(' ')}>
                  {item.day}
                </span>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </AdminPageShell>
  )
}
