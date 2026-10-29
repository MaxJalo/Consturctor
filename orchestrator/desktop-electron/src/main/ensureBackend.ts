import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { resolveWindowsPythonExe, spawnHidden } from './spawnHidden'

export const LOCAL_BACKEND_DEFAULT = 'http://127.0.0.1:7812'

export function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}

export async function pingHealth(
  baseUrl: string,
  timeoutMs = 4000,
  opts?: { erp?: boolean }
): Promise<boolean> {
  const base = baseUrl.replace(/\/+$/, '')
  // Gateway старых выкладок не знает /health/live и отвечает 404: это живой сервер.
  const paths = opts?.erp ? ['/health'] : ['/health/live', '/health']
  for (const path of paths) {
    try {
      const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
      if (response.ok) return true
    } catch (err) {
      // Таймаут на первом пути не отменяет второй: gateway может не знать /health/live.
      if (err instanceof Error && err.name === 'TimeoutError') continue
      return false
    }
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveBackendRoot(): string | null {
  const exeDir = app.isPackaged ? dirname(app.getPath('exe')) : process.cwd()
  const candidates = [
    join(process.cwd(), '..', '..', 'backend'),
    join(process.cwd(), '..', 'backend'),
    join(__dirname, '../../../../backend'),
    join(__dirname, '../../../backend'),
    join(app.getAppPath(), '..', '..', 'backend'),
    join(app.getAppPath(), '..', '..', '..', 'backend'),
    join(exeDir, 'backend'),
    join(process.resourcesPath, 'backend')
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'run_dev.bat')) || existsSync(join(dir, 'app', 'main.py'))) {
      return dir
    }
  }
  return null
}

function bundledPython(): string {
  const bundled = join(process.resourcesPath, 'python', process.platform === 'win32' ? 'python.exe' : 'python')
  if (existsSync(bundled)) return bundled
  return resolveWindowsPythonExe()
}

/** This PC is the LAN gateway: other computers must reach :7812, not only loopback. */
function apiHostForSpawn(): string {
  const gateway = '192.168.1.157'
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && addr.address === gateway) return '0.0.0.0'
    }
  }
  return '127.0.0.1'
}

function spawnLocalBackend(backendRoot: string): void {
  const python = bundledPython()
  const apiHost = apiHostForSpawn()
  const launch = `import runpy, sys; sys.path.insert(0, ${JSON.stringify(backendRoot)}); runpy.run_module('app.main', run_name='__main__')`
  const child = spawnHidden(python, ['-c', launch], {
    cwd: backendRoot,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      API_HOST: apiHost,
      AUTH_SKIP_SESSION_LOCK: process.env.AUTH_SKIP_SESSION_LOCK || '1',
      PYTHONNOUSERSITE: '1'
    }
  })
  child.unref()
  console.log(`Starting local backend on ${apiHost}:7812 (background, no window) from ${backendRoot} via ${python}`)
}

/**
 * Wait until /health responds on the given loopback URL, starting orchestrator/backend if needed.
 */
export async function ensureLocalBackend(backendUrl: string): Promise<boolean> {
  if (await pingHealth(backendUrl)) {
    console.log(`Backend already up: ${backendUrl}`)
    return true
  }
  if (!isLoopback(backendUrl)) {
    console.warn(`Remote backend is not reachable: ${backendUrl}`)
    return false
  }
  const root = resolveBackendRoot()
  if (!root) {
    console.warn('Local backend is down and backend/ folder was not found next to the app')
    return false
  }
  if (process.env.ORCH_NO_BACKEND_SPAWN === '1') {
    const up = await pingHealth(backendUrl, 1500)
    if (!up) {
      console.warn(
        'ORCH_NO_BACKEND_SPAWN=1 — backend not on loopback. Run orchestrator\\backend\\run_dev.bat'
      )
    }
    return up
  }
  spawnLocalBackend(root)
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await pingHealth(backendUrl, 1500)) {
      console.log(`Backend ready: ${backendUrl}`)
      return true
    }
    await sleep(1000)
  }
  console.warn(`Backend did not become ready at ${backendUrl}`)
  return false
}

/**
 * On launch: wait for /health on configured URL; start loopback backend when needed.
 * Admin routes are probed only via authenticated IPC (never unauthenticated /admin/* here).
 */
export async function ensureDesktopBackend(configuredUrl: string): Promise<boolean> {
  const primary = configuredUrl.replace(/\/+$/, '')

  if (isLoopback(primary)) {
    return ensureLocalBackend(primary)
  }

  if (await pingHealth(primary)) {
    console.log(`Backend reachable: ${primary}`)
    return true
  }

  console.warn(`Primary backend unreachable: ${primary}`)
  return ensureLocalBackend(LOCAL_BACKEND_DEFAULT)
}

/** @deprecated use pingHealth */
export const pingBackendHealth = pingHealth

export type ExternalOrderCatalogKind = 'agent' | 'purchase' | 'service'

/**
 * Gateway без маршрутов /agent, /purchase-agent, /service-agents отвечает
 * «Заказ не найден». Каталог читается из той же базы локальным backend.
 */
export function externalOrderAgentCatalog(kind: ExternalOrderCatalogKind): Promise<unknown | null> {
  const root = resolveBackendRoot()
  if (!root) return Promise.resolve(null)
  const python = bundledPython()
  const script = [
    'import json, sys',
    'from app.services.external_service_agents import catalog',
    'print(json.dumps(catalog(sys.argv[1]), ensure_ascii=False))'
  ].join('\n')
  return new Promise((resolve) => {
    execFile(
      python,
      ['-c', script, kind],
      {
        cwd: root,
        windowsHide: true,
        timeout: 25_000,
        maxBuffer: 1_000_000,
        env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONIOENCODING: 'utf-8' }
      },
      (err, stdout) => {
        if (err) {
          console.warn(`External order agent catalog failed (${kind})`)
          resolve(null)
          return
        }
        try {
          resolve(JSON.parse(String(stdout || '')))
        } catch {
          resolve(null)
        }
      }
    )
  })
}

function listeningPids(port: number): Promise<number[]> {
  if (process.platform !== 'win32') return Promise.resolve([])
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`
      ],
      { windowsHide: true, timeout: 8000 },
      (_err, stdout) => {
        const pids = String(stdout || '')
          .split(/\s+/)
          .map((item) => Number(item))
          .filter((item) => Number.isInteger(item) && item > 0)
        resolve([...new Set(pids)])
      }
    )
  })
}

/** Dev only: stop whoever listens on 7812 and start orchestrator/backend again. */
export async function restartDevBackend(): Promise<{ ok: boolean; error?: string }> {
  if (app.isPackaged) {
    return { ok: false, error: 'Перезапуск сервера доступен только в окне разработки' }
  }
  const root = resolveBackendRoot()
  if (!root) return { ok: false, error: 'Папка backend не найдена на этом компьютере' }
  const pids = await listeningPids(7812)
  for (const pid of pids) {
    await new Promise<void>((resolve) => {
      execFile('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true }, () => resolve())
    })
  }
  await sleep(400)
  spawnLocalBackend(root)
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await pingHealth(LOCAL_BACKEND_DEFAULT, 1500)) return { ok: true }
    await sleep(1000)
  }
  return { ok: false, error: 'Сервер не ответил после перезапуска' }
}
