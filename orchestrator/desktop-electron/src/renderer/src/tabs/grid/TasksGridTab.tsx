import { useEffect, useState } from 'react'
import { OneCReconnectDialog, OneCReconnectInline } from '../../workplace/OneCReconnectDialog'
import type { UserProfile } from '../../api/types'
import {
  OrchSlotBotC,
  OrchSlotFilters,
  OrchSlotMain,
  OrchSlotMetrics,
  OrchSlotSide
} from '../../layout/GridSlots'
import { SpecAskOrchestratorBlock, SpecPill, SpecProgress, SpecSummaryTiles } from '../../workplace/specV04Components'
import { ASK_CHIPS } from '../../workplace/specV04DemoData'
import { comPasswordSessionHint } from '../../workplace/onecSessionHints'
import { buildTaskTiles, useSpecV04Sources } from '../../workplace/useSpecV04Data'
import { StandardGridFilters } from './gridFilters'

export function TasksGridTab({
  user,
  onAskOrchestrator
}: {
  user: UserProfile
  onAskOrchestrator: (message: string, context: string) => void
}): React.JSX.Element {
  const data = useSpecV04Sources(user)
  const taskRows = data.erpTasks
  const showOneCReconnect = !data.loading && !taskRows.length && data.oneCAuthFailure
  const emptyCore =
    data.loading && !taskRows.length
      ? 'Загружаем задачи из 1С…'
      : data.erpError || data.error || 'Нет открытых задач 1С.'
  const emptyMessage =
    data.loading && !taskRows.length
      ? emptyCore
      : showOneCReconnect
        ? emptyCore
        : `${emptyCore}${emptyCore.includes('Пароль 1С в сессии') ? '' : ` · ${comPasswordSessionHint()}`}`
  const [onecDialogOpen, setOnecDialogOpen] = useState(false)
  useEffect(() => {
    if (data.loading || !showOneCReconnect || data.comPasswordInSession) return
    setOnecDialogOpen(true)
  }, [data.loading, showOneCReconnect, data.comPasswordInSession])
  const [selectedId, setSelectedId] = useState('')
  const effectiveId = selectedId || taskRows[0]?.id || ''
  const selected = taskRows.find((item) => item.id === effectiveId)
  const ask = (m: string) => onAskOrchestrator(m, 'Вкладка «Задачи»')

  return (
    <>
      <OrchSlotMetrics>
        <SpecSummaryTiles tiles={buildTaskTiles(data)} />
      </OrchSlotMetrics>
      <OrchSlotFilters>
        <StandardGridFilters searchPlaceholder="Поиск по задачам…" />
      </OrchSlotFilters>
      <OrchSlotMain>
        <div className="spec-v04-table-wrap wp-card">
          {(data.erpError || data.error) && !showOneCReconnect ? (
            <p className="today-table-status today-table-error today-table-banner">
              {data.erpError || data.error}
            </p>
          ) : data.erpSecondaryHint ? (
            <p className="today-table-status today-table-banner">{data.erpSecondaryHint}</p>
          ) : null}
          <table className="spec-v04-table">
            <thead>
              <tr>
                <th />
                <th>Задача</th>
                <th>Источник</th>
                <th>Процесс</th>
                <th>Срок</th>
                <th>Статус</th>
                <th>Прогресс</th>
              </tr>
            </thead>
            <tbody>
              {!taskRows.length ? (
                <tr>
                  <td colSpan={7} className="spec-v04-empty">
                    {showOneCReconnect ? (
                      <OneCReconnectInline
                        errorHint={emptyMessage}
                        onOpen={() => setOnecDialogOpen(true)}
                      />
                    ) : data.erpError || data.error ? (
                      'Нет открытых задач 1С.'
                    ) : (
                      emptyMessage
                    )}
                  </td>
                </tr>
              ) : null}
              {taskRows.map((row) => (
                <tr
                  key={row.id}
                  className={effectiveId === row.id ? 'selected' : ''}
                  onClick={() => setSelectedId(row.id)}
                >
                  <td>
                    <input type="checkbox" onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td>
                    <strong>{row.title}</strong>
                  </td>
                  <td>{row.source}</td>
                  <td>{row.process}</td>
                  <td className={row.urgent ? 'spec-deadline-urgent' : undefined}>{row.deadline}</td>
                  <td>
                    <SpecPill tone={row.statusTone}>{row.status}</SpecPill>
                  </td>
                  <td>
                    <SpecProgress value={row.progress} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </OrchSlotMain>
      <OrchSlotSide>
        {selected ? (
          <div className="spec-detail-card wp-card">
            <h2>{selected.title}</h2>
            <SpecPill tone={selected.statusTone}>{selected.status}</SpecPill>
            <p className="spec-v04-muted">{selected.process}</p>
            <SpecProgress value={selected.progress} />
            <button type="button" className="spec-btn-launch spec-btn-launch-block">
              Отметить выполненной
            </button>
          </div>
        ) : (
          <div className="wp-card spec-v04-muted">Выберите задачу</div>
        )}
      </OrchSlotSide>
      <OrchSlotBotC>
        <SpecAskOrchestratorBlock chips={ASK_CHIPS.tasks} placeholder="Спросить про задачи…" onSubmit={ask} />
      </OrchSlotBotC>
      <OneCReconnectDialog
        open={onecDialogOpen}
        onClose={() => setOnecDialogOpen(false)}
        user={user}
        errorHint={data.erpError || data.error}
      />
    </>
  )
}
