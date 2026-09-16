import { useEffect, useMemo, useRef, useState } from 'react'
import GridLayout, { type Layout, type LayoutItem } from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import './tabChrome.css'
import {
  TODAY_GRID_COLS,
  TODAY_GRID_MARGIN,
  TODAY_GRID_MAX_ROWS,
  TODAY_WIDGET_IDS,
  TODAY_WIDGET_LABELS,
  computeTodayGridMetrics,
  todayGridMinCanvasHeight,
  type TodayWidgetId,
  useTodayWidgetLayout
} from './useTodayWidgetLayout'

const GRID_MIN_CANVAS_HEIGHT = todayGridMinCanvasHeight()

const TODAY_RESIZE_HANDLES = ['s', 'w', 'e', 'n', 'sw', 'nw', 'se', 'ne'] as const

function PinIcon({ pinned }: { pinned: boolean }): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2l1.2 4.2L17 7l-3.8 2.8L14 14l-2-3.2L8 7l3.8-.8L12 2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill={pinned ? 'currentColor' : 'none'}
      />
      <path d="M12 14v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function TodayWidgetChrome({
  id,
  editMode,
  locked,
  hidden,
  color,
  onToggleLock,
  onToggleVisible,
  onSetColor,
  children
}: {
  id: TodayWidgetId
  editMode: boolean
  locked: boolean
  hidden: boolean
  color: string
  onToggleLock: () => void
  onToggleVisible: () => void
  onSetColor: (color: string) => void
  children: React.ReactNode
}): React.JSX.Element {
  const label = TODAY_WIDGET_LABELS[id]
  return (
    <div
      className={[
        'today-widget-shell',
        editMode ? 'today-widget-shell--edit' : '',
        locked ? 'today-widget-shell--locked' : '',
        hidden ? 'today-widget-shell--hidden' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ background: color || undefined }}
      data-widget-id={id}
    >
      {editMode ? (
        <div
          className="today-widget-chrome today-widget-chrome-bar today-widget-drag-handle"
          role="group"
          aria-label={`Переместить: ${label}`}
          title="Перетащите верхнюю панель для перемещения"
        >
          <span className="today-widget-drag-grip" aria-hidden>
            ⋮⋮
          </span>
          <span className="today-widget-chrome-title">{label}</span>
          <label className="tab-chrome-color" title="Цвет виджета">
            <input
              type="color"
              value={color || '#ffffff'}
              onChange={(event) => onSetColor(event.target.value)}
              onClick={(event) => event.stopPropagation()}
            />
          </label>
          <button
            type="button"
            className="tab-chrome-color-reset"
            onClick={(event) => {
              event.stopPropagation()
              onSetColor('')
            }}
          >
            Сброс цвета
          </button>
          <button
            type="button"
            className={`today-widget-lock-btn${hidden ? ' is-locked' : ''}`}
            aria-label={hidden ? `Показать: ${label}` : `Скрыть: ${label}`}
            onClick={(event) => {
              event.stopPropagation()
              onToggleVisible()
            }}
          >
            {hidden ? 'Показать' : 'Скрыть'}
          </button>
          <button
            type="button"
            className={`today-widget-lock-btn${locked ? ' is-locked' : ''}`}
            aria-label={locked ? `Открепить: ${label}` : `Закрепить: ${label}`}
            aria-pressed={locked}
            title={locked ? 'Закреплено — не двигается' : 'Закрепить на месте'}
            onClick={(event) => {
              event.stopPropagation()
              onToggleLock()
            }}
          >
            <PinIcon pinned={locked} />
          </button>
        </div>
      ) : null}
      <div className="today-widget-content">{children}</div>
    </div>
  )
}

export function TodayWidgetGrid({
  userId,
  editMode,
  layoutWithStatic,
  locked,
  visible = {},
  color = {},
  onLayoutChange,
  onToggleLock,
  onToggleVisible,
  onSetColor,
  widgets
}: {
  userId: string
  editMode: boolean
  layoutWithStatic: LayoutItem[]
  locked: Partial<Record<TodayWidgetId, boolean>>
  visible?: Partial<Record<TodayWidgetId, boolean>>
  color?: Partial<Record<TodayWidgetId, string>>
  onLayoutChange: (layout: Layout) => void
  onToggleLock: (id: TodayWidgetId) => void
  onToggleVisible?: (id: TodayWidgetId) => void
  onSetColor?: (id: TodayWidgetId, color: string) => void
  widgets: Record<TodayWidgetId, React.ReactNode>
}): React.JSX.Element {
  const draggable = editMode
  const canvasRef = useRef<HTMLDivElement>(null)
  const [gridMetrics, setGridMetrics] = useState(() =>
    computeTodayGridMetrics(GRID_MIN_CANVAS_HEIGHT, 800)
  )

  useEffect(() => {
    const node = canvasRef.current
    if (!node) return

    const measure = (): void => {
      const height = Math.max(node.clientHeight, GRID_MIN_CANVAS_HEIGHT)
      const width = node.clientWidth
      const next = computeTodayGridMetrics(height, width)
      setGridMetrics((prev) =>
        prev.rowHeight === next.rowHeight &&
        prev.canvasHeight === next.canvasHeight &&
        prev.containerWidth === next.containerWidth
          ? prev
          : next
      )
    }

    measure()
    const observer = new ResizeObserver(() => measure())
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const { rowHeight, canvasHeight, containerWidth, colWidth, marginX, marginY } = gridMetrics

  const canvasStyle = useMemo(
    () =>
      ({
        minHeight: GRID_MIN_CANVAS_HEIGHT,
        height: '100%',
        '--today-rgl-row-height': `${rowHeight}px`,
        '--today-rgl-col-width': `${colWidth}px`,
        '--today-rgl-margin-x': `${marginX}px`,
        '--today-rgl-margin-y': `${marginY}px`
      }) as React.CSSProperties,
    [colWidth, marginX, marginY, rowHeight]
  )

  const children = useMemo(() => {
    return TODAY_WIDGET_IDS.filter((id) => editMode || visible[id] !== false).map((id) => (
      <div key={id} className="today-widget-grid-item">
        <TodayWidgetChrome
          id={id}
          editMode={editMode}
          locked={Boolean(locked[id])}
          hidden={visible[id] === false}
          color={color[id] || ''}
          onToggleLock={() => onToggleLock(id)}
          onToggleVisible={() => onToggleVisible?.(id)}
          onSetColor={(next) => onSetColor?.(id, next)}
        >
          {widgets[id]}
        </TodayWidgetChrome>
      </div>
    ))
  }, [color, editMode, locked, onSetColor, onToggleLock, onToggleVisible, visible, widgets])

  return (
    <div
      ref={canvasRef}
      className={[
        'today-widget-canvas',
        editMode ? 'today-widget-canvas--edit' : 'today-widget-canvas--view',
        'today-widget-grid-host',
        editMode ? 'today-widget-grid-host--edit' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={canvasStyle}
      data-user-id={userId || 'default'}
    >
      <GridLayout
        className="today-widget-grid"
        style={{ height: canvasHeight, minHeight: canvasHeight }}
        width={Math.max(containerWidth, 1)}
        cols={TODAY_GRID_COLS}
        maxRows={TODAY_GRID_MAX_ROWS}
        rowHeight={rowHeight}
        margin={TODAY_GRID_MARGIN}
        containerPadding={[0, 0]}
        layout={layoutWithStatic}
        onLayoutChange={onLayoutChange}
        draggableHandle=".today-widget-chrome-bar"
        draggableCancel=".today-widget-lock-btn"
        isDraggable={draggable}
        isResizable={draggable}
        isBounded
        compactType={null}
        preventCollision
        allowOverlap={false}
        useCSSTransforms
        resizeHandles={[...TODAY_RESIZE_HANDLES]}
      >
        {children}
      </GridLayout>
    </div>
  )
}

export { useTodayWidgetLayout }
