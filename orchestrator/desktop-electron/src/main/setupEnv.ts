import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type SetupField = {
  key: string
  label: string
  group: string
  value: string
  secret: boolean
  secretUrl: boolean
  hasSecret: boolean
}

export type SetupFile = {
  path: string
  fields: SetupField[]
}

type FieldSpec = {
  key: string
  label: string
  group: string
  secret?: boolean
  secretUrl?: boolean
}

const DESKTOP_FIELDS: FieldSpec[] = [
  { key: 'BACKEND_URL', label: 'Адрес сервера', group: 'Сервер' },
  { key: 'ONEC_COM_SERVER', label: 'Сервер 1С', group: '1С на этом компьютере' },
  { key: 'ONEC_COM_REF', label: 'База', group: '1С на этом компьютере' },
  { key: 'ONEC_COM_PROGID', label: 'ProgID', group: '1С на этом компьютере' },
  { key: 'ERP_LOGIN', label: 'Логин', group: '1С на этом компьютере' },
  { key: 'ERP_PASSWORD', label: 'Пароль', group: '1С на этом компьютере', secret: true },
  { key: 'LM_STUDIO_BASE_URL', label: 'Адрес модели', group: 'Модель' },
  { key: 'LM_STUDIO_MODEL', label: 'Модель', group: 'Модель' },
  { key: 'UPDATE_GITHUB_OWNER', label: 'Владелец', group: 'Обновления' },
  { key: 'UPDATE_GITHUB_REPO', label: 'Репозиторий', group: 'Обновления' },
  { key: 'UPDATE_GITHUB_TOKEN', label: 'Ключ GitHub', group: 'Обновления', secret: true },
  { key: 'CURSOR_API_KEY', label: 'Ключ Cursor', group: 'Ключ помощника', secret: true },
  { key: 'CURSOR_API_BASE_URL', label: 'Адрес Cursor', group: 'Ключ помощника' }
]

const BACKEND_FIELDS: FieldSpec[] = [
  { key: 'API_HOST', label: 'Адрес API', group: 'Порт и база' },
  { key: 'API_PORT', label: 'Порт', group: 'Порт и база' },
  { key: 'DATABASE_URL', label: 'База приложения', group: 'Порт и база', secretUrl: true },
  { key: 'REDIS_URL', label: 'Redis', group: 'Порт и база', secretUrl: true },
  { key: 'RABBITMQ_URL', label: 'RabbitMQ', group: 'Порт и база', secretUrl: true },
  { key: 'IMAP_HOST', label: 'IMAP сервер', group: 'Почта на сервере' },
  { key: 'IMAP_PORT', label: 'IMAP порт', group: 'Почта на сервере' },
  { key: 'IMAP_USERNAME', label: 'IMAP логин', group: 'Почта на сервере' },
  { key: 'IMAP_PASSWORD', label: 'IMAP пароль', group: 'Почта на сервере', secret: true },
  { key: 'IMAP_MAILBOX', label: 'Папка', group: 'Почта на сервере' },
  { key: 'OUTLOOK_EMAIL', label: 'Exchange ящик', group: 'Почта на сервере' },
  { key: 'OUTLOOK_PASSWORD', label: 'Exchange пароль', group: 'Почта на сервере', secret: true },
  { key: 'OUTLOOK_SERVER', label: 'Exchange сервер', group: 'Почта на сервере' },
  { key: 'OUTLOOK_MAILBOX', label: 'Календарь Exchange', group: 'Почта на сервере' },
  { key: 'ODATA_BASE_URL', label: 'OData', group: '1С на сервере' },
  { key: 'ODATA_USERNAME', label: 'OData логин', group: '1С на сервере' },
  { key: 'ODATA_PASSWORD', label: 'OData пароль', group: '1С на сервере', secret: true },
  { key: 'DOK_HTTP_SERVER', label: 'SOAP сервер', group: '1С на сервере' },
  { key: 'DOK_HTTP_PORT', label: 'SOAP порт', group: '1С на сервере' },
  { key: 'DOK_HTTP_USER', label: 'SOAP логин', group: '1С на сервере' },
  { key: 'DOK_HTTP_PASSWORD', label: 'SOAP пароль', group: '1С на сервере', secret: true },
  { key: 'AUTH_ERP_GATEWAY_URL', label: 'Шлюз входа', group: '1С на сервере' },
  { key: 'LLM_PROVIDER', label: 'Провайдер', group: 'Ключи моделей' },
  { key: 'CURSOR_API_KEY', label: 'Ключ Cursor', group: 'Ключи моделей', secret: true },
  { key: 'CURSOR_API_BASE_URL', label: 'Адрес Cursor', group: 'Ключи моделей' },
  { key: 'CURSOR_REGULATION_MODEL', label: 'Модель регламентов', group: 'Ключи моделей' },
  { key: 'CURSOR_WORKFLOW_MODEL', label: 'Модель агентов', group: 'Ключи моделей' },
  { key: 'CLAUDE_API_KEY', label: 'Ключ Claude', group: 'Ключи моделей', secret: true },
  { key: 'CLAUDEHUB_BASE_URL', label: 'Адрес Claude', group: 'Ключи моделей' },
  { key: 'CLAUDEHUB_MODEL', label: 'Модель Claude', group: 'Ключи моделей' },
  { key: 'CHAD_AI', label: 'Ключ Chad', group: 'Ключи моделей', secret: true }
]

export function desktopEnvPaths(desktopRoot: string): string[] {
  if (!app.isPackaged && desktopRoot) return [join(desktopRoot, '.env')]
  const paths = [join(app.getPath('userData'), '.env')]
  if (desktopRoot) {
    const local = join(desktopRoot, '.env')
    if (!paths.includes(local)) paths.push(local)
  }
  return paths
}

export function backendEnvPath(desktopRoot: string): string {
  if (app.isPackaged) return ''
  const candidates = [
    desktopRoot ? join(desktopRoot, '..', 'backend', '.env') : '',
    join(process.cwd(), '..', '..', 'backend', '.env'),
    join(process.cwd(), '..', 'backend', '.env')
  ].filter(Boolean)
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return ''
}

export function readSetupFile(path: string, specs: FieldSpec[]): SetupFile {
  const parsed = parseEnvText(readEnvText(path))
  return {
    path,
    fields: specs.map((spec) => presentField(spec, parsed[spec.key] || ''))
  }
}

export function readDesktopSetup(desktopRoot: string): SetupFile {
  const path = desktopEnvPaths(desktopRoot)[0] || ''
  return readSetupFile(path, DESKTOP_FIELDS)
}

export function readBackendSetup(desktopRoot: string): SetupFile | null {
  const path = backendEnvPath(desktopRoot)
  if (!path) return null
  return readSetupFile(path, BACKEND_FIELDS)
}

export function writeSetupValues(
  path: string,
  specs: FieldSpec[],
  incoming: Record<string, string>
): { ok: boolean; error?: string } {
  if (!path) return { ok: false, error: 'Файл env не найден' }
  const originalText = readEnvText(path)
  const original = parseEnvText(originalText)
  const updates: Record<string, string> = {}
  for (const spec of specs) {
    if (!Object.prototype.hasOwnProperty.call(incoming, spec.key)) continue
    const raw = String(incoming[spec.key] ?? '')
    const previous = original[spec.key] || ''
    if (spec.secret) {
      if (!raw.trim()) continue
      updates[spec.key] = raw
      continue
    }
    if (spec.secretUrl) {
      if (!raw.trim()) continue
      updates[spec.key] = restoreSecretUrl(raw.trim(), previous)
      continue
    }
    updates[spec.key] = raw.trim()
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, applyEnvUpdates(originalText, updates), 'utf-8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Не удалось записать env' }
  }
}

export function writeDesktopSetup(
  desktopRoot: string,
  incoming: Record<string, string>
): { ok: boolean; paths: string[]; error?: string } {
  const paths = desktopEnvPaths(desktopRoot)
  const written: string[] = []
  const errors: string[] = []
  for (const path of paths) {
    const result = writeSetupValues(path, DESKTOP_FIELDS, incoming)
    if (result.ok) written.push(path)
    else if (result.error) errors.push(result.error)
  }
  if (!written.length) return { ok: false, paths: [], error: errors[0] || 'Не удалось записать env' }
  return { ok: true, paths: written }
}

export function writeBackendSetup(
  desktopRoot: string,
  incoming: Record<string, string>
): { ok: boolean; path: string; error?: string } {
  const path = backendEnvPath(desktopRoot)
  if (!path) return { ok: false, path: '', error: 'backend/.env на этом компьютере нет' }
  const result = writeSetupValues(path, BACKEND_FIELDS, incoming)
  return { ok: result.ok, path, error: result.error }
}

function presentField(spec: FieldSpec, raw: string): SetupField {
  const value = raw.trim()
  if (spec.secret) {
    return { ...spec, secret: true, secretUrl: false, value: '', hasSecret: Boolean(value) }
  }
  if (spec.secretUrl) {
    return {
      ...spec,
      secret: false,
      secretUrl: true,
      value: maskSecretUrl(value),
      hasSecret: Boolean(value)
    }
  }
  return { ...spec, secret: false, secretUrl: false, value, hasSecret: false }
}

function maskSecretUrl(value: string): string {
  return value.replace(/^([a-z][a-z0-9+.-]*:\/\/)([^:/@]+):([^@]+)@/i, '$1$2:***@')
}

function restoreSecretUrl(edited: string, original: string): string {
  if (!edited.includes(':***@')) return edited
  const match = original.match(/^[a-z][a-z0-9+.-]*:\/\/[^:/@]+:([^@]+)@/i)
  if (!match) return edited
  return edited.replace(':***@', `:${match[1]}@`)
}

function readEnvText(path: string): string {
  if (!path || !existsSync(path)) return ''
  const bytes = readFileSync(path)
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString('utf8')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1251').decode(bytes)
  }
}

function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {}
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

function formatEnvValue(value: string): string {
  if (/[\s#"']/.test(value)) return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return value
}

function applyEnvUpdates(text: string, updates: Record<string, string>): string {
  const keys = new Set(Object.keys(updates))
  const seen = new Set<string>()
  const lines = text.split(/\r?\n/)
  const next = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return line
    const eq = trimmed.indexOf('=')
    const key = trimmed.slice(0, eq).trim()
    if (!keys.has(key)) return line
    seen.add(key)
    return `${key}=${formatEnvValue(updates[key] ?? '')}`
  })
  const missing = [...keys].filter((key) => !seen.has(key))
  if (missing.length) {
    if (next.length && next[next.length - 1] !== '') next.push('')
    for (const key of missing) next.push(`${key}=${formatEnvValue(updates[key] ?? '')}`)
  }
  const body = next.join('\n')
  return body.endsWith('\n') || body === '' ? `\uFEFF${body}` : `\uFEFF${body}\n`
}
