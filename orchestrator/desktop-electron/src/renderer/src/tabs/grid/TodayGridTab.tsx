import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { UserProfile } from '../../api/types'
import { OrchSlotFilters, OrchSlotMetrics, OrchSlotTodayCanvas } from '../../layout/GridSlots'
import { ChromeFitRoot } from './TabChromeGrid'
import { TodayWidgetGrid, useTodayWidgetLayout } from './TodayWidgetGrid'
import { TODAY_WIDGET_IDS, TODAY_WIDGET_LABELS } from './useTodayWidgetLayout'
import { SpecPanel, SpecPill, SpecSummaryTiles } from '../../workplace/specV04Components'
import { buildTodayDayBreakdown, useTodayKpiData } from '../../workplace/useTodayKpiData'
import { compareTasksByUrgency, TODAY_ONEC_TASK_FILTER } from '../../workplace/tileFilters'
import { openWorkplaceTab } from '../../workplace/workplaceNav'
import { TodayDayBreakdownModal } from './TodayDayBreakdownModal'
import { useTodayOutlookMail } from '../../workplace/useTodayOutlookMail'
import {
  comPasswordSessionHint,
  isOneCAuthFailure,
  sessionOneCEmptyText,
  sessionOneCLoadingText,
  userFacingOneCError
} from '../../workplace/onecSessionHints'
import { OneCReconnectDialog, OneCReconnectInline } from '../../workplace/OneCReconnectDialog'
import { erpActorFio } from '../../workplace/userContext'
import { useTodayProjectTasks } from '../../workplace/useTodayProjectTasks'
import { parseMeetingTime } from '../../utils/outlookMeetings'
import { sameDay } from '../../utils/calendar'
import { useTodayPreparedDecisions } from '../../workplace/useTodayPreparedDecisions'
import {
  EMPTY_TODAY_BAR_FILTERS,
  TodayFiltersBar,
  TodayPlanPanel,
  type TodayBarFilters
} from './todayTzComponents'
import { uniqueFilterValues } from './gridFilters'
import { agentAccentStyle } from '../../workplace/agentAccent'
import { TodayResultsPanel } from './TodayResultsPanel'
import { useGridDataRefreshContext } from '../../workplace/GridDataRefreshContext'

function TodayCellText({ text }: { text: string }): React.JSX.Element {
  return (
    <span className="today-cell-text" title={text}>
      {text}
    </span>
  )
}

function TodayWindow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="today-grid-window">{children}</div>
}

function MiniTableCard({
  title,
  columns,
  rows,
  loading,
  error,
  emptyText,
  loadingText,
  hint,
  emptyExtra,
  headerAction
}: {
  title: string
  columns: string[]
  rows: React.ReactNode[][]
  loading?: boolean
  /** Shown above the table (KPI/banner), never as a fake data row. */
  error?: string
  emptyText?: string
  loadingText?: string
  hint?: string
  emptyExtra?: React.ReactNode
  headerAction?: React.ReactNode
}): React.JSX.Element {
  const body = ((): React.ReactNode => {
    if (loading && !rows.length) {
      return (
        <tr>
          <td colSpan={columns.length} className="today-table-status">
            {loadingText || 'Загружаем…'}
          </td>
        </tr>
      )
    }
    if (!rows.length) {
      return (
        <tr>
          <td colSpan={columns.length} className="today-table-status">
            {emptyExtra || emptyText || 'Нет данных'}
          </td>
        </tr>
      )
    }
    return rows.map((cells, index) => (
      <tr key={index}>
        {cells.map((cell, cellIndex) => (
          <td key={cellIndex}>{cell}</td>
        ))}
      </tr>
    ))
  })()

  const titleExtra = (
    <span className="today-mini-table-head">
      {headerAction}
      {hint ? <span className="spec-v04-muted today-table-hint">{hint}</span> : null}
    </span>
  )

  return (
    <SpecPanel title={title} extra={headerAction || hint ? titleExtra : undefined}>
      {error && !loading ? (
        <p className="today-table-status today-table-error today-table-banner">{error}</p>
      ) : null}
      <div className="spec-v04-table-wrap today-table-scroll">
        <table className="today-mini-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
    </SpecPanel>
  )
}

function startOfToday(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function TodayGridTab({
  user,
  onOpenDecisions,
  onOpenRun
}: {
  user: UserProfile
  onOpenDecisions: () => void
  onOpenMetrics: () => void
  onOpenPassport: (workflowId: string, title: string, tab?: 'info' | 'files' | 'results') => void
  onRun: (workflowId: string, title: string) => void
  onOpenRun: (workflowId: string, title: string, runId?: string) => void
}): React.JSX.Element {
  const { forceRefresh } = useGridDataRefreshContext()
  const { data, tiles } = useTodayKpiData(user)
  const [dayBreakdownOpen, setDayBreakdownOpen] = useState(false)
  const [periodDay, setPeriodDay] = useState(startOfToday)
  const [barFilters, setBarFilters] = useState<TodayBarFilters>(EMPTY_TODAY_BAR_FILTERS)
  const dayBreakdown = useMemo(() => buildTodayDayBreakdown(data), [data])
  const [onecDialogOpen, setOnecDialogOpen] = useState(false)
  const outlookMail = useTodayOutlookMail(periodDay)
  const preparedDecisions = useTodayPreparedDecisions(periodDay, user.id)
  const projectTasks = useTodayProjectTasks(periodDay, data)
  const erpFio = erpActorFio(user)

  const matchesBar = (blob: string, status = '', executor = '', process = '', sourceId = ''): boolean => {
    if (barFilters.source && barFilters.source !== sourceId) return false
    if (barFilters.status && status !== barFilters.status) return false
    if (barFilters.executor && executor !== barFilters.executor) return false
    if (barFilters.process && process !== barFilters.process) return false
    return true
  }

  const mailRows = useMemo(
    () =>
      outlookMail.rows.filter((row) =>
        matchesBar(`${row.subject} ${row.sender}`, row.status, row.sender, '', 'outlook')
      ),
    [outlookMail.rows, barFilters]
  )
  const taskRows = useMemo(
    () =>
      [...data.erpTasks]
        .filter((row) => matchesBar(row.title, row.status, row.executor || row.who, row.process, 'onec'))
        .sort(compareTasksByUrgency),
    [data.erpTasks, barFilters]
  )
  const meetingRows = useMemo(() => {
    return data.meetings
      .filter((meeting) => {
        const start = parseMeetingTime(meeting.start)
        return start ? sameDay(start, periodDay) : false
      })
      .sort((left, right) => left.start.localeCompare(right.start))
      .filter((meeting) =>
        matchesBar(meeting.subject, '', meeting.organizer || '', '', 'meet')
      )
      .map((meeting) => {
        const start = parseMeetingTime(meeting.start)
        const time =
          start != null
            ? `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`
            : meeting.start
        const attendees = (meeting.attendees || '').split(/[,;]/).map((part) => part.trim()).filter(Boolean)
        return {
          time,
          title: meeting.subject,
          format: meeting.location?.trim() || '—',
          participants: attendees.length ? `${attendees.length} чел.` : '—'
        }
      })
  }, [data.meetings, periodDay, barFilters])

  const projectTaskRows = useMemo(
    () =>
      projectTasks.rows.filter((row) =>
        matchesBar(row.title, row.status, row.assignee, '', 'proj')
      ),
    [projectTasks.rows, barFilters]
  )
  const decisionItems = useMemo(
    () =>
      preparedDecisions.items.filter((item) =>
        matchesBar(item.title, item.status, item.agentName, item.agentName, 'decision')
      ),
    [preparedDecisions.items, barFilters]
  )

  const todayFilterOptions = useMemo(() => {
    const sources = [
      outlookMail.rows.length ? { id: 'outlook', label: 'Outlook' } : null,
      data.erpTasks.length ? { id: 'onec', label: '1С' } : null,
      projectTasks.rows.length ? { id: 'proj', label: 'Проекты' } : null,
      data.meetings.length ? { id: 'meet', label: 'Совещания' } : null,
      preparedDecisions.items.length ? { id: 'decision', label: 'Решения' } : null
    ].filter((item): item is { id: string; label: string } => Boolean(item))
    return {
      sources: sources.map((item) => item.id),
      sourceLabels: Object.fromEntries(sources.map((item) => [item.id, item.label])) as Record<string, string>,
      statuses: uniqueFilterValues([
        ...outlookMail.rows.map((row) => row.status),
        ...data.erpTasks.map((row) => row.status),
        ...projectTasks.rows.map((row) => row.status),
        ...preparedDecisions.items.map((row) => row.status)
      ]),
      executors: uniqueFilterValues([
        ...data.erpTasks.map((row) => row.executor || row.who),
        ...projectTasks.rows.map((row) => row.assignee),
        ...data.meetings.map((row) => row.organizer)
      ]),
      processes: uniqueFilterValues([
        ...data.erpTasks.map((row) => row.process),
        ...preparedDecisions.items.map((row) => row.agentName)
      ])
    }
  }, [
    data.erpTasks,
    data.meetings,
    outlookMail.rows,
    preparedDecisions.items,
    projectTasks.rows
  ])

  const onecError = userFacingOneCError(data.erpError)
  const showOneCReconnect = !data.erpLoading && data.oneCAuthFailure && !data.erpTasks.length
  const onecReconnectBlock = showOneCReconnect ? (
    <OneCReconnectInline
      errorHint={onecError}
      onOpen={() => setOnecDialogOpen(true)}
    />
  ) : undefined

  useEffect(() => {
    if (data.comPasswordInSession || data.erpLoading || !showOneCReconnect) return
    setOnecDialogOpen(true)
  }, [data.comPasswordInSession, data.erpLoading, showOneCReconnect])

  const {
    layoutWithStatic,
    locked,
    visible,
    color,
    editMode,
    setEditMode,
    onLayoutChange,
    toggleWidgetLock,
    toggleWidgetVisible,
    restoreWidget,
    setWidgetColor,
    resetLayout
  } = useTodayWidgetLayout(user.id || '')
  const todayBasketIds = TODAY_WIDGET_IDS.filter((id) => visible[id] === false)

  const todayWidgets = useMemo(
    () => ({
      plan: (
        <TodayWindow>
          <TodayPlanPanel
            periodDay={periodDay}
            userId={user.id || ''}
            fio={erpFio}
            onOpenRun={onOpenRun}
          />
        </TodayWindow>
      ),
      results: (
        <TodayWindow>
          <TodayResultsPanel periodDay={periodDay} userId={user.id} onOpenRun={onOpenRun} />
        </TodayWindow>
      ),
      outlook: (
        <TodayWindow>
        <MiniTableCard
          title="Письма из Outlook"
          loading={outlookMail.loading}
          error={
            outlookMail.error && !/IMAP/i.test(outlookMail.error)
              ? outlookMail.error
              : undefined
          }
          emptyText="Нет писем во входящих за выбранный день"
          columns={['Отправитель', 'Тема', 'Время', 'Приоритет', 'Статус']}
          rows={mailRows.map((row) => [
            <TodayCellText key={`${row.id}-s`} text={row.sender} />,
            <TodayCellText key={`${row.id}-sub`} text={row.subject} />,
            <TodayCellText key={`${row.id}-t`} text={row.time} />,
            <SpecPill key={`${row.id}-p`} tone={row.priTone}>
              {row.priority}
            </SpecPill>,
            <SpecPill key={`${row.id}-s`} tone={row.stTone}>
              {row.status}
            </SpecPill>
          ])}
        />
        </TodayWindow>
      ),
      onec: (
        <TodayWindow>
        <MiniTableCard
          title="Задачи из 1С"
          headerAction={
            <button
              type="button"
              className="today-refresh-btn"
              title="Обновить задачи 1С:Документооборот"
              disabled={data.erpLoading}
              onClick={() => forceRefresh()}
            >
              <RefreshCw size={14} aria-hidden />
            </button>
          }
          loading={data.erpLoading}
          loadingText={sessionOneCLoadingText(erpFio)}
          error={
            taskRows.length
              ? onecError || undefined
              : onecError
                ? isOneCAuthFailure(onecError)
                  ? [onecError, comPasswordSessionHint()].filter(Boolean).join(' · ')
                  : onecError
                : undefined
          }
          emptyText={
            onecError
              ? 'Не удалось загрузить задачи документооборота'
              : sessionOneCEmptyText(erpFio)
          }
          emptyExtra={onecReconnectBlock}
          columns={['Задача', 'Срок', 'Статус', 'Исполнитель']}
          rows={taskRows.map((row) => [
            <TodayCellText key={`${row.id}-t`} text={row.title} />,
            <TodayCellText key={`${row.id}-d`} text={row.deadline} />,
            <SpecPill key={`${row.id}-st`} tone={row.statusTone}>
              {row.status}
            </SpecPill>,
            <SpecPill key={`${row.id}-who`} tone={row.who === 'Я' ? 'blue' : 'purple'}>
              {row.who === 'Я' ? 'Сотрудник' : row.who}
            </SpecPill>
          ])}
        />
        </TodayWindow>
      ),
      projects: (
        <TodayWindow>
        <MiniTableCard
          title="Проектные задачи"
          loading={projectTasks.loading}
          error={projectTasks.error || undefined}
          emptyText="Нет открытых проектных задач"
          hint={projectTasks.showingAllAssignees ? 'Показаны все исполнители' : undefined}
          emptyExtra={
            !data.comPasswordInSession ? (
              <OneCReconnectInline errorHint={onecError} onOpen={() => setOnecDialogOpen(true)} />
            ) : undefined
          }
          columns={['Задача', 'Срок', 'Статус', 'Исполнитель']}
          rows={projectTaskRows.map((row) => [
            <TodayCellText key={`${row.id}-t`} text={row.title} />,
            <TodayCellText key={`${row.id}-d`} text={row.deadline} />,
            <SpecPill key={`${row.id}-st`} tone={row.statusTone}>
              {row.status}
            </SpecPill>,
            <SpecPill key={`${row.id}-a`} tone={row.assigneeTone}>
              {row.assignee}
            </SpecPill>
          ])}
        />
        </TodayWindow>
      ),
      events: (
        <TodayWindow>
        <MiniTableCard
          title="Предстоящие события"
          loading={data.meetingsLoading}
          emptyText="Нет событий Outlook на выбранный день"
          columns={['Время', 'Событие', 'Формат', 'Участники']}
          rows={meetingRows.map((row) => [
            <TodayCellText key={`${row.time}-t`} text={row.time} />,
            <TodayCellText key={`${row.time}-ti`} text={row.title} />,
            <TodayCellText key={`${row.time}-f`} text={row.format} />,
            <TodayCellText key={`${row.time}-p`} text={row.participants} />
          ])}
        />
        </TodayWindow>
      ),
      decisions: (
        <TodayWindow>
        <SpecPanel
          title="Подготовленные решения"
          extra={
            <button type="button" className="today-link-btn" onClick={onOpenDecisions}>
              Все
            </button>
          }
        >
          {preparedDecisions.loading ? (
            <p className="today-table-status">Загружаем…</p>
          ) : preparedDecisions.error ? (
            <p className="today-table-status today-table-error">{preparedDecisions.error}</p>
          ) : !decisionItems.length ? (
            <p className="today-table-status">Нет подготовленных решений</p>
          ) : (
            <ul className="today-decision-list">
              {decisionItems.map((item) => {
                const openRow = (): void => {
                  if (item.workflowId && item.runId) {
                    onOpenRun(item.workflowId, item.agentName, item.runId)
                    return
                  }
                  if (item.workflowId) {
                    onOpenRun(item.workflowId, item.agentName)
                  }
                }
                const clickable = Boolean(item.workflowId)
                return (
                  <li
                    key={item.id}
                    className={`today-decision-item${clickable ? ' today-decision-item-clickable' : ''}`}
                    style={agentAccentStyle(item.workflowId)}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? openRow : undefined}
                    onKeyDown={
                      clickable
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              openRow()
                            }
                          }
                        : undefined
                    }
                  >
                    <span className={`today-decision-status tone-${item.statusTone}`}>
                      {item.statusIcon}
                    </span>
                    <div className="today-decision-body">
                      <strong>{item.title}</strong>
                      {item.subtitle ? (
                        <p className="today-decision-agent-action spec-v04-muted">{item.subtitle}</p>
                      ) : null}
                      <SpecPill tone={item.tagTone}>{item.tag}</SpecPill>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </SpecPanel>
        </TodayWindow>
      )
    }),
    [
      data.erpError,
      onecError,
      data.erpLoading,
      data.erpTasks,
      data.oneCAuthFailure,
      onecReconnectBlock,
      data.meetings,
      data.outlookMailbox,
      data.comPasswordInSession,
      data.turboLoading,
      data.meetingsLoading,
      erpFio,
      preparedDecisions.error,
      decisionItems,
      preparedDecisions.items,
      preparedDecisions.loading,
      mailRows,
      meetingRows,
      onOpenDecisions,
      onOpenRun,
      outlookMail.error,
      outlookMail.loading,
      periodDay,
      projectTasks.error,
      projectTasks.loading,
      projectTaskRows,
      projectTasks.rows,
      projectTasks.showingAllAssignees,
      taskRows,
      user.id
    ]
  )

  return (
    <>
      <OrchSlotMetrics>
        <div className="orch-today-tiles orch-today-tiles-widgets">
          {tiles.map((tile) => (
            <ChromeFitRoot
              key={tile.id}
              widgetId={`tile:${tile.id}`}
              className="tab-chrome-shell today-kpi-tile-widget"
            >
              <SpecSummaryTiles
                tiles={[tile]}
                className="spec-v04-tile-solo"
                onSelect={(id) => {
                  if (id === 'day') {
                    setDayBreakdownOpen(true)
                    return
                  }
                  if (id === 'onec') {
                    openWorkplaceTab('tasks', { taskFilter: TODAY_ONEC_TASK_FILTER })
                    return
                  }
                  if (id === 'reg') {
                    openWorkplaceTab('processes', { processTab: 'reg' })
                    return
                  }
                  if (id === 'proj') {
                    openWorkplaceTab('projects')
                    return
                  }
                  if (id === 'ev') {
                    openWorkplaceTab('meetings')
                  }
                }}
              />
            </ChromeFitRoot>
          ))}
        </div>
      </OrchSlotMetrics>

      <OrchSlotFilters>
        <TodayFiltersBar
          periodDay={periodDay}
          onPeriodDayChange={setPeriodDay}
          widgetEditMode={editMode}
          onWidgetEditModeChange={setEditMode}
          onResetWidgetLayout={resetLayout}
          basketIds={todayBasketIds}
          basketLabels={TODAY_WIDGET_LABELS}
          onRestoreWidget={(id) => restoreWidget(id as (typeof TODAY_WIDGET_IDS)[number])}
          barFilters={barFilters}
          onBarFiltersChange={setBarFilters}
          sourceOptions={[
            outlookMail.rows.length ? { value: 'outlook', label: 'Outlook' } : null,
            data.erpTasks.length ? { value: 'onec', label: '1С' } : null,
            projectTasks.rows.length ? { value: 'proj', label: 'Проекты' } : null,
            data.meetings.length ? { value: 'meet', label: 'Совещания' } : null,
            preparedDecisions.items.length ? { value: 'decision', label: 'Решения' } : null
          ].filter((item): item is { value: string; label: string } => Boolean(item))}
          statusOptions={todayFilterOptions.statuses}
          executorOptions={todayFilterOptions.executors}
          processOptions={todayFilterOptions.processes}
        />
      </OrchSlotFilters>

      <OrchSlotTodayCanvas>
        <TodayWidgetGrid
          userId={user.id || ''}
          editMode={editMode}
          layoutWithStatic={layoutWithStatic}
          locked={locked}
          visible={visible}
          color={color}
          onLayoutChange={onLayoutChange}
          onToggleLock={toggleWidgetLock}
          onToggleVisible={toggleWidgetVisible}
          onSetColor={setWidgetColor}
          widgets={todayWidgets}
        />
      </OrchSlotTodayCanvas>
      <OneCReconnectDialog
        open={onecDialogOpen}
        onClose={() => setOnecDialogOpen(false)}
        user={user}
        errorHint={onecError}
      />
      <TodayDayBreakdownModal
        open={dayBreakdownOpen}
        breakdown={dayBreakdown}
        loading={data.erpLoading || data.tableLoading}
        onClose={() => setDayBreakdownOpen(false)}
      />
    </>
  )
}
