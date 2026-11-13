import type {
  AgentMode,
  ChatKind,
  ModelParam,
  ModelSpec,
  SessionEvent,
  SkillSpec
} from '../api/types'
import type { ExternalOrderBrief } from '../../extensions/externalOrder/externalOrderTypes'
import type { AgentChatContext, ServiceGap } from '../../pages/agentChat'
import type { OrderCaseBrief } from '../../pages/orderCaseBrief'
import type { PendingFile } from './SessionAttachments'

export interface UnifiedChatTarget {
  workflowId: string
  conversationKey: string
  conversationPrefix?: string
  chatKind: ChatKind
  title: string
  initialPrompt?: string
  shown?: string
  appContext?: string
  orderChat?: AgentChatContext
  fresh?: boolean
  mode?: AgentMode
  skillIds?: string[]
}

export interface MentionItem {
  id: string
  kind: 'skill' | 'order' | 'file' | 'system'
  label: string
  detail: string
  token: string
  skillId?: string
}

export interface ModelChoice {
  key: string
  label: string
  model: string
  params: ModelParam[]
}

function parseJson(raw: string): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function mcpToolName(event: SessionEvent): string {
  if (event.name !== 'mcp') return event.name
  const raw = String(asObject(parseJson(event.args)).toolName || '')
  return raw.replace(/^(?:custom-user-tools|turbotester|constructor)[-_.]+/i, '').replaceAll('__', '.')
}

function mcpResultObject(event: SessionEvent): Record<string, unknown> | null {
  if (event.type !== 'tool') return null
  const result = asObject(parseJson(event.result))
  const value = asObject(result.value)
  if (value.isError === true) return null
  const content = Array.isArray(value.content) ? value.content : []
  const text = content
    .map((item) => {
      const rec = asObject(item)
      if (typeof rec.text === 'string') return rec.text
      return typeof asObject(rec.text).text === 'string' ? String(asObject(rec.text).text) : ''
    })
    .join('\n')
    .trim()
  const parsed = parseJson(text)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
}

export function offersFromSessionEvents(events: SessionEvent[]): Record<string, string[]> {
  const offers: Record<string, string[]> = {}
  for (const event of events) {
    if (event.type !== 'tool') continue
    const obj = mcpResultObject(event)
    if (!obj || !Array.isArray(obj.offers)) continue
    for (const row of obj.offers) {
      if (!row || typeof row !== 'object') continue
      const rec = row as { id?: unknown; options?: unknown }
      const id = String(rec.id || '')
      if (!id || !Array.isArray(rec.options)) continue
      offers[id] = rec.options.map((opt) => String(opt || '').trim()).filter(Boolean)
    }
  }
  return offers
}

export function gapsFromSessionEvents(events: SessionEvent[]): ServiceGap[] | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event.type !== 'tool') continue
    const obj = mcpResultObject(event)
    if (!obj || !Array.isArray(obj.questions) || !obj.questions.length) continue
    const gaps: ServiceGap[] = []
    for (const row of obj.questions) {
      if (!row || typeof row !== 'object') continue
      const rec = row as { id?: unknown; field?: unknown; prompt?: unknown }
      const id = String(rec.id || '')
      const prompt = String(rec.prompt || '').trim()
      if (!id || !prompt) continue
      gaps.push({ id, field: String(rec.field || id), prompt })
    }
    if (gaps.length) return gaps
  }
  return null
}

export function liveCaseBriefFromEvents(
  events: SessionEvent[],
  fallback: OrderCaseBrief | null
): OrderCaseBrief | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (event.type !== 'tool' || mcpToolName(event) !== 'external_order.case') continue
    const obj = mcpResultObject(event)
    if (!obj) continue
    const orderObj = asObject(obj.order)
    const filled = Array.isArray(obj.known)
      ? obj.known
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            label: String(item.label || item.field || ''),
            value: String(item.value || '')
          }))
          .filter((item) => item.label && item.value)
      : fallback?.filled ?? []
    const drafts = Array.isArray(obj.proposals)
      ? obj.proposals
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
          .map((item) => ({
            id: String(item.id || ''),
            label: String(item.label || item.field || ''),
            value: String(item.value || '')
          }))
          .filter((item) => item.label || item.value)
      : fallback?.drafts ?? []
    return {
      code: String(orderObj.code || fallback?.code || ''),
      customer: String(orderObj.customer || fallback?.customer || ''),
      product: String(orderObj.product || fallback?.product || ''),
      summary: String(obj.summary || fallback?.summary || ''),
      facts: Array.isArray(obj.facts) ? obj.facts.map((x) => String(x || '')).filter(Boolean) : fallback?.facts ?? [],
      questions: Array.isArray(obj.questions)
        ? obj.questions
            .map((q) => (q && typeof q === 'object' ? String((q as { prompt?: unknown }).prompt || '') : String(q || '')))
            .filter(Boolean)
        : fallback?.questions ?? [],
      proposalCount: drafts.length || (fallback?.proposalCount ?? 0),
      filled,
      drafts,
      otherDrafts: Number(obj.other_proposals ?? fallback?.otherDrafts ?? 0),
      checks: String(obj.checks_summary || fallback?.checks || ''),
      blocker: String(obj.blocker || fallback?.blocker || ''),
      error: String(obj.error || '')
    }
  }
  return fallback
}

export function buildModelChoices(models: ModelSpec[]): ModelChoice[] {
  const choices: ModelChoice[] = []
  for (const model of models) {
    const variants = model.variants ?? []
    if (variants.length > 0) {
      for (const variant of variants) {
        const key = `${model.id}::${variant.params.map((p) => `${p.id}=${p.value}`).join(',')}`
        choices.push({
          key,
          label: variant.displayName || model.displayName,
          model: model.id,
          params: variant.params
        })
      }
      continue
    }
    const params: ModelParam[] = []
    for (const def of model.parameters ?? []) {
      const defVal = def.values.find((v) => v.value === 'xhigh' || v.value === 'high' || v.value === 'true') ?? def.values[0]
      if (defVal) params.push({ id: def.id, value: defVal.value })
    }
    choices.push({
      key: `${model.id}::default`,
      label: model.displayName || model.id,
      model: model.id,
      params
    })
  }
  return choices
}

export function buildMentionItems(params: {
  query: string
  skills: SkillSpec[]
  files: PendingFile[]
  orderChat?: AgentChatContext
  orders?: ExternalOrderBrief[]
}): MentionItem[] {
  const q = params.query.trim().toLowerCase()
  const items: MentionItem[] = []
  const seenOrderIds = new Set<string>()

  if (params.orderChat) {
    const o = params.orderChat.order
    seenOrderIds.add(o.id)
    items.push({
      id: `order:${o.id}`,
      kind: 'order',
      label: `Заказ ${o.code || o.id}`,
      detail: [o.customer, o.stageLabel].filter(Boolean).join(' · '),
      token: `@[Заказ ${o.code || o.id}](order:${o.id}) `
    })
  }

  for (const ord of params.orders ?? []) {
    if (!ord.id || seenOrderIds.has(ord.id)) continue
    seenOrderIds.add(ord.id)
    const label = `Заказ ${ord.code || ord.onec_tkp_number || ord.id}`
    items.push({
      id: `order:${ord.id}`,
      kind: 'order',
      label,
      detail: [ord.customer, ord.product].filter(Boolean).join(' · ') || 'Внешний заказ',
      token: `@[${label}](order:${ord.id}) `
    })
  }

  for (const file of params.files) {
    items.push({
      id: `file:${file.id}`,
      kind: 'file',
      label: file.file.name,
      detail: 'Приложенный файл',
      token: `@[${file.file.name}](file:${file.file.name}) `
    })
  }

  items.push(
    {
      id: 'sys:1c',
      kind: 'system',
      label: '1С (задачи и документы)',
      detail: 'Проверить через инструменты onec.*',
      token: '@[1С](system:onec) '
    },
    {
      id: 'sys:mail',
      kind: 'system',
      label: 'Почта и календарь Outlook',
      detail: 'Поиск писем и встреч',
      token: '@[Outlook](system:outlook) '
    }
  )

  for (const skill of params.skills) {
    items.push({
      id: `skill:${skill.id}`,
      kind: 'skill',
      label: skill.title || skill.id,
      detail: skill.description || `Скилл · ${skill.id}`,
      token: `@[${skill.title || skill.id}](skill:${skill.id}) `,
      skillId: skill.id
    })
  }

  if (!q) return items.slice(0, 12)
  return items
    .filter((item) => {
      const hay = `${item.label} ${item.detail} ${item.id}`.toLowerCase()
      return hay.includes(q)
    })
    .slice(0, 12)
}

export interface OrderStartAction {
  id: string
  skillId: string
  title: string
  prompt: string
}

function orderAction(id: string, skillId: string, title: string, prompt: string): OrderStartAction {
  return { id, skillId, title, prompt }
}

/** Действия пустого чата заказа: у каждой службы свой список. */
export function orderStartActions(role: string, code: string): OrderStartAction[] {
  const number = code.trim() || 'заказ'
  const open = orderAction(
    'order',
    `order-${role}`,
    `Разобрать заказ ${number}`,
    `Разбери заказ ${number}. Кратко: что уже сделано, что сделать сейчас и что блокирует переход. Черновики запиши в дело, фактом они станут после «Принять».`
  )
  const byRole: Record<string, OrderStartAction[]> = {
    ks: [
      orderAction('tech', 'tech-check', 'Техническая проверка', `Сделай техническую проверку заказа ${number} по прошлым заказам клиента в 1С. Правки только черновиком.`),
      orderAction('zpr', 'zpr-analysis', 'Анализ ЗПР', `Проверь полноту ЗПР заказа ${number}: заказчик, изделие, количество, срок, ТЗ и вложения. Маршрут и правки — черновик.`)
    ],
    development: [
      orderAction('tech', 'tech-check', 'Техническая проверка', `Сделай техническую проверку заказа ${number} по прошлым заказам клиента в 1С. Правки только черновиком.`),
      orderAction('zpr', 'zpr-analysis', 'Анализ ЗПР', `Проверь полноту ЗПР заказа ${number}: заказчик, изделие, количество, срок, ТЗ и вложения. Маршрут и правки — черновик.`)
    ],
    production: [
      orderAction('tkp', 'production-tkp', 'Сделать ТКП', `Сделай черновик ТКП по заказу ${number} из ЗПР и протокола. Если протокола нет, спроси, продолжать ли только по ЗПР.`),
      orderAction('contract', 'production-contract', 'Сделать договор', `Сделай черновик договора и заказа клиента по принятому ТКП заказа ${number}. Если ТКП не принято, остановись.`),
      orderAction('plan', 'production-plan', 'План заказа', `Собери план заказа ${number}: XML в дело и .mpp. Пустые условия договора пометь, не выдумывай.`)
    ],
    committee: [
      orderAction('protocol', 'committee-protocol', 'Сделать протокол', `Подготовь совещание и черновик протокола 1С по заказу ${number}. Участников спроси, если их ещё нет.`)
    ],
    finance: [
      orderAction('calc', 'order-finance', 'Сделать расчёт', `Сделай черновик расчёта заказа ${number}: МЦР, себестоимость, маржа, резерв и БДДС. Суммы не выдумывай.`)
    ],
    omto: [
      orderAction('supply', 'order-omto', 'Цены и сроки поставки', `Проверь цены, сроки и критические позиции поставки по заказу ${number}. Закупку не проводи.`)
    ],
    kb: [
      orderAction('kd', 'order-kb', 'Состав и КД', `Проверь состав, конструкторскую документацию, аналоги и ограничения заказа ${number}. Чужие заключения не пиши.`)
    ],
    rp: [
      orderAction('risks', 'order-rp', 'План, сроки и риски', `Собери по заказу ${number}, что сделать по плану, критическому пути и рискам. Стадию не переводи.`)
    ],
    legal: [
      orderAction('law', 'order-legal', 'Проверка договора', `Проверь санкции, гарантию и ответственность по договору заказа ${number}. Цену не утверждай.`)
    ],
    it: [
      orderAction('integrations', 'order-it', 'Журнал и интеграции', `Проверь по заказу ${number} журнал, интеграции и блокировки. Бизнес-решения не подтверждай.`)
    ]
  }
  return [open, ...(byRole[role] || [])]
}

export function extractMentionContext(text: string): {
  skillIds: string[]
  notes: string[]
} {
  const skillIds: string[] = []
  const notes: string[] = []
  const re = /@\[([^\]]+)\]\((skill|order|file|system):([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const [, label, kind, ref] = match
    if (kind === 'skill') {
      if (!skillIds.includes(ref)) skillIds.push(ref)
      notes.push(`Примени скилл \`${ref}\` (${label}).`)
    } else if (kind === 'order') {
      notes.push(`Упомянут заказ: ${label} (order_id=${ref}).`)
    } else if (kind === 'system') {
      notes.push(`Используй данные системы: ${label} (${ref}).`)
    }
  }
  return { skillIds, notes }
}
