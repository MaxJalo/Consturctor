/** TurboProject недоступен: нет сервисной учётки или ошибка авторизации API. */
export function isTurboNoSessionError(message: string): boolean {
  const text = (message || '').trim().toLowerCase()
  if (!text) return false
  if (/stub|not configured|не настроен/.test(text)) return true
  return (
    /turboproject/.test(text) &&
    (/401|403|login|token|auth|unauthorized|password|учёт|войти|не удалось войти/.test(text) ||
      (text.includes('недоступ') && text.includes('turboproject')))
  )
}
