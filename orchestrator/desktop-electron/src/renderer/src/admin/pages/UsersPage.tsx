import { useCallback, useMemo, useRef, useState } from 'react'
import { adminUsersMock, getAllUsersRows } from '../../mocks/adminMocks'
import { AdminDataTable } from '../components/shared/AdminDataTable'
import { AdminFilterBar } from '../components/shared/AdminFilterBar'
import { AdminModal } from '../components/shared/AdminModal'
import { AdminPageHeader } from '../components/shared/AdminPageHeader'
import { AdminPageShell } from '../components/shared/AdminPageShell'
import { AdminPagination } from '../components/shared/AdminPagination'
import { AdminPrimaryButton } from '../components/shared/AdminPrimaryButton'
import { AdminStatusBadge } from '../components/shared/AdminStatusBadge'
import { useAdminFilteredTable } from '../hooks/useAdminFilteredTable'
import { useAutoTablePageSize } from '../hooks/useAutoTablePageSize'
import { downloadTableExport } from '../utils/exportTable'
import { matchesFilter, matchesSearch } from '../utils/tableFilters'

const ROLE_OPTIONS = ['Администратор', 'Пользователь', 'Аудитор', 'Оператор']

export function UsersPage(): React.JSX.Element {
  const mock = adminUsersMock
  const tableAreaRef = useRef<HTMLDivElement>(null)
  const pageSize = useAutoTablePageSize(tableAreaRef, { minRows: mock.pagination.pageSize })
  const allRows = useMemo(() => getAllUsersRows(), [])
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ fio: '', password: '', position: '', role: ROLE_OPTIONS[1] })

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
    pageSize,
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

  function closeModal(): void {
    setAddOpen(false)
    setForm({ fio: '', password: '', position: '', role: ROLE_OPTIONS[1] })
  }

  function handleSubmit(): void {
    closeModal()
  }

  return (
    <AdminPageShell breadcrumb={mock.breadcrumb} className="admin-page--fill">
      <AdminPageHeader title={mock.title} subtitle={mock.subtitle} />
      <div className="admin-panel admin-panel--table-fill">
        <AdminFilterBar
          filters={mock.filters}
          onFiltersChange={handleFiltersChange}
          onExport={handleExport}
          extra={<AdminPrimaryButton label={mock.addLabel} icon="plus" onClick={() => setAddOpen(true)} />}
        />
        <div ref={tableAreaRef} className="admin-table-area">
          <AdminDataTable
            stretchRows
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
        </div>
        <AdminPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
      </div>
      <AdminModal
        title="Добавить пользователя"
        open={addOpen}
        onClose={closeModal}
        footer={
          <>
            <button type="button" className="admin-outline-btn" onClick={closeModal}>Отмена</button>
            <AdminPrimaryButton label="Сохранить" onClick={handleSubmit} />
          </>
        }
      >
        <div className="admin-form-grid">
          <label className="admin-form-field">
            <span>ФИО</span>
            <input type="text" value={form.fio} onChange={(e) => setForm((prev) => ({ ...prev, fio: e.target.value }))} />
          </label>
          <label className="admin-form-field">
            <span>Пароль</span>
            <input type="password" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} />
          </label>
          <label className="admin-form-field">
            <span>Должность</span>
            <input type="text" value={form.position} onChange={(e) => setForm((prev) => ({ ...prev, position: e.target.value }))} />
          </label>
          <label className="admin-form-field">
            <span>Роль</span>
            <select value={form.role} onChange={(e) => setForm((prev) => ({ ...prev, role: e.target.value }))}>
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </label>
        </div>
      </AdminModal>
    </AdminPageShell>
  )
}
