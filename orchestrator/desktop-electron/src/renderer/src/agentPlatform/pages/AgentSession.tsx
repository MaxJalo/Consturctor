import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { AtSign, CornerDownRight, X, Zap } from 'lucide-react'
import { api } from '../../api/client'
import type { ExternalOrderBrief } from '../../extensions/externalOrder/externalOrderTypes'
import type { PageKey } from '../../components/Sidebar'
import { apiDelete, apiGet, apiPost, streamSession } from '../api/client'
import type {
  AgentApproval,
  AgentMode,
  AgentQuestion,
  ModelSpec,
  PlatformConfig,
  PlatformSession,
  PlatformSessionDetail,
  SessionEvent,
  SkillSpec
} from '../api/types'
import {
  ArrowUpIcon,
  BotIcon,
  ChecklistIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  PaperclipIcon,
  PlayIcon,
  PlusIcon,
  StopIcon
} from '../components/Icons'
import { MarkdownView } from '../components/MarkdownView'
import { SESSION_STATUS } from '../platformLabels'
import {
  ExploreGroup,
  SubagentMeta,
  ToolCard,
  isExploreEvent,
  isHiddenTool,
  isQuestionEvent,
  isWaitingQuestion,
  readSubagent,
  type SubagentLink
} from './SessionTools'
import { QuestionForm } from './SessionQuestion'
import { ApprovalForm, ApprovalLine } from './SessionApproval'
import { ProgressBar } from './SessionProgress'
import {
  ComposerFiles,
  MAX_FILES,
  MessageFiles,
  pendingFrom,
  toUpload,
  type PendingFile
} from './SessionAttachments'
import { OrderSidePane } from './OrderSidePane'
import {
  buildMentionItems,
  extractMentionContext,
  gapsFromSessionEvents,
  orderStartActions,
  type MentionItem,
  type OrderStartAction,
  type UnifiedChatTarget
} from './sessionHelpers'

export type AgentWorkspace =
  | { kind: 'create'; configId: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'chat'; chat: UnifiedChatTarget }

const FALLBACK_POLL_MS = 3500
const MAX_INPUT_HEIGHT = 240
const LONG_INSTRUCTION = 700
const STICK_TO_BOTTOM_PX = 80
const QUESTION_GRACE_MS = 4000
const MODEL_PREFS_KEY = 'orchestrator.agentPlatform.modelPrefs'
const DEFAULT_MODEL = 'grok-4.7'
const DEFAULT_EFFORT = 'high'

interface ModelPrefs {
  model: string
  effort: string
  fast: boolean
}

function normalizeMode(mode: string | null | undefined): AgentMode {
  if ((mode || '').toLowerCase() === 'chat' || (mode || '').toLowerCase() === 'plan') return 'chat'
  return 'agent'
}

interface AgentSessionProps {
  target: AgentWorkspace
  configs: PlatformConfig[]
  onBack: () => void
  backLabel?: string
  onOpened: (sessionId: string) => void
  showProgress: boolean
  onShowProgress: (show: boolean) => void
  variant?: 'full' | 'compact' | 'dialog'
  onNavigate?: (key: PageKey) => void
}

// Скрытый ход работы: сообщения человека, вопросы, разрешения, план, ошибки и итоговый
// текст каждого завершённого хода. Пока ход ещё идёт, его реплики и размышления остаются
// на экране — иначе виден только список разрешённых команд.
function resultsOnly(visible: SessionEvent[], running: boolean): SessionEvent[] {
  const lastTurn = visible.reduce((max, event) => Math.max(max, event.turn), 0)
  const finalText = new Map<number, number>()
  for (const event of visible) if (event.type === 'assistant' && event.text.trim()) finalText.set(event.turn, event.seq)
  const liveTurn = (event: SessionEvent): boolean => running && event.turn === lastTurn
  return visible.filter((event) => {
    if (event.type === 'assistant') {
      if (!event.text.trim()) return false
      if (liveTurn(event)) return true
      return finalText.get(event.turn) === event.seq
    }
    if (event.type === 'tool') return isQuestionEvent(event)
    if (event.type === 'thinking') return liveTurn(event)
    return true
  })
}

type FeedBlock = { kind: 'event'; event: SessionEvent } | { kind: 'explore'; items: SessionEvent[] }

function buildBlocks(visible: SessionEvent[]): FeedBlock[] {
  const lastTodos = new Map<number, number>()
  for (const event of visible) {
    if (event.type === 'tool' && event.name === 'updateTodos') lastTodos.set(event.turn, event.seq)
  }
  const blocks: FeedBlock[] = []
  let group: SessionEvent[] | null = null
  let pending: SessionEvent[] = []
  const close = (): void => {
    if (group) blocks.push({ kind: 'explore', items: group })
    for (const event of pending) blocks.push({ kind: 'event', event })
    group = null
    pending = []
  }
  for (const event of visible) {
    if (event.type === 'tool' && event.name === 'updateTodos' && lastTodos.get(event.turn) !== event.seq) continue
    if (event.type === 'tool' && (event.name === 'createPlan' || isHiddenTool(event))) continue
    if (event.type === 'tool' && isExploreEvent(event)) {
      if (group && group[0].turn === event.turn) {
        group.push(...pending, event)
        pending = []
      } else {
        close()
        group = [event]
      }
    } else if (event.type === 'thinking' && group) {
      pending.push(event)
    } else {
      close()
      blocks.push({ kind: 'event', event })
    }
  }
  close()
  return blocks
}

function Feed({
  sessionId,
  events,
  progress,
  running,
  footer,
  subagents,
  onNavigate
}: {
  sessionId: string
  events: SessionEvent[]
  progress: boolean
  running: boolean
  footer?: ReactNode
  subagents?: SubagentLink
  onNavigate?: (key: PageKey) => void
}): React.JSX.Element {
  const all = events.filter((event) => event.type !== 'status')
  const visible = progress ? all : resultsOnly(all, running)
  const last = visible[visible.length - 1]

  return (
    <div className="sess-feed">
      {buildBlocks(visible).map((block) => {
        if (block.kind === 'explore') {
          return (
            <ExploreGroup
              key={`g${block.items[0].seq}`}
              items={block.items}
              active={running}
              live={running && block.items.includes(last)}
            />
          )
        }
        const event = block.event
        if (event.type === 'user') {
          const isInstruction = event.turn === 1
          const label = event.label || (isInstruction ? 'Инструкция' : '')
          if (label && event.text.length > LONG_INSTRUCTION) {
            return (
              <details key={event.seq} className="sess-instruction">
                <summary>
                  <span>
                    {event.label || 'Инструкция агента'}
                    {event.attachments?.length ? ` · вложений: ${event.attachments.length}` : ''}
                  </span>
                  <ChevronDownIcon size={14} />
                </summary>
                {event.attachments?.length ? <MessageFiles sessionId={sessionId} files={event.attachments} /> : null}
                <MarkdownView text={event.text} onNavigate={onNavigate} />
              </details>
            )
          }
          return (
            <div key={event.seq} className="sess-user">
              {label ? <span className="sess-user-label">{label}</span> : null}
              {event.attachments?.length ? <MessageFiles sessionId={sessionId} files={event.attachments} /> : null}
              {event.text ? <p>{event.text}</p> : null}
            </div>
          )
        }
        if (event.type === 'thinking') {
          const live = running && event === last
          return (
            <details key={event.seq} className={live ? 'sess-thinking live' : 'sess-thinking'} open={live}>
              <summary>{live ? 'Размышляет…' : 'Размышления'}</summary>
              <p>{event.text}</p>
            </details>
          )
        }
        if (event.type === 'tool') return <ToolCard key={event.seq} event={event} active={running} subagents={subagents} />
        if (event.type === 'approval') return <ApprovalLine key={event.seq} event={event} />
        if (event.type === 'plan') {
          return (
            <details key={event.seq} className="sess-plan" open>
              <summary>
                <ChecklistIcon size={15} />
                <span className="sess-plan-title">{event.name ? `План · ${event.name}` : 'План'}</span>
                <span className="sess-plan-note">сохранён как инструкция агента</span>
                <ChevronDownIcon size={14} />
              </summary>
              <MarkdownView text={event.text} onNavigate={onNavigate} />
            </details>
          )
        }
        if (event.type === 'error') {
          return (
            <p key={event.seq} className="sess-error">
              {event.text}
            </p>
          )
        }
        return (
          <div key={event.seq} className="sess-assistant">
            <MarkdownView text={event.text} onNavigate={onNavigate} />
          </div>
        )
      })}
      {footer}
    </div>
  )
}

const STICK_SUBAGENT_PX = 60

function SubagentPanel({
  sessionId,
  task,
  events,
  running,
  onBack,
  onNavigate
}: {
  sessionId: string
  task: SessionEvent | null
  events: SessionEvent[]
  running: boolean
  onBack: () => void
  onNavigate?: (key: PageKey) => void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const info = task ? readSubagent(task, running) : null
  const live = running && info?.state === 'running'

  useEffect(() => {
    stickRef.current = true
  }, [task?.call_id])

  useLayoutEffect(() => {
    const box = scrollRef.current
    if (box && stickRef.current) box.scrollTop = box.scrollHeight
  }, [events, task?.call_id])

  const prompt: SessionEvent[] =
    task && info?.prompt
      ? [
          {
            seq: 0,
            rev: 0,
            turn: task.turn,
            type: 'user',
            text: info.prompt,
            name: '',
            status: '',
            call_id: '',
            args: '',
            result: '',
            label: 'Задание подагента'
          }
        ]
      : []
  let note = ''
  if (info && !events.length) {
    note =
      info.state === 'running'
        ? 'Подагент запускается…'
        : 'Ход подагента не записан: он работал до того, как платформа начала сохранять его шаги.'
  } else if (info?.state === 'stopped') {
    note = 'Подагент остановлен.'
  }

  return (
    <aside className="glass-panel sub-panel" aria-label="Ход подагента">
      <header className="sub-head">
        <button type="button" className="agent-back" onClick={onBack}>
          <ChevronLeftIcon size={16} />
          Производительность
        </button>
        {info ? <SubagentMeta info={info} /> : null}
      </header>
      {info ? (
        <div className="sub-title">
          <BotIcon size={15} />
          <strong title={info.description}>{info.description || 'Подагент'}</strong>
          {info.model ? <span className="sess-config-model">{info.model}</span> : null}
        </div>
      ) : null}
      <div
        className="sess-scroll sub-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const box = event.currentTarget
          stickRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < STICK_SUBAGENT_PX
        }}
      >
        {info ? (
          <Feed
            sessionId={sessionId}
            events={[...prompt, ...events]}
            progress
            running={live}
            onNavigate={onNavigate}
            footer={
              <>
                {info.error ? <p className="sess-error">{info.error}</p> : null}
                {note ? <p className="sess-note">{note}</p> : null}
              </>
            }
          />
        ) : null}
      </div>
    </aside>
  )
}

function readSavedModelPrefs(): ModelPrefs {
  try {
    const raw = localStorage.getItem(MODEL_PREFS_KEY) || ''
    if (!raw) return { model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, fast: false }
    const parsed = JSON.parse(raw) as Partial<ModelPrefs>
    return {
      model: String(parsed.model || DEFAULT_MODEL),
      effort: String(parsed.effort || DEFAULT_EFFORT),
      fast: Boolean(parsed.fast)
    }
  } catch {
    return { model: DEFAULT_MODEL, effort: DEFAULT_EFFORT, fast: false }
  }
}

export function AgentSession({
  target,
  configs,
  onBack,
  backLabel = 'К агентам',
  onOpened,
  showProgress,
  onShowProgress,
  variant = 'full',
  onNavigate
}: AgentSessionProps): React.JSX.Element {
  const [chatSessionId, setChatSessionId] = useState<string | null>(
    target.kind === 'session' ? target.sessionId : null
  )
  const sessionId = target.kind === 'session' ? target.sessionId : target.kind === 'chat' ? chatSessionId : null

  const [session, setSession] = useState<PlatformSession | null>(null)
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [threads, setThreads] = useState<PlatformSession[]>([])
  const [models, setModels] = useState<ModelSpec[]>([])
  const [skills, setSkills] = useState<SkillSpec[]>([])
  const [orders, setOrders] = useState<ExternalOrderBrief[]>([])
  const [selectedModel, setSelectedModel] = useState<string>(readSavedModelPrefs().model)
  const [selectedEffort, setSelectedEffort] = useState<string>(readSavedModelPrefs().effort)
  const [selectedFast, setSelectedFast] = useState<boolean>(readSavedModelPrefs().fast)
  const [mode, setMode] = useState<AgentMode>(
    target.kind === 'chat' ? normalizeMode(target.chat.mode) : 'agent'
  )

  const [loadError, setLoadError] = useState('')
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<PendingFile[]>([])
  const [dragging, setDragging] = useState(false)
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [notice, setNotice] = useState('')
  const [wake, setWake] = useState(0)
  const [remote, setRemote] = useState<PlatformSessionDetail['remote'] | null>(null)
  const [question, setQuestion] = useState<AgentQuestion | null>(null)
  const [approval, setApproval] = useState<AgentApproval | null>(null)
  const [lateQuestion, setLateQuestion] = useState<string | null>(null)
  const [progressOnce, setProgressOnce] = useState<boolean | null>(null)
  const [openAgent, setOpenAgent] = useState<string | null>(null)
  const [pane, setPane] = useState<'chat' | 'questions'>('chat')
  const [showOrderStart, setShowOrderStart] = useState(target.kind === 'chat' && Boolean(target.chat.orderChat))

  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionStart, setMentionStart] = useState<number>(-1)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [skillPickerOpen, setSkillPickerOpen] = useState(false)
  const [enabledSkillIds, setEnabledSkillIds] = useState<string[]>([])

  const shownAgentRef = useRef<string | null>(null)
  const answeredRef = useRef(new Set<string>())
  const revRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pickerRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<PendingFile[]>([])
  const openedChatRef = useRef('')
  filesRef.current = files

  const configId = target.kind === 'create' ? target.configId : session?.config_id
  const config = configs.find((item) => item.id === configId) ?? configs[0] ?? null
  const orderChat = target.kind === 'chat' ? target.chat.orderChat : undefined
  const startActions = useMemo(
    () => (orderChat ? orderStartActions(orderChat.order.role, orderChat.order.code) : []),
    [orderChat]
  )
  const orderConversationKey = target.kind === 'chat' ? target.chat.conversationKey : ''
  const isOrderChat = target.kind === 'chat' && Boolean(target.chat.orderChat)

  useEffect(() => {
    setShowOrderStart(isOrderChat)
  }, [isOrderChat, orderConversationKey])

  const grokModels = useMemo(() => {
    const allowed = ['grok-4.7', 'grok-4.6']
    const map = new Map(models.map((item) => [item.id, item]))
    return allowed.map((id) => map.get(id)).filter((item): item is ModelSpec => Boolean(item))
  }, [models])
  const activeModel = useMemo(() => {
    if (grokModels.length === 0) return null
    return (
      grokModels.find((item) => item.id === selectedModel) ||
      grokModels.find((item) => item.id === (session?.model || config?.model || DEFAULT_MODEL)) ||
      grokModels[0]
    )
  }, [config?.model, grokModels, selectedModel, session?.model])
  const effortOptions = useMemo(() => {
    const fromModel = activeModel?.parameters?.find((param) => param.id === 'reasoning_effort')?.values ?? []
    if (fromModel.length > 0) return fromModel
    return [
      { value: 'low', displayName: 'Low' },
      { value: 'medium', displayName: 'Medium' },
      { value: 'high', displayName: 'High' },
      { value: 'xhigh', displayName: 'Extra High' }
    ]
  }, [activeModel?.parameters])
  const fastValue = selectedFast ? 'true' : 'false'
  const activeModelParams = useMemo(
    () => [
      { id: 'reasoning_effort', value: selectedEffort || DEFAULT_EFFORT },
      { id: 'fast', value: fastValue }
    ],
    [fastValue, selectedEffort]
  )

  useEffect(() => {
    if (effortOptions.length === 0) return
    if (effortOptions.some((item) => item.value === selectedEffort)) return
    setSelectedEffort(effortOptions[0]?.value || DEFAULT_EFFORT)
  }, [effortOptions, selectedEffort])

  const running = session?.status === 'running'
  const lastTurn = events.length ? events[events.length - 1].turn : 0
  const questionCalled = events.some((event) => event.turn === lastTurn && isWaitingQuestion(event))
  const asking = running && !remote && question && (questionCalled || lateQuestion === question.id) ? question : null
  const permitting = running && !remote ? approval : null
  if (stopping && !running) setStopping(false)
  const progress = progressOnce ?? showProgress
  const canAttach = target.kind === 'create' ? Boolean(config?.attachments) : true
  const planned = Boolean(config?.plan_instruction)
  const canRerun =
    planned &&
    session !== null &&
    !running &&
    session.source === 'custom' &&
    session.chat_kind !== 'order' &&
    session.chat_kind !== 'personal' &&
    (session.plan_turn === 0 || Boolean(session.plan))

  const queued = session?.queued_messages ?? []
  const orderGapCount = useMemo(() => {
    if (!orderChat) return 0
    const live = gapsFromSessionEvents(events)
    return (live ?? orderChat.gaps ?? []).length
  }, [events, orderChat])

  const pickerSkills = useMemo(() => {
    const role = orderChat?.order.role
    if (role) return skills.filter((skill) => (skill.roles || []).includes(role))
    return skills.filter((skill) => !(skill.roles || []).length)
  }, [orderChat?.order.role, skills])

  const mentionItems = useMemo(() => {
    if (mentionQuery === null) return []
    return buildMentionItems({ query: mentionQuery, skills: pickerSkills, files, orderChat, orders })
  }, [files, mentionQuery, orderChat, orders, pickerSkills])

  useEffect(() => {
    if (mentionQuery === null || orders.length > 0) return
    let alive = true
    void api
      .externalOrders()
      .then((list) => {
        if (alive && Array.isArray(list)) setOrders(list.slice(0, 40))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [mentionQuery, orders.length])

  useEffect(() => {
    let alive = true
    void apiGet<{ items: ModelSpec[] }>('/api/v1/platform/models')
      .then((res) => {
        if (alive && Array.isArray(res.items)) setModels(res.items)
      })
      .catch(() => undefined)
    void apiGet<{ items: SkillSpec[] }>('/api/v1/skills')
      .then((res) => {
        if (alive && Array.isArray(res.items)) setSkills(res.items)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const defaults =
      target.kind === 'chat'
        ? target.chat.skillIds || (target.chat.chatKind === 'order' ? ['external-order-case'] : target.chat.chatKind === 'personal' ? ['personal-assistant'] : [])
        : []
    setEnabledSkillIds(defaults)
  }, [target])

  useEffect(() => {
    try {
      localStorage.setItem(
        MODEL_PREFS_KEY,
        JSON.stringify({ model: selectedModel, effort: selectedEffort || DEFAULT_EFFORT, fast: selectedFast })
      )
    } catch {
      /* ignore */
    }
  }, [selectedEffort, selectedFast, selectedModel])

  useEffect(
    () => () => {
      for (const item of filesRef.current) if (item.preview) URL.revokeObjectURL(item.preview)
    },
    []
  )

  useEffect(() => {
    const block = (event: globalThis.DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  const loadThreads = useCallback(async () => {
    if (target.kind !== 'chat') return
    const prefix = target.chat.conversationPrefix || target.chat.conversationKey
    try {
      const res = await apiGet<{ items: PlatformSession[] }>(
        `/api/v1/platform/chats?prefix=${encodeURIComponent(prefix)}&chat_kind=${encodeURIComponent(target.chat.chatKind)}&limit=30`
      )
      setThreads(res.items ?? [])
    } catch {
      /* optional */
    }
  }, [target])

  const openUnifiedChat = useCallback(
    async (chatSpec: UnifiedChatTarget, overrideKey?: string, fresh = false) => {
      setLoadError('')
      try {
        const isScenario = (chatSpec.initialPrompt || '').includes('Сценарий дела:')
        const key = overrideKey || (fresh ? `${chatSpec.conversationKey}~${Date.now()}` : chatSpec.conversationKey)
        const opened = await apiPost<PlatformSession>('/api/v1/platform/chats/open', {
          workflow_id: chatSpec.workflowId,
          conversation_key: key,
          chat_kind: chatSpec.chatKind,
          title: chatSpec.title,
          prompt: chatSpec.orderChat || fresh ? '' : chatSpec.initialPrompt || '',
          shown: chatSpec.orderChat || fresh ? undefined : chatSpec.shown,
          mode: normalizeMode(chatSpec.mode),
          model: activeModel?.id || DEFAULT_MODEL,
          model_params: activeModelParams,
          skill_ids: chatSpec.skillIds || (chatSpec.chatKind === 'order' ? ['external-order-case'] : chatSpec.chatKind === 'personal' ? ['personal-assistant'] : []),
          fresh,
          send_if_empty: !chatSpec.orderChat && !isScenario && !fresh
        })
        revRef.current = 0
        setEvents([])
        setSession(opened)
        setChatSessionId(opened.id)
        onOpened(opened.id)
        void loadThreads()
      } catch (reason) {
        setLoadError(reason instanceof Error ? reason.message : 'Не удалось открыть чат')
      }
    },
    [activeModel?.id, activeModelParams, loadThreads, onOpened]
  )

  useEffect(() => {
    if (target.kind !== 'chat') return
    const sig = `${target.chat.workflowId}:${target.chat.conversationKey}:${target.chat.initialPrompt || ''}:${Boolean(target.chat.fresh)}`
    if (openedChatRef.current === sig) return
    openedChatRef.current = sig
    void openUnifiedChat(target.chat)
  }, [openUnifiedChat, target])

  function addFiles(list: File[]): void {
    if (!list.length) return
    if (!canAttach) {
      setNotice('Эта конфигурация не принимает вложения')
      return
    }
    const room = MAX_FILES - filesRef.current.length
    const { added, rejected } = pendingFrom(list.slice(0, Math.max(room, 0)))
    if (list.length > room) rejected.push(`Не больше ${MAX_FILES} вложений за сообщение`)
    setNotice(rejected.join(' · '))
    if (added.length) setFiles((current) => [...current, ...added])
  }

  function removeFile(id: string): void {
    setFiles((current) => {
      const gone = current.find((item) => item.id === id)
      if (gone?.preview) URL.revokeObjectURL(gone.preview)
      return current.filter((item) => item.id !== id)
    })
  }

  function clearFiles(): void {
    for (const item of filesRef.current) if (item.preview) URL.revokeObjectURL(item.preview)
    setFiles([])
  }

  function onDrop(event: DragEvent<HTMLFormElement>): void {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    setDragging(false)
    addFiles([...event.dataTransfer.files])
  }

  useEffect(() => {
    revRef.current = 0
    setSession(null)
    setEvents([])
    setRemote(null)
    setQuestion(null)
    setApproval(null)
    setProgressOnce(null)
    setOpenAgent(null)
    shownAgentRef.current = null
    setLoadError('')
    stickRef.current = true
  }, [sessionId])

  const questionId = question?.id
  useEffect(() => {
    if (!questionId) return
    const timer = window.setTimeout(() => setLateQuestion(questionId), QUESTION_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [questionId])

  useEffect(() => {
    if (!sessionId) return
    let alive = true
    let pollTimer = 0
    let stopSse: (() => void) | null = null

    const applyDetail = (data: PlatformSessionDetail): void => {
      if (!alive) return
      revRef.current = Math.max(revRef.current, data.session.rev)
      setSession(data.session)
      if (data.session.mode) setMode(normalizeMode(data.session.mode))
      if (data.session.model) setSelectedModel(data.session.model)
      if (Array.isArray(data.session.model_params)) {
        const effort = data.session.model_params.find((item) => item.id === 'reasoning_effort')?.value
        const fast = data.session.model_params.find((item) => item.id === 'fast')?.value
        if (effort) setSelectedEffort(effort)
        if (fast === 'true' || fast === 'false') setSelectedFast(fast === 'true')
      }
      setRemote(data.remote ?? null)
      const asked = data.question && !answeredRef.current.has(data.question.id) ? data.question : null
      setQuestion((current) => (current?.id === asked?.id ? current : asked))
      const pending = data.approval && !answeredRef.current.has(data.approval.id) ? data.approval : null
      setApproval((current) => (current?.id === pending?.id ? current : pending))
      setLoadError('')
      if (data.events.length) {
        setEvents((current) => {
          const bySeq = new Map(current.map((event) => [event.seq, event]))
          for (const event of data.events) bySeq.set(event.seq, event)
          return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
        })
      }
    }

    const startPoll = (): void => {
      if (!alive) return
      void apiGet<PlatformSessionDetail>(
        `/api/v1/platform/sessions/${encodeURIComponent(sessionId)}?since=${revRef.current}`
      )
        .then(applyDetail)
        .catch((reason) => {
          if (alive) setLoadError(reason instanceof Error ? reason.message : 'Не удалось загрузить сессию')
        })
        .finally(() => {
          if (alive) pollTimer = window.setTimeout(startPoll, FALLBACK_POLL_MS)
        })
    }

    stopSse = streamSession(
      sessionId,
      revRef.current,
      applyDetail,
      () => {
        if (alive) startPoll()
      }
    )

    return () => {
      alive = false
      if (stopSse) stopSse()
      window.clearTimeout(pollTimer)
    }
  }, [sessionId, wake])

  useLayoutEffect(() => {
    const box = scrollRef.current
    if (box && stickRef.current) box.scrollTop = box.scrollHeight
  }, [events, session?.status, queued.length])

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [prompt])

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [target.kind, sessionId])

  const hasContent = Boolean(prompt.trim()) || (Boolean(sessionId) && files.length > 0)
  const canSend = hasContent && !sending && (Boolean(sessionId) || Boolean(config?.runnable))

  async function send(delivery: 'queue' | 'steer' = 'queue'): Promise<void> {
    if (!canSend) return
    const rawText = prompt.trim()
    const extracted = extractMentionContext(rawText)
    const contextLines = [...extracted.notes]
    if (target.kind === 'chat' && target.chat.appContext && (!session || session.turns === 0)) {
      contextLines.unshift(target.chat.appContext)
    }
    const fullPrompt = contextLines.length
      ? `${rawText}\n\n[Контекст]\n${contextLines.join('\n')}`
      : rawText
    const defaultSkills =
      target.kind === 'chat'
        ? target.chat.skillIds || (target.chat.chatKind === 'order' ? ['external-order-case'] : target.chat.chatKind === 'personal' ? ['personal-assistant'] : [])
        : []
    const skillIds = [...new Set([...defaultSkills, ...enabledSkillIds, ...extracted.skillIds])]

    setSending(true)
    setNotice('')
    setMentionQuery(null)
    setShowOrderStart(false)
    try {
      const attachments = await Promise.all(files.map(toUpload))
      if (target.kind === 'create') {
        const created = await apiPost<PlatformSession>('/api/v1/platform/sessions', {
          config_id: target.configId,
          source: 'custom',
          prompt: fullPrompt,
          shown: rawText,
          attachments,
          mode,
          model: activeModel?.id || DEFAULT_MODEL,
          model_params: activeModelParams,
          skill_ids: skillIds
        })
        setPrompt('')
        clearFiles()
        onOpened(created.id)
      } else if (sessionId) {
        const updated = await apiPost<PlatformSession>(
          `/api/v1/platform/sessions/${encodeURIComponent(sessionId)}/messages`,
          {
            prompt: fullPrompt,
            shown: rawText,
            attachments,
            mode,
            model: activeModel?.id || DEFAULT_MODEL,
            model_params: activeModelParams,
            skill_ids: skillIds,
            delivery
          }
        )
        setPrompt('')
        clearFiles()
        setSession(updated)
        stickRef.current = true
        setWake((value) => value + 1)
      }
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Не удалось отправить')
    } finally {
      setSending(false)
    }
  }

  async function startOrderAction(action: OrderStartAction): Promise<void> {
    if (!sessionId || !orderChat || sending) return
    const rawText = action.prompt
    setSending(true)
    setNotice('')
    setSkillPickerOpen(false)
    try {
      const updated = await apiPost<PlatformSession>(
        `/api/v1/platform/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          prompt: rawText,
          shown: action.title,
          attachments: [],
          mode,
          model: activeModel?.id || DEFAULT_MODEL,
          model_params: activeModelParams,
          skill_ids: ['external-order-case', action.skillId],
          delivery: 'queue'
        }
      )
      setSession(updated)
      stickRef.current = true
      setWake((value) => value + 1)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Не удалось начать действие')
    } finally {
      setSending(false)
    }
  }

  async function stop(): Promise<void> {
    if (!sessionId || stopping) return
    setStopping(true)
    try {
      await apiPost(`/api/v1/platform/sessions/${encodeURIComponent(sessionId)}/cancel`, {})
      setWake((value) => value + 1)
    } catch (reason) {
      setStopping(false)
      setNotice(reason instanceof Error ? reason.message : 'Не удалось остановить')
    }
  }

  async function rerun(): Promise<void> {
    if (!session) return
    setSending(true)
    setNotice('')
    try {
      const created = await apiPost<PlatformSession>(
        `/api/v1/platform/agents/${encodeURIComponent(session.agent_id)}/runs`,
        {
          mode,
          model: activeModel?.id || DEFAULT_MODEL,
          model_params: activeModelParams
        }
      )
      onOpened(created.id)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Не удалось запустить агента')
    } finally {
      setSending(false)
    }
  }

  async function removeQueued(messageId: string): Promise<void> {
    if (!sessionId) return
    try {
      const updated = await apiDelete<PlatformSession>(
        `/api/v1/platform/sessions/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(messageId)}`
      )
      setSession(updated)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Не удалось убрать из очереди')
    }
  }

  async function steerQueued(messageId: string): Promise<void> {
    if (!sessionId) return
    try {
      const updated = await apiPost<PlatformSession>(
        `/api/v1/platform/sessions/${encodeURIComponent(sessionId)}/queue/${encodeURIComponent(messageId)}/steer`,
        {}
      )
      setSession(updated)
      setWake((value) => value + 1)
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Не удалось перенаправить')
    }
  }

  function applyMention(item: MentionItem): void {
    const start = mentionStart >= 0 ? mentionStart : prompt.length
    const caret = inputRef.current?.selectionStart ?? prompt.length
    const next = `${prompt.slice(0, start)}${item.token}${prompt.slice(caret)}`
    setPrompt(next)
    setMentionQuery(null)
    setMentionStart(-1)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      const pos = start + item.token.length
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  function onPromptChange(value: string, selectionStart: number): void {
    setPrompt(value)
    const before = value.slice(0, selectionStart)
    const atMatch = /(^|\s)@([^\s@]*)$/.exec(before)
    if (atMatch) {
      setMentionStart(selectionStart - atMatch[2].length - 1)
      setMentionQuery(atMatch[2])
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
      setMentionStart(-1)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (mentionQuery !== null && mentionItems.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionIndex((i) => (i + 1) % mentionItems.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionIndex((i) => (i - 1 + mentionItems.length) % mentionItems.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const picked = mentionItems[mentionIndex] ?? mentionItems[0]
        if (picked) applyMention(picked)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMentionQuery(null)
        return
      }
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && running) {
      event.preventDefault()
      void send('steer')
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send('queue')
    }
  }

  const mainEvents = events.filter((event) => !event.parent)
  if (openAgent) shownAgentRef.current = openAgent
  const shownAgent = shownAgentRef.current
  const subagentTask = shownAgent
    ? (mainEvents.find((event) => event.type === 'tool' && event.call_id === shownAgent) ?? null)
    : null
  const subagentEvents = shownAgent ? events.filter((event) => event.parent === shownAgent) : []
  const subagentLink: SubagentLink = {
    open: openAgent,
    onOpen: (callId) => setOpenAgent((current) => (current === callId ? null : callId))
  }

  const lastShown = [...mainEvents].reverse().find((event) => event.type !== 'status')
  const workingText = stopping
    ? 'Останавливаю агента…'
    : permitting
      ? 'Агент ждёт разрешения'
      : asking
        ? 'Агент ждёт вашего ответа'
        : !lastShown || lastShown.type === 'user'
          ? [...events].reverse().find((event) => event.type === 'status')?.text || 'Запускаем агента…'
          : 'Агент работает…'

  const headerTitle =
    target.kind === 'create'
      ? 'Новый ИИ-агент'
      : target.kind === 'chat'
        ? orderChat
          ? `${orderChat.order.roleLabel || target.chat.title} · ${orderChat.order.code}`
          : target.chat.title
        : session?.agent_title || (loadError ? 'Сессия' : 'Загружаем…')

  const placeholder = running
    ? 'Напишите следующее сообщение (Enter — в очередь, Ctrl+Enter — перехватить)…'
    : mode === 'chat'
      ? 'Напишите в чат (поиск, общение, скиллы и инструменты по правилам)…'
      : 'Напишите агенту (@ для контекста и скиллов, Ctrl+V — фото)…'

  const compact = variant === 'compact'

  return (
    <div className={`agent-stage sess-page${compact ? ' is-compact' : ''}`}>
      <div className="agent-stage-bar">
        <button type="button" className="agent-back" onClick={onBack}>
          <ChevronLeftIcon size={16} />
          {backLabel}
        </button>
        <h2 title={headerTitle}>{headerTitle}</h2>
        {target.kind === 'chat' && !orderChat && threads.length > 0 ? (
          <div className="sess-thread-controls">
            <select
              className="sess-select"
              aria-label="Диалоги"
              value={sessionId || ''}
              onChange={(event) => {
                const picked = threads.find((item) => item.id === event.target.value)
                if (picked) {
                  setChatSessionId(picked.id)
                  onOpened(picked.id)
                }
              }}
            >
              {threads.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.prompt.slice(0, 36) || item.agent_title} ({item.turns} х.)
                </option>
              ))}
            </select>
            <button
              type="button"
              className="agent-back"
              title="Начать новый тред"
              onClick={() => void openUnifiedChat(target.chat, undefined, true)}
            >
              <PlusIcon size={14} />
              Новый
            </button>
          </div>
        ) : null}
        {orderChat && !compact ? (
          <div className="sess-order-tabs" role="tablist" aria-label="Разделы диалога заказа">
            <button
              type="button"
              role="tab"
              aria-selected={pane === 'chat'}
              className={`sess-order-tab${pane === 'chat' ? ' is-active' : ''}`}
              onClick={() => setPane('chat')}
            >
              Чат
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={pane === 'questions'}
              className={`sess-order-tab${pane === 'questions' ? ' is-active' : ''}`}
              onClick={() => setPane('questions')}
            >
              Вопросы{orderGapCount > 0 ? ` (${orderGapCount})` : ''}
            </button>
          </div>
        ) : null}
        {canRerun ? (
          <button
            type="button"
            className="agent-back sess-rerun"
            disabled={sending}
            title="Новый запуск по плану: в промпт уйдёт история этого прогона"
            onClick={() => void rerun()}
          >
            <PlayIcon size={14} />
            Запустить снова
          </button>
        ) : null}
        {session ? (
          <span className={`session-badge ${session.status}`}>
            {permitting ? 'Ждёт разрешения' : asking ? 'Ждёт ответа' : SESSION_STATUS[session.status]}
          </span>
        ) : null}
      </div>

      <div className={openAgent && !compact ? 'sess-split' : 'sess-split solo'}>
        <section className="sess-main" aria-label="Ход работы агента">
          {session && events.length ? (
            <ProgressBar
              running={running}
              text={workingText}
              waiting={Boolean(asking || permitting)}
              shown={progress}
              always={showProgress}
              onOnce={(show) => {
                setProgressOnce(show === showProgress ? null : show)
                stickRef.current = true
              }}
              onAlways={(show) => {
                setProgressOnce(null)
                onShowProgress(show)
                stickRef.current = true
              }}
            />
          ) : null}

          {orderChat && pane === 'questions' && !compact ? (
            <div className="sess-scroll">
              <OrderSidePane orderChat={orderChat} events={mainEvents} />
            </div>
          ) : (
            <div
              className="sess-scroll"
              ref={scrollRef}
              onScroll={(event) => {
                const box = event.currentTarget
                stickRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < STICK_TO_BOTTOM_PX
              }}
            >
              {orderChat && showOrderStart && mainEvents.length === 0 && !running ? (
                <div className="sess-start">
                  <p className="sess-start-title">Сегодня вы хотите:</p>
                  <div className="sess-start-list">
                    {startActions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        className="sess-start-action"
                        disabled={sending || !sessionId}
                        onClick={() => void startOrderAction(action)}
                      >
                        {action.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : target.kind === 'create' ? (
                <div className="agent-runs-empty sess-empty">
                  <BotIcon size={24} />
                  <strong>Опишите, что должен сделать агент</strong>
                  <p>
                    {planned && mode === 'chat'
                      ? 'В режиме Chat агент работает в безопасном контуре: поиск, общение и регламентные инструменты.'
                      : 'Агент приступит сразу с доступом к инструментам и скиллам.'}
                  </p>
                  {config && !config.runnable ? (
                    <p className="agent-error">{config.error || 'Эту конфигурацию нельзя запустить.'}</p>
                  ) : null}
                </div>
              ) : session ? (
                mainEvents.length > 0 ? (
                  <Feed
                    sessionId={session.id}
                    events={mainEvents}
                    progress={progress}
                    running={running}
                    subagents={subagentLink}
                    onNavigate={onNavigate}
                    footer={
                      <>
                        {session.status === 'error' && session.error && !mainEvents.some((event) => event.type === 'error') ? (
                          <p className="sess-error">{session.error}</p>
                        ) : null}
                        {session.status === 'cancelled' ? <p className="sess-note">Ход остановлен.</p> : null}
                      </>
                    }
                  />
                ) : (
                  <div className="agent-runs-empty sess-empty">
                    <BotIcon size={22} />
                    <strong>{target.kind === 'chat' && target.chat.chatKind === 'personal' ? 'Помощник Оркестратора' : 'Диалог готов'}</strong>
                    <p>
                      {target.kind === 'chat' && target.chat.chatKind === 'personal'
                        ? 'Спросите про задачи 1С, письма, заказы, KPI или откройте нужный раздел.'
                        : 'Напишите сообщение или выберите действие через @.'}
                    </p>
                  </div>
                )
              ) : loadError ? (
                <p className="sess-error">{loadError}</p>
              ) : null}
            </div>
          )}

          {queued.length > 0 ? (
            <div className="sess-queue" aria-label="Очередь сообщений">
              <div className="sess-queue-head">В очереди: {queued.length}</div>
              {queued.map((item) => (
                <div key={item.id} className="sess-queue-item">
                  <CornerDownRight size={13} />
                  <span className="sess-queue-text">{item.shown || item.prompt}</span>
                  <button
                    type="button"
                    className="sess-queue-btn"
                    title="Прервать текущий шаг и выполнить сразу"
                    onClick={() => void steerQueued(item.id)}
                  >
                    <Zap size={12} />
                    Сейчас
                  </button>
                  <button
                    type="button"
                    className="sess-queue-btn"
                    title="Убрать из очереди"
                    onClick={() => void removeQueued(item.id)}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {remote ? (
            <p className="sess-readonly">
              Запуск {remote.author ? `пользователя ${remote.author} ` : ''}
              {remote.host ? (
                <>
                  с компьютера <strong>{remote.host}</strong>
                </>
              ) : (
                'с другого компьютера'
              )}{' '}
              — только просмотр: диалог продолжают на том устройстве.
            </p>
          ) : permitting && sessionId ? (
            <ApprovalForm
              key={permitting.id}
              sessionId={sessionId}
              approval={permitting}
              onDecided={() => {
                answeredRef.current.add(permitting.id)
                setApproval(null)
                stickRef.current = true
                setWake((value) => value + 1)
              }}
              onStop={() => void stop()}
            />
          ) : asking && sessionId ? (
            <QuestionForm
              key={asking.id}
              sessionId={sessionId}
              question={asking}
              onAnswered={() => {
                answeredRef.current.add(asking.id)
                setQuestion(null)
                stickRef.current = true
                setWake((value) => value + 1)
              }}
              onStop={() => void stop()}
            />
          ) : (
            <form
              className={[
                'composer sess-composer sess-cursor-composer',
                files.length ? 'has-files' : '',
                dragging ? 'dragging' : ''
              ].join(' ')}
              onSubmit={(event) => {
                event.preventDefault()
                void send('queue')
              }}
              onDragOver={(event) => {
                if (!canAttach || !event.dataTransfer.types.includes('Files')) return
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
              }}
              onDrop={onDrop}
            >
              {mentionQuery !== null && mentionItems.length > 0 ? (
                <div className="sess-mentions" role="listbox" aria-label="Упоминания и скиллы">
                  {mentionItems.map((item, idx) => (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={idx === mentionIndex}
                      className={`sess-mention-item${idx === mentionIndex ? ' active' : ''}`}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        applyMention(item)
                      }}
                    >
                      <span className="sess-mention-kind">{item.kind}</span>
                      <strong>{item.label}</strong>
                      <span>{item.detail}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              {files.length ? <ComposerFiles files={files} onRemove={removeFile} /> : null}

              <div className="sess-composer-row">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={prompt}
                  placeholder={dragging ? 'Отпустите, чтобы прикрепить' : placeholder}
                  onChange={(event) => onPromptChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
                  onKeyDown={onKeyDown}
                  onPaste={(event) => {
                    const pasted = [...event.clipboardData.files]
                    if (!pasted.length || !canAttach) return
                    event.preventDefault()
                    addFiles(pasted)
                  }}
                />
              </div>

              <div className="sess-composer-bar">
                <div className="sess-composer-left">
                  <div className="sess-mode-switch" role="group" aria-label="Режим работы">
                    <button
                      type="button"
                      className={`sess-mode-btn${mode === 'agent' ? ' active' : ''}`}
                      onClick={() => setMode('agent')}
                    >
                      Agent
                    </button>
                    <button
                      type="button"
                      className={`sess-mode-btn${mode === 'chat' ? ' active' : ''}`}
                      onClick={() => setMode('chat')}
                    >
                      Chat
                    </button>
                  </div>
                  {grokModels.length > 0 ? (
                    <select
                      className="sess-model-select"
                      aria-label="Модель"
                      value={activeModel?.id || DEFAULT_MODEL}
                      onChange={(event) => setSelectedModel(event.target.value)}
                    >
                      {grokModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.displayName || model.id}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {effortOptions.length > 0 ? (
                    <select
                      className="sess-model-select"
                      aria-label="Effort"
                      value={selectedEffort}
                      onChange={(event) => setSelectedEffort(event.target.value)}
                    >
                      {effortOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.displayName || item.value}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <label className="sess-fast-toggle" title="Быстрый режим модели">
                    <input type="checkbox" checked={selectedFast} onChange={(event) => setSelectedFast(event.target.checked)} />
                    Fast
                  </label>
                  <div className="sess-skill-picker">
                    <button
                      type="button"
                      className={`sess-skills-btn${skillPickerOpen ? ' active' : ''}`}
                      onClick={() => setSkillPickerOpen((value) => !value)}
                      aria-expanded={skillPickerOpen}
                    >
                      Скиллы
                    </button>
                    {skillPickerOpen ? (
                      <div className="sess-skills-menu" role="listbox" aria-label="Выбор скиллов">
                        {orderChat
                          ? startActions.map((action) => (
                              <button
                                key={action.id}
                                type="button"
                                className="sess-skill-item sess-skill-action"
                                disabled={sending || !sessionId}
                                onClick={() => void startOrderAction(action)}
                              >
                                <strong>{action.title}</strong>
                              </button>
                            ))
                          : pickerSkills.map((skill) => {
                          const checked = enabledSkillIds.includes(skill.id)
                          return (
                            <label key={skill.id} className="sess-skill-item">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) =>
                                  setEnabledSkillIds((current) =>
                                    event.target.checked ? [...new Set([...current, skill.id])] : current.filter((id) => id !== skill.id)
                                  )
                                }
                              />
                              <span>
                                <strong>{skill.title || skill.id}</strong>
                                <small>{skill.description || skill.id}</small>
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    title="Упомянуть заказ, файл или скилл (@)"
                    aria-label="Упомянуть (@)"
                    onClick={() => {
                      const pos = inputRef.current?.selectionStart ?? prompt.length
                      const next = `${prompt.slice(0, pos)}@${prompt.slice(pos)}`
                      onPromptChange(next, pos + 1)
                      requestAnimationFrame(() => {
                        inputRef.current?.focus()
                        inputRef.current?.setSelectionRange(pos + 1, pos + 1)
                      })
                    }}
                  >
                    <AtSign size={15} />
                  </button>
                  {canAttach ? (
                    <>
                      <button
                        type="button"
                        className="icon-button"
                        title="Прикрепить фото или файл (Ctrl+V или перетащите)"
                        aria-label="Прикрепить фото или файл"
                        disabled={sending || files.length >= MAX_FILES}
                        onClick={() => pickerRef.current?.click()}
                      >
                        <PaperclipIcon />
                      </button>
                      <input
                        ref={pickerRef}
                        type="file"
                        multiple
                        hidden
                        onChange={(event) => {
                          addFiles([...(event.target.files ?? [])])
                          event.target.value = ''
                        }}
                      />
                    </>
                  ) : null}
                </div>

                <div className="sess-composer-right">
                  {running && canSend ? (
                    <button
                      type="button"
                      className="sess-steer-btn"
                      title="Прервать текущий шаг и сразу отправить (Ctrl+Enter)"
                      onClick={() => void send('steer')}
                    >
                      <Zap size={13} />
                      Сейчас
                    </button>
                  ) : null}
                  {running ? (
                    <button
                      type="button"
                      className="send sess-stop"
                      disabled={stopping}
                      onClick={() => void stop()}
                      title="Остановить агента"
                      aria-label="Остановить агента"
                    >
                      <StopIcon size={16} />
                    </button>
                  ) : null}
                  {!running || canSend ? (
                    <button
                      type="submit"
                      className="send"
                      disabled={!canSend}
                      title={running ? 'Добавить в очередь (Enter)' : 'Отправить'}
                      aria-label={running ? 'В очередь' : target.kind === 'create' ? 'Запустить агента' : 'Отправить'}
                    >
                      <ArrowUpIcon />
                    </button>
                  ) : null}
                </div>
              </div>
            </form>
          )}
          {notice ? <p className="sess-notice">{notice}</p> : null}
        </section>

        {sessionId && openAgent && shownAgent && !compact ? (
          <div className="sess-side subagent">
            <div className="sess-side-pane agent">
              <SubagentPanel
                sessionId={sessionId}
                task={subagentTask}
                events={subagentEvents}
                running={running}
                onBack={() => setOpenAgent(null)}
                onNavigate={onNavigate}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
