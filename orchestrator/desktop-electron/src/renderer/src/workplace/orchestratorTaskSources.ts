import { api } from '../api/client'
import type { UserProfile } from '../api/types'
import {
  fetchOutlookMailForRange,
  outlookMailWeekRange,
  skipOutlookCom
} from '../utils/outlookMail'
import { hasComPassword } from '../store/session'
import {
  enrichEmptyOneCErrors,
  formatComToolError,
  formatDocflowSecondaryHint,
  isDocflowOdataWarning,
  isLanBackendUrl,
  isOneCAuthFailure,
  lanGatewayZeroTasksHint,
  missingComPasswordMessage,
  stubSourceMessage,
  isErpMetaHintRecord
} from './onecSessionHints'
import { onecGatewayInvokeArgs, turboProjectInvokeArgs } from './userContext'
import { comSearchTasksToErpRecords, invokeLocalAcTool } from '../utils/localAcTool'
import { erpTaskToRow, outlookMessageToMailRow, turboProjectToRow } from './specV04Mappers'
import type { SpecMailRow, SpecProjectRow, SpecTaskRow } from './specV04DemoData'
import { isTurboNoSessionError } from './turboSession'

/** Stable ids for grid refresh / telemetry (see GridDataRefreshProvider generation). */
export const ORCH_SOURCE_ID = {
  erpPm: 'erp_pm',
  turboProject: 'turboproject',
  outlookMail: 'outlook_mail'
} as const

/**
 * 1C grid default: gateway SQL via onec.erp_tasks_current (_query_tasks in erp_tasks.py).
 * COM onec.search_tasks runs only when VITE_ONEC_COM_TASKS_FALLBACK=1 and SQL merge is empty.
 */
export function onecComTasksFallbackEnabled(): boolean {
  const flag = String(import.meta.env.VITE_ONEC_COM_TASKS_FALLBACK ?? '').trim().toLowerCase()
  return flag === '1' || flag === 'true' || flag === 'yes'
}

/** Pin Turbo file_id(s) so «Сегодня → проектные» always loads them (e.g. 363). */
export function turboPinnedProjectFileIds(): string[] {
  const raw = String(import.meta.env.VITE_TURBO_PIN_FILE_IDS ?? '363').trim()
  if (!raw) return ['363']
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

export function isTurboPinPlaceholder(row: SpecProjectRow): boolean {
  if (row.role === 'pin') return true
  const pinned = turboPinnedProjectFileIds()
  if (pinned.includes(row.id) && /^TurboProject #\d+$/.test(row.name)) return true
  return false
}

/** Placeholder rows so pinned file_id loads even when user_portfolio filter is empty. */
export function mergePinnedTurboProjects(projects: SpecProjectRow[]): SpecProjectRow[] {
  const pinned = turboPinnedProjectFileIds()
  if (!pinned.length) return projects
  const byId = new Map(projects.map((row) => [row.id, row]))
  const merged = [...projects]
  for (const id of pinned) {
    if (byId.has(id)) continue
    merged.unshift({
      id,
      name: `TurboProject #${id}`,
      code: id,
      role: 'pin',
      tasks: 1,
      status: '—',
      statusTone: 'gray',
      deadline: '—',
      progress: 0,
      risk: '—',
      riskTone: 'gray'
    })
  }
  return merged
}

/** Load card fields for pin placeholders and pinned file_id (empty portfolio index). */
export async function enrichTurboProjectsFromApi(
  user: UserProfile,
  erpFio: string,
  projects: SpecProjectRow[]
): Promise<SpecProjectRow[]> {
  if (!projects.length) return projects
  const enrichIds = new Set<string>()
  for (const id of turboPinnedProjectFileIds()) enrichIds.add(id)
  for (const row of projects) {
    if (isTurboPinPlaceholder(row)) enrichIds.add(row.id)
  }
  if (!enrichIds.size) return projects

  const byId = new Map(projects.map((row) => [row.id, row]))
  await Promise.all(
    [...enrichIds].map(async (projectId) => {
      const res = await api.invokeServerTool(
        'turboproject.get_project',
        turboProjectInvokeArgs(user, {
          project_id: projectId,
          fields: ['identity', 'dates', 'data_1c', 'task_stats', 'overdue', 'resources']
        })
      )
      if (!res.ok || !res.result || typeof res.result !== 'object') return
      const payload = res.result as Record<string, unknown>
      const rawList = Array.isArray(payload.projects) ? payload.projects : []
      const raw = rawList.find((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      if (!raw) return
      const mapped = turboProjectToRow({ ...raw, file_id: raw.file_id ?? projectId }, erpFio)
      byId.set(projectId, { ...mapped, id: projectId })
    })
  )
  const seen = new Set<string>()
  const merged: SpecProjectRow[] = []
  for (const row of projects) {
    const next = byId.get(row.id) ?? row
    if (seen.has(next.id)) continue
    seen.add(next.id)
    merged.push(next)
  }
  for (const id of enrichIds) {
    if (seen.has(id)) continue
    const row = byId.get(id)
    if (row) {
      seen.add(id)
      merged.unshift(row)
    }
  }
  return merged.length ? merged : projects
}

export function turboProjectFetchCandidates(projects: SpecProjectRow[], max = 5): SpecProjectRow[] {
  const merged = mergePinnedTurboProjects(projects)
  return pickTurboProjectsForTaskFetch(merged, max)
}

export function normalizeErpGatewaySource(source: string): string {
  const key = (source || '').trim().toLowerCase()
  if (!key || key === 'stub') return key || ''
  if (key.includes('erp_pm')) return ORCH_SOURCE_ID.erpPm
  if (key.includes('документооборот') || key.includes('docflow')) return 'docflow'
  return source
}

function parseErpToolTasks(
  res: { ok: boolean; result?: unknown; error?: string },
  erpFio: string
): { rows: SpecTaskRow[]; source: string; warning: string; error: string } {
  if (!res.ok || !res.result || typeof res.result !== 'object') {
    return {
      rows: [],
      source: '',
      warning: '',
      error: res.error || ''
    }
  }
  const payload = res.result as Record<string, unknown>
  const source = normalizeErpGatewaySource(String(payload.source || ORCH_SOURCE_ID.erpPm))
  const warning = String(payload.docflow_warning || payload.warning || '').trim()
  const raw = Array.isArray(payload.tasks) ? payload.tasks : []
  const records = raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => !isErpMetaHintRecord(item))
  const rows = records.map((item) => erpTaskToRow(item, erpFio))
  return { rows, source, warning, error: '' }
}

function uniqueErrorJoin(...chunks: (string | undefined | null)[]): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const chunk of chunks) {
    if (!chunk?.trim()) continue
    for (const piece of chunk.split(' · ')) {
      const text = piece.trim()
      if (!text || seen.has(text)) continue
      seen.add(text)
      parts.push(text)
    }
  }
  return parts.join(' · ')
}

async function loadComErpTasks(
  user: UserProfile,
  erpFio: string,
  priorError: string
): Promise<{ rows: SpecTaskRow[]; source: string; error: string }> {
  if (!hasComPassword()) {
    return {
      rows: [],
      source: '',
      error: uniqueErrorJoin(priorError, missingComPasswordMessage())
    }
  }
  const comRes = await invokeLocalAcTool(
    'onec.search_tasks',
    { mine_only: true, limit: 80 },
    undefined,
    user
  )
  if (comRes.ok && comRes.result) {
    const comRecords = comSearchTasksToErpRecords(comRes.result)
    if (comRecords.length) {
      const note = priorError.trim()
        ? `Gateway/SQL без задач; COM 1С (opt-in, ${priorError.trim()})`
        : 'Задачи через COM 1С (opt-in VITE_ONEC_COM_TASKS_FALLBACK)'
      return {
        rows: comRecords.map((item) => erpTaskToRow(item, erpFio)),
        source: 'onec_com',
        error: note
      }
    }
    const payloadErr = formatComToolError(
      String((comRes.result as Record<string, unknown>).error || '').trim()
    )
    return {
      rows: [],
      source: '',
      error: uniqueErrorJoin(priorError, payloadErr, formatComToolError(comRes.error || ''))
    }
  }
  return {
    rows: [],
    source: '',
    error: uniqueErrorJoin(priorError, formatComToolError(comRes.error || ''))
  }
}

export type OrchestratorErpLoad = {
  tasks: SpecTaskRow[]
  sourceLabel: string
  error: string
  /** Non-blocking docflow hint when erp_pm tasks loaded. */
  erpSecondaryHint: string
  oneCAuthFailure: boolean
}

export async function loadOrchestratorErpTasks(
  user: UserProfile,
  erpFio: string
): Promise<OrchestratorErpLoad> {
  const onecArgs = onecGatewayInvokeArgs(user, { limit: 80 })
  const erpRes = await api.invokeServerTool('onec.erp_tasks_current', onecArgs)
  const erpParsed = parseErpToolTasks(erpRes, erpFio)

  let tasks = erpParsed.rows
  let sourceLabel = erpParsed.source || ORCH_SOURCE_ID.erpPm
  const docflowWarning = erpParsed.warning
  let mergedError = uniqueErrorJoin(
    erpRes.error || '',
    erpParsed.error,
    !erpRes.ok && !erpParsed.rows.length ? 'onec.erp_tasks_current недоступен' : '',
    erpParsed.source === 'stub' ? 'erp_pm stub (нет SQL gateway)' : ''
  )

  if (tasks.length === 0 && onecComTasksFallbackEnabled()) {
    const comParsed = await loadComErpTasks(user, erpFio, mergedError)
    if (comParsed.rows.length) {
      tasks = comParsed.rows
      sourceLabel = comParsed.source
      mergedError = comParsed.error
    } else if (comParsed.error) {
      mergedError = uniqueErrorJoin(mergedError, comParsed.error)
    }
  }

  const backendUrl = String(import.meta.env.VITE_BACKEND_URL ?? '').trim()
  const lanGateway = isLanBackendUrl(backendUrl)
  const staleGatewayHint =
    tasks.length === 0 &&
    erpParsed.source !== 'stub' &&
    erpRes.ok &&
    !mergedError.toLowerCase().includes('stub')
      ? lanGateway
        ? lanGatewayZeroTasksHint(backendUrl)
        : 'Если на LAN gateway (:7812) задач нет, а локальный backend их видит — переключите BACKEND_URL на http://127.0.0.1:7812 и запустите orchestrator/backend/run_dev.bat (нужен VPN до erp_pm на ПК разработчика).'
      : ''

  const erpCoreError = enrichEmptyOneCErrors(
    uniqueErrorJoin(mergedError, staleGatewayHint),
    {
      erpSource: erpParsed.source,
      docSource: '',
      mergedCount: tasks.length
    }
  )

  const docflowBlocksErp =
    tasks.length === 0 ||
    !docflowWarning.trim() ||
    !isDocflowOdataWarning(docflowWarning)
  const erpSecondaryHint =
    !docflowBlocksErp && docflowWarning.trim()
      ? formatDocflowSecondaryHint(docflowWarning)
      : ''
  const erpErrorJoined = docflowBlocksErp
    ? uniqueErrorJoin(erpCoreError, docflowWarning)
    : erpCoreError

  const oneCAuthFailure =
    tasks.length === 0 &&
    (!hasComPassword() ||
      isOneCAuthFailure(erpRes.error, erpParsed.error, mergedError, erpErrorJoined))

  return {
    tasks,
    sourceLabel: tasks.length ? sourceLabel : sourceLabel || erpRes.error || '—',
    error: erpErrorJoined,
    erpSecondaryHint,
    oneCAuthFailure
  }
}

export type OrchestratorTurboLoad = {
  projects: SpecProjectRow[]
  sourceLabel: string
  turboNoSession: boolean
  hint: string
}

async function finalizeTurboPortfolioProjects(
  user: UserProfile,
  erpFio: string,
  projects: SpecProjectRow[],
  turboNoSession: boolean
): Promise<SpecProjectRow[]> {
  if (turboNoSession || !projects.length) return projects
  return enrichTurboProjectsFromApi(user, erpFio, projects)
}

export async function loadOrchestratorTurboPortfolio(
  user: UserProfile,
  erpFio: string
): Promise<OrchestratorTurboLoad> {
  const [turboRes, turboStatus] = await Promise.all([
    api.invokeServerTool(
      'turboproject.get_user_portfolio',
      turboProjectInvokeArgs(user, { limit: 40 })
    ),
    api.getToolStatus('turboproject').catch(() => null)
  ])

  if (turboRes.ok && turboRes.result && typeof turboRes.result === 'object') {
    const payload = turboRes.result as Record<string, unknown>
    const source = String(payload.source || ORCH_SOURCE_ID.turboProject)
    if (source === 'stub') {
      return {
        projects: await finalizeTurboPortfolioProjects(user, erpFio, mergePinnedTurboProjects([]), true),
        sourceLabel:
          turboStatus && !turboStatus.configured
            ? 'TurboProject: на gateway задайте TURBOPROJECT_API_BASE'
            : 'TurboProject не настроен',
        turboNoSession: true,
        hint: stubSourceMessage('stub')
      }
    }
    const raw = Array.isArray(payload.projects) ? payload.projects : []
    const projects = await finalizeTurboPortfolioProjects(
      user,
      erpFio,
      mergePinnedTurboProjects(
        raw
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .map((item) => turboProjectToRow(item, erpFio))
      ),
      false
    )
    const portfolioHint = String(payload.portfolio_empty_hint || '').trim()
    const pinnedNote =
      !raw.length && projects.length
        ? `Портфель пуст — загружаем pin file_id (${turboPinnedProjectFileIds().join(', ')})`
        : ''
    return {
      projects,
      sourceLabel: ORCH_SOURCE_ID.turboProject,
      turboNoSession: false,
      hint: uniqueErrorJoin(portfolioHint, pinnedNote)
    }
  }

  if (turboStatus && !turboStatus.configured) {
    return {
      projects: await finalizeTurboPortfolioProjects(user, erpFio, mergePinnedTurboProjects([]), true),
      sourceLabel: 'TurboProject: на gateway задайте TURBOPROJECT_API_BASE',
      turboNoSession: true,
      hint: 'На gateway нет TURBOPROJECT_API_BASE — задайте в backend/.env или используйте localhost:7812 с актуальным кодом.'
    }
  }

  const turboErr = turboRes.error || 'недоступно'
  const noSession = isTurboNoSessionError(turboErr)
  return {
    projects: await finalizeTurboPortfolioProjects(
      user,
      erpFio,
      noSession ? [] : mergePinnedTurboProjects([]),
      noSession
    ),
    sourceLabel: turboErr,
    turboNoSession: noSession,
    hint: turboErr
  }
}

export type OrchestratorMailLoad = {
  rows: SpecMailRow[]
  sourceLabel: string
}

export async function loadOrchestratorOutlookMailWeek(
  outlookMailbox: string
): Promise<OrchestratorMailLoad> {
  if (skipOutlookCom()) {
    return {
      rows: [],
      sourceLabel: 'Outlook COM отключён (VITE_SKIP_OUTLOOK_COM)'
    }
  }
  const mailRange = outlookMailWeekRange()
  const outlookMailRes = await fetchOutlookMailForRange(mailRange.dateFrom, mailRange.dateTo, {
    folder: 'All',
    maxResults: 50
  })
  if (outlookMailRes.ok && outlookMailRes.messages.length) {
    return {
      sourceLabel:
        outlookMailRes.source ||
        `${ORCH_SOURCE_ID.outlookMail} (${mailRange.dateFrom}…${mailRange.dateTo}, All)`,
      rows: outlookMailRes.messages.map((item, index) => outlookMessageToMailRow(item, index))
    }
  }
  const mailHint = outlookMailRes.error
    ? `Outlook: ${outlookMailRes.error}`
    : outlookMailbox
      ? `Outlook: ${outlookMailbox}`
      : ORCH_SOURCE_ID.outlookMail
  return {
    rows: [],
    sourceLabel: outlookMailRes.ok
      ? `${ORCH_SOURCE_ID.outlookMail} (${mailRange.dateFrom}…${mailRange.dateTo}, All)`
      : mailHint
  }
}

/** Projects to fetch for «Сегодня → проектные задачи» (pinned file_id first, then by open task count). */
export function pickTurboProjectsForTaskFetch(projects: SpecProjectRow[], max = 5): SpecProjectRow[] {
  const pinned = new Set(turboPinnedProjectFileIds())
  const byId = new Map(projects.map((row) => [row.id, row]))
  const selected: SpecProjectRow[] = []
  for (const id of pinned) {
    const row = byId.get(id)
    if (row) selected.push(row)
  }
  const rest = [...projects]
    .filter((row) => !pinned.has(row.id))
    .sort((left, right) => {
      if (right.tasks !== left.tasks) return right.tasks - left.tasks
      return left.name.localeCompare(right.name, 'ru')
    })
  for (const row of rest) {
    if (selected.length >= max) break
    if (!selected.some((item) => item.id === row.id)) selected.push(row)
  }
  return selected
}

export type OrchestratorTaskSourcesBundle = {
  erp: OrchestratorErpLoad
  turbo: OrchestratorTurboLoad
  mail: OrchestratorMailLoad
}

/** Single fetch entry for SpecV04SourcesProvider (order: ERP SQL → Turbo portfolio → Outlook week). */
export async function fetchOrchestratorTaskSources(
  user: UserProfile,
  erpFio: string,
  outlookMailbox: string
): Promise<OrchestratorTaskSourcesBundle> {
  const [erp, turbo] = await Promise.all([
    loadOrchestratorErpTasks(user, erpFio),
    loadOrchestratorTurboPortfolio(user, erpFio)
  ])
  const mail = await loadOrchestratorOutlookMailWeek(outlookMailbox)
  return { erp, turbo, mail }
}
