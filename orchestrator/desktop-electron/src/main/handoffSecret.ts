import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CODE_RE = /^[A-Za-z0-9_-]{16,128}$/
const MAX_AGE_MS = 3 * 60 * 1000

export type HandoffPassword = {
  login: string
  password: string
}

function handoffDir(): string {
  const root = String(process.env.LOCALAPPDATA || '').trim()
  return root ? join(root, 'constructor-session-handoff') : ''
}

function secretPath(code: string): string {
  const dir = handoffDir()
  if (!dir || !CODE_RE.test(code)) return ''
  return join(dir, `${code}.bin`)
}

function sweepStale(dir: string): void {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  const cutoff = Date.now() - MAX_AGE_MS
  for (const name of names) {
    const path = join(dir, name)
    try {
      if (statSync(path).mtimeMs < cutoff) unlinkSync(path)
    } catch {
      /* ignore a file that disappeared */
    }
  }
}

/** DPAPI CurrentUser: Constructor can decrypt, the password is not on the command line. */
function protectCurrentUser(plain: string): string {
  const script = [
    "$ProgressPreference = 'SilentlyContinue'",
    'Add-Type -AssemblyName System.Security',
    '$plain = [Console]::In.ReadToEnd()',
    '$bytes = [Text.Encoding]::UTF8.GetBytes($plain)',
    '$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Convert]::ToBase64String($protected))'
  ].join('; ')
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: plain,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15000
  })
  return output.replace(/[^A-Za-z0-9+/=]/g, '')
}

export function writeHandoffPassword(code: string, secret: HandoffPassword): void {
  const path = secretPath(code)
  if (!path || !secret.password) return
  const dir = handoffDir()
  mkdirSync(dir, { recursive: true })
  sweepStale(dir)
  const payload = JSON.stringify({
    login: secret.login || '',
    password: secret.password,
    exp: Date.now() + 90_000
  })
  const protectedBlob = protectCurrentUser(payload)
  if (!protectedBlob) return
  writeFileSync(path, protectedBlob, { encoding: 'utf8' })
}

export function handoffCodeFromUrl(url: string): string {
  const match = String(url || '').match(/[?&]code=([A-Za-z0-9_-]{16,128})/)
  return match?.[1] || ''
}

export function removeHandoffPassword(code: string): void {
  const path = secretPath(code)
  if (!path || !existsSync(path)) return
  try {
    unlinkSync(path)
  } catch {
    /* ignore */
  }
}
