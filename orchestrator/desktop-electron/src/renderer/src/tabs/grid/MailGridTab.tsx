import { useCallback, useMemo, useState } from 'react'
import type { UserProfile } from '../../api/types'
import {
  OrchSlotBotC,
  OrchSlotFilters,
  OrchSlotMain,
  OrchSlotMetrics,
  OrchSlotSide
} from '../../layout/GridSlots'
import type { SpecSummaryTile } from '../../workplace/specV04Shell'
import { SpecAskOrchestratorBlock, SpecPill, SpecSummaryTiles } from '../../workplace/specV04Components'
import { ASK_CHIPS, type SpecMailRow } from '../../workplace/specV04DemoData'
import { useSpecV04Sources } from '../../workplace/useSpecV04Data'
import { StandardGridFilters } from './gridFilters'
import { MailDetailPanel } from './MailDetailPanel'

export function MailGridTab({
  user,
  onAskOrchestrator
}: {
  user: UserProfile
  onAskOrchestrator: (message: string, context: string) => void
}): React.JSX.Element {
  const data = useSpecV04Sources(user)
  const [rowPatches, setRowPatches] = useState<Record<string, Partial<SpecMailRow>>>({})
  const mailRows = useMemo(
    () => data.mailRows.map((row) => ({ ...row, ...rowPatches[row.id] })),
    [data.mailRows, rowPatches]
  )
  const [selectedId, setSelectedId] = useState('')
  const selected = mailRows.find((m) => m.id === (selectedId || mailRows[0]?.id))
  const patchRow = useCallback((id: string, patch: Partial<(typeof mailRows)[0]>) => {
    setRowPatches((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }, [])

  const tiles: SpecSummaryTile[] = useMemo(
    () => [
      { id: 'new', label: 'Новые', value: String(mailRows.length || '—'), tone: 'orange' },
      { id: 'proc', label: 'К обработке', value: String(mailRows.length || '—'), tone: 'blue' },
      { id: 'hi', label: 'Высокий приоритет', value: '—', tone: 'red' },
      { id: 'proj', label: 'Проектные', value: '—', tone: 'purple' },
      { id: 'reg', label: 'Регламентные', value: '—', tone: 'yellow' }
    ],
    [mailRows.length]
  )

  const ask = (m: string) => onAskOrchestrator(m, 'Вкладка «Письма»')

  return (
    <>
      <OrchSlotMetrics>
        <SpecSummaryTiles tiles={tiles} />
      </OrchSlotMetrics>
      <OrchSlotFilters>
        <StandardGridFilters searchPlaceholder="Поиск в письмах…" />
      </OrchSlotFilters>
      <OrchSlotMain>
        <div className="spec-v04-table-wrap wp-card">
          <table className="spec-v04-table">
            <thead>
              <tr>
                <th>Отправитель</th>
                <th>Тема</th>
                <th>Время</th>
                <th>Приоритет</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {!mailRows.length ? (
                <tr>
                  <td colSpan={5} className="spec-v04-empty">
                    {data.loading ? 'Загружаем почту…' : 'Нет писем за неделю (Outlook COM).'}
                  </td>
                </tr>
              ) : null}
              {mailRows.map((row) => (
                <tr key={row.id} className={selected?.id === row.id ? 'selected' : ''} onClick={() => setSelectedId(row.id)}>
                  <td>{row.sender}</td>
                  <td>{row.subject}</td>
                  <td>{row.time}</td>
                  <td>
                    <SpecPill tone={row.priTone}>{row.priority}</SpecPill>
                  </td>
                  <td>
                    <SpecPill tone={row.stTone}>{row.status}</SpecPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </OrchSlotMain>
      <OrchSlotSide>
        {selected ? (
          <MailDetailPanel mail={selected} onPatchRow={patchRow} onAskOrchestrator={ask} />
        ) : (
          <div className="wp-card spec-v04-muted">Выберите письмо</div>
        )}
      </OrchSlotSide>
      <OrchSlotBotC>
        <SpecAskOrchestratorBlock chips={ASK_CHIPS.mail} placeholder="Спросить про письма…" onSubmit={ask} />
      </OrchSlotBotC>
    </>
  )
}
