/** Разрешать действия агента без карточки «Нужно ваше решение». Хранится на этом компьютере. */

const KEY = 'orchestrator.settings.alwaysAllowActions'

export const ALWAYS_ALLOW_EVENT = 'orchestrator:always-allow-actions'

export function readAlwaysAllowActions(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function writeAlwaysAllowActions(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // Настройка не критична: без хранилища снова спрашиваем каждый раз.
  }
  window.dispatchEvent(new CustomEvent(ALWAYS_ALLOW_EVENT))
}
