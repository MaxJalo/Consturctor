import { useGridRefreshGeneration } from './GridDataRefreshContext'

/**
 * Счётчик для повторной загрузки live-данных: смена пользователя,
 * кнопка обновить, интервал 10 мин. Фокус окна не поднимает tick:
 * в Electron blur срабатывает при клике в Cursor/DevTools и рвал Outlook/1C/Turbo.
 */
export function useGridDataRefresh(scopeKey?: string): number {
  return useGridRefreshGeneration(scopeKey)
}
