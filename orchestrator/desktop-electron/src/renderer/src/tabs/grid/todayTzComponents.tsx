import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SpecIconCalendar } from '../../workplace/specV04Icons'
import {
  TODAY_PLAN_DAY_END,
  TODAY_PLAN_DAY_START,
  useTodayPlanTimeline
} from '../../workplace/useTodayPlanTimeline'
import {
  TODAY_TIMELINE_HOURS,
  type TodayPlanBlock,
  type TodayPlanBlockDetail
} from './todayDemoData'
import { TodayFullPlanModal } from './TodayFullPlanModal'

const DAY_START = TODAY_PLAN_DAY_START
const DAY_END = TODAY_PLAN_DAY_END
const DAY_SPAN = DAY_END - DAY_START

function startOfToday(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function formatTodayFilterDateLong(day: Date): string {
  const today = startOfToday()
  const label = isSameLocalDay(day, today)
    ? 'Сегодня'
    : day.toLocaleDateString('ru-RU', { weekday: 'long' })
  return `${label}, ${day.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`
}

function toDateInputValue(day: Date): string {
  const y = day.getFullYear()
  const m = String(day.getMonth() + 1).padStart(2, '0')
  const d = String(day.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseDateInputValue(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return null
  const parsed = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function formatHourLabel(hour: number): string {
  const h = Math.floor(hour)
  const m = Math.round((hour - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function fallbackDetail(block: TodayPlanBlock): TodayPlanBlockDetail {
  return {
    timeRange: `${formatHourLabel(block.startHour)} – ${formatHourLabel(block.endHour)}`,
    typeLabel:
      block.lane === 'lunch'
        ? 'Перерыв'
        : block.lane === 'meetings' || block.kind === 'meet'
          ? 'Совещание'
          : block.who === 'ai'
            ? 'ИИ-агент'
            : 'Событие',
    location: block.subtitle,
    agentName: block.who === 'ai' ? block.subtitle : undefined
  }
}

function PlanEventDetailDialog({
  block,
  onClose
}: {
  block: TodayPlanBlock
  onClose: () => void
}): React.JSX.Element {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const detail = block.detail ?? fallbackDetail(block)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Время', value: detail.timeRange },
    { label: 'Тип', value: detail.typeLabel },
    { label: 'Название', value: block.title }
  ]
  if (detail.location) rows.push({ label: 'Место / ссылка', value: detail.location })
  if (detail.format) rows.push({ label: 'Формат', value: detail.format })
  if (detail.organizer) rows.push({ label: 'Организатор', value: detail.organizer })
  if (detail.participants) rows.push({ label: 'Участники', value: detail.participants })
  if (detail.agentName) rows.push({ label: 'ИИ-агент', value: detail.agentName })
  if (detail.status) rows.push({ label: 'Статус', value: detail.status })
  if (detail.source) rows.push({ label: 'Источник', value: detail.source })
  if (detail.workflowId) rows.push({ label: 'Workflow ID', value: detail.workflowId })
  if (detail.runId) rows.push({ label: 'Run ID', value: detail.runId })
  if (detail.note) rows.push({ label: 'Примечание', value: detail.note })
  if (block.subtitle && !detail.location && !detail.agentName) {
    rows.push({ label: 'Подпись', value: block.subtitle })
  }
  rows.push({ label: 'Исполнитель', value: whoTag(block) })

  return createPortal(
    <div className="modal-overlay today-plan-detail-overlay" onClick={onClose} role="presentation">
      <div
        className={`modal-card today-plan-detail-dialog tone-${block.tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="today-plan-detail-head">
          <h4 className="modal-title" id={titleId}>
            {block.title}
          </h4>
          <button
            ref={closeRef}
            type="button"
            className="today-plan-detail-close"
            onClick={onClose}
            aria-label="Закрыть"
          >
            ×
          </button>
        </header>
        <dl className="spec-detail-meta today-plan-detail-meta">
          {rows.map((row) => (
            <div key={row.label} className="today-plan-detail-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="modal-actions">
          <button type="button" className="btn-light" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/** Icon inset from block border — must match todayGrid.css */
const PLAN_BLOCK_ICON_LEFT_PX = 3
const PLAN_BLOCK_ICON_WIDTH_PX = 22
const PLAN_BLOCK_ICON_TEXT_GAP_PX = 4

let planBlockMeasureCanvas: CanvasRenderingContext2D | null | undefined

function planBlockMeasureCtx(): CanvasRenderingContext2D | null {
  if (planBlockMeasureCanvas !== undefined) return planBlockMeasureCanvas
  const canvas = document.createElement('canvas')
  planBlockMeasureCanvas = canvas.getContext('2d')
  return planBlockMeasureCanvas
}

function planBlockFirstWord(title: string): string {
  const trimmed = title.trim()
  const match = /\S+/.exec(trimmed)
  return match ? match[0] : trimmed
}

function planBlockTextWidth(text: string, titleEl: HTMLElement): number {
  const ctx = planBlockMeasureCtx()
  if (!ctx || !text) return 0
  const style = getComputedStyle(titleEl)
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  return Math.ceil(ctx.measureText(text).width)
}

/** Icon-only / hidden title only when even the first word cannot fit (not when full title overflows). */
function planBlockNeedsCompact(button: HTMLElement, titleEl: HTMLElement, hasIcon: boolean): boolean {
  const width = button.clientWidth
  if (width <= 0) return false

  const buttonStyle = getComputedStyle(button)
  const padX = parseFloat(buttonStyle.paddingLeft) + parseFloat(buttonStyle.paddingRight)
  const innerWidth = width - padX

  const titleStyle = getComputedStyle(titleEl)
  const titlePadX = parseFloat(titleStyle.paddingLeft) + parseFloat(titleStyle.paddingRight)
  const firstWord = planBlockFirstWord(titleEl.textContent ?? '')
  const minWordWidth = planBlockTextWidth(firstWord, titleEl) || 8

  if (!hasIcon) {
    const textSpace = innerWidth - titlePadX
    return textSpace < minWordWidth
  }

  const iconZone = PLAN_BLOCK_ICON_LEFT_PX + PLAN_BLOCK_ICON_WIDTH_PX + PLAN_BLOCK_ICON_TEXT_GAP_PX
  const titlePadLeft = parseFloat(titleStyle.paddingLeft)
  const titlePadRight = parseFloat(titleStyle.paddingRight)
  const textSpace = innerWidth - Math.max(titlePadLeft, iconZone) - titlePadRight

  const iconOnlyThreshold =
    padX + PLAN_BLOCK_ICON_LEFT_PX + PLAN_BLOCK_ICON_WIDTH_PX + PLAN_BLOCK_ICON_TEXT_GAP_PX + minWordWidth
  if (width < iconOnlyThreshold) return true

  return textSpace < minWordWidth
}

function PlanTimelineBlock({
  block,
  onSelect
}: {
  block: TodayPlanBlock
  onSelect: (block: TodayPlanBlock) => void
}): React.JSX.Element {
  const isLunch = block.lane === 'lunch'
  const hint = block.subtitle ? `${block.title} — ${block.subtitle}` : block.title
  const blockRef = useRef<HTMLButtonElement>(null)
  const titleRef = useRef<HTMLElement>(null)
  const [compact, setCompact] = useState(false)

  useLayoutEffect(() => {
    const button = blockRef.current
    const titleEl = titleRef.current
    if (!button || !titleEl) return

    const update = (): void => {
      setCompact(planBlockNeedsCompact(button, titleEl, !isLunch))
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(button)
    return () => observer.disconnect()
  }, [block.title, isLunch])

  const open = (): void => onSelect(block)

  return (
    <button
      ref={blockRef}
      type="button"
      className={`today-plan-block tone-${block.tone}${isLunch ? ' today-plan-block-lunch' : ''}`}
      style={blockStyle(block)}
      data-compact={compact ? 'true' : 'false'}
      title={hint}
      aria-label={`Подробнее: ${hint}`}
      onClick={open}
    >
      <div className="today-plan-block-inner">
        {!isLunch ? (
          <span className="today-plan-block-ico" aria-hidden>
            <PlanBlockIcon kind={block.kind} />
          </span>
        ) : null}
        <strong ref={titleRef} className="today-plan-block-title">
          {block.title}
        </strong>
      </div>
    </button>
  )
}

function PlanTrack({
  blocks,
  lunchBlock,
  laneClass,
  onSelectBlock
}: {
  blocks: TodayPlanBlock[]
  lunchBlock?: TodayPlanBlock
  laneClass: string
  onSelectBlock: (block: TodayPlanBlock) => void
}): React.JSX.Element {
  return (
    <div className={`today-plan-track ${laneClass}`}>
      {lunchBlock ? <PlanTimelineBlock block={lunchBlock} onSelect={onSelectBlock} /> : null}
      {blocks.map((block) => (
        <PlanTimelineBlock key={block.id} block={block} onSelect={onSelectBlock} />
      ))}
    </div>
  )
}

function IconReset(): React.JSX.Element {
  return (
    <svg className="today-filter-reset-ico" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 12a8 8 0 0 1 13.4-5.7M20 4v5h-5M20 12a8 8 0 0 1-13.4 5.7M4 20v-5h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconClock(): React.JSX.Element {
  return (
    <svg className="today-plan-clock" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v4l2.5 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function blockStyle(block: TodayPlanBlock): React.CSSProperties {
  const left = ((block.startHour - DAY_START) / DAY_SPAN) * 100
  const width = ((block.endHour - block.startHour) / DAY_SPAN) * 100
  const style: React.CSSProperties = { left: `${left}%`, width: `${Math.max(width, 3.5)}%` }
  if (block.accent) {
    style.background = block.accent.bg
    style.borderColor = block.accent.border
    style.boxShadow = `inset 3px 0 0 ${block.accent.border}`
  }
  return style
}

function whoTag(block: TodayPlanBlock): string {
  if (block.who === 'both') return 'ИИ + сотрудник'
  if (block.who === 'ai') return 'ИИ'
  return 'Сотрудник'
}

function PlanBlockIcon({ kind }: { kind: TodayPlanBlock['kind'] }): React.JSX.Element {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true }
  if (kind === 'meet') {
    return (
      <svg {...common}>
        <path
          d="M7 3h2v2h6V3h2v2h2a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h2V3z"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
    )
  }
  if (kind === 'mail') {
    return (
      <svg {...common}>
        <path
          d="M4 6h16v12H4V6zm0 0l8 5 8-5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (kind === 'onec') {
    return (
      <svg {...common}>
        <path d="M4 6h16M4 12h10M4 18h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'proj') {
    return (
      <svg {...common}>
        <path
          d="M4 7h16v12H4V7zm4-4h8v4H8V3z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3v2M12 19v2M3 12h2M19 12h2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export type TodayBarFilters = {
  source: string
  status: string
  executor: string
  process: string
}

export const EMPTY_TODAY_BAR_FILTERS: TodayBarFilters = {
  source: '',
  status: '',
  executor: '',
  process: ''
}

function TodayWidgetBasket({
  ids,
  labels,
  onRestore
}: {
  ids: string[]
  labels?: Record<string, string>
  onRestore: (id: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="tab-chrome-basket">
      <button
        type="button"
        className={`tab-chrome-basket-btn${open ? ' is-open' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Корзина ({ids.length})
      </button>
      {open ? (
        <ul className="tab-chrome-basket-list">
          {ids.map((id) => (
            <li key={id}>
              <span>{labels?.[id] || id}</span>
              <button type="button" onClick={() => onRestore(id)}>
                Вернуть
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function TodayFiltersBar({
  periodDay,
  onPeriodDayChange,
  onReset,
  widgetEditMode = false,
  onWidgetEditModeChange,
  onResetWidgetLayout,
  basketIds,
  basketLabels,
  onRestoreWidget,
  barFilters,
  onBarFiltersChange,
  sourceOptions = [],
  statusOptions = [],
  executorOptions = [],
  processOptions = []
}: {
  periodDay: Date
  onPeriodDayChange: (day: Date) => void
  onReset?: () => void
  widgetEditMode?: boolean
  onWidgetEditModeChange?: (edit: boolean) => void
  onResetWidgetLayout?: () => void
  basketIds?: string[]
  basketLabels?: Record<string, string>
  onRestoreWidget?: (id: string) => void
  barFilters?: TodayBarFilters
  onBarFiltersChange?: (next: TodayBarFilters) => void
  sourceOptions?: Array<string | { value: string; label: string }>
  statusOptions?: string[]
  executorOptions?: string[]
  processOptions?: string[]
}): React.JSX.Element {
  const filters = barFilters || EMPTY_TODAY_BAR_FILTERS
  const setFilter = (patch: Partial<TodayBarFilters>): void => {
    onBarFiltersChange?.({ ...filters, ...patch })
  }
  return (
    <div className="today-filters-bar wp-card">
      <label className="today-filter-field">
        <span className="today-filter-label">Период</span>
        <div className="today-filter-control today-filter-date-wrap">
          <SpecIconCalendar />
          <span className="today-filter-value">{formatTodayFilterDateLong(periodDay)}</span>
          <input
            type="date"
            className="today-filter-date-input"
            value={toDateInputValue(periodDay)}
            onChange={(event) => {
              const next = parseDateInputValue(event.target.value)
              if (next) onPeriodDayChange(next)
            }}
            aria-label="Выбрать день"
          />
        </div>
      </label>
      <label className="today-filter-field">
        <span className="today-filter-label">Процесс</span>
        <select
          className="today-filter-control today-filter-select"
          value={filters.process}
          onChange={(event) => setFilter({ process: event.target.value })}
        >
          <option value="">Все процессы</option>
          {processOptions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="today-filter-field">
        <span className="today-filter-label">Источник</span>
        <select
          className="today-filter-control today-filter-select"
          value={filters.source}
          onChange={(event) => setFilter({ source: event.target.value })}
        >
          <option value="">Все источники</option>
          {sourceOptions.map((item) => {
            const value = typeof item === 'string' ? item : item.value
            const label = typeof item === 'string' ? item : item.label
            return (
              <option key={value} value={value}>
                {label}
              </option>
            )
          })}
        </select>
      </label>
      <label className="today-filter-field">
        <span className="today-filter-label">Исполнитель</span>
        <select
          className="today-filter-control today-filter-select"
          value={filters.executor}
          onChange={(event) => setFilter({ executor: event.target.value })}
        >
          <option value="">Все исполнители</option>
          {executorOptions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="today-filter-field">
        <span className="today-filter-label">Статус</span>
        <select
          className="today-filter-control today-filter-select"
          value={filters.status}
          onChange={(event) => setFilter({ status: event.target.value })}
        >
          <option value="">Все статусы</option>
          {statusOptions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      {basketIds?.length && onRestoreWidget ? (
        <TodayWidgetBasket ids={basketIds} labels={basketLabels} onRestore={onRestoreWidget} />
      ) : null}
      {onWidgetEditModeChange ? (
        <button
          type="button"
          className={`today-filter-layout-btn${widgetEditMode ? ' is-active' : ''}`}
          aria-pressed={widgetEditMode}
          onClick={() => onWidgetEditModeChange(!widgetEditMode)}
        >
          {widgetEditMode ? 'Готово' : 'Редактировать виджеты'}
        </button>
      ) : null}
      {widgetEditMode && onResetWidgetLayout ? (
        <button type="button" className="today-filter-layout-reset" onClick={onResetWidgetLayout}>
          Сбросить раскладку
        </button>
      ) : null}
      <button
        type="button"
        className="today-filter-reset"
        onClick={() => {
          onPeriodDayChange(startOfToday())
          onBarFiltersChange?.(EMPTY_TODAY_BAR_FILTERS)
          onReset?.()
        }}
      >
        <IconReset />
        <span>Сбросить фильтры</span>
      </button>
    </div>
  )
}

export function TodayPlanPanel({
  periodDay,
  userId,
  fio,
  onOpenRun
}: {
  periodDay: Date
  userId: string
  fio: string
  onOpenRun?: (workflowId: string, title: string, runId?: string) => void
}): React.JSX.Element {
  const plan = useTodayPlanTimeline(periodDay, { userId, fio })
  const [selectedBlock, setSelectedBlock] = useState<TodayPlanBlock | null>(null)
  const [fullPlanOpen, setFullPlanOpen] = useState(false)

  return (
    <section className="wp-card today-plan-card today-plan-tz">
      <header className="today-plan-head">
        <div className="today-plan-head-main">
          <span className="today-plan-head-icon">
            <IconClock />
          </span>
          <div>
            <h3>План на день</h3>
            <p>{formatTodayFilterDateLong(periodDay)}</p>
            {plan.meetingsError ? (
              <p className="today-plan-head-note">{plan.meetingsError}</p>
            ) : null}
            {plan.loading ? <p className="today-plan-head-note">Загружаем календарь…</p> : null}
          </div>
        </div>
        <button
          type="button"
          className="today-plan-open"
          onClick={() => setFullPlanOpen(true)}
        >
          Открыть полный план →
        </button>
      </header>

      <div
        className="today-plan-timeline"
        style={{ '--plan-span': DAY_SPAN } as React.CSSProperties}
      >
        <div className="today-plan-hours" aria-hidden>
          {TODAY_TIMELINE_HOURS.map((hour) => (
            <span
              key={hour}
              style={{ left: `${((hour - DAY_START) / DAY_SPAN) * 100}%` }}
            >
              {String(hour).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        <div className="today-plan-lanes">
          <div className="today-plan-lane">
            <span className="today-plan-lane-label">Совещания</span>
            <PlanTrack
              blocks={plan.meetingBlocks}
              lunchBlock={plan.lunchBlock}
              laneClass="today-plan-track-meetings"
              onSelectBlock={setSelectedBlock}
            />
          </div>
          <div className="today-plan-lane">
            <span className="today-plan-lane-label">ИИ-агенты</span>
            <PlanTrack
              blocks={plan.aiBlocks}
              laneClass="today-plan-track-ai"
              onSelectBlock={setSelectedBlock}
            />
          </div>
        </div>
      </div>
      {selectedBlock ? (
        <PlanEventDetailDialog block={selectedBlock} onClose={() => setSelectedBlock(null)} />
      ) : null}
      <TodayFullPlanModal
        open={fullPlanOpen}
        periodDay={periodDay}
        fio={fio}
        onClose={() => setFullPlanOpen(false)}
        onOpenRun={onOpenRun}
      />
    </section>
  )
}
