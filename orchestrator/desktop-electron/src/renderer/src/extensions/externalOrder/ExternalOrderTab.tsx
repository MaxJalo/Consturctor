import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import type { UserProfile } from '../../api/types'
import { ApiError } from '../../api/types'
import { api } from '../../api/client'
import { OrchSlotMain } from '../../layout/GridSlots'
import { DocflowCreateDialog } from '../../tabs/grid/DocflowCreateDialog'
import { invokeLocalAcTool } from '../../utils/localAcTool'
import {
  loadDocflowCreateSchema,
  type DocflowFormRequest,
  type DocflowKindSchema
} from '../../workplace/docflowDocumentCreate'
import { onecComInvokeArgs } from '../../workplace/userContext'
import { useExternalOrderDock } from './externalOrderDock'
import {
  GATES,
  HelperPanel,
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
  CopilotQuestion,
  ExternalOnecSearch,
  ExternalOnecTkp,
  ExternalOrder,
  ExternalOrderBrief,
  ExternalOrderMeta,
  ExternalOrderReview,
  ExternalOrderSimplifiedStep,
  StagePassport
} from './externalOrderTypes'
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
  { id: 'condition', label: 'Заключение' },
  { id: 'acceptance', label: 'Приёмка' },
  { id: 'protocol', label: 'Протокол' },
  { id: 'plan', label: 'План работ' }
]

function kindLabel(id: string): string {
  return FILE_KINDS.find((item) => item.id === id)?.label || id
}

type Order = ExternalOrder
type Brief = ExternalOrderBrief
type SimplifiedStep = ExternalOrderSimplifiedStep
type CardPage = 'now' | 'path' | 'diff' | 'committee' | 'deal'
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
}

const NO_COPILOT: CopilotState = { orderId: '', summary: '', log: [], questions: [], passport: null }

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

/** Выжимка для агента: код заказа, служба, этап и сценарий шага вместо однострочной подсказки. */
function agentBrief(order: Order, role: string, step?: SimplifiedStep, extra = ''): string {
  const passport = activePassport(buildStagePassports(order))
  return [
    `order_id=${order.id}`,
    `Заказ ${order.code}: ${order.customer}, ${order.product}. Статус: ${order.status_label}.`,
    `Служба: ${ROLE_NAME[role] || role} (role=${role}).`,
    step ? `Шаг пути: ${step.title} (step_id=${step.id}).` : '',
    passport
      ? `Этап «${passport.label}»: чек-лист ${passport.checks_done}/${passport.checks_total}${passport.blocker ? `, блокер: ${passport.blocker}` : ''}.`
      : '',
    (order.blocks || []).length ? `Блокировки: ${order.blocks.join('; ')}.` : '',
    'Сначала вызови external_order.case(action="auto_prepare"), запиши найденное черновиками через propose или draft_1c, затем задай вопросы по недостающим данным.',
    step?.prompt || '',
    extra
  ].filter(Boolean).join('\n')
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

export function ExternalOrderTab({
  user,
  onRunAgent
}: {
  user: UserProfile
  onRunAgent: (workflowId: string, title: string, message: string) => void
}): React.JSX.Element {
  const view = useExternalOrderDock()
  const [asRole, setAsRole] = useState(savedRole)
  const [meta, setMeta] = useState<ExternalOrderMeta | null>(null)
  const [orders, setOrders] = useState<Brief[]>([])
  const [listReady, setListReady] = useState(false)
  const [current, setCurrent] = useState<Order | null>(null)
  const [error, setError] = useState('')
  const [customer, setCustomer] = useState('')
  const [product, setProduct] = useState('')
  const [evidence, setEvidence] = useState<Record<string, string>>({})
  const [onecRows, setOnecRows] = useState<ExternalOnecTkp[]>([])
  const [onecTried, setOnecTried] = useState(false)
  const [onecLoading, setOnecLoading] = useState(false)
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
  const [auditOrders, setAuditOrders] = useState<Order[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditAction, setAuditAction] = useState('')
  const [auditOrder, setAuditOrder] = useState('')
  const [formRequest, setFormRequest] = useState<DocflowFormRequest | null>(null)
  const [createSchemas, setCreateSchemas] = useState<DocflowKindSchema[]>([])
  const [docNotice, setDocNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [serviceAgents, setServiceAgents] = useState<
    { role: string; workflow_id: string; title: string; active: boolean }[]
  >([])

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
    if (view !== 'registry' || !listReady || onecTried) return
    const roleName = meta?.role || asRole
    if (!['ks', 'development', 'finance', 'it'].includes(roleName)) return
    setOnecTried(true)
    void loadFromOnec()
  }, [view, listReady, meta?.role, asRole, onecTried])

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

  async function openOrder(id: string): Promise<void> {
    setError('')
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

  async function loadFromOnec(): Promise<void> {
    setOnecLoading(true)
    setError('')
    try {
      const data = await api.recentExternalOnec()
      setOnecRows(data.orders || [])
      if (!(data.orders || []).length) setError('В 1С нет проведённых коммерческих предложений.')
    } catch (err) {
      fail(err)
    } finally {
      setOnecLoading(false)
    }
  }

  async function runCopilot(
    order: Order,
    opts: { step_id?: string; message?: string; answers?: Record<string, string>; auto_prepare?: boolean } = { auto_prepare: true }
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
        passport: res.stage_passport || null
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
      onRunAgent(
        agent.workflow_id,
        agent.title || `ИИ-агент внешнего заказа · ${ROLE_NAME[role] || role}`,
        agentBrief(order, role, undefined, extra)
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
      busy: copilotBusy,
      onRunCopilot: role === 'viewer' ? undefined : (opts) => void runCopilot(order, opts),
      onAcceptFinding: (id) => void findingAction(() => api.acceptExternalFinding(order.id, id, asRole)),
      onRejectFinding: (id) => void findingAction(() => api.rejectExternalFinding(order.id, id, asRole)),
      onAcceptAllFindings: () => void findingAction(() => api.acceptAllExternalFindings(order.id, asRole)),
      onOpenDocflow: (kind, prefill) => openDocflow(order, kind, prefill),
      onOpenFullAgent: role === 'viewer' ? undefined : (prompt) => void openServiceAgent(order, prompt || '')
    }
  }

  const role = meta?.role || asRole
  const showDeskSwitch = Boolean(meta?.can_switch) || sameExternalOrderDesk(user)
  const deskRoles = meta?.roles?.length ? meta.roles : DESK_ROLES
  const canCreate = role === 'ks' || role === 'development'
  const canLoad = role === 'ks' || role === 'development' || role === 'finance' || role === 'it'
  const moves = MOVES[role] || []
  const waitingMine = orders.filter((item) => (item.waiting_roles || []).includes(role))
  const deskList = deskAll ? orders : waitingMine
  const deskPassport = deskOrder ? activePassport(buildStagePassports(deskOrder)) : null
  const registry = orders.filter((item) => {
    if (!briefMatches(item, search)) return false
    if (stageFilter && !LINE.find((step) => step.id === stageFilter)?.statuses.includes(item.status)) return false
    if (routeFilter && item.route !== routeFilter) return false
    if (blockedOnly && !(item.blocks || []).length) return false
    return true
  })
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
        <Card
          order={current}
          role={role}
          evidence={evidence}
          onEvidence={(id, value) => setEvidence((prev) => ({ ...prev, [id]: value }))}
          onBack={() => setCurrent(null)}
          onRun={run}
          path={meta?.simplified_path || []}
          user={user}
          onRunAgent={onRunAgent}
          onServiceAgent={(extra) => void openServiceAgent(current, extra)}
          agentBusy={agentBusy}
          copilotBusy={copilotBusy}
          panel={(passport) => panelProps(current, passport)}
          onCopilot={(stepId) => void runCopilot(current, { auto_prepare: true, step_id: stepId })}
          onDocflow={(kind, draft) => openDocflow(current, kind, draft)}
        />
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
              className="eo-window"
              onSubmit={(event) => {
                event.preventDefault()
                void run(async () => {
                  const created = await api.createExternalOrder({ customer, product }, asRole)
                  setCustomer('')
                  setProduct('')
                  setCurrent(created)
                })
              }}
            >
              <h3>Новый запрос</h3>
              <input value={customer} placeholder="Заказчик" onChange={(event) => setCustomer(event.target.value)} />
              <input value={product} placeholder="Продукт" onChange={(event) => setProduct(event.target.value)} />
              <div className="eo-actions">
                <button className="eo-btn is-primary" type="submit">Создать карточку</button>
              </div>
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
                  {role === 'rp' ? <button className="eo-btn" type="button" onClick={() => void run(() => api.publishExternalPlan(deskOrder.id, asRole))}>Опубликовать</button> : null}
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
            </div>
            {!listReady && !orders.length ? <p>Загружаю заказы…</p> : null}
            {listReady && !registry.length ? <p className="eo-muted">Под фильтр заказы не попали.</p> : null}
            {registry.length ? (
              <OrderTable full rows={registry} selectedId="" onSelect={(id) => void openOrder(id)} onOpen={(id) => void openOrder(id)} />
            ) : null}
          </section>
          {canLoad ? (
            <section className="eo-window eo-window-main">
              <div className="eo-window-head">
                <h3>Импорт и привязка ТКП из 1С ERP</h3>
                <button className="eo-btn" type="button" disabled={onecLoading} onClick={() => void loadFromOnec()}>
                  {onecLoading ? 'Загрузка…' : 'Обновить'}
                </button>
              </div>
              {onecLoading && !onecRows.length ? <p>Читаю проведённые ТКП из 1С…</p> : null}
              {onecRows.length ? (
                <div className="eo-tkp-scroll">
                  <table className="eo-table eo-tkp">
                    <thead>
                      <tr>
                        <th>Номер</th>
                        <th>Дата</th>
                        <th>Клиент</th>
                        <th>Контрагент</th>
                        <th>Конечный заказчик</th>
                        <th>Сделка</th>
                        <th>Договор</th>
                        <th>Заказ клиента</th>
                        <th>Организация</th>
                        <th>Менеджер</th>
                        <th>Соглашение</th>
                        <th>Валюта</th>
                        <th>Сумма</th>
                        <th>Статус</th>
                        <th>Срок действия</th>
                        <th>Срок поставки</th>
                        <th>Форма оплаты</th>
                        <th>Доставка</th>
                        <th>НДС</th>
                        <th>Согласован</th>
                        <th>С клиентом</th>
                        <th>Операция</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {onecRows.map((item) => {
                        const taken = orders.some((order) => order.onec_tkp_key === item.key)
                        const text = (value?: string) => (value || '').trim() || '—'
                        return (
                          <tr key={item.key}>
                            <td>{item.number || 'без номера'}</td>
                            <td>{text(item.date)}</td>
                            <td>{text(item.client)}</td>
                            <td>{text(item.counterparty)}</td>
                            <td>{text(item.end_customer)}</td>
                            <td>{text(item.deal)}</td>
                            <td>{text(item.contract)}</td>
                            <td>{text(item.order_number)}</td>
                            <td>{text(item.organization)}</td>
                            <td>{text(item.manager)}</td>
                            <td>{text(item.agreement)}</td>
                            <td>{text(item.currency)}</td>
                            <td className="eo-num">{text(item.amount)}</td>
                            <td>{text(item.status)}</td>
                            <td>{text(item.valid_until)}</td>
                            <td>{text(item.delivery_days)}</td>
                            <td>{text(item.payment_form)}</td>
                            <td>{text(item.delivery)}</td>
                            <td>{text(item.vat)}</td>
                            <td>{text(item.approved)}</td>
                            <td>{text(item.agreed)}</td>
                            <td>{text(item.operation)}</td>
                            <td>
                              {taken ? 'в деле' : (
                                <button
                                  className="eo-btn is-primary"
                                  type="button"
                                  onClick={() => void run(async () => {
                                    const created = await api.importExternalTkp(item.key, asRole)
                                    setCurrent(created)
                                    return created
                                  })}
                                >
                                  Открыть путь
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
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

function OrderTable({
  rows,
  selectedId,
  full = false,
  onSelect,
  onOpen
}: {
  rows: Brief[]
  selectedId: string
  full?: boolean
  onSelect: (id: string) => void
  onOpen: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="eo-tkp-scroll">
      <table className="eo-table">
        <thead>
          <tr>
            <th>Заказ</th>
            <th>Заказчик</th>
            <th>Продукт</th>
            <th>Этап</th>
            <th>Статус</th>
            {full ? <th>Маршрут</th> : null}
            <th>Путь в 1С</th>
            {full ? <th>Пункты</th> : null}
            {full ? <th>Расхождения</th> : null}
            {full ? <th>Черновики ИИ</th> : null}
            <th>Ждут</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr
              key={item.id}
              className={selectedId === item.id ? 'eo-table-row is-selected' : 'eo-table-row'}
              onClick={() => onSelect(item.id)}
            >
              <td>{item.code}</td>
              <td>{item.customer}</td>
              <td>{item.product}</td>
              <td>{item.stage_label}</td>
              <td>
                {item.status_label}
                {(item.blocks || []).length ? <><br /><small className="eo-danger">{item.blocks[0]}</small></> : null}
              </td>
              {full ? <td>{item.route_label || ROUTES.find((route) => route.id === item.route)?.label || '—'}</td> : null}
              <td>{item.path_label || item.onec_number || '—'}</td>
              {full ? <td>{item.open_checks_count ?? '—'}</td> : null}
              {full ? <td>{item.open_diffs_count ?? '—'}</td> : null}
              {full ? <td>{item.draft_findings_count ?? '—'}</td> : null}
              <td>{roleNames(item.waiting_roles) || '—'}</td>
              <td>
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

function RoleWork({
  order,
  role,
  asRole,
  evidence,
  onEvidence,
  onRun
}: {
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
  return (
    <div className="eo-rolework">
      {forms.map((form) => (
        <div key={form.section} className="eo-form">
          <h3>{form.title}</h3>
          {form.fields.map((field) => (
            <input
              key={field.key}
              value={draft[`${form.section}.${field.key}`] || ''}
              placeholder={field.label}
              aria-label={field.label}
              onChange={(event) => setDraft({ ...draft, [`${form.section}.${field.key}`]: event.target.value })}
            />
          ))}
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
        </div>
      ))}
      <div className="eo-form">
        <h3>Мои открытые пункты · {ownChecks.length}</h3>
        {ownChecks.length ? ownChecks.map((item) => (
          <div key={item.id} className="eo-check">
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
          </div>
        )) : <p className="eo-muted">На вас открытых пунктов нет.</p>}
      </div>
      <div className="eo-form">
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
            return draft ? (
              <div key={item.id} className="eo-check">
                <span>{humanFindingLabel(item)}<br /><small className="eo-muted">{draft.title}</small></span>
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
  onRunAgent,
  onServiceAgent,
  agentBusy,
  copilotBusy,
  panel,
  onCopilot,
  onDocflow
}: {
  order: Order
  role: string
  evidence: Record<string, string>
  onEvidence: (id: string, value: string) => void
  onBack: () => void
  onRun: RunAction
  path: SimplifiedStep[]
  user: UserProfile
  onRunAgent: (workflowId: string, title: string, message: string) => void
  onServiceAgent: (extra?: string) => void
  agentBusy: boolean
  copilotBusy: boolean
  panel: (passport: StagePassport | null) => HelperPanelProps
  onCopilot: (stepId?: string) => void
  onDocflow: OpenDocflow
}): React.JSX.Element {
  const asRole = role
  const linked = order.sections?.onec
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ExternalOnecSearch | null>(null)
  const [lookupError, setLookupError] = useState('')
  const canLink = role === 'ks' || role === 'development' || role === 'finance' || role === 'it'
  const canUpload = UPLOAD_ROLES.has(role)
  const fileKinds = (role === 'committee' ? FILE_KINDS.filter((item) => item.id === 'protocol') : FILE_KINDS).filter(
    (item) => item.id !== 'plan'
  )
  const [fileKind, setFileKind] = useState(role === 'committee' ? 'protocol' : 'contract')
  const fileRef = useRef<HTMLInputElement>(null)
  const [rpName, setRpName] = useState(order.owners?.rp || '')
  const [risk, setRisk] = useState({ title: '', impact: '', measure: '' })
  const [page, setPage] = useState<CardPage>('now')
  const [stageId, setStageId] = useState('')
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
  useEffect(() => {
    setPage('now')
    setStageId('')
  }, [order.id])

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
        agentBrief(order, 'omto')
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
        agentBrief(order, role, step)
      )
    } catch (err) {
      setPathNote(helperFailure(err, 'Помощник не запустился'))
    } finally {
      setPathBusy('')
    }
  }

  const pages: { id: CardPage; label: string; note: string }[] = [
    { id: 'now', label: 'Сейчас', note: inspected ? `${inspected.label} · ${inspected.checks_done}/${inspected.checks_total}` : order.status_label },
    { id: 'path', label: 'Путь 1С и план', note: order.onec_number || `${(order.tasks || []).length} задач` },
    { id: 'diff', label: 'Сверка B01–B35', note: `${(order.diffs || []).filter((item) => item.status !== 'closed').length} открыто` },
    { id: 'committee', label: 'Комитет и БВ', note: order.decisions?.slice(-1)[0]?.decision || `${(order.baselines || []).length} БВ` },
    { id: 'deal', label: 'Сделка и дело', note: `${(order.documents || []).length} файлов` }
  ]

  return (
    <article className="eo-card">
      <header className="eo-wide eo-head">
        <div>
          <button type="button" className="eo-back" onClick={onBack}>К списку</button>
          <h2>{order.code} · {order.customer}</h2>
          <p className="eo-muted">{order.product}. Шаг {currentIndex + 1} из {LINE.length}: {order.status_label}.</p>
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
          {role !== 'viewer' ? (
            <button type="button" className="is-primary" disabled={copilotBusy} onClick={() => onCopilot()}>
              {copilotBusy ? 'Проверка…' : 'Авто-подготовка'}
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
          setPage('now')
        }}
      />
      <div className="eo-pages" role="tablist" aria-label="Страницы заказа">
        {pages.map((item) => (
          <button
            key={item.id}
            type="button"
            className={page === item.id ? 'is-active' : ''}
            aria-pressed={page === item.id}
            onClick={() => setPage(item.id)}
          >
            {item.label}
            <small>{item.note}</small>
          </button>
        ))}
      </div>
      {page === 'now' ? (
        <>
          <div className="eo-now">
            <section className="eo-now-main">
              {inspected ? (
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
              ) : null}
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
          {role !== 'viewer' ? (
            <RoleWork order={order} role={role} asRole={asRole} evidence={evidence} onEvidence={onEvidence} onRun={onRun} />
          ) : null}
          <HelperPanel {...panel(inspected)} />
        </>
      ) : null}
      {page === 'path' ? (
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
                        <button type="button" disabled={copilotBusy} onClick={() => onCopilot(step.id)}>
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
          <section className="eo-journal" aria-label="План">
            <div className="eo-journal-bar">
              <h3>План работ</h3>
              {role === 'ks' || role === 'rp' ? (
                <div className="eo-journal-actions">
                  <button type="button" onClick={() => void onRun(() => api.buildExternalPlan(order.id, asRole))}>Собрать проект плана</button>
                  {role === 'rp' ? (
                    <button type="button" onClick={() => void onRun(() => api.approveExternalPlan(order.id, asRole))}>Утвердить базовый план</button>
                  ) : null}
                  {role === 'rp' ? (
                    <button type="button" onClick={() => void onRun(() => api.publishExternalPlan(order.id, asRole))}>Опубликовать без копий</button>
                  ) : null}
                </div>
              ) : <span className="eo-status">{(order.tasks || []).length}</span>}
            </div>
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
                      <td>{item.critical ? 'критический' : 'обычный'}</td>
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
      {page === 'diff' ? <DiffBlock order={order} role={role} asRole={asRole} onRun={onRun} /> : null}
      {page === 'committee' ? (
        <CommitteeBlock order={order} role={role} asRole={asRole} onRun={onRun} onDocflow={onDocflow} />
      ) : null}
      {page === 'deal' ? (
        <>
          <section className="eo-journal" aria-label="Файлы дела">
            <div className="eo-journal-bar">
              <div className="eo-kind-tabs" role="tablist" aria-label="Вид файла">
                {fileKinds.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={fileKind === item.id}
                    className={fileKind === item.id ? 'is-active' : ''}
                    onClick={() => setFileKind(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {canUpload ? (
                <button type="button" className="is-primary" onClick={() => fileRef.current?.click()}>
                  <Paperclip size={14} aria-hidden /> Прикрепить
                </button>
              ) : null}
              <input
                ref={fileRef}
                className="eo-file-input"
                type="file"
                accept=".docx,.xlsx,.pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  void file.arrayBuffer().then((buffer) => {
                    const bytes = new Uint8Array(buffer)
                    let binary = ''
                    bytes.forEach((item) => {
                      binary += String.fromCharCode(item)
                    })
                    const kind = fileKinds.some((item) => item.id === fileKind) ? fileKind : fileKinds[0].id
                    void onRun(() => api.uploadExternalFile(order.id, {
                      kind,
                      filename: file.name,
                      content_base64: btoa(binary)
                    }, asRole))
                  })
                }}
              />
            </div>
            <div className="eo-journal-scroll">
              <table className="eo-journal-table">
                <thead>
                  <tr>
                    <th>Вид</th>
                    <th>Документ</th>
                    <th>Версия</th>
                    <th>Статус</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {order.documents.length === 0 ? (
                    <tr>
                      <td className="eo-journal-empty" colSpan={5}>Файлов в деле ещё нет.</td>
                    </tr>
                  ) : order.documents.map((item) => (
                    <tr key={item.id}>
                      <td>{kindLabel(item.kind)}</td>
                      <td>{item.title || item.file_name || '—'}</td>
                      <td>{item.version || '—'}</td>
                      <td>
                        <span className={item.approved ? 'eo-status is-ok' : 'eo-status'}>
                          {item.approved ? 'утверждён' : 'черновик'}
                        </span>
                      </td>
                      <td>
                        <div className="eo-journal-actions">
                          {item.kind === 'plan' ? (
                            <button
                              type="button"
                              onClick={() =>
                                void api.download(
                                  `/api/v1/external-orders/${encodeURIComponent(order.id)}/files/${encodeURIComponent(item.id)}`,
                                  item.file_name || 'План работ.xml'
                                )
                              }
                            >
                              Скачать
                            </button>
                          ) : null}
                          {!item.approved && (role === 'ks' || role === item.owner_role) ? (
                            <button type="button" onClick={() => void onRun(() => api.approveExternalFile(order.id, item.id, asRole))}>
                              Утвердить
                            </button>
                          ) : null}
                          {!item.approved && canUpload ? (
                            <button type="button" onClick={() => void onRun(() => api.deleteExternalFile(order.id, item.id, asRole))}>
                              Удалить
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
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
                        <td>{item.source_ref || '—'}</td>
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
                              <button type="button" onClick={() => void onRun(() => api.rejectExternalFinding(order.id, item.id, asRole))}>
                                Отклонить
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
