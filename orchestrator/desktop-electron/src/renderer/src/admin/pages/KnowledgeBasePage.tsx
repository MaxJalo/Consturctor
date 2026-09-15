import { useCallback, useMemo, useState } from 'react'
import { adminKnowledgeBaseMock, getAllKnowledgeRows } from '../../mocks/adminMocks'
import { AdminDataTable } from '../components/shared/AdminDataTable'
import { AdminFilterBar } from '../components/shared/AdminFilterBar'
import { AdminOutlineButton } from '../components/shared/AdminOutlineButton'
import { AdminPageHeader } from '../components/shared/AdminPageHeader'
import { AdminPageShell } from '../components/shared/AdminPageShell'
import { AdminPagination } from '../components/shared/AdminPagination'
import { AdminPrimaryButton } from '../components/shared/AdminPrimaryButton'
import { AdminStatusBadge } from '../components/shared/AdminStatusBadge'
import { useAdminFilteredTable } from '../hooks/useAdminFilteredTable'
import { downloadTableExport } from '../utils/exportTable'
import { matchesFilter, matchesSearch } from '../utils/tableFilters'

export function KnowledgeBasePage(): React.JSX.Element {
  const mock = adminKnowledgeBaseMock
  const doc = mock.document
  const [hoverBar, setHoverBar] = useState<number | null>(null)
  const [hoverShare, setHoverShare] = useState<string | null>(null)
  const allRows = useMemo(() => getAllKnowledgeRows(), [])

  const filterFn = useCallback(
    (row: (typeof allRows)[number], filters: Record<string, string>, search: string) => {
      if (!matchesFilter(row.type, filters.type || '')) return false
      if (!matchesFilter(row.agents, filters.agent || '')) return false
      if (!matchesFilter(row.status, filters.status || '')) return false
      return matchesSearch([row.name, row.type, row.agents, row.version, row.status, row.updatedAt], search)
    },
    []
  )

  const { filtered, paged, page, setPage, handleFiltersChange, total } = useAdminFilteredTable({
    rows: allRows,
    pageSize: mock.pagination.pageSize,
    filterFn
  })

  function handleExport(format: string): void {
    void downloadTableExport(format, {
      filename: 'knowledge-base',
      headers: ['Название', 'Тип', 'Агенты (используют)', 'Версия', 'Статус', 'Дата обновления'],
      rows: filtered.map((row) => [row.name, row.type, row.agents, row.version, row.status, row.updatedAt])
    })
  }

  return (
    <AdminPageShell breadcrumb={mock.breadcrumb}>
      <AdminPageHeader
        title={mock.title}
        subtitle={mock.subtitle}
        actions={<AdminPrimaryButton label={mock.addLabel} icon="plus" />}
      />
      <div className="admin-panel">
        <AdminFilterBar filters={mock.filters} onFiltersChange={handleFiltersChange} onExport={handleExport} />
        <AdminDataTable
          columns={[
            { id: 'name', label: 'Название' },
            { id: 'type', label: 'Тип', width: '120px' },
            { id: 'agents', label: 'Агенты (используют)' },
            { id: 'version', label: 'Версия', width: '90px' },
            { id: 'status', label: 'Статус', width: '160px' },
            { id: 'updated', label: 'Дата обновления', width: '140px' },
            { id: 'menu', label: '', width: '40px', align: 'center' }
          ]}
          rows={paged.map((row) => [
            <span className="admin-link">{row.name}</span>,
            row.type,
            row.agents,
            row.version,
            <AdminStatusBadge label={row.status} tone={row.statusTone} />,
            row.updatedAt,
            '⋯'
          ])}
        />
        <AdminPagination
          page={page}
          pageSize={mock.pagination.pageSize}
          total={total}
          onPageChange={setPage}
        />
      </div>
      <div className="admin-kb-detail-grid">
        <section className="admin-panel">
          <div className="admin-kb-doc-head">
            <div className="admin-kb-doc-head__icon" />
            <div>
              <div className="admin-agent-detail__title-row">
                <h3>{doc.title}</h3>
                <AdminStatusBadge label={doc.status} tone={doc.statusTone} />
              </div>
              <p>{doc.meta}</p>
            </div>
          </div>
          <p className="admin-kb-doc-text">{doc.text}</p>
          <div className="admin-kb-doc-actions">
            <AdminPrimaryButton label="Просмотреть" />
            <AdminOutlineButton label="Скачать" />
            <AdminOutlineButton label="Редактировать" />
            <button type="button" className="admin-icon-btn">⋯</button>
          </div>
          <dl className="admin-kv-list admin-kv-list--compact">
            <div><dt>Формат</dt><dd>{doc.format}</dd></div>
            <div><dt>Автор</dt><dd>{doc.author}</dd></div>
            <div><dt>Категория</dt><dd>{doc.category}</dd></div>
            <div>
              <dt>Теги</dt>
              <dd className="admin-tag-list">
                {doc.tags.map((tag) => <span key={tag}>{tag}</span>)}
                <button type="button" className="admin-link-btn">+ Добавить тег</button>
              </dd>
            </div>
          </dl>
        </section>
        <section className="admin-panel">
          <h3 className="admin-dashboard-panel__title">Использование документа</h3>
          <p className="admin-kb-sub">Количество обращений к документу агентами</p>
          <div className="admin-kb-usage-head">
            <strong>{doc.usageTotal}</strong>
            <em className="up">{doc.usageTrend}</em>
          </div>
          <div className="admin-kb-bars">
            {doc.usageBars.map((value, index) => (
              <div
                key={index}
                className={`admin-kb-bars__item ${hoverBar === index ? 'active' : ''}`}
                onMouseEnter={() => setHoverBar(index)}
                onMouseLeave={() => setHoverBar(null)}
              >
                <i style={{ height: `${value}px` }} />
                {hoverBar === index ? <span className="admin-kb-bars__tip">{value} обращений</span> : null}
              </div>
            ))}
          </div>
          <ul className="admin-progress-list admin-progress-list--compact">
            {doc.agentsShare.map((item) => (
              <li
                key={item.label}
                className={hoverShare === item.label ? 'active' : ''}
                onMouseEnter={() => setHoverShare(item.label)}
                onMouseLeave={() => setHoverShare(null)}
              >
                <span>{item.label}</span>
                <div><i style={{ width: `${item.value}%` }} /></div>
                <strong>{item.value}%</strong>
              </li>
            ))}
          </ul>
        </section>
        <section className="admin-panel">
          <h3 className="admin-dashboard-panel__title">Связанные документы</h3>
          <p className="admin-kb-sub">Документы, которые часто используются вместе</p>
          <ul className="admin-related-list">
            {doc.related.map((item) => (
              <li key={item.title}>
                <span className="admin-related-list__icon" />
                <div><strong>{item.title}</strong><p>{item.type}</p></div>
                <button type="button" className="admin-icon-btn">↗</button>
              </li>
            ))}
          </ul>
          <button type="button" className="admin-related-more">Показать все связанные документы ({doc.relatedCount}) ›</button>
        </section>
      </div>
    </AdminPageShell>
  )
}
