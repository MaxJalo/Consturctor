interface AdminPageShellProps {
  breadcrumb: string
  children: React.ReactNode
  className?: string
}

export function AdminPageShell({ breadcrumb, children, className = '' }: AdminPageShellProps): React.JSX.Element {
  return (
    <div className={`admin-page ${className}`.trim()}>
      <div className="admin-breadcrumb">{breadcrumb}</div>
      {children}
    </div>
  )
}
