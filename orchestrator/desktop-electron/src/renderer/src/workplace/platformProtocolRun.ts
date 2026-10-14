import { useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '../agentPlatform/api/client'
import type {
  AgentApproval,
  AgentQuestion,
  PlatformSession,
  PlatformSessionDetail,
  SessionEvent,
  SessionStatus
} from '../agentPlatform/api/types'

/**
 * Запись протокола в 1С идёт конфигурацией 2 платформы агентов: весь каталог инструментов,
 * встроенные инструменты Cursor и подтверждение действий хуком preToolUse — как у агентов на её странице.
 */

const POLL_MS = 1500

export type PlatformToolStep = {
  id: string
  /** Имя инструмента каталога (onec.meeting_protocol_write) или встроенного (read, shell). */
  tool: string
  done: boolean
  error: boolean
}

export type PlatformRunView = {
  status: SessionStatus | ''
  running: boolean
  error: string
  steps: PlatformToolStep[]
  approval: AgentApproval | null
  question: AgentQuestion | null
  /** Ответ onec.meeting_protocol_write: созданный или обновлённый документ. */
  protocol: { number: string; refKey: string } | null
}

export async function startPlatformProtocolRun(workflowId: string, prompt: string): Promise<string> {
  const created = await apiPost<PlatformSession>(`/api/v1/platform/agents/${encodeURIComponent(workflowId)}/runs`, {
    prompt,
    attachments: []
  })
  if (!created?.id) throw new Error('Платформа агентов не вернула запуск')
  return created.id
}

export async function decidePlatformApproval(sessionId: string, approvalId: string, allow: boolean): Promise<void> {
  await apiPost(
    `/api/v1/platform/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}/decision`,
    { allow, remember: false }
  )
}

export async function cancelPlatformRun(sessionId: string): Promise<void> {
  await apiPost(`/api/v1/platform/sessions/${encodeURIComponent(sessionId)}/cancel`, {})
}

function parseJson(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function toolName(event: SessionEvent): string {
  if (event.name !== 'mcp') return event.name
  const raw = String(asObject(parseJson(event.args)).toolName || '')
  return raw.replace(/^(custom-user-tools|turbotester|constructor)[-_.]+/i, '').replaceAll('__', '.')
}

/** Текст ответа MCP-инструмента из превью результата, которое пишет раннер. */
function resultText(event: SessionEvent): string {
  const result = asObject(parseJson(event.result))
  const value = asObject(result.value)
  if (value.isError === true) return ''
  const content = Array.isArray(value.content) ? value.content : []
  return content
    .map((item) => {
      const text = asObject(item).text
      return typeof text === 'string' ? text : ''
    })
    .join('\n')
}

function failed(event: SessionEvent): boolean {
  if (event.status === 'error') return true
  const result = asObject(parseJson(event.result))
  return result.status === 'error' || asObject(result.value).isError === true
}

function protocolFrom(event: SessionEvent): { number: string; refKey: string } | null {
  const text = resultText(event)
  if (!text) return null
  const body = asObject(parseJson(text))
  let number = String(body.number || '').trim()
  let refKey = String(body.ref_key || body.erp_document_id || '').trim()
  if (!number && !refKey) {
    number = /"number"\s*:\s*"([^"]+)"/.exec(text)?.[1]?.trim() || ''
    refKey = /"ref_key"\s*:\s*"([^"]+)"/.exec(text)?.[1]?.trim() || ''
  }
  return number || refKey ? { number, refKey } : null
}

export function usePlatformRun(sessionId: string): PlatformRunView {
  const [session, setSession] = useState<PlatformSession | null>(null)
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [approval, setApproval] = useState<AgentApproval | null>(null)
  const [question, setQuestion] = useState<AgentQuestion | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    setSession(null)
    setEvents([])
    setApproval(null)
    setQuestion(null)
    setLoadError('')
    if (!sessionId) return
    let alive = true
    let since = 0
    let timer = 0
    const bySeq = new Map<number, SessionEvent>()
    const tick = async (): Promise<void> => {
      try {
        const detail = await apiGet<PlatformSessionDetail>(
          `/api/v1/platform/sessions/${encodeURIComponent(sessionId)}?since=${since}`
        )
        if (!alive) return
        for (const event of detail.events) bySeq.set(event.seq, event)
        since = Math.max(since, detail.session.rev)
        setSession(detail.session)
        if (detail.events.length) setEvents([...bySeq.values()].sort((a, b) => a.seq - b.seq))
        setApproval(detail.approval ?? null)
        setQuestion(detail.question ?? null)
        setLoadError('')
        if (detail.session.status !== 'running') return
      } catch (reason) {
        if (!alive) return
        setLoadError(reason instanceof Error ? reason.message : 'Платформа агентов недоступна')
      }
      timer = window.setTimeout(() => void tick(), POLL_MS)
    }
    void tick()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [sessionId])

  return useMemo(() => {
    const steps: PlatformToolStep[] = []
    let protocol: PlatformRunView['protocol'] = null
    for (const event of events) {
      if (event.type !== 'tool' || event.parent) continue
      const tool = toolName(event)
      const error = failed(event)
      const done = event.status !== '' && event.status !== 'running'
      steps.push({ id: `${event.seq}`, tool, done, error })
      if (tool === 'onec.meeting_protocol_write' && done && !error) protocol = protocolFrom(event) ?? protocol
    }
    const status = session?.status ?? ''
    return {
      status,
      running: Boolean(sessionId) && (!session || status === 'running'),
      error: session?.error || (status === 'error' ? 'Запуск завершился с ошибкой' : '') || loadError,
      steps,
      approval,
      question,
      protocol
    }
  }, [approval, events, loadError, question, session, sessionId])
}
