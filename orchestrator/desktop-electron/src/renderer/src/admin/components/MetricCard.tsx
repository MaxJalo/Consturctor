import type { AdminMetricMock, MetricIconVariant } from '../../mocks/adminMocks'
import { MetricIcon } from './MetricIcon'

interface MetricCardProps {
  metric: AdminMetricMock
}

const ICON_TONE: Record<MetricIconVariant, string> = {
  agents_total: 'blue',
  agents_used: 'green',
  active_runs: 'teal',
  users: 'purple',
  success_rate: 'mint',
  errors: 'red',
  queue: 'orange',
  system_load: 'blue'
}

export function MetricCard({ metric }: MetricCardProps): React.JSX.Element {
  const trendClass =
    metric.trendTone === 'positive'
      ? 'admin-metric-card__trend admin-metric-card__trend--positive'
      : metric.trendTone === 'negative'
        ? 'admin-metric-card__trend admin-metric-card__trend--negative'
        : 'admin-metric-card__trend'

  return (
    <article className="admin-metric-card">
      <div className={`admin-metric-card__icon admin-metric-card__icon--${ICON_TONE[metric.icon]}`}>
        <MetricIcon variant={metric.icon} />
      </div>
      <div className="admin-metric-card__body">
        <div className="admin-metric-card__label">{metric.label}</div>
        <div className="admin-metric-card__row">
          <div className="admin-metric-card__value">{metric.value}</div>
          {metric.trend ? <div className={trendClass}>{metric.trend}</div> : null}
        </div>
      </div>
    </article>
  )
}
