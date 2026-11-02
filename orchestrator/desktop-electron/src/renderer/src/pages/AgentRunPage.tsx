import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { agentClient } from '../api/agent'
import { api } from '../api/client'
import type { WorkflowFileItem } from '../api/types'
import { AgentFeed } from '../components/agentfeed'
import type { FeedItem } from '../components/agentfeed/types'
import { conversationEntryKey, useRuns, type RunEntry } from '../store/runs'
import { fileTypeIconSrc } from '../utils/fileTypeIcon'
import { categoryOf, FILE_CATEGORY_LABELS, formatFileWhen, formatSize } from './filesGrouping'
import { isPersonalAgentWorkflowId } from '../workplace/personalAgent'
import { parseIso, sameDay } from '../utils/calendar'
import { type AgentChatContext } from './agentChat'
import './orderAgentDialog.css'

interface AgentRunPageProps {
  workflowId: string
  title: string
  autoStart?: boolean
  initialMessage?: string
  appContext?: string
  /** Order conversation of an external-order service helper. */
  chat?: AgentChatContext
  onBack: () => void
  onOpenHistory?: (workflowId: string, title: string) => void
}

type RightTab = 'order' | 'done' | 'past' | 'files'

const CASE_ACTIONS: Record<string, string> = {
  auto_prepare: 'Авто-подготовка дела',
  read: 'Прочитал дело',
  read_full: 'Прочитал документы дела',
  propose: 'Записал черновики в карточку',
  plan_preview: 'Посчитал план работ',
  plan: 'Собрал файл плана работ',
  draft_1c: 'Подготовил черновик 1С'
}

function doneInConversation(items: FeedItem[]): { id: string; text: string; detail: string; error: boolean }[] {
  const rows: { id: string; text: string; detail: string; error: boolean }[] = []
  for (const item of items) {
    if (item.kind !== 'tool' || !item.done) continue
    const action = String(item.arguments?.action || '')
    const text =
      (item.tool === 'external_order.case' && CASE_ACTIONS[action]) || item.title || item.tool || 'Инструмент'
    const sections = item.arguments?.section_proposals
    const count = Array.isArray(sections) ? sections.length : 0
    const detail = [count ? `полей: ${count}` : '', item.summary || ''].filter(Boolean).join(' · ')
    rows.push({ id: item.id, text, detail, error: item.error })
  }
  return rows
}

function rememberedConversation(entries: Record<string, RunEntry>, workflowId: string, prefix: string, preferred: string): string {
  const own = entries[conversationEntryKey(workflowId, preferred)]
  if (own && (own.state.running || (own.state.items?.length ?? 0) > 0)) return preferred
  const siblings = Object.values(entries).filter((entry) => {
    const key = entry.conversationKey || ''
    return (
      entry.workflowId === workflowId &&
      key.startsWith(prefix) &&
      (entry.state.running || (entry.state.items?.length ?? 0) > 0)
    )
  })
  siblings.sort((left, right) => Number(Boolean(right.state.running)) - Number(Boolean(left.state.running)))
  return siblings[0]?.conversationKey || preferred
}

function briefLabel(chat: AgentChatContext): string {
  const order = chat.order
  return `Разбор заказа ${order.code} · ${order.roleLabel} · этап «${order.stageLabel}»`
}

function firstLine(text: string, limit = 140): string {
  const line = (text || '').trim().split('\n').find((part) => part.trim()) || ''
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line
}

const MAX_COMPOSER_LINES = 10

interface SentAttachment {
  name: string
  path: string
  atMs: number
}


function RunFileCard({ file }: { file: WorkflowFileItem }): React.JSX.Element {
  const name = file.name || 'file'
  const size = formatSize(file.sizeBytes)
  const when = formatFileWhen(file.createdAt)
  const meta = [when, size].filter(Boolean).join(' · ')
  return (
    <li>
      <button
        className="wf-file-card history-file-btn"
        type="button"
        onClick={() => {
          if (file.downloadUrl) void api.download(file.downloadUrl, name)
        }}
      >
        <img className="files-type-icon" src={fileTypeIconSrc(name)} alt="" />
        <div className="wf-file-copy">
          <span className="wf-file-name" title={name}>
            {name}
          </span>
          {meta ? <span className="wf-file-meta">{meta}</span> : null}
        </div>
      </button>
    </li>
  )
}

function FileSection({
  title,
  items
}: {
  title: string
  items: WorkflowFileItem[]
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <section className="wf-file-section">
      <h4>{title}</h4>
      <ul className="wf-files">
        {items.map((file) => (
          <RunFileCard key={file.id || file.name} file={file} />
        ))}
      </ul>
    </section>
  )
}

export function AgentRunPage({
  workflowId,
  title,
  autoStart = false,
  initialMessage = '',
  appContext = '',
  chat,
  onBack,
  onOpenHistory
}: AgentRunPageProps): React.JSX.Element {
  const runs = useRuns()
  const personalAgent = isPersonalAgentWorkflowId(workflowId)
  const [boundKey, setBoundKey] = useState(chat?.conversationKey || '')
  const conversationKey = boundKey || chat?.conversationKey || ''
  const entryKey = conversationKey ? conversationEntryKey(workflowId, conversationKey) : workflowId
  const readOnly = Boolean(chat?.readOnly)
  const entry = runs.entries[entryKey]
  const state = entry?.state
  const running = Boolean(state?.running)
  const awaiting = Boolean(state?.pendingQuestion || state?.pendingHitl)
  const [rightTab, setRightTab] = useState<RightTab>(chat ? 'order' : 'files')
  const [showWork, setShowWork] = useState(false)
  const [historyNote, setHistoryNote] = useState('')
  const conversationOpenedRef = useRef(false)

  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [sentAttachments, setSentAttachments] = useState<SentAttachment[]>([])
  const [files, setFiles] = useState<WorkflowFileItem[]>([])
  const leftRef = useRef<HTMLDivElement | null>(null)
  const dockRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const resumeAgentRef = useRef<string>(entry?.resumeAgentId || '')
  const autoStartedRef = useRef(false)
  const initialSentRef = useRef(false)

  const isTodayFile = useCallback((item: WorkflowFileItem): boolean => {
    const stamp = parseIso(item.createdAt || '')
    if (!stamp) return false
    return sameDay(stamp, new Date())
  }, [])

  const refreshFiles = useCallback(async () => {
    try {
      const rows = await api.listWorkflowFiles(workflowId)
      // Runtime panel keeps only today's files; older files stay available
      // in run history and on the global files page.
      const todayRows = rows
        .filter((item) => isTodayFile(item))
        .sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''))
      setFiles(todayRows)
    } catch {
      setFiles([])
    }
  }, [workflowId, isTodayFile])

  useEffect(() => {
    return agentClient.onEvent((event) => {
      if (event.type !== 'files_updated') return
      if (event.workflowId && event.workflowId !== workflowId) return
      void refreshFiles()
    })
  }, [workflowId, refreshFiles])

  useEffect(() => {
    let cancelled = false
    async function loadResumeAgent(): Promise<void> {
      try {
        const workflow = await api.getWorkflow(workflowId)
        if (cancelled) return
        const agentId = String(workflow.localRun?.sdk_agent_id || workflow.localRun?.sdkAgentId || '')
        if (agentId && !resumeAgentRef.current) resumeAgentRef.current = agentId
      } catch {
        /* sidecar also falls back to workflow.local_run.sdk_agent_id */
      }
    }
    // personal agent (Оркестратор) не хранится как workflow в БД — getWorkflow пропускаем
    if (!personalAgent && !conversationKey) void loadResumeAgent()
    void refreshFiles()
    return () => {
      cancelled = true
    }
  }, [workflowId, refreshFiles, personalAgent, conversationKey])

  // Разговор по заказу: сначала уже открытый или сохранённый ход.
  // Новый запуск — только если у этой службы по заказу ещё не было ни одного.
  // Ошибка загрузки истории не запускает агента заново: повторный ход упирается в таймаут.
  useEffect(() => {
    if (!chat || conversationOpenedRef.current) return
    conversationOpenedRef.current = true
    const preferred = chat.conversationKey
    const prefix = chat.conversationPrefix
    const key = rememberedConversation(runs.entries, workflowId, prefix, preferred)
    if (key !== preferred) setBoundKey(key)
    void runs
      .attachConversation(workflowId, key, title)
      .then(async (turns) => {
        if (turns > 0 || chat.readOnly) return
        const rows = await api.listAgentRuns(workflowId, { prefix })
        const latest = rows.find((item) => (item.conversationKey || '').startsWith(prefix))
        let active = key
        if (latest?.conversationKey) {
          active = latest.conversationKey
          if (active !== key) setBoundKey(active)
          const restored = await runs.attachConversation(workflowId, active, title)
          if (restored > 0) return
        }
        const task = initialMessage.trim()
        if (!task) return
        runs.startRun({
          workflowId,
          title,
          message: task,
          shownMessage: briefLabel(chat),
          conversationKey: active
        })
      })
      .catch(() => {
        setHistoryNote('История разговора не загрузилась. Напишите сообщение, чтобы продолжить.')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.conversationKey, workflowId])

  // Refresh the files panel whenever a run finishes.
  useEffect(() => {
    if (running) return
    void refreshFiles()
  }, [running, refreshFiles])

  // Scheduled runs mark the agent "working" from the board before any sidecar
  // events reach this page. Pull persisted steps so the feed is not empty.
  useEffect(() => {
    if (conversationKey) return
    if (!running) return
    if ((state?.items?.length ?? 0) > 0) return
    void runs.attachHistoryFeed(workflowId)
  }, [running, workflowId, state?.items?.length, runs, conversationKey])

  // On open, restore the latest known conversation for this exact agent.
  // Play (autoStart) must start a new run, not reopen the last feed.
  useEffect(() => {
    if (conversationKey) return
    if (autoStart || initialMessage.trim()) return
    if ((state?.items?.length ?? 0) > 0) return
    void runs.attachHistoryFeed(workflowId)
  }, [workflowId, runs, state?.items?.length, autoStart, initialMessage, conversationKey])

  // The "Запустить" play button opens this page with autoStart, so the agent
  // starts immediately on its own playbook instead of waiting for a message.
  useEffect(() => {
    if (personalAgent || conversationKey) return
    if (!autoStart || autoStartedRef.current) return
    if (running) return
    autoStartedRef.current = true
    const task = initialMessage.trim()
    runs.startRun({
      workflowId,
      title,
      message: task,
      shownMessage: task || 'Запуск агента',
      resumeAgentId: resumeAgentRef.current || undefined,
      forceRestart: true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, workflowId])

  // Поле «Задать вопрос оркестратору» на Сегодня: сразу отправляем вопрос.
  useEffect(() => {
    const message = initialMessage.trim()
    if (conversationKey || autoStart || !message || initialSentRef.current) return
    initialSentRef.current = true
    runs.startRun({
      workflowId,
      title: title || 'Оркестратор',
      message,
      shownMessage: message,
      resumeAgentId: resumeAgentRef.current || undefined,
      forceRestart: true,
      appContext: appContext || undefined
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, initialMessage])

  const pickFiles = async (): Promise<void> => {
    const paths = await window.api.openFile({
      title: 'Прикрепить файл',
      properties: ['openFile', 'multiSelections']
    })
    if (!paths.length) return
    setAttachments((prev) => Array.from(new Set([...prev, ...paths])))
  }

  const removeAttachment = (path: string): void => {
    setAttachments((prev) => prev.filter((item) => item !== path))
  }

  // Файлы, которые пользователь уже отправил агенту в этой сессии страницы —
  // показываем их в правой панели, чтобы вложения не «исчезали» после отправки.
  const recordSentAttachments = useCallback((paths: string[]): void => {
    if (!paths.length) return
    const atMs = Date.now()
    setSentAttachments((prev) => {
      const known = new Set(prev.map((item) => item.path))
      const added = paths
        .filter((path) => !known.has(path))
        .map((path) => ({ name: path.split(/[\\/]/).pop() || path, path, atMs }))
      if (!added.length) return prev
      return [...added, ...prev]
    })
  }, [])

  const stop = useCallback((): void => {
    if (!running) return
    runs.cancel(entryKey)
  }, [running, runs, entryKey])

  const submit = (): void => {
    if (running || readOnly) return
    const message = input.trim()
    if (!message && attachments.length === 0) return
    const names = attachments.map((path) => path.split(/[\\/]/).pop()).filter(Boolean)
    const shownMessage = [message, names.length ? `Прикреплённые файлы: ${names.join(', ')}` : '']
      .filter(Boolean)
      .join('\n')
    const filePaths = attachments
    recordSentAttachments(filePaths)
    setInput('')
    setAttachments([])
    runs.startRun({
      workflowId,
      title,
      message: message || shownMessage,
      conversationBrief: conversationKey ? initialMessage.trim() || undefined : undefined,
      shownMessage: shownMessage || message,
      filePaths: filePaths.length ? filePaths : undefined,
      resumeAgentId: conversationKey ? undefined : resumeAgentRef.current || undefined,
      forceRestart: running,
      appContext: personalAgent ? appContext || undefined : undefined,
      conversationKey: conversationKey || undefined
    })
  }

  const resizeComposer = useCallback((): void => {
    const textarea = inputRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    const style = window.getComputedStyle(textarea)
    const lineHeight = Number.parseFloat(style.lineHeight) || 20
    const paddingTop = Number.parseFloat(style.paddingTop) || 0
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0
    const maxHeight = Math.round(lineHeight * MAX_COMPOSER_LINES + paddingTop + paddingBottom)
    const target = Math.min(textarea.scrollHeight, maxHeight)
    textarea.style.height = `${Math.max(target, Math.round(lineHeight + paddingTop + paddingBottom))}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  useEffect(() => {
    resizeComposer()
  }, [input, resizeComposer])

  useEffect(() => {
    if (!running || chat) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, stop, chat])

  useEffect(() => {
    if (!chat) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chat, onBack])

  useEffect(() => {
    const host = leftRef.current
    const dock = dockRef.current
    if (!host || !dock) return
    const updateDockSpace = (): void => {
      const dockHeight = Math.ceil(dock.getBoundingClientRect().height)
      const reserved = Math.max(72, dockHeight + 20)
      host.style.setProperty('--wf-dock-space', `${reserved}px`)
    }
    updateDockSpace()
    let observer: ResizeObserver | null = null
    if ('ResizeObserver' in window) {
      observer = new ResizeObserver(() => updateDockSpace())
      observer.observe(dock)
    }
    window.addEventListener('resize', updateDockSpace)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateDockSpace)
      host.style.removeProperty('--wf-dock-space')
    }
  }, [])

  const temporaryFiles = useMemo(
    () => files.filter((file) => categoryOf(file) === 'temporary'),
    [files]
  )
  const knowledgeFiles = useMemo(
    () => files.filter((file) => categoryOf(file) === 'knowledge'),
    [files]
  )
  const instructionFiles = useMemo(
    () => files.filter((file) => categoryOf(file) === 'instructions'),
    [files]
  )
  const generatedFiles = useMemo(
    () => files.filter((file) => categoryOf(file) === 'agent'),
    [files]
  )
  const feedItems = useMemo<FeedItem[]>(() => {
    const items = state?.items ?? []
    if (!personalAgent) return items
    const cleaned = items.filter((item) => {
      if (item.kind !== 'system') return true
      return !/^workflow\b/i.test((item.text || '').trim())
    })
    if (cleaned.length > 0) return cleaned
    return [
      {
        kind: 'message',
        id: 'personal-greeting',
        role: 'agent',
        text: 'Я Оркестратор — базовый агент рабочего места. Задайте вопрос по процессам, решениям или задачам.'
      }
    ]
  }, [state?.items, personalAgent])

  const doneRows = useMemo(() => doneInConversation(state?.items ?? []), [state?.items])
  const dialogItems = useMemo(() => {
    if (showWork) return feedItems
    return feedItems.filter(
      (item) => item.kind === 'message' || item.kind === 'result' || (item.kind === 'system' && item.tone === 'error')
    )
  }, [feedItems, showWork])

  const statusText = running
    ? state?.status || 'Агент работает…'
    : awaiting
      ? 'Агент ждёт ваш ответ'
      : 'Готов к работе'

  if (chat) {
    const progressLabel = running
      ? state?.status && state.status !== 'Агент работает…'
        ? state.status
        : 'Агент работает'
      : showWork
        ? 'Ход работы показан'
        : 'Ход работы скрыт'
    const badge = running ? 'Работает' : awaiting ? 'Ждёт ответа' : readOnly ? 'Только просмотр' : ''
    return createPortal(
      <div className="modal-overlay" onClick={onBack} role="presentation">
        <div
          className="modal-card order-agent-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={title || 'Ход работы агента'}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="oad-bar">
            <button type="button" className="oad-back" onClick={onBack}>
              <span aria-hidden="true">‹</span>
              Закрыть
            </button>
            <h2 title={title}>{title || 'Запуск агента'}</h2>
            {badge ? <span className={`oad-badge${running ? ' busy' : ''}`}>{badge}</span> : null}
          </div>
          <div className="oad-config">
            <span className="oad-config-mark" aria-hidden="true" />
            <span className="oad-config-text">
              <span className="oad-config-label">Конфигурация запуска</span>
              <strong>{chat.order.roleLabel || title}</strong>
            </span>
            <span className="oad-config-meta">
              {chat.order.code} · {chat.order.stageLabel}
            </span>
            <span className="oad-config-meta">Агент Constructor</span>
          </div>
          <button
            type="button"
            className={`oad-progress${running ? ' running' : ''}`}
            aria-expanded={showWork}
            title="Показать или скрыть ход работы агента"
            onClick={() => setShowWork((value) => !value)}
          >
            {running ? <span className="oad-spinner" /> : null}
            <span className={running ? 'oad-shimmer' : ''}>{progressLabel}</span>
            <span className={`oad-chevron${showWork ? ' open' : ''}`} aria-hidden="true" />
          </button>
          <div className="oad-scroll">
            <AgentFeed
              items={dialogItems}
              status={state?.status ?? ''}
              running={running}
              pendingQuestion={state?.pendingQuestion ?? null}
              pendingHitl={state?.pendingHitl ?? null}
              hideRunningStatus
              emptyHint=""
              allowQuestionFiles
              onAnswer={(requestId, value, filePaths) => {
                runs.answer(entryKey, requestId, value, filePaths)
                if (filePaths && filePaths.length > 0) {
                  recordSentAttachments(filePaths)
                  window.setTimeout(() => {
                    void refreshFiles()
                  }, 400)
                }
              }}
              onHitl={(requestId, approved) => runs.respondHitl(entryKey, requestId, approved)}
              onSkip={() => runs.skip(entryKey)}
            />
            {historyNote ? <div className="oad-note">{historyNote}</div> : null}
          </div>
          {readOnly ? null : (
            <div className="oad-dock">
              {attachments.length > 0 ? (
                <div className="oad-files">
                  {attachments.map((path) => (
                    <span key={path} className="oad-file">
                      <span>{path.split(/[\\/]/).pop() || path}</span>
                      <button type="button" onClick={() => removeAttachment(path)} aria-label="Убрать файл">
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="oad-composer">
                <button type="button" className="oad-clip" title="Прикрепить файл" onClick={() => void pickFiles()}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M8 12.5 14.2 6.3a3 3 0 1 1 4.2 4.2l-8.4 8.5a4.5 4.5 0 0 1-6.4-6.4l8.1-8.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </button>
                <textarea
                  ref={inputRef}
                  rows={1}
                  placeholder={running ? 'Агент работает — дождитесь ответа или остановите' : 'Продолжить диалог с агентом'}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      submit()
                    }
                  }}
                />
                {running ? (
                  <button type="button" className="oad-send oad-stop" onClick={stop} aria-label="Остановить агента">
                    <span />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="oad-send"
                    disabled={!input.trim() && attachments.length === 0}
                    onClick={submit}
                    aria-label="Отправить"
                  >
                    ↑
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="oad-status">
            <span className={`oad-status-dot${running ? ' busy' : awaiting ? ' wait' : ''}`} />
            <span>{statusText}</span>
          </div>
        </div>
      </div>,
      document.body
    )
  }

  return (
    <div className={`wf-page${personalAgent ? ' wf-page--orchestrator' : ''}`}>
      <div className="wf-topbar">
        <button className="wf-back" onClick={onBack}>
          Назад
        </button>
        <div className="wf-title-block">
          <h1 className="wf-title">{title || (personalAgent ? 'Оркестратор' : 'Запуск агента')}</h1>
          {personalAgent ? <span className="wf-title-sub">Базовый агент</span> : null}
        </div>
        <div className="wf-topbar-spacer" />
        {onOpenHistory && !personalAgent && (
          <button className="wf-back" onClick={() => onOpenHistory(workflowId, title)}>
            История
          </button>
        )}
      </div>

      <div className="wf-body">
        <div className="wf-left" ref={leftRef}>
          <div className="wf-feed-wrap">
            <AgentFeed
              items={feedItems}
              status={state?.status ?? ''}
              running={running}
              pendingQuestion={state?.pendingQuestion ?? null}
              pendingHitl={state?.pendingHitl ?? null}
              emptyHint="Опишите задачу для агента и нажмите отправить. Записи требуют подтверждения."
              allowQuestionFiles
              onAnswer={(requestId, value, filePaths) => {
                runs.answer(entryKey, requestId, value, filePaths)
                if (filePaths && filePaths.length > 0) {
                  recordSentAttachments(filePaths)
                  window.setTimeout(() => {
                    void refreshFiles()
                  }, 400)
                }
              }}
              onHitl={(requestId, approved) => runs.respondHitl(entryKey, requestId, approved)}
              onSkip={() => runs.skip(entryKey)}
            />
            {historyNote ? <div className="wf-files-empty">{historyNote}</div> : null}
          </div>
          <div className="wf-dock" ref={dockRef} hidden={readOnly}>
            {attachments.length > 0 && (
              <div className="wf-attachments">
                {attachments.map((path) => (
                  <span key={path} className="wf-attachment">
                    <span className="wf-attachment-name">{path.split(/[\\/]/).pop() || path}</span>
                    <button
                      className="wf-attachment-remove"
                      onClick={() => removeAttachment(path)}
                      title="Убрать файл"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="wf-composer">
              <button
                className="wf-clip"
                title="Прикрепить файл"
                disabled={false}
                onClick={() => void pickFiles()}
              >
                📎
              </button>
              <textarea
                ref={inputRef}
                className="wf-composer-input"
                placeholder={running ? 'Агент работает — дождитесь ответа или остановите' : 'Продолжить диалог с агентом'}
                value={input}
                disabled={false}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    submit()
                  }
                }}
              />
              {running ? (
                <button
                  type="button"
                  className="wf-send wf-send-stop"
                  onClick={stop}
                  title="Остановить"
                  aria-label="Остановить"
                >
                  <span className="wf-send-stop-icon" />
                </button>
              ) : (
                <button
                  type="button"
                  className="wf-send"
                  disabled={!input.trim() && attachments.length === 0}
                  onClick={submit}
                  title="Отправить"
                >
                  ↑
                </button>
              )}
            </div>
          </div>
          <div className="wf-status">
            <span className={`wf-status-dot${running ? ' busy' : awaiting ? ' wait' : ''}`} />
            <span className="wf-status-text">{statusText}</span>
          </div>
        </div>

        <div className="wf-right">
          <div className="wf-tabs">
            <button className={`wf-tab${rightTab === 'files' ? ' active' : ''}`} onClick={() => setRightTab('files')}>
              Файлы за сегодня {files.length + sentAttachments.length}
            </button>
          </div>
          <div className="wf-right-body">
            {files.length === 0 && sentAttachments.length === 0 ? (
              <div className="wf-files-empty">Сегодня файлов пока нет</div>
            ) : (
              <div className="wf-file-groups">
                {sentAttachments.length > 0 ? (
                  <section className="wf-file-section">
                    <h4>Приложено пользователем</h4>
                    <ul className="wf-files">
                      {sentAttachments.map((item) => (
                        <li key={item.path}>
                          <div className="wf-file-card">
                            <img className="files-type-icon" src={fileTypeIconSrc(item.name)} alt="" />
                            <div className="wf-file-copy">
                              <span className="wf-file-name" title={item.name}>
                                {item.name}
                              </span>
                              <span className="wf-file-meta">
                                {formatFileWhen(new Date(item.atMs).toISOString())}
                              </span>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                <FileSection title={FILE_CATEGORY_LABELS.temporary} items={temporaryFiles} />
                <FileSection title={FILE_CATEGORY_LABELS.knowledge} items={knowledgeFiles} />
                <FileSection title={FILE_CATEGORY_LABELS.instructions} items={instructionFiles} />
                <FileSection title={FILE_CATEGORY_LABELS.agent} items={generatedFiles} />
              </div>
            )}
          </div>
          {running && (
            <button className="wf-stop" onClick={() => runs.cancel(entryKey)}>
              Остановить
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
