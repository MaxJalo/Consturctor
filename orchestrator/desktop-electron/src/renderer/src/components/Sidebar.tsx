import { useEffect, useState } from 'react'
import { FioSuggest } from './FioSuggest'
import { api, parseChatMessage } from '../api/client'
import { previewText } from '../api/chatCodec'
import { loadUserAvatar } from '../api/avatars'
import type { ChatMessage, ChatThread, DirectoryUser } from '../api/types'
import logoUrl from '../assets/logo.png'
import iconSearch from '../assets/search.png'
import { NavIcon as UserNavIcon } from '../layout/navIcons'

export type AdminPageKey =
  | 'overview'
  | 'launch_calendar'
  | 'users'
  | 'ai_agents'
  | 'knowledge_base'

export type UserPageKey =
  | 'today'
  | 'processes'
  | 'tasks'
  | 'projects'
  | 'mail'
  | 'meetings'
  | 'decisions'
  | 'knowledge'

export type SharedPageKey = 'kpi' | 'history' | 'settings'
export type PageKey = AdminPageKey | UserPageKey | SharedPageKey

export const APP_TITLE = 'Оркестратор'

export const PAGE_LABELS: Record<PageKey, string> = {
  overview: 'Обзор',
  launch_calendar: 'Календарь запуска',
  users: 'Пользователи',
  ai_agents: 'ИИ-агенты',
  knowledge_base: 'База знаний',
  today: 'Сегодня',
  processes: 'Процессы',
  tasks: 'Задачи',
  projects: 'Проекты',
  mail: 'Письма',
  meetings: 'Совещания',
  decisions: 'Решения',
  knowledge: 'База знаний',
  kpi: 'KPI',
  history: 'История',
  settings: 'Настройки'
}

const ADMIN_ITEMS: { key: PageKey; label: string }[] = [
  { key: 'overview', label: PAGE_LABELS.overview },
  { key: 'history', label: PAGE_LABELS.history },
  { key: 'launch_calendar', label: PAGE_LABELS.launch_calendar },
  { key: 'kpi', label: PAGE_LABELS.kpi },
  { key: 'users', label: PAGE_LABELS.users },
  { key: 'ai_agents', label: PAGE_LABELS.ai_agents },
  { key: 'knowledge_base', label: PAGE_LABELS.knowledge_base },
  { key: 'settings', label: PAGE_LABELS.settings }
]

const USER_ITEMS: { key: PageKey; label: string }[] = [
  { key: 'today', label: PAGE_LABELS.today },
  { key: 'processes', label: PAGE_LABELS.processes },
  { key: 'tasks', label: PAGE_LABELS.tasks },
  { key: 'projects', label: PAGE_LABELS.projects },
  { key: 'mail', label: PAGE_LABELS.mail },
  { key: 'meetings', label: PAGE_LABELS.meetings },
  { key: 'decisions', label: PAGE_LABELS.decisions },
  { key: 'kpi', label: PAGE_LABELS.kpi },
  { key: 'history', label: PAGE_LABELS.history },
  { key: 'knowledge', label: PAGE_LABELS.knowledge }
]

function AdminNavIcon({ page }: { page: PageKey }): React.JSX.Element {
  if (page === 'overview' || page === 'history' || page === 'launch_calendar') {
    return (
      <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="5" width="16" height="15" rx="3" />
        <path d="M8 3v4M16 3v4M4 10h16" strokeLinecap="round" />
        {page === 'history' ? <path d="M12 13v3l2 1.5" strokeLinecap="round" /> : null}
        {page === 'launch_calendar' ? <path d="M9 15l-2 2 2 2M15 15l2 2-2 2" strokeLinecap="round" strokeLinejoin="round" /> : null}
        {page === 'overview' ? <path d="M8 14h8M8 17h5" strokeLinecap="round" /> : null}
      </svg>
    )
  }
  if (page === 'kpi') {
    return (
      <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="5" y="5" width="14" height="14" rx="2" />
        <path d="M8 16l4-5 4 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (page === 'users') {
    return (
      <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="9" cy="9" r="3" />
        <circle cx="17" cy="10" r="2.5" />
        <path d="M4 19c0-2.2 2.2-4 5-4M14 19c0-1.6 1.4-3 3.5-3" strokeLinecap="round" />
      </svg>
    )
  }
  if (page === 'knowledge_base') {
    return (
      <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3l7 4v6c0 4.4-3.1 7.4-7 8-3.9-.6-7-3.6-7-8V7l7-4z" strokeLinejoin="round" />
      <circle cx="12" cy="11" r="2" />
    </svg>
  )
}

function initials(fio: string): string {
  const parts = (fio || '').replace(/\./g, ' ').split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function shortFio(fio: string): string {
  const parts = (fio || '').replace(/\./g, ' ').split(/\s+/).filter(Boolean)
  if (!parts.length) return ''
  const rest = parts.slice(1).map((part) => `${part[0].toUpperCase()}.`)
  return [parts[0], ...rest].join(' ')
}

function oneLine(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim()
}

function lastMessagePreview(value: string | ChatMessage): string {
  if (typeof value === 'string') return oneLine(previewText(value))
  const text = oneLine(value.text)
  if (text) return text
  if (value.agent) return oneLine(`Агент: ${value.agent.title || 'ИИ-агент'}`)
  const file = value.attachments[0]
  return file ? oneLine(file.filename || 'Файл') : ''
}

function sameThread(peer: ChatThread, threadId: string, senderId = ''): boolean {
  if (threadId && peer.id === threadId) return true
  if (peer.kind === 'support' && (peer.id === 'support' || peer.id === threadId)) return true
  return Boolean(peer.id.startsWith('dm:') && peer.peerId && (peer.peerId === senderId || peer.peerId === threadId))
}

type UpdateState = 'idle' | 'available' | 'downloading' | 'installing' | 'error'

interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  availableVersion: string
  percent: number
  error: string
}

const IDLE_UPDATE: UpdateStatus = {
  state: 'idle',
  currentVersion: '',
  availableVersion: '',
  percent: 0,
  error: ''
}

interface SidebarProps {
  active: PageKey | null
  light?: boolean
  showAdminNav?: boolean
  activeThreadId?: string
  currentUserId?: string
  onNavigate: (key: PageKey) => void
  onOpenThread: (thread: ChatThread) => void
  onOpenFio: (fio: string, user?: DirectoryUser) => void
  refreshAt?: number
}

export function Sidebar({
  active,
  light = false,
  showAdminNav = false,
  activeThreadId = '',
  currentUserId = '',
  onNavigate,
  onOpenThread,
  onOpenFio,
  refreshAt = 0
}: SidebarProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [fio, setFio] = useState('')
  const [peers, setPeers] = useState<ChatThread[]>([])
  const [peerAvatars, setPeerAvatars] = useState<Record<string, string>>({})
  const [update, setUpdate] = useState<UpdateStatus>(IDLE_UPDATE)
  const items = showAdminNav ? ADMIN_ITEMS : USER_ITEMS

  useEffect(() => {
    let alive = true
    void window.api.getUpdateStatus?.().then((payload) => {
      if (alive && payload) setUpdate(payload)
    })
    const unsubscribe = window.api.onUpdateStatus?.((payload) => {
      setUpdate(payload)
    })
    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const loaded = await api.listChatThreads()
        if (alive) setPeers(loaded)
      } catch {
        if (alive) setPeers([])
      }
    }
    void load()
    const timer = window.setInterval(() => {
      void load()
    }, 120_000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [refreshAt])

  useEffect(() => {
    const unsubscribe = window.api.onChatEvent?.((payload) => {
      const kind = String(payload.type || '')
      if (kind === 'chat_receipt') {
        const threadId = String(payload.thread_id ?? '')
        const readerId = String(payload.reader_id ?? '')
        if (!threadId || (currentUserId && readerId && readerId !== currentUserId)) return
        setPeers((current) => current.map((peer) => (sameThread(peer, threadId) ? { ...peer, unread: 0 } : peer)))
        return
      }
      if (kind !== 'chat_message') return
      const parsed = parseChatMessage(payload.message)
      const threadId = String(payload.thread_id ?? parsed?.id ?? '')
      if (!threadId) return
      setPeers((current) => {
        const idx = current.findIndex((peer) => sameThread(peer, threadId, String(payload.sender_id ?? '')))
        if (idx < 0) return current
        const next = [...current]
        next[idx] = {
          ...next[idx],
          preview: parsed ? lastMessagePreview(parsed) : lastMessagePreview(String(payload.message || '')),
          unread: next[idx].unread + 1
        }
        return next
      })
    })
    return () => unsubscribe?.()
  }, [currentUserId])

  const peerAvatarKey = peers
    .map((peer) => `${peer.id}\u0000${peer.peerId || peer.id}\u0000${peer.avatarUrl || ''}`)
    .join('\u0001')
  useEffect(() => {
    let alive = true
    const entries = peerAvatarKey ? peerAvatarKey.split('\u0001') : []
    void Promise.all(
      entries.map(async (entry) => {
        const [threadId, userId, avatarUrl] = entry.split('\u0000')
        const url = await loadUserAvatar({ id: userId, avatarUrl })
        return [threadId, url] as const
      })
    ).then((pairs) => {
      if (!alive) return
      const map: Record<string, string> = {}
      for (const [id, url] of pairs) {
        if (url) map[id] = url
      }
      setPeerAvatars(map)
    })
    return () => {
      alive = false
    }
  }, [peerAvatarKey])

  function expandForSearch(): void {
    if (collapsed) setCollapsed(false)
  }

  return (
    <aside className={collapsed ? 'sidebar collapsed' : 'sidebar'}>
      <div className="sidebar-brand">
        <img className="sidebar-logo" src={logoUrl} alt={APP_TITLE} />
        {!collapsed && showAdminNav ? (
          <div className="sidebar-brand-text">
            <div className="sidebar-title">{APP_TITLE}</div>
            <div className="sidebar-subtitle">Администрирование</div>
          </div>
        ) : null}
        {!collapsed && !showAdminNav ? (
          <div className="sidebar-title">
            <strong>Оркестратор</strong>
            <span>должности</span>
          </div>
        ) : null}
      </div>

      <div className="sidebar-search" onClick={expandForSearch} title={collapsed ? 'ФИО' : undefined}>
        <img className="sidebar-search-icon" src={iconSearch} alt="" />
        {!collapsed && (
          <FioSuggest
            value={fio}
            onChange={setFio}
            onSelect={(value, user) => {
              setFio('')
              onOpenFio(value, user)
            }}
            placeholder="ФИО"
            inputClassName="sidebar-search-input"
            variant={light ? 'light' : 'dark'}
          />
        )}
      </div>

      {!collapsed && !showAdminNav ? <div className="pilot-badge">Пилот · 2 агента</div> : null}

      <nav className="nav">
        {items.map((item) => {
          const isActive = item.key === active
          return (
            <button
              key={item.key}
              className={isActive ? 'nav-item active' : 'nav-item'}
              onClick={() => onNavigate(item.key)}
              title={item.label}
            >
              <span className="nav-icon" aria-hidden>
                {showAdminNav ? <AdminNavIcon page={item.key} /> : <UserNavIcon page={item.key} />}
              </span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </button>
          )
        })}
      </nav>

      {(update.state === 'available' || update.state === 'downloading' || update.state === 'installing') && (
        <div className="sidebar-update">
          {update.state === 'downloading' || update.state === 'installing' ? (
            <div
              className={update.percent > 0 ? 'sidebar-update-progress' : 'sidebar-update-progress indeterminate'}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={update.percent}
            >
              <i className="sidebar-update-progress-bar" style={update.percent > 0 ? { width: `${update.percent}%` } : undefined} />
              {!collapsed && (
                <span className="sidebar-update-progress-label">
                  {update.state === 'installing' ? 'Установка...' : update.percent > 0 ? `${update.percent}%` : 'Загрузка...'}
                </span>
              )}
            </div>
          ) : (
            <button className="sidebar-update-btn" title={update.error || 'Установить обновление Конструктора и Оркестратора'} onClick={() => void window.api.installUpdate?.()}>
              {!collapsed && <span>Обновить обе программы</span>}
              {collapsed && <span className="sidebar-update-mark">!</span>}
            </button>
          )}
        </div>
      )}

      <div className="sidebar-divider" />
      <div className="sidebar-peers">
        {peers.map((peer) => {
          const isActive = peer.id === activeThreadId || (peer.peerId !== '' && peer.peerId === activeThreadId)
          const preview = lastMessagePreview(peer.preview)
          const unread = peer.unread > 0 && !isActive
          return (
            <button
              key={peer.id}
              className={isActive ? 'sidebar-peer active' : 'sidebar-peer'}
              title={preview ? `${peer.title}\n${preview}` : peer.title}
              onClick={() => {
                if (collapsed) setCollapsed(false)
                setPeers((current) => current.map((item) => (item.id === peer.id ? { ...item, unread: 0 } : item)))
                onOpenThread({ ...peer, unread: 0 })
              }}
            >
              <span className="sidebar-peer-avatar">
                {peerAvatars[peer.id] ? <img src={peerAvatars[peer.id]} alt="" /> : initials(peer.title)}
              </span>
              {!collapsed && (
                <span className="sidebar-peer-meta">
                  <span className="sidebar-peer-name">{shortFio(peer.title)}</span>
                  <span className="sidebar-peer-preview">{preview}</span>
                </span>
              )}
              {unread && <i className="sidebar-peer-dot" aria-hidden />}
            </button>
          )
        })}
      </div>

      <button className="collapse-btn" onClick={() => setCollapsed((value) => !value)} title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>
        {collapsed ? '\u203A' : '\u2039'}
      </button>
    </aside>
  )
}
