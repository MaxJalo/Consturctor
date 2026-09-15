import { useGridRefreshGeneration } from './GridDataRefreshContext'

/**
 * Счётчик для повторной загрузки live-данных: смена пользователя (App provider),
 * возврат в приложение (focus после blur / visibility), интервал 10 мин.
 * Смена вкладки не поднимает tick — см. gridDataCache + SpecV04SourcesProvider.
 */
export function useGridDataRefresh(scopeKey?: string): number {
  return useGridRefreshGeneration(scopeKey)
}
