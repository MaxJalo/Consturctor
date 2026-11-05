import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import type { UserProfile } from '../../api/types'
import { ApiError } from '../../api/types'
import { api } from '../../api/client'
import { OrchSlotMain } from '../../layout/GridSlots'
import { DocflowCreateDialog } from '../../tabs/grid/DocflowCreateDialog'
import { TodayFileIcon } from '../../tabs/grid/todayFileIcon'
import { invokeLocalAcTool } from '../../utils/localAcTool'
import {
  loadDocflowCreateSchema,
  type DocflowFormRequest,
  type DocflowKindSchema
} from '../../workplace/docflowDocumentCreate'
import { onecComInvokeArgs } from '../../workplace/userContext'
import { useExternalOrderDock } from './externalOrderDock'
import { PlanBuilder } from './externalOrderPlan'
import {
  GATES,
  HelperPanel,
  basisAdvice,
  formAdvice,
  LINE,
  ROLE_FIELDS,
  ROLE_NAME,
  buildRoleQuestions,
  buildStagePassports,
  formatFindingValue,
  humanFindingLabel,
  parseDraft1cFinding,
  type HelperPanelProps
} from './externalOrderReview'
import type {
  CopilotAiResult,
  CopilotQuestion,
  ExternalOnecFilters,
  ExternalOnecSearch,
  ExternalOnecTkp,
  ExternalOrder,
  ExternalOrderBrief,
  ExternalOrderMeta,
  ExternalOrderReview,
  ExternalOrderSimplifiedStep,
  StagePassport
} from './externalOrderTypes'
import {
  type AgentChatContext,
  type RunAgentHandler,
  orderConversationKey,
  orderConversationPrefix
} from '../../pages/agentChat'
import { briefFromLoadedOrder } from '../../pages/orderCaseBrief'
import './externalOrder.css'

const ROLE_KEY = 'orch.external-order.role'

const ROUTES: { id: string; label: string }[] = [
  { id: 'full', label: 'Полный' },
  { id: 'accelerated', label: 'Ускоренный' },
  { id: 'simplified', label: 'Упрощённый' },
  { id: 'recalc', label: 'Пересчёт' }
]

const MOVES: Record<string, { target: string; label: string }[]> = {
  ks: [
    { target: 'collecting', label: 'На комплектование' },
    { target: 'calculating', label: 'На расчёт' },
    { target: 'tkp_issued', label: 'Выпустить ТКП' },
    { target: 'contract_review', label: 'На согласование договора' },
    { target: 'contract_signed', label: 'Отметить подписание' },
    { target: 'shipped', label: 'Отгрузка' },
    { target: 'awaiting_payment', label: 'Ожидание оплаты' }
  ],
  development: [
    { target: 'collecting', label: 'На комплектование' },
    { target: 'calculating', label: 'На расчёт' },
    { target: 'ready_committee', label: 'Готово к Комитету' }
  ],
  committee: [
    { target: 'ready_committee', label: 'Готово к Комитету' },
    { target: 'rework', label: 'На доработку' }
  ],
  rp: [
    { target: 'calculating', label: 'На расчёт' },
    { target: 'in_progress', label: 'Проектный запуск' },
    { target: 'production', label: 'Производственный запуск' },
    { target: 'acceptance', label: 'Приёмка' },
    { target: 'shipped', label: 'Отгрузка' },
    { target: 'closed', label: 'Закрыть заказ' }
  ],
  production: [
    { target: 'production', label: 'Производственный запуск' },
    { target: 'acceptance', label: 'Приёмка' }
  ],
  finance: [{ target: 'awaiting_payment', label: 'Ожидание оплаты' }]
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  collecting: 'Комплектование',
  calculating: 'Расчёт',
  rework: 'Доработка',
  ready_committee: 'Готово к Комитету',
  confirmed: 'Подтверждено',
  confirmed_conditions: 'Подтверждено с условиями',
  tkp_issued: 'ТКП выпущено',
  contract_review: 'Согласование договора',
  contract_signed: 'Договор подписан',
  in_progress: 'Проектный запуск',
  production: 'Производство',
  acceptance: 'Приёмка',
  shipped: 'Отгружено',
  awaiting_payment: 'Ожидание оплаты',
  closed: 'Закрыт'
}

const STAGE_STATE: Record<StagePassport['state'], string> = {
  done: 'пройдено',
  current: 'сейчас',
  blocked: 'есть блокер',
  upcoming: 'ожидает'
}

const AUDIT_ACTIONS: Record<string, string> = {
  create: 'Создание',
  route: 'Маршрут',
  patch: 'Изменение карточки',
  blocked: 'Переход заблокирован',
  transition: 'Переход этапа',
  confirm_check: 'Подтверждение пункта',
  close_diff: 'Закрытие расхождения',
  close_gap: 'Закрытие пробела',
  risk: 'Риск',
  decision: 'Решение Комитета',
  conditions_rejected: 'Условия не закрыты',
  document: 'Документ',
  propose: 'Черновики агента',
  accept_finding: 'Черновик принят',
  reject_finding: 'Черновик отклонён',
  draft_1c: 'Проект 1С ДО',
  copilot_answer: 'Ответ помощнику',
  copilot_message: 'Уточнение помощнику',
  onec_refresh: 'Путь из 1С'
}

const LINE_CHANGES: Record<string, string> = {
  added: 'добавлено',
  removed: 'удалено',
  qty: 'изменено количество',
  amount: 'изменена сумма'
}

const COMMITTEE_AGENDA: { id: string; title: string; statuses: string[] }[] = [
  { id: 'calc', title: 'На расчёте', statuses: ['calculating', 'rework'] },
  { id: 'ready', title: 'Готовы к Комитету', statuses: ['ready_committee'] },
  { id: 'conditions', title: 'С открытыми условиями', statuses: ['confirmed_conditions'] }
]

const DOC_TITLE_KEYS = ['Заголовок', 'Наименование', 'ТемаСлужебнойЗаписки', 'Тема']
const DOC_TEXT_KEYS = ['Содержание', 'Описание', 'Текст']

const UPLOAD_ROLES = new Set(['ks', 'development', 'rp', 'legal', 'kb', 'finance', 'omto', 'production', 'committee'])
const RISK_ROLES = new Set(['rp', 'ks', 'production', 'finance'])
const OWNER_ROLES = new Set(['ks', 'development', 'rp'])
const BASELINE_ROLES = new Set(['ks', 'finance', 'rp', 'committee'])

const FILE_KINDS: { id: string; label: string }[] = [
  { id: 'tz', label: 'ТЗ' },
  { id: 'tkp', label: 'ТКП' },
  { id: 'contract', label: 'Договор' },
  { id: 'specification', label: 'Спецификация' },
  { id: 'survey', label: 'Опросный лист' },
  { id: 'protocol', label: 'Протокол' },
  { id: 'assignment', label: 'Поручение' },
  { id: 'memo', label: 'Служебная записка' },
  { id: 'directive', label: 'Распоряжение' },
  { id: 'decree', label: 'Приказ' },
  { id: 'customer_order', label: 'Заказ' },
  { id: 'attached', label: 'Прикреплённый файл' },
  { id: 'condition', label: 'Заключение' },
  { id: 'acceptance', label: 'Приёмка' },
  { id: 'plan', label: 'План работ' },
  { id: 'correspondence', label: 'Переписка' },
  { id: 'other', label: 'Другой документ' }
]

function guessFileKind(name: string): string {
  const folded = name.toLowerCase().replace(/ё/g, 'е')
  if (folded.includes('опрос')) return 'survey'
  if (folded.includes('протокол')) return 'protocol'
  if (folded.includes('поручен')) return 'assignment'
  if (folded.includes('записк')) return 'memo'
  if (folded.includes('распоряж')) return 'directive'
  if (folded.includes('приказ')) return 'decree'
  if (folded.includes('заказ')) return 'customer_order'
  if (folded.includes('ткп') || folded.includes('tkp')) return 'tkp'
  if (folded.includes('договор')) return 'contract'
  if (folded.includes('специф')) return 'specification'
  if (/(^|[^а-я])тз([^а-я]|$)/.test(folded) || folded.includes('tz')) return 'tz'
  if (folded.includes('план')) return 'plan'
  if (folded.includes('прием')) return 'acceptance'
  if (folded.includes('заключен')) return 'condition'
  return ''
}

const FILE_RELATIONS: { id: string; label: string }[] = [
  { id: 'attachment', label: 'приложение' },
  { id: 'basis', label: 'основание' },
  { id: 'supersedes', label: 'заменяет' },
  { id: 'confirms', label: 'подтверждает' },
  { id: 'contradicts', label: 'противоречит' },
  { id: 'version', label: 'версия' }
]

type FileScenario = { id: string; group: string; label: string; ask: string }

const FILE_SCENARIOS: FileScenario[] = [
  { id: 'changes', group: 'Сводка', label: 'Что изменилось', ask: 'Что изменилось между связанными файлами и их версиями.' },
  { id: 'blockers', group: 'Сводка', label: 'Что блокирует', ask: 'Что блокирует переход и какой файл или пункт это держит.' },
  { id: 'overdue', group: 'Сводка', label: 'Что просрочено', ask: 'Что просрочено: пункт, файл, срок или ожидаемое действие.' },
  { id: 'decisions', group: 'Сводка', label: 'Какие решения нужны', ask: 'Какие решения нужны и кто их принимает. Сам решение не принимай.' },
  { id: 'week', group: 'Сводка', label: 'Что на этой неделе', ask: 'Что должно произойти на этой неделе по срокам дела и связанным файлам.' },
  { id: 'letter', group: 'Проект', label: 'Письмо заказчику', ask: 'Подготовь проект письма заказчику по файлам дела.' },
  { id: 'request', group: 'Проект', label: 'Запрос данных', ask: 'Подготовь проект запроса недостающих данных. Чего нет — списком пробелов.' },
  { id: 'protocol', group: 'Проект', label: 'Протокол', ask: 'Подготовь проект протокола по тому, что уже есть в деле.' },
  { id: 'disagreements', group: 'Проект', label: 'Лист разногласий', ask: 'Подготовь проект листа разногласий по связанным файлам.' },
  { id: 'memo', group: 'Проект', label: 'Служебная записка', ask: 'Подготовь проект служебной записки по делу.' },
  { id: 'report', group: 'Проект', label: 'Отчёт', ask: 'Подготовь проект короткого отчёта по делу.' },
  { id: 'why', group: 'Пояснение', label: 'Почему так', ask: 'Объясни причину каждого вывода, правила и блокировки. Откуда это в файле.' },
  { id: 'missing', group: 'Пояснение', label: 'Чего не хватает', ask: 'Если данных не хватает — не отвечай догадкой. Перечисли пробелы: файл, связь или поле.' },
  { id: 'facts', group: 'Граница', label: 'Что факт, а что нет', ask: 'Раздели факт и не факт. Факт — принятый файл, known и решение Комитета. Черновик фактом не называй.' }
]

function fileScenarioPrompt(order: Order, item: FileScenario): string {
  const files = (order.documents || []).map((doc) => doc.anchor).filter((item): item is string => Boolean(item))
  const links = (order.document_links || []).map((link) => `${link.from} — ${link.relation_label} → ${link.to}`)
  return [
    `Сценарий дела: ${item.label}.`,
    item.ask,
    files.length ? `Файлы дела: ${files.join(', ')}.` : 'Файлов в деле нет.',
    links.length ? `Связи:\n${links.join('\n')}` : 'Связей между файлами нет.'
  ].join('\n\n')
}

function kindLabel(id: string): string {
  return FILE_KINDS.find((item) => item.id === id)?.label || id
}

type Order = ExternalOrder
type Brief = ExternalOrderBrief
type SimplifiedStep = ExternalOrderSimplifiedStep
type CardPage = 'summary' | 'fields' | 'checks' | 'diff' | 'committee' | 'path' | 'files' | 'ai' | 'history'

const CARD_PAGES: CardPage[] = ['summary', 'fields', 'checks', 'diff', 'committee', 'path', 'files', 'ai', 'history']
const PAGE_KEY = 'orch.external-order.page'

function savedPage(): CardPage {
  try {
    const value = localStorage.getItem(PAGE_KEY) as CardPage | null
    return value && CARD_PAGES.includes(value) ? value : 'summary'
  } catch {
    return 'summary'
  }
}

function savePage(page: CardPage): void {
  try {
    localStorage.setItem(PAGE_KEY, page)
  } catch {
    /* вкладка останется на этот сеанс */
  }
}
type RunAction = (action: () => Promise<Order | void>) => Promise<void>
type DocKind = 'memo' | 'assignment' | 'directive' | 'order'
type DocDraft = { title?: string; text?: string; values?: Record<string, string> }
type OpenDocflow = (kind: DocKind, draft?: DocDraft) => void
type CopilotState = {
  orderId: string
  summary: string
  log: string[]
  questions: CopilotQuestion[]
  passport: StagePassport | null
  ai: CopilotAiResult | null
}

const NO_COPILOT: CopilotState = { orderId: '', summary: '', log: [], questions: [], passport: null, ai: null }

function pathSteps(raw: unknown): { id: string; title: string; state: string; detail: string }[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const row = item as Record<string, unknown>
      return [{
        id: String(row.id || ''),
        title: String(row.title || ''),
        state: String(row.state || ''),
        detail: String(row.detail || '')
      }]
    })
  } catch {
    return []
  }
}

function scheduleRows(raw: unknown): { date: string; percent: string }[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const row = item as Record<string, unknown>
      return [{ date: String(row.date || ''), percent: String(row.percent || '') }]
    })
  } catch {
    return []
  }
}

function savedRole(): string {
  try {
    return localStorage.getItem(ROLE_KEY) || ''
  } catch {
    return ''
  }
}

function stamp(value?: string): string {
  return (value || '').slice(0, 16).replace('T', ' ')
}

function roleNames(roles?: string[]): string {
  return (roles || []).map((item) => ROLE_NAME[item] || item).join(', ')
}

function activePassport(passports: StagePassport[]): StagePassport | null {
  return passports.find((item) => item.state === 'current' || item.state === 'blocked') || passports[0] || null
}

/** Задача сотруднику: заказ, служба и что сделать. Имена инструментов сюда не пишем. */
function agentBrief(order: Order, role: string, step?: SimplifiedStep, extra = ''): string {
  const passport = activePassport(buildStagePassports(order))
  const question = (extra || step?.prompt || '').trim()
  return [
    `Заказ ${order.code} (order_id=${order.id}), заказчик ${order.customer}.`,
    `Служба: ${ROLE_NAME[role] || role} (role=${role}). Этап: ${passport?.label || order.status_label}.`,
    question || 'Что уже есть по службе, какой черновик подготовить и что осталось пустым.',
    'Черновик не факт, пока его не приняли. Этап не переводи и ничего не отправляй.',
    'Если сотрудник задаст свой вопрос, отвечай на него. Этот старт не повторяй.'
  ].join('\n\n')
}

const RETURN_KEY = 'orch.external-order.return'

type ReturnIntent = { orderId: string; page: CardPage }

/** Чат помощника: один разговор на заказ, службу и этап. Закрытие окна его не сбрасывает. */
function serviceLists(order: Order, role: string): {
  filled: { label: string; value: string }[]
  drafts: { id: string; label: string; value: string }[]
  otherDrafts: number
} {
  const filled: { label: string; value: string }[] = []
  for (const form of ROLE_FIELDS[role] || []) {
    const bucket = order.sections?.[form.section] || {}
    for (const field of form.fields) {
      const value = String(bucket[field.key] || '').trim()
      if (!value) continue
      filled.push({ label: field.label, value: value.slice(0, 200) })
      if (filled.length >= 12) break
    }
    if (filled.length >= 12) break
  }
  const drafts: { id: string; label: string; value: string }[] = []
  let otherDrafts = 0
  for (const item of order.findings || []) {
    if (item.status !== 'draft') continue
    if (item.owner_role !== role) {
      otherDrafts += 1
      continue
    }
    if (drafts.length >= 12) continue
    drafts.push({
      id: item.id,
      label: item.label || 'Поле',
      value: String(item.value || '').slice(0, 200)
    })
  }
  return { filled, drafts, otherDrafts }
}

function chatContext(order: Order, role: string): AgentChatContext {
  const passport = activePassport(buildStagePassports(order))
  const stage = passport?.id || order.status || 'none'
  return {
    conversationKey: orderConversationKey(order.id, role, stage),
    conversationPrefix: orderConversationPrefix(order.id, role),
    stageLabels: Object.fromEntries(LINE.map((step) => [step.id, step.label])),
    order: {
      id: order.id,
      code: order.code,
      customer: order.customer,
      product: order.product,
      stage,
      stageLabel: passport?.label || order.status_label,
      role,
      roleLabel: ROLE_NAME[role] || role,
      blockers: [...(passport?.blocker ? [passport.blocker] : []), ...(order.blocks || [])].filter(
        (item, index, all) => item && all.indexOf(item) === index
      )
    },
    caseBrief: briefFromLoadedOrder({
      code: order.code,
      customer: order.customer,
      product: order.product,
      stageLabel: passport?.label || order.status_label,
      checksDone: passport?.checks_done || 0,
      checksTotal: passport?.checks_total || 0,
      blocker: passport?.blocker || '',
      draftCount: (order.findings || []).filter((item) => item.status === 'draft').length,
      pathLabel: order.path_label || '',
      paymentNote: order.payment_note || '',
      openChecks: (passport?.open_checks || []).map((item) => item.text),
      ...serviceLists(order, role)
    })
  }
}

function rememberReturn(intent: ReturnIntent): void {
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify(intent))
  } catch {
    /* без возврата откроется список */
  }
}

function takeReturn(): ReturnIntent | null {
  try {
    const raw = sessionStorage.getItem(RETURN_KEY)
    sessionStorage.removeItem(RETURN_KEY)
    const data = raw ? (JSON.parse(raw) as Partial<ReturnIntent>) : null
    if (!data?.orderId) return null
    const page = CARD_PAGES.includes(data.page as CardPage) ? (data.page as CardPage) : 'summary'
    return { orderId: String(data.orderId), page }
  } catch {
    return null
  }
}

function docflowValues(schema: DocflowKindSchema, draft: DocDraft): Record<string, string> {
  const keys = new Set(schema.fields.map((field) => field.key))
  const values: Record<string, string> = {}
  for (const [key, value] of Object.entries(draft.values || {})) {
    if (keys.has(key) && value) values[key] = value
  }
  const titleKey = DOC_TITLE_KEYS.find((key) => keys.has(key))
  const textKey = DOC_TEXT_KEYS.find((key) => keys.has(key))
  const title = (draft.title || '').trim()
  const text = (draft.text || '').trim()
  if (titleKey && title && !values[titleKey]) values[titleKey] = title
  if (textKey && !values[textKey]) {
    const body = titleKey ? text : [title, text].filter(Boolean).join('\n\n')
    if (body) values[textKey] = body
  }
  return values
}

function briefMatches(item: Brief, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [item.code, item.customer, item.product, item.onec_number, item.path_label]
    .some((value) => (value || '').toLowerCase().includes(needle))
}

const DESK_ROLES: { id: string; label: string }[] = [
  { id: 'ks', label: 'Коммерческая служба' },
  { id: 'development', label: 'Служба развития' },
  { id: 'rp', label: 'Руководитель проекта' },
  { id: 'committee', label: 'Комитет' },
  { id: 'kb', label: 'КБ и ГСПП' },
  { id: 'omto', label: 'ОМТО' },
  { id: 'finance', label: 'ОЦОиЭП и финансы' },
  { id: 'production', label: 'Производство, качество и сервис' },
  { id: 'legal', label: 'Юридическая служба' },
  { id: 'it', label: 'ИТ и администраторы' }
]

/** Жалыбин и тестировщик смотрят один и тот же стол внешнего заказа. */
function sameExternalOrderDesk(user: UserProfile): boolean {
  const fio = (user.fio || '').toLowerCase().replaceAll('ё', 'е')
  const job = `${user.position || ''} ${user.department || ''}`.toLowerCase().replaceAll('ё', 'е')
  if (fio.includes('жалыбин') && fio.includes('максим') && fio.includes('дмитриевич')) return true
  if (fio.includes('рамазанов') && fio.includes('роман')) return true
  return job.includes('тестировщик')
}

function helperFailure(err: unknown, fallback: string): string {
  if (err instanceof ApiError && (err.message === 'Заказ не найден' || err.message === 'Not Found')) {
    return 'Карточка открыта. Помощник не запустился: сервер принял его адрес за номер заказа.'
  }
  return err instanceof ApiError ? err.message : fallback
}

type RequestLine = { name: string; qty: string; amount: string }

type RequestDraft = {
  customer: string
  inn: string
  contact: string
  end_customer: string
  order_type: string
  priority: string
  price: string
  vat: string
  currency: string
  discount: string
  delivery_days: string
  payment_form: string
  delivery: string
  valid_until: string
  order_subject: string
  lines: RequestLine[]
}

const REQUEST_HEAD: { key: keyof Omit<RequestDraft, 'lines'>; label: string }[] = [
  { key: 'customer', label: 'Заказчик' },
  { key: 'inn', label: 'ИНН' },
  { key: 'contact', label: 'Контакт' },
  { key: 'end_customer', label: 'Конечный заказчик' },
  { key: 'order_type', label: 'Вид' },
  { key: 'priority', label: 'Приоритет' },
  { key: 'price', label: 'Сумма' },
  { key: 'vat', label: 'НДС' },
  { key: 'currency', label: 'Валюта' },
  { key: 'discount', label: 'Скидка' },
  { key: 'delivery_days', label: 'Срок поставки' },
  { key: 'payment_form', label: 'Форма оплаты' },
  { key: 'delivery', label: 'Доставка' },
  { key: 'valid_until', label: 'Срок действия' }
]

function emptyRequest(): RequestDraft {
  return {
    customer: '',
    inn: '',
    contact: '',
    end_customer: '',
    order_type: '',
    priority: '',
    price: '',
    vat: '',
    currency: '',
    discount: '',
    delivery_days: '',
    payment_form: '',
    delivery: '',
    valid_until: '',
    order_subject: '',
    lines: [{ name: '', qty: '', amount: '' }]
  }
}

export function ExternalOrderTab({
  user,
  onRunAgent
}: {
  user: UserProfile
  onRunAgent: RunAgentHandler
}): React.JSX.Element {
  const view = useExternalOrderDock()
  const cardPageRef = useRef<CardPage>(savedPage())
  const [returnPage, setReturnPage] = useState<CardPage | null>(null)
  const [asRole, setAsRole] = useState(savedRole)
  const [meta, setMeta] = useState<ExternalOrderMeta | null>(null)
  const [orders, setOrders] = useState<Brief[]>([])
  const [listReady, setListReady] = useState(false)
  const [current, setCurrent] = useState<Order | null>(null)
  const [error, setError] = useState('')
  const [requestDraft, setRequestDraft] = useState<RequestDraft>(emptyRequest)
  const [evidence, setEvidence] = useState<Record<string, string>>({})
  const [deskOrder, setDeskOrder] = useState<Order | null>(null)
  const [deskAll, setDeskAll] = useState(false)
  const [helper, setHelper] = useState<ExternalOrderReview | null>(null)
  const [helperFor, setHelperFor] = useState('')
  const [copilot, setCopilot] = useState<CopilotState>(NO_COPILOT)
  const [copilotBusy, setCopilotBusy] = useState(false)
  const [agentBusy, setAgentBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [routeFilter, setRouteFilter] = useState('')
  const [blockedOnly, setBlockedOnly] = useState(false)
  const [waitingFilter, setWaitingFilter] = useState('')
  const [draftsOnly, setDraftsOnly] = useState(false)
  const [registryTop, setRegistryTop] = useState(50)
  const [registrySkip, setRegistrySkip] = useState(0)
  const [auditOrders, setAuditOrders] = useState<Order[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditAction, setAuditAction] = useState('')
  const [auditOrder, setAuditOrder] = useState('')
  const [formRequest, setFormRequest] = useState<DocflowFormRequest | null>(null)
  const [createSchemas, setCreateSchemas] = useState<DocflowKindSchema[]>([])
  const [docNotice, setDocNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [serviceAgents, setServiceAgents] = useState<
    { role: string; workflow_id: string; title: string; active: boolean; procedure: string }[]
  >([])
  const [procedureDraft, setProcedureDraft] = useState('')
  const [procedureNote, setProcedureNote] = useState('')

  const fail = (err: unknown): void => {
    setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Не удалось выполнить действие')
  }

  const reload = useCallback(async (role: string): Promise<void> => {
    const [nextMeta, list] = await Promise.all([
      api.externalOrderMeta(role),
      api.externalOrders(role)
    ])
    setMeta(nextMeta)
    setOrders(list)
    setListReady(true)
  }, [])

  useEffect(() => {
    let cancelled = false
    setListReady(false)
    void api.externalOrderMeta(asRole).then((next) => {
      if (!cancelled) setMeta(next)
    }).catch((err) => {
      if (!cancelled) fail(err)
    })
    void api.externalOrders(asRole).then((list) => {
      if (!cancelled) {
        setOrders(list)
        setListReady(true)
      }
    }).catch((err) => {
      if (!cancelled) {
        fail(err)
        setListReady(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [asRole])

  useEffect(() => {
    let cancelled = false
    void api
      .externalServiceAgents()
      .then((rows) => {
        if (!cancelled) setServiceAgents(rows)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!meta?.can_switch && !sameExternalOrderDesk(user)) return
    // Пустой выбор открывает ИТ. Уже выбранная служба, в том числе производство, остаётся.
    if (savedRole()) return
    if (asRole !== 'it') chooseRole('it')
  }, [asRole, meta?.can_switch, user])

  useEffect(() => {
    setCurrent(null)
    setDeskOrder(null)
    setHelper(null)
    setHelperFor('')
    setCopilot(NO_COPILOT)
  }, [view, asRole])

  // «Назад» из чата помощника: та же карточка и та же вкладка, а не список.
  useEffect(() => {
    const back = takeReturn()
    if (!back) return
    void openOrder(back.orderId, back.page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if ((view !== 'reconcile' && view !== 'committee') || deskOrder || !listReady) return
    const pick =
      view === 'reconcile'
        ? orders.find((item) => (item.open_diffs_count || 0) > 0)
        : orders.find((item) => COMMITTEE_AGENDA.some((group) => group.statuses.includes(item.status)))
    if (pick) void selectOrder(pick.id)
  }, [view, listReady, orders, deskOrder])

  useEffect(() => {
    if (view !== 'audit' || !listReady) return
    let cancelled = false
    setAuditLoading(true)
    void Promise.all(orders.slice(0, 40).map((item) => api.externalOrder(item.id, asRole).catch(() => null)))
      .then((list) => {
        if (!cancelled) setAuditOrders(list.filter((item): item is Order => Boolean(item)))
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [view, listReady, orders, asRole])

  function chooseRole(role: string): void {
    setAsRole(role)
    try {
      localStorage.setItem(ROLE_KEY, role)
    } catch {
      /* переключатель останется на этот сеанс */
    }
  }

  function applyOrder(order: Order): void {
    setCurrent((prev) => (prev?.id === order.id ? order : prev))
    setDeskOrder((prev) => (prev?.id === order.id ? order : prev))
  }

  async function selectOrder(id: string): Promise<void> {
    setError('')
    try {
      setDeskOrder(await api.externalOrder(id, asRole))
    } catch (err) {
      fail(err)
    }
  }

  async function openOrder(id: string, page: CardPage = 'files'): Promise<void> {
    setError('')
    setReturnPage(page)
    try {
      setCurrent(await api.externalOrder(id, asRole))
    } catch (err) {
      fail(err)
    }
  }

  const run: RunAction = async (action) => {
    setError('')
    try {
      const order = await action()
      if (order) applyOrder(order)
      await reload(asRole)
    } catch (err) {
      fail(err)
    }
  }

  async function runCopilot(
    order: Order,
    opts: {
      step_id?: string
      message?: string
      answers?: Record<string, string>
      auto_prepare?: boolean
      use_ai?: boolean
    } = { auto_prepare: true, use_ai: true }
  ): Promise<void> {
    setCopilotBusy(true)
    setError('')
    try {
      const [res, review] = await Promise.all([
        api.runExternalCopilot(order.id, opts, asRole),
        api.externalOrderReview(order.id, asRole).catch(() => null)
      ])
      applyOrder(res.order || res)
      setCopilot({
        orderId: order.id,
        summary: res.summary || res.copilot_summary || '',
        log: res.log || [],
        questions: res.questions || [],
        passport: res.stage_passport || null,
        ai: res.ai || null
      })
      setHelper(review)
      setHelperFor(order.id)
      await reload(asRole)
    } catch (err) {
      fail(err)
    } finally {
      setCopilotBusy(false)
    }
  }

  async function findingAction(action: () => Promise<Order>): Promise<void> {
    setCopilotBusy(true)
    setError('')
    try {
      applyOrder(await action())
      await reload(asRole)
    } catch (err) {
      fail(err)
      throw err
    } finally {
      setCopilotBusy(false)
    }
  }

  function openDocflow(order: Order, kind: DocKind, draft: DocDraft = {}): void {
    setDocNotice(null)
    const open = (schemas: DocflowKindSchema[]): void => {
      const schema = schemas.find((item) => item.id === kind)
      if (!schema) {
        setDocNotice({ text: 'Форма этого документа в 1С ДО недоступна', error: true })
        return
      }
      setFormRequest({
        mode: 'create',
        kind,
        prefill: {
          values: docflowValues(schema, draft),
          keys: {},
          tables: {},
          basis: null,
          label: `Внешний заказ ${order.code}`,
          copy: false
        }
      })
    }
    if (createSchemas.length) {
      open(createSchemas)
      return
    }
    void loadDocflowCreateSchema(user)
      .then((schemas) => {
        setCreateSchemas(schemas)
        open(schemas)
      })
      .catch((err: unknown) =>
        setDocNotice({ text: err instanceof Error ? err.message : 'Не удалось открыть форму 1С ДО', error: true })
      )
  }

  async function openServiceAgent(order: Order, extra = ''): Promise<void> {
    if (!role || role === 'viewer') return
    setAgentBusy(true)
    setError('')
    try {
      const agent =
        serviceAgents.find((item) => item.role === role && item.workflow_id) ||
        (await api.externalServiceAgents()).find((item) => item.role === role)
      if (!agent?.workflow_id) {
        setError('Агент службы ещё не опубликован.')
        return
      }
      if (!agent.active) {
        setError('Агент службы остановлен.')
        return
      }
      rememberReturn({ orderId: order.id, page: cardPageRef.current })
      onRunAgent(
        agent.workflow_id,
        agent.title || `ИИ-агент внешнего заказа · ${ROLE_NAME[role] || role}`,
        agentBrief(order, role, undefined, extra),
        chatContext(order, role)
      )
    } catch (err) {
      setError(helperFailure(err, 'Помощник службы не запустился'))
    } finally {
      setAgentBusy(false)
    }
  }

  function panelProps(order: Order, passport: StagePassport | null): HelperPanelProps {
    const own = copilot.orderId === order.id
    return {
      order,
      role,
      roleLabel: ROLE_NAME[role] || meta?.role_label || '',
      stagePassport: passport || (own ? copilot.passport : null),
      review: helperFor === order.id ? helper : null,
      log: own ? copilot.log : [],
      summary: own ? copilot.summary : '',
      questions: own && copilot.questions.length ? copilot.questions : buildRoleQuestions(order, role),
      ai: own ? copilot.ai : null,
      busy: copilotBusy,
      onRunCopilot: role === 'viewer' ? undefined : (opts) => void runCopilot(order, opts),
      onAcceptFinding: (id) => findingAction(() => api.acceptExternalFinding(order.id, id, asRole)),
      onRejectFinding: (id) => void findingAction(() => api.rejectExternalFinding(order.id, id, asRole)).catch(() => undefined),
      onAcceptAllFindings: () => findingAction(() => api.acceptAllExternalFindings(order.id, asRole)),
      onOpenDocflow: (kind, prefill) => openDocflow(order, kind, prefill),
      onOpenFullAgent: role === 'viewer' ? undefined : (prompt) => void openServiceAgent(order, prompt || '')
    }
  }

  const role = meta?.role || asRole
  const procedureFromServer = serviceAgents.find((item) => item.role === role)?.procedure || ''
  useEffect(() => {
    setProcedureDraft(procedureFromServer)
  }, [role, procedureFromServer])

  async function saveProcedure(): Promise<void> {
    if (!role || role === 'viewer') return
    setProcedureNote('')
    try {
      const saved = await api.saveServiceProcedure(role, procedureDraft)
      setServiceAgents((rows) =>
        rows.map((item) => (item.role === role ? { ...item, procedure: saved.procedure } : item))
      )
      setProcedureDraft(saved.procedure)
      setProcedureNote('Приём сохранён.')
    } catch (err) {
      setProcedureNote(err instanceof ApiError ? err.message : 'Приём не сохранён')
    }
  }
  const showDeskSwitch = Boolean(meta?.can_switch) || sameExternalOrderDesk(user)
  const deskRoles = meta?.roles?.length ? meta.roles : DESK_ROLES
  const requestFilesRef = useRef<HTMLInputElement | null>(null)
  const canCreate = role === 'ks' || role === 'development'
  const canLoad = role === 'ks' || role === 'development' || role === 'finance' || role === 'it'
  const moves = MOVES[role] || []
  const waitingMine = orders.filter((item) => {
    if (item.status === 'closed') return false
    const step = LINE.find((entry) => entry.statuses.includes(item.status))
    return Boolean(step?.owner_roles.includes(role))
  })
  const deskList = deskAll ? orders : waitingMine
  const deskPassport = deskOrder ? activePassport(buildStagePassports(deskOrder)) : null
  const registry = orders.filter((item) => {
    if (!briefMatches(item, search)) return false
    if (stageFilter && !LINE.find((step) => step.id === stageFilter)?.statuses.includes(item.status)) return false
    if (routeFilter && item.route !== routeFilter) return false
    if (blockedOnly && !(item.blocks || []).length) return false
    if (waitingFilter && !(item.waiting_roles || []).includes(waitingFilter)) return false
    if (draftsOnly && !(item.draft_findings_count || 0)) return false
    return true
  })
  const registryStart = registrySkip < registry.length ? registrySkip : 0
  const registryPage = registry.slice(registryStart, registryStart + registryTop)
  const reconcileOrders = [...orders].sort((a, b) => (b.open_diffs_count || 0) - (a.open_diffs_count || 0))

  const auditRows = useMemo(
    () =>
      auditOrders
        .flatMap((order) => order.audit.map((item) => ({ ...item, order_id: order.id, order_code: order.code })))
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
    [auditOrders]
  )
  const auditKinds = [...new Set(auditRows.map((item) => item.action))].sort()
  const auditShown = auditRows
    .filter((item) => (!auditAction || item.action === auditAction) && (!auditOrder || item.order_id === auditOrder))
    .slice(0, 300)
  const auditNotices = auditOrders
    .filter((order) => !auditOrder || order.id === auditOrder)
    .flatMap((order) => (order.notices || []).map((item) => ({ ...item, code: order.code })))
  const auditGaps = auditOrders
    .filter((order) => !auditOrder || order.id === auditOrder)
    .flatMap((order) => (order.gaps || []).filter((item) => item.status === 'open').map((item) => ({ ...item, code: order.code })))

  const sumBy = (rows: Brief[], key: 'open_checks_count' | 'draft_findings_count'): number =>
    rows.reduce((total, item) => total + (item[key] || 0), 0)

  return (
    <OrchSlotMain spanAll heavyEmbed>
    <div className="eo-page">
      {showDeskSwitch ? (
        <div className="eo-switch" role="tablist" aria-label="Должность">
          {deskRoles.map((item) => (
            <button
              key={item.id}
              type="button"
              className={role === item.id ? 'is-active' : ''}
              onClick={() => chooseRole(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <div className="eo-error">{error}</div> : null}
      {docNotice ? <div className={docNotice.error ? 'eo-error' : 'eo-note'}>{docNotice.text}</div> : null}
      {current ? (
        <div className="eo-work">
          <aside className="eo-work-queue">
            <h3>Ждут меня · {waitingMine.length}</h3>
            <div className="eo-work-list">
              {waitingMine.length ? waitingMine.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === current.id ? 'eo-queue-item is-active' : 'eo-queue-item'}
                  onClick={() => void openOrder(item.id)}
                >
                  <b>{item.code}</b>
                  <span>{item.customer}</span>
                  <small>{attentionLine(item, role) || item.status_label}</small>
                </button>
              )) : <p className="eo-muted">Сейчас от вашей службы ничего не ждут.</p>}
            </div>
            <button type="button" className="eo-queue-all" onClick={() => setCurrent(null)}>Вся очередь</button>
          </aside>
        <Card
          key={current.id}
          order={current}
          role={role}
          evidence={evidence}
          onEvidence={(id, value) => setEvidence((prev) => ({ ...prev, [id]: value }))}
          onBack={() => setCurrent(null)}
          onRun={run}
          path={meta?.simplified_path || []}
          user={user}
          initialPage={returnPage || savedPage()}
          onPageChange={(next) => {
            cardPageRef.current = next
          }}
          onRunAgent={(workflowId, title, message, chat) => {
            rememberReturn({ orderId: current.id, page: cardPageRef.current })
            onRunAgent(workflowId, title, message, chat)
          }}
          onServiceAgent={(extra) => void openServiceAgent(current, extra)}
          agentBusy={agentBusy}
          copilotBusy={copilotBusy}
          panel={(passport) => panelProps(current, passport)}
          onCopilot={(stepId) => void runCopilot(current, { auto_prepare: true, use_ai: true, step_id: stepId })}
          onDocflow={(kind, draft) => openDocflow(current, kind, draft)}
          procedureDraft={procedureDraft}
          procedureNote={procedureNote}
          onProcedureDraft={setProcedureDraft}
          onSaveProcedure={() => void saveProcedure()}
        />
        </div>
      ) : view === 'desk' ? (
        <div className="eo-windows">
          <section className="eo-window eo-window-main">
            <div className="eo-window-head">
              <h3>Рабочий стол · {meta?.role_label || ROLE_NAME[role] || 'служба'} · {user.fio}</h3>
            </div>
            <div className="eo-tiles">
              <div className="eo-tile">
                <small>Ждут моей службы</small>
                <b>{waitingMine.length}</b>
              </div>
              <div className="eo-tile">
                <small>Открытые пункты в этих заказах</small>
                <b>{sumBy(waitingMine, 'open_checks_count')}</b>
              </div>
              <div className="eo-tile">
                <small>Черновики ИИ на подтверждение</small>
                <b>{sumBy(waitingMine, 'draft_findings_count')}</b>
              </div>
              <div className={waitingMine.some((item) => (item.blocks || []).length) ? 'eo-tile is-stop' : 'eo-tile'}>
                <small>Блокировки переходов</small>
                <b>{waitingMine.filter((item) => (item.blocks || []).length).length}</b>
              </div>
            </div>
          </section>
          {canCreate ? (
            <form
              className="eo-window eo-doc"
              onSubmit={(event) => {
                event.preventDefault()
                const lines = requestDraft.lines.filter((item) => item.name.trim())
                const terms: Record<string, string> = {}
                for (const field of REQUEST_HEAD) {
                  if (field.key === 'customer') continue
                  const value = requestDraft[field.key].trim()
                  if (value) terms[field.key] = value
                }
                const comment = requestDraft.order_subject.trim()
                if (comment) terms.order_subject = comment
                void run(async () => {
                  const created = await api.createExternalOrder({
                    customer: requestDraft.customer.trim(),
                    inn: requestDraft.inn.trim(),
                    contact: requestDraft.contact.trim(),
                    order_type: requestDraft.order_type.trim(),
                    priority: requestDraft.priority.trim(),
                    lines,
                    terms
                  }, asRole)
                  setRequestDraft(emptyRequest())
                  setCurrent(created)
                })
              }}
            >
              <h3>Новый запрос</h3>
              <div className="eo-doc-grid">
                {REQUEST_HEAD.map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <input
                      value={requestDraft[field.key]}
                      onChange={(event) => setRequestDraft({ ...requestDraft, [field.key]: event.target.value })}
                    />
                  </label>
                ))}
              </div>
              <label className="eo-doc-wide">
                Комментарий
                <input
                  value={requestDraft.order_subject}
                  onChange={(event) => setRequestDraft({ ...requestDraft, order_subject: event.target.value })}
                />
              </label>
              <div className="eo-doc-goods">
                <div className="eo-window-head">
                  <h3>Товары</h3>
                  <button
                    type="button"
                    onClick={() => setRequestDraft({
                      ...requestDraft,
                      lines: [...requestDraft.lines, { name: '', qty: '', amount: '' }]
                    })}
                  >
                    Добавить строку
                  </button>
                </div>
                <table className="eo-table">
                  <thead>
                    <tr>
                      <th>Номенклатура</th>
                      <th>Количество</th>
                      <th>Сумма</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {requestDraft.lines.map((line, index) => (
                      <tr key={index}>
                        <td>
                          <input
                            value={line.name}
                            aria-label={`Номенклатура ${index + 1}`}
                            onChange={(event) => {
                              const lines = requestDraft.lines.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item)
                              setRequestDraft({ ...requestDraft, lines })
                            }}
                          />
                        </td>
                        <td>
                          <input
                            value={line.qty}
                            aria-label={`Количество ${index + 1}`}
                            onChange={(event) => {
                              const lines = requestDraft.lines.map((item, itemIndex) => itemIndex === index ? { ...item, qty: event.target.value } : item)
                              setRequestDraft({ ...requestDraft, lines })
                            }}
                          />
                        </td>
                        <td>
                          <input
                            value={line.amount}
                            aria-label={`Сумма ${index + 1}`}
                            onChange={(event) => {
                              const lines = requestDraft.lines.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item)
                              setRequestDraft({ ...requestDraft, lines })
                            }}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            disabled={requestDraft.lines.length < 2}
                            onClick={() => setRequestDraft({
                              ...requestDraft,
                              lines: requestDraft.lines.filter((_, itemIndex) => itemIndex !== index)
                            })}
                          >
                            Убрать
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="eo-actions">
                <button className="eo-btn is-primary" type="submit">Создать карточку</button>
                <button type="button" onClick={() => requestFilesRef.current?.click()}>Загрузить запрос, ТЗ и переписку</button>
              </div>
              <input
                ref={requestFilesRef}
                className="eo-file-input"
                type="file"
                multiple
                accept=".docx,.xlsx,.pdf"
                onChange={(event) => {
                  const picked = [...(event.target.files || [])]
                  event.target.value = ''
                  if (!picked.length) return
                  void run(async () => {
                    const files = await Promise.all(picked.map(async (file) => {
                      const bytes = new Uint8Array(await file.arrayBuffer())
                      let binary = ''
                      bytes.forEach((item) => {
                        binary += String.fromCharCode(item)
                      })
                      const folded = file.name.toLowerCase()
                      const kind = folded.includes('тз') || folded.includes('tz')
                        ? 'tz'
                        : folded.includes('договор')
                          ? 'contract'
                          : 'correspondence'
                      return { kind, filename: file.name, content_base64: btoa(binary) }
                    }))
                    const created = await api.registerExternalRequest(files, asRole)
                    setCurrent(created)
                  })
                }}
              />
            </form>
          ) : null}
          <section className="eo-window eo-window-main">
            <div className="eo-window-head">
              <h3>{deskAll ? 'Все заказы' : 'Ждут действия моей службы'}</h3>
              <div className="eo-kind-tabs">
                <button type="button" className={deskAll ? '' : 'is-active'} onClick={() => setDeskAll(false)}>
                  Ждут меня ({waitingMine.length})
                </button>
                <button type="button" className={deskAll ? 'is-active' : ''} onClick={() => setDeskAll(true)}>
                  Все ({orders.length})
                </button>
              </div>
            </div>
            {!listReady && !orders.length ? <p>Загружаю заказы…</p> : null}
            {listReady && !deskList.length ? (
              <p className="eo-muted">{deskAll ? 'Заказов нет.' : 'Сейчас от вашей службы ничего не ждут.'}</p>
            ) : null}
            {deskList.length ? (
              <OrderTable
                rows={deskList}
                role={role}
                selectedId={deskOrder?.id || ''}
                onSelect={(id) => void selectOrder(id)}
                onOpen={(id) => void openOrder(id)}
              />
            ) : null}
          </section>
          {deskOrder ? (
            <section className="eo-window eo-window-work">
              <div className="eo-window-head">
                <h3>{deskOrder.code} · {deskOrder.customer}</h3>
                <span className={deskPassport?.blocker ? 'eo-tag is-stop' : 'eo-tag'}>
                  {deskPassport ? `${deskPassport.label} · ${deskPassport.checks_done}/${deskPassport.checks_total}` : deskOrder.status_label}
                </span>
              </div>
              {deskPassport?.blocker ? <p className="eo-note">Блокирует: {deskPassport.blocker}</p> : null}
              <div className="eo-actions">
                <button className="eo-btn" type="button" onClick={() => void openOrder(deskOrder.id)}>Открыть карточку</button>
                {role !== 'viewer' ? (
                  <button className="eo-btn" type="button" onClick={() => void run(() => api.refreshExternalPayment(deskOrder.id, asRole))}>
                    Повторить путь из 1С
                  </button>
                ) : null}
                {['ks', 'development', 'rp', 'finance', 'it'].includes(role) ? (
                  <button className="eo-btn" type="button" onClick={() => void run(() => api.linkExternalStrategy(deskOrder.id, asRole))}>
                    Стратегический план
                  </button>
                ) : null}
                {moves.map((move) => (
                  <button key={move.target} className="eo-btn is-primary" type="button" onClick={() => void run(() => api.transitionExternalOrder(deskOrder.id, move.target, asRole))}>
                    {move.label}
                  </button>
                ))}
              </div>
              {role !== 'viewer' ? (
                <RoleWork
                  order={deskOrder}
                  role={role}
                  asRole={asRole}
                  evidence={evidence}
                  onEvidence={(id, value) => setEvidence((prev) => ({ ...prev, [id]: value }))}
                  onRun={run}
                />
              ) : null}
              {role === 'rp' || role === 'ks' ? (
                <div className="eo-actions">
                  <button className="eo-btn" type="button" onClick={() => void run(() => api.buildExternalPlan(deskOrder.id, asRole))}>Собрать проект плана</button>
                  {role === 'rp' ? <button className="eo-btn" type="button" onClick={() => void run(() => api.approveExternalPlan(deskOrder.id, asRole))}>Утвердить базовый план</button> : null}
                  {role === 'rp' ? <button className="eo-btn" type="button" onClick={() => void run(() => api.publishExternalPlan(deskOrder.id, asRole))}>Отправить план в TurboProject</button> : null}
                </div>
              ) : null}
            </section>
          ) : null}
          {deskOrder ? <HelperPanel {...panelProps(deskOrder, deskPassport)} /> : null}
        </div>
      ) : view === 'registry' ? (
        <div className="eo-windows">
          <section className="eo-window eo-window-main">
            <div className="eo-window-head">
              <h3>Реестр внешних заказов</h3>
              <span className="eo-status">{registry.length} из {orders.length}</span>
            </div>
            <div className="eo-filters">
              <input
                value={search}
                placeholder="Код, заказчик, продукт или номер 1С"
                onChange={(event) => setSearch(event.target.value)}
              />
              <select value={stageFilter} aria-label="Этап" onChange={(event) => setStageFilter(event.target.value)}>
                <option value="">Все этапы</option>
                {LINE.map((step, index) => (
                  <option key={step.id} value={step.id}>{index + 1}. {step.label}</option>
                ))}
              </select>
              <select value={routeFilter} aria-label="Маршрут" onChange={(event) => setRouteFilter(event.target.value)}>
                <option value="">Все маршруты</option>
                {ROUTES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
              <label className="eo-filter-check">
                <input type="checkbox" checked={blockedOnly} onChange={(event) => setBlockedOnly(event.target.checked)} />
                Только с блокировками
              </label>
              <select value={waitingFilter} aria-label="Ждёт службу" onChange={(event) => setWaitingFilter(event.target.value)}>
                <option value="">Ждёт любую службу</option>
                {Object.entries(ROLE_NAME).map(([id, label]) => (
                  <option key={id} value={id}>Ждёт: {label}</option>
                ))}
              </select>
              <label className="eo-filter-check">
                <input type="checkbox" checked={draftsOnly} onChange={(event) => setDraftsOnly(event.target.checked)} />
                Есть черновики ИИ
              </label>
            </div>
            {!listReady && !orders.length ? <p>Загружаю заказы…</p> : null}
            {listReady && !registry.length ? <p className="eo-muted">Под фильтр заказы не попали.</p> : null}
            {registry.length ? (
              <OrderTable full rows={registryPage} selectedId="" onSelect={(id) => void openOrder(id)} onOpen={(id) => void openOrder(id)} />
            ) : null}
            {registry.length > ONEC_PAGE_SIZES[0] ? (
              <div className="eo-pager">
                <button
                  type="button"
                  className="eo-btn"
                  disabled={registryStart <= 0}
                  onClick={() => setRegistrySkip(Math.max(0, registryStart - registryTop))}
                >
                  ← Назад
                </button>
                <span>
                  {registryStart + 1}–{Math.min(registry.length, registryStart + registryTop)} из {registry.length}
                </span>
                <button
                  type="button"
                  className="eo-btn"
                  disabled={registryStart + registryTop >= registry.length}
                  onClick={() => setRegistrySkip(registryStart + registryTop)}
                >
                  Дальше →
                </button>
                <select
                  value={registryTop}
                  aria-label="Строк на странице"
                  onChange={(event) => {
                    setRegistrySkip(0)
                    setRegistryTop(Number(event.target.value))
                  }}
                >
                  {ONEC_PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>по {size}</option>
                  ))}
                </select>
              </div>
            ) : null}
          </section>
          {canLoad ? (
            <OnecImport
              orders={orders}
              onError={fail}
              onImport={(key, kind) =>
                void run(async () => {
                  const created = kind === 'order'
                    ? await api.importExternalOnec(key, asRole)
                    : await api.importExternalTkp(key, asRole)
                  setCurrent(created)
                  return created
                })
              }
            />
          ) : null}
        </div>
      ) : view === 'reconcile' ? (
        <div className="eo-windows">
          <section className="eo-window eo-window-main">
            <div className="eo-window-head">
              <h3>Сверка ТКП и договора / спецификации</h3>
              <div className="eo-actions">
                <select
                  value={deskOrder?.id || ''}
                  aria-label="Заказ"
                  onChange={(event) => (event.target.value ? void selectOrder(event.target.value) : setDeskOrder(null))}
                >
                  <option value="">Выберите заказ</option>
                  {reconcileOrders.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} · {item.customer}{item.open_diffs_count ? ` · ${item.open_diffs_count} расх.` : ''}
                    </option>
                  ))}
                </select>
                {deskOrder ? (
                  <button className="eo-btn" type="button" onClick={() => void openOrder(deskOrder.id)}>Открыть карточку</button>
                ) : null}
              </div>
            </div>
            {!deskOrder ? <p className="eo-muted">Выберите заказ, чтобы увидеть матрицу B01–B35 и изменения спецификации.</p> : null}
          </section>
          {deskOrder ? <DiffBlock order={deskOrder} role={role} asRole={asRole} onRun={run} /> : null}
        </div>
      ) : view === 'committee' ? (
        <div className="eo-windows">
          <section className="eo-window eo-window-main">
            <div className="eo-window-head">
              <h3>Повестка Комитета</h3>
            </div>
            <div className="eo-agenda">
              {COMMITTEE_AGENDA.map((group) => {
                const items = orders.filter((item) => group.statuses.includes(item.status))
                return (
                  <div key={group.id} className="eo-agenda-col">
                    <strong>{group.title} · {items.length}</strong>
                    {items.length ? items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={deskOrder?.id === item.id ? 'eo-row is-active' : 'eo-row'}
                        onClick={() => void selectOrder(item.id)}
                      >
                        <strong>{item.code} · {item.customer}</strong>
                        <span>{item.product} · {item.status_label}</span>
                        {(item.waiting_roles || []).length ? <small>Ждут: {roleNames(item.waiting_roles)}</small> : null}
                      </button>
                    )) : <p className="eo-muted">Пусто.</p>}
                  </div>
                )
              })}
            </div>
          </section>
          {deskOrder ? (
            <CommitteeBlock
              order={deskOrder}
              role={role}
              asRole={asRole}
              onRun={run}
              onDocflow={(kind, draft) => openDocflow(deskOrder, kind, draft)}
              onOpen={() => void openOrder(deskOrder.id)}
            />
          ) : null}
        </div>
      ) : (
        <div className="eo-windows">
          <section className="eo-window eo-window-main">
            <div className="eo-window-head">
              <h3>Журнал аудита</h3>
              <span className="eo-status">{auditLoading ? 'загрузка…' : `${auditShown.length} записей`}</span>
            </div>
            <div className="eo-filters">
              <select value={auditOrder} aria-label="Заказ" onChange={(event) => setAuditOrder(event.target.value)}>
                <option value="">Все заказы</option>
                {auditOrders.map((item) => (
                  <option key={item.id} value={item.id}>{item.code} · {item.customer}</option>
                ))}
              </select>
              <select value={auditAction} aria-label="Событие" onChange={(event) => setAuditAction(event.target.value)}>
                <option value="">Все события</option>
                {auditKinds.map((item) => (
                  <option key={item} value={item}>{AUDIT_ACTIONS[item] || item}</option>
                ))}
              </select>
            </div>
            <div className="eo-journal-scroll eo-audit-scroll">
              <table className="eo-journal-table">
                <thead>
                  <tr><th>Когда</th><th>Заказ</th><th>Кто</th><th>Событие</th><th>Было → стало</th><th>Подробности</th></tr>
                </thead>
                <tbody>
                  {!auditShown.length ? (
                    <tr><td className="eo-journal-empty" colSpan={6}>{auditLoading ? 'Читаю журнал…' : 'Записей нет.'}</td></tr>
                  ) : auditShown.map((item) => (
                    <tr key={`${item.order_id}:${item.id}`}>
                      <td>{stamp(item.created_at) || '—'}</td>
                      <td>
                        <button type="button" onClick={() => void openOrder(item.order_id)}>{item.order_code}</button>
                      </td>
                      <td>{item.actor_fio}<br /><small>{ROLE_NAME[item.actor_role] || item.actor_role}</small></td>
                      <td>{AUDIT_ACTIONS[item.action] || item.action}</td>
                      <td>
                        {item.before_value || item.after_value
                          ? `${item.before_value || '—'} → ${item.after_value || '—'}`
                          : '—'}
                      </td>
                      <td>{item.detail || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="eo-window">
            <h3>Уведомления · {auditNotices.length}</h3>
            {auditNotices.length ? auditNotices.slice(0, 50).map((item) => (
              <p key={`${item.code}:${item.id}`} className="eo-muted">
                <b>{item.code}</b> · {item.title}. {item.body} <small>{item.mail_status}</small>
              </p>
            )) : <p className="eo-muted">Уведомлений нет.</p>}
          </section>
          <section className="eo-window">
            <h3>Открытые пробелы · {auditGaps.length}</h3>
            {auditGaps.length ? auditGaps.slice(0, 50).map((item) => (
              <p key={`${item.code}:${item.id}`} className="eo-muted">
                <b>{item.code}</b> · «{item.field}», {item.owner_label}{item.due_at ? `, до ${stamp(item.due_at)}` : ''}. {item.detail}
              </p>
            )) : <p className="eo-muted">Открытых пробелов нет.</p>}
          </section>
        </div>
      )}
      <DocflowCreateDialog
        user={user}
        request={formRequest}
        schemas={createSchemas}
        onClose={() => setFormRequest(null)}
        onRequest={setFormRequest}
        onSaved={(text) => setDocNotice({ text, error: false })}
      />
    </div>
    </OrchSlotMain>
  )
}

function attentionLine(item: Brief, role: string): string {
  const labels: Record<string, string> = {
    overdue: 'Просрочено',
    check: 'Пункт',
    gap: 'Пробел',
    change: 'Файл',
    block: 'Блок'
  }
  const counts = new Map<string, number>()
  for (const row of item.attention || []) {
    if (row.role !== role) continue
    const line = `${labels[row.kind] || row.kind}: ${row.text}`
    counts.set(line, (counts.get(line) || 0) + 1)
  }
  return [...counts.entries()]
    .slice(0, 3)
    .map(([line, count]) => (count > 1 ? `${line} ×${count}` : line))
    .join(' · ')
}

function OrderTable({
  rows,
  selectedId,
  full = false,
  role = '',
  onSelect,
  onOpen
}: {
  rows: Brief[]
  selectedId: string
  full?: boolean
  role?: string
  onSelect: (id: string) => void
  onOpen: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="eo-table-scroll">
      <table className="eo-table eo-orders-table">
        <thead>
          <tr>
            <th className="eo-col-code">Заказ</th>
            <th className="eo-col-customer">Заказчик</th>
            <th className="eo-col-product">Продукт</th>
            <th className="eo-col-stage">Этап</th>
            <th className="eo-col-status">Статус</th>
            {full ? <th className="eo-col-route">Маршрут</th> : null}
            <th className="eo-col-path">Путь в 1С</th>
            {full ? <th className="eo-col-num">Пункты</th> : null}
            {full ? <th className="eo-col-num">Расхождения</th> : null}
            {full ? <th className="eo-col-num">Черновики ИИ</th> : null}
            <th className="eo-col-wait">Ждут</th>
            {role ? <th>Почему в очереди</th> : null}
            <th className="eo-col-open"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr
              key={item.id}
              className={selectedId === item.id ? 'eo-table-row is-selected' : 'eo-table-row'}
              onClick={() => onSelect(item.id)}
            >
              <td className="eo-col-code">{item.code}</td>
              <td className="eo-col-customer">
                <span className="eo-clip" title={item.customer}>{item.customer}</span>
              </td>
              <td className="eo-col-product">
                <span className="eo-clip" title={item.product}>{item.product}</span>
              </td>
              <td className="eo-col-stage">{item.stage_label}</td>
              <td className="eo-col-status">
                <span className="eo-clip" title={[item.status_label, ...(item.blocks || [])].filter(Boolean).join('. ')}>
                  {item.status_label}
                  {(item.blocks || []).length ? <small className="eo-danger">{item.blocks[0]}</small> : null}
                </span>
              </td>
              {full ? <td className="eo-col-route">{item.route_label || ROUTES.find((route) => route.id === item.route)?.label || '—'}</td> : null}
              <td className="eo-col-path">
                <span className="eo-clip" title={item.path_label || item.onec_number || ''}>
                  {item.path_label || item.onec_number || '—'}
                </span>
              </td>
              {full ? <td className="eo-col-num">{item.open_checks_count ?? '—'}</td> : null}
              {full ? <td className="eo-col-num">{item.open_diffs_count ?? '—'}</td> : null}
              {full ? <td className="eo-col-num">{item.draft_findings_count ?? '—'}</td> : null}
              <td className="eo-col-wait">
                <span className="eo-clip" title={roleNames(item.waiting_roles)}>
                  {roleNames(item.waiting_roles) || '—'}
                </span>
              </td>
              {role ? (
                <td>
                  <span className="eo-clip" title={attentionLine(item, role)}>{attentionLine(item, role) || '—'}</span>
                </td>
              ) : null}
              <td className="eo-col-open">
                <button className="eo-btn" type="button" onClick={(event) => { event.stopPropagation(); onOpen(item.id) }}>
                  Карточка
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StageStepper({
  passports,
  activeId,
  onSelect
}: {
  passports: StagePassport[]
  activeId: string
  onSelect: (id: string) => void
}): React.JSX.Element {
  return (
    <ol className="eo-line eo-stepper" aria-label="Путь заказа">
      {passports.map((item, index) => (
        <li key={item.id} className={`is-${item.state}${activeId === item.id ? ' is-inspected' : ''}`}>
          <button type="button" aria-pressed={activeId === item.id} onClick={() => onSelect(item.id)}>
            <b>{index + 1}. {item.label}</b>
            <small>{STAGE_STATE[item.state]} · {item.checks_done}/{item.checks_total}</small>
            <small>{item.owner_labels.slice(0, 2).join(', ')}</small>
          </button>
        </li>
      ))}
    </ol>
  )
}

function PassportView({
  order,
  passport,
  next,
  role,
  asRole,
  evidence,
  onEvidence,
  onRun
}: {
  order: Order
  passport: StagePassport
  next: StagePassport | null
  role: string
  asRole: string
  evidence: Record<string, string>
  onEvidence: (id: string, value: string) => void
  onRun: RunAction
}): React.JSX.Element {
  const waiting = [...new Set(passport.open_checks.map((item) => item.owner_label))]
  const checks = (order.checks || []).filter((item) => passport.gates.includes(item.gate) && item.status !== 'not_applicable')
  return (
    <div className="eo-passport">
      <p className="eo-now-kicker">Паспорт этапа · {STAGE_STATE[passport.state]}</p>
      <h3>{passport.label}</h3>
      <p>{passport.hint}</p>
      <div className="eo-tiles">
        <div className="eo-tile">
          <small>Отвечают за переход</small>
          <b>{passport.owner_labels.join(', ') || '—'}</b>
        </div>
        <div className="eo-tile">
          <small>Чек-лист этапа</small>
          <b>{passport.checks_done}/{passport.checks_total}</b>
        </div>
        <div className={waiting.length ? 'eo-tile is-stop' : 'eo-tile'}>
          <small>Кто держит</small>
          <b>{waiting.join(', ') || 'никто'}</b>
        </div>
        <div className="eo-tile">
          <small>Следующий гейт</small>
          <b>{next ? `${next.label}: ${next.gates.map((gate) => GATES[gate] || gate).join(', ')}` : 'последний этап'}</b>
        </div>
      </div>
      <p className="eo-muted">Статусы этапа: {passport.statuses.map((item) => STATUS_LABELS[item] || item).join(', ')}.</p>
      {passport.blocker ? <p className="eo-note">Блокирует: {passport.blocker}</p> : null}
      {passport.completed_by ? <p className="eo-muted">Пройден: {passport.completed_by}</p> : null}
      <div className="eo-passport-cols">
        <div>
          <p className="eo-now-kicker">Чек-лист этапа</p>
          {checks.length ? checks.map((item) => (
            <div key={item.id} className="eo-check">
              <span>
                {item.text}
                <br />
                <small className="eo-muted">
                  {GATES[item.gate] || item.gate} · {item.owner_label}
                  {item.evidence ? ` · ${item.evidence}` : ''}
                </small>
              </span>
              {item.status !== 'done' && role === item.owner_role ? (
                <div className="eo-actions">
                  <input
                    value={evidence[item.id] || ''}
                    placeholder="Доказательство"
                    onChange={(event) => onEvidence(item.id, event.target.value)}
                  />
                  <button type="button" onClick={() => void onRun(() => api.confirmExternalCheck(order.id, item.id, evidence[item.id] || '', asRole))}>
                    Подтвердить
                  </button>
                </div>
              ) : (
                <span className={item.status === 'done' ? 'eo-tag is-ok' : 'eo-tag is-stop'}>
                  {item.status === 'done' ? 'выполнено' : item.status_label || 'открыт'}
                </span>
              )}
            </div>
          )) : <p className="eo-muted">Пунктов чек-листа у этапа нет.</p>}
        </div>
        <div>
          <p className="eo-now-kicker">Документы этапа</p>
          {passport.required_docs.length ? passport.required_docs.map((item) => (
            <div key={item.kind} className="eo-check">
              <span>{item.label}{item.version ? ` · ${item.version}` : ''}</span>
              <span className={item.approved ? 'eo-tag is-ok' : item.present ? 'eo-tag' : 'eo-tag is-stop'}>
                {item.approved ? 'утверждён' : item.present ? 'черновик' : 'нет в деле'}
              </span>
            </div>
          )) : <p className="eo-muted">Обязательных документов нет.</p>}
        </div>
      </div>
    </div>
  )
}

const ONEC_PAGE_SIZES = [50, 100, 200]

const ONEC_DETAILS: { key: keyof ExternalOnecTkp; label: string }[] = [
  { key: 'client', label: 'Клиент' },
  { key: 'contract', label: 'Договор' },
  { key: 'organization', label: 'Организация' },
  { key: 'agreement', label: 'Соглашение' },
  { key: 'valid_until', label: 'Срок действия' },
  { key: 'delivery_days', label: 'Срок поставки' },
  { key: 'payment_form', label: 'Форма оплаты' },
  { key: 'delivery', label: 'Доставка' },
  { key: 'vat', label: 'НДС' },
  { key: 'agreed', label: 'Согласовано с клиентом' },
  { key: 'operation', label: 'Операция' },
  { key: 'product', label: 'Состав' },
  { key: 'comment', label: 'Комментарий' },
  { key: 'order_subject', label: 'Заказ клиента' }
]

function OnecImport({
  orders,
  onError,
  onImport
}: {
  orders: ExternalOrderBrief[]
  onError: (err: unknown) => void
  onImport: (key: string, kind: 'tkp' | 'order') => void
}): React.JSX.Element {
  const [data, setData] = useState<ExternalOnecSearch | null>(null)
  const [loading, setLoading] = useState(false)
  const [skip, setSkip] = useState(0)
  const [top, setTop] = useState(50)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<ExternalOnecFilters>({})
  const [open, setOpen] = useState('')
  const [source, setSource] = useState<'tkp' | 'orders'>('tkp')

  const requestRef = useRef(0)
  const loadedKey = useRef('')

  async function load(refresh = false): Promise<void> {
    const request = ++requestRef.current
    setLoading(true)
    try {
      const page = await api.recentExternalOnec({ skip, top, refresh }, filters, source)
      if (request === requestRef.current) setData(page)
    } catch (err) {
      if (request === requestRef.current) onError(err)
    } finally {
      if (request === requestRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    const text = query.trim()
    if ((filters.q || '') === text) return
    const timer = window.setTimeout(() => {
      setSkip(0)
      setFilters((prev) => ({ ...prev, q: text }))
    }, 450)
    return () => window.clearTimeout(timer)
  }, [query, filters.q])

  useEffect(() => {
    const key = JSON.stringify({ skip, top, source, filters })
    if (loadedKey.current === key) return
    loadedKey.current = key
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skip, top, filters, source])

  function switchSource(next: 'tkp' | 'orders'): void {
    if (next === source) return
    setSkip(0)
    setOpen('')
    setData(null)
    setFilters((prev) => ({ ...prev, status: '', manager: '' }))
    setSource(next)
  }

  function setFilter(patch: ExternalOnecFilters): void {
    setSkip(0)
    setFilters((prev) => ({ ...prev, ...patch }))
  }

  const rows = data?.orders || []
  const text = (value?: string): string => (value || '').trim() || '—'
  const shownTo = skip + rows.length

  return (
    <section className="eo-window eo-window-main">
      <div className="eo-window-head">
        <h3>{source === 'orders' ? 'Заказы клиентов из 1С' : 'ТКП из 1С ERP'}</h3>
        <div className="eo-actions">
          <button type="button" className={source === 'tkp' ? 'eo-btn is-primary' : 'eo-btn'} onClick={() => switchSource('tkp')}>
            ТКП
          </button>
          <button type="button" className={source === 'orders' ? 'eo-btn is-primary' : 'eo-btn'} onClick={() => switchSource('orders')}>
            Заказы клиентов
          </button>
        </div>
        <span className="eo-status">
          {loading ? 'Читаю 1С…' : rows.length ? `строки ${skip + 1}–${shownTo}${data?.has_more ? ', есть ещё' : ''}` : ''}
        </span>
        {data?.has_more ? (
          <button type="button" className="eo-btn" disabled={loading} onClick={() => setSkip(skip + top)}>
            Следующие {top}
          </button>
        ) : null}
        <button className="eo-btn" type="button" disabled={loading} onClick={() => void load(true)}>
          {loading ? 'Загрузка…' : 'Обновить из 1С'}
        </button>
      </div>
      <div className="eo-filters">
        <input
          value={query}
          placeholder="Номер, контрагент, комментарий, предмет"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select value={filters.status || ''} aria-label="Статус" onChange={(event) => setFilter({ status: event.target.value })}>
          <option value="">Все статусы</option>
          {(data?.statuses || []).map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <select value={filters.manager || ''} aria-label="Менеджер" onChange={(event) => setFilter({ manager: event.target.value })}>
          <option value="">Все менеджеры</option>
          {(data?.managers || []).map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
        <select
          value={filters.has_order || ''}
          aria-label="Заказ клиента"
          onChange={(event) => setFilter({ has_order: event.target.value as ExternalOnecFilters['has_order'] })}
        >
          <option value="">С заказом и без</option>
          <option value="yes">Есть заказ клиента</option>
          <option value="no">Без заказа клиента</option>
        </select>
        <label className="eo-filter-date">
          с
          <input type="date" value={filters.date_from || ''} onChange={(event) => setFilter({ date_from: event.target.value })} />
        </label>
        <label className="eo-filter-date">
          по
          <input type="date" value={filters.date_to || ''} onChange={(event) => setFilter({ date_to: event.target.value })} />
        </label>
      </div>
      {loading && !data ? <p>Читаю проведённые ТКП из 1С…</p> : null}
      {data && !rows.length ? (
        <p className="eo-muted">{source === 'orders' ? 'Под фильтр заказы клиента не попали.' : 'Под фильтр ТКП не попали.'}</p>
      ) : null}
      {rows.length ? (
        <div className="eo-tkp-scroll">
          <table className="eo-table eo-tkp is-compact">
            <thead>
              <tr>
                <th>Номер · дата</th>
                <th>Контрагент · конечный заказчик</th>
                <th>Сумма</th>
                <th>Менеджер</th>
                <th>Статус</th>
                <th>Заказ · сделка</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const taken = item.kind === 'order'
                  ? orders.some((order) => order.onec_key === item.key)
                  : orders.some((order) => order.onec_tkp_key === item.key)
                const expanded = open === item.key
                return (
                  <Fragment key={item.key}>
                    <tr className={expanded ? 'is-open' : ''} onClick={() => setOpen(expanded ? '' : item.key)}>
                      <td>
                        <b>{item.number || 'без номера'}</b>
                        <small>{text(item.date)}</small>
                      </td>
                      <td>
                        {text(item.counterparty)}
                        {item.end_customer && item.end_customer !== item.counterparty ? (
                          <small>для {item.end_customer}</small>
                        ) : null}
                        {item.product ? <small>{item.product}</small> : null}
                        {item.comment ? <small>{item.comment}</small> : null}
                        {item.order_subject && item.order_subject !== item.comment ? (
                          <small>заказ: {item.order_subject}</small>
                        ) : null}
                      </td>
                      <td className="eo-num">
                        {text(item.amount)}
                        <small>{item.currency || ''}</small>
                      </td>
                      <td>{text(item.manager)}</td>
                      <td>
                        {text(item.status)}
                        <small>{item.approved === 'да' ? 'согласован' : 'не согласован'}</small>
                      </td>
                      <td>
                        {text(item.order_number)}
                        {item.deal ? <small>{item.deal}</small> : null}
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        {taken ? (
                          <span className="eo-muted">в деле</span>
                        ) : (
                          <button
                            className="eo-btn is-primary"
                            type="button"
                            onClick={() => onImport(item.key, item.kind === 'order' ? 'order' : 'tkp')}
                          >
                            Открыть путь
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="eo-tkp-more">
                        <td colSpan={7}>
                          <dl>
                            {ONEC_DETAILS.map((field) => (
                              <div key={field.key}>
                                <dt>{field.label}</dt>
                                <dd>{text(item[field.key])}</dd>
                              </div>
                            ))}
                          </dl>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {data && (rows.length || skip > 0) ? (
        <div className="eo-pager">
          <button type="button" className="eo-btn" disabled={loading || skip <= 0} onClick={() => setSkip(Math.max(0, skip - top))}>
            ← Назад
          </button>
          <span>
            Страница {Math.floor(skip / top) + 1} · строки {rows.length ? `${skip + 1}–${shownTo}` : '—'}
          </span>
          <button
            type="button"
            className="eo-btn"
            disabled={loading || !data.has_more}
            onClick={() => setSkip(skip + top)}
          >
            Дальше →
          </button>
          <select
            value={top}
            aria-label="Строк на странице"
            onChange={(event) => {
              setSkip(0)
              setTop(Number(event.target.value))
            }}
          >
            {ONEC_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>по {size}</option>
            ))}
          </select>
        </div>
      ) : null}
    </section>
  )
}

/** Карточка целиком: поля других служб с черновиками ИИ. Принимает только владелец раздела. */
function OtherServiceFields({ order, role }: { order: Order; role: string }): React.JSX.Element | null {
  const others = Object.entries(ROLE_FIELDS).filter(([owner]) => owner !== role)
  if (!others.length) return null
  return (
    <details className="eo-form eo-other-fields">
      <summary>
        <b>Поля других служб</b>
        <span className="eo-muted"> · только просмотр, черновики ИИ принимает владелец раздела</span>
      </summary>
      <div className="eo-other-grid">
        {others.map(([owner, forms]) =>
          forms.map((form) => (
            <div key={`${owner}.${form.section}`} className="eo-other-form">
              <p className="eo-now-kicker">
                {ROLE_NAME[owner] || owner} · {form.title}
              </p>
              {form.fields.map((field) => {
                const id = `${form.section}.${field.key}`
                const value = String(order.sections?.[form.section]?.[field.key] || '')
                const mark = order.ai_fields?.[id]
                const aiValue = mark?.status === 'accepted' && value.trim() === mark.value.trim()
                return (
                  <div key={field.key} className="eo-other-row">
                    <span>{field.label}</span>
                    {value ? (
                      <b className={aiValue ? 'is-ai' : ''}>{value}</b>
                    ) : mark?.status === 'draft' ? (
                      <b className="is-ai-draft" title={mark.source}>
                        {mark.value} <small>· черновик ИИ</small>
                      </b>
                    ) : (
                      <b className="eo-muted">—</b>
                    )}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </details>
  )
}

function RoleWork({
  part = 'all',
  order,
  role,
  asRole,
  evidence,
  onEvidence,
  onRun
}: {
  part?: 'fields' | 'checks' | 'all'
  order: Order
  role: string
  asRole: string
  evidence: Record<string, string>
  onEvidence: (id: string, value: string) => void
  onRun: RunAction
}): React.JSX.Element {
  const forms = ROLE_FIELDS[role] || []
  const [draft, setDraft] = useState<Record<string, string>>({})
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const form of ROLE_FIELDS[role] || []) {
      const bucket = order.sections?.[form.section] || {}
      for (const field of form.fields) next[`${form.section}.${field.key}`] = String(bucket[field.key] || '')
    }
    setDraft(next)
  }, [order, role])
  const ownChecks = (order.checks || []).filter(
    (item) => item.owner_role === role && item.status !== 'done' && item.status !== 'not_applicable'
  )
  const gaps = (order.gaps || []).filter((item) => item.status === 'open')
  const [hint, setHint] = useState('')
  return (
    <div className={`eo-rolework is-${part}`}>
      {part !== 'checks' ? (
      <div className="eo-rolework-forms">
      {forms.length ? null : <p className="eo-muted">У этой службы нет своих полей в карточке.</p>}
      {forms.map((form) => (
        <div
          key={form.section}
          className={hint === form.section ? 'eo-form is-copilot' : 'eo-form'}
          onMouseEnter={() => setHint(form.section)}
          onMouseLeave={() => setHint((current) => (current === form.section ? '' : current))}
        >
          <h3>{form.title}</h3>
          {form.fields.map((field) => {
            const id = `${form.section}.${field.key}`
            const mark = order.ai_fields?.[id]
            const typed = draft[id] || ''
            const aiValue = mark?.status === 'accepted' && typed.trim() === mark.value.trim()
            return (
              <div key={field.key} className="eo-field">
                <label className="eo-field-label">
                  {field.label}
                  {aiValue ? <span className="eo-ai-badge">Заполнил ИИ</span> : null}
                </label>
                <input
                  className={aiValue ? 'is-ai' : ''}
                  value={typed}
                  placeholder={field.label}
                  aria-label={field.label}
                  title={aiValue && mark?.source ? `Источник: ${mark.source}` : undefined}
                  onChange={(event) => setDraft({ ...draft, [id]: event.target.value })}
                />
                {mark?.status === 'draft' ? (
                  <div className="eo-ai-draft">
                    <span className="eo-ai-badge">Черновик ИИ</span>
                    <b>{mark.value}</b>
                    <small>
                      {mark.source}
                      {mark.quote ? ` · «${mark.quote}»` : ''}
                      {mark.trace
                        ? ` · ${mark.trace.document} ${mark.trace.version}, ${mark.trace.clause}. Правило: ${mark.trace.rule}. ${mark.trace.author}`
                        : ''}
                    </small>
                    <div className="eo-actions">
                      <button
                        type="button"
                        className="is-primary"
                        onClick={() => void onRun(() => api.acceptExternalFinding(order.id, mark.finding_id, asRole))}
                      >
                        Принять
                      </button>
                      <button type="button" onClick={() => setDraft({ ...draft, [id]: mark.value })}>
                        Взять в правку
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
          <button
            className="eo-btn is-primary"
            type="button"
            onClick={() => {
              const values: Record<string, string> = {}
              for (const field of form.fields) values[field.key] = draft[`${form.section}.${field.key}`] || ''
              void onRun(() => api.patchExternalOrder(order.id, { sections: { [form.section]: values } }, asRole))
            }}
          >
            Сохранить
          </button>
          {hint === form.section ? (
            <div className="eo-basis-pop" role="note">
              <div className="eo-basis-card">
                <span className="eo-now-kicker">Помощник по этому блоку</span>
                <p>{formAdvice(form.title, form.fields, order.sections?.[form.section] || {})}</p>
              </div>
            </div>
          ) : null}
        </div>
      ))}
      </div>
      ) : null}
      {part === 'fields' ? <OtherServiceFields order={order} role={role} /> : null}
      {part !== 'fields' ? (
      <>
      <div className="eo-form eo-rolework-list">
        <h3>Мои открытые пункты · {ownChecks.length}</h3>
        {ownChecks.length ? ownChecks.map((item) => {
          const advice = basisAdvice(order, item)
          const open = hint === item.id
          const typed = (evidence[item.id] || '').trim()
          return (
          <div
            key={item.id}
            className={open ? 'eo-check is-copilot' : 'eo-check'}
            onMouseEnter={() => setHint(item.id)}
            onMouseLeave={() => setHint((current) => (current === item.id ? '' : current))}
          >
            <span>{item.text}<br /><small className="eo-muted">{GATES[item.gate] || item.gate}{item.due_at ? ` · до ${item.due_at.slice(0, 10)}` : ''}</small></span>
            <div className="eo-actions">
              <input
                value={evidence[item.id] || ''}
                placeholder="Основание"
                onChange={(event) => onEvidence(item.id, event.target.value)}
              />
              <button className="eo-btn" type="button" onClick={() => void onRun(() => api.confirmExternalCheck(order.id, item.id, evidence[item.id] || '', asRole))}>
                Подтвердить
              </button>
            </div>
            {open ? (
              <div className="eo-basis-pop" role="note">
                <div className="eo-basis-card">
                <span className="eo-now-kicker">Помощник по этому блоку</span>
                <p>{advice.what}</p>
                {advice.draft ? <p className="eo-basis-draft">{advice.draft}</p> : null}
                {advice.source ? <small>Источник: {advice.source}</small> : null}
                <div className="eo-actions">
                  {advice.draft ? (
                    <button type="button" onClick={() => onEvidence(item.id, advice.draft)}>
                      {advice.template ? 'Вставить шаблон' : 'Вставить в основание'}
                    </button>
                  ) : null}
                  {!advice.template && advice.draft ? (
                    <button
                      type="button"
                      className="is-primary"
                      onClick={() => {
                        onEvidence(item.id, advice.draft)
                        void onRun(() => api.confirmExternalCheck(order.id, item.id, advice.draft, asRole))
                      }}
                    >
                      Подтвердить этим
                    </button>
                  ) : null}
                  {advice.template && typed ? (
                    <button
                      type="button"
                      className="is-primary"
                      onClick={() => void onRun(() => api.confirmExternalCheck(order.id, item.id, typed, asRole))}
                    >
                      Подтвердить как есть
                    </button>
                  ) : null}
                </div>
                </div>
              </div>
            ) : null}
          </div>
          )
        }) : <p className="eo-muted">На вас открытых пунктов нет.</p>}
      </div>
      <div className="eo-form eo-rolework-list">
        <h3>Пробелы в данных · {gaps.length}</h3>
        {gaps.length ? gaps.map((item) => (
          <div key={item.id} className="eo-check">
            <span>
              «{item.field}» · {item.owner_label}{item.due_at ? `, до ${stamp(item.due_at)}` : ''}
              <br />
              <small className="eo-muted">{item.detail}</small>
            </span>
            {role === item.owner_role ? (
              <div className="eo-actions">
                <input
                  value={evidence[`gap:${item.id}`] || ''}
                  placeholder="Значение и источник"
                  onChange={(event) => onEvidence(`gap:${item.id}`, event.target.value)}
                />
                <button
                  className="eo-btn"
                  type="button"
                  disabled={!(evidence[`gap:${item.id}`] || '').trim()}
                  onClick={() => void onRun(() => api.closeExternalGap(order.id, item.id, evidence[`gap:${item.id}`] || '', asRole))}
                >
                  Закрыть пробел
                </button>
              </div>
            ) : <span className="eo-tag">ждёт владельца</span>}
          </div>
        )) : <p className="eo-muted">Открытых пробелов нет.</p>}
      </div>
      </>
      ) : null}
    </div>
  )
}

function DiffBlock({
  order,
  role,
  asRole,
  onRun
}: {
  order: Order
  role: string
  asRole: string
  onRun: RunAction
}): React.JSX.Element {
  const [owner, setOwner] = useState('')
  const [level, setLevel] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const diffs = order.diffs || []
  const open = diffs.filter((item) => item.status !== 'closed')
  const blocking = open.filter((item) => item.level === 'blocking').length
  const owners = [...new Map(diffs.map((item) => [item.owner_role, item.owner_label])).entries()]
  const rows = diffs.filter((item) => {
    if (owner && item.owner_role !== owner) return false
    if (level === 'closed') return item.status === 'closed'
    if (level && item.status === 'closed') return false
    if (level === 'blocking') return item.level === 'blocking'
    if (level === 'other') return item.level !== 'blocking'
    return true
  })
  const lines = (order.lines || []).filter((item) => item.change !== 'same')
  return (
    <section className="eo-window eo-window-main eo-wide">
      <div className="eo-window-head">
        <h3>Матрица сверки B01–B35 · {order.code}</h3>
      </div>
      <div className="eo-tiles">
        <div className={blocking ? 'eo-tile is-stop' : 'eo-tile'}>
          <small>Блокирующие</small>
          <b>{blocking}</b>
        </div>
        <div className="eo-tile">
          <small>Существенные</small>
          <b>{open.length - blocking}</b>
        </div>
        <div className="eo-tile is-ok">
          <small>Закрытые</small>
          <b>{diffs.length - open.length}</b>
        </div>
        <div className="eo-tile">
          <small>Изменений спецификации</small>
          <b>{lines.length}</b>
        </div>
      </div>
      <div className="eo-filters">
        <select value={owner} aria-label="Служба" onChange={(event) => setOwner(event.target.value)}>
          <option value="">Все службы</option>
          {owners.map(([id, label]) => (
            <option key={id} value={id}>{label || ROLE_NAME[id] || id}</option>
          ))}
        </select>
        <select value={level} aria-label="Уровень" onChange={(event) => setLevel(event.target.value)}>
          <option value="">Все уровни</option>
          <option value="blocking">Блокирующие</option>
          <option value="other">Существенные</option>
          <option value="closed">Закрытые</option>
        </select>
      </div>
      <div className="eo-tkp-scroll">
        <table className="eo-table">
          <thead>
            <tr><th>Код</th><th>Проверка</th><th>Уровень</th><th>ТКП</th><th>Договор</th><th>Комментарий</th><th></th></tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr><td colSpan={7} className="eo-muted">Расхождений под фильтр нет.</td></tr>
            ) : rows.map((item) => (
              <tr key={item.id}>
                <td>{item.code}</td>
                <td>{item.area}: {item.title}<br /><small className="eo-muted">{item.owner_label}</small></td>
                <td>
                  <span className={item.level === 'blocking' && item.status !== 'closed' ? 'eo-tag is-stop' : 'eo-tag'}>
                    {item.level === 'blocking' ? 'блокирующее' : 'существенное'}
                  </span>
                </td>
                <td>{item.left_value || '—'}</td>
                <td>{item.right_value || '—'}</td>
                <td>{item.note || '—'}</td>
                <td>
                  {item.status === 'closed' ? <span className="eo-tag is-ok">закрыто</span> : role === item.owner_role ? (
                    <div className="eo-actions">
                      <input
                        value={notes[item.id] || ''}
                        placeholder="Чем закрыто"
                        onChange={(event) => setNotes((prev) => ({ ...prev, [item.id]: event.target.value }))}
                      />
                      <button
                        className="eo-btn"
                        type="button"
                        onClick={() => void onRun(() => api.closeExternalDiff(order.id, item.id, (notes[item.id] || '').trim() || 'Закрыто владельцем', asRole))}
                      >
                        Закрыть
                      </button>
                    </div>
                  ) : <span className="eo-tag">ждёт владельца</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3>Построчное сравнение спецификаций</h3>
      {lines.length ? (
        <table className="eo-table">
          <thead>
            <tr><th>Изменение</th><th>Позиция</th><th>Количество</th><th>Сумма</th></tr>
          </thead>
          <tbody>
            {lines.map((item) => (
              <tr key={item.id}>
                <td><span className={item.change === 'removed' ? 'eo-tag is-stop' : 'eo-tag'}>{LINE_CHANGES[item.change] || item.change}</span></td>
                <td>{item.name}</td>
                <td>{item.qty}</td>
                <td>{item.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="eo-muted">Версии спецификации совпадают или ещё не загружены.</p>}
    </section>
  )
}

const BASELINE_FIELDS: { key: 'composition' | 'cost' | 'mcr' | 'margin' | 'bdds' | 'deadlines' | 'reason'; label: string }[] = [
  { key: 'composition', label: 'Состав' },
  { key: 'cost', label: 'Себестоимость' },
  { key: 'mcr', label: 'МЦР' },
  { key: 'margin', label: 'Маржа' },
  { key: 'bdds', label: 'БДДС' },
  { key: 'deadlines', label: 'Сроки' },
  { key: 'reason', label: 'Основание' }
]

function CommitteeBlock({
  order,
  role,
  asRole,
  onRun,
  onDocflow,
  onOpen
}: {
  order: Order
  role: string
  asRole: string
  onRun: RunAction
  onDocflow: OpenDocflow
  onOpen?: () => void
}): React.JSX.Element {
  const [protocol, setProtocol] = useState('')
  const [baseVersion, setBaseVersion] = useState('')
  const [conditions, setConditions] = useState('')
  const [baseline, setBaseline] = useState({ composition: '', cost: '', mcr: '', margin: '', bdds: '', deadlines: '', reason: '' })
  const services = new Map<string, { label: string; done: number; total: number; holding: boolean }>()
  for (const item of order.checks || []) {
    if (item.gate !== 'before_committee' || item.status === 'not_applicable') continue
    const row = services.get(item.owner_role) || { label: item.owner_label || ROLE_NAME[item.owner_role] || item.owner_role, done: 0, total: 0, holding: false }
    row.total += 1
    if (item.status === 'done') row.done += 1
    else if (item.blocking !== false) row.holding = true
    services.set(item.owner_role, row)
  }
  const baselines = (order.baselines || []).slice(-3)
  const lastBaseline = (order.baselines || []).slice(-1)[0]
  const openConditions = (order.decisions || []).filter((item) => item.conditions && !item.conditions_closed)
  const ownerDocs = (order.documents || []).filter((item) => item.owner_role && item.owner_role !== 'committee')
  const drafts = (order.findings || []).filter((item) => item.status === 'draft' && parseDraft1cFinding(item))
  const lastDecision = (order.decisions || []).slice(-1)[0]
  const decide = (decision: string, stage: string, cond: string): void =>
    void onRun(() => api.decideExternalOrder(order.id, {
      decision,
      protocol,
      base_version: decision === 'rework' ? '' : baseVersion,
      baseline_id: decision === 'rework' || baseVersion ? '' : lastBaseline?.id || '',
      allowed_stage: stage,
      conditions: cond
    }, asRole))

  return (
    <section className="eo-window eo-window-main eo-wide">
      <div className="eo-window-head">
        <h3>Комитет и базовые версии · {order.code} · {order.customer}</h3>
        <div className="eo-actions">
          {onOpen ? <button className="eo-btn" type="button" onClick={onOpen}>Открыть карточку</button> : null}
          <button
            className="eo-btn is-primary"
            type="button"
            onClick={() => onDocflow('assignment', {
              title: `Протокол Комитета по заказу ${order.code}`,
              text: [
                `Заказ ${order.code}: ${order.customer}, ${order.product}.`,
                lastDecision ? `Решение: ${lastDecision.decision}, протокол ${lastDecision.protocol || 'без номера'}, база ${lastDecision.base_version || '—'}.` : '',
                lastDecision?.conditions ? `Условия: ${lastDecision.conditions}.` : ''
              ].filter(Boolean).join('\n')
            })}
          >
            Протокол / поручение в 1С ДО
          </button>
        </div>
      </div>
      <div className="eo-passport-cols">
        <div>
          <p className="eo-now-kicker">Готовность служб к Комитету</p>
          {services.size ? (
            <table className="eo-table">
              <thead><tr><th>Служба</th><th>Пункты</th><th>Гейт «До Комитета»</th></tr></thead>
              <tbody>
                {[...services.entries()].map(([id, item]) => (
                  <tr key={id}>
                    <td>{item.label}</td>
                    <td>{item.done}/{item.total}</td>
                    <td>
                      <span className={item.holding ? 'eo-tag is-stop' : item.done === item.total ? 'eo-tag is-ok' : 'eo-tag'}>
                        {item.holding ? 'держит гейт' : item.done === item.total ? 'подтвердила' : 'в работе'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="eo-muted">Пунктов «До Комитета» нет.</p>}
        </div>
        <div>
          <p className="eo-now-kicker">Решения</p>
          {(order.decisions || []).length ? order.decisions.map((item) => (
            <p key={item.id}>
              {item.protocol || 'без номера'}: {item.decision}, база {item.base_version || '—'}.
              {item.conditions ? ` Условия: ${item.conditions}.` : ''}
              {item.conditions_closed ? ' Условия закрыты.' : ''}
            </p>
          )) : <p className="eo-muted">Решений ещё нет.</p>}
          {role === 'committee' && openConditions.length ? openConditions.map((decision) => (
            <div key={decision.id} className="eo-actions">
              <span className="eo-muted">Закрыть условия {decision.protocol || ''} документом:</span>
              {ownerDocs.length ? ownerDocs.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  className="eo-btn"
                  onClick={() => void onRun(() => api.closeExternalConditions(order.id, decision.id, doc.id, asRole))}
                >
                  {doc.title || doc.file_name || kindLabel(doc.kind)}
                </button>
              )) : <span className="eo-muted">документов владельцев нет</span>}
            </div>
          )) : null}
        </div>
      </div>
      <p className="eo-now-kicker">Сравнение базовых версий</p>
      {baselines.length ? (
        <div className="eo-tkp-scroll">
          <table className="eo-table eo-compare">
            <thead>
              <tr>
                <th>Показатель</th>
                {baselines.map((item) => (
                  <th key={item.id}>{item.code || 'БВ'}{item.immutable ? ' · неизменяема' : ' · черновик'}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BASELINE_FIELDS.map((field) => (
                <tr key={field.key}>
                  <td>{field.label}</td>
                  {baselines.map((item, index) => {
                    const value = String(item[field.key] || '')
                    const prev = index ? String(baselines[index - 1][field.key] || '') : value
                    return <td key={item.id} className={value !== prev ? 'is-diff' : ''}>{value || '—'}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="eo-muted">Базовой версии ещё нет.</p>}
      {BASELINE_ROLES.has(role) ? (
        <div className="eo-journal-form">
          {BASELINE_FIELDS.map((field) => (
            <label key={field.key}>
              {field.label}
              <input value={baseline[field.key]} onChange={(event) => setBaseline({ ...baseline, [field.key]: event.target.value })} />
            </label>
          ))}
          <button type="button" className="is-primary" onClick={() => void onRun(() => api.createExternalBaseline(order.id, baseline, asRole))}>
            Собрать базовую версию
          </button>
        </div>
      ) : null}
      {drafts.length ? (
        <div className="eo-form">
          <p className="eo-now-kicker">Проекты документов 1С ДО от помощника</p>
          {drafts.map((item) => {
            const draft = parseDraft1cFinding(item)
            const label = humanFindingLabel(item)
            const extra = draft?.title && draft.title !== label ? draft.title : ''
            return draft ? (
              <div key={item.id} className="eo-check">
                <span>{label}{extra ? <><br /><small className="eo-muted">{extra}</small></> : null}</span>
                <button type="button" className="eo-btn" onClick={() => onDocflow(draft.kind, draft)}>Открыть в 1С ДО</button>
              </div>
            ) : null
          })}
        </div>
      ) : null}
      {role === 'committee' ? (
        <div className="eo-form">
          <h3>Решение Комитета</h3>
          <input value={protocol} placeholder="Номер протокола" onChange={(event) => setProtocol(event.target.value)} />
          <input value={baseVersion} placeholder={`Базовая версия${lastBaseline?.code ? ` (по умолчанию ${lastBaseline.code})` : ''}`} onChange={(event) => setBaseVersion(event.target.value)} />
          <input value={conditions} placeholder="Условия, если решение с условиями" onChange={(event) => setConditions(event.target.value)} />
          <div className="eo-actions">
            <button type="button" className="eo-btn is-primary" onClick={() => decide('confirmed', 'tkp', '')}>Подтвердить базовую версию</button>
            <button type="button" className="eo-btn" onClick={() => decide('confirmed_conditions', 'tkp', conditions)}>Подтвердить с условиями</button>
            <button type="button" className="eo-btn" onClick={() => decide('rework', 'calc', conditions)}>Вернуть на доработку</button>
          </div>
        </div>
      ) : <p className="eo-muted">Решение фиксирует только Комитет.</p>}
    </section>
  )
}

function Card({
  order,
  role,
  evidence,
  onEvidence,
  onBack,
  onRun,
  path,
  user,
  initialPage,
  onPageChange,
  onRunAgent,
  onServiceAgent,
  agentBusy,
  copilotBusy,
  panel,
  onCopilot,
  onDocflow,
  procedureDraft,
  procedureNote,
  onProcedureDraft,
  onSaveProcedure
}: {
  order: Order
  role: string
  evidence: Record<string, string>
  onEvidence: (id: string, value: string) => void
  onBack: () => void
  onRun: RunAction
  path: SimplifiedStep[]
  user: UserProfile
  initialPage: CardPage
  onPageChange: (page: CardPage) => void
  onRunAgent: RunAgentHandler
  onServiceAgent: (extra?: string) => void
  agentBusy: boolean
  copilotBusy: boolean
  panel: (passport: StagePassport | null) => HelperPanelProps
  onCopilot: (stepId?: string) => void
  onDocflow: OpenDocflow
  procedureDraft: string
  procedureNote: string
  onProcedureDraft: (value: string) => void
  onSaveProcedure: () => void
}): React.JSX.Element {
  const asRole = role
  const linked = order.sections?.onec
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ExternalOnecSearch | null>(null)
  const [lookupError, setLookupError] = useState('')
  const canLink = role === 'ks' || role === 'development' || role === 'finance' || role === 'it'
  const canUpload = UPLOAD_ROLES.has(role)
  const fileKinds = role === 'committee' ? FILE_KINDS.filter((item) => item.id === 'protocol') : FILE_KINDS
  const [fileKind, setFileKind] = useState(role === 'committee' ? 'protocol' : 'contract')
  const [shelfOver, setShelfOver] = useState(false)
  const [selectedFileId, setSelectedFileId] = useState('')
  const [fileEdit, setFileEdit] = useState({ kind: '', title: '' })
  const versionRef = useRef<HTMLInputElement>(null)
  const selectedFile = order.documents.find((item) => item.id === selectedFileId)
  const shelfGroups = [
    ...FILE_KINDS.map((kind) => ({ id: kind.id, label: kind.label, docs: order.documents.filter((doc) => doc.kind === kind.id) })),
    {
      id: 'stray',
      label: 'Другие',
      docs: order.documents.filter((doc) => !FILE_KINDS.some((kind) => kind.id === doc.kind))
    }
  ].filter((group) => group.docs.length)
  const [linkDraft, setLinkDraft] = useState<Record<string, { target: string; relation: string }>>({})
  const [fileOffer, setFileOffer] = useState('')
  const [projectDraft, setProjectDraft] = useState({ title: '', text: '', target: '', relation: 'attachment', kind: 'correspondence' })
  const fileRef = useRef<HTMLInputElement>(null)

  function kindForName(name: string): string {
    const guessed = guessFileKind(name)
    if (fileKinds.some((item) => item.id === guessed)) return guessed
    return fileKinds.some((item) => item.id === fileKind) ? fileKind : fileKinds[0]?.id || 'other'
  }

  function pickFile(doc: Order['documents'][number] | undefined): void {
    setSelectedFileId(doc?.id || '')
    setFileEdit({ kind: doc?.kind || '', title: doc?.title || '' })
  }

  async function fileBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    bytes.forEach((item) => {
      binary += String.fromCharCode(item)
    })
    return btoa(binary)
  }

  function uploadFiles(files: File[]): void {
    if (!files.length || !canUpload) return
    void onRun(async () => {
      let next = order
      let offer = ''
      let last: Order['documents'][number] | undefined
      for (const file of files) {
        const kind = kindForName(file.name)
        setFileKind(kind)
        const known = new Set(next.documents.map((item) => item.id))
        next = await api.uploadExternalFile(order.id, {
          kind,
          filename: file.name,
          content_base64: await fileBase64(file)
        }, asRole)
        last = next.documents.find((item) => !known.has(item.id))
        offer = last?.anchor || last?.title || file.name
      }
      if (offer) setFileOffer(offer)
      if (last) pickFile(last)
      return next
    })
  }

  function uploadVersion(file: File, base: Order['documents'][number]): void {
    if (!canUpload) return
    void onRun(async () => {
      const known = new Set(order.documents.map((item) => item.id))
      let next = await api.uploadExternalFile(order.id, {
        kind: base.kind,
        filename: file.name,
        content_base64: await fileBase64(file)
      }, asRole)
      const added = next.documents.find((item) => !known.has(item.id))
      if (added && base.anchor) {
        next = await api.linkExternalFile(order.id, added.id, { target: base.anchor, relation: 'version' }, asRole)
      }
      const fresh = next.documents.find((item) => item.id === added?.id)
      if (fresh) pickFile(fresh)
      setFileOffer(fresh?.anchor || file.name)
      return next
    })
  }

  const [rpName, setRpName] = useState(order.owners?.rp || '')
  const [risk, setRisk] = useState({ title: '', impact: '', measure: '' })
  const [page, setPage] = useState<CardPage>(initialPage)
  const [stageId, setStageId] = useState('')
  const shownOrderRef = useRef(order.id)
  const [pathNote, setPathNote] = useState('')
  const [pathBusy, setPathBusy] = useState('')
  const passports = useMemo(() => buildStagePassports(order), [order])
  const currentPassport = activePassport(passports)
  const inspected = passports.find((item) => item.id === stageId) || currentPassport
  const inspectedIndex = inspected ? passports.indexOf(inspected) : -1
  const currentIndex = currentPassport ? passports.indexOf(currentPassport) : 0
  const nextStatuses = new Set(LINE[currentIndex + 1]?.statuses || [])
  const roleMoves = MOVES[role] || []
  const nextMoves = roleMoves.filter((move) => nextStatuses.has(move.target))
  const laterMoves = roleMoves.filter((move) => !nextStatuses.has(move.target))
  const myOpen = (order.checks || []).filter((item) => item.owner_role === role && item.status !== 'done' && item.status !== 'not_applicable')
  const openGaps = (order.gaps || []).filter((item) => item.status === 'open')
  const pendingFindings = (order.findings || []).filter((item) => item.status === 'draft')

  useEffect(() => {
    setRpName(order.owners?.rp || '')
  }, [order.id, order.owners])
  const [passportOpen, setPassportOpen] = useState(false)
  useEffect(() => {
    if (shownOrderRef.current === order.id) return
    shownOrderRef.current = order.id
    setStageId('')
    setPassportOpen(false)
  }, [order.id])
  useEffect(() => {
    onPageChange(page)
    savePage(page)
  }, [page, onPageChange])

  async function lookup(counterparty = ''): Promise<void> {
    setLookupError('')
    try {
      setHits(await api.searchExternalOnec(counterparty ? '' : query, counterparty))
    } catch (err) {
      setHits(null)
      setLookupError(err instanceof ApiError ? err.message : '1С не ответила')
    }
  }

  async function openStepForm(step: SimplifiedStep): Promise<void> {
    if (!step.form) return
    setPathNote('')
    setPathBusy(step.id)
    try {
      const res = await invokeLocalAcTool(
        'onec.open_form',
        onecComInvokeArgs({ form: step.form }, user),
        120_000,
        user
      )
      if (!res.ok) setPathNote(res.error || 'Форма 1С не открылась')
    } catch (err) {
      setPathNote(err instanceof Error ? err.message : 'Форма 1С не открылась')
    } finally {
      setPathBusy('')
    }
  }

  async function openStepFile(step: SimplifiedStep): Promise<void> {
    if (!step.file) return
    setPathNote('')
    const res = await window.api.openPath(step.file)
    if (!res.ok) setPathNote(res.error || 'Шаблон не открылся')
  }

  async function openPurchaseAgent(): Promise<void> {
    setPathNote('')
    setPathBusy('purchase')
    try {
      const agent = await api.externalPurchaseAgent()
      if (!agent.workflow_id) {
        setPathNote('Агент внешних закупок ещё не опубликован.')
        return
      }
      onRunAgent(
        agent.workflow_id,
        agent.title || 'ИИ-агент внешних закупок',
        agentBrief(order, 'omto'),
        chatContext(order, 'omto')
      )
    } catch (err) {
      setPathNote(helperFailure(err, 'Помощник по закупке не запустился'))
    } finally {
      setPathBusy('')
    }
  }

  async function openStepAgent(step: SimplifiedStep): Promise<void> {
    setPathNote('')
    setPathBusy(step.id)
    try {
      const agent = await api.externalOrderAgent()
      if (!agent.workflow_id) {
        setPathNote('Агент внешнего заказа ещё не опубликован.')
        return
      }
      onRunAgent(
        agent.workflow_id,
        agent.title || 'ИИ-агент внешнего заказа',
        agentBrief(order, role, step),
        chatContext(order, role)
      )
    } catch (err) {
      setPathNote(helperFailure(err, 'Помощник не запустился'))
    } finally {
      setPathBusy('')
    }
  }

  const ownForms = ROLE_FIELDS[role] || []
  const ownFieldsTotal = ownForms.reduce((total, form) => total + form.fields.length, 0)
  const ownFieldsFilled = ownForms.reduce(
    (total, form) =>
      total + form.fields.filter((field) => String(order.sections?.[form.section]?.[field.key] || '').trim()).length,
    0
  )
  const pages: { id: CardPage; label: string; note: string; hidden?: boolean }[] = [
    { id: 'summary', label: 'Сводка', note: order.status_label },
    {
      id: 'fields',
      label: 'Поля моей службы',
      note: ownFieldsTotal ? `${ownFieldsFilled}/${ownFieldsTotal} заполнено` : 'полей нет',
      hidden: role === 'viewer'
    },
    { id: 'checks', label: 'Чек-лист и пробелы', note: `${myOpen.length} моих · ${openGaps.length} пробелов` },
    { id: 'diff', label: 'Сверка B01–B35', note: `${(order.diffs || []).filter((item) => item.status !== 'closed').length} открыто` },
    { id: 'committee', label: 'Комитет и БВ', note: order.decisions?.slice(-1)[0]?.decision || `${(order.baselines || []).length} БВ` },
    { id: 'path', label: 'Путь 1С и план', note: order.onec_number || `${(order.tasks || []).length} задач` },
    { id: 'files', label: 'Файлы дела', note: `${(order.documents || []).length} в деле` },
    { id: 'ai', label: 'ИИ-помощник', note: pendingFindings.length ? `${pendingFindings.length} черновиков` : 'черновиков нет' },
    { id: 'history', label: 'История', note: `${(order.audit || []).length} записей` }
  ]
  const shownPage: CardPage = pages.some((item) => item.id === page && !item.hidden) ? page : 'summary'

  return (
    <article className="eo-card">
      <header className="eo-wide eo-head">
        <div>
          <button type="button" className="eo-back" onClick={onBack}>К списку</button>
          <h2>{order.code} · {order.customer}</h2>
          <p className="eo-muted">{order.product}. Шаг {currentIndex + 1} из {LINE.length}: {order.status_label}.</p>
          <p className="eo-case-line">
            Дальше: {passports[currentIndex + 1]?.label || 'закрытие'}.
            {' '}Мой шаг: {myOpen.length ? myOpen.map((item) => item.text).slice(0, 2).join('; ') : 'нет'}.
            {' '}Файлы: {(order.documents || []).length}, связей {(order.document_links || []).length}.
            {' '}{order.payment_note}
            {order.sections?.onec?.delivery_days ? `. Срок поставки: ${order.sections.onec.delivery_days}` : ''}.
          </p>
        </div>
        <div className="eo-actions">
          <button type="button" disabled={pathBusy === 'purchase'} onClick={() => void openPurchaseAgent()}>
            {pathBusy === 'purchase' ? 'Закупка…' : 'Помощник по закупке'}
          </button>
          {role && role !== 'viewer' ? (
            <button type="button" disabled={agentBusy} onClick={() => onServiceAgent()}>
              {agentBusy ? 'Служба…' : `Агент · ${ROLE_NAME[role] || 'служба'}`}
            </button>
          ) : null}
          {user.isAdmin && role && role !== 'viewer' ? (
            <details className="eo-procedure">
              <summary>Приём службы</summary>
              <textarea
                value={procedureDraft}
                rows={4}
                placeholder="Какой шаг вызывать и чего не писать. Без сумм, номеров и имён файлов."
                onChange={(event) => onProcedureDraft(event.target.value)}
              />
              <button type="button" onClick={onSaveProcedure}>Сохранить приём</button>
              {procedureNote ? <p>{procedureNote}</p> : null}
            </details>
          ) : null}
          {role !== 'viewer' ? (
            <button
              type="button"
              className="is-primary"
              disabled={copilotBusy}
              onClick={() => {
                setPage('ai')
                onCopilot()
              }}
            >
              {copilotBusy ? 'ИИ готовит карточку…' : 'Авто-подготовка с ИИ'}
            </button>
          ) : null}
        </div>
      </header>
      {pathNote ? <p className="eo-error">{pathNote}</p> : null}
      <StageStepper
        passports={passports}
        activeId={inspected?.id || ''}
        onSelect={(id) => {
          setStageId(id)
          setPassportOpen(true)
        }}
      />
      {inspected ? (
        <details
          className={`eo-passport-head is-${inspected.state}`}
          open={passportOpen}
          onToggle={(event) => setPassportOpen((event.target as HTMLDetailsElement).open)}
        >
          <summary>
            <span className="eo-now-kicker">Паспорт этапа · {STAGE_STATE[inspected.state]}</span>
            <b>{inspected.label}</b>
            <span>Чек-лист {inspected.checks_done}/{inspected.checks_total}</span>
            {inspected.blocker ? <span className="eo-passport-head-stop">Блокирует: {inspected.blocker}</span> : null}
            <span className="eo-passport-head-toggle">{passportOpen ? 'Свернуть' : 'Подробнее'}</span>
          </summary>
          <PassportView
            order={order}
            passport={inspected}
            next={passports[inspectedIndex + 1] || null}
            role={role}
            asRole={asRole}
            evidence={evidence}
            onEvidence={onEvidence}
            onRun={onRun}
          />
        </details>
      ) : null}
      <div className="eo-pages" role="tablist" aria-label="Страницы заказа">
        {pages.filter((item) => !item.hidden).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={shownPage === item.id ? 'is-active' : ''}
            aria-selected={shownPage === item.id}
            onClick={() => setPage(item.id)}
          >
            {item.label}
            <small>{item.note}</small>
          </button>
        ))}
      </div>
      {shownPage === 'summary' ? (
        <>
          <div className="eo-now">
            <section className="eo-now-main eo-summary">
              <p className="eo-now-kicker">Что сейчас нужно от {ROLE_NAME[role] || 'вас'}</p>
              <div className="eo-tiles">
                <button type="button" className={myOpen.length ? 'eo-tile is-stop' : 'eo-tile'} onClick={() => setPage('checks')}>
                  <small>Мои открытые пункты</small>
                  <b>{myOpen.length}</b>
                </button>
                <button type="button" className={openGaps.length ? 'eo-tile is-stop' : 'eo-tile'} onClick={() => setPage('checks')}>
                  <small>Пробелы в данных</small>
                  <b>{openGaps.length}</b>
                </button>
                <button type="button" className="eo-tile" onClick={() => setPage(role === 'viewer' ? 'summary' : 'fields')}>
                  <small>Поля моей службы</small>
                  <b>{ownFieldsTotal ? `${ownFieldsFilled}/${ownFieldsTotal}` : '—'}</b>
                </button>
                <button type="button" className={pendingFindings.length ? 'eo-tile is-ai' : 'eo-tile'} onClick={() => setPage('ai')}>
                  <small>Черновики ИИ ждут решения</small>
                  <b>{pendingFindings.length}</b>
                </button>
              </div>
              {myOpen.length ? (
                <ol className="eo-summary-list">
                  {myOpen.slice(0, 5).map((item) => (
                    <li key={item.id}>
                      {item.text}
                      <small className="eo-muted"> · {GATES[item.gate] || item.gate}{item.due_at ? ` · до ${item.due_at.slice(0, 10)}` : ''}</small>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="eo-muted">На вас открытых пунктов нет.</p>
              )}
              <p className="eo-muted">
                {order.customer} · {order.product}
                {order.onec_number ? ` · 1С ${order.onec_number}` : ''}
              </p>
            </section>
            <section className="eo-now-side">
              <p className="eo-now-kicker">{ROLE_NAME[role] || 'Сотрудник'} · сейчас</p>
              <h3>{order.status_label}</h3>
              {(order.blocks || []).map((item) => (
                <p key={item} className="eo-note">{item}</p>
              ))}
              <p className="eo-muted">
                Мои пункты: {myOpen.length} · пробелы: {openGaps.length} · черновики ИИ: {pendingFindings.length}
              </p>
              {order.payment_note ? <p className="eo-muted">{order.payment_note}</p> : null}
              <div className="eo-actions">
                {nextMoves.map((move) => (
                  <button key={move.target} type="button" className="is-primary" onClick={() => void onRun(() => api.transitionExternalOrder(order.id, move.target, asRole))}>
                    Дальше: {move.label}
                  </button>
                ))}
                {laterMoves.map((move) => (
                  <button key={move.target} type="button" onClick={() => void onRun(() => api.transitionExternalOrder(order.id, move.target, asRole))}>
                    {move.label}
                  </button>
                ))}
              </div>
              <p className="eo-now-kicker">Маршрут</p>
              <div className="eo-tags">
                {ROUTES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={role !== 'development' && role !== 'committee'}
                    className={order.route === item.id ? 'eo-chip-btn is-active' : 'eo-chip-btn'}
                    onClick={() => void onRun(() => api.patchExternalOrder(order.id, { route: item.id }, asRole))}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </>
      ) : null}
      {shownPage === 'fields' ? (
        <RoleWork part="fields" order={order} role={role} asRole={asRole} evidence={evidence} onEvidence={onEvidence} onRun={onRun} />
      ) : null}
      {shownPage === 'path' ? (
        <>
          <section className="eo-form eo-wide">
            <h3>Цепочка документов 1С</h3>
            {pathSteps(linked?.path).length ? (
              <ol className="eo-path">
                {pathSteps(linked?.path).map((step) => (
                  <li key={step.id} className={`is-${step.state}`}>
                    <b>{step.title}</b>
                    <span>{step.detail}</span>
                  </li>
                ))}
              </ol>
            ) : linked?.order_number ? (
              <p>Заказ {linked.order_number}. ТКП к нему ещё не подтянуто.</p>
            ) : (
              <p className="eo-muted">Загрузите коммерческое предложение в «Реестре». Карточка повторит заказ, договор, отгрузку и оплату.</p>
            )}
            {linked?.deal_name ? (
              <p>CRM: {linked.deal_name}{linked.deal_status ? `, ${linked.deal_status}` : ''}.</p>
            ) : null}
            {scheduleRows(linked?.schedule).length ? (
              <p className="eo-muted">
                График оплаты заказа: {scheduleRows(linked?.schedule).map((item) => `${item.percent || '—'}% ${item.date || ''}`.trim()).join('; ')}.
              </p>
            ) : null}
            {order.sections?.strategy?.project_name ? (
              <p>
                TurboProject: {order.sections.strategy.project_name}
                {order.sections.strategy.finish_date ? `, окончание ${order.sections.strategy.finish_date}` : ''}.
                {' '}{order.sections.strategy.note}
              </p>
            ) : order.sections?.strategy?.note ? <p className="eo-muted">{order.sections.strategy.note}</p> : null}
            {role !== 'viewer' && (linked?.order_number || linked?.tkp_key) ? (
              <div className="eo-actions">
                <button type="button" onClick={() => void onRun(() => api.refreshExternalPayment(order.id, asRole))}>
                  Повторить путь из 1С
                </button>
                {['ks', 'development', 'rp', 'finance', 'it'].includes(role) ? (
                  <button type="button" onClick={() => void onRun(() => api.linkExternalStrategy(order.id, asRole))}>
                    Стратегический план
                  </button>
                ) : null}
              </div>
            ) : null}
            {canLink ? (
              <>
                <div className="eo-actions">
                  <input value={query} placeholder="Контрагент, ИНН или номер заказа" onChange={(event) => setQuery(event.target.value)} />
                  <button type="button" onClick={() => void lookup()}>Найти в 1С</button>
                </div>
                {lookupError ? <p className="eo-error">{lookupError}</p> : null}
                {(hits?.counterparties || []).map((item) => (
                  <button key={item.key} type="button" className="eo-row" onClick={() => void lookup(item.key)}>
                    <strong>{item.name}</strong>
                    <span>{item.inn ? `ИНН ${item.inn}. ` : ''}Показать заказы этого контрагента</span>
                  </button>
                ))}
                {(hits?.orders || []).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="eo-row"
                    onClick={() => void onRun(() => api.linkExternalOrder(order.id, item.key, asRole))}
                  >
                    <strong>Заказ {item.number || 'без номера'}</strong>
                    <span>{item.date} · {item.amount}</span>
                  </button>
                ))}
              </>
            ) : null}
          </section>
          {path.length ? (
            <section className="eo-serial" aria-label="Несерийный путь">
              <h3>Несерийный путь{order.route === 'simplified' ? '' : ' (для упрощённого маршрута)'}</h3>
              <ol>
                {path.map((step, index) => (
                  <li key={step.id}>
                    <div>
                      <b>{index + 1}. {step.title}</b>
                      <small>{step.detail}</small>
                    </div>
                    <div className="eo-actions">
                      {step.form ? (
                        <button type="button" disabled={pathBusy === step.id} onClick={() => void openStepForm(step)}>
                          Открыть в 1С
                        </button>
                      ) : null}
                      {step.file ? (
                        <button type="button" onClick={() => void openStepFile(step)}>
                          Открыть шаблон
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onDocflow('memo', {
                          title: `${step.title} · заказ ${order.code}`,
                          text: `По внешнему заказу ${order.code} (${order.customer}, ${order.product}). ${step.detail}`
                        })}
                      >
                        Создать в 1С ДО
                      </button>
                      {role !== 'viewer' ? (
                        <button
                          type="button"
                          disabled={copilotBusy}
                          onClick={() => {
                            setPage('ai')
                            onCopilot(step.id)
                          }}
                        >
                          Проверить шаг
                        </button>
                      ) : null}
                      <button type="button" className="is-primary" disabled={pathBusy === step.id} onClick={() => void openStepAgent(step)}>
                        Запустить шаг с ИИ
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <PlanBuilder
            key={order.id}
            order={order}
            role={role}
            asRole={asRole}
            user={user}
            onOrder={(next) => void onRun(async () => next)}
          />
          <section className="eo-journal" aria-label="План">
            <div className="eo-journal-bar">
              <h3>Задачи плана</h3>
              {role === 'ks' || role === 'rp' ? (
                <div className="eo-journal-actions">
                  <button type="button" onClick={() => void onRun(() => api.buildExternalPlan(order.id, asRole))}>Собрать проект плана</button>
                  {role === 'rp' ? (
                    <button type="button" onClick={() => void onRun(() => api.approveExternalPlan(order.id, asRole))}>Утвердить базовый план</button>
                  ) : null}
                  {role === 'rp' ? (
                    <button type="button" onClick={() => void onRun(() => api.publishExternalPlan(order.id, asRole))}>Отправить план в TurboProject</button>
                  ) : null}
                </div>
              ) : <span className="eo-status">{(order.tasks || []).length}</span>}
            </div>
            {order.project_note ? <p className="eo-note">{order.project_note}</p> : null}
            <div className="eo-journal-scroll">
              <table className="eo-journal-table">
                <thead>
                  <tr><th>Задача</th><th>Путь</th><th>Зависит от</th><th>Статус</th></tr>
                </thead>
                <tbody>
                  {(order.tasks || []).length === 0 ? (
                    <tr><td className="eo-journal-empty" colSpan={4}>Задач плана нет.</td></tr>
                  ) : (order.tasks || []).map((item) => (
                    <tr key={item.id}>
                      <td>{item.title}</td>
                      <td>{item.critical ? item.source_ref || 'критический' : 'обычный'}</td>
                      <td>{item.depends_on || '—'}</td>
                      <td>
                        <span className={item.approved ? 'eo-status is-ok' : 'eo-status'}>
                          {item.published ? 'опубликован' : item.approved ? 'утверждён' : 'черновик'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {OWNER_ROLES.has(role) ? (
              <div className="eo-journal-form">
                <label>
                  Руководитель проекта
                  <input value={rpName} placeholder="ФИО" onChange={(event) => setRpName(event.target.value)} />
                </label>
                <button type="button" onClick={() => void onRun(() => api.patchExternalOrder(order.id, { owners: { rp: rpName } }, asRole))}>
                  Назначить
                </button>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
      {shownPage === 'diff' ? <DiffBlock order={order} role={role} asRole={asRole} onRun={onRun} /> : null}
      {shownPage === 'committee' ? (
        <CommitteeBlock order={order} role={role} asRole={asRole} onRun={onRun} onDocflow={onDocflow} />
      ) : null}
      {shownPage === 'files' ? (
        <>
          <section className="eo-journal" aria-label="Файлы дела">
            <div className="eo-journal-bar">
              <h3>Файлы дела · {order.documents.length}</h3>
              {canUpload ? (
                <div className="eo-files-add">
                  <label className="eo-file-kind">
                    Вид, если из названия не ясно
                    <select value={fileKind} onChange={(event) => setFileKind(event.target.value)}>
                      {fileKinds.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="is-primary" onClick={() => fileRef.current?.click()}>
                    <Paperclip size={14} aria-hidden /> Прикрепить
                  </button>
                </div>
              ) : null}
              <input
                ref={fileRef}
                className="eo-file-input"
                type="file"
                multiple
                accept=".docx,.xlsx,.pdf"
                onChange={(event) => {
                  const picked = [...(event.target.files || [])]
                  event.target.value = ''
                  uploadFiles(picked)
                }}
              />
              <input
                ref={versionRef}
                className="eo-file-input"
                type="file"
                accept=".docx,.xlsx,.pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file && selectedFile) uploadVersion(file, selectedFile)
                }}
              />
            </div>
            <div className="eo-files">
              <div
                className={`eo-shelf${shelfOver ? ' is-over' : ''}`}
                onDragEnter={(event) => {
                  if (!canUpload) return
                  event.preventDefault()
                  setShelfOver(true)
                }}
                onDragOver={(event) => {
                  if (!canUpload) return
                  event.preventDefault()
                  setShelfOver(true)
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                  setShelfOver(false)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  setShelfOver(false)
                  uploadFiles([...(event.dataTransfer.files || [])])
                }}
              >
                {shelfGroups.length === 0 ? (
                  <p className="eo-shelf-empty">
                    В деле пока нет файлов.{canUpload ? ' Перетащите сюда DOCX, XLSX или PDF или нажмите «Прикрепить».' : ''}
                  </p>
                ) : shelfGroups.map((group) => (
                  <div key={group.id} className="eo-shelf-group">
                    <span className="eo-now-kicker">{group.label} · {group.docs.length}</span>
                    <div className="eo-shelf-grid">
                      {group.docs.map((doc) => {
                        const links = (doc.links || []).length + (doc.backlinks || []).length
                        return (
                          <button
                            key={doc.id}
                            type="button"
                            className={`eo-file-tile${doc.id === selectedFile?.id ? ' is-active' : ''}`}
                            title={doc.file_name || doc.title}
                            onClick={() => pickFile(doc.id === selectedFile?.id ? undefined : doc)}
                            onDoubleClick={() => {
                              if (doc.file_name) void api.openExternalFile(order.id, doc.id, doc.file_name)
                            }}
                          >
                            <TodayFileIcon name={doc.file_name || doc.title || 'файл.docx'} size={34} />
                            <b>{doc.title || doc.file_name || 'файл'}</b>
                            <small>
                              {doc.version || '—'} · {doc.approved ? 'утверждён' : 'черновик'}
                              {links ? ` · связей ${links}` : ''}
                            </small>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
                {shelfOver ? <div className="eo-shelf-drop">Отпустите, чтобы положить в дело</div> : null}
              </div>
              {selectedFile ? (() => {
                const item = selectedFile
                const draft = linkDraft[item.id] || { target: '', relation: 'attachment' }
                const others = order.documents.filter((other) => other.id !== item.id)
                return (
                  <aside className="eo-file-panel" aria-label="Файл">
                    <header>
                      <TodayFileIcon name={item.file_name || item.title || 'файл.docx'} size={40} />
                      <div>
                        <b>{item.title || item.file_name || 'файл'}</b>
                        <small>
                          {kindLabel(item.kind)} · {item.version || '—'} · {item.approved ? 'утверждён' : 'черновик'}
                        </small>
                      </div>
                      <button type="button" className="eo-file-close" aria-label="Закрыть" onClick={() => pickFile(undefined)}>
                        ×
                      </button>
                    </header>
                    <div className="eo-file-actions">
                      {item.file_name ? (
                        <button
                          type="button"
                          className="is-primary"
                          onClick={() => void api.openExternalFile(order.id, item.id, item.file_name || 'file')}
                        >
                          Открыть
                        </button>
                      ) : null}
                      {item.file_name ? (
                        <button
                          type="button"
                          onClick={() =>
                            void api.download(
                              `/api/v1/external-orders/${encodeURIComponent(order.id)}/files/${encodeURIComponent(item.id)}`,
                              item.file_name || item.title || 'file'
                            )
                          }
                        >
                          Скачать
                        </button>
                      ) : null}
                      {canUpload ? (
                        <button type="button" onClick={() => versionRef.current?.click()}>
                          Новая версия
                        </button>
                      ) : null}
                      {!item.approved && (role === 'ks' || role === item.owner_role) ? (
                        <button type="button" onClick={() => void onRun(() => api.approveExternalFile(order.id, item.id, asRole))}>
                          Утвердить
                        </button>
                      ) : null}
                      {!item.approved && canUpload ? (
                        <button
                          type="button"
                          onClick={() => {
                            pickFile(undefined)
                            void onRun(() => api.deleteExternalFile(order.id, item.id, asRole))
                          }}
                        >
                          Удалить
                        </button>
                      ) : null}
                      {role !== 'viewer' ? (
                        <button
                          type="button"
                          disabled={agentBusy}
                          onClick={() =>
                            onServiceAgent(
                              fileScenarioPrompt(order, {
                                id: 'changes',
                                group: 'Сводка',
                                label: 'Что изменилось',
                                ask: `Что в файле ${item.anchor || item.title} и что изменилось относительно связанных версий.`
                              })
                            )
                          }
                        >
                          Спросить помощника
                        </button>
                      ) : null}
                    </div>
                    {canUpload && !item.approved ? (
                      <form
                        className="eo-file-edit"
                        onSubmit={(event) => {
                          event.preventDefault()
                          void onRun(() => api.patchExternalFile(order.id, item.id, fileEdit, asRole))
                        }}
                      >
                        <label>
                          Вид
                          <select value={fileEdit.kind} onChange={(event) => setFileEdit({ ...fileEdit, kind: event.target.value })}>
                            {fileKinds.map((kind) => (
                              <option key={kind.id} value={kind.id}>{kind.label}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Название
                          <input value={fileEdit.title} onChange={(event) => setFileEdit({ ...fileEdit, title: event.target.value })} />
                        </label>
                        <button type="submit" disabled={fileEdit.kind === item.kind && fileEdit.title === item.title}>
                          Сохранить
                        </button>
                      </form>
                    ) : null}
                    <div className="eo-file-links">
                      <span className="eo-now-kicker">Связи</span>
                      {(item.links || []).length || (item.backlinks || []).length ? (
                        <div className="eo-link-chips">
                          {(item.links || []).map((link) => (
                            <span key={link.id} className="eo-link-chip">
                              {link.relation_label} → {link.target}
                              {canUpload ? (
                                <button type="button" onClick={() => void onRun(() => api.unlinkExternalFile(order.id, link.id, asRole))}>
                                  снять
                                </button>
                              ) : null}
                            </span>
                          ))}
                          {(item.backlinks || []).map((link) => (
                            <span key={`back-${link.id}`} className="eo-link-chip is-back">
                              {link.source} → {link.relation_label}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="eo-muted">Связей нет.</p>
                      )}
                    </div>
                    {canUpload && others.length ? (
                      <form
                        className="eo-file-edit"
                        onSubmit={(event) => {
                          event.preventDefault()
                          const target = draft.target.trim()
                          if (!target) return
                          void onRun(async () => {
                            const next = await api.linkExternalFile(
                              order.id,
                              item.id,
                              { target, relation: draft.relation },
                              asRole
                            )
                            setLinkDraft((prev) => ({ ...prev, [item.id]: { target: '', relation: draft.relation } }))
                            setFileOffer(item.anchor || item.title || 'файл')
                            return next
                          })
                        }}
                      >
                        <label>
                          Связать с
                          <select
                            value={draft.target}
                            onChange={(event) =>
                              setLinkDraft((prev) => ({
                                ...prev,
                                [item.id]: { target: event.target.value, relation: draft.relation }
                              }))
                            }
                          >
                            <option value="">Выберите файл</option>
                            {others.map((other) => (
                              <option key={other.id} value={other.anchor || ''}>{other.title || other.file_name}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Как
                          <select
                            value={draft.relation}
                            onChange={(event) =>
                              setLinkDraft((prev) => ({
                                ...prev,
                                [item.id]: { target: draft.target, relation: event.target.value }
                              }))
                            }
                          >
                            {FILE_RELATIONS.map((relation) => (
                              <option key={relation.id} value={relation.id}>{relation.label}</option>
                            ))}
                          </select>
                        </label>
                        <button type="submit" disabled={!draft.target}>Связать</button>
                      </form>
                    ) : null}
                  </aside>
                )
              })() : null}
            </div>
            {role !== 'viewer' ? (
            <details className="eo-files-more" open={Boolean(fileOffer)}>
              <summary>Помощник по файлам и проект из разговора</summary>
            <div className="eo-vault">
              {fileOffer && role !== 'viewer' ? (
                <p className="eo-note">
                  В деле {fileOffer}. Разобрать, не записывая в карточку:
                  {' '}
                  {FILE_SCENARIOS.filter((item) => ['Что изменилось', 'Почему так', 'Чего не хватает'].includes(item.label)).map((item) => (
                    <button key={item.label} type="button" disabled={agentBusy} onClick={() => onServiceAgent(fileScenarioPrompt(order, item))}>
                      {item.label}
                    </button>
                  ))}
                </p>
              ) : null}
              {canUpload ? (
                <form
                  className="eo-link-field"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const text = projectDraft.text.trim()
                    const title = projectDraft.title.trim()
                    if (!text || !title) return
                    void onRun(async () => {
                      const known = new Set(order.documents.map((item) => item.id))
                      const next = await api.saveExternalText(order.id, projectDraft, asRole)
                      const added = next.documents.find((item) => !known.has(item.id))
                      setProjectDraft({ title: '', text: '', target: '', relation: 'attachment', kind: 'correspondence' })
                      setFileOffer(added?.anchor || title)
                      return next
                    })
                  }}
                >
                  <label>
                    Проект из разговора
                    <input
                      value={projectDraft.title}
                      placeholder="Название"
                      onChange={(event) => setProjectDraft({ ...projectDraft, title: event.target.value })}
                    />
                  </label>
                  <label>
                    Вид
                    <select
                      value={projectDraft.kind}
                      onChange={(event) => setProjectDraft({ ...projectDraft, kind: event.target.value })}
                    >
                      {fileKinds.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Текст
                    <input
                      value={projectDraft.text}
                      placeholder="Текст письма, протокола или записки"
                      onChange={(event) => setProjectDraft({ ...projectDraft, text: event.target.value })}
                    />
                  </label>
                  <label>
                    Связать с
                    <input
                      list="vault-project"
                      value={projectDraft.target}
                      placeholder="[[файл]]"
                      onChange={(event) => setProjectDraft({ ...projectDraft, target: event.target.value })}
                    />
                    <datalist id="vault-project">
                      {order.documents.map((item) => (
                        <option key={item.id} value={item.anchor || ''} />
                      ))}
                    </datalist>
                  </label>
                  <button type="submit">Положить в дело</button>
                </form>
              ) : null}
              {role !== 'viewer' ? (
                <div className="eo-scenarios">
                  {['Сводка', 'Проект', 'Пояснение', 'Граница'].map((group) => (
                    <div key={group}>
                      <span className="eo-now-kicker">{group}</span>
                      <div className="eo-actions">
                        {FILE_SCENARIOS.filter((item) => item.group === group).map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            disabled={agentBusy}
                            onClick={() => onServiceAgent(fileScenarioPrompt(order, item))}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {(order.document_links || []).length ? (
                <ul className="eo-vault-graph">
                  {(order.document_links || []).map((link) => (
                    <li key={link.id}>
                      <b>{link.from}</b>
                      <span>{link.relation_label}</span>
                      <b>{link.to}</b>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            </details>
            ) : null}
          </section>
        </>
      ) : null}
      {shownPage === 'checks' ? (
        <>
          <RoleWork part="checks" order={order} role={role} asRole={asRole} evidence={evidence} onEvidence={onEvidence} onRun={onRun} />
          <section className="eo-wide">
            <h3>Все пункты по гейтам</h3>
            <div className="eo-checks">
              {Object.entries(GATES).map(([gate, title]) => {
                const items = order.checks.filter((item) => item.gate === gate)
                if (!items.length) return null
                return (
                  <div key={gate} className="eo-panel">
                    <strong>{title} · {items.filter((item) => item.status === 'done').length}/{items.length}</strong>
                    {items.map((item) => (
                      <div key={item.id} className="eo-check">
                        <span>{item.text}<br /><small className="eo-muted">{item.owner_label} · {item.status_label || (item.status === 'done' ? 'выполнено' : 'не начато')}{item.due_at ? ` · до ${item.due_at.slice(0, 10)}` : ''}</small></span>
                        {item.status !== 'done' && item.status !== 'not_applicable' && role === item.owner_role ? (
                          <div className="eo-actions">
                            <input
                              value={evidence[item.id] || ''}
                              placeholder="Доказательство"
                              onChange={(event) => onEvidence(item.id, event.target.value)}
                            />
                            <button
                              type="button"
                              onClick={() => void onRun(() => api.confirmExternalCheck(order.id, item.id, evidence[item.id] || '', asRole))}
                            >
                              Подтвердить
                            </button>
                          </div>
                        ) : <span className={item.status === 'done' ? 'eo-tag is-ok' : 'eo-tag is-stop'}>{item.status_label || item.status}</span>}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </section>
          <section className="eo-wide">
            <h3>Риски · {(order.risks || []).length}</h3>
            {(order.risks || []).length ? (
              <table className="eo-table">
                <thead><tr><th>Риск</th><th>Последствие</th><th>Мера</th><th>Статус</th></tr></thead>
                <tbody>
                  {order.risks.map((item) => (
                    <tr key={item.id}>
                      <td>{item.title}</td>
                      <td>{item.impact || '—'}</td>
                      <td>{item.measure || '—'}</td>
                      <td>{item.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="eo-muted">Рисков не зарегистрировано.</p>}
            {RISK_ROLES.has(role) ? (
              <div className="eo-actions">
                <input value={risk.title} placeholder="Название" onChange={(event) => setRisk({ ...risk, title: event.target.value })} />
                <input value={risk.impact} placeholder="Последствие" onChange={(event) => setRisk({ ...risk, impact: event.target.value })} />
                <input value={risk.measure} placeholder="Мера" onChange={(event) => setRisk({ ...risk, measure: event.target.value })} />
                <button
                  type="button"
                  onClick={() => void onRun(async () => {
                    const next = await api.addExternalRisk(order.id, { ...risk, source: role }, asRole)
                    setRisk({ title: '', impact: '', measure: '' })
                    return next
                  })}
                >
                  Зарегистрировать риск
                </button>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
      {shownPage === 'ai' ? (
        <>
          <HelperPanel {...panel(inspected)} />
          <section className="eo-journal" aria-label="Выводы агента">
            <div className="eo-journal-bar">
              <h3>Выводы и черновики агента</h3>
              <span className="eo-status">{order.findings.length}</span>
            </div>
            <div className="eo-journal-scroll">
              <table className="eo-journal-table">
                <thead>
                  <tr><th>Поле</th><th>Значение</th><th>Источник</th><th>Статус</th><th></th></tr>
                </thead>
                <tbody>
                  {order.findings.length === 0 ? (
                    <tr><td className="eo-journal-empty" colSpan={5}>Черновиков нет.</td></tr>
                  ) : order.findings.map((item) => {
                    const draft = parseDraft1cFinding(item)
                    return (
                      <tr key={item.id}>
                        <td>{humanFindingLabel(item)}</td>
                        <td>{formatFindingValue(item)}</td>
                        <td>
                          {item.trace
                            ? `${item.trace.document} ${item.trace.version}, ${item.trace.clause}. Фрагмент: ${item.trace.fragment}. Правило: ${item.trace.rule}. ${item.trace.author}`
                            : item.source_ref || '—'}
                        </td>
                        <td>
                          <span className={item.status === 'accepted' ? 'eo-status is-ok' : 'eo-status'}>
                            {item.status === 'accepted' ? 'принято' : item.status === 'rejected' ? 'отклонено' : 'черновик'}
                          </span>
                        </td>
                        <td>
                          <div className="eo-journal-actions">
                            {item.status === 'draft' && role === item.owner_role ? (
                              <button type="button" onClick={() => void onRun(() => api.acceptExternalFinding(order.id, item.id, asRole))}>
                                Принять
                              </button>
                            ) : null}
                            {item.status === 'draft' && role === item.owner_role ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const reason = window.prompt('Почему отклоняете вывод?')
                                  if (reason == null) return
                                  void onRun(() => api.rejectExternalFinding(order.id, item.id, asRole, reason))
                                }}
                              >
                                Отклонить
                              </button>
                            ) : null}
                            {item.status === 'draft' && role === item.owner_role ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const value = window.prompt('Исправленное значение', item.value || '')
                                  if (!value || !value.trim()) return
                                  const reason = window.prompt('Почему исправляете?') ?? ''
                                  void onRun(() => api.correctExternalFinding(order.id, item.id, value.trim(), asRole, reason))
                                }}
                              >
                                Исправить
                              </button>
                            ) : null}
                            {draft ? (
                              <button type="button" onClick={() => onDocflow(draft.kind, draft)}>В 1С ДО</button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {(order.notices || []).map((item) => (
              <p key={item.id} className="eo-journal-note">{item.title}. {item.body} {item.mail_status}</p>
            ))}
          </section>
        </>
      ) : null}
      {shownPage === 'history' ? (
        <>
          <section className="eo-journal" aria-label="История">
            <div className="eo-journal-bar">
              <h3>История</h3>
              <span className="eo-status">{order.audit.length}</span>
            </div>
            <div className="eo-journal-scroll">
              <table className="eo-journal-table">
                <thead>
                  <tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Было → стало</th><th>Подробности</th></tr>
                </thead>
                <tbody>
                  {order.audit.length === 0 ? (
                    <tr><td className="eo-journal-empty" colSpan={5}>Записей ещё нет.</td></tr>
                  ) : order.audit.map((item) => (
                    <tr key={item.id}>
                      <td>{stamp(item.created_at) || '—'}</td>
                      <td>{item.actor_fio}<br /><small>{ROLE_NAME[item.actor_role] || item.actor_role}</small></td>
                      <td>{AUDIT_ACTIONS[item.action] || item.action}</td>
                      <td>{item.before_value || item.after_value ? `${item.before_value || '—'} → ${item.after_value || '—'}` : '—'}</td>
                      <td>{item.detail || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </article>
  )
}
