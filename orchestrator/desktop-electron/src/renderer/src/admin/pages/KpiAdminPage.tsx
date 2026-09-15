import { useEffect, useMemo, useState } from 'react'
import { adminKpiMock } from '../../mocks/adminMocks'
import { fetchAdminKpi } from '../adminApi'
import { useAdminTabLoad } from '../hooks/useAdminTabLoad'
import { LineChartCard } from '../components/LineChartCard'
import { KpiAgentCardIcon } from '../components/KpiAgentCardIcon'
import { AdminPageHeader } from '../components/shared/AdminPageHeader'
import { AdminPageShell } from '../components/shared/AdminPageShell'
import { AdminPeriodControls } from '../components/shared/AdminPeriodControls'
import { AdminSegmentTabs } from '../components/shared/AdminSegmentTabs'
import { AdminStatusBadge } from '../components/shared/AdminStatusBadge'

export function KpiAdminPage(): React.JSX.Element {
  const { data, loading, error } = useAdminTabLoad(adminKpiMock, fetchAdminKpi)
  const [activeTab, setActiveTab] = useState(data.activeTab)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [hoverAgent, setHoverAgent] = useState<string | null>(null)
  const [hoverGauge, setHoverGauge] = useState<string | null>(null)

  useEffect(() => {
    if (activeTab === 'agents' && data.agentCards.length > 0) {
      setSelectedAgentId((current) => current ?? data.agentCards[0].id)
      return
    }
    if (activeTab !== 'agents') {
      setSelectedAgentId(null)
    }
  }, [activeTab, data.agentCards])

  const summaries = useMemo(() => {
    if (activeTab !== 'agents' || !selectedAgentId) return data.summaries
    return data.agentCards.find((agent) => agent.id === selectedAgentId)?.summaries ?? data.summaries
  }, [activeTab, data.agentCards, data.summaries, selectedAgentId])

  return (
    <AdminPageShell breadcrumb={data.breadcrumb}>
      <AdminPageHeader
        title={data.title}
        subtitle={data.subtitle}
        controls={<AdminPeriodControls />}
      />
      {loading ? <p className="admin-kb-sub">Загрузка…</p> : null}
      {error ? (
        <p className="admin-kb-sub" role="alert">
          {error}
        </p>
      ) : null}
      <AdminSegmentTabs tabs={data.tabs} activeId={activeTab} onChange={setActiveTab} />
      <section className="admin-kpi-summary">
        {summaries.map((item) => (
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
      {activeTab === 'agents' ? (
        <section className="admin-kpi-agent-cards admin-kpi-agent-cards--full">
          {data.agentCards.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={`admin-kpi-agent-card ${selectedAgentId === agent.id ? 'active' : ''}`}
              onClick={() => setSelectedAgentId(agent.id)}
            >
              <div className="admin-kpi-agent-card__head">
                <KpiAgentCardIcon agentId={agent.id} />
                <AdminStatusBadge label={agent.status} tone={agent.statusTone} />
              </div>
              <strong>{agent.name}</strong>
              <span>{agent.process}</span>
              <em>{agent.efficiency}% эффективность</em>
            </button>
          ))}
        </section>
      ) : (
        <div className="admin-kpi-charts">
          <LineChartCard data={data.dynamics} />
          <section className="admin-panel admin-kpi-side">
            <h3 className="admin-dashboard-panel__title">Топ-5 агентов по эффективности</h3>
            <ul className="admin-progress-list">
              {data.topAgents.map((item) => (
                <li
                  key={item.label}
                  className={hoverAgent === item.label ? 'active' : ''}
                  onMouseEnter={() => setHoverAgent(item.label)}
                  onMouseLeave={() => setHoverAgent(null)}
                >
                  <div><i style={{ width: `${item.value}%` }} /></div>
                  <span>{item.label}</span>
                  <strong>{item.value}%</strong>
                </li>
              ))}
            </ul>
            <h3 className="admin-dashboard-panel__title admin-kpi-gauges-title">Загрузка системы</h3>
            <div className="admin-gauge-grid">
              {data.gauges.map((gauge) => {
                const raw = String(gauge.value)
                const numeric = Number.parseFloat(raw.replace('%', '').replace(',', '.'))
                const percent = Number.isFinite(numeric)
                  ? Math.min(100, Math.max(0, raw.includes('%') ? numeric : numeric * 10))
                  : 0
                const dash = `${(percent / 100) * 188} 188`
                return (
                  <div
                    key={gauge.id}
                    className={`admin-gauge admin-gauge--${gauge.tone} ${hoverGauge === gauge.id ? 'active' : ''}`}
                    onMouseEnter={() => setHoverGauge(gauge.id)}
                    onMouseLeave={() => setHoverGauge(null)}
                  >
                    <div className="admin-gauge__ring">
                      <svg viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="30" className="admin-gauge__track" />
                        <circle cx="40" cy="40" r="30" className="admin-gauge__value" style={{ strokeDasharray: dash }} />
                      </svg>
                      <strong>{gauge.value}</strong>
                    </div>
                    <span>{gauge.label}</span>
                    {hoverGauge === gauge.id ? <em className="admin-gauge__tip">{gauge.label}: {gauge.value}</em> : null}
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      )}
    </AdminPageShell>
  )
}
