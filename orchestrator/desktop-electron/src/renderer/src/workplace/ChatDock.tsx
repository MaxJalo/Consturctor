import { Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { PAGE_LABELS, type PageKey } from '../components/Sidebar'
import { MarkdownBody } from '../components/agentfeed/MarkdownBody'
import type { FeedItem } from '../components/agentfeed/types'
import { openWorkplaceTab } from './workplaceNav'
import { useRuns } from '../store/runs'
import { personalAgentWorkflowId } from './personalAgent'
import {
  agentPrompt,
  assistantGreeting,
  pageLinks,
  readableChatText,
  replyToAssistant,
  takeMarkers,
  type AssistantAction
} from './pageAssistant'

interface ChatDockProps {
  userId: string
  pageKey: PageKey | null
  onNavigate: (key: PageKey) => void
  onOpenSupport: () => void
}

type ChatLine = {
  id: string
  role: 'user' | 'assistant'
  text: string
  pending?: boolean
  thinking?: boolean
  error?: boolean
  actions?: AssistantAction[]
}

const EMPTY_ANSWER = 'Агент ничего не ответил. Повторите вопрос или назовите раздел, который открыть.'

function mergeActions(primary: AssistantAction[], extra: AssistantAction[]): AssistantAction[] {
  const seen = new Set<string>()
  const out: AssistantAction[] = []
  for (const action of [...primary, ...extra]) {
    const key = action.type === 'navigate' ? `nav:${action.key}` : `url:${action.url}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(action)
  }
  return out
}

/** Текст только текущего вопроса, начиная с items[from]. Прошлый ответ сюда не входит. */
function currentTurn(items: FeedItem[], from: number): { text: string; thinking: boolean } {
  const slice = items.slice(Math.max(0, from))
  let text = ''
  let thinking = true
  for (const item of slice) {
    if (item.kind === 'message' && item.role === 'user') continue
    if (item.kind === 'message' && item.role === 'agent') {
      text = item.text
      thinking = false
    } else if (item.kind === 'result') {
      text = item.text || text
      thinking = false
    } else if (item.kind === 'thinking' || item.kind === 'tool') {
      thinking = true
    }
  }
  return { text: text.trim(), thinking }
}

function lineId(): string {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function openInBrowser(url: string): void {
  window.open(url, '_blank', 'noopener')
}

function applyActions(actions: AssistantAction[]): void {
  for (const action of actions) {
    if (action.type === 'navigate') openWorkplaceTab(action.key, action.intent)
    else openInBrowser(action.url)
  }
}

export function ChatDock({ userId, pageKey, onOpenSupport }: ChatDockProps): React.JSX.Element {
  const runs = useRuns()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'orch' | 'support'>('orch')
  const [draft, setDraft] = useState('')
  const [lines, setLines] = useState<ChatLine[]>([])
  const [awaitingRun, setAwaitingRun] = useState('')
  const logRef = useRef<HTMLDivElement | null>(null)
  const greeted = useRef(false)
  const consumedRun = useRef('')
  const liveId = useRef('')
  const turnFrom = useRef(0)
  const sawRunning = useRef(false)
  const workflowId = personalAgentWorkflowId(userId)
  const run = runs.getRun(workflowId)
  const pending = run?.state.pendingQuestion

  useEffect(() => {
    if (!open || greeted.current) return
    greeted.current = true
    setLines([{ id: lineId(), role: 'assistant', text: assistantGreeting(pageKey) }])
  }, [open, pageKey])

  useEffect(() => {
    const box = logRef.current
    if (!box) return
    box.scrollTop = box.scrollHeight
  }, [lines, awaitingRun, pending])

  useEffect(() => {
    const id = liveId.current
    if (!awaitingRun || !id || consumedRun.current === awaitingRun) return
    const state = runs.getRun(workflowId)?.state
    if (!state) return
    const sameRun = !state.activeRunId || state.activeRunId === awaitingRun
    if (!sameRun) return
    const turn = currentTurn(state.items, turnFrom.current)
    const errorItem = [...state.items.slice(turnFrom.current)].reverse().find((item) => item.kind === 'system' && item.tone === 'error')
    if (state.running) sawRunning.current = true
    if (!state.running && !sawRunning.current && state.items.length > turnFrom.current) sawRunning.current = true
    const thinking = turn.thinking || !turn.text
    if (state.running || !sawRunning.current) {
      setLines((prev) => {
        const line = prev.find((item) => item.id === id)
        if (!line || (line.text === turn.text && line.thinking === thinking && line.pending)) return prev
        return prev.map((item) =>
          item.id === id ? { ...item, text: turn.text, thinking, pending: true, error: false } : item
        )
      })
      return
    }
    consumedRun.current = awaitingRun
    sawRunning.current = false
    setAwaitingRun('')
    const raw = turn.text || state.error || errorItem?.text || ''
    if (!raw.trim()) {
      setLines((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, text: EMPTY_ANSWER, pending: false, thinking: false, error: true, actions: [] } : item
        )
      )
      return
    }
    const parsed = takeMarkers(raw)
    const actions = mergeActions(parsed.actions, pageLinks(parsed.text))
    setLines((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, text: parsed.text, pending: false, thinking: false, error: false, actions }
          : item
      )
    )
    applyActions(parsed.actions)
  }, [awaitingRun, runs, workflowId, run?.state.running, run?.state.items, run?.state.error])

  function pushAssistant(text: string, actions: AssistantAction[]): void {
    setLines((prev) => [...prev, { id: lineId(), role: 'assistant', text, actions }])
    applyActions(actions)
  }

  function beginWait(runId: string, from: number): void {
    const id = lineId()
    liveId.current = id
    turnFrom.current = from
    sawRunning.current = false
    consumedRun.current = ''
    setLines((prev) => [...prev, { id, role: 'assistant', text: '', pending: true, thinking: true }])
    setAwaitingRun(runId)
  }

  function send(text: string): void {
    const userLine: ChatLine = { id: lineId(), role: 'user', text }
    if (tab === 'support') {
      setLines((prev) => [...prev, userLine])
      onOpenSupport()
      return
    }
    setLines((prev) => [...prev, userLine])
    if (pending?.requestId) {
      const from = run?.state.items.length || 0
      runs.answer(workflowId, pending.requestId, text)
      beginWait(run?.state.activeRunId || awaitingRun || 'answer', from)
      return
    }
    const local = replyToAssistant(text, pageKey)
    if (!local.askAgent) {
      pushAssistant(local.text, mergeActions(local.actions, pageLinks(local.text)))
      return
    }
    if (run?.state.running) {
      pushAssistant('Помощник ещё отвечает на предыдущий вопрос. Дождитесь этой реплики — она останется на месте.', [])
      return
    }
    const runId = runs.startRun({
      workflowId,
      title: 'Помощник',
      message: agentPrompt(text, pageKey),
      shownMessage: text,
      appContext: assistantGreeting(pageKey),
      source: 'chat'
    })
    if (!runId) {
      pushAssistant('Помощник сейчас занят. Повторите вопрос через несколько секунд.', [])
      return
    }
    beginWait(runId, (run?.state.items.length || 0) + 1)
  }

  return (
    <div className="chat-dock">
      {open && (
        <div className="chat-dock-panel is-assistant" role="dialog" aria-label="Помощник">
          <div className="chat-dock-tabs">
            <button
              type="button"
              className={`chat-dock-tab${tab === 'orch' ? ' is-active' : ''}`}
              onClick={() => setTab('orch')}
            >
              Оркестратор
            </button>
            <button
              type="button"
              className={`chat-dock-tab${tab === 'support' ? ' is-active' : ''}`}
              onClick={() => setTab('support')}
            >
              Поддержка
            </button>
          </div>
          <div className="chat-dock-log" ref={logRef}>
            {lines.map((line) =>
              line.role === 'assistant' ? (
                <div key={line.id} className={`chat-dock-line is-assistant${line.error ? ' is-error' : ''}`}>
                  {line.error ? <p className="chat-dock-error">{line.text}</p> : null}
                  {!line.error && line.text ? <MarkdownBody text={readableChatText(line.text)} /> : null}
                  {line.pending && line.thinking ? <p className="chat-dock-thinking">Думает</p> : null}
                  {line.actions?.length ? (
                    <div className="chat-dock-links">
                      {line.actions.map((action) => (
                        <button
                          key={action.type === 'navigate' ? action.key : action.url}
                          type="button"
                          className="chat-dock-link"
                          onClick={() => applyActions([action])}
                        >
                          {action.type === 'navigate' ? `Открыть «${PAGE_LABELS[action.key]}»` : 'Открыть ссылку'}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p key={line.id} className={`chat-dock-line is-${line.role}`}>
                  {line.text}
                </p>
              )
            )}
            {pending?.question ? (
              <div className="chat-dock-line is-assistant">
                <MarkdownBody text={readableChatText(pending.question)} />
              </div>
            ) : null}
          </div>
          <form
            className="chat-dock-form"
            onSubmit={(event) => {
              event.preventDefault()
              const text = draft.trim()
              if (!text) return
              setDraft('')
              send(text)
            }}
          >
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Введите сообщение"
              autoComplete="off"
            />
            <button type="submit" className="messenger-send-btn" title="Отправить" disabled={!draft.trim()}>
              <Send size={16} aria-hidden />
            </button>
          </form>
        </div>
      )}
      <button type="button" className="chat-dock-btn" onClick={() => setOpen((value) => !value)}>
        Чат
      </button>
    </div>
  )
}
