import { useEffect, useMemo, useState } from 'react'
import type { UserProfile } from '../../api/types'
import {
  OrchSlotBotC,
  OrchSlotFilters,
  OrchSlotMain,
  OrchSlotMetrics,
  OrchSlotSide
} from '../../layout/GridSlots'
import type { SpecSummaryTile } from '../../workplace/specV04Shell'
import { SpecAskOrchestratorBlock, SpecSummaryTiles } from '../../workplace/specV04Components'
import { ASK_CHIPS } from '../../workplace/specV04DemoData'
import { erpActorFio } from '../../workplace/userContext'
import { ensureOutlookMeetings, type MeetingEvent } from '../../utils/outlookMeetings'
import { StandardGridFilters } from './gridFilters'

export function MeetingsGridTab({
  user,
  onAskOrchestrator
}: {
  user: UserProfile
  onAskOrchestrator: (message: string, context: string) => void
}): React.JSX.Element {
  const fio = erpActorFio(user)
  const [meetings, setMeetings] = useState<MeetingEvent[]>([])

  useEffect(() => {
    void ensureOutlookMeetings('week', new Date(), { owner: fio }).then((cal) => setMeetings(cal.meetings || []))
  }, [fio])

  const tiles: SpecSummaryTile[] = useMemo(
    () => [
      { id: 'period', label: 'Совещания за период', value: String(meetings.length || '—'), tone: 'orange' },
      { id: 'today', label: 'Предстоящие сегодня', value: '—', tone: 'blue' },
      { id: 'prep', label: 'Подготовка материалов', value: '—', tone: 'green' },
      { id: 'dec', label: 'Требуются решения', value: '—', tone: 'purple' },
      { id: 'done', label: 'Завершённые', value: '—', tone: 'yellow' }
    ],
    [meetings.length]
  )

  const ask = (m: string) => onAskOrchestrator(m, 'Вкладка «Совещания»')

  return (
    <>
      <OrchSlotMetrics>
        <SpecSummaryTiles tiles={tiles} />
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
              {!meetings.length ? (
                <tr>
                  <td colSpan={3} className="spec-v04-empty">
                    Календарь Outlook пуст или недоступен.
                  </td>
                </tr>
              ) : null}
              {meetings.map((m) => (
                <tr key={m.id}>
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
        <div className="wp-card spec-v04-muted">{meetings[0]?.subject || 'Выберите совещание'}</div>
      </OrchSlotSide>
      <OrchSlotBotC>
        <SpecAskOrchestratorBlock chips={ASK_CHIPS.meetings} placeholder="Спросить про совещания…" onSubmit={ask} />
      </OrchSlotBotC>
    </>
  )
}
