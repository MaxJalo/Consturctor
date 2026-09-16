import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Layout, LayoutItem } from 'react-grid-layout/legacy'

export const TODAY_LAYOUT_STORAGE_KEY = 'orch-today-layout-v3'

export const TODAY_GRID_COLS = 8
export const TODAY_GRID_MAX_ROWS = 6
/** Saved layout may use extra rows while editing (scroll); clamp must not squash back to viewport rows. */
export const TODAY_GRID_LAYOUT_MAX_ROWS = 12
export const TODAY_GRID_MARGIN: [number, number] = [5, 5]
/** Floor row height when the canvas slot is tight (6×44 + margins ≈ 289px). */
export const TODAY_MIN_ROW_HEIGHT = 44

export function computeTodayGridMetrics(
  containerHeight: number,
  containerWidth: number,
  canvasRows = TODAY_GRID_MAX_ROWS
): {
  rowHeight: number
  canvasHeight: number
  containerWidth: number
  colWidth: number
  marginX: number
  marginY: number
  canvasRows: number
} {
  const [marginX, marginY] = TODAY_GRID_MARGIN
  const viewportRows = TODAY_GRID_MAX_ROWS
  const rows = Math.max(viewportRows, canvasRows)
  const cols = TODAY_GRID_COLS
  const innerH = Math.max(0, containerHeight)
  const rowHeight = Math.max(
    TODAY_MIN_ROW_HEIGHT,
    Math.floor((innerH - (viewportRows - 1) * marginY) / viewportRows)
  )
  const canvasHeight = rows * rowHeight + (rows - 1) * marginY
  const innerW = Math.max(0, containerWidth)
  const colWidth = Math.max(0, (innerW - marginX * (cols - 1)) / cols)
  return { rowHeight, canvasHeight, containerWidth: innerW, colWidth, marginX, marginY, canvasRows: rows }
}

export function todayGridMinCanvasHeight(rows = TODAY_GRID_MAX_ROWS): number {
  const [, marginY] = TODAY_GRID_MARGIN
  return rows * TODAY_MIN_ROW_HEIGHT + (rows - 1) * marginY
}

export function todayLayoutExtentRows(layout: LayoutItem[]): number {
  if (!layout.length) return TODAY_GRID_MAX_ROWS
  return Math.max(TODAY_GRID_MAX_ROWS, ...layout.map((item) => (item.y ?? 0) + (item.h ?? 1)))
}

export const TODAY_WIDGET_IDS = [
  'plan',
  'results',
  'outlook',
  'onec',
  'projects',
  'events',
  'decisions',
  'ask'
] as const

export type TodayWidgetId = (typeof TODAY_WIDGET_IDS)[number]

export type TodayWidgetLayoutPersist = {
  layout: LayoutItem[]
  locked: Partial<Record<TodayWidgetId, boolean>>
}

/**
 * 8×6 grid — mirrors pre-RGL todayGrid.css placement:
 * row band 1: plan (6 col) + results (2 col, full height);
 * row band 2: outlook / 1С / projects (3×2 col);
 * row band 3: events / decisions / ask (2+2+4 col).
 */
export const DEFAULT_TODAY_WIDGET_LAYOUT: LayoutItem[] = [
  { i: 'plan', x: 0, y: 0, w: 6, h: 3, minW: 2, minH: 1, maxW: 8, maxH: 6 },
  { i: 'results', x: 6, y: 0, w: 2, h: 6, minW: 2, minH: 2, maxW: 8, maxH: 6 },
  { i: 'outlook', x: 0, y: 3, w: 2, h: 2, minW: 2, minH: 1, maxW: 8, maxH: 6 },
  { i: 'onec', x: 2, y: 3, w: 2, h: 2, minW: 2, minH: 1, maxW: 8, maxH: 6 },
  { i: 'projects', x: 4, y: 3, w: 2, h: 2, minW: 2, minH: 1, maxW: 8, maxH: 6 },
  { i: 'events', x: 0, y: 5, w: 2, h: 1, minW: 2, minH: 1, maxW: 8, maxH: 6 },
  { i: 'decisions', x: 2, y: 5, w: 2, h: 1, minW: 2, minH: 1, maxW: 8, maxH: 6 },
  { i: 'ask', x: 4, y: 5, w: 4, h: 1, minW: 2, minH: 1, maxW: 8, maxH: 6 }
]

export const TODAY_WIDGET_LABELS: Record<TodayWidgetId, string> = {
  plan: 'План на день',
  results: 'Результаты агентов',
  outlook: 'Письма Outlook',
  onec: 'Задачи 1С',
  projects: 'Проектные задачи',
  events: 'События',
  decisions: 'Решения',
  ask: 'Спросить Оркестратора'
}

function storageKeyForUser(userId: string): string {
  const suffix = userId.trim() || 'default'
  return `${TODAY_LAYOUT_STORAGE_KEY}:${suffix}`
}

function cloneDefaultLayout(): LayoutItem[] {
  return DEFAULT_TODAY_WIDGET_LAYOUT.map((item) => ({ ...item }))
}

function isTodayWidgetId(id: string): id is TodayWidgetId {
  return (TODAY_WIDGET_IDS as readonly string[]).includes(id)
}

function clampLayoutItem(item: LayoutItem, defaults: LayoutItem): LayoutItem {
  const minW = defaults.minW ?? 1
  const minH = defaults.minH ?? 1
  const maxW = Math.min(defaults.maxW ?? TODAY_GRID_COLS, TODAY_GRID_COLS)
  const maxH = Math.min(defaults.maxH ?? TODAY_GRID_LAYOUT_MAX_ROWS, TODAY_GRID_LAYOUT_MAX_ROWS)

  let w = typeof item.w === 'number' ? Math.round(item.w) : defaults.w
  let h = typeof item.h === 'number' ? Math.round(item.h) : defaults.h
  let x = typeof item.x === 'number' ? Math.round(item.x) : defaults.x
  let y = typeof item.y === 'number' ? Math.round(item.y) : defaults.y

  w = Math.max(minW, Math.min(maxW, w))
  h = Math.max(minH, Math.min(maxH, h))
  x = Math.max(0, Math.min(TODAY_GRID_COLS - w, x))
  y = Math.max(0, Math.min(TODAY_GRID_LAYOUT_MAX_ROWS - h, y))

  return { ...defaults, x, y, w, h }
}

function sanitizeLayout(raw: Layout | LayoutItem[] | undefined): LayoutItem[] {
  const base = cloneDefaultLayout()
  const list = raw ? [...raw] : []
  if (!list.length) return base

  const byId = new Map<string, LayoutItem>()
  for (const item of list) {
    if (item?.i && isTodayWidgetId(item.i)) {
      byId.set(item.i, item)
    }
  }

  return base.map((defaults) => {
    const saved = byId.get(defaults.i)
    if (!saved) return defaults
    return clampLayoutItem(saved, defaults)
  })
}

function sanitizeLocked(raw: Partial<Record<string, boolean>> | undefined): Partial<Record<TodayWidgetId, boolean>> {
  const locked: Partial<Record<TodayWidgetId, boolean>> = {}
  if (!raw) return locked
  for (const id of TODAY_WIDGET_IDS) {
    if (raw[id]) locked[id] = true
  }
  return locked
}

function readPersist(userId: string): TodayWidgetLayoutPersist {
  try {
    const raw = localStorage.getItem(storageKeyForUser(userId))
    if (!raw) {
      return { layout: cloneDefaultLayout(), locked: {} }
    }
    const parsed = JSON.parse(raw) as TodayWidgetLayoutPersist
    return {
      layout: sanitizeLayout(parsed.layout),
      locked: sanitizeLocked(parsed.locked)
    }
  } catch {
    return { layout: cloneDefaultLayout(), locked: {} }
  }
}

function writePersist(userId: string, state: TodayWidgetLayoutPersist): void {
  try {
    localStorage.setItem(storageKeyForUser(userId), JSON.stringify(state))
  } catch {
    /* ignore quota */
  }
}

export function applyTodayLayoutStaticFlags(
  layout: LayoutItem[],
  _editMode: boolean,
  locked: Partial<Record<TodayWidgetId, boolean>>
): LayoutItem[] {
  return layout.map((item) => ({
    ...item,
    static: Boolean(locked[item.i as TodayWidgetId])
  }))
}

export function useTodayWidgetLayout(userId: string): {
  layout: LayoutItem[]
  layoutWithStatic: LayoutItem[]
  locked: Partial<Record<TodayWidgetId, boolean>>
  editMode: boolean
  setEditMode: (value: boolean | ((prev: boolean) => boolean)) => void
  onLayoutChange: (next: Layout) => void
  toggleWidgetLock: (id: TodayWidgetId) => void
  resetLayout: () => void
} {
  const [persist, setPersist] = useState(() => readPersist(userId))
  const [editMode, setEditModeState] = useState(false)
  const layoutRef = useRef(persist.layout)
  const lockedRef = useRef(persist.locked)

  useEffect(() => {
    const next = readPersist(userId)
    setPersist(next)
    layoutRef.current = next.layout
    lockedRef.current = next.locked
    setEditModeState(false)
  }, [userId])

  const layout = persist.layout
  const locked = persist.locked

  useEffect(() => {
    layoutRef.current = layout
    lockedRef.current = locked
  }, [layout, locked])

  const persistState = useCallback(
    (next: TodayWidgetLayoutPersist) => {
      layoutRef.current = next.layout
      setPersist(next)
      writePersist(userId, next)
    },
    [userId]
  )

  const onLayoutChange = useCallback(
    (next: Layout) => {
      persistState({ layout: sanitizeLayout(next), locked })
    },
    [locked, persistState]
  )

  const setEditMode = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      setEditModeState((prev) => {
        const next = typeof value === 'function' ? value(prev) : value
        if (prev && !next) {
          persistState({ layout: layoutRef.current, locked: lockedRef.current })
        }
        return next
      })
    },
    [persistState]
  )

  const toggleWidgetLock = useCallback(
    (id: TodayWidgetId) => {
      const nextLocked = { ...locked, [id]: !locked[id] }
      if (!nextLocked[id]) delete nextLocked[id]
      persistState({ layout, locked: nextLocked })
    },
    [layout, locked, persistState]
  )

  const resetLayout = useCallback(() => {
    persistState({ layout: cloneDefaultLayout(), locked: {} })
  }, [persistState])

  const layoutWithStatic = useMemo(
    () => applyTodayLayoutStaticFlags(layout, editMode, locked),
    [layout, editMode, locked]
  )

  return {
    layout,
    layoutWithStatic,
    locked,
    editMode,
    setEditMode,
    onLayoutChange,
    toggleWidgetLock,
    resetLayout
  }
}
