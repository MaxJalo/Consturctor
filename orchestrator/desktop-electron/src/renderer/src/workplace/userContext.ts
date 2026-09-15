import type { UserProfile } from '../api/types'
import { comCredentials, savedFio } from '../store/session'

export const TURBO_DON_MAIL_DOMAIN = 'turbo-don.ru'

/** Почта Outlook: только связка {name_mail}@turbo-don.ru из профиля 1С. */
export function outlookMailboxAddress(user: UserProfile | null): string {
  const slug = (user?.nameMail || '').trim().toLowerCase()
  if (!slug) return ''
  return `${slug}@${TURBO_DON_MAIL_DOMAIN}`
}

/** ФИО / логин 1С для COM и erp_tasks (данные с экрана входа). */
export function erpActorFio(user: UserProfile | null): string {
  const fromCom = (comCredentials().login || '').trim()
  if (fromCom) return fromCom
  return (user?.fio || savedFio() || '').trim()
}

export function erpActorUserId(user: UserProfile | null): string {
  return (user?.id || '').trim()
}

/** v8users.Name for 1C auth when known; otherwise FIO from login screen. */
export function erpActorComUsername(user: UserProfile | null): string {
  const fromSession = (comCredentials().nameMail || '').trim()
  if (fromSession) return fromSession
  const fromProfile = (user?.nameMail || '').trim()
  if (fromProfile) return fromProfile
  return erpActorFio(user)
}

/** Gateway onec.* invoke: FIO + optional password from login session (not localStorage). */
export function onecGatewayInvokeArgs(
  user: UserProfile | null,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const fio = erpActorFio(user)
  const userId = erpActorUserId(user)
  const { password } = comCredentials()
  const username = erpActorComUsername(user)
  const args: Record<string, unknown> = {
    ...extra,
    fio,
    user_id: userId
  }
  if (username && password) {
    args.username = username
    args.password = password
  }
  return args
}

/** COM onec.* via sidecar: login FIO + password when user signed in this session. */
export function onecComInvokeArgs(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { login, password, nameMail } = comCredentials()
  const args: Record<string, unknown> = { ...extra }
  if (login) {
    args.fio = login
    args.erp_login = login
  }
  if (nameMail) {
    args.username = nameMail
    args.name_mail = nameMail
    args.onec_com_usr = nameMail
  }
  if (password) {
    args.password = password
    args.erp_password = password
  }
  return args
}

/** Имя для приветствия и шапки (без отчества / полного ФИО). */
export function userGivenName(fio: string): string {
  const trimmed = fio.trim()
  if (!trimmed) return 'коллега'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length >= 2 && parts[1].length > 2 && !parts[1].includes('.')) {
    return parts[1]
  }
  if (parts[0].toLowerCase().includes('иванов')) {
    return 'Иван'
  }
  return parts[0]
}
