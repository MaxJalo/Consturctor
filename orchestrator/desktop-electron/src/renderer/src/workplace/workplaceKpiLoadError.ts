import { ApiError } from '../api/types'

const KPI_BACKEND_STARTING =
  'Запускаем локальный backend… Подождите несколько секунд и обновите вкладку KPI.'

const KPI_BACKEND_UNAVAILABLE =
  'Не удалось загрузить KPI. Проверьте orchestrator\\backend (run_dev.bat) и что порт 7812 свободен, либо дождитесь обновления LAN gateway.'

function isNotFoundDetail(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  return normalized === 'not found' || normalized === 'not found.'
}

export function shouldUseWorkplaceKpiReferenceFallback(err: unknown): boolean {
  if (!import.meta.env.DEV) return false
  const flag = String(import.meta.env.VITE_WORKPLACE_KPI_OFFLINE_FALLBACK ?? '1')
    .trim()
    .toLowerCase()
  if (flag === '0' || flag === 'false' || flag === 'no') return false
  if (err instanceof ApiError) {
    if (err.status === 404 || isNotFoundDetail(err.message)) return true
    if (err.status === 0 && /не удалось подключиться к backend/i.test(err.message)) return true
  }
  if (err instanceof Error && isNotFoundDetail(err.message)) return true
  return false
}

export function formatWorkplaceKpiLoadError(err: unknown, fallback = 'Не удалось загрузить KPI'): string {
  if (err instanceof ApiError) {
    if (err.status === 404 || isNotFoundDetail(err.message)) {
      return KPI_BACKEND_STARTING
    }
    if (err.status === 0 && /не удалось подключиться/i.test(err.message)) {
      return KPI_BACKEND_UNAVAILABLE
    }
    if (err.status === 401) {
      return 'Требуется авторизация (401). Перелогиньтесь в приложении.'
    }
    if (err.message.trim() && !isNotFoundDetail(err.message)) {
      return err.message
    }
  }
  if (err instanceof Error && err.message.trim()) {
    if (isNotFoundDetail(err.message)) return KPI_BACKEND_UNAVAILABLE
    return err.message
  }
  return fallback
}
