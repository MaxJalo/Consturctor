import { useState } from 'react'
import { ADMIN_PERIOD_OPTIONS } from '../../../mocks/adminMocks'
import { formatAdminDateRange, getPeriodRange, type AdminDateRange } from '../../utils/dateRange'
import { AdminDateRangePicker } from './AdminDateRangePicker'
import { AdminDropdown } from './AdminDropdown'
import { AdminRefreshIcon } from './AdminRefreshIcon'

interface AdminPeriodControlsProps {
  periodLabel?: string
  dateRange?: string
  actionLabel?: string
  onAction?: () => void
}

export function AdminPeriodControls({
  actionLabel,
  onAction
}: AdminPeriodControlsProps): React.JSX.Element {
  const [periodId, setPeriodId] = useState('week')
  const [range, setRange] = useState<AdminDateRange>(() => getPeriodRange('week'))

  function handlePeriodChange(nextPeriodId: string): void {
    setPeriodId(nextPeriodId)
    setRange(getPeriodRange(nextPeriodId))
  }

  return (
    <div className="admin-period-controls">
      <AdminDropdown
        value={periodId}
        options={ADMIN_PERIOD_OPTIONS.map((item) => ({ value: item.id, label: item.label }))}
        onChange={handlePeriodChange}
      />
      <AdminDateRangePicker value={range} onChange={setRange} />
      {actionLabel ? (
        <button type="button" className="admin-refresh-btn" onClick={onAction} title={formatAdminDateRange(range)}>
          <AdminRefreshIcon />
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
