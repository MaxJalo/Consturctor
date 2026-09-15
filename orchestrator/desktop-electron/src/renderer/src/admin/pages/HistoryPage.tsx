import { useCallback, useMemo, useState } from 'react'
import { adminHistoryMock, getAllHistoryRows } from '../../mocks/adminMocks'
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
  const mock = adminHistoryMock
  const [activeTab, setActiveTab] = useState(mock.activeTab)
  const allRows = useMemo(() => getAllHistoryRows(activeTab), [activeTab])

  const filterFn = useCallback(
    (row: (typeof allRows)[number], filters: Record<string, string>, search: string) => {
      if (!matchesFilter(row.status, filters.status || '')) return false
      if (!matchesFilter(row.agent, filters.agent || '')) return false
      if (!matchesFilter(row.process, filters.process || '')) return false
      if (!matchesFilter(row.user, filters.user || '')) return false
      return matchesSearch([row.id, row.process, row.agent, row.user, row.status, row.launchedAt, row.duration], search)
    },
    []
  )

  const { filtered, paged, page, setPage, handleFiltersChange, total } = useAdminFilteredTable({
    rows: allRows,
    pageSize: mock.pagination.pageSize,
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
    <AdminPageShell breadcrumb={mock.breadcrumb}>
      <AdminPageHeader
        title={mock.title}
        subtitle={mock.subtitle}
        controls={<AdminPeriodControls />}
      />
      <AdminSegmentTabs tabs={mock.tabs} activeId={activeTab} onChange={handleTabChange} />
      <div className="admin-panel admin-panel--overflow-visible">
        <AdminFilterBar
          key={activeTab}
          filters={mock.filters}
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
          pageSize={mock.pagination.pageSize}
          total={total}
          onPageChange={setPage}
        />
      </div>
    </AdminPageShell>
  )
}
