import type { ReactNode } from 'react'

function slot(className: string, children: ReactNode): React.JSX.Element {
  return <div className={className}>{children}</div>
}

export function OrchSlotMetrics({ children }: { children: ReactNode }): React.JSX.Element {
  return slot('orch-slot-metrics', children)
}

export function OrchSlotFilters({ children }: { children: ReactNode }): React.JSX.Element {
  return slot('orch-slot-filters', children)
}

export function OrchSlotMain({
  children,
  spanAll,
  heavyEmbed
}: {
  children: ReactNode
  spanAll?: boolean
  /** Занимает строки 2–4: метрики, фильтры и контент workplace без дубля shell. */
  heavyEmbed?: boolean
}): React.JSX.Element {
  const cls = [
    'orch-slot-main',
    spanAll ? 'orch-span-all' : '',
    heavyEmbed ? 'orch-heavy-embed-slot' : ''
  ]
    .filter(Boolean)
    .join(' ')
  return slot(cls, children)
}

export function OrchSlotSide({ children }: { children: ReactNode }): React.JSX.Element {
  return slot('orch-slot-side', children)
}

export function OrchSlotBotA({ children }: { children: ReactNode }): React.JSX.Element {
  return slot('orch-slot-bot-a orch-slot-panel', children)
}

export function OrchSlotBotB({ children }: { children: ReactNode }): React.JSX.Element {
  return slot('orch-slot-bot-b orch-slot-panel', children)
}

export function OrchSlotBotC({ children }: { children: ReactNode }): React.JSX.Element {
  return slot('orch-slot-bot-c orch-slot-panel', children)
}

/** Сетка «Сегодня» (wireframe 9×9, контент cols 2–9). */
function todaySlot(className: string, children: ReactNode): React.JSX.Element {
  return <div className={`${className} today-grid-slot`}>{children}</div>
}

export function OrchSlotTodayPlan({ children }: { children: ReactNode }): React.JSX.Element {
  return todaySlot('orch-slot-today-plan', children)
}

export function OrchSlotTodayOutlook({ children }: { children: ReactNode }): React.JSX.Element {
  return todaySlot('orch-slot-today-outlook', children)
}

export function OrchSlotTodayOnec({ children }: { children: ReactNode }): React.JSX.Element {
  return todaySlot('orch-slot-today-onec', children)
}

export function OrchSlotTodayProjects({ children }: { children: ReactNode }): React.JSX.Element {
  return todaySlot('orch-slot-today-projects', children)
}

export function OrchSlotTodayResults({ children }: { children: ReactNode }): React.JSX.Element {
  return todaySlot('orch-slot-today-results', children)
}

export function OrchSlotTodayEvents({ children }: { children: ReactNode }): React.JSX.Element {
  return todaySlot('orch-slot-today-events', children)
}

export function OrchSlotTodayDecisions({ children }: { children: ReactNode }): React.JSX.Element {
  return todaySlot('orch-slot-today-decisions', children)
}

export function OrchSlotTodayAsk({ children }: { children: ReactNode }): React.JSX.Element {
  return todaySlot('orch-slot-today-ask', children)
}

/** Область виджетов «Сегодня» (react-grid-layout). */
export function OrchSlotTodayCanvas({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="orch-slot-today-canvas today-widget-canvas-slot">{children}</div>
}
