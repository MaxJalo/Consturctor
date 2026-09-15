interface InDevelopmentPageProps {
  title: string
}

export function InDevelopmentPage({ title }: InDevelopmentPageProps): React.JSX.Element {
  return (
    <div className="in-dev-page">
      <h1 className="page-title">{title}</h1>
      <p className="page-subtitle">Раздел в разработке</p>
      <div className="placeholder-card">Скоро здесь появится функциональность.</div>
    </div>
  )
}
