interface AdminPageHeaderProps {
  title: string
  subtitle: string
  actions?: React.ReactNode
  controls?: React.ReactNode
}

export function AdminPageHeader({ title, subtitle, actions, controls }: AdminPageHeaderProps): React.JSX.Element {
  return (
    <section className="admin-page-header">
      <div className="admin-page-header__main">
        <div className="admin-page-header__text">
          <h1 className="admin-page-header__title">{title}</h1>
          <p className="admin-page-header__subtitle">{subtitle}</p>
        </div>
        {actions ? <div className="admin-page-header__actions">{actions}</div> : null}
      </div>
      {controls ? <div className="admin-page-header__controls">{controls}</div> : null}
    </section>
  )
}
