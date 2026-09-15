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
