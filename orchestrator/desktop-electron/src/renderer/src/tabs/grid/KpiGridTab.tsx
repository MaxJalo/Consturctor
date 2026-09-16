import {
  OrchSlotBotA,
  OrchSlotBotB,
  OrchSlotBotC,
  OrchSlotFilters,
  OrchSlotMain,
  OrchSlotMetrics
} from '../../layout/GridSlots'
import { SpecFilters, SpecPanel, SpecPill, SpecProgress, SpecSummaryTiles } from '../../workplace/specV04Components'
import { SpecIconCalendar, SpecIconSearch } from '../../workplace/specV04Icons'
import {
  KPI_AGENT_ROWS,
  KPI_DYNAMICS_SERIES,
  KPI_LOAD_COMPARE,
  KPI_PROBLEM_ZONES,
  KPI_SUMMARY_TILES,
  kpiMetricTone,
  kpiStatusLabel,
  kpiStatusTone
} from './kpiDemoData'
import './kpiGrid.css'

function KpiMetricCell({ value }: { value: number }): React.JSX.Element {
  return (
    <div className="kpi-grid-metric-cell">
      <SpecProgress value={value} />
    </div>
  )
}

function chartPoints(values: number[], width: number, height: number): string {
  if (!values.length) return ''
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(max - min, 1)
  return values
    .map((value, index) => {
      const x = values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width
      const y = height - ((value - min) / span) * (height - 12) - 6
      return `${x},${y}`
    })
    .join(' ')
}

export function KpiGridTab(_props: {
  onOpenProcesses: () => void
  onOpenDecisions: () => void
}): React.JSX.Element {
  const loadMax = Math.max(...KPI_LOAD_COMPARE.flatMap((row) => [row.employeeHours + row.aiHours]), 1)

  return (
    <>
      <OrchSlotMetrics>
        <SpecSummaryTiles tiles={KPI_SUMMARY_TILES} />
      </OrchSlotMetrics>

      <OrchSlotFilters>
        <SpecFilters layout="row">
          <label className="spec-filter-input spec-filter-period">
            <SpecIconCalendar />
            <select className="wp-select" defaultValue="week">
              <option value="week">12–18 авг. 2024</option>
              <option value="month">Текущий месяц</option>
            </select>
          </label>
          <select className="wp-select spec-filter-field" defaultValue="">
            <option value="">Процесс: все</option>
            <option value="reg">Регламентные работы</option>
            <option value="mail">Входящие письма</option>
          </select>
          <select className="wp-select spec-filter-field" defaultValue="">
            <option value="">Агент: все</option>
          </select>
          <select className="wp-select spec-filter-field" defaultValue="">
            <option value="">Статус: все</option>
            <option value="ok">В норме</option>
            <option value="warn">Внимание</option>
            <option value="risk">Риск</option>
          </select>
          <label className="spec-filter-input spec-filter-search">
            <SpecIconSearch />
            <input className="wp-search" type="search" placeholder="Поиск по агентам…" />
          </label>
          <select className="wp-select spec-filter-field" defaultValue="desc">
            <option value="desc">Сортировка: по SLA</option>
            <option value="load">По загрузке</option>
          </select>
          <button type="button" className="spec-filter-reset">
            Сбросить фильтры
          </button>
        </SpecFilters>
      </OrchSlotFilters>

      <OrchSlotMain spanAll>
        <div className="spec-v04-table-wrap wp-card">
          <header className="spec-v04-panel-head kpi-grid-table-head">
            <h3>KPI ИИ-агентов</h3>
          </header>
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
              {KPI_AGENT_ROWS.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.agent}</strong>
                  </td>
                  <td>{row.process}</td>
                  <td>
                    <KpiMetricCell value={row.completion} />
                  </td>
                  <td>
                    <KpiMetricCell value={row.sla} />
                  </td>
                  <td>
                    <KpiMetricCell value={row.load} />
                  </td>
                  <td>
                    <KpiMetricCell value={row.automation} />
                  </td>
                  <td>
                    <SpecPill tone={kpiStatusTone(row.status)}>{kpiStatusLabel(row.status)}</SpecPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </OrchSlotMain>

      <OrchSlotBotA>
        <SpecPanel title="Проблемные зоны">
          <table className="spec-v04-table spec-v04-table-compact kpi-grid-problem-table">
            <thead>
              <tr>
                <th>Зона</th>
                <th>Показатель</th>
                <th>Значение</th>
                <th>Рекомендация</th>
              </tr>
            </thead>
            <tbody>
              {KPI_PROBLEM_ZONES.map((row) => (
                <tr key={row.id}>
                  <td>{row.zone}</td>
                  <td>{row.indicator}</td>
                  <td>
                    <SpecPill tone={kpiMetricTone(Number.parseInt(row.value, 10) || 80)}>{row.value}</SpecPill>
                  </td>
                  <td>{row.recommendation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SpecPanel>
      </OrchSlotBotA>

      <OrchSlotBotB>
        <SpecPanel title="Нагрузка: сотрудник vs ИИ">
          <div className="kpi-load-chart">
            {KPI_LOAD_COMPARE.map((row) => {
              const total = row.employeeHours + row.aiHours
              const employeeWidth = `${Math.round((row.employeeHours / loadMax) * 100)}%`
              const totalWidth = `${Math.round((total / loadMax) * 100)}%`
              return (
                <div key={row.id} className="kpi-load-row">
                  <span>{row.label}</span>
                  <div className="kpi-load-track">
                    <i className="ai" style={{ width: totalWidth }} />
                    <i className="employee" style={{ width: employeeWidth }} />
                  </div>
                  <span className="kpi-load-value">{total} ч</span>
                </div>
              )
            })}
            <div className="kpi-load-legend">
              <span>
                <i className="employee" aria-hidden /> Сотрудник
              </span>
              <span>
                <i className="ai" aria-hidden /> ИИ
              </span>
            </div>
          </div>
        </SpecPanel>
      </OrchSlotBotB>

      <OrchSlotBotC>
        <SpecPanel title="Динамика показателей">
          <div className="kpi-dynamics-chart">
            <svg viewBox="0 0 420 140" preserveAspectRatio="none" aria-hidden>
              {[35, 70, 105].map((y) => (
                <line key={y} x1="0" x2="420" y1={y} y2={y} stroke="rgba(13,59,115,0.08)" />
              ))}
              <polyline
                points={chartPoints(KPI_DYNAMICS_SERIES.completion, 420, 140)}
                fill="none"
                stroke="#e8943a"
                strokeWidth="2.5"
              />
              <polyline
                points={chartPoints(KPI_DYNAMICS_SERIES.sla, 420, 140)}
                fill="none"
                stroke="#2e9a6f"
                strokeWidth="2.5"
              />
            </svg>
          </div>
          <div className="kpi-dynamics-legend">
            <span>
              <i className="completion" aria-hidden /> Выполнение
            </span>
            <span>
              <i className="sla" aria-hidden /> SLA
            </span>
          </div>
        </SpecPanel>
      </OrchSlotBotC>
    </>
  )
}
