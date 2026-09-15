import { useEffect, useRef, useState } from 'react'
import type { AdminFilterMock } from '../../../mocks/adminMocks'
import { AdminDropdown } from './AdminDropdown'

interface AdminFilterBarProps {
  filters: AdminFilterMock[]
  searchPlaceholder?: string
  exportLabel?: string
  exportOptions?: string[]
  extra?: React.ReactNode
  onFiltersChange?: (values: Record<string, string>, search: string) => void
  onExport?: (format: string) => void
}

export function AdminFilterBar({
  filters,
  searchPlaceholder = 'Поиск...',
  exportLabel,
  exportOptions = ['Excel (.xlsx)', 'CSV (.csv)', 'PDF (.pdf)'],
  extra,
  onFiltersChange,
  onExport
}: AdminFilterBarProps): React.JSX.Element {
  const exportRef = useRef<HTMLDivElement>(null)
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(filters.map((filter) => [filter.id, filter.defaultValue || filter.options[0]]))
  )
  const [search, setSearch] = useState('')
  const [exportFormat, setExportFormat] = useState(exportOptions[0])
  const [exportOpen, setExportOpen] = useState(false)

  useEffect(() => {
    function handleClick(event: MouseEvent): void {
      if (!exportRef.current?.contains(event.target as Node)) setExportOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function updateFilters(next: Record<string, string>): void {
    setValues(next)
    onFiltersChange?.(next, search)
  }

  function updateSearch(nextSearch: string): void {
    setSearch(nextSearch)
    onFiltersChange?.(values, nextSearch)
  }

  function triggerExport(format: string): void {
    onExport?.(format)
    setExportOpen(false)
  }

  return (
    <div className="admin-filter-bar">
      <div className="admin-filter-bar__filters">
        {filters.map((filter) => (
          <AdminDropdown
            key={filter.id}
            wide
            value={values[filter.id]}
            options={filter.options}
            onChange={(value) => updateFilters({ ...values, [filter.id]: value })}
          />
        ))}
        <label className="admin-search-input">
          <svg viewBox="0 0 16 16" aria-hidden>
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(event) => updateSearch(event.target.value)}
          />
        </label>
        {extra ? <div className="admin-filter-bar__extra">{extra}</div> : null}
      </div>
      <div className="admin-filter-bar__actions">
        {exportLabel ? (
          <div ref={exportRef} className={`admin-export-split ${exportOpen ? 'is-open' : ''}`}>
            <button type="button" className="admin-export-btn admin-export-btn--main" onClick={() => triggerExport(exportFormat)}>
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M8 2.5v7M5.5 7 8 9.5 10.5 7" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
                <path d="M3 12.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              {exportLabel}
            </button>
            <button
              type="button"
              className="admin-export-btn admin-export-btn--toggle"
              aria-label="Формат экспорта"
              onClick={() => setExportOpen((prev) => !prev)}
            >
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            </button>
            {exportOpen ? (
              <div className="admin-export-menu" role="listbox">
                {exportOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={option === exportFormat ? 'active' : ''}
                    onClick={() => {
                      setExportFormat(option)
                      triggerExport(option)
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
