import { cpuUsage, memoryUsage } from 'node:process'

export type MetricPoint = { t: number; v: number }
export type MetricLog = { t: number; level: string; module: string; text: string }
export type MetricModule = {
  requests: MetricPoint[]
  latencyMs: MetricPoint[]
  ok: boolean | null
  detail: string
}

export type SetupMetrics = {
  now: number
  serverMetrics: boolean
  modules: {
    server: MetricModule
    mail: MetricModule
    onec: MetricModule
    helper: MetricModule
  }
  resources: {
    appCpu: MetricPoint[]
    appMemoryMb: MetricPoint[]
    serverCpu: MetricPoint[]
    serverMemoryMb: MetricPoint[]
  }
  logs: MetricLog[]
}

const appCpu: MetricPoint[] = []
const appMemory: MetricPoint[] = []
let lastCpu = cpuUsage()
let lastAt = Date.now()

function push(rows: MetricPoint[], point: MetricPoint): void {
  rows.push(point)
  if (rows.length > 120) rows.shift()
}

export function sampleAppResources(): void {
  const now = Date.now()
  const usage = cpuUsage()
  const elapsed = Math.max(1, now - lastAt)
  const micros = usage.user - lastCpu.user + (usage.system - lastCpu.system)
  const pct = Math.max(0, Math.min(100, (micros / 1000 / elapsed) * 100))
  lastCpu = usage
  lastAt = now
  push(appCpu, { t: now, v: Math.round(pct * 10) / 10 })
  push(appMemory, { t: now, v: Math.round(memoryUsage().rss / (1024 * 1024)) })
}

function emptyModule(detail: string): MetricModule {
  return { requests: [], latencyMs: [], ok: null, detail }
}

function asPoints(value: unknown): MetricPoint[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const row = item as { t?: unknown; v?: unknown }
      return { t: Number(row.t) || 0, v: Number(row.v) || 0 }
    })
    .filter((item) => item.t > 0)
}

export async function collectSetupMetrics(
  backendUrl: string,
  helper: { ok: boolean; detail: string; logs: MetricLog[] }
): Promise<SetupMetrics> {
  sampleAppResources()
  const base = backendUrl.replace(/\/+$/, '')
  let remote: Record<string, unknown> | null = null
  try {
    const response = await fetch(`${base}/health/metrics`, { signal: AbortSignal.timeout(2500) })
    if (response.ok) remote = (await response.json()) as Record<string, unknown>
  } catch {
    remote = null
  }
  const modules = (remote?.modules || {}) as Record<string, Record<string, unknown>>
  const resources = (remote?.resources || {}) as Record<string, unknown>
  const remoteLogs = Array.isArray(remote?.logs) ? (remote?.logs as MetricLog[]) : []
  const readModule = (name: string): MetricModule => {
    const row = modules[name] || {}
    return {
      requests: asPoints(row.requests),
      latencyMs: asPoints(row.latency_ms),
      ok: null,
      detail: remote ? 'запросы этого процесса' : 'сервер ещё не отдаёт метрики'
    }
  }
  const logs = [...remoteLogs, ...helper.logs]
    .map((item) => ({
      t: Number(item.t) || 0,
      level: String(item.level || 'info'),
      module: String(item.module || ''),
      text: String(item.text || '')
    }))
    .filter((item) => item.t > 0 && item.text)
    .sort((left, right) => left.t - right.t)
    .slice(-120)
  return {
    now: Date.now(),
    serverMetrics: Boolean(remote),
    modules: {
      server: readModule('server'),
      mail: readModule('mail'),
      onec: readModule('onec'),
      helper: {
        requests: [],
        latencyMs: [],
        ok: helper.ok,
        detail: helper.detail
      }
    },
    resources: {
      appCpu: appCpu.slice(),
      appMemoryMb: appMemory.slice(),
      serverCpu: asPoints(resources.cpu),
      serverMemoryMb: asPoints(resources.memory_mb)
    },
    logs
  }
}
