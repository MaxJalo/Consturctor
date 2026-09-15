import { useMemo, useState } from 'react'
import {
  OrchSlotBotA,
  OrchSlotBotB,
  OrchSlotBotC,
  OrchSlotFilters,
  OrchSlotMain,
  OrchSlotMetrics
} from '../../layout/GridSlots'
import { KpiRangePicker } from '../../pages/KpiRangePicker'
import { SpecFilters, SpecPanel, SpecPill, SpecProgress, SpecSummaryTiles } from '../../workplace/specV04Components'
import type { SpecSummaryTile } from '../../workplace/specV04Shell'
import { StandardGridFilters } from './gridFilters'
import { useWorkplaceKpiDashboard } from '../../workplace/useWorkplaceKpiDashboard'
import type { WorkplaceKpiCard, WorkplaceKpiChartSeries, WorkplaceKpiDashboard } from '../../workplace/workplaceKpiTypes'
import './kpiGrid.css'

const DEFAULT_FROM = '2024-08-12'
const DEFAULT_TO = '2024-08-18'

const LOADING_TILES: SpecSummaryTile[] = [
  { id: 'tasks', label: 'Выполнение задач', value: '—', tone: 'orange' },
  { id: 'sla', label: 'SLA', value: '—', tone: 'blue' },
  { id: 'load', label: 'Загрузка', value: '—', tone: 'purple' },
  { id: 'ai', label: 'Эффективность ИИ', value: '—', tone: 'green' },
  { id: 'auto', label: 'Доля автоматизации', value: '—', tone: 'yellow' },
  { id: 'quality', label: 'Качество', value: '—', tone: 'lilac' }
]

function cardsToTiles(cards: WorkplaceKpiCard[]): SpecSummaryTile[] {
  return cards.map((card) => ({
    id: card.id,
    label: card.label,
    value: card.displayValue,
    hint: card.trend ?? undefined,
    tone: (card.tone as SpecSummaryTile['tone']) || 'blue',
    progress: card.progress ?? undefined,
    ring: card.ring !== false && card.progress != null
  }))
}

function chartPolyline(points: number[], width: number, height: number, max: number): string {
  if (!points.length) return ''
  const yMax = Math.max(1, max)
  const step = points.length > 1 ? width / (points.length - 1) : width
  return points
    .map((value, index) => {
      const x = index * step
      const y = height - (value / yMax) * (height - 12) - 6
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function DynamicsChart({ dynamics }: { dynamics: WorkplaceKpiDashboard['dynamics'] }): React.JSX.Element {
  const width = 640
  const height = 150
  const yMax = dynamics.yMax || 100
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="kpi-dynamics-chart" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <line key={ratio} x1={0} x2={width} y1={height * ratio} y2={height * ratio} />
        ))}
        {dynamics.series.map((series: WorkplaceKpiChartSeries) => (
          <polyline
            key={series.id}
            points={chartPolyline(series.points, width, height, yMax)}
            fill="none"
            stroke={series.color}
            strokeWidth={2.6}
          />
        ))}
      </svg>
      <div className="kpi-chart-axis">
        {dynamics.xLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="kpi-dynamics-legend">
        {dynamics.series.map((series) => (
          <span key={series.id}>
            <i style={{ background: series.color }} />
            {series.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function KpiGridTab(_props: {
  onOpenProcesses?: () => void
  onOpenDecisions?: () => void
}): React.JSX.Element {
  const [from, setFrom] = useState(DEFAULT_FROM)
  const [to, setTo] = useState(DEFAULT_TO)
  const { data, loading, error } = useWorkplaceKpiDashboard(from, to)

  const tiles = useMemo(() => {
    if (data?.cards.length) return cardsToTiles(data.cards)
    if (loading) return LOADING_TILES
    return []
  }, [data, loading])

  const applyRange = (next: { from: string; to: string }): void => {
    setFrom(next.from)
    setTo(next.to)
  }

  return (
    <>
      <OrchSlotMetrics>
        <div className="orch-kpi-tiles">
          <SpecSummaryTiles tiles={tiles} />
        </div>
        {!tiles.length && loading ? (
          <p className="kpi-dash-status-banner">Загружаем показатели…</p>
        ) : null}
        {error ? <p className="kpi-dash-status-banner error">{error}</p> : null}
      </OrchSlotMetrics>

      <OrchSlotFilters>
        <SpecFilters layout="row">
          <KpiRangePicker from={from} to={to} shortcut={null} onApply={applyRange} onShortcut={() => undefined} />
          <StandardGridFilters searchPlaceholder="Поиск по KPI…" />
        </SpecFilters>
      </OrchSlotFilters>

      <OrchSlotMain>
        <SpecPanel title="KPI ИИ-агентов" extra={data?.periodLabel ? <span className="spec-v04-muted">{data.periodLabel}</span> : null}>
          <div className="spec-v04-table-wrap wp-card kpi-dash-main-table">
            <table className="spec-v04-table">
              <thead>
                <tr>
                  <th>Агент</th>
                  <th>Процесс</th>
                  <th>Выполнение</th>
                  <th>SLA</th>
                  <th>Загрузка</th>
                  <th>Автоматизация</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data?.agents.length ? (
                  <tr>
                    <td colSpan={7} className="spec-v04-empty">
                      Загружаем…
                    </td>
                  </tr>
                ) : null}
                {!loading && !data?.agents.length ? (
                  <tr>
                    <td colSpan={7} className="spec-v04-empty">
                      Нет данных за период
                    </td>
                  </tr>
                ) : null}
                {(data?.agents ?? []).map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="kpi-dash-agent-name">
                        <strong>{row.name}</strong>
                        <span className="wp-code">{row.code}</span>
                      </div>
                    </td>
                    <td>{row.process}</td>
                    <td>
                      <SpecProgress value={row.completionPct} />
                    </td>
                    <td>{row.slaPct}%</td>
                    <td>{row.loadPct}%</td>
                    <td>{row.automationPct}%</td>
                    <td>
                      <SpecPill tone={row.statusTone}>{row.status}</SpecPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SpecPanel>
      </OrchSlotMain>

      <OrchSlotBotA>
        <SpecPanel title="Проблемные зоны">
          <div className="spec-v04-table-wrap">
            <table className="spec-v04-table spec-v04-table-compact">
              <thead>
                <tr>
                  <th>Зона</th>
                  <th>Показатель</th>
                  <th>Значение</th>
                  <th>Рекомендация</th>
                </tr>
              </thead>
              <tbody>
                {(data?.problemZones ?? []).map((zone) => (
                  <tr key={zone.id}>
                    <td>{zone.zone}</td>
                    <td>{zone.metric}</td>
                    <td>
                      <SpecPill tone={zone.severity}>{zone.value}</SpecPill>
                    </td>
                    <td>{zone.recommendation}</td>
                  </tr>
                ))}
                {!data?.problemZones.length && !loading ? (
                  <tr>
                    <td colSpan={4} className="spec-v04-empty">
                      Нет проблемных зон
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </SpecPanel>
      </OrchSlotBotA>

      <OrchSlotBotB>
        <SpecPanel title="Нагрузка: сотрудник vs ИИ">
          <div className="kpi-compare-legend">
            <span className="emp">Сотрудник (ч)</span>
            <span className="ai">ИИ (ч)</span>
          </div>
          <div className="kpi-compare-chart">
            {(data?.workloadCompare ?? []).map((row) => {
              const max = Math.max(row.employee, row.ai, 1)
              return (
                <div key={row.id} className="kpi-compare-row">
                  <span>{row.label}</span>
                  <div className="kpi-compare-track">
                    <i className="emp" style={{ width: `${(row.employee / max) * 100}%` }} title={`${row.employee} ч`} />
                    <i className="ai" style={{ width: `${(row.ai / max) * 100}%` }} title={`${row.ai} ч`} />
                  </div>
                </div>
              )
            })}
          </div>
        </SpecPanel>
      </OrchSlotBotB>

      <OrchSlotBotC>
        <SpecPanel title={data?.dynamics.title ?? 'Динамика показателей'}>
          {data?.dynamics ? <DynamicsChart dynamics={data.dynamics} /> : loading ? <p className="spec-v04-muted">Загружаем…</p> : null}
        </SpecPanel>
      </OrchSlotBotC>
    </>
  )
}
