import { useCallback, useMemo, useState } from 'react'
import type { UserProfile } from '../../api/types'
import {
  OrchSlotFilters,
  OrchSlotMain,
  OrchSlotMetrics,
  OrchSlotSide
} from '../../layout/GridSlots'
import type { SpecSummaryTile } from '../../workplace/specV04Shell'
import { SpecPill, SpecSummaryTiles } from '../../workplace/specV04Components'
import { type SpecMailRow } from '../../workplace/specV04DemoData'
import { useSpecV04Sources } from '../../workplace/useSpecV04Data'
import { countMailTiles, mailMatchesTile, toggleSimpleTile } from '../../workplace/tileFilters'
import { mailListEmptyHint } from '../../workplace/mailProbe'
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
  const [tileFilter, setTileFilter] = useState('all')
  const visibleMail = useMemo(
    () => mailRows.filter((row) => mailMatchesTile(row, tileFilter)),
    [mailRows, tileFilter]
  )
  const selected = visibleMail.find((m) => m.id === (selectedId || visibleMail[0]?.id))
  const patchRow = useCallback((id: string, patch: Partial<(typeof mailRows)[0]>) => {
    setRowPatches((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }, [])

  const tiles: SpecSummaryTile[] = useMemo(() => {
    const counts = countMailTiles(mailRows)
    const dash = (n: number): string => (n ? String(n) : '—')
    return [
      { id: 'new', label: 'Новые', value: dash(counts.new), tone: 'orange' },
      { id: 'proc', label: 'К обработке', value: dash(counts.proc), tone: 'blue' },
      { id: 'hi', label: 'Высокий приоритет', value: dash(counts.hi), tone: 'red' },
      { id: 'proj', label: 'Проектные', value: dash(counts.proj), tone: 'purple' },
      { id: 'reg', label: 'Регламентные', value: dash(counts.reg), tone: 'yellow' }
    ]
  }, [mailRows])

  const ask = (m: string) => onAskOrchestrator(m, 'Вкладка «Письма»')

  return (
    <>
      <OrchSlotMetrics>
        <SpecSummaryTiles
          tiles={tiles}
          activeId={tileFilter === 'all' ? 'new' : tileFilter}
          onSelect={(id) => setTileFilter((current) => (id === 'new' ? 'all' : toggleSimpleTile(current, id)))}
        />
      </OrchSlotMetrics>
      <OrchSlotFilters>
        <StandardGridFilters searchPlaceholder="Поиск в письмах…" />
      </OrchSlotFilters>
      <OrchSlotMain>
        <div className="spec-v04-table-wrap wp-card">
          {data.mailComError || data.mailImapError || (!data.mailImapPrimary && data.mailImapStatus) ? (
            <p className="spec-v04-muted">
              {[data.mailComError, data.mailImapError, data.mailImapPrimary ? '' : data.mailImapStatus]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
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
              {!visibleMail.length ? (
                <tr>
                  <td colSpan={5} className="spec-v04-empty">
                    {mailRows.length
                      ? 'Нет писем по выбранной плитке'
                      : mailListEmptyHint({
                          loading: data.mailLoading || data.loading,
                          imapPrimary: data.mailImapPrimary,
                          mailbox: data.outlookMailbox,
                          imapStatus: data.mailImapStatus
                        })}
                  </td>
                </tr>
              ) : null}
              {visibleMail.map((row) => (
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
    </>
  )
}
