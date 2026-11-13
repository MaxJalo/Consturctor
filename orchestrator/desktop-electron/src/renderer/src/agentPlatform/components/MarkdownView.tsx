import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { PAGE_LABELS, type PageKey } from '../../components/Sidebar'
import { pageLinks, readableChatText, takeMarkers, type AssistantAction } from '../../workplace/pageAssistant'
import { openWorkplaceTab } from '../../workplace/workplaceNav'

interface MarkdownViewProps {
  text: string
  onNavigate?: (key: PageKey) => void
}

function assertNever(value: never): never {
  throw new Error(`Unhandled action: ${String(value)}`)
}

function runAction(action: AssistantAction, onNavigate?: (key: PageKey) => void): void {
  switch (action.type) {
    case 'navigate':
      if (action.intent) openWorkplaceTab(action.key, action.intent)
      else onNavigate?.(action.key)
      return
    case 'open_url':
      window.open(action.url, '_blank', 'noopener,noreferrer')
      return
    default:
      assertNever(action)
  }
}

export function MarkdownView({ text, onNavigate }: MarkdownViewProps): React.JSX.Element {
  const cleaned = takeMarkers(readableChatText(text || ''))
  const actions = cleaned.actions.length ? cleaned.actions : onNavigate ? pageLinks(cleaned.text) : []

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          )
        }}
      >
        {cleaned.text}
      </ReactMarkdown>
      {actions.length > 0 ? (
        <div className="sess-nav-actions">
          {actions.map((action, idx) => {
            const label =
              action.type === 'navigate'
                ? `Открыть: ${PAGE_LABELS[action.key] || action.key}`
                : 'Открыть ссылку'
            return (
              <button
                key={`${action.type}:${idx}`}
                type="button"
                className="sess-nav-btn"
                onClick={() => runAction(action, onNavigate)}
              >
                {label}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
