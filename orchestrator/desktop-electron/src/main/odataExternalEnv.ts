import { existsSync, readFileSync } from 'node:fs'

/**
 * OData credentials for erp_pm (agent-pochta), not committed to git.
 * Override: ORCH_ODATA_ENV_PATH (process env or desktop .env).
 * Default: …/agent-pochta/.env next to «Входящая корреспонденция» on Desktop.
 */
export const DEFAULT_ORCH_ODATA_ENV_PATH =
  'C:\\Users\\mdj\\Desktop\\рабочее\\Входящая корреспонденция\\2. Входящая корреспонденция\\agent-pochta\\.env'

export function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(path)) return out
  const text = readFileSync(path, 'utf-8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

export function resolveOdataEnvPath(extraEnv: Record<string, string> = {}): string {
  const fromProcess = (process.env.ORCH_ODATA_ENV_PATH || '').trim()
  if (fromProcess) return fromProcess
  const fromFile = (extraEnv.ORCH_ODATA_ENV_PATH || '').trim()
  if (fromFile) return fromFile
  return DEFAULT_ORCH_ODATA_ENV_PATH
}

/** Map agent-pochta .env keys → onec.erp_tasks_odata invoke args (no secrets in logs). */
export function mapOdataEnvToInvokeArgs(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  const base = (env.ODATA_BASE_URL || '').trim()
  if (base) out.odata_base_url = base
  const username = (env.ODATA_USERNAME || env.ERP_LOGIN || '').trim()
  const password = (env.ODATA_PASSWORD || env.ERP_PASSWORD || '').trim()
  if (username) out.odata_username = username
  if (password) out.odata_password = password
  return out
}

export type LoadedOdataExternalEnv = {
  ok: boolean
  path: string
  missing: string[]
  invokeArgs: Record<string, string>
}

export function loadExternalOdataEnv(extraEnv: Record<string, string> = {}): LoadedOdataExternalEnv {
  const path = resolveOdataEnvPath(extraEnv)
  if (!existsSync(path)) {
    return {
      ok: false,
      path,
      missing: ['file'],
      invokeArgs: {}
    }
  }
  const parsed = parseEnvFile(path)
  const invokeArgs = mapOdataEnvToInvokeArgs(parsed)
  const missing: string[] = []
  if (!invokeArgs.odata_base_url) missing.push('ODATA_BASE_URL')
  if (!invokeArgs.odata_username) missing.push('ODATA_USERNAME|ERP_LOGIN')
  if (!invokeArgs.odata_password) missing.push('ODATA_PASSWORD|ERP_PASSWORD')
  const ok = missing.length === 0
  if (!ok) {
    console.log(
      `[orch] OData env ${path}: incomplete (${missing.join(', ')}); backend .env may still apply`
    )
  } else {
    console.log(`[orch] OData env loaded from ${path} (ODATA_BASE_URL + credentials)`)
  }
  return { ok, path, missing, invokeArgs }
}
