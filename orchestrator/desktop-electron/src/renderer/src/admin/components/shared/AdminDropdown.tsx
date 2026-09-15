import { useEffect, useRef, useState } from 'react'

export interface AdminDropdownOption {
  value: string
  label: string
}

interface AdminDropdownProps {
  value: string
  options: AdminDropdownOption[] | string[]
  onChange: (value: string) => void
  className?: string
  wide?: boolean
  withChevron?: boolean
  compact?: boolean
}

function normalizeOptions(options: AdminDropdownOption[] | string[]): AdminDropdownOption[] {
  return options.map((option) => (typeof option === 'string' ? { value: option, label: option } : option))
}

export function AdminDropdown({
  value,
  options,
  onChange,
  className = '',
  wide = false,
  withChevron = true,
  compact = false
}: AdminDropdownProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const normalized = normalizeOptions(options)
  const selected = normalized.find((option) => option.value === value) || normalized[0]

  useEffect(() => {
    function handleClick(event: MouseEvent): void {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={rootRef} className={`admin-dropdown ${open ? 'is-open' : ''} ${className}`.trim()}>
      <button
        type="button"
        className={`admin-filter-pill ${wide ? 'admin-filter-pill--wide' : ''} ${compact ? 'admin-filter-pill--compact' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={compact ? selected?.label : undefined}
      >
        {compact ? null : selected?.label}
        {withChevron ? (
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        ) : null}
      </button>
      {open ? (
        <div className="admin-dropdown__menu" role="listbox">
          {normalized.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? 'active' : ''}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
