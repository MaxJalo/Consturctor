import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
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
import { ASK_CHIPS, type SpecKnowledgeRow } from '../../workplace/specV04DemoData'
import { StandardGridFilters } from './gridFilters'

export function KnowledgeGridTab({
  user,
  onAskOrchestrator
}: {
  user: UserProfile
  onAskOrchestrator: (message: string, context: string) => void
}): React.JSX.Element {
  const [catalog, setCatalog] = useState<SpecKnowledgeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    let alive = true
    void api
      .listWorkflows()
      .then((items) => {
        if (!alive) return
        setCatalog(
          items
            .filter((w) => w.documentName)
            .slice(0, 50)
            .map((w) => ({
              id: w.id,
              name: w.documentName || w.title,
              type: 'Регламент',
              typeTone: 'green' as const,
              section: w.phase || '—',
              process: w.title,
              project: '—',
              version: '—',
              updated: '—',
              author: 'Constructor'
            }))
        )
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const selected = catalog.find((c) => c.id === (selectedId || catalog[0]?.id))

  const tiles: SpecSummaryTile[] = useMemo(
    () => [
      { id: 'all', label: 'Документов (агенты)', value: String(catalog.length || '—'), tone: 'blue' },
      { id: 'reg', label: 'Регламенты', value: String(catalog.length || '—'), tone: 'green' },
      { id: 'tpl', label: 'Шаблоны', value: '—', tone: 'orange' },
      { id: 'art', label: 'Статьи', value: '—', tone: 'purple' },
      { id: 'upd', label: 'Обновлено', value: '—', tone: 'yellow' }
    ],
    [catalog.length]
  )

  const ask = (m: string) => onAskOrchestrator(m, 'Вкладка «База знаний»')

  return (
    <>
      <OrchSlotMetrics>
        <SpecSummaryTiles tiles={tiles} />
      </OrchSlotMetrics>
      <OrchSlotFilters>
        <StandardGridFilters searchPlaceholder="Поиск по материалам…" />
      </OrchSlotFilters>
      <OrchSlotMain>
        <div className="spec-v04-table-wrap wp-card">
          <table className="spec-v04-table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Тип</th>
                <th>Раздел</th>
                <th>Процесс</th>
                <th>Автор</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="spec-v04-empty">
                    Загружаем каталог…
                  </td>
                </tr>
              ) : null}
              {!loading && !catalog.length ? (
                <tr>
                  <td colSpan={5} className="spec-v04-empty">
                    Нет опубликованных регламентов для {user.fio}.
                  </td>
                </tr>
              ) : null}
              {catalog.map((row) => (
                <tr key={row.id} className={selected?.id === row.id ? 'selected' : ''} onClick={() => setSelectedId(row.id)}>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td>
                    <SpecPill tone={row.typeTone}>{row.type}</SpecPill>
                  </td>
                  <td>{row.section}</td>
                  <td>{row.process}</td>
                  <td>{row.author}</td>
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
            <SpecPill tone={selected.typeTone}>{selected.type}</SpecPill>
            <p className="spec-v04-muted">{selected.process}</p>
            <button type="button" className="spec-btn-launch spec-btn-launch-block">
              Открыть
            </button>
          </div>
        ) : (
          <div className="wp-card spec-v04-muted">Выберите материал</div>
        )}
      </OrchSlotSide>
      <OrchSlotBotC>
        <SpecAskOrchestratorBlock chips={ASK_CHIPS.knowledge} placeholder="Спросить по базе знаний…" onSubmit={ask} />
      </OrchSlotBotC>
    </>
  )
}
