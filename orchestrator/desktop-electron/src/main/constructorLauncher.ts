import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { handoffCodeFromUrl, removeHandoffPassword, writeHandoffPassword, type HandoffPassword } from './handoffSecret'

const HANDOFF_URL = /^constructor:\/\/handoff\?code=[A-Za-z0-9_-]{16,128}$/

export type ConstructorLaunchResult = {
  ok: boolean
  error?: string
}

type LaunchTarget = {
  exe: string
  args: string[]
  cwd?: string
}

function splitCommandLine(command: string): string[] {
  const parts: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(command))) {
    const part = match[1] ?? match[2] ?? ''
    if (part) parts.push(part)
  }
  return parts
}

function registryConstructorCommand(): string {
  if (process.platform !== 'win32') return ''
  try {
    const output = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Classes\\constructor\\shell\\open\\command', '/ve'],
      { windowsHide: true, timeout: 4000 }
    )
    let text = output.toString('utf8')
    if (!text.includes('REG_SZ')) text = output.toString('utf16le')
    const line = text.split(/\r?\n/).find((row) => row.includes('REG_SZ'))
    if (!line) return ''
    return line.slice(line.indexOf('REG_SZ') + 'REG_SZ'.length).trim()
  } catch {
    return ''
  }
}

function targetFromRegistry(url: string): LaunchTarget | null {
  const command = registryConstructorCommand()
  if (!command) return null
  const parts = splitCommandLine(command).map((part) => (part === '%1' ? url : part))
  const exe = parts[0] || ''
  if (!exe || !existsSync(exe)) return null
  const args = parts.slice(1)
  if (!args.includes(url)) args.push(url)
  return { exe, args, cwd: dirname(exe) }
}

function installedConstructorExe(): string {
  const configured = String(process.env.CONSTRUCTOR_DESKTOP_PATH || '').trim()
  const localAppData = String(process.env.LOCALAPPDATA || '').trim()
  const programFiles = String(process.env.ProgramFiles || '').trim()
  const candidates = [
    configured,
    localAppData ? join(localAppData, 'Programs', 'Constructor', 'Constructor.exe') : '',
    programFiles ? join(programFiles, 'Constructor', 'Constructor.exe') : ''
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) || ''
}

function devConstructorTarget(execPath: string, appPath: string): LaunchTarget | null {
  const candidates = [
    join(process.cwd(), '..', '..', 'desktop-electron'),
    join(appPath, '..', '..', 'desktop-electron'),
    join(appPath, '..', '..', '..', 'desktop-electron')
  ]
  for (const dir of candidates) {
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }
      if (pkg.name === 'constructor-desktop-electron') {
        return { exe: execPath, args: [dir], cwd: dir }
      }
    } catch {
      /* ignore a broken manifest */
    }
  }
  return null
}

/** Dev Orchestrator sets this to its own Vite URL. A child Constructor would load that UI. */
function launchEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ELECTRON_RENDERER_URL
  return env
}

function constructorDevDir(appPath: string): string {
  const candidates = [
    join(process.cwd(), '..', '..', 'desktop-electron'),
    join(appPath, '..', '..', 'desktop-electron'),
    join(appPath, '..', '..', '..', 'desktop-electron')
  ]
  for (const dir of candidates) {
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }
      if (pkg.name === 'constructor-desktop-electron') return dir
    } catch {
      /* ignore a broken manifest */
    }
  }
  return ''
}

/** Unpackaged Constructor accepts the local backend and the session handoff. The installed exe ignores both. */
function launchDevConstructor(url: string, appPath: string, backendUrl: string): boolean {
  const dir = constructorDevDir(appPath)
  if (!dir) return false
  const env = launchEnv()
  const backend = backendUrl.trim() || 'http://127.0.0.1:7812'
  env.BACKEND_URL = backend
  env.VITE_BACKEND_URL = backend
  const child = spawn(`npm run dev -- -- ${url}`, {
    cwd: dir,
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    shell: true
  })
  child.unref()
  return true
}

function resolveTarget(url: string, execPath: string, appPath: string, packaged: boolean): LaunchTarget | null {
  const fromRegistry = targetFromRegistry(url)
  if (fromRegistry) return fromRegistry
  const installed = installedConstructorExe()
  if (installed) return { exe: installed, args: [url], cwd: dirname(installed) }
  if (!packaged) {
    const dev = devConstructorTarget(execPath, appPath)
    if (dev) return { exe: dev.exe, args: [...dev.args, url], cwd: dev.cwd }
  }
  return null
}

export function launchConstructorApp(
  rawUrl: string,
  opts: { execPath: string; appPath: string; packaged: boolean },
  secret?: HandoffPassword | null
): ConstructorLaunchResult {
  const url = String(rawUrl || '').trim()
  if (!HANDOFF_URL.test(url)) {
    return { ok: false, error: 'Некорректная ссылка входа в конструктор' }
  }
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Конструктор открывается только в Windows' }
  }
  const backendUrl = String(process.env.BACKEND_URL || 'http://127.0.0.1:7812')
  if (!opts.packaged && launchDevConstructor(url, opts.appPath, backendUrl)) {
    return { ok: true }
  }
  const target = resolveTarget(url, opts.execPath, opts.appPath, opts.packaged)
  if (!target) {
    return {
      ok: false,
      error: 'Конструктор не найден. Установите приложение или запустите его один раз из этой папки.'
    }
  }
  const code = handoffCodeFromUrl(url)
  if (secret?.password && code) {
    try {
      writeHandoffPassword(code, secret)
    } catch {
      removeHandoffPassword(code)
    }
  }
  const child = spawn(target.exe, target.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    cwd: target.cwd,
    env: launchEnv()
  })
  child.unref()
  return { ok: true }
}
