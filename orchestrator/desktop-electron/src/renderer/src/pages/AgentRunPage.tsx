import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { agentClient } from '../api/agent'
import { api } from '../api/client'
import type { AgentRunHistoryItem, WorkflowFileItem } from '../api/types'
import { AgentFeed } from '../components/agentfeed'
import type { FeedItem } from '../components/agentfeed/types'
import { conversationEntryKey, useRuns } from '../store/runs'
import { fileTypeIconSrc } from '../utils/fileTypeIcon'
import { categoryOf, FILE_CATEGORY_LABELS, formatFileWhen, formatSize } from './filesGrouping'
import { isPersonalAgentWorkflowId } from '../workplace/personalAgent'
import { parseIso, sameDay } from '../utils/calendar'
import { type AgentChatContext, stageOfConversation } from './agentChat'

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
  const conversationKey = chat?.conversationKey || ''
  const entryKey = conversationKey ? conversationEntryKey(workflowId, conversationKey) : workflowId
  const readOnly = Boolean(chat?.readOnly)
  const entry = runs.entries[entryKey]
  const state = entry?.state
  const running = Boolean(state?.running)
  const awaiting = Boolean(state?.pendingQuestion || state?.pendingHitl)
  const [rightTab, setRightTab] = useState<RightTab>(chat ? 'order' : 'files')
  const [pastRuns, setPastRuns] = useState<AgentRunHistoryItem[]>([])
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

  // Разговор по заказу: сначала сохранённые ходы. Новый запрос уходит только
  // в первый раз, когда у этого заказа, службы и этапа ещё нет ни одного хода.
  useEffect(() => {
    if (!chat || conversationOpenedRef.current) return
    // Без отмены в cleanup: в StrictMode эффект отрабатывает дважды, а второй
    // проход сюда уже не заходит — отмена первого потеряла бы бриф по заказу.
    conversationOpenedRef.current = true
    void runs
      .attachConversation(workflowId, chat.conversationKey, title)
      .then((turns) => {
        if (turns > 0 || chat.readOnly) return
        const task = initialMessage.trim()
        if (!task) return
        runs.startRun({
          workflowId,
          title,
          message: task,
          shownMessage: briefLabel(chat),
          conversationKey: chat.conversationKey
        })
      })
      .catch(() => {
        setHistoryNote('История разговора не загрузилась. Напишите сообщение, чтобы продолжить.')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.conversationKey, workflowId])

  useEffect(() => {
    if (!chat?.conversationPrefix) return
    let cancelled = false
    void api
      .listAgentRuns(workflowId, { prefix: chat.conversationPrefix })
      .then((rows) => {
        if (!cancelled) setPastRuns(rows.filter((item) => item.conversationKey && item.conversationKey !== chat.conversationKey))
      })
      .catch(() => {
        if (!cancelled) setPastRuns([])
      })
    return () => {
      cancelled = true
    }
  }, [workflowId, chat?.conversationPrefix, chat?.conversationKey])

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
    if (!running) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, stop])

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

  const statusText = running
    ? state?.status || 'Агент работает…'
    : awaiting
      ? 'Агент ждёт ваш ответ'
      : 'Готов к работе'

  return (
    <div className={`wf-page${personalAgent ? ' wf-page--orchestrator' : ''}`}>
      <div className="wf-topbar">
        <button className="wf-back" onClick={onBack}>
          {chat ? `Назад к ${chat.order.code || 'заказу'}` : 'Назад'}
        </button>
        <div className="wf-title-block">
          <h1 className="wf-title">{title || (personalAgent ? 'Оркестратор' : 'Запуск агента')}</h1>
          {personalAgent ? <span className="wf-title-sub">Базовый агент</span> : null}
          {chat ? (
            <span className="wf-title-sub">
              {chat.order.code} · {chat.order.stageLabel}
              {readOnly ? ' · только просмотр' : ''}
            </span>
          ) : null}
        </div>
        <div className="wf-topbar-spacer" />
        {onOpenHistory && !personalAgent && !chat && (
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
            {chat ? (
              <>
                <button className={`wf-tab${rightTab === 'order' ? ' active' : ''}`} onClick={() => setRightTab('order')}>
                  Заказ
                </button>
                <button className={`wf-tab${rightTab === 'done' ? ' active' : ''}`} onClick={() => setRightTab('done')}>
                  Сделано {doneRows.length}
                </button>
                <button className={`wf-tab${rightTab === 'past' ? ' active' : ''}`} onClick={() => setRightTab('past')}>
                  Прошлые этапы {pastRuns.length}
                </button>
              </>
            ) : null}
            <button className={`wf-tab${rightTab === 'files' ? ' active' : ''}`} onClick={() => setRightTab('files')}>
              Файлы за сегодня {files.length + sentAttachments.length}
            </button>
          </div>
          <div className="wf-right-body">
            {chat && rightTab === 'order' ? (
              <div className="wf-order">
                <dl className="wf-order-facts">
                  <dt>Заказ</dt>
                  <dd>{chat.order.code}</dd>
                  <dt>Заказчик</dt>
                  <dd>{chat.order.customer || '—'}</dd>
                  <dt>Изделие</dt>
                  <dd>{chat.order.product || '—'}</dd>
                  <dt>Этап</dt>
                  <dd>{chat.order.stageLabel || '—'}</dd>
                  <dt>Служба</dt>
                  <dd>{chat.order.roleLabel || chat.order.role}</dd>
                </dl>
                {chat.order.blockers.length ? (
                  <div className="wf-order-blockers">
                    <h4>Что держит заказ</h4>
                    <ul>
                      {chat.order.blockers.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="wf-files-empty">Блокеров нет</p>
                )}
                <button type="button" className="wf-order-open" onClick={onBack}>
                  Открыть карточку
                </button>
              </div>
            ) : null}
            {chat && rightTab === 'done' ? (
              doneRows.length ? (
                <ol className="wf-done">
                  {doneRows.map((row) => (
                    <li key={row.id} className={row.error ? 'is-error' : ''}>
                      <b>{row.text}</b>
                      {row.detail ? <span>{firstLine(row.detail, 200)}</span> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="wf-files-empty">В этом разговоре агент ещё ничего не сделал</div>
              )
            ) : null}
            {chat && rightTab === 'past' ? (
              pastRuns.length ? (
                <ul className="wf-past">
                  {pastRuns.map((item) => (
                    <li key={item.runId}>
                      <details>
                        <summary>
                          <b>{chat.stageLabels?.[stageOfConversation(item.conversationKey || '')] || stageOfConversation(item.conversationKey || '')}</b>
                          <span>{formatFileWhen(item.startedAt)}</span>
                          <span>{firstLine(item.message)}</span>
                        </summary>
                        <div className="wf-past-answer">{(item.answer || item.summary || 'Ответа нет').trim()}</div>
                      </details>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="wf-files-empty">На прошлых этапах разговоров не было</div>
              )
            ) : null}
            {rightTab !== 'files' ? null : files.length === 0 && sentAttachments.length === 0 ? (
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
