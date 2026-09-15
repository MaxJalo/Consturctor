import { useState } from 'react'
import { ADMIN_PERIOD_OPTIONS } from '../../mocks/adminMocks'
import { formatAdminDateRange, getPeriodRange, type AdminDateRange } from '../utils/dateRange'
import { AdminDateRangePicker } from './shared/AdminDateRangePicker'
import { AdminDropdown } from './shared/AdminDropdown'
import { AdminRefreshIcon } from './shared/AdminRefreshIcon'

interface DashboardToolbarProps {
  title: string
  subtitle: string
  refreshLabel: string
  onRefresh?: () => void
}

export function DashboardToolbar({
  title,
  subtitle,
  refreshLabel,
  onRefresh
}: DashboardToolbarProps): React.JSX.Element {
  const [periodId, setPeriodId] = useState('week')
  const [range, setRange] = useState<AdminDateRange>(() => getPeriodRange('week'))

  function handlePeriodChange(nextPeriodId: string): void {
    setPeriodId(nextPeriodId)
    setRange(getPeriodRange(nextPeriodId))
  }

  return (
    <section className="admin-dashboard-toolbar">
      <div className="admin-dashboard-toolbar__titles">
        <h2 className="admin-dashboard-toolbar__title">{title}</h2>
        <p className="admin-dashboard-toolbar__subtitle">{subtitle}</p>
      </div>
      <div className="admin-dashboard-toolbar__actions">
        <AdminDropdown
          value={periodId}
          options={ADMIN_PERIOD_OPTIONS.map((item) => ({ value: item.id, label: item.label }))}
          onChange={handlePeriodChange}
        />
        <AdminDateRangePicker value={range} onChange={setRange} />
        <button type="button" className="admin-refresh-btn" onClick={onRefresh} title={formatAdminDateRange(range)}>
          <AdminRefreshIcon />
          {refreshLabel}
        </button>
      </div>
    </section>
  )
}
