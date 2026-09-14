import { adminUsersMock } from '../../mocks/adminMocks'
import { AdminDataTable } from '../components/shared/AdminDataTable'
import { AdminFilterBar } from '../components/shared/AdminFilterBar'
import { AdminPageHeader } from '../components/shared/AdminPageHeader'
import { AdminPageShell } from '../components/shared/AdminPageShell'
import { AdminPagination } from '../components/shared/AdminPagination'
import { AdminPrimaryButton } from '../components/shared/AdminPrimaryButton'
import { AdminStatusBadge } from '../components/shared/AdminStatusBadge'

export function UsersPage(): React.JSX.Element {
  const mock = adminUsersMock

  return (
    <AdminPageShell breadcrumb={mock.breadcrumb}>
      <AdminPageHeader
        title={mock.title}
        subtitle={mock.subtitle}
        actions={<AdminPrimaryButton label={mock.addLabel} icon="plus" />}
      />
      <div className="admin-panel">
        <AdminFilterBar filters={mock.filters} />
        <AdminDataTable
          columns={[
            { id: 'fio', label: 'ФИО' },
            { id: 'position', label: 'Должность' },
            { id: 'department', label: 'Подразделение' },
            { id: 'role', label: 'Роль' },
            { id: 'status', label: 'Статус', width: '120px' },
            { id: 'access', label: 'Агенты (доступ)', align: 'center', width: '130px' },
            { id: 'used', label: 'Агенты (использует)', align: 'center', width: '150px' },
            { id: 'activity', label: 'Последняя активность', width: '160px' }
          ]}
          rows={mock.rows.map((row) => [
            <span className="admin-link">{row.fio}</span>,
            row.position,
            row.department,
            row.role,
            <AdminStatusBadge label={row.status} tone="success" />,
            row.agentsAccess,
            row.agentsUsed,
            row.lastActivity
          ])}
        />
        <AdminPagination from={mock.pagination.from} to={mock.pagination.to} total={mock.pagination.total} pages={[1, 2, 3, 'ellipsis', 29]} />
      </div>
    </AdminPageShell>
  )
}
