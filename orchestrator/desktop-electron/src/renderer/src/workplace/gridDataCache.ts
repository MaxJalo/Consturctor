/** TTL для live-данных сетки: повторный запрос при смене вкладки только если кэш старше этого интервала. */
export const GRID_DATA_TTL_MS = 600_000

type CacheEntry<T> = { data: T; fetchedAt: number }

const dataCache = new Map<string, CacheEntry<unknown>>()
const lastHandledGeneration = new Map<string, number>()

export function isGridDataStale(cacheKey: string, now = Date.now()): boolean {
  const entry = dataCache.get(cacheKey)
  if (!entry) return true
  return now - entry.fetchedAt > GRID_DATA_TTL_MS
}

export function readGridCache<T>(cacheKey: string): T | undefined {
  return dataCache.get(cacheKey)?.data as T | undefined
}

export function writeGridCache<T>(cacheKey: string, data: T, now = Date.now()): void {
  dataCache.set(cacheKey, { data, fetchedAt: now })
}

export function clearGridCacheForUser(userId: string): void {
  const prefix = `${userId}:`
  for (const key of [...dataCache.keys()]) {
    if (key.startsWith(prefix) || key.includes(`:${userId}:`)) {
      dataCache.delete(key)
      lastHandledGeneration.delete(key)
    }
  }
}

/**
 * true → нужен сетевой запрос; false → можно отдать кэш (если есть).
 * При смене generation (фокус, 10 мин, смена пользователя) — всегда fetch.
 */
export function shouldRunGridFetch(cacheKey: string, generation: number): boolean {
  const prevGen = lastHandledGeneration.get(cacheKey) ?? -1
  if (generation !== prevGen) {
    lastHandledGeneration.set(cacheKey, generation)
    return true
  }
  return isGridDataStale(cacheKey)
}
