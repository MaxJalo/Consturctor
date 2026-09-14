interface AdminOutlineButtonProps {
  label: string
  icon?: 'import' | 'calendar' | 'chevron'
}

export function AdminOutlineButton({ label, icon }: AdminOutlineButtonProps): React.JSX.Element {
  return (
    <button type="button" className="admin-outline-btn">
      {icon === 'import' ? (
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M3 5.5h10v7H3z" stroke="currentColor" strokeWidth="1.3" fill="none" />
          <path d="M6 8h4M8 6v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ) : icon === 'calendar' ? (
        <svg viewBox="0 0 16 16" aria-hidden>
          <rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
          <path d="M5 2v2M11 2v2M2.5 6h11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ) : null}
      {label}
      {icon === 'chevron' ? (
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      ) : null}
    </button>
  )
}
