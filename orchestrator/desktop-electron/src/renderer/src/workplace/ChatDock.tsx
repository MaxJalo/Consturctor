import { useEffect, useState } from 'react'
import { apiGet } from '../agentPlatform/api/client'
import type { PlatformConfig } from '../agentPlatform/api/types'
import { AgentSession } from '../agentPlatform/pages/AgentSession'
import '../agentPlatform/styles/index.css'
import type { PageKey } from '../components/Sidebar'
import { assistantGreeting } from './pageAssistant'
import { personalAgentWorkflowId } from './personalAgent'

interface ChatDockProps {
  userId: string
  pageKey: PageKey | null
  onNavigate: (key: PageKey) => void
  onOpenSupport: () => void
}

/**
 * Компактный плавающий режим того же единого чата AgentSession (без дубля движка).
 */
export function ChatDock({ userId, pageKey, onNavigate, onOpenSupport }: ChatDockProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [configs, setConfigs] = useState<PlatformConfig[]>([])
  const [showProgress, setShowProgress] = useState(false)
  const workflowId = personalAgentWorkflowId(userId)

  useEffect(() => {
    if (!open || configs.length > 0) return
    let alive = true
    void apiGet<{ items: PlatformConfig[] }>('/api/v1/platform/configs')
      .then((res) => {
        if (alive) setConfigs(res.items ?? [])
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [configs.length, open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="chat-dock">
      {open ? (
        <div className="chat-dock-panel is-assistant" role="dialog" aria-label="Помощник">
          <div className="chat-dock-tabs">
            <button type="button" className="chat-dock-tab is-active">
              Оркестратор
            </button>
            <button
              type="button"
              className="chat-dock-tab"
              onClick={() => {
                setOpen(false)
                onOpenSupport()
              }}
            >
              Поддержка
            </button>
          </div>
          <div className="tt-root" data-theme="light" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <AgentSession
              target={{
                kind: 'chat',
                chat: {
                  workflowId,
                  conversationKey: `${workflowId}:default`,
                  conversationPrefix: `${workflowId}:`,
                  chatKind: 'personal',
                  title: 'Оркестратор',
                  appContext: assistantGreeting(pageKey)
                }
              }}
              configs={configs}
              backLabel="Свернуть"
              variant="compact"
              showProgress={showProgress}
              onShowProgress={setShowProgress}
              onBack={() => setOpen(false)}
              onOpened={() => undefined}
              onNavigate={onNavigate}
            />
          </div>
        </div>
      ) : null}
      <button type="button" className="chat-dock-btn" onClick={() => setOpen((value) => !value)}>
        Чат
      </button>
    </div>
  )
}
