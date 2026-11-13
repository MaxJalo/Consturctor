import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { PageKey } from '../components/Sidebar'
import { PlatformAgentPage, platformAgentIdFromNotes, type PlatformAgentSource } from '../agentPlatform/PlatformAgentPage'
import type { AgentChatContext } from './agentChat'

interface AgentRunRouterProps {
  workflowId: string
  title: string
  autoStart?: boolean
  initialMessage?: string
  appContext?: string
  chat?: AgentChatContext
  onBack: () => void
  onOpenHistory?: (workflowId: string, title: string) => void
  onNavigate?: (key: PageKey) => void
}

// workflowId → источник запуска на платформе.
const routes = new Map<string, PlatformAgentSource>()

function directRoute(workflowId: string): PlatformAgentSource | undefined {
  const agentId = platformAgentIdFromNotes(workflowId)
  return agentId ? { kind: 'platform', agentId } : undefined
}

/**
 * Единый роутер всех чатов и запусков агентов (заказы, личный помощник, Конструктор, TurboTester).
 */
export function AgentRunRouter(props: AgentRunRouterProps): React.JSX.Element {
  const { workflowId } = props
  const [route, setRoute] = useState<PlatformAgentSource | undefined>(() => {
    if (props.chat && !workflowId.startsWith('platform:')) return { kind: 'constructor' }
    return directRoute(workflowId) ?? routes.get(workflowId)
  })

  useEffect(() => {
    if (route !== undefined) return
    let alive = true
    api
      .getWorkflow(workflowId)
      .then((record) => {
        const platformId = platformAgentIdFromNotes(record.notes)
        const found: PlatformAgentSource = platformId ? { kind: 'platform', agentId: platformId } : { kind: 'constructor' }
        routes.set(workflowId, found)
        if (alive) setRoute(found)
      })
      .catch(() => {
        if (alive) setRoute({ kind: 'constructor' })
      })
    return () => {
      alive = false
    }
  }, [route, workflowId])

  if (route === undefined) {
    return <div className="agent-run-resolving" aria-busy="true" />
  }

  return (
    <PlatformAgentPage
      workflowId={workflowId}
      source={route}
      title={props.title}
      autoStart={props.autoStart}
      initialMessage={props.initialMessage}
      appContext={props.appContext}
      chat={props.chat}
      onBack={props.onBack}
      onNavigate={props.onNavigate}
    />
  )
}
