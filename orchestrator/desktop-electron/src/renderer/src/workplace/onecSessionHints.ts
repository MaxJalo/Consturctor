import { hasComPassword } from '../store/session'

/** Dev-only suffix for empty 1C states (no password value). */
export function comPasswordSessionHint(): string {
  return `Пароль 1С в сессии: ${hasComPassword() ? 'да' : 'нет'}`
}

export function missingComPasswordMessage(): string {
  return (
    'Войдите с паролем 1С — после восстановления сеанса по JWT пароль не сохраняется. ' +
    'Выйдите и войдите снова или перезапустите приложение и введите пароль на экране входа.'
  )
}

export function formatComToolError(message: string): string {
  const text = (message || '').trim()
  if (!text) return ''
  if (/не удалось открыть сеанс|неверно указан пользователь|неверный логин|402|password/i.test(text)) {
    return `${text} ${comPasswordSessionHint()}`
  }
  return text
}

/** COM / gateway / OData signals that 1C credentials or session must be re-entered. */
export function isOneCAuthFailure(...chunks: (string | undefined | null)[]): boolean {
  const text = chunks
    .filter(Boolean)
    .map((chunk) => String(chunk).trim())
    .join(' ')
    .trim()
  if (!text) return false
  if (/Войдите с паролем 1С|пароль не сохраняется|Пароль 1С в сессии: нет/i.test(text)) {
    return true
  }
  if (/Gateway отклонил запрос \(401\)|\b401\b|\b402\b|unauthorized|отклонил учётку/i.test(text)) {
    return true
  }
  if (/не удалось открыть сеанс|неверно указан пользователь|неверный логин|неверный пароль|authentication/i.test(text)) {
    return true
  }
  if (/docflow|документооборот|odata/i.test(text) && /401|402|отклон|auth|парол|учётк|unauthorized/i.test(text)) {
    return true
  }
  return false
}

/** 1C may ask for a second authorization step after the first password. */
export function isDoubleOneCAuthHint(...chunks: (string | undefined | null)[]): boolean {
  const text = chunks
    .filter(Boolean)
    .map((chunk) => String(chunk).trim())
    .join(' ')
    .trim()
  if (!text) return false
  return /двойн|double.?auth|second.?factor|повторн.*авториз|402|второй.*парол|two.?step/i.test(text)
}

export function formatGatewayToolError(message: string, status = 0): string {
  const text = (message || '').trim()
  if (status === 401) {
    return (
      'Gateway отклонил запрос (401). Обновите constructor-gateway на сервере ' +
      'и войдите в Orchestrator с паролем 1С. ' +
      (text ? `(${text})` : '')
    )
  }
  if (/401|402|unauthorized|отклонил учётку/i.test(text)) {
    if (/обновите|gateway/i.test(text)) return text
    return `${text} Если ошибка повторяется — обновите gateway и проверьте пароль 1С в сессии (${comPasswordSessionHint()}).`
  }
  return text
}

export function stubSourceMessage(source: string): string {
  const key = (source || '').trim().toLowerCase()
  if (key !== 'stub') return ''
  return (
    'Gateway вернул stub (нет ERP SQL / OData на сервере). ' +
    'Проверьте backend на 7812 или дождитесь COM-fallback (desktop + sidecar).'
  )
}

export function enrichEmptyOneCErrors(
  erpError: string,
  opts: {
    erpSource?: string
    docSource?: string
    mergedCount: number
  }
): string {
  if (opts.mergedCount > 0) return erpError
  const parts: string[] = []
  if (!hasComPassword()) parts.push(missingComPasswordMessage())
  const stubErp = stubSourceMessage(opts.erpSource || '')
  const stubDoc = stubSourceMessage(opts.docSource || '')
  if (stubErp) parts.push(stubErp)
  if (stubDoc && stubDoc !== stubErp) parts.push(stubDoc)
  if (erpError.trim()) parts.push(erpError.trim())
  const joined = parts.join(' · ')
  return joined || `Нет задач 1С. ${comPasswordSessionHint()}`
}
