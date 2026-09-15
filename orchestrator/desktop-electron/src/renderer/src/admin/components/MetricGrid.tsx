import type { AdminMetricMock } from '../../mocks/adminMocks'
import { MetricCard } from './MetricCard'

interface MetricGridProps {
  metrics: AdminMetricMock[]
}

export function MetricGrid({ metrics }: MetricGridProps): React.JSX.Element {
  return (
    <section className="admin-metric-grid">
      {metrics.map((metric) => (
        <MetricCard key={metric.id} metric={metric} />
      ))}
    </section>
  )
}
