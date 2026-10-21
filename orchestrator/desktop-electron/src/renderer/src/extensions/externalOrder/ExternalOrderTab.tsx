import { useCallback, useEffect, useState } from 'react'
import type { UserProfile } from '../../api/types'
import { ApiError } from '../../api/types'
import { api } from '../../api/client'
import { OrchSlotMain } from '../../layout/GridSlots'
import { useExternalOrderDock } from './externalOrderDock'
import { HelperPanel } from './externalOrderReview'
import type { ExternalOnecSearch, ExternalOrderReview } from './externalOrderTypes'
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

const UPLOAD_ROLES = new Set(['ks', 'development', 'rp', 'legal', 'kb', 'finance', 'omto', 'production', 'committee'])
const RISK_ROLES = new Set(['rp', 'ks', 'production', 'finance'])
const OWNER_ROLES = new Set(['ks', 'development', 'rp'])

const FILE_KINDS: { id: string; label: string }[] = [
  { id: 'tz', label: 'ТЗ' },
  { id: 'tkp', label: 'ТКП' },
  { id: 'contract', label: 'Договор' },
  { id: 'specification', label: 'Спецификация' },
  { id: 'condition', label: 'Заключение' },
  { id: 'acceptance', label: 'Приёмка' },
  { id: 'protocol', label: 'Протокол' }
]

const ROLE_FIELDS: Record<string, { section: string; title: string; fields: { key: string; label: string }[] }[]> = {
  ks: [
    {
      section: 'commercial',
      title: 'Коммерческие условия',
      fields: [
        { key: 'price', label: 'Цена' },
        { key: 'vat', label: 'НДС' },
        { key: 'currency', label: 'Валюта' },
        { key: 'discount', label: 'Скидка' }
      ]
    }
  ],
  kb: [
    {
      section: 'technical',
      title: 'Заключение КБ и ГСПП',
      fields: [
        { key: 'composition', label: 'Состав' },
        { key: 'kd', label: 'Конструкторская документация' },
        { key: 'analogs', label: 'Аналоги' },
        { key: 'limits', label: 'Ограничения' }
      ]
    }
  ],
  production: [
    {
      section: 'technical',
      title: 'Качество',
      fields: [
        { key: 'quality', label: 'Нормативы' },
        { key: 'psi', label: 'ПСИ' }
      ]
    },
    {
      section: 'execution',
      title: 'Производство и сервис',
      fields: [
        { key: 'cycle', label: 'Цикл' },
        { key: 'capacity', label: 'Мощности' },
        { key: 'acceptance', label: 'Приёмка' },
        { key: 'smr', label: 'СМР и ПНР' }
      ]
    }
  ],
  finance: [
    {
      section: 'calculation',
      title: 'Расчёт',
      fields: [
        { key: 'mcr', label: 'МЦР' },
        { key: 'cost', label: 'Себестоимость' },
        { key: 'margin', label: 'Маржа' },
        { key: 'reserve', label: 'Резерв' },
        { key: 'bdds', label: 'БДДС' }
      ]
    },
    {
      section: 'finance',
      title: 'Оплата',
      fields: [{ key: 'schedule', label: 'График платежей' }]
    }
  ],
  legal: [
    {
      section: 'contract',
      title: 'Юридическое заключение',
      fields: [
        { key: 'sanctions', label: 'Санкции' },
        { key: 'warranty', label: 'Гарантия' },
        { key: 'liability', label: 'Ответственность' },
        { key: 'termination', label: 'Односторонний отказ' }
      ]
    }
  ],
  rp: [
    {
      section: 'project',
      title: 'Проект',
      fields: [
        { key: 'plan_note', label: 'План' },
        { key: 'critical_path', label: 'Критический путь' }
      ]
    },
    {
      section: 'execution',
      title: 'Исполнение',
      fields: [{ key: 'status', label: 'Ход исполнения' }]
    },
    {
      section: 'closure',
      title: 'Закрытие',
      fields: [{ key: 'lessons', label: 'Уроки проекта' }]
    }
  ]
}

const GATES: Record<string, string> = {
  before_calc: 'До расчёта',
  before_committee: 'До Комитета',
  before_tkp: 'До финального ТКП',
  before_sign: 'До подписания',
  before_project: 'До проектного запуска',
  before_production: 'До производственного запуска',
  before_psi: 'До ПСИ и приёмки',
  before_ship: 'До отгрузки',
  before_close: 'До закрытия'
}

type RoleItem = { id: string; label: string }
type Desk = { title: string; sees: string[]; denied: string[] }
type Meta = {
  role: string
  role_label: string
  can_switch: boolean
  roles: RoleItem[]
  desk: Desk
  integrations: { system: string; state: string; note: string }[]
  routes: RoleItem[]
}
type Brief = {
  id: string
  code: string
  customer: string
  product: string
  stage_label: string
  status: string
  status_label: string
  blocks: string[]
  payment_note: string
  onec_number?: string
  onec_key?: string
  onec_tkp_key?: string
  path_label?: string
}
type Check = {
  id: string
  gate: string
  text: string
  owner_role: string
  owner_label: string
  status: string
  status_label?: string
  due_at?: string
  evidence: string
}
type Diff = {
  id: string
  code: string
  area: string
  title: string
  owner_role: string
  owner_label: string
  level: string
  status: string
  left_value: string
  right_value: string
  note: string
}
type Finding = {
  id: string
  field: string
  value: string
  source_ref: string
  status: string
  owner_role: string
}
type Decision = {
  id: string
  protocol: string
  decision: string
  conditions: string
  conditions_closed: boolean
  base_version: string
}
type Order = Brief & {
  inn: string
  contact: string
  route: string
  project_note: string
  owners: Record<string, string>
  sections: Record<string, Record<string, string>>
  checks: Check[]
  diffs: Diff[]
  risks: { id: string; title: string; impact: string; status: string }[]
  decisions: Decision[]
  findings: Finding[]
  documents: { id: string; kind: string; title: string; version: string; note: string; file_name?: string; approved?: boolean; owner_role?: string }[]
  gaps?: { id: string; field: string; owner_label: string; due_at: string; detail: string; status: string }[]
  baselines?: { id: string; code: string; composition: string; cost: string; margin: string; immutable: boolean; reason: string }[]
  tasks?: { id: string; title: string; kind: string; critical: boolean; approved: boolean; published: boolean; depends_on: string }[]
  lines?: { id: string; name: string; qty: string; amount: string; change: string }[]
  notices?: { id: string; title: string; body: string; mail_status: string; role: string }[]
  audit: { id: string; actor_fio: string; actor_role: string; action: string; detail: string; before_value?: string; after_value?: string }[]
}

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

export function ExternalOrderTab({
  user
}: {
  user: UserProfile
  onRunAgent: (workflowId: string, title: string, message: string) => void
}): React.JSX.Element {
  const view = useExternalOrderDock()
  const [asRole, setAsRole] = useState(savedRole)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [orders, setOrders] = useState<Brief[]>([])
  const [current, setCurrent] = useState<Order | null>(null)
  const [error, setError] = useState('')
  const [customer, setCustomer] = useState('')
  const [product, setProduct] = useState('')
  const [evidence, setEvidence] = useState<Record<string, string>>({})
  const [protocol, setProtocol] = useState('')
  const [baseVersion, setBaseVersion] = useState('')
  const [price, setPrice] = useState('')
  const [onecRows, setOnecRows] = useState<{ key: string; number: string; date: string; amount: string; status?: string; has_order?: string }[]>([])
  const [onecTried, setOnecTried] = useState(false)
  const [onecLoading, setOnecLoading] = useState(false)
  const [deskOrder, setDeskOrder] = useState<Order | null>(null)
  const [sectionDraft, setSectionDraft] = useState<Record<string, string>>({})
  const [deskConditions, setDeskConditions] = useState('')
  const [helper, setHelper] = useState<ExternalOrderReview | null>(null)
  const [helperFor, setHelperFor] = useState('')
  const [helperLog, setHelperLog] = useState<string[]>([])
  const [helperBusy, setHelperBusy] = useState(false)

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
  }, [])

  useEffect(() => {
    void reload(asRole).catch(fail)
  }, [asRole, reload])

  useEffect(() => {
    if (view !== 'desk' || onecTried) return
    const roleName = meta?.role || asRole
    if (!['ks', 'development', 'finance', 'it'].includes(roleName)) return
    setOnecTried(true)
    void loadFromOnec()
  }, [view, meta?.role, asRole, onecTried])

  useEffect(() => {
    if (meta?.can_switch && !savedRole()) chooseRole('ks')
  }, [meta?.can_switch])

  useEffect(() => {
    setCurrent(null)
    setDeskOrder(null)
    setHelper(null)
    setHelperFor('')
    setHelperLog([])
  }, [view, asRole])

  function chooseRole(role: string): void {
    setAsRole(role)
    try {
      localStorage.setItem(ROLE_KEY, role)
    } catch {
      /* переключатель останется на этот сеанс */
    }
  }

  function fillDraft(order: Order, role: string): void {
    const draft: Record<string, string> = {}
    for (const form of ROLE_FIELDS[role] || []) {
      const section = order.sections?.[form.section] || {}
      for (const field of form.fields) draft[`${form.section}.${field.key}`] = String(section[field.key] || '')
    }
    setSectionDraft(draft)
  }

  async function selectOrder(id: string): Promise<void> {
    setError('')
    try {
      const order = await api.externalOrder(id, asRole)
      setDeskOrder(order)
      fillDraft(order, meta?.role || asRole)
    } catch (err) {
      fail(err)
    }
  }

  async function deskRun(action: () => Promise<Order | void>): Promise<void> {
    setError('')
    try {
      const order = await action()
      if (order) {
        setDeskOrder(order)
        fillDraft(order, meta?.role || asRole)
      }
      await reload(asRole)
    } catch (err) {
      fail(err)
    }
  }

  async function openOrder(id: string): Promise<void> {
    setError('')
    try {
      const order = await api.externalOrder(id, asRole)
      setCurrent(order)
      setPrice(String(order.sections?.commercial?.price || ''))
    } catch (err) {
      fail(err)
    }
  }

  async function refresh(id: string): Promise<void> {
    const order = await api.externalOrder(id, asRole)
    setCurrent(order)
    await reload(asRole)
  }

  async function run(action: () => Promise<Order | void>): Promise<void> {
    if (!current && action.length) return
    setError('')
    try {
      const order = await action()
      if (order && current) setCurrent(order)
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

  async function runHelper(order: Order | null): Promise<void> {
    if (!order) {
      setError('Выберите заказ в таблице.')
      return
    }
    setHelperBusy(true)
    setError('')
    const log: string[] = []
    try {
      if ((meta?.role || asRole) !== 'viewer') {
        try {
          const fresh = await api.refreshExternalPayment(order.id, asRole)
          log.push(fresh.path_label ? `Путь 1С: ${fresh.path_label}` : 'Путь 1С прочитан.')
          setDeskOrder(fresh)
          setCurrent((prev) => (prev?.id === fresh.id ? fresh : prev))
          fillDraft(fresh, meta?.role || asRole)
        } catch (err) {
          log.push(err instanceof ApiError ? err.message : 'Путь 1С не обновлён.')
        }
      }
      const review = await api.externalOrderReview(order.id, asRole)
      setHelper(review)
      setHelperFor(order.id)
      setHelperLog(log)
      await reload(asRole)
    } catch (err) {
      fail(err)
    } finally {
      setHelperBusy(false)
    }
  }

  const role = meta?.role || ''
  const canCreate = role === 'ks' || role === 'development'
  const canLoad = role === 'ks' || role === 'development' || role === 'finance' || role === 'it'
  const forms = ROLE_FIELDS[role] || []
  const moves = MOVES[role] || []
  const ownChecks = (deskOrder?.checks || []).filter((item) => item.owner_role === role && item.status !== 'not_applicable')
  const visible =
    view === 'reconcile'
      ? orders.filter((item) => item.blocks.some((block) => block.includes('расхождение')))
      : view === 'committee'
        ? orders.filter((item) => ['calculating', 'ready_committee', 'rework', 'confirmed', 'confirmed_conditions'].includes(item.status))
        : orders

  return (
    <OrchSlotMain spanAll heavyEmbed>
    <div className="eo-page">
      {meta?.can_switch ? (
        <div className="eo-switch" role="tablist" aria-label="Должность">
          {meta.roles.map((item) => (
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
      {current ? (
        <Card
          order={current}
          role={role}
          price={price}
          evidence={evidence}
          protocol={protocol}
          baseVersion={baseVersion}
          onPrice={setPrice}
          onEvidence={(id, value) => setEvidence((prev) => ({ ...prev, [id]: value }))}
          onProtocol={setProtocol}
          onBase={setBaseVersion}
          onBack={() => setCurrent(null)}
          onRun={run}
          onHelper={() => void runHelper(current)}
          helperBusy={helperBusy}
          helper={helperFor === current.id ? helper : null}
          helperLog={helperLog}
        />
      ) : (
        <div className="eo-windows">
            {view === 'desk' && canCreate ? (
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
            {view === 'desk' && canLoad ? (
              <section className="eo-window eo-window-main">
                <div className="eo-window-head">
                  <h3>Коммерческие предложения из 1С</h3>
                  <button className="eo-btn" type="button" disabled={onecLoading} onClick={() => void loadFromOnec()}>
                    {onecLoading ? 'Загрузка…' : 'Обновить'}
                  </button>
                </div>
                {onecLoading && !onecRows.length ? <p>Читаю проведённые ТКП из 1С…</p> : null}
                {onecRows.length ? (
                  <table className="eo-table">
                    <thead>
                      <tr><th>ТКП</th><th>Дата</th><th>Статус в 1С</th><th>Заказ клиента</th><th></th></tr>
                    </thead>
                    <tbody>
                      {onecRows.map((item) => {
                        const taken = orders.some((order) => order.onec_tkp_key === item.key)
                        return (
                          <tr key={item.key}>
                            <td>{item.number || 'без номера'}</td>
                            <td>{item.date || '—'}</td>
                            <td>{item.status || '—'}</td>
                            <td>{item.has_order ? 'есть' : 'ещё нет'}</td>
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
                ) : null}
              </section>
            ) : null}
            {visible.length ? <section className="eo-window eo-window-main">
              <div className="eo-window-head">
                <h3>{meta?.role_label || 'Заказы'} · {user.fio}</h3>
                <button className="eo-btn is-primary" type="button" disabled={!deskOrder || helperBusy} onClick={() => void runHelper(deskOrder)}>
                  {helperBusy ? 'Помощник…' : 'Помощник'}
                </button>
              </div>
              <table className="eo-table">
                <thead>
                  <tr>
                    <th>Заказ</th>
                    <th>Заказчик</th>
                    <th>Продукт</th>
                    <th>Этап</th>
                    <th>Статус</th>
                    <th>Путь в 1С</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr><td colSpan={7}>Заказов нет.</td></tr>
                  ) : visible.map((item) => (
                    <tr
                      key={item.id}
                      className={deskOrder?.id === item.id ? 'eo-table-row is-selected' : 'eo-table-row'}
                      onClick={() => void selectOrder(item.id)}
                    >
                      <td>{item.code}</td>
                      <td>{item.customer}</td>
                      <td>{item.product}</td>
                      <td>{item.stage_label}</td>
                      <td>{item.status_label}</td>
                      <td>{item.path_label || item.onec_number || '—'}</td>
                      <td>
                        <button className="eo-btn" type="button" onClick={(event) => { event.stopPropagation(); void openOrder(item.id) }}>
                          Карточка
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section> : null}
            {helper && helperFor === deskOrder?.id ? <HelperPanel review={helper} log={helperLog} /> : null}
            {deskOrder ? (
              <section className="eo-window eo-window-work">
                <h3>{deskOrder.code} · {deskOrder.customer}</h3>
                <div className="eo-actions">
                  <button className="eo-btn" type="button" onClick={() => void openOrder(deskOrder.id)}>Открыть карточку</button>
                  {role !== 'viewer' ? (
                    <button className="eo-btn" type="button" onClick={() => void deskRun(() => api.refreshExternalPayment(deskOrder.id, asRole))}>
                      Повторить путь из 1С
                    </button>
                  ) : null}
                  {role === 'ks' || role === 'development' || role === 'rp' || role === 'finance' || role === 'it' ? (
                    <button className="eo-btn" type="button" onClick={() => void deskRun(() => api.linkExternalStrategy(deskOrder.id, asRole))}>
                      Стратегический план
                    </button>
                  ) : null}
                  {moves.map((move) => (
                    <button key={move.target} className="eo-btn is-primary" type="button" onClick={() => void deskRun(() => api.transitionExternalOrder(deskOrder.id, move.target, asRole))}>
                      {move.label}
                    </button>
                  ))}
                </div>
                {forms.map((form) => (
                  <div key={form.section} className="eo-form">
                    <h3>{form.title}</h3>
                    {form.fields.map((field) => (
                      <input
                        key={field.key}
                        value={sectionDraft[`${form.section}.${field.key}`] || ''}
                        placeholder={field.label}
                        aria-label={field.label}
                        onChange={(event) => setSectionDraft({ ...sectionDraft, [`${form.section}.${field.key}`]: event.target.value })}
                      />
                    ))}
                    <button
                      className="eo-btn is-primary"
                      type="button"
                      onClick={() => {
                        const values: Record<string, string> = {}
                        for (const field of form.fields) values[field.key] = sectionDraft[`${form.section}.${field.key}`] || ''
                        void deskRun(() => api.patchExternalOrder(deskOrder.id, { sections: { [form.section]: values } }, asRole))
                      }}
                    >
                      Сохранить
                    </button>
                  </div>
                ))}
                {ownChecks.length ? (
                  <div className="eo-form">
                    <h3>Пункты этой должности</h3>
                    {ownChecks.map((item) => (
                      <div key={item.id} className="eo-check">
                        <span>{item.text}</span>
                        {item.status === 'done' ? <b>выполнено</b> : (
                          <>
                            <input
                              value={evidence[item.id] || ''}
                              placeholder="Основание"
                              onChange={(event) => setEvidence((prev) => ({ ...prev, [item.id]: event.target.value }))}
                            />
                            <button className="eo-btn" type="button" onClick={() => void deskRun(() => api.confirmExternalCheck(deskOrder.id, item.id, evidence[item.id] || '', asRole))}>
                              Подтвердить
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
                {role === 'committee' ? (
                  <div className="eo-form">
                    <h3>Решение Комитета</h3>
                    <input value={protocol} placeholder="Номер протокола" onChange={(event) => setProtocol(event.target.value)} />
                    <input value={baseVersion} placeholder="Базовая версия" onChange={(event) => setBaseVersion(event.target.value)} />
                    <input value={deskConditions} placeholder="Условия, если решение с условиями" onChange={(event) => setDeskConditions(event.target.value)} />
                    <div className="eo-actions">
                      <button className="eo-btn is-primary" type="button" onClick={() => void deskRun(() => api.decideExternalOrder(deskOrder.id, {
                        decision: 'confirmed',
                        protocol,
                        base_version: baseVersion,
                        baseline_id: baseVersion ? '' : (deskOrder.baselines || []).slice(-1)[0]?.id || '',
                        allowed_stage: 'tkp',
                        conditions: ''
                      }, asRole))}>Подтвердить</button>
                      <button className="eo-btn" type="button" onClick={() => void deskRun(() => api.decideExternalOrder(deskOrder.id, {
                        decision: 'confirmed_conditions',
                        protocol,
                        base_version: baseVersion,
                        baseline_id: baseVersion ? '' : (deskOrder.baselines || []).slice(-1)[0]?.id || '',
                        allowed_stage: 'tkp',
                        conditions: deskConditions
                      }, asRole))}>С условиями</button>
                      <button className="eo-btn" type="button" onClick={() => void deskRun(() => api.decideExternalOrder(deskOrder.id, {
                        decision: 'rework',
                        protocol,
                        base_version: '',
                        allowed_stage: 'calc',
                        conditions: deskConditions
                      }, asRole))}>На доработку</button>
                    </div>
                  </div>
                ) : null}
                {role === 'rp' || role === 'ks' ? (
                  <div className="eo-actions">
                    <button className="eo-btn" type="button" onClick={() => void deskRun(() => api.buildExternalPlan(deskOrder.id, asRole))}>Собрать проект плана</button>
                    {role === 'rp' ? <button className="eo-btn" type="button" onClick={() => void deskRun(() => api.approveExternalPlan(deskOrder.id, asRole))}>Утвердить базовый план</button> : null}
                    {role === 'rp' ? <button className="eo-btn" type="button" onClick={() => void deskRun(() => api.publishExternalPlan(deskOrder.id, asRole))}>Опубликовать</button> : null}
                  </div>
                ) : null}
              </section>
            ) : null}
          </div>
      )}
    </div>
    </OrchSlotMain>
  )
}

function Card({
  order,
  role,
  price,
  evidence,
  protocol,
  baseVersion,
  onPrice,
  onEvidence,
  onProtocol,
  onBase,
  onBack,
  onRun,
  onHelper,
  helperBusy,
  helper,
  helperLog
}: {
  order: Order
  role: string
  price: string
  evidence: Record<string, string>
  protocol: string
  baseVersion: string
  onPrice: (value: string) => void
  onEvidence: (id: string, value: string) => void
  onProtocol: (value: string) => void
  onBase: (value: string) => void
  onBack: () => void
  onRun: (action: () => Promise<Order | void>) => Promise<void>
  onHelper: () => void
  helperBusy: boolean
  helper: ExternalOrderReview | null
  helperLog: string[]
}): React.JSX.Element {
  const asRole = role
  const linked = order.sections?.onec
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ExternalOnecSearch | null>(null)
  const [lookupError, setLookupError] = useState('')
  const canLink = role === 'ks' || role === 'development' || role === 'finance' || role === 'it'
  const canUpload = UPLOAD_ROLES.has(role)
  const fileKinds = role === 'committee' ? FILE_KINDS.filter((item) => item.id === 'protocol') : FILE_KINDS
  const forms = ROLE_FIELDS[role] || []
  const [fileKind, setFileKind] = useState(role === 'committee' ? 'protocol' : 'contract')
  const [conditions, setConditions] = useState('')
  const [rpName, setRpName] = useState(order.owners?.rp || '')
  const [risk, setRisk] = useState({ title: '', impact: '', measure: '' })
  const [sectionDraft, setSectionDraft] = useState<Record<string, string>>({})
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const form of ROLE_FIELDS[role] || []) {
      const bucket = order.sections?.[form.section] || {}
      for (const field of form.fields) {
        const stored = String(bucket[field.key] || '')
        next[`${form.section}.${field.key}`] =
          stored || (form.section === 'commercial' && field.key === 'price' ? price : '')
      }
    }
    setSectionDraft(next)
    setRpName(order.owners?.rp || '')
  }, [order.id, order.audit.length, role, order.owners, order.sections])
  const [baseline, setBaseline] = useState({
    composition: '',
    cost: '',
    mcr: '',
    margin: '',
    bdds: '',
    deadlines: '',
    reason: ''
  })

  async function lookup(counterparty = ''): Promise<void> {
    setLookupError('')
    try {
      setHits(await api.searchExternalOnec(counterparty ? '' : query, counterparty))
    } catch (err) {
      setHits(null)
      setLookupError(err instanceof ApiError ? err.message : '1С не ответила')
    }
  }

  return (
    <article className="eo-card">
      <header className="eo-wide eo-head">
        <div>
          <button type="button" className="eo-back" onClick={onBack}>К списку</button>
          <h2>{order.code} · {order.customer}</h2>
          <p className="eo-muted">{order.product}. {order.stage_label}, {order.status_label}. {order.payment_note}</p>
          <div className="eo-tags">
            {ROUTES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={order.route === item.id ? 'eo-chip-btn is-active' : 'eo-chip-btn'}
                onClick={() => {
                  if (role !== 'development' && role !== 'committee') return
                  void onRun(() => api.patchExternalOrder(order.id, { route: item.id }, asRole))
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="eo-actions">
          <button type="button" className="is-primary" disabled={helperBusy} onClick={onHelper}>{helperBusy ? 'Помощник…' : 'Помощник'}</button>
          {(MOVES[role] || []).map((move) => (
            <button key={move.target} type="button" onClick={() => void onRun(() => api.transitionExternalOrder(order.id, move.target, asRole))}>
              {move.label}
            </button>
          ))}
        </div>
      </header>
      {helper ? <div className="eo-wide"><HelperPanel review={helper} log={helperLog} /></div> : null}
      <div className="eo-wide eo-progress">
        {Object.entries(GATES).map(([gate, title]) => {
          const items = order.checks.filter((item) => item.gate === gate && item.status !== 'not_applicable')
          const done = items.filter((item) => item.status === 'done').length
          const width = items.length ? Math.round((done / items.length) * 100) : 0
          return (
            <div key={gate} className="eo-meter">
              <b>{title}</b>
              <div className="eo-bar"><span style={{ width: `${width}%` }} /></div>
              <small>{done} из {items.length}</small>
            </div>
          )
        })}
      </div>
      <div className="eo-blocks">
        {order.blocks.map((block) => <p key={block}>{block}</p>)}
        <p className="eo-note">{order.payment_note}. {order.project_note}.</p>
      </div>
      <section className="eo-form eo-wide">
        <h3>Путь в 1С, с ТКП</h3>
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
          <p className="eo-muted">Загрузите коммерческое предложение из списка. Карточка повторит заказ, договор, отгрузку и оплату.</p>
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
      {forms.length || RISK_ROLES.has(role) || OWNER_ROLES.has(role) ? (
        <section className="eo-wide">
          <h3>Работа должности</h3>
          {forms.map((form) => (
            <div key={form.section} className="eo-form">
              <h3>{form.title}</h3>
              {form.fields.map((field) => {
                const draftKey = `${form.section}.${field.key}`
                return (
                  <input
                    key={field.key}
                    value={sectionDraft[draftKey] || ''}
                    placeholder={field.label}
                    aria-label={field.label}
                    onChange={(event) => {
                      setSectionDraft({ ...sectionDraft, [draftKey]: event.target.value })
                      if (draftKey === 'commercial.price') onPrice(event.target.value)
                    }}
                  />
                )
              })}
              <button
                type="button"
                onClick={() => {
                  const values: Record<string, string> = {}
                  for (const field of form.fields) values[field.key] = sectionDraft[`${form.section}.${field.key}`] || ''
                  void onRun(() => api.patchExternalOrder(order.id, { sections: { [form.section]: values } }, asRole))
                }}
              >
                Сохранить {form.title.toLowerCase()}
              </button>
            </div>
          ))}
          {OWNER_ROLES.has(role) ? (
            <div className="eo-form">
              <h3>Руководитель проекта</h3>
              <input value={rpName} placeholder="ФИО руководителя проекта" onChange={(event) => setRpName(event.target.value)} />
              <button
                type="button"
                onClick={() => void onRun(() => api.patchExternalOrder(order.id, { owners: { rp: rpName } }, asRole))}
              >
                Назначить
              </button>
            </div>
          ) : null}
          {RISK_ROLES.has(role) ? (
            <div className="eo-form">
              <h3>Риск</h3>
              {(order.risks || []).map((item) => (
                <p key={item.id}>{item.title}{item.impact ? ` · ${item.impact}` : ''}</p>
              ))}
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
      ) : null}
      <section className="eo-wide">
        <h3>Дело</h3>
        {canUpload ? (
        <div className="eo-actions">
          <select
            value={fileKinds.some((item) => item.id === fileKind) ? fileKind : fileKinds[0].id}
            onChange={(event) => setFileKind(event.target.value)}
          >
            {fileKinds.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          <input
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
        ) : null}
        {order.documents.map((item) => (
          <p key={item.id}>
            {item.title} {item.version} {item.approved ? '· утверждён' : ''}
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
            {role === 'committee' && item.owner_role && item.owner_role !== 'committee'
              ? order.decisions.filter((decision) => decision.conditions && !decision.conditions_closed).map((decision) => (
                <button
                  key={decision.id}
                  type="button"
                  onClick={() => void onRun(() => api.closeExternalConditions(order.id, decision.id, item.id, asRole))}
                >
                  Закрыть условие этим документом
                </button>
              ))
              : null}
          </p>
        ))}
        {(order.gaps || []).filter((item) => item.status === 'open').map((item) => (
          <p key={item.id} className="eo-note">
            Пробел «{item.field}», {item.owner_label}{item.due_at ? `, до ${item.due_at.slice(0, 16).replace('T', ' ')}` : ''}. {item.detail}
          </p>
        ))}
        {(order.lines || []).filter((item) => item.change !== 'same').map((item) => (
          <p key={item.id}>{item.change}: {item.name}, {item.qty}, {item.amount}</p>
        ))}
        <h3>Базовая версия</h3>
        {(order.baselines || []).map((item) => (
          <p key={item.id}>{item.code}{item.immutable ? ' · неизменяема' : ''} {item.reason}</p>
        ))}
        {role === 'ks' || role === 'finance' || role === 'rp' || role === 'committee' ? (
          <div className="eo-form">
            <input placeholder="Состав" value={baseline.composition} onChange={(event) => setBaseline({ ...baseline, composition: event.target.value })} />
            <input placeholder="Стоимость" value={baseline.cost} onChange={(event) => setBaseline({ ...baseline, cost: event.target.value })} />
            <input placeholder="МЦР" value={baseline.mcr} onChange={(event) => setBaseline({ ...baseline, mcr: event.target.value })} />
            <input placeholder="Маржа" value={baseline.margin} onChange={(event) => setBaseline({ ...baseline, margin: event.target.value })} />
            <input placeholder="БДДС" value={baseline.bdds} onChange={(event) => setBaseline({ ...baseline, bdds: event.target.value })} />
            <input placeholder="Сроки" value={baseline.deadlines} onChange={(event) => setBaseline({ ...baseline, deadlines: event.target.value })} />
            <input placeholder="Основание новой версии" value={baseline.reason} onChange={(event) => setBaseline({ ...baseline, reason: event.target.value })} />
            <button
              type="button"
              onClick={() => void onRun(() => api.createExternalBaseline(order.id, baseline, asRole))}
            >
              Создать версию
            </button>
          </div>
        ) : null}
        <h3>План</h3>
        {(order.tasks || []).map((item) => (
          <p key={item.id}>
            {item.critical ? 'Критический путь. ' : ''}{item.title}
            {item.approved ? ' · утверждён' : ''}
            {item.published ? ' · опубликован' : ''}
          </p>
        ))}
        {role === 'ks' || role === 'rp' ? (
          <div className="eo-actions">
            <button type="button" onClick={() => void onRun(() => api.buildExternalPlan(order.id, asRole))}>Собрать проект плана</button>
            {role === 'rp' ? (
              <button type="button" onClick={() => void onRun(() => api.approveExternalPlan(order.id, asRole))}>Утвердить базовый план</button>
            ) : null}
            {role === 'rp' ? (
              <button type="button" onClick={() => void onRun(() => api.publishExternalPlan(order.id, asRole))}>Опубликовать без копий</button>
            ) : null}
          </div>
        ) : null}
        {(order.notices || []).map((item) => (
          <p key={item.id} className="eo-note">{item.title}. {item.body} {item.mail_status}</p>
        ))}
      </section>
      <section className="eo-wide">
        <h3>Чек-листы</h3>
        <div className="eo-checks">
        {Object.entries(GATES).map(([gate, title]) => {
          const items = order.checks.filter((item) => item.gate === gate)
          if (!items.length) return null
          return (
            <div key={gate} className="eo-panel">
              <strong>{title}</strong>
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
                  ) : <span className={item.status === 'done' ? 'eo-tag' : 'eo-tag is-stop'}>{item.status_label || item.status}</span>}
                </div>
              ))}
            </div>
          )
        })}
        </div>
      </section>
      <section className="eo-wide">
        <h3>Сверка ТКП и договора</h3>
        <table className="eo-table">
          <thead>
            <tr><th>Код</th><th>Проверка</th><th>Уровень</th><th>ТКП</th><th>Договор</th><th></th></tr>
          </thead>
          <tbody>
            {order.diffs.map((item) => (
              <tr key={item.id}>
                <td>{item.code}</td>
                <td>{item.area}: {item.title}<br />{item.owner_label}</td>
                <td>{item.level === 'blocking' ? 'блокирующее' : 'существенное'}</td>
                <td>{item.left_value || '—'}</td>
                <td>{item.right_value || '—'}</td>
                <td>
                  {item.status === 'closed' ? 'закрыто' : role === item.owner_role ? (
                    <button
                      type="button"
                      onClick={() => void onRun(() => api.closeExternalDiff(order.id, item.id, 'Закрыто владельцем', asRole))}
                    >
                      Закрыть
                    </button>
                  ) : item.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="eo-wide">
        <h3>Комитет</h3>
        {order.decisions.map((item) => (
          <p key={item.id}>
            {item.protocol || 'без номера'}: {item.decision}, база {item.base_version || '—'}.
            {item.conditions ? ` Условия: ${item.conditions}.` : ''}
            {item.conditions_closed ? ' Условия закрыты.' : ''}
          </p>
        ))}
        {role === 'committee' ? (
          <div className="eo-form">
            <input value={protocol} placeholder="Номер протокола" onChange={(event) => onProtocol(event.target.value)} />
            <input value={baseVersion} placeholder="Базовая версия" onChange={(event) => onBase(event.target.value)} />
            <input value={conditions} placeholder="Условия, если решение с условиями" onChange={(event) => setConditions(event.target.value)} />
            <div className="eo-actions">
              <button
                type="button"
                className="is-primary"
                onClick={() => void onRun(() => api.decideExternalOrder(order.id, {
                  decision: 'confirmed',
                  protocol,
                  base_version: baseVersion,
                  baseline_id: baseVersion ? '' : (order.baselines || []).slice(-1)[0]?.id || '',
                  allowed_stage: 'tkp',
                  conditions: ''
                }, asRole))}
              >
                Подтвердить базовую версию
              </button>
              <button
                type="button"
                onClick={() => void onRun(() => api.decideExternalOrder(order.id, {
                  decision: 'confirmed_conditions',
                  protocol,
                  base_version: baseVersion,
                  baseline_id: baseVersion ? '' : (order.baselines || []).slice(-1)[0]?.id || '',
                  allowed_stage: 'tkp',
                  conditions
                }, asRole))}
              >
                Подтвердить с условиями
              </button>
              <button
                type="button"
                onClick={() => void onRun(() => api.decideExternalOrder(order.id, {
                  decision: 'rework',
                  protocol,
                  base_version: '',
                  allowed_stage: 'calc',
                  conditions
                }, asRole))}
              >
                Вернуть на доработку
              </button>
            </div>
          </div>
        ) : <p className="eo-muted">Решение фиксирует только Комитет.</p>}
      </section>
      <section className="eo-wide">
        <h3>Выводы агента</h3>
        {order.findings.length === 0 ? <p className="eo-muted">Черновиков нет.</p> : null}
        {order.findings.map((item) => (
          <p key={item.id}>
            {item.field}: {item.value} ({item.source_ref}) — {item.status === 'accepted' ? 'принято' : 'черновик'}
            {item.status !== 'accepted' && role === item.owner_role ? (
              <button type="button" onClick={() => void onRun(() => api.acceptExternalFinding(order.id, item.id, asRole))}>
                Принять
              </button>
            ) : null}
          </p>
        ))}
      </section>
      <section className="eo-wide">
        <h3>История</h3>
        {order.documents.map((item) => <p key={item.id}>{item.title} {item.version}</p>)}
        {order.documents.length === 0 ? <p className="eo-muted">Файлы в дело ещё не внесены.</p> : null}
        {order.audit.map((item) => (
          <p key={item.id} className="eo-muted">{item.actor_fio} ({item.actor_role}): {item.action}. {item.detail}</p>
        ))}
      </section>
    </article>
  )
}
