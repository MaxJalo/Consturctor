interface DashboardPanelProps {
  title: string
  children: React.ReactNode
  className?: string
}

export function DashboardPanel({ title, children, className = '' }: DashboardPanelProps): React.JSX.Element {
  return (
    <section className={`admin-dashboard-panel ${className}`.trim()}>
      <h3 className="admin-dashboard-panel__title">{title}</h3>
      <div className="admin-dashboard-panel__body">{children}</div>
    </section>
  )
}
