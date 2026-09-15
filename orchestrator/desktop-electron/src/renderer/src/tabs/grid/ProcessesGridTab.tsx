import { useEffect, useMemo, useState } from 'react'
import type { UserProfile } from '../../api/types'
import {
  OrchSlotBotA,
  OrchSlotBotB,
  OrchSlotBotC,
  OrchSlotFilters,
  OrchSlotMain,
  OrchSlotMetrics,
  OrchSlotSide
} from '../../layout/GridSlots'
import {
  SpecAskOrchestratorBlock,
  SpecFilters,
  SpecPanel,
  SpecPill,
  SpecProgress,
  SpecQuickActions,
  SpecSummaryTiles,
  SpecTableTabs
} from '../../workplace/specV04Components'
import { ASK_CHIPS, type SpecProcessRow } from '../../workplace/specV04DemoData'
import {
  buildProcessTiles,
  countProcessRowsByTab,
  filterProcessRowsByTab,
  useSpecV04Sources
} from '../../workplace/useSpecV04Data'
import { SpecIconCalendar, SpecIconSearch } from '../../workplace/specV04Icons'
import { buildProcessesQuickActions } from '../../workplace/specGridQuickActions'

const DETAIL_TABS = [
  { id: 'general', label: 'Общее' },
  { id: 'tasks', label: 'Задачи' },
  { id: 'reg', label: 'Регламент' },
  { id: 'files', label: 'Файлы' },
  { id: 'history', label: 'История' }
] as const

type DetailTabId = (typeof DETAIL_TABS)[number]['id']

const PROCESS_TABS = [
  { id: 'all', label: 'Все процессы' },
  { id: 'reg', label: 'Регламентные' },
  { id: 'onec', label: 'Задачи из 1С' },
  { id: 'proj', label: 'Проекты' },
  { id: 'mail', label: 'Письма' },
  { id: 'meet', label: 'Совещания' }
]

function ProcessDetail({
  row,
  onOpen
}: {
  row: SpecProcessRow
  onOpen?: (workflowId: string, title: string) => void
}): React.JSX.Element {
  const openId =
    row.id.startsWith('erp:') || row.id.startsWith('mail:') || row.id.startsWith('meet:') || row.id.startsWith('proj:')
      ? ''
      : row.id
  const [detailTab, setDetailTab] = useState<DetailTabId>('general')

  useEffect(() => {
    setDetailTab('general')
  }, [row.id])

  return (
    <div className="spec-detail-card">
      <header className="spec-detail-head">
        <div>
          <h2>{row.name}</h2>
          <span className="wp-code">{row.code}</span>
        </div>
        <button type="button" className="spec-detail-menu" aria-label="Действия">
          ⋯
        </button>
      </header>
      <div className="spec-detail-tabs">
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={detailTab === tab.id ? 'active' : ''}
            onClick={() => setDetailTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {detailTab === 'general' ? (
        <>
          <dl className="spec-detail-meta">
            <div>
              <dt>Тип процесса</dt>
              <dd>{row.type}</dd>
            </div>
            <div>
              <dt>Источник</dt>
              <dd>{row.source}</dd>
            </div>
            <div>
              <dt>Проект</dt>
              <dd>{row.project}</dd>
            </div>
            <div>
              <dt>Моя задача сегодня</dt>
              <dd>{row.taskToday}</dd>
            </div>
            <div>
              <dt>Срок</dt>
              <dd className={row.deadlineUrgent ? 'spec-deadline-urgent' : undefined}>{row.deadline}</dd>
            </div>
          </dl>
          <SpecProgress value={row.progress} />
        </>
      ) : null}
      {detailTab === 'tasks' ? (
        <div className="spec-detail-pane">
          <ul className="spec-detail-list">
            <li>{row.taskToday}</li>
          </ul>
        </div>
      ) : null}
      {detailTab === 'reg' ? (
        <div className="spec-detail-pane">
          <p className="spec-v04-muted">Регламент для «{row.name}».</p>
        </div>
      ) : null}
      {detailTab === 'files' ? (
        <div className="spec-detail-pane">
          <p className="spec-v04-muted">Файлы — в паспорте агента Constructor.</p>
        </div>
      ) : null}
      {detailTab === 'history' ? (
        <div className="spec-detail-pane">
          <p className="spec-v04-muted">История запусков — вкладка «История».</p>
        </div>
      ) : null}
      <footer className="spec-detail-actions">
        {openId ? (
          <>
            <button type="button" className="spec-btn-outline spec-btn-outline-block" onClick={() => onOpen?.(openId, row.name)}>
              Открыть процесс
            </button>
            <button type="button" className="spec-btn-launch spec-btn-launch-block" onClick={() => onOpen?.(openId, row.name)}>
              <span>Запустить исполнение</span>
            </button>
          </>
        ) : (
          <p className="spec-v04-muted">Открытие в Constructor — для регламентных агентов.</p>
        )}
      </footer>
    </div>
  )
}

export function ProcessesGridTab({
  user,
  onOpen,
  onOpenRun,
  onAskOrchestrator
}: {
  user: UserProfile
  onOpen: (workflowId: string, title: string) => void
  onOpenRun: (workflowId: string, title: string, runId?: string) => void
  onAskOrchestrator?: (message: string, context: string) => void
}): React.JSX.Element {
  const data = useSpecV04Sources(user)
  const [tab, setTab] = useState('all')
  const allRows = data.allProcessRows
  const rows = useMemo(() => filterProcessRowsByTab(allRows, tab), [allRows, tab])
  const tabCounts = useMemo(() => countProcessRowsByTab(allRows), [allRows])
  const [selectedId, setSelectedId] = useState('')
  const effectiveId = selectedId || rows[0]?.id || ''
  const selected = rows.find((item) => item.id === effectiveId)

  const tabs = useMemo(
    () =>
      PROCESS_TABS.map((item) => ({
        ...item,
        count: tabCounts[item.id] ?? 0
      })),
    [tabCounts]
  )

  const tableBusy = data.tableLoading && tab === 'reg' && !rows.length
  const tableEmpty = !tableBusy && !rows.length

  const ask = (message: string): void => {
    onAskOrchestrator?.(message, 'Вкладка «Процессы»')
  }

  const quickActions = useMemo(
    () =>
      buildProcessesQuickActions({}).map((action) => ({
        id: action.id,
        label: action.label,
        tone: action.tone,
        onClick: () => void action.run()
      })),
    []
  )

  return (
    <>
      <OrchSlotMetrics>
        <SpecSummaryTiles tiles={buildProcessTiles(data)} />
      </OrchSlotMetrics>
      <OrchSlotFilters>
        <SpecFilters layout="row">
          <select className="wp-select spec-filter-field" defaultValue="">
            <option value="">Все типы</option>
            <option value="reg">Регламент</option>
            <option value="onec">Задача из 1С</option>
            <option value="proj">Проект</option>
            <option value="mail">Письмо</option>
            <option value="meet">Совещание</option>
          </select>
          <select className="wp-select spec-filter-field" defaultValue="">
            <option value="">Все статусы</option>
          </select>
          <select className="wp-select spec-filter-field" defaultValue="">
            <option value="">Все источники</option>
          </select>
          <select className="wp-select spec-filter-field" defaultValue="">
            <option value="">Все проекты</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="spec-filter-input spec-filter-search">
            <SpecIconSearch />
            <input className="wp-search" type="search" placeholder="Поиск…" />
          </label>
          <label className="spec-filter-input spec-filter-period">
            <SpecIconCalendar />
            <select className="wp-select" defaultValue="week">
              <option value="week">Период: Неделя</option>
            </select>
          </label>
          <button type="button" className="spec-filter-reset">
            Сбросить фильтры
          </button>
        </SpecFilters>
      </OrchSlotFilters>
      <OrchSlotMain>
        <div className="spec-table-toolbar">
          <SpecTableTabs tabs={tabs} active={tab} onChange={setTab} />
          <select className="wp-select" defaultValue="priority">
            <option value="priority">Сортировка: По приоритету</option>
          </select>
        </div>
        <div className="spec-v04-table-wrap wp-card">
          <table className="spec-v04-table">
            <thead>
              <tr>
                <th>Процесс</th>
                <th>Тип</th>
                <th>Источник</th>
                <th>Проект</th>
                <th>Моя задача сегодня</th>
                <th>Статус</th>
                <th>Срок</th>
                <th>Прогресс</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tableBusy ? (
                <tr>
                  <td colSpan={9} className="spec-v04-empty">
                    Загружаем регламентные процессы…
                  </td>
                </tr>
              ) : null}
              {tableEmpty ? (
                <tr>
                  <td colSpan={9} className="spec-v04-empty">
                    {data.sourcesLoading ? 'Подгружаем данные…' : 'Нет процессов в категории.'}
                  </td>
                </tr>
              ) : null}
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={effectiveId === row.id ? 'selected' : ''}
                  onClick={() => setSelectedId(row.id)}
                >
                  <td>
                    <strong>{row.name}</strong>
                    <div className="wp-code">{row.code}</div>
                  </td>
                  <td>
                    <SpecPill tone={row.typeTone}>{row.type}</SpecPill>
                  </td>
                  <td>{row.source}</td>
                  <td>{row.project}</td>
                  <td>{row.taskToday}</td>
                  <td>
                    <SpecPill tone={row.statusTone}>{row.status}</SpecPill>
                  </td>
                  <td className={row.deadlineUrgent ? 'spec-deadline-urgent' : undefined}>{row.deadline}</td>
                  <td>
                    <SpecProgress value={row.progress} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn-ghost spec-row-menu"
                      onClick={(event) => {
                        event.stopPropagation()
                        if (
                          !row.id.startsWith('erp:') &&
                          !row.id.startsWith('mail:') &&
                          !row.id.startsWith('meet:') &&
                          !row.id.startsWith('proj:')
                        ) {
                          onOpenRun(row.id, row.name)
                        }
                      }}
                    >
                      ⋮
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </OrchSlotMain>
      <OrchSlotSide>
        {selected ? (
          <ProcessDetail row={selected} onOpen={onOpen} />
        ) : (
          <div className="wp-card spec-v04-muted">Выберите процесс в таблице</div>
        )}
      </OrchSlotSide>
      <OrchSlotBotA>
        <SpecPanel title="Проекты и проектные задачи">
          {data.projects.length ? (
            <table className="spec-v04-table spec-v04-table-compact">
              <tbody>
                {data.projects.slice(0, 3).map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.code}</td>
                    <td>{p.tasks} задач</td>
                    <td>
                      <SpecProgress value={p.progress} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="spec-v04-muted">Портфель TurboProject пуст или недоступен.</p>
          )}
        </SpecPanel>
      </OrchSlotBotA>
      <OrchSlotBotB>
        <SpecPanel title="Быстрые действия">
          <SpecQuickActions items={quickActions} />
        </SpecPanel>
      </OrchSlotBotB>
      <OrchSlotBotC>
        <SpecAskOrchestratorBlock placeholder="Спросить про процессы…" chips={ASK_CHIPS.processes} onSubmit={ask} />
      </OrchSlotBotC>
    </>
  )
}
