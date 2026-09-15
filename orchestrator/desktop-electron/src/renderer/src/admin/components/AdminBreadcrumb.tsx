interface AdminBreadcrumbProps {
  title: string
}

export function AdminBreadcrumb({ title }: AdminBreadcrumbProps): React.JSX.Element {
  return <div className="admin-breadcrumb">{title}</div>
}
