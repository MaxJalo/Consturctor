export type KpiValueSource = 'reference' | 'computed'

export interface WorkplaceKpiCard {
  id: string
  label: string
  displayValue: string
  trend?: string | null
  progress?: number | null
  ring?: boolean
  tone?: string
  source: KpiValueSource
}

export interface WorkplaceKpiAgentRow {
  id: string
  code: string
  name: string
  process: string
  completionPct: number
  slaPct: number
  loadPct: number
  automationPct: number
  status: string
  statusTone: string
  source: KpiValueSource
}

export interface WorkplaceKpiProblemZone {
  id: string
  zone: string
  metric: string
  value: string
  severity: string
  recommendation: string
  source: KpiValueSource
}

export interface WorkplaceKpiCompareRow {
  id: string
  label: string
  employee: number
  ai: number
  source: KpiValueSource
}

export interface WorkplaceKpiChartSeries {
  id: string
  label: string
  color: string
  points: number[]
}

export interface WorkplaceKpiDynamics {
  title: string
  xLabels: string[]
  yMax: number
  series: WorkplaceKpiChartSeries[]
  source: KpiValueSource
}

export interface WorkplaceKpiDashboard {
  periodFrom: string
  periodTo: string
  periodLabel: string
  cards: WorkplaceKpiCard[]
  agents: WorkplaceKpiAgentRow[]
  problemZones: WorkplaceKpiProblemZone[]
  workloadCompare: WorkplaceKpiCompareRow[]
  dynamics: WorkplaceKpiDynamics
  generatedAt: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function parseSource(raw: unknown): KpiValueSource {
  return raw === 'computed' ? 'computed' : 'reference'
}

export function parseWorkplaceKpiDashboard(raw: unknown): WorkplaceKpiDashboard {
  const data = asRecord(raw)
  const cards = Array.isArray(data.cards)
    ? data.cards.map((item) => {
        const row = asRecord(item)
        return {
          id: String(row.id ?? ''),
          label: String(row.label ?? ''),
          displayValue: String(row.displayValue ?? ''),
          trend: row.trend != null ? String(row.trend) : null,
          progress: row.progress == null ? null : Number(row.progress),
          ring: row.ring == null ? true : Boolean(row.ring),
          tone: row.tone != null ? String(row.tone) : undefined,
          source: parseSource(row.source)
        } satisfies WorkplaceKpiCard
      })
    : []
  const agents = Array.isArray(data.agents)
    ? data.agents.map((item) => {
        const row = asRecord(item)
        return {
          id: String(row.id ?? ''),
          code: String(row.code ?? ''),
          name: String(row.name ?? ''),
          process: String(row.process ?? ''),
          completionPct: Number(row.completionPct ?? 0),
          slaPct: Number(row.slaPct ?? 0),
          loadPct: Number(row.loadPct ?? 0),
          automationPct: Number(row.automationPct ?? 0),
          status: String(row.status ?? ''),
          statusTone: String(row.statusTone ?? 'gray'),
          source: parseSource(row.source)
        } satisfies WorkplaceKpiAgentRow
      })
    : []
  const problemZones = Array.isArray(data.problemZones)
    ? data.problemZones.map((item) => {
        const row = asRecord(item)
        return {
          id: String(row.id ?? ''),
          zone: String(row.zone ?? ''),
          metric: String(row.metric ?? ''),
          value: String(row.value ?? ''),
          severity: String(row.severity ?? 'orange'),
          recommendation: String(row.recommendation ?? ''),
          source: parseSource(row.source)
        } satisfies WorkplaceKpiProblemZone
      })
    : []
  const workloadCompare = Array.isArray(data.workloadCompare)
    ? data.workloadCompare.map((item) => {
        const row = asRecord(item)
        return {
          id: String(row.id ?? ''),
          label: String(row.label ?? ''),
          employee: Number(row.employee ?? 0),
          ai: Number(row.ai ?? 0),
          source: parseSource(row.source)
        } satisfies WorkplaceKpiCompareRow
      })
    : []
  const dynRaw = asRecord(data.dynamics)
  const series = Array.isArray(dynRaw.series)
    ? dynRaw.series.map((item) => {
        const row = asRecord(item)
        return {
          id: String(row.id ?? ''),
          label: String(row.label ?? ''),
          color: String(row.color ?? '#1565c0'),
          points: Array.isArray(row.points) ? row.points.map((p) => Number(p)) : []
        } satisfies WorkplaceKpiChartSeries
      })
    : []
  return {
    periodFrom: String(data.periodFrom ?? ''),
    periodTo: String(data.periodTo ?? ''),
    periodLabel: String(data.periodLabel ?? ''),
    cards,
    agents,
    problemZones,
    workloadCompare,
    dynamics: {
      title: String(dynRaw.title ?? 'Динамика'),
      xLabels: Array.isArray(dynRaw.xLabels) ? dynRaw.xLabels.map((x) => String(x)) : [],
      yMax: Number(dynRaw.yMax ?? 100),
      series,
      source: parseSource(dynRaw.source)
    },
    generatedAt: String(data.generatedAt ?? '')
  }
}
