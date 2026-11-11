import type { OrderCaseBrief } from './orderCaseBrief'

/** Один пробел службы: пустое поле, пункт чек-листа или открытый пробел. */
export interface ServiceGap {
  id: string
  field: string
  prompt: string
}

/** Заказ, по которому идёт разговор с помощником службы (правая панель чата). */
export interface AgentChatOrder {
  id: string
  code: string
  customer: string
  product: string
  stage: string
  stageLabel: string
  role: string
  roleLabel: string
  blockers: string[]
}

/** Чат помощника внешнего заказа: один разговор на заказ, службу и этап. */
export interface AgentChatContext {
  conversationKey: string
  /** eo:{order}:{role}: — разговоры этой службы по заказу на всех этапах. */
  conversationPrefix: string
  order: AgentChatOrder
  /** Подписи этапов для вкладки «Прошлые этапы». */
  stageLabels?: Record<string, string>
  readOnly?: boolean
  /** Сводка уже открытой карточки. Видна до ответа агента. */
  caseBrief?: OrderCaseBrief
  /** Свои незакрытые пробелы. Кнопки рисует экран, не текст агента. */
  gaps?: ServiceGap[]
  /** Итог скрипта службы. Старая переписка его не подменяет. */
  outcome?: string
  /** Задание модели: пояснить готовый итог. В ленте не показывается. */
  explainTask?: string
}

export type RunAgentHandler = (
  workflowId: string,
  title: string,
  message: string,
  chat?: AgentChatContext
) => void

export function orderConversationPrefix(orderId: string, role: string): string {
  return `eo:${orderId}:${role}:`
}

export function orderConversationKey(orderId: string, role: string, stage: string, fresh = ''): string {
  const base = `${orderConversationPrefix(orderId, role)}${stage || 'none'}`
  return fresh ? `${base}~${fresh}` : base
}

export function stageOfConversation(key: string): string {
  return key.split(':').slice(3).join(':').split('~')[0]
}
