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
import {
  SpecAskOrchestratorBlock,
  SpecPill,
  SpecProgress,
  SpecSummaryTiles
} from '../../workplace/specV04Components'
import { ASK_CHIPS } from '../../workplace/specV04DemoData'
import { useSpecV04Sources } from '../../workplace/useSpecV04Data'
import { useTurboProjectOpenTasks } from '../../workplace/useTurboProjectOpenTasks'
import { StandardGridFilters } from './gridFilters'

export function ProjectsGridTab({
  user,
  onAskOrchestrator
}: {
  user: UserProfile
  onAskOrchestrator: (message: string, context: string) => void
}): React.JSX.Element {
  const data = useSpecV04Sources(user)
  const projects = data.projects
  const [selectedId, setSelectedId] = useState('')
  const effectiveId = selectedId || projects[0]?.id || ''
  const selected = projects.find((p) => p.id === effectiveId)

  useEffect(() => {
    if (selectedId || !projects[0]?.id) return
    setSelectedId(projects[0].id)
  }, [projects, selectedId])

  const openTasks = useTurboProjectOpenTasks(
    effectiveId,
    data.user,
    data.erpFio,
    Boolean(effectiveId) && !data.turboNoSession && !data.sourcesLoading
  )

  const riskCount = useMemo(
    () => projects.filter((p) => p.riskTone === 'red' || p.riskTone === 'orange').length,
    [projects]
  )

  const tiles: SpecSummaryTile[] = useMemo(
    () => [
      { id: 'active', label: 'Активные проекты', value: String(projects.length || '—'), tone: 'green' },
      {
        id: 'tasks',
        label: 'Открытые задачи',
        value: String(projects.reduce((s, p) => s + p.tasks, 0) || '—'),
        tone: 'blue'
      },
      { id: 'risk', label: 'С риском', value: riskCount ? String(riskCount) : '—', tone: 'orange' },
      { id: 'done', label: 'Завершённые этапы', value: '—', tone: 'purple' },
      { id: 'load', label: 'Загрузка', value: '—', tone: 'yellow' }
    ],
    [projects, riskCount]
  )

  const ask = (m: string) => onAskOrchestrator(m, 'Вкладка «Проекты»')
  const fileLabel = selected?.fileId || selected?.id || '—'

  return (
    <>
      <OrchSlotMetrics>
        <SpecSummaryTiles tiles={tiles} />
      </OrchSlotMetrics>
      <OrchSlotFilters>
        <StandardGridFilters searchPlaceholder="Поиск по проектам…" />
      </OrchSlotFilters>
      <OrchSlotMain>
        <div className="spec-v04-table-wrap wp-card">
          <table className="spec-v04-table">
            <thead>
              <tr>
                <th>Проект</th>
                <th>Код</th>
                <th>Роль</th>
                <th>Задачи</th>
                <th>Статус</th>
                <th>Срок</th>
                <th>Прогресс</th>
                <th>Риск</th>
              </tr>
            </thead>
            <tbody>
              {!projects.length ? (
                <tr>
                  <td colSpan={8} className="spec-v04-empty">
                    {data.loading
                      ? 'Загружаем портфель…'
                      : data.turboNoSession
                        ? `TurboProject: ${data.sources.turbo || 'нет сеанса'}`
                        : 'Портфель TurboProject пуст (нет проектов по вашему ФИО).'}
                  </td>
                </tr>
              ) : null}
              {projects.map((p) => (
                <tr key={p.id} className={selected?.id === p.id ? 'selected' : ''} onClick={() => setSelectedId(p.id)}>
                  <td>
                    <strong>{p.name}</strong>
                  </td>
                  <td>{p.code}</td>
                  <td>{p.role}</td>
                  <td>{p.tasks}</td>
                  <td>
                    <SpecPill tone={p.statusTone}>{p.status}</SpecPill>
                  </td>
                  <td>{p.deadline}</td>
                  <td>
                    <SpecProgress value={p.progress} />
                  </td>
                  <td>
                    <SpecPill tone={p.riskTone}>{p.risk}</SpecPill>
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
            <h2>{selected.name}</h2>
            <div className="spec-detail-tags">
              <SpecPill tone={selected.statusTone}>{selected.status}</SpecPill>
              <SpecPill tone={selected.riskTone}>{selected.risk}</SpecPill>
            </div>
            <dl className="spec-detail-meta">
              <div>
                <dt>Код / file_id</dt>
                <dd>
                  {selected.code}
                  {fileLabel !== selected.code ? ` · ${fileLabel}` : ''}
                </dd>
              </div>
              <div>
                <dt>Роль</dt>
                <dd>{selected.role}</dd>
              </div>
              <div>
                <dt>Срок</dt>
                <dd>{selected.deadline}</dd>
              </div>
              {selected.manager ? (
                <div>
                  <dt>Руководитель</dt>
                  <dd>{selected.manager}</dd>
                </div>
              ) : null}
            </dl>
            <p className="spec-v04-muted">Открытых задач: {selected.tasks}</p>
            <SpecProgress value={selected.progress} />
            <h4 className="spec-detail-pane">Открытые задачи (топ 5)</h4>
            {openTasks.loading ? (
              <p className="spec-v04-muted">Загружаем задачи…</p>
            ) : openTasks.error ? (
              <p className="spec-v04-muted">{openTasks.error}</p>
            ) : openTasks.rows.length ? (
              <ul className="spec-detail-list">
                {openTasks.rows.map((task) => (
                  <li key={task.id}>
                    {task.title}
                    <span className="spec-v04-muted"> · {task.deadline}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="spec-v04-muted">Нет открытых задач в MPP</p>
            )}
            <footer className="spec-detail-actions">
              <button type="button" className="btn-primary">
                Открыть в проекте
              </button>
            </footer>
          </div>
        ) : (
          <div className="wp-card spec-v04-muted">Выберите проект</div>
        )}
      </OrchSlotSide>
      <OrchSlotBotC>
        <SpecAskOrchestratorBlock chips={ASK_CHIPS.projects} placeholder="Спросить про проекты…" onSubmit={ask} />
      </OrchSlotBotC>
    </>
  )
}
