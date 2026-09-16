import { useEffect, useMemo, useState } from 'react'
import { StandardTabChrome, summaryTilesAsChrome } from './TabChromeGrid'
import { DEFAULT_KPI_LAYOUT } from './useTabChromeLayout'
import type { UserProfile } from '../../api/types'
import { KpiRangePicker, type KpiRangeShortcut } from '../../pages/KpiRangePicker'
import { SpecFilters, SpecPanel, SpecPill, SpecProgress } from '../../workplace/specV04Components'
import type { SpecSummaryTile } from '../../workplace/specV04Shell'
import { SpecIconSearch } from '../../workplace/specV04Icons'
import { currentWeekRange, rollingKpiRange } from '../../workplace/kpiPeriod'
import { setKpiExportSnapshot } from '../../workplace/kpiExportSnapshot'
import { useWorkplaceKpiDashboard } from '../../workplace/useWorkplaceKpiDashboard'
import { agentMatchesKpiTile, toggleSimpleTile } from '../../workplace/tileFilters'
import type { WorkplaceKpiCard, WorkplaceKpiChartSeries, WorkplaceKpiDashboard } from '../../workplace/workplaceKpiTypes'
import './kpiGrid.css'

const WEEK = currentWeekRange()

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
  user?: UserProfile
  onOpenProcesses?: () => void
  onOpenDecisions?: () => void
}): React.JSX.Element {
  const [from, setFrom] = useState(WEEK.from)
  const [to, setTo] = useState(WEEK.to)
  const [shortcut, setShortcut] = useState<KpiRangeShortcut | null>(null)
  const [agentQuery, setAgentQuery] = useState('')
  const [tileFilter, setTileFilter] = useState('all')
  const { data, loading, error, notice } = useWorkplaceKpiDashboard(from, to)

  const tiles = useMemo(() => {
    if (data?.cards.length) return cardsToTiles(data.cards)
    if (loading) return LOADING_TILES
    return []
  }, [data, loading])

  const agents = useMemo(() => {
    const rows = data?.agents ?? []
    const byTile =
      tileFilter === 'all' ? rows : rows.filter((row) => agentMatchesKpiTile(row, tileFilter))
    const q = agentQuery.trim().toLowerCase()
    if (!q) return byTile
    return byTile.filter((row) =>
      [row.name, row.code, row.process, row.status].some((value) => value.toLowerCase().includes(q))
    )
  }, [data, agentQuery, tileFilter])

  useEffect(() => {
    setKpiExportSnapshot({ from, to, data })
    return () => setKpiExportSnapshot({ from: '', to: '', data: null })
  }, [from, to, data])

  const applyRange = (next: { from: string; to: string }): void => {
    setFrom(next.from)
    setTo(next.to)
    setShortcut(null)
  }

  const applyShortcut = (days: KpiRangeShortcut): void => {
    const next = rollingKpiRange(days)
    setFrom(next.from)
    setTo(next.to)
    setShortcut(days)
  }

  return (
    <StandardTabChrome
      tabId="kpi"
      userId={_props.user?.id || ''}
      defaults={DEFAULT_KPI_LAYOUT}
      chromeTiles={summaryTilesAsChrome(tiles, tileFilter === 'all' ? null : tileFilter, (id) =>
        setTileFilter((current) => toggleSimpleTile(current, id))
      )}
      widgets={{
        filters: (
        <>
        <SpecFilters layout="row">
          <KpiRangePicker from={from} to={to} shortcut={shortcut} onApply={applyRange} onShortcut={applyShortcut} />
        </SpecFilters>
        {!tiles.length && loading ? (
          <p className="kpi-dash-status-banner">Загружаем показатели…</p>
        ) : null}
        {notice ? <p className="kpi-dash-status-banner">{notice}</p> : null}
        {error ? <p className="kpi-dash-status-banner error">{error}</p> : null}
        </>
        ),
        main: (
        <>
        <div className="spec-table-toolbar kpi-dash-table-toolbar">
          <h3 className="kpi-dash-table-title">KPI ИИ-агентов</h3>
          {data?.periodLabel ? <span className="spec-v04-muted">{data.periodLabel}</span> : null}
          <label className="spec-filter-input spec-filter-search kpi-dash-agent-search">
            <SpecIconSearch />
            <input
              className="wp-search"
              type="search"
              value={agentQuery}
              onChange={(event) => setAgentQuery(event.target.value)}
              placeholder="Поиск по агентам…"
            />
          </label>
        </div>
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
                {loading && !agents.length ? (
                  <tr>
                    <td colSpan={7} className="spec-v04-empty">
                      Загружаем…
                    </td>
                  </tr>
                ) : null}
                {!loading && !agents.length ? (
                  <tr>
                    <td colSpan={7} className="spec-v04-empty">
                      {agentQuery.trim()
                        ? 'Нет агентов по поиску'
                        : tileFilter !== 'all'
                          ? 'Нет агентов по выбранной плитке'
                          : 'Нет данных за период'}
                    </td>
                  </tr>
                ) : null}
                {agents.map((row) => (
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
        </>
        ),
        botA: (
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
        ),
        botB: (
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
        ),
        botC: (
        <SpecPanel title={data?.dynamics.title ?? 'Динамика показателей'}>
          {data?.dynamics ? <DynamicsChart dynamics={data.dynamics} /> : loading ? <p className="spec-v04-muted">Загружаем…</p> : null}
        </SpecPanel>
        )
      }}
    />
  )
}
