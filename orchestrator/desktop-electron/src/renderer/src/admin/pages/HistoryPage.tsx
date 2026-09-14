import { adminHistoryMock } from '../../mocks/adminMocks'
import { AdminDataTable } from '../components/shared/AdminDataTable'
import { AdminFilterBar } from '../components/shared/AdminFilterBar'
import { AdminPageHeader } from '../components/shared/AdminPageHeader'
import { AdminPageShell } from '../components/shared/AdminPageShell'
import { AdminPagination } from '../components/shared/AdminPagination'
import { AdminPeriodControls } from '../components/shared/AdminPeriodControls'
import { AdminSegmentTabs } from '../components/shared/AdminSegmentTabs'
import { AdminSlaIndicator } from '../components/shared/AdminSlaIndicator'
import { AdminStatusBadge } from '../components/shared/AdminStatusBadge'

export function HistoryPage(): React.JSX.Element {
  const mock = adminHistoryMock

  return (
    <AdminPageShell breadcrumb={mock.breadcrumb}>
      <AdminPageHeader
        title={mock.title}
        subtitle={mock.subtitle}
        controls={<AdminPeriodControls periodLabel={mock.periodLabel} dateRange={mock.dateRange} />}
      />
      <AdminSegmentTabs tabs={mock.tabs} activeId={mock.activeTab} />
      <div className="admin-panel">
        <AdminFilterBar filters={mock.filters} exportLabel="Экспорт" />
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
          rows={mock.rows.map((row) => [
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
        <AdminPagination from={mock.pagination.from} to={mock.pagination.to} total={mock.pagination.total} />
      </div>
    </AdminPageShell>
  )
}
