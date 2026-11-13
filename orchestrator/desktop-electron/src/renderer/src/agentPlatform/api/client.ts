import type { ListResponse, PlatformSessionDetail } from './types'

// Адрес локальной платформы агентов: Electron main запускает её на свободном порту.
let base = ''
let resolving: Promise<string> | null = null

export function backendUrl(): string {
  return base
}

export function platformUrl(): Promise<string> {
  if (base) return Promise.resolve(base)
  if (!resolving) {
    resolving = (async () => {
      if (!window.platform?.ensure) throw new Error('Платформа агентов доступна только в приложении Orch_mx')
      const status = await window.platform.ensure()
      if (!status.ok || !status.url) throw new Error(status.error || 'Платформа агентов не запустилась')
      base = status.url.replace(/\/+$/, '')
      return base
    })().finally(() => {
      resolving = null
    })
  }
  return resolving
}

function detailFrom(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail?: unknown }).detail
    if (typeof detail === 'string' && detail.trim()) return detail
  }
  return fallback
}

async function send<T>(url: string, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${url}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await response.text()
  let data: unknown = undefined
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!response.ok) {
    throw new Error(detailFrom(data, text || `HTTP ${response.status}`))
  }
  return data as T
}

export async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await send<T>(await platformUrl(), method, path, body)
  } catch (error) {
    // fetch падает TypeError, когда сервис перезапущен на другом порту или ещё не поднят.
    if (!(error instanceof TypeError)) throw error
    base = ''
    return send<T>(await platformUrl(), method, path, body)
  }
}

export function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>('GET', path)
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>('POST', path, body)
}

export function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>('DELETE', path)
}

export function apiList<T>(path: string): Promise<T[]> {
  return apiGet<ListResponse<T>>(path).then((body) => body.items)
}

/** Потоковая подписка (SSE) на события сессии без задержки поллинга. */
export function streamSession(
  sessionId: string,
  since: number,
  onDetail: (detail: PlatformSessionDetail) => void,
  onError?: (error: Error) => void
): () => void {
  const controller = new AbortController()
  let active = true

  void (async () => {
    try {
      const url = await platformUrl()
      if (!active) return
      const response = await fetch(
        `${url}/api/v1/platform/sessions/${encodeURIComponent(sessionId)}/stream?since=${since}`,
        { signal: controller.signal, headers: { Accept: 'text/event-stream' } }
      )
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (active) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue
            const raw = line.slice(5).trim()
            if (!raw) continue
            try {
              onDetail(JSON.parse(raw) as PlatformSessionDetail)
            } catch {
              /* ignore partial frame */
            }
          }
        }
      }
      if (active && onError) onError(new Error('Stream closed'))
    } catch (error) {
      if (!active || controller.signal.aborted) return
      if (onError) onError(error instanceof Error ? error : new Error(String(error)))
    }
  })()

  return () => {
    active = false
    controller.abort()
  }
}
