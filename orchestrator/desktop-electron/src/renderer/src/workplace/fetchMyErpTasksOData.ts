import { api } from '../api/client'
import type { UserProfile } from '../api/types'
import type { SpecTaskRow } from './specV04DemoData'
import { onecGatewayInvokeArgs } from './userContext'
import { parseErpToolTasks } from './orchestratorTaskSources'

export type FetchMyErpTasksODataResult = {
  ok: boolean
  tasks: SpecTaskRow[]
  count: number
  source: string
  odataEnvPath: string
  odataEnvOk: boolean
  error: string
  raw?: unknown
}

async function loadExternalOdataInvokeArgs(): Promise<{
  invokeArgs: Record<string, string>
  path: string
  ok: boolean
}> {
  const loader = window.api?.loadOdataExternalEnv
  if (typeof loader !== 'function') {
    return { invokeArgs: {}, path: '', ok: false }
  }
  const loaded = await loader()
  return {
    invokeArgs: (loaded.invokeArgs || {}) as Record<string, string>,
    path: loaded.path || '',
    ok: Boolean(loaded.ok)
  }
}

/**
 * OData «мои задачи» через gateway onec.erp_tasks_odata.
 * Учётка OData — из agent-pochta .env (main process), ФИО — из сессии входа.
 */
export async function fetchMyErpTasksOData(
  user: UserProfile | null,
  erpFio: string,
  options: { limit?: number; fallbackSql?: boolean } = {}
): Promise<FetchMyErpTasksODataResult> {
  const limit = options.limit ?? 80
  const fallbackSql = options.fallbackSql ?? true
  const external = await loadExternalOdataInvokeArgs()
  const onecArgs = onecGatewayInvokeArgs(user, {
    limit,
    fallback_sql: fallbackSql,
    ...external.invokeArgs
  })
  const res = await api.invokeServerTool('onec.erp_tasks_odata', onecArgs)
  const parsed = parseErpToolTasks(res, erpFio)
  const payloadObj =
    res.ok && res.result && typeof res.result === 'object'
      ? (res.result as Record<string, unknown>)
      : null
  const odataWarning = String(payloadObj?.odata_warning || '').trim()
  const error = [res.error, parsed.error, odataWarning].filter(Boolean).join(' · ')
  return {
    ok: res.ok,
    tasks: parsed.rows,
    count: parsed.rows.length,
    source: parsed.source || 'erp_pm+odata',
    odataEnvPath: external.path,
    odataEnvOk: external.ok,
    error,
    raw: res.result
  }
}
