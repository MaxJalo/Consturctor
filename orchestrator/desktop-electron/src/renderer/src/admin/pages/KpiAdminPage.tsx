import { adminKpiMock } from '../../mocks/adminMocks'
import { LineChartCard } from '../components/LineChartCard'
import { AdminPageHeader } from '../components/shared/AdminPageHeader'
import { AdminPageShell } from '../components/shared/AdminPageShell'
import { AdminPeriodControls } from '../components/shared/AdminPeriodControls'
import { AdminSegmentTabs } from '../components/shared/AdminSegmentTabs'

export function KpiAdminPage(): React.JSX.Element {
  const mock = adminKpiMock

  return (
    <AdminPageShell breadcrumb={mock.breadcrumb}>
      <AdminPageHeader
        title={mock.title}
        subtitle={mock.subtitle}
        controls={<AdminPeriodControls periodLabel={mock.periodLabel} dateRange={mock.dateRange} />}
      />
      <AdminSegmentTabs tabs={mock.tabs} activeId={mock.activeTab} />
      <section className="admin-kpi-summary">
        {mock.summaries.map((item) => (
          <article key={item.id} className={`admin-kpi-card admin-kpi-card--${item.tint || 'none'}`}>
            <div className="admin-kpi-card__label">{item.label}</div>
            {item.icon === 'target' ? (
              <div className="admin-kpi-card__target" aria-hidden>
                <span />
                <span />
                <span />
              </div>
            ) : (
              <div className="admin-kpi-card__row">
                <strong>{item.value}</strong>
                {item.trend ? <em className={item.trendTone === 'negative' ? 'down' : 'up'}>{item.trend}</em> : null}
              </div>
            )}
          </article>
        ))}
      </section>
      <div className="admin-kpi-charts">
        <LineChartCard data={mock.dynamics} />
        <section className="admin-panel admin-kpi-side">
          <h3 className="admin-dashboard-panel__title">Топ-5 агентов по эффективности</h3>
          <ul className="admin-progress-list">
            {mock.topAgents.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <div><i style={{ width: `${item.value}%` }} /></div>
                <strong>{item.value}%</strong>
              </li>
            ))}
          </ul>
          <h3 className="admin-dashboard-panel__title admin-kpi-gauges-title">Загрузка системы</h3>
          <div className="admin-gauge-grid">
            {mock.gauges.map((gauge) => (
              <div key={gauge.id} className={`admin-gauge admin-gauge--${gauge.tone}`}>
                <svg viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="30" className="admin-gauge__track" />
                  <circle cx="40" cy="40" r="30" className="admin-gauge__value" />
                </svg>
                <strong>{gauge.value}</strong>
                <span>{gauge.label}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </AdminPageShell>
  )
}
