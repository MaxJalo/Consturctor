import { useMemo, useState } from 'react'
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
  const selected = projects.find((p) => p.id === (selectedId || projects[0]?.id))

  const tiles: SpecSummaryTile[] = useMemo(
    () => [
      { id: 'active', label: 'Активные проекты', value: String(projects.length || '—'), tone: 'green' },
      { id: 'tasks', label: 'Задачи на сегодня', value: String(projects.reduce((s, p) => s + p.tasks, 0) || '—'), tone: 'blue' },
      { id: 'risk', label: 'С риском', value: '—', tone: 'orange' },
      { id: 'done', label: 'Завершённые этапы', value: '—', tone: 'purple' },
      { id: 'load', label: 'Загрузка', value: '—', tone: 'yellow' }
    ],
    [projects]
  )

  const ask = (m: string) => onAskOrchestrator(m, 'Вкладка «Проекты»')

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
                    {data.loading ? 'Загружаем портфель…' : 'Портфель TurboProject пуст.'}
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
          <div className="spec-detail-card">
            <h2>{selected.name}</h2>
            <p className="wp-code">{selected.code}</p>
            <SpecProgress value={selected.progress} />
            <button type="button" className="spec-btn-launch spec-btn-launch-block">
              Открыть в проекте
            </button>
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
