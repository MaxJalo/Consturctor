import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const CODE_RE = /^[A-Za-z0-9_-]{16,128}$/

export type HandoffPassword = {
  login: string
  password: string
}

function secretPath(code: string): string {
  const root = String(process.env.LOCALAPPDATA || '').trim()
  if (!root || !CODE_RE.test(code)) return ''
  return join(root, 'constructor-session-handoff', `${code}.bin`)
}

function unprotectCurrentUser(blob: string): string {
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    'Add-Type -AssemblyName System.Security',
    '$blob = [Console]::In.ReadToEnd().Trim()',
    '$bytes = [Convert]::FromBase64String($blob)',
    '$plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))'
  ].join('; ')
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: blob,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15000
  })
}

/** Read the password Orchestrator left for this handoff, then delete the file. */
export function takeHandoffPassword(code: string): HandoffPassword | null {
  const path = secretPath(code)
  if (!path || !existsSync(path)) return null
  let raw = ''
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  } finally {
    try {
      unlinkSync(path)
    } catch {
      /* the file must not stay on disk */
    }
  }
  try {
    const text = unprotectCurrentUser(raw.replace(/[^A-Za-z0-9+/=]/g, ''))
    const parsed = JSON.parse(text) as { login?: string; password?: string; exp?: number }
    if (!parsed.password) return null
    if (typeof parsed.exp === 'number' && parsed.exp < Date.now()) return null
    return { login: parsed.login || '', password: parsed.password }
  } catch {
    return null
  }
}
