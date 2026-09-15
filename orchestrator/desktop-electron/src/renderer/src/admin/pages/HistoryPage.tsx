import { useCallback, useMemo, useState } from 'react'
import { emptyAdminHistory } from '../adminEmpty'
import { fetchAdminHistory } from '../adminApi'
import { useAdminTabLoad } from '../hooks/useAdminTabLoad'
import { AdminDataTable } from '../components/shared/AdminDataTable'
import { AdminFilterBar } from '../components/shared/AdminFilterBar'
import { AdminPageHeader } from '../components/shared/AdminPageHeader'
import { AdminPageShell } from '../components/shared/AdminPageShell'
import { AdminPagination } from '../components/shared/AdminPagination'
import { AdminPeriodControls } from '../components/shared/AdminPeriodControls'
import { AdminSegmentTabs } from '../components/shared/AdminSegmentTabs'
import { AdminSlaIndicator } from '../components/shared/AdminSlaIndicator'
import { AdminStatusBadge } from '../components/shared/AdminStatusBadge'
import { useAdminFilteredTable } from '../hooks/useAdminFilteredTable'
import { downloadTableExport } from '../utils/exportTable'
import { matchesFilter, matchesSearch } from '../utils/tableFilters'

export function HistoryPage(): React.JSX.Element {
  const { data, loading, error } = useAdminTabLoad(emptyAdminHistory, fetchAdminHistory)
  const [activeTab, setActiveTab] = useState(data.activeTab)
  const allRows = useMemo(() => data.rows, [data.rows])

  const filterFn = useCallback(
    (row: (typeof allRows)[number], filters: Record<string, string>, search: string) => {
      if ((row.tab || 'processes') !== activeTab) return false
      if (!matchesFilter(row.status, filters.status || '')) return false
      if (!matchesFilter(row.agent, filters.agent || '')) return false
      if (!matchesFilter(row.process, filters.process || '')) return false
      if (!matchesFilter(row.user, filters.user || '')) return false
      return matchesSearch([row.id, row.process, row.agent, row.user, row.status, row.launchedAt, row.duration], search)
    },
    [activeTab]
  )

  const { filtered, paged, page, setPage, handleFiltersChange, total } = useAdminFilteredTable({
    rows: allRows,
    pageSize: data.pagination.pageSize,
    filterFn,
    resetKey: activeTab
  })

  function handleTabChange(tabId: string): void {
    setActiveTab(tabId)
  }

  function handleExport(format: string): void {
    void downloadTableExport(format, {
      filename: `history-${activeTab}`,
      headers: ['ID', 'Процесс', 'ИИ-агент', 'Пользователь', 'Статус', 'Запуск', 'Длительность'],
      rows: filtered.map((row) => [
        row.id,
        row.process,
        row.agent,
        row.user,
        row.status,
        row.launchedAt,
        row.duration
      ])
    })
  }

  return (
    <AdminPageShell breadcrumb={data.breadcrumb}>
      <AdminPageHeader
        title={data.title}
        subtitle={data.subtitle}
        controls={<AdminPeriodControls />}
      />
      {loading ? <p className="admin-kb-sub">Загрузка…</p> : null}
      {error ? (
        <p className="admin-kb-sub" role="alert">
          {error}
        </p>
      ) : null}
      <AdminSegmentTabs tabs={data.tabs} activeId={activeTab} onChange={handleTabChange} />
      <div className="admin-panel admin-panel--overflow-visible">
        <AdminFilterBar
          key={activeTab}
          filters={data.filters}
          exportLabel="Экспорт"
          onFiltersChange={handleFiltersChange}
          onExport={handleExport}
        />
        <AdminDataTable
          columns={[
            { id: 'id', label: 'ID', width: '72px' },
            { id: 'process', label: 'Процесс' },
            { id: 'agent', label: 'ИИ-агент' },
            { id: 'user', label: 'Пользователь' },
            { id: 'status', label: 'Статус', width: '130px' },
            { id: 'launch', label: 'Запуск', width: '150px' },
            { id: 'duration', label: 'Длительность', width: '110px' },
            { id: 'sla', label: 'SLA', width: '64px', align: 'center' }
          ]}
          rows={paged.map((row) => [
            row.id,
            <span className="admin-link">{row.process}</span>,
            <span className="admin-link">{row.agent}</span>,
            row.user,
            <AdminStatusBadge label={row.status} tone={row.statusTone} />,
            row.launchedAt,
            row.duration,
            <AdminSlaIndicator tone={row.sla} />
          ])}
        />
        <AdminPagination
          page={page}
          pageSize={data.pagination.pageSize}
          total={total}
          onPageChange={setPage}
        />
      </div>
    </AdminPageShell>
  )
}
