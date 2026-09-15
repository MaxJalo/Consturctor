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

export type ApiAuthErrorKind =
  | 'session_revoked'
  | 'invalid_token'
  | 'auth_required'
  | 'gateway_auth'
  | 'other'

/** Classify backend / gateway auth errors for UI and re-login policy. */
export function classifyApiAuthError(message: string, status = 0): ApiAuthErrorKind {
  const text = (message || '').trim()
  if (!text && status !== 401 && status !== 402) return 'other'
  if (/Сеанс завершён|session_replaced|другом устройств/i.test(text)) return 'session_revoked'
  if (/Недействительный токен|invalid token/i.test(text)) return 'invalid_token'
  if (/Требуется авторизация|authorization required/i.test(text)) return 'auth_required'
  if (/Неверный логин или пароль/i.test(text)) return 'other'
  if (
    /Gateway отклонил|отклонил учётку OData|OData документооборота|docflow.*401|документооборот.*отклон/i.test(
      text
    )
  ) {
    return 'gateway_auth'
  }
  if (status === 402) return 'gateway_auth'
  if (status === 401 && /gateway|odata|docflow|отклонил учётку/i.test(text)) return 'gateway_auth'
  return 'other'
}

/** True when the desktop should clear JWT and show the login form. */
export function shouldForceReLogin(message: string, status = 0): boolean {
  const kind = classifyApiAuthError(message, status)
  return kind === 'session_revoked' || kind === 'invalid_token' || kind === 'auth_required'
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
  if (
    /Сеанс Orchestrator завершён|JWT недействителен|Требуется авторизация/i.test(text)
  ) {
    return true
  }
  if (/Gateway\/OData отклонил|отклонил учётку OData|\b402\b|unauthorized|отклонил учётку/i.test(text)) {
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
  const kind = classifyApiAuthError(text, status)

  if (kind === 'session_revoked') {
    return (
      'Сеанс Orchestrator завершён (вход на другом устройстве или повторный вход). ' +
      'Войдите с паролем 1С снова.'
    )
  }
  if (kind === 'invalid_token') {
    return (
      'JWT недействителен или выдан другим backend (localhost vs LAN :7812). ' +
      'Выйдите и войдите снова; для dev используйте run_dev.bat backend и BACKEND_URL=http://127.0.0.1:7812.'
    )
  }
  if (kind === 'auth_required') {
    return 'Требуется авторизация — войдите с паролем 1С.'
  }
  if (kind === 'gateway_auth') {
    const code = status === 402 ? 402 : 401
    const tail = text && !/Gateway отклонил/i.test(text) ? ` (${text})` : ''
    return (
      `Gateway/OData отклонил запрос (${code}). Проверьте пароль 1С в сеансе и ODATA_* / DOCFLOW_* на backend. ` +
      `На старом LAN gateway обновите constructor-gateway.${tail} ${comPasswordSessionHint()}`
    )
  }
  if (status === 401 && text) {
    return `Доступ запрещён (401): ${text}`
  }
  if (status === 401) {
    return `Доступ запрещён (401). ${comPasswordSessionHint()}`
  }
  if (/401|402|unauthorized|отклонил учётку/i.test(text)) {
    if (/обновите|gateway/i.test(text)) return text
    return `${text} Если ошибка повторяется — проверьте пароль 1С (${comPasswordSessionHint()}).`
  }
  return text
}

/** Gateway/docflow hint strings must not appear as rows in the 1C task grid. */
export function isErpMetaHintRecord(task: Record<string, unknown>): boolean {
  const number = String(task.number || '').trim()
  if (/^\d{2}-[\wА-Яа-яЁё.-]+-\d{3,}$/i.test(number)) return false
  const title = String(task.title || number || '').trim()
  if (!title) return true
  if (
    /BACKEND_URL|127\.0\.0\.1:7812|192\.168\.\d+\.\d+:7812|LAN gateway|run_dev\.bat|erp_reachable|constructor-gateway устарел|VPN на вашем ПК/i.test(
      title
    )
  ) {
    return true
  }
  if (/Документооборот\s*\(\/doc\)|отклонил учётку OData|OData документооборота/i.test(title)) {
    return true
  }
  if (
    /Gateway\/SQL без задач|onec\.erp_tasks_current|erp_pm stub|Gateway вернул stub/i.test(title)
  ) {
    return true
  }
  if (/Войдите с паролем 1С|Пароль 1С в сессии/i.test(title)) return true
  return false
}

/** Docflow /doc OData rejection or missing DOCFLOW_* (not erp_pm SQL). */
export function isDocflowOdataWarning(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return false
  return /документооборот|\/doc\)|OData документооборота|DOCFLOW_ODATA|docflow/i.test(t)
}

export function formatDocflowSecondaryHint(warning: string): string {
  const w = (warning || '').trim()
  if (!w) return ''
  if (/^Документооборот \(доп\./i.test(w)) return w
  return `Документооборот (доп.): ${w}`
}

/** Desktop uses a private-LAN gateway (:7812); ERP SQL runs on that server, not on the PC. */
export function isLanBackendUrl(backendUrl: string): boolean {
  const url = (backendUrl || '').trim()
  if (!url) return false
  if (/127\.0\.0\.1|localhost/i.test(url)) return false
  return /:\/\/192\.168\.|:\/\/10\.|:\/\/172\.(1[6-9]|2\d|3[01])\./.test(url)
}

/** erp_reachable on gateway but onec.erp_tasks_current returns 0 — stale gateway image. */
export function lanGatewayZeroTasksHint(backendUrl: string): string {
  const host = (() => {
    try {
      return new URL(backendUrl).host
    } catch {
      return backendUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '') || '192.168.1.157:7812'
    }
  })()
  return (
    `1С на gateway (${host}) доступна (erp_reachable), но задач 0 — образ constructor-gateway устарел. ` +
    `Админу на сервере: пересоберите и задеплойте gateway из orchestrator/backend (коммит ≥ 6d0e958, fix _query_tasks в erp_tasks.py). ` +
    `VPN на вашем ПК для SQL не нужен. После деплоя — перезапуск контейнера и повторный вход в Orchestrator (JWT).`
  )
}

export function stubSourceMessage(source: string): string {
  const key = (source || '').trim().toLowerCase()
  if (key !== 'stub') return ''
  return (
    'Gateway вернул stub (нет ERP SQL / OData на сервере). ' +
    'Проверьте ERP_* на backend :7812. COM onec.search_tasks — только при VITE_ONEC_COM_TASKS_FALLBACK=1.'
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
