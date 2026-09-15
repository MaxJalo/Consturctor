import { BarChart3, ExternalLink, FileText, Link2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
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
import { useAutoTablePageSize } from '../hooks/useAutoTablePageSize'
import { downloadTableExport } from '../utils/exportTable'
import { matchesFilter, matchesSearch } from '../utils/tableFilters'

export function KnowledgeBasePage(): React.JSX.Element {
  const mock = adminKnowledgeBaseMock
  const doc = mock.document
  const tableAreaRef = useRef<HTMLDivElement>(null)
  const pageSize = useAutoTablePageSize(tableAreaRef, { minRows: 3, rowHeight: 48 })
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
    pageSize,
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
    <AdminPageShell breadcrumb={mock.breadcrumb} className="admin-page--fill">
      <AdminPageHeader title={mock.title} subtitle={mock.subtitle} />
      <div className="admin-page-split">
        <div className="admin-panel admin-panel--table-zone">
          <AdminFilterBar
            filters={mock.filters}
            onFiltersChange={handleFiltersChange}
            onExport={handleExport}
            extra={<AdminPrimaryButton label={mock.addLabel} icon="plus" />}
          />
          <div ref={tableAreaRef} className="admin-table-area">
            <AdminDataTable
              stretchRows
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
          </div>
          <AdminPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
        </div>
        <div className="admin-kb-detail-grid admin-kb-detail-grid--fill">
          <section className="admin-panel admin-kb-panel">
            <div className="admin-kb-doc-head">
              <div className="admin-kb-doc-head__icon">
                <FileText size={20} strokeWidth={2} />
              </div>
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
              <AdminPrimaryButton label="Просмотреть" icon="eye" />
              <AdminOutlineButton label="Скачать" icon="download" />
              <AdminOutlineButton label="Редактировать" icon="pencil" />
              <button type="button" className="admin-icon-btn">⋯</button>
            </div>
            <dl className="admin-kv-list admin-kv-list--compact admin-kv-list--dense">
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
          <section className="admin-panel admin-kb-panel">
            <div className="admin-panel-title-row">
              <span className="admin-panel-title-row__icon admin-panel-title-row__icon--chart">
                <BarChart3 size={18} strokeWidth={2} />
              </span>
              <div>
                <h3 className="admin-dashboard-panel__title">Использование документа</h3>
                <p className="admin-kb-sub">Количество обращений к документу агентами</p>
              </div>
            </div>
            <div className="admin-kb-usage-head">
              <strong>{doc.usageTotal}</strong>
              <em className="up">{doc.usageTrend}</em>
            </div>
            <div className="admin-kb-bars admin-kb-bars--compact">
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
                  <div><i style={{ width: `${item.value}%` }} /></div>
                  <span>{item.label}</span>
                  <strong>{item.value}%</strong>
                </li>
              ))}
            </ul>
          </section>
          <section className="admin-panel admin-kb-panel">
            <div className="admin-panel-title-row">
              <span className="admin-panel-title-row__icon admin-panel-title-row__icon--link">
                <Link2 size={18} strokeWidth={2} />
              </span>
              <div>
                <h3 className="admin-dashboard-panel__title">Связанные документы</h3>
                <p className="admin-kb-sub">Документы, которые часто используются вместе</p>
              </div>
            </div>
            <ul className="admin-related-list admin-related-list--compact">
              {doc.related.map((item) => (
                <li key={item.title}>
                  <span className="admin-related-list__icon">
                    <FileText size={14} strokeWidth={2} />
                  </span>
                  <div><strong>{item.title}</strong><p>{item.type}</p></div>
                  <button type="button" className="admin-icon-btn" aria-label="Открыть">
                    <ExternalLink size={14} strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="admin-related-more">Показать все связанные документы ({doc.relatedCount}) ›</button>
          </section>
        </div>
      </div>
    </AdminPageShell>
  )
}
