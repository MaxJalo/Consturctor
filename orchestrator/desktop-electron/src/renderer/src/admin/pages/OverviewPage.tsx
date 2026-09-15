import { useCallback, useEffect, useState } from 'react'
import { adminOverviewMock, type AdminOverviewMock } from '../../mocks/adminMocks'
import { fetchAdminOverview } from '../adminApi'
import { AdminBreadcrumb } from '../components/AdminBreadcrumb'
import { DashboardToolbar } from '../components/DashboardToolbar'
import { DonutChartCard } from '../components/DonutChartCard'
import { IntegrationStatusCard } from '../components/IntegrationStatusCard'
import { LineChartCard } from '../components/LineChartCard'
import { MetricGrid } from '../components/MetricGrid'

export function OverviewPage(): React.JSX.Element {
  const [data, setData] = useState<AdminOverviewMock>(adminOverviewMock)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const overview = await fetchAdminOverview()
      setData(overview)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить обзор')
      setData(adminOverviewMock)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="admin-page admin-overview-page">
      <AdminBreadcrumb title={data.breadcrumb} />
      <DashboardToolbar
        title={data.dashboardTitle}
        subtitle={data.dashboardSubtitle}
        refreshLabel={data.refreshLabel}
        onRefresh={() => void load()}
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
