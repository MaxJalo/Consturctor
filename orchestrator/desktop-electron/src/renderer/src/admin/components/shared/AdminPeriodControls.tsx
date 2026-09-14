interface AdminPeriodControlsProps {
  periodLabel: string
  dateRange: string
  actionLabel?: string
  onAction?: () => void
}

export function AdminPeriodControls({
  periodLabel,
  dateRange,
  actionLabel,
  onAction
}: AdminPeriodControlsProps): React.JSX.Element {
  return (
    <div className="admin-period-controls">
      <button type="button" className="admin-filter-pill">
        {periodLabel}
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" className="admin-filter-pill admin-filter-pill--date">
        <svg viewBox="0 0 16 16" aria-hidden>
          <rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <path d="M5 2v2M11 2v2M2.5 6h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        {dateRange}
      </button>
      {actionLabel ? (
        <button type="button" className="admin-refresh-btn" onClick={onAction}>
          <svg viewBox="0 0 16 16" aria-hidden>
            <path
              d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 3.5V7h-3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}
