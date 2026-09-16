import { api } from '../api/client'
import type {
  AdminAiAgentsMock,
  AdminBadgeTone,
  AdminFilterMock,
  AdminHistoryMock,
  AdminKnowledgeBaseMock,
  AdminKpiMock,
  AdminLaunchCalendarMock,
  AdminOverviewMock,
  AdminSlaTone,
  AdminUsersMock
} from '../mocks/adminMocks'

function pickString(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string') return value
  }
  return ''
}

function parseMetric(raw: Record<string, unknown>) {
  return {
    id: String(raw.id ?? ''),
    label: String(raw.label ?? ''),
    value: String(raw.value ?? ''),
    trend: typeof raw.trend === 'string' ? raw.trend : undefined,
    trendTone:
      raw.trendTone === 'positive' || raw.trendTone === 'negative' || raw.trendTone === 'neutral'
        ? raw.trendTone
        : raw.trend_tone === 'positive' || raw.trend_tone === 'negative' || raw.trend_tone === 'neutral'
          ? raw.trend_tone
          : undefined,
    icon: raw.icon as AdminOverviewMock['metrics'][number]['icon']
  }
}

function parseChartSeries(raw: Record<string, unknown>) {
  return {
    id: String(raw.id ?? ''),
    label: String(raw.label ?? ''),
    color: String(raw.color ?? ''),
    points: Array.isArray(raw.points) ? raw.points.map((p) => Number(p)) : []
  }
}

function parseLaunchDynamics(raw: Record<string, unknown>) {
  const series = Array.isArray(raw.series)
    ? raw.series.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : []
  const legend = Array.isArray(raw.legend)
    ? raw.legend.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : []
  return {
    title: String(raw.title ?? ''),
    yMax: Number(raw.yMax ?? raw.y_max ?? 0),
    yTicks: Array.isArray(raw.yTicks ?? raw.y_ticks)
      ? (raw.yTicks ?? raw.y_ticks).map((v) => Number(v))
      : [],
    xLabels: Array.isArray(raw.xLabels ?? raw.x_labels)
      ? (raw.xLabels ?? raw.x_labels).map((v) => String(v))
      : [],
    series: series.map(parseChartSeries),
    legend: legend.map((item) => ({
      id: String(item.id ?? ''),
      label: String(item.label ?? ''),
      color: String(item.color ?? '')
    }))
  }
}

export function parseAdminOverview(data: Record<string, unknown>): AdminOverviewMock {
  const metrics = Array.isArray(data.metrics)
    ? data.metrics
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map(parseMetric)
    : []
  const integrations = Array.isArray(data.integrations)
    ? data.integrations
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          id: String(item.id ?? ''),
          label: String(item.label ?? ''),
          online: Boolean(item.online)
        }))
    : []
  const agentRaw =
    (data.agentStatuses as Record<string, unknown> | undefined) ??
    (data.agent_statuses as Record<string, unknown> | undefined) ??
    {}
  const slices = Array.isArray(agentRaw.slices)
    ? agentRaw.slices
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          id: String(item.id ?? ''),
          label: String(item.label ?? ''),
          value: Number(item.value ?? 0),
          color: String(item.color ?? '')
        }))
    : []

  return {
    breadcrumb: pickString(data, 'breadcrumb'),
    dashboardTitle: pickString(data, 'dashboardTitle', 'dashboard_title'),
    dashboardSubtitle: pickString(data, 'dashboardSubtitle', 'dashboard_subtitle'),
    periodLabel: pickString(data, 'periodLabel', 'period_label'),
    dateRange: pickString(data, 'dateRange', 'date_range'),
    refreshLabel: pickString(data, 'refreshLabel', 'refresh_label'),
    metrics,
    launchDynamics: parseLaunchDynamics(
      (data.launchDynamics as Record<string, unknown>) ??
        (data.launch_dynamics as Record<string, unknown>) ??
        {}
    ),
    agentStatuses: {
      title: String(agentRaw.title ?? ''),
      total: Number(agentRaw.total ?? 0),
      slices
    },
    integrations
  }
}

export async function fetchAdminOverview(): Promise<AdminOverviewMock> {
  const data = await api.adminOverview()
  return parseAdminOverview(data)
}

function recordArray(data: Record<string, unknown>, ...keys: string[]): Record<string, unknown>[] {
  for (const key of keys) {
    const value = data[key]
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    }
  }
  return []
}

function parsePeriod(data: Record<string, unknown>) {
  return {
    periodLabel: pickString(data, 'periodLabel', 'period_label'),
    dateRange: pickString(data, 'dateRange', 'date_range')
  }
}

function parseFilters(data: Record<string, unknown>): AdminFilterMock[] {
  return recordArray(data, 'filters').map((item) => ({
    id: String(item.id ?? ''),
    options: Array.isArray(item.options) ? item.options.map((v) => String(v)) : [],
    defaultValue:
      typeof item.defaultValue === 'string'
        ? item.defaultValue
        : typeof item.default_value === 'string'
          ? item.default_value
          : undefined
  }))
}

function parsePagination(data: Record<string, unknown>): { pageSize: number; total: number } {
  const raw =
    (data.pagination as Record<string, unknown> | undefined) ??
    (data.pagination as Record<string, unknown> | undefined)
  if (!raw || typeof raw !== 'object') {
    return { pageSize: 10, total: 0 }
  }
  return {
    pageSize: Number(raw.pageSize ?? raw.page_size ?? 10),
    total: Number(raw.total ?? 0)
  }
}

function parseBadgeTone(value: unknown): AdminBadgeTone {
  const tone = String(value ?? 'neutral')
  if (tone === 'success' || tone === 'warning' || tone === 'error' || tone === 'info' || tone === 'neutral') {
    return tone
  }
  return 'neutral'
}

function parseSlaTone(value: unknown): AdminSlaTone {
  const tone = String(value ?? 'ok')
  if (tone === 'ok' || tone === 'warn' || tone === 'fail') return tone
  return 'ok'
}

function parseTabList(data: Record<string, unknown>): Array<{ id: string; label: string }> {
  return recordArray(data, 'tabs').map((item) => ({
    id: String(item.id ?? ''),
    label: String(item.label ?? '')
  }))
}

export function parseAdminHistory(data: Record<string, unknown>): AdminHistoryMock {
  return {
    ...parsePeriod(data),
    breadcrumb: pickString(data, 'breadcrumb'),
    title: pickString(data, 'title'),
    subtitle: pickString(data, 'subtitle'),
    tabs: parseTabList(data),
    activeTab: pickString(data, 'activeTab', 'active_tab') || 'processes',
    filters: parseFilters(data),
    rows: recordArray(data, 'rows').map((row) => ({
      id: String(row.id ?? ''),
      process: String(row.process ?? ''),
      agent: String(row.agent ?? ''),
      user: String(row.user ?? ''),
      status: String(row.status ?? ''),
      statusTone: parseBadgeTone(row.statusTone ?? row.status_tone),
      launchedAt: String(row.launchedAt ?? row.launched_at ?? ''),
      duration: String(row.duration ?? ''),
      sla: parseSlaTone(row.sla),
      tab: String(row.tab ?? 'processes')
    })),
    pagination: parsePagination(data)
  }
}

export async function fetchAdminHistory(): Promise<AdminHistoryMock> {
  return parseAdminHistory(await api.adminHistory())
}

export function parseAdminLaunchCalendar(data: Record<string, unknown>): AdminLaunchCalendarMock {
  return {
    ...parsePeriod(data),
    breadcrumb: pickString(data, 'breadcrumb'),
    title: pickString(data, 'title'),
    subtitle: pickString(data, 'subtitle'),
    createLabel: pickString(data, 'createLabel', 'create_label'),
    viewModes: Array.isArray(data.viewModes ?? data.view_modes)
      ? (data.viewModes ?? data.view_modes).map((v) => String(v))
      : [],
    activeView: pickString(data, 'activeView', 'active_view') || 'Неделя',
    weekRange: pickString(data, 'weekRange', 'week_range'),
    days: Array.isArray(data.days) ? data.days.map((v) => String(v)) : [],
    hours: Array.isArray(data.hours) ? data.hours.map((v) => String(v)) : [],
    events: recordArray(data, 'events').map((event) => ({
      id: String(event.id ?? ''),
      dayIndex: Number(event.dayIndex ?? event.day_index ?? 0),
      startHour: Number(event.startHour ?? event.start_hour ?? 0),
      endHour: Number(event.endHour ?? event.end_hour ?? 0),
      title: String(event.title ?? ''),
      tone: String(event.tone ?? 'green') as AdminLaunchCalendarMock['events'][number]['tone'],
      agentId: String(event.agentId ?? event.agent_id ?? '')
    })),
    agentFilters: recordArray(data, 'agentFilters', 'agent_filters').map((item) => ({
      id: String(item.id ?? ''),
      label: String(item.label ?? ''),
      color: String(item.color ?? '#1a73e8'),
      checked: Boolean(item.checked ?? true)
    })),
    miniMonth: pickString(data, 'miniMonth', 'mini_month'),
    miniDays: recordArray(data, 'miniDays', 'mini_days').map((item) => ({
      day: Number(item.day ?? 0),
      active: item.active === true ? true : undefined,
      muted: item.muted === true ? true : undefined
    })),
    unscheduled: recordArray(data, 'unscheduled').map((item) => ({
      id: String(item.id ?? ''),
      title: String(item.title ?? ''),
      subtitle: String(item.subtitle ?? ''),
      tone: (String(item.tone ?? 'purple') === 'green' ? 'green' : 'purple') as 'purple' | 'green'
    })),
    scheduleAllLabel: pickString(data, 'scheduleAllLabel', 'schedule_all_label')
  }
}

export async function fetchAdminLaunchCalendar(): Promise<AdminLaunchCalendarMock> {
  return parseAdminLaunchCalendar(await api.adminLaunchCalendar())
}

function parseKpiSummaries(items: Record<string, unknown>[]) {
  return items.map((item) => ({
    id: String(item.id ?? ''),
    label: String(item.label ?? ''),
    value: String(item.value ?? ''),
    trend: typeof item.trend === 'string' ? item.trend : undefined,
    trendTone:
      item.trendTone === 'positive' || item.trendTone === 'negative' || item.trendTone === 'neutral'
        ? item.trendTone
        : item.trend_tone === 'positive' || item.trend_tone === 'negative' || item.trend_tone === 'neutral'
          ? item.trend_tone
          : undefined,
    tint:
      item.tint === 'orange' || item.tint === 'green' || item.tint === 'red' || item.tint === 'none'
        ? item.tint
        : undefined,
    icon: item.icon === 'target' || item.icon === 'none' ? item.icon : undefined
  }))
}

export function parseAdminKpi(data: Record<string, unknown>): AdminKpiMock {
  const agentCards = recordArray(data, 'agentCards', 'agent_cards').map((card) => ({
    id: String(card.id ?? ''),
    name: String(card.name ?? ''),
    process: String(card.process ?? ''),
    status: String(card.status ?? ''),
    statusTone: parseBadgeTone(card.statusTone ?? card.status_tone),
    efficiency: Number(card.efficiency ?? 0),
    summaries: parseKpiSummaries(recordArray(card, 'summaries'))
  }))
  return {
    ...parsePeriod(data),
    breadcrumb: pickString(data, 'breadcrumb'),
    title: pickString(data, 'title'),
    subtitle: pickString(data, 'subtitle'),
    tabs: parseTabList(data),
    activeTab: pickString(data, 'activeTab', 'active_tab') || 'general',
    summaries: parseKpiSummaries(recordArray(data, 'summaries')),
    agentCards,
    dynamics: parseLaunchDynamics(
      (data.dynamics as Record<string, unknown>) ?? (data.dynamics as Record<string, unknown>) ?? {}
    ),
    topAgents: recordArray(data, 'topAgents', 'top_agents').map((item) => ({
      label: String(item.label ?? ''),
      value: Number(item.value ?? 0)
    })),
    gauges: recordArray(data, 'gauges').map((item) => ({
      id: String(item.id ?? ''),
      label: String(item.label ?? ''),
      value: String(item.value ?? ''),
      tone: (String(item.tone ?? 'green') === 'orange' || String(item.tone ?? 'green') === 'cyan'
        ? String(item.tone)
        : 'green') as 'green' | 'orange' | 'cyan'
    }))
  }
}

export async function fetchAdminKpi(): Promise<AdminKpiMock> {
  return parseAdminKpi(await api.adminKpi())
}

export function parseAdminUsers(data: Record<string, unknown>): AdminUsersMock {
  return {
    breadcrumb: pickString(data, 'breadcrumb'),
    title: pickString(data, 'title'),
    subtitle: pickString(data, 'subtitle'),
    addLabel: pickString(data, 'addLabel', 'add_label'),
    filters: parseFilters(data),
    rows: recordArray(data, 'rows').map((row) => ({
      fio: String(row.fio ?? ''),
      position: String(row.position ?? ''),
      department: String(row.department ?? ''),
      role: String(row.role ?? ''),
      status: String(row.status ?? ''),
      agentsAccess: Number(row.agentsAccess ?? row.agents_access ?? 0),
      agentsUsed: Number(row.agentsUsed ?? row.agents_used ?? 0),
      lastActivity: String(row.lastActivity ?? row.last_activity ?? '')
    })),
    pagination: parsePagination(data)
  }
}

export async function fetchAdminUsers(): Promise<AdminUsersMock> {
  return parseAdminUsers(await api.adminUsers())
}

function parseAgentDetail(raw: Record<string, unknown>): AdminAiAgentsMock['detail'] {
  return {
    name: String(raw.name ?? ''),
    status: String(raw.status ?? ''),
    statusTone: parseBadgeTone(raw.statusTone ?? raw.status_tone),
    description: String(raw.description ?? ''),
    tabs: Array.isArray(raw.tabs) ? raw.tabs.map((v) => String(v)) : [],
    activeTab: pickString(raw, 'activeTab', 'active_tab'),
    info: recordArray(raw, 'info').map((item) => ({
      label: String(item.label ?? ''),
      value: String(item.value ?? '')
    })),
    metrics: recordArray(raw, 'metrics').map((item) => ({
      label: String(item.label ?? ''),
      value: String(item.value ?? '')
    })),
    processes: recordArray(raw, 'processes').map((item) => ({
      title: String(item.title ?? ''),
      time: String(item.time ?? ''),
      status: String(item.status ?? ''),
      statusTone: parseBadgeTone(item.statusTone ?? item.status_tone),
      tone: String(item.tone ?? 'green') === 'grey' ? 'grey' : 'green'
    }))
  }
}

export function parseAdminAiAgents(data: Record<string, unknown>): AdminAiAgentsMock {
  const detailRaw =
    (data.detail as Record<string, unknown> | undefined) ?? (data.detail as Record<string, unknown> | undefined) ?? {}
  return {
    breadcrumb: pickString(data, 'breadcrumb'),
    title: pickString(data, 'title'),
    subtitle: pickString(data, 'subtitle'),
    createLabel: pickString(data, 'createLabel', 'create_label'),
    importLabel: pickString(data, 'importLabel', 'import_label'),
    filters: parseFilters(data),
    rows: recordArray(data, 'rows').map((row) => ({
      name: String(row.name ?? ''),
      process: String(row.process ?? ''),
      owner: String(row.owner ?? ''),
      version: String(row.version ?? ''),
      status: String(row.status ?? ''),
      statusTone: parseBadgeTone(row.statusTone ?? row.status_tone),
      runs: Number(row.runs ?? 0),
      successRate: String(row.successRate ?? row.success_rate ?? ''),
      used: Boolean(row.used)
    })),
    pagination: parsePagination(data),
    detail: parseAgentDetail(detailRaw)
  }
}

export async function fetchAdminAiAgents(): Promise<AdminAiAgentsMock> {
  return parseAdminAiAgents(await api.adminAiAgents())
}

export function parseAdminKnowledgeBase(data: Record<string, unknown>): AdminKnowledgeBaseMock {
  const docRaw =
    (data.document as Record<string, unknown> | undefined) ??
    (data.document as Record<string, unknown> | undefined) ??
    {}
  return {
    breadcrumb: pickString(data, 'breadcrumb'),
    title: pickString(data, 'title'),
    subtitle: pickString(data, 'subtitle'),
    addLabel: pickString(data, 'addLabel', 'add_label'),
    filters: parseFilters(data),
    rows: recordArray(data, 'rows').map((row) => ({
      name: String(row.name ?? ''),
      type: String(row.type ?? ''),
      agents: String(row.agents ?? ''),
      version: String(row.version ?? ''),
      status: String(row.status ?? ''),
      statusTone: parseBadgeTone(row.statusTone ?? row.status_tone),
      updatedAt: String(row.updatedAt ?? row.updated_at ?? '')
    })),
    pagination: parsePagination(data),
    document: {
      title: String(docRaw.title ?? ''),
      status: String(docRaw.status ?? ''),
      statusTone: parseBadgeTone(docRaw.statusTone ?? docRaw.status_tone),
      meta: String(docRaw.meta ?? ''),
      text: String(docRaw.text ?? ''),
      format: String(docRaw.format ?? ''),
      author: String(docRaw.author ?? ''),
      category: String(docRaw.category ?? ''),
      tags: Array.isArray(docRaw.tags) ? docRaw.tags.map((v) => String(v)) : [],
      usageTotal: String(docRaw.usageTotal ?? docRaw.usage_total ?? ''),
      usageTrend: String(docRaw.usageTrend ?? docRaw.usage_trend ?? ''),
      usageBars: Array.isArray(docRaw.usageBars ?? docRaw.usage_bars)
        ? (docRaw.usageBars ?? docRaw.usage_bars).map((v) => Number(v))
        : [],
      agentsShare: recordArray(docRaw, 'agentsShare', 'agents_share').map((item) => ({
        label: String(item.label ?? ''),
        value: Number(item.value ?? 0)
      })),
      related: recordArray(docRaw, 'related').map((item) => ({
        title: String(item.title ?? ''),
        type: String(item.type ?? '')
      })),
      relatedCount: Number(docRaw.relatedCount ?? docRaw.related_count ?? 0)
    }
  }
}

export async function fetchAdminKnowledgeBase(): Promise<AdminKnowledgeBaseMock> {
  return parseAdminKnowledgeBase(await api.adminKnowledgeBase())
}

export interface AdminSettingsData {
  breadcrumb: string
  title: string
  subtitle: string
}

export function parseAdminSettings(data: Record<string, unknown>): AdminSettingsData {
  return {
    breadcrumb: pickString(data, 'breadcrumb'),
    title: pickString(data, 'title'),
    subtitle: pickString(data, 'subtitle')
  }
}

export async function fetchAdminSettings(): Promise<AdminSettingsData> {
  return parseAdminSettings(await api.adminSettings())
}
