import { Calendar } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { adminAiAgentsMock } from '../../mocks/adminMocks'
import { fetchAdminAiAgents } from '../adminApi'
import { useAdminTabLoad } from '../hooks/useAdminTabLoad'
import { AdminDataTable } from '../components/shared/AdminDataTable'
import { AdminFilterBar } from '../components/shared/AdminFilterBar'
import { AdminOutlineButton } from '../components/shared/AdminOutlineButton'
import { AdminPageHeader } from '../components/shared/AdminPageHeader'
import { AdminPageShell } from '../components/shared/AdminPageShell'
import { AdminPagination } from '../components/shared/AdminPagination'
import { AdminPrimaryButton } from '../components/shared/AdminPrimaryButton'
import { AdminSegmentTabs } from '../components/shared/AdminSegmentTabs'
import { AdminStatusBadge } from '../components/shared/AdminStatusBadge'
import { useAdminFilteredTable } from '../hooks/useAdminFilteredTable'
import { useAutoTablePageSize } from '../hooks/useAutoTablePageSize'
import { downloadTableExport } from '../utils/exportTable'
import { matchesFilter, matchesSearch } from '../utils/tableFilters'

export function AiAgentsPage(): React.JSX.Element {
  const { data, loading, error } = useAdminTabLoad(adminAiAgentsMock, fetchAdminAiAgents)
  const detail = data.detail
  const tableAreaRef = useRef<HTMLDivElement>(null)
  const pageSize = useAutoTablePageSize(tableAreaRef, { minRows: 3, rowHeight: 48 })
  const [detailTab, setDetailTab] = useState('0')
  const allRows = useMemo(() => data.rows, [data.rows])

  const filterFn = useCallback(
    (row: (typeof allRows)[number], filters: Record<string, string>, search: string) => {
      if (!matchesFilter(row.status, filters.status || '')) return false
      if (!matchesFilter(row.process, filters.process || '')) return false
      if (!matchesFilter(row.owner, filters.owner || '')) return false
      return matchesSearch(
        [row.name, row.process, row.owner, row.version, row.status, String(row.runs), row.successRate, row.used ? 'Да' : 'Нет'],
        search
      )
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
      filename: 'ai-agents',
      headers: ['Название', 'Процесс', 'Владелец', 'Версия', 'Статус', 'Запусков', 'Успешность', 'Используется'],
      rows: filtered.map((row) => [
        row.name,
        row.process,
        row.owner,
        row.version,
        row.status,
        String(row.runs),
        row.successRate,
        row.used ? 'Да' : 'Нет'
      ])
    })
  }

  const showProcesses = detailTab === '0' || detailTab === '1'
  const showMetrics = detailTab === '0' || detailTab === '2'
  const showInfo = detailTab === '0' || detailTab === '3' || detailTab === '4'

  return (
    <AdminPageShell breadcrumb={data.breadcrumb} className="admin-page--fill">
      <AdminPageHeader title={data.title} subtitle={data.subtitle} />
      {loading ? <p className="admin-kb-sub">Загрузка…</p> : null}
      {error ? (
        <p className="admin-kb-sub" role="alert">
          {error}
        </p>
      ) : null}
      <div className="admin-page-split">
        <div className="admin-panel admin-panel--table-zone">
          <AdminFilterBar
            filters={data.filters}
            onFiltersChange={handleFiltersChange}
            onExport={handleExport}
            extra={
              <>
                <AdminPrimaryButton label={data.createLabel} icon="plus" />
                <AdminOutlineButton label={data.importLabel} icon="import" />
              </>
            }
          />
          <div ref={tableAreaRef} className="admin-table-area">
            <AdminDataTable
              stretchRows
              columns={[
                { id: 'name', label: 'Название' },
                { id: 'process', label: 'Процесс' },
                { id: 'owner', label: 'Владелец' },
                { id: 'version', label: 'Версия', width: '90px' },
                { id: 'status', label: 'Статус', width: '130px' },
                { id: 'runs', label: 'Запусков', align: 'center', width: '90px' },
                { id: 'success', label: 'Успешность', align: 'center', width: '110px' },
                { id: 'used', label: 'Используется', align: 'center', width: '120px' }
              ]}
              rows={paged.map((row) => [
                <span className="admin-link">{row.name}</span>,
                row.process,
                row.owner,
                row.version,
                <AdminStatusBadge label={row.status} tone={row.statusTone} />,
                row.runs,
                row.successRate,
                <span className={row.used ? 'admin-lock admin-lock--yes' : 'admin-lock admin-lock--no'}>{row.used ? 'Да' : 'Нет'}</span>
              ])}
            />
          </div>
          <AdminPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
        </div>
        <section className="admin-panel admin-agent-detail admin-agent-detail--fill">
          <div className="admin-agent-detail__head">
            <div className="admin-agent-detail__icon">
              <Calendar size={22} strokeWidth={2} />
            </div>
            <div>
              <div className="admin-agent-detail__title-row">
                <h3>{detail.name}</h3>
                <AdminStatusBadge label={detail.status} tone={detail.statusTone} />
              </div>
              <p className="admin-agent-detail__desc">{detail.description}</p>
            </div>
            <AdminOutlineButton label="Действия" icon="chevron" />
          </div>
          <AdminSegmentTabs
            tabs={detail.tabs.map((label, index) => ({ id: String(index), label }))}
            activeId={detailTab}
            onChange={setDetailTab}
          />
          <div className="admin-agent-detail__grid">
            {showInfo ? (
              <div className="admin-detail-block">
                <h4>Общая информация</h4>
                <dl className="admin-kv-list admin-kv-list--dense">
                  {detail.info.map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.label === 'Статус' ? <AdminStatusBadge label={detail.status} tone={detail.statusTone} /> : item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
            {showMetrics ? (
              <div className="admin-detail-block">
                <h4>Показатели</h4>
                <dl className="admin-kv-list admin-kv-list--dense">
                  {detail.metrics.map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
            {showProcesses ? (
              <div className="admin-detail-block">
                <div className="admin-agent-detail__process-head">
                  <h4>Текущие процессы <span>3</span></h4>
                  <button type="button" className="admin-link-btn">Смотреть все</button>
                </div>
                <ul className="admin-process-list admin-process-list--compact">
                  {detail.processes.map((item) => (
                    <li key={item.title}>
                      <span className={`admin-process-list__icon admin-process-list__icon--${item.tone}`} />
                      <div>
                        <strong>{item.title}</strong>
                        <p>{item.time}</p>
                      </div>
                      <AdminStatusBadge label={item.status} tone={item.statusTone} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </AdminPageShell>
  )
}
