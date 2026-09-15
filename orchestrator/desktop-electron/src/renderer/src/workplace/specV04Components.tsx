import type { ReactNode } from 'react'
import { stageProgressTone } from './specV04Shell'
import type { SpecSummaryTile } from './specV04Shell'
import type { SpecPillTone } from './specV04DemoData'
import { SpecIconPlay, SpecTileIcon } from './specV04Icons'

export function SpecPill({
  children,
  tone = 'gray'
}: {
  children: ReactNode
  tone?: SpecPillTone | string
}): React.JSX.Element {
  return <span className={`spec-pill tone-${tone}`}>{children}</span>
}

export function SpecProgress({ value }: { value: number }): React.JSX.Element {
  const tone = stageProgressTone(value / 100)
  return (
    <div className="spec-progress">
      <div className={`spec-progress-bar tone-${tone}`}>
        <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span>{value}%</span>
    </div>
  )
}

export function SpecPageHead({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle: string
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <div className="spec-v04-head wp-head">
      <div>
        <h1 className="page-title">{title}</h1>
        <div className="wp-sub">{subtitle}</div>
      </div>
      {actions ? <div className="spec-v04-head-actions">{actions}</div> : null}
    </div>
  )
}

export function SpecSummaryTiles({ tiles }: { tiles: SpecSummaryTile[] }): React.JSX.Element {
  return (
    <div className="spec-v04-tiles spec-v04-tiles-rich">
      {tiles.map((tile) => (
        <article key={tile.id} className={`spec-v04-tile tone-${tile.tone || 'neutral'}`}>
          <div className="spec-v04-tile-top">
            <div className="spec-v04-tile-label-row">
              <SpecTileIcon id={tile.id} />
              <span className="spec-v04-tile-label">{tile.label}</span>
            </div>
            {tile.progress != null ? (
              <div className={`spec-v04-ring tone-${tile.tone || 'blue'}`} style={{ '--p': `${tile.progress}%` } as React.CSSProperties}>
                <span>{tile.progress}%</span>
              </div>
            ) : null}
          </div>
          <strong className="spec-v04-tile-value">{tile.value}</strong>
          {tile.hint ? <small className="spec-v04-tile-hint">{tile.hint}</small> : null}
          {tile.progress != null && !tile.ring ? (
            <div className="spec-v04-tile-bar">
              <i style={{ width: `${tile.progress}%` }} />
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}

export function SpecProcessMapButton(): React.JSX.Element {
  return (
    <button type="button" className="spec-btn-outline spec-header-action-compact">
      Карта процессов
    </button>
  )
}

export function SpecQuickLaunchButton(): React.JSX.Element {
  return (
    <button type="button" className="spec-btn-launch">
      <SpecIconPlay />
      <span>Запустить процесс</span>
      <span className="spec-btn-launch-caret" aria-hidden>
        ▾
      </span>
    </button>
  )
}

export function SpecTodayQuickLaunchButton(): React.JSX.Element {
  return (
    <button type="button" className="spec-btn-launch spec-btn-launch-today">
      <SpecIconPlay />
      <span>Быстрый запуск</span>
      <span className="spec-btn-launch-caret" aria-hidden>
        ▾
      </span>
    </button>
  )
}

export function SpecFilters({
  children,
  layout = 'wrap'
}: {
  children: ReactNode
  layout?: 'wrap' | 'row'
}): React.JSX.Element {
  return (
    <div className={`spec-v04-filters wp-card spec-v04-filters-card${layout === 'row' ? ' spec-v04-filters-one-row' : ''}`}>
      {children}
    </div>
  )
}

export function SpecTableTabs({
  tabs,
  active,
  onChange
}: {
  tabs: { id: string; label: string; count?: number }[]
  active: string
  onChange: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="spec-table-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={active === tab.id ? 'active' : ''}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count != null ? <em>{tab.count}</em> : null}
        </button>
      ))}
    </div>
  )
}

export function SpecSplit({
  main,
  side,
  wideSide
}: {
  main: ReactNode
  side: ReactNode
  wideSide?: boolean
}): React.JSX.Element {
  return (
    <div className={`spec-v04-split${wideSide ? ' wide-side' : ''}`}>
      <div className="spec-v04-split-main">{main}</div>
      <aside className="spec-v04-split-side">{side}</aside>
    </div>
  )
}

export function SpecBottomRow({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="spec-v04-bottom-row">{children}</div>
}

export function SpecPanel({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <section className="wp-card spec-v04-panel">
      <header className="spec-v04-panel-head">
        <h3>{title}</h3>
        {extra}
      </header>
      {children}
    </section>
  )
}

export function SpecAskOrchestratorBlock({
  placeholder,
  chips,
  onSubmit
}: {
  placeholder: string
  chips: string[]
  onSubmit: (text: string) => void
}): React.JSX.Element {
  return (
    <section className="wp-card spec-ask-orch spec-ask-orch-rich">
      <h2 className="spec-ask-orch-title">Спросить Оркестратора</h2>
      <form
        className="spec-ask-orch-form"
        onSubmit={(event) => {
          event.preventDefault()
          const input = event.currentTarget.elements.namedItem('q') as HTMLInputElement | null
          const text = (input?.value || '').trim()
          if (!text) return
          onSubmit(text)
          if (input) input.value = ''
        }}
      >
        <div className="spec-ask-orch-input-row">
          <input name="q" type="text" placeholder={placeholder} autoComplete="off" />
          <button type="submit" className="spec-ask-send" aria-label="Отправить">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 11.5L20 4l-5.5 16-2.7-6.3L4 11.5z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </form>
      <div className="spec-ask-chips">
        {chips.map((chip) => (
          <button key={chip} type="button" className="spec-ask-chip" onClick={() => onSubmit(chip)}>
            {chip}
          </button>
        ))}
      </div>
    </section>
  )
}

export function SpecQuickActions({
  items
}: {
  items: Array<
    | string
    | {
        id: string
        label: string
        tone?: 'green' | 'orange' | 'blue' | 'yellow'
        onClick?: () => void
      }
  >
}): React.JSX.Element {
  return (
    <ul className="spec-quick-actions">
      {items.map((item) => {
        const label = typeof item === 'string' ? item : item.label
        const key = typeof item === 'string' ? item : item.id
        const tone = typeof item === 'string' ? undefined : item.tone
        const onClick = typeof item === 'string' ? undefined : item.onClick
        return (
          <li key={key}>
            <button
              type="button"
              className={`spec-quick-action-btn${tone ? ` spec-quick-action--${tone}` : ''}`}
              onClick={onClick}
            >
              {label}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
