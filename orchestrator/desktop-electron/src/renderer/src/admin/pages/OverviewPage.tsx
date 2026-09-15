import { adminOverviewMock } from '../../mocks/adminMocks'
import { AdminBreadcrumb } from '../components/AdminBreadcrumb'
import { DashboardToolbar } from '../components/DashboardToolbar'
import { DonutChartCard } from '../components/DonutChartCard'
import { IntegrationStatusCard } from '../components/IntegrationStatusCard'
import { LineChartCard } from '../components/LineChartCard'
import { MetricGrid } from '../components/MetricGrid'

export function OverviewPage(): React.JSX.Element {
  const mock = adminOverviewMock

  return (
    <div className="admin-page admin-overview-page">
      <AdminBreadcrumb title={mock.breadcrumb} />
      <DashboardToolbar
        title={mock.dashboardTitle}
        subtitle={mock.dashboardSubtitle}
        refreshLabel={mock.refreshLabel}
      />
      <MetricGrid metrics={mock.metrics} />
      <div className="admin-charts-row">
        <LineChartCard data={mock.launchDynamics} />
        <DonutChartCard data={mock.agentStatuses} />
        <IntegrationStatusCard items={mock.integrations} />
      </div>
    </div>
  )
}
