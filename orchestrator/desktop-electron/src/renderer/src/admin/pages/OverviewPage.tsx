import { emptyAdminOverview, type AdminOverviewMock } from '../adminEmpty'
import { fetchAdminOverview } from '../adminApi'
import { AdminBreadcrumb } from '../components/AdminBreadcrumb'
import { DashboardToolbar } from '../components/DashboardToolbar'
import { DonutChartCard } from '../components/DonutChartCard'
import { IntegrationStatusCard } from '../components/IntegrationStatusCard'
import { LineChartCard } from '../components/LineChartCard'
import { MetricGrid } from '../components/MetricGrid'
import { useAdminTabLoad } from '../hooks/useAdminTabLoad'

export function OverviewPage(): React.JSX.Element {
  const { data, loading, error, reload } = useAdminTabLoad<AdminOverviewMock>(
    emptyAdminOverview,
    fetchAdminOverview
  )

  return (
    <div className="admin-page admin-overview-page">
      <AdminBreadcrumb title={data.breadcrumb} />
      <DashboardToolbar
        title={data.dashboardTitle}
        subtitle={data.dashboardSubtitle}
        refreshLabel={data.refreshLabel}
        onRefresh={() => void reload()}
      />
      {loading ? <p className="admin-kb-sub">Загрузка показателей…</p> : null}
      {error ? (
        <p className="admin-kb-sub" role="alert">
          {error}
        </p>
      ) : null}
      <MetricGrid metrics={data.metrics} />
      <div className="admin-charts-row">
        <LineChartCard data={data.launchDynamics} />
        <DonutChartCard data={data.agentStatuses} />
        <IntegrationStatusCard items={data.integrations} />
      </div>
    </div>
  )
}
