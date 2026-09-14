interface AdminFilterBarProps {
  filters: string[]
  searchPlaceholder?: string
  exportLabel?: string
  extra?: React.ReactNode
}

export function AdminFilterBar({
  filters,
  searchPlaceholder = 'Поиск...',
  exportLabel,
  extra
}: AdminFilterBarProps): React.JSX.Element {
  return (
    <div className="admin-filter-bar">
      <div className="admin-filter-bar__filters">
        {filters.map((label) => (
          <button key={label} type="button" className="admin-filter-pill admin-filter-pill--wide">
            {label}
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        ))}
        <label className="admin-search-input">
          <svg viewBox="0 0 16 16" aria-hidden>
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input type="search" placeholder={searchPlaceholder} />
        </label>
      </div>
      <div className="admin-filter-bar__actions">
        {extra}
        {exportLabel ? (
          <button type="button" className="admin-export-btn">
            <svg viewBox="0 0 16 16" aria-hidden>
              <path d="M8 2.5v7M5.5 7 8 9.5 10.5 7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
              <path d="M3 12.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            {exportLabel}
            <svg viewBox="0 0 16 16" aria-hidden className="admin-export-btn__chevron">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  )
}
