import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

export const LOCAL_BACKEND_DEFAULT = 'http://127.0.0.1:7812'

export function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}

export async function pingHealth(baseUrl: string, timeoutMs = 3000): Promise<boolean> {
  const url = `${baseUrl.replace(/\/+$/, '')}/health`
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok
  } catch {
    return false
  }
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

function spawnLocalBackend(backendRoot: string): void {
  const bat = join(backendRoot, 'run_dev.bat')
  const child = existsSync(bat)
    ? spawn('cmd.exe', ['/c', bat], {
        cwd: backendRoot,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env }
      })
    : spawn('py', ['-3.12', '-m', 'app.main'], {
        cwd: backendRoot,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env }
      })
  child.unref()
  console.log(`Starting local backend from ${backendRoot}`)
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
  spawnLocalBackend(root)
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    if (await pingHealth(backendUrl, 2000)) {
      console.log(`Backend ready: ${backendUrl}`)
      return true
    }
    await sleep(400)
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
