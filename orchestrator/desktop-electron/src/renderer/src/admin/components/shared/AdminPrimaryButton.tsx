interface AdminPrimaryButtonProps {
  label: string
  icon?: 'plus' | 'download'
  onClick?: () => void
}

export function AdminPrimaryButton({ label, icon, onClick }: AdminPrimaryButtonProps): React.JSX.Element {
  return (
    <button type="button" className="admin-primary-btn" onClick={onClick}>
      {icon === 'plus' ? (
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ) : null}
      {label}
    </button>
  )
}
