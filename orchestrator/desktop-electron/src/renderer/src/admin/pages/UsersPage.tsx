import { useCallback, useMemo } from 'react'
import { adminUsersMock, getAllUsersRows } from '../../mocks/adminMocks'
import { AdminDataTable } from '../components/shared/AdminDataTable'
import { AdminFilterBar } from '../components/shared/AdminFilterBar'
import { AdminPageHeader } from '../components/shared/AdminPageHeader'
import { AdminPageShell } from '../components/shared/AdminPageShell'
import { AdminPagination } from '../components/shared/AdminPagination'
import { AdminPrimaryButton } from '../components/shared/AdminPrimaryButton'
import { AdminStatusBadge } from '../components/shared/AdminStatusBadge'
import { useAdminFilteredTable } from '../hooks/useAdminFilteredTable'
import { downloadTableExport } from '../utils/exportTable'
import { matchesFilter, matchesSearch } from '../utils/tableFilters'

export function UsersPage(): React.JSX.Element {
  const mock = adminUsersMock
  const allRows = useMemo(() => getAllUsersRows(), [])

  const filterFn = useCallback(
    (row: (typeof allRows)[number], filters: Record<string, string>, search: string) => {
      if (!matchesFilter(row.department, filters.department || '')) return false
      if (!matchesFilter(row.role, filters.role || '')) return false
      if (!matchesFilter(row.status, filters.status || '')) return false
      return matchesSearch(
        [row.fio, row.position, row.department, row.role, row.status, String(row.agentsAccess), String(row.agentsUsed), row.lastActivity],
        search
      )
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
      filename: 'users',
      headers: ['ФИО', 'Должность', 'Подразделение', 'Роль', 'Статус', 'Агенты (доступ)', 'Агенты (использует)', 'Последняя активность'],
      rows: filtered.map((row) => [
        row.fio,
        row.position,
        row.department,
        row.role,
        row.status,
        String(row.agentsAccess),
        String(row.agentsUsed),
        row.lastActivity
      ])
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
            { id: 'fio', label: 'ФИО' },
            { id: 'department', label: 'Подразделение' },
            { id: 'role', label: 'Роль' },
            { id: 'status', label: 'Статус', width: '120px' },
            { id: 'access', label: 'Агенты (доступ)', align: 'center', width: '130px' },
            { id: 'used', label: 'Агенты (использует)', align: 'center', width: '150px' },
            { id: 'activity', label: 'Последняя активность', width: '160px' }
          ]}
          rows={paged.map((row) => [
            <div className="admin-table-person">
              <span className="admin-link">{row.fio}</span>
              <span className="admin-table-person__sub">{row.position}</span>
            </div>,
            row.department,
            row.role,
            <AdminStatusBadge label={row.status} tone={row.status === 'Приглашен' ? 'info' : 'success'} />,
            row.agentsAccess,
            row.agentsUsed,
            row.lastActivity
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
