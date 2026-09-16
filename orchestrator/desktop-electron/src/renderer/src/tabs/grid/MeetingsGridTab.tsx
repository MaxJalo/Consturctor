import { useEffect, useMemo, useState } from 'react'
import type { UserProfile } from '../../api/types'
import { OrchSlotFilters, OrchSlotMain, OrchSlotMetrics, OrchSlotSide } from '../../layout/GridSlots'
import type { SpecSummaryTile } from '../../workplace/specV04Shell'
import { SpecSummaryTiles } from '../../workplace/specV04Components'
import { erpActorFio } from '../../workplace/userContext'
import { ensureOutlookMeetings, parseMeetingTime, type MeetingEvent } from '../../utils/outlookMeetings'
import { countMeetingTiles, meetingMatchesTile, toggleSimpleTile } from '../../workplace/tileFilters'
import { StandardGridFilters } from './gridFilters'

function meetingField(value: string | undefined): string {
  const text = (value || '').trim()
  return text || '—'
}

function formatMeetingStamp(value: string): string {
  const parsed = parseMeetingTime(value)
  if (!parsed) return meetingField(value)
  return parsed.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function MeetingDetailCard({ meeting }: { meeting: MeetingEvent }): React.JSX.Element {
  return (
    <div className="spec-detail-card wp-card">
      <h2>{meetingField(meeting.subject)}</h2>
      <dl className="spec-detail-meta">
        <div>
          <dt>Начало</dt>
          <dd>{formatMeetingStamp(meeting.start)}</dd>
        </div>
        <div>
          <dt>Окончание</dt>
          <dd>{formatMeetingStamp(meeting.end)}</dd>
        </div>
        <div>
          <dt>Место</dt>
          <dd>{meetingField(meeting.location)}</dd>
        </div>
        <div>
          <dt>Организатор</dt>
          <dd>{meetingField(meeting.organizer)}</dd>
        </div>
        <div>
          <dt>Участники</dt>
          <dd>{meetingField(meeting.attendees)}</dd>
        </div>
        <div>
          <dt>Владелец</dt>
          <dd>{meetingField(meeting.owner)}</dd>
        </div>
      </dl>
    </div>
  )
}

export function MeetingsGridTab({ user }: { user: UserProfile }): React.JSX.Element {
  const fio = erpActorFio(user)
  const [meetings, setMeetings] = useState<MeetingEvent[]>([])

  useEffect(() => {
    void ensureOutlookMeetings('week', new Date(), { owner: fio }).then((cal) => setMeetings(cal.meetings || []))
  }, [fio])

  const [tileFilter, setTileFilter] = useState('all')
  const [selectedId, setSelectedId] = useState('')
  const visibleMeetings = useMemo(
    () => meetings.filter((item) => meetingMatchesTile(item, tileFilter)),
    [meetings, tileFilter]
  )
  const selected = visibleMeetings.find((item) => item.id === (selectedId || visibleMeetings[0]?.id))

  const tiles: SpecSummaryTile[] = useMemo(() => {
    const counts = countMeetingTiles(meetings)
    const dash = (n: number): string => (n ? String(n) : '—')
    return [
      { id: 'period', label: 'Совещания за период', value: dash(counts.period), tone: 'orange' },
      { id: 'today', label: 'Предстоящие сегодня', value: dash(counts.today), tone: 'blue' },
      { id: 'prep', label: 'Подготовка материалов', value: '—', tone: 'green' },
      { id: 'dec', label: 'Требуются решения', value: '—', tone: 'purple' },
      { id: 'done', label: 'Завершённые', value: dash(counts.done), tone: 'yellow' }
    ]
  }, [meetings])

  return (
    <>
      <OrchSlotMetrics>
        <SpecSummaryTiles
          tiles={tiles}
          activeId={tileFilter === 'all' ? 'period' : tileFilter}
          onSelect={(id) => {
            if (id === 'prep' || id === 'dec') return
            setTileFilter((current) => (id === 'period' ? 'all' : toggleSimpleTile(current, id)))
          }}
        />
      </OrchSlotMetrics>
      <OrchSlotFilters>
        <StandardGridFilters searchPlaceholder="Поиск совещаний…" />
      </OrchSlotFilters>
      <OrchSlotMain>
        <div className="spec-v04-table-wrap wp-card">
          <table className="spec-v04-table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Название</th>
                <th>Место</th>
              </tr>
            </thead>
            <tbody>
              {!visibleMeetings.length ? (
                <tr>
                  <td colSpan={3} className="spec-v04-empty">
                    {meetings.length ? 'Нет совещаний по выбранной плитке' : 'Календарь Outlook пуст или недоступен.'}
                  </td>
                </tr>
              ) : null}
              {visibleMeetings.map((m) => (
                <tr
                  key={m.id}
                  className={selected?.id === m.id ? 'selected' : ''}
                  onClick={() => setSelectedId(m.id)}
                >
                  <td>{m.start}</td>
                  <td>{m.subject}</td>
                  <td>{m.location || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </OrchSlotMain>
      <OrchSlotSide>
        {selected ? (
          <MeetingDetailCard meeting={selected} />
        ) : (
          <div className="wp-card spec-v04-muted">Выберите совещание</div>
        )}
      </OrchSlotSide>
    </>
  )
}
