import { useEffect, useMemo, useState } from 'react'
import { OneCReconnectDialog, OneCReconnectInline } from '../../workplace/OneCReconnectDialog'
import type { UserProfile } from '../../api/types'
import {
  OrchSlotFilters,
  OrchSlotMain,
  OrchSlotMetrics,
  OrchSlotSide
} from '../../layout/GridSlots'
import { SpecPill, SpecProgress, SpecSummaryTiles } from '../../workplace/specV04Components'
import {
  comPasswordSessionHint,
  sessionOneCEmptyText,
  userFacingOneCError
} from '../../workplace/onecSessionHints'
import { isTechnicalTurboMessage } from '../../workplace/turboSession'
import { buildTaskTiles, useSpecV04Sources } from '../../workplace/useSpecV04Data'
import {
  applyTaskTileClick,
  buildTaskCatalog,
  EMPTY_TASK_TILE_FILTER,
  filterTaskRows,
  isDeadTaskSource,
  taskTileActiveIds,
  type TaskTileFilter
} from '../../workplace/tileFilters'
import {
  CREATE_TASK_CHANNEL_LABEL,
  ORCH_CREATE_TASK,
  type CreateTaskChannel
} from '../../workplace/workplaceNav'
import { StandardGridFilters } from './gridFilters'

export function TasksGridTab({
  user,
  navTaskFilter
}: {
  user: UserProfile
  navTaskFilter?: TaskTileFilter | null
}): React.JSX.Element {
  const data = useSpecV04Sources(user)
  const [tileFilter, setTileFilter] = useState(navTaskFilter ?? EMPTY_TASK_TILE_FILTER)
  useEffect(() => {
    if (navTaskFilter) setTileFilter(navTaskFilter)
  }, [navTaskFilter])
  const catalog = useMemo(
    () => buildTaskCatalog(data.erpTasks, data.turboTasks, data.processRows),
    [data.erpTasks, data.turboTasks, data.processRows]
  )
  const taskRows = useMemo(
    () => filterTaskRows(catalog.rows, tileFilter, catalog.erpIds, catalog.turboIds),
    [catalog, tileFilter]
  )
  const onTileSelect = (id: string): void => {
    setTileFilter((current) => applyTaskTileClick(current, id, isDeadTaskSource(data, id)))
  }
  const soapBanner = userFacingOneCError(data.erpError)
  const turboBanner = isTechnicalTurboMessage(data.turboError)
    ? ''
    : userFacingOneCError(data.turboError)
  const showOneCReconnect = !data.erpLoading && data.oneCAuthFailure
  const emptyTableText =
    (data.erpLoading || data.turboLoading) && !taskRows.length
      ? data.erpFio
        ? `Загружаем задачи 1С для ${data.erpFio}…`
        : 'Загружаем задачи…'
      : showOneCReconnect && !taskRows.length
        ? 'Нужно подключить 1С.'
        : catalog.rows.length && !taskRows.length
          ? 'Нет задач по выбранной плитке.'
        : soapBanner || turboBanner
          ? 'Нет открытых задач в таблице.'
          : sessionOneCEmptyText(data.erpFio)
  const reconnectHint = showOneCReconnect
    ? soapBanner || 'Не удалось загрузить задачи 1С.'
    : ''
  const [onecDialogOpen, setOnecDialogOpen] = useState(false)
  useEffect(() => {
    if (data.erpLoading || !showOneCReconnect || data.comPasswordInSession) return
    setOnecDialogOpen(true)
  }, [data.erpLoading, showOneCReconnect, data.comPasswordInSession])
  const [selectedId, setSelectedId] = useState('')
  const [createChannel, setCreateChannel] = useState<CreateTaskChannel | null>(null)
  const effectiveId = selectedId || taskRows[0]?.id || ''
  const selected = taskRows.find((item) => item.id === effectiveId)

  useEffect(() => {
    const onCreate = (event: Event): void => {
      const channel = (event as CustomEvent<{ channel?: CreateTaskChannel }>).detail?.channel
      if (channel === 'onec' || channel === 'turbo' || channel === 'draft') {
        setCreateChannel(channel)
      }
    }
    window.addEventListener(ORCH_CREATE_TASK, onCreate)
    return () => window.removeEventListener(ORCH_CREATE_TASK, onCreate)
  }, [])

  return (
    <>
      <OrchSlotMetrics>
        <SpecSummaryTiles
          tiles={buildTaskTiles(data)}
          activeId={taskTileActiveIds(tileFilter)}
          onSelect={onTileSelect}
          className="spec-v04-tiles-6"
        />
      </OrchSlotMetrics>
      <OrchSlotFilters>
        <StandardGridFilters searchPlaceholder="Поиск по задачам…" />
      </OrchSlotFilters>
      <OrchSlotMain>
        <div className="spec-v04-table-wrap wp-card">
          {soapBanner ? (
            <p className="today-table-status today-table-error today-table-banner">{soapBanner}</p>
          ) : null}
          {showOneCReconnect && taskRows.length ? (
            <OneCReconnectInline errorHint={reconnectHint} onOpen={() => setOnecDialogOpen(true)} />
          ) : null}
          {turboBanner ? (
            <p className="today-table-status today-table-error today-table-banner">{turboBanner}</p>
          ) : null}
          {!soapBanner && !turboBanner && data.erpSecondaryHint ? (
            <p className="today-table-status today-table-banner">{data.erpSecondaryHint}</p>
          ) : null}
          {!soapBanner && !turboBanner && !data.erpSecondaryHint && !data.loading && !taskRows.length ? (
            <p className="today-table-status today-table-banner spec-v04-muted">
              {comPasswordSessionHint()}
            </p>
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
                        errorHint={reconnectHint}
                        onOpen={() => setOnecDialogOpen(true)}
                      />
                    ) : (
                      emptyTableText
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
        {createChannel ? (
          <div className="spec-detail-card wp-card">
            <h2>Создать задачу</h2>
            <SpecPill tone="blue">{CREATE_TASK_CHANNEL_LABEL[createChannel]}</SpecPill>
            <p className="spec-v04-muted">
              Write-API для канала «{CREATE_TASK_CHANNEL_LABEL[createChannel]}» ещё не готов. Задача не
              создана.
            </p>
            <button type="button" className="spec-btn-outline spec-btn-outline-block" onClick={() => setCreateChannel(null)}>
              Закрыть
            </button>
          </div>
        ) : selected ? (
          <div className="spec-detail-card wp-card">
            <h2>{selected.title}</h2>
            <SpecPill tone={selected.statusTone}>{selected.status}</SpecPill>
            <p className="spec-v04-muted">{selected.process}</p>
            <dl className="spec-detail-meta">
              <div>
                <dt>Автор</dt>
                <dd>{selected.author || '—'}</dd>
              </div>
              <div>
                <dt>Исполнитель</dt>
                <dd>{selected.performer || selected.executor || '—'}</dd>
              </div>
              <div>
                <dt>Канал</dt>
                <dd>{selected.channel === 'soap' ? 'SOAP' : selected.channel || '—'}</dd>
              </div>
              <div>
                <dt>Источник</dt>
                <dd>{selected.source}</dd>
              </div>
              <div>
                <dt>Кто</dt>
                <dd>{selected.who}</dd>
              </div>
            </dl>
            <SpecProgress value={selected.progress} />
            <button type="button" className="spec-btn-launch spec-btn-launch-block">
              Отметить выполненной
            </button>
          </div>
        ) : (
          <div className="wp-card spec-v04-muted">Выберите задачу</div>
        )}
      </OrchSlotSide>
      <OneCReconnectDialog
        open={onecDialogOpen}
        onClose={() => setOnecDialogOpen(false)}
        user={user}
        errorHint={soapBanner}
      />
    </>
  )
}
