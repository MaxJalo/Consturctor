import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import type { UserProfile } from '../../api/types'
import {
  OrchSlotFilters,
  OrchSlotMain,
  OrchSlotMetrics,
  OrchSlotSide
} from '../../layout/GridSlots'
import type { SpecSummaryTile } from '../../workplace/specV04Shell'
import { SpecPill, SpecSummaryTiles } from '../../workplace/specV04Components'
import { type SpecKnowledgeRow } from '../../workplace/specV04DemoData'
import { openHttpUrl } from '../../workplace/workplaceNav'
import { StandardGridFilters } from './gridFilters'

export function KnowledgeGridTab({
  user
}: {
  user: UserProfile
}): React.JSX.Element {
  const [catalog, setCatalog] = useState<SpecKnowledgeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const [openHint, setOpenHint] = useState('')
  const [opening, setOpening] = useState(false)

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
              updated: w.updatedAt || '—',
              author: 'Constructor',
              workflowId: w.id
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

  const openSelectedKnowledge = (): void => {
    if (!selected) return
    setSelectedId(selected.id)
    if (selected.url && openHttpUrl(selected.url)) {
      setOpenHint('')
      return
    }
    const workflowId = selected.workflowId || selected.id
    if (!workflowId) {
      setOpenHint('Нет ссылки на регламент — карточка открыта справа.')
      return
    }
    setOpening(true)
    void api
      .listPlatformFiles()
      .then((files) => {
        const match = files.find((file) => file.workflowId === workflowId && file.downloadUrl)
        if (match?.downloadUrl) {
          setOpenHint('')
          return api.download(match.downloadUrl, match.name || selected.name)
        }
        setOpenHint('Нет внешней ссылки на регламент — карточка открыта справа.')
        return false
      })
      .catch(() => {
        setOpenHint('Не удалось открыть файл регламента — карточка открыта справа.')
      })
      .finally(() => setOpening(false))
  }

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
            {openHint ? <p className="spec-v04-muted">{openHint}</p> : null}
            <button
              type="button"
              className="spec-btn-launch spec-btn-launch-block"
              disabled={opening}
              onClick={openSelectedKnowledge}
            >
              {opening ? 'Открываем…' : 'Открыть знание'}
            </button>
          </div>
        ) : (
          <div className="wp-card spec-v04-muted">Выберите материал</div>
        )}
      </OrchSlotSide>
    </>
  )
}
