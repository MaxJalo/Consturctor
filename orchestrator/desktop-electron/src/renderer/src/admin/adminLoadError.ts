import { ApiError } from '../api/types'

const ADMIN_API_MISSING =
  'Admin API не развёрнут на gateway (HTTP 404).\n' +
  'Пересоберите и задеплойте constructor-gateway из orchestrator/backend (коммит ≥ 6d0e958).\n' +
  'Проверка: GET /api/v1/admin/overview — должен отвечать 401 без токена, не 404.\n' +
  'Для dev без деплоя LAN: BACKEND_URL=http://127.0.0.1:7812 и orchestrator\\backend\\run_dev.bat.'

function isNotFoundDetail(message: string): boolean {
  const normalized = message.trim().toLowerCase()
  return normalized === 'not found' || normalized === 'not found.'
}

export function formatAdminLoadError(err: unknown, fallback = 'Не удалось загрузить данные'): string {
  if (err instanceof ApiError) {
    if (err.status === 404 || isNotFoundDetail(err.message)) {
      return ADMIN_API_MISSING
    }
    if (err.status === 403) {
      return 'Доступ только для администратора (403). Войдите под учётной записью из списка admin FIO.'
    }
    if (err.status === 401) {
      return 'Требуется авторизация (401). Перелогиньтесь в приложении.'
    }
    if (err.message.trim()) {
      return err.message
    }
  }
  if (err instanceof Error && err.message.trim()) {
    if (isNotFoundDetail(err.message)) {
      return ADMIN_API_MISSING
    }
    return err.message
  }
  return fallback
}
