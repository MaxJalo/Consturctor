import type { AdminIntegrationMock } from '../../mocks/adminMocks'
import { DashboardPanel } from './DashboardPanel'

interface IntegrationStatusCardProps {
  title?: string
  items: AdminIntegrationMock[]
}

export function IntegrationStatusCard({
  title = 'Состояние интеграций',
  items
}: IntegrationStatusCardProps): React.JSX.Element {
  return (
    <DashboardPanel title={title} className="admin-dashboard-panel--integrations">
      <ul className="admin-integration-list">
        {items.map((item) => (
          <li key={item.id} className="admin-integration-list__item">
            <span className="admin-integration-list__check" aria-hidden>
              <svg viewBox="0 0 16 16">
                <path d="M3.5 8.2l2.8 2.8 6.2-6.4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              </svg>
            </span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </DashboardPanel>
  )
}
