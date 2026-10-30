import { useEffect, useState } from 'react'
import type {
  CopilotAiResult,
  CopilotQuestion,
  ExternalOrder,
  ExternalOrderCheck,
  ExternalOrderFinding,
  ExternalOrderReview,
  StagePassport
} from './externalOrderTypes'

const VERDICT: Record<string, string> = {
  done: 'Выполнено',
  gap: 'Нет источника',
  wait: 'Ждёт владельца',
  skip: 'Не применимо'
}

export const ROLE_NAME: Record<string, string> = {
  ks: 'Коммерческая служба',
  development: 'Развитие',
  rp: 'Руководитель проекта',
  committee: 'Комитет',
  kb: 'КБ и ГСПП',
  omto: 'ОМТО',
  finance: 'Финансы',
  production: 'Производство',
  legal: 'Юристы',
  it: 'ИТ',
  viewer: 'Просмотр'
}

export const GATES: Record<string, string> = {
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

export const FILE_KIND_LABELS: Record<string, string> = {
  tz: 'ТЗ',
  tkp: 'ТКП',
  contract: 'Договор',
  specification: 'Спецификация',
  condition: 'Заключение',
  acceptance: 'Приёмка',
  protocol: 'Протокол',
  plan: 'План работ',
  other: 'Прочее'
}

export const LINE: {
  id: string
  label: string
  hint: string
  statuses: string[]
  owner_roles: string[]
  gates: string[]
  required_docs: string[]
}[] = [
  {
    id: 'request',
    label: 'Запрос',
    hint: 'Заказчик и продукт зафиксированы в карточке. Собираем входной комплект (ЗПР и ТЗ).',
    statuses: ['draft', 'collecting'],
    owner_roles: ['ks', 'development'],
    gates: ['before_calc'],
    required_docs: ['tz']
  },
  {
    id: 'calc',
    label: 'Расчёт',
    hint: 'Службы считают себестоимость, МЦР, сроки, прорабатывают КД, закупки и риски до Комитета.',
    statuses: ['calculating', 'rework'],
    owner_roles: ['kb', 'omto', 'finance', 'production', 'legal', 'development'],
    gates: ['before_committee'],
    required_docs: ['tz', 'condition']
  },
  {
    id: 'committee',
    label: 'Комитет',
    hint: 'Комитет рассматривает базовую версию (БВ), утверждает протокол или возвращает на доработку.',
    statuses: ['ready_committee', 'confirmed', 'confirmed_conditions'],
    owner_roles: ['committee', 'finance', 'ks'],
    gates: ['before_committee', 'before_tkp'],
    required_docs: ['protocol']
  },
  {
    id: 'tkp',
    label: 'ТКП',
    hint: 'Финальное ТКП оформлено по утверждённой базовой версии и направлено заказчику.',
    statuses: ['tkp_issued'],
    owner_roles: ['ks'],
    gates: ['before_tkp', 'before_sign'],
    required_docs: ['tkp']
  },
  {
    id: 'contract',
    label: 'Договор',
    hint: 'Сверяем ТКП с проектом договора и спецификацией по матрице B01–B35 и фиксируем подписание.',
    statuses: ['contract_review', 'contract_signed'],
    owner_roles: ['ks', 'legal', 'finance', 'rp'],
    gates: ['before_sign', 'before_project'],
    required_docs: ['contract', 'specification']
  },
  {
    id: 'run',
    label: 'Исполнение',
    hint: 'Проектный и производственный запуск: выпуск КД, закупка ОМТО, изготовление по базовому плану.',
    statuses: ['in_progress', 'production'],
    owner_roles: ['rp', 'kb', 'omto', 'production'],
    gates: ['before_project', 'before_production', 'before_psi'],
    required_docs: ['plan']
  },
  {
    id: 'ship',
    label: 'Отгрузка',
    hint: 'ПСИ, приёмка ОТК/заказчика, комплектация и отгрузка продукции со склада.',
    statuses: ['acceptance', 'shipped'],
    owner_roles: ['production', 'ks', 'omto', 'rp'],
    gates: ['before_psi', 'before_ship'],
    required_docs: ['acceptance']
  },
  {
    id: 'pay',
    label: 'Оплата',
    hint: 'Контроль полной оплаты по графику, закрытие дебиторской задолженности и архивирование дела.',
    statuses: ['awaiting_payment', 'closed'],
    owner_roles: ['finance', 'ks', 'rp'],
    gates: ['before_close'],
    required_docs: ['contract', 'acceptance']
  }
]

export const ROLE_FIELDS: Record<string, { section: string; title: string; fields: { key: string; label: string }[] }[]> = {
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
  development: [
    {
      section: 'commercial',
      title: 'Параметры запроса и развития',
      fields: [
        { key: 'price', label: 'Ориентир цены' },
        { key: 'currency', label: 'Валюта' }
      ]
    },
    {
      section: 'technical',
      title: 'Входные требования',
      fields: [
        { key: 'composition', label: 'Состав поставки' },
        { key: 'limits', label: 'Ограничения и особенности' }
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
  omto: [
    {
      section: 'execution',
      title: 'Обеспечение и закупки ОМТО',
      fields: [
        { key: 'cycle', label: 'Срок поставки КИ и материалов' },
        { key: 'capacity', label: 'Ключевые поставщики и квоты' }
      ]
    },
    {
      section: 'calculation',
      title: 'Затраты на закупку',
      fields: [{ key: 'cost', label: 'Стоимость закупки ПКИ' }]
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

const FIELD_NAMES: Record<string, string> = {
  'commercial.price': 'Коммерческие условия · Цена',
  'commercial.vat': 'Коммерческие условия · НДС',
  'commercial.currency': 'Коммерческие условия · Валюта',
  'commercial.discount': 'Коммерческие условия · Скидка',
  'technical.composition': 'Технический раздел · Состав',
  'technical.kd': 'Технический раздел · КД',
  'technical.analogs': 'Технический раздел · Аналоги',
  'technical.limits': 'Технический раздел · Ограничения',
  'technical.quality': 'Качество · Нормативы',
  'technical.psi': 'Качество · ПСИ',
  'execution.cycle': 'Производство/ОМТО · Цикл',
  'execution.capacity': 'Производство/ОМТО · Мощности',
  'execution.acceptance': 'Производство · Приёмка',
  'execution.smr': 'Производство · СМР и ПНР',
  'execution.status': 'Исполнение · Ход работ',
  'calculation.mcr': 'Расчёт · МЦР',
  'calculation.cost': 'Расчёт · Себестоимость',
  'calculation.margin': 'Расчёт · Маржа',
  'calculation.reserve': 'Расчёт · Резерв',
  'calculation.bdds': 'Расчёт · БДДС',
  'finance.schedule': 'Финансы · График платежей',
  'contract.sanctions': 'Договор · Санкции',
  'contract.warranty': 'Договор · Гарантия',
  'contract.liability': 'Договор · Ответственность',
  'contract.termination': 'Договор · Односторонний отказ',
  'project.plan_note': 'Проект · План',
  'project.critical_path': 'Проект · Критический путь',
  'closure.lessons': 'Закрытие · Уроки проекта',
  subject: 'Предмет поставки (B02)',
  price: 'Цена договора / ТКП (B05)',
  vat: 'Ставка НДС (B06)',
  term: 'Срок поставки (B09)',
  payment: 'Условия оплаты (B13)',
  acceptance: 'Порядок приёмки (B17)',
  warranty: 'Гарантийный срок (B22)',
  sanctions: 'Штрафные санкции (B24)'
}

export function humanFindingLabel(finding: ExternalOrderFinding): string {
  if (finding.label && finding.label.trim()) return finding.label.trim()
  const raw = (finding.field || '').trim()
  if (raw.startsWith('section:')) {
    const key = raw.slice('section:'.length)
    return FIELD_NAMES[key] || `Поле раздела · ${key}`
  }
  if (raw.startsWith('check:')) {
    return `Пункт чек-листа · ${raw.slice('check:'.length)}`
  }
  if (raw.startsWith('baseline:')) {
    return 'Черновик базовой версии (БВ)'
  }
  if (raw.startsWith('risk:')) {
    return 'Черновик риска проекта'
  }
  if (raw.startsWith('draft_1c') || raw.startsWith('1c:')) {
    const kind = raw.split(/[:_]/).pop() || ''
    const kindMap: Record<string, string> = {
      memo: 'Служебная записка в 1С ДО',
      assignment: 'Поручение в 1С ДО',
      directive: 'Распоряжение в 1С ДО',
      order: 'Приказ в 1С ДО',
      protocol: 'Протокол / поручение в 1С ДО'
    }
    return kindMap[kind] || 'Проект документа 1С ДО'
  }
  return FIELD_NAMES[raw] || raw || 'Предложение ИИ'
}

export function findingCategoryLabel(finding: ExternalOrderFinding): string {
  const kind = (finding.kind || '').trim()
  const field = (finding.field || '').trim()
  if (kind === 'draft_1c' || field.startsWith('draft_1c') || field.startsWith('1c:')) return 'Проект 1С ДО'
  if (kind === 'section_field' || field.startsWith('section:')) return 'Поле карточки'
  if (kind === 'check_evidence' || field.startsWith('check:')) return 'Чек-лист'
  if (kind === 'baseline_draft' || field.startsWith('baseline:')) return 'Базовая версия'
  if (kind === 'risk_draft' || field.startsWith('risk:')) return 'Риск'
  return 'Вывод из документа'
}

export function parseDraft1cFinding(
  finding: ExternalOrderFinding
): {
  kind: 'memo' | 'assignment' | 'directive' | 'order'
  title: string
  text: string
  values: Record<string, string>
} | null {
  const fKind = (finding.kind || '').trim()
  const field = (finding.field || '').trim()
  const is1c =
    fKind === 'draft_1c' ||
    fKind.startsWith('draft_1c') ||
    field.startsWith('draft_1c') ||
    field.startsWith('1c:')
  if (!is1c && !finding.prefill) return null

  let docKind: 'memo' | 'assignment' | 'directive' | 'order' = 'memo'
  const rawSuffix = field.split(/[:_]/).pop()?.toLowerCase() || ''
  if (rawSuffix === 'assignment' || rawSuffix === 'protocol') docKind = 'assignment'
  else if (rawSuffix === 'directive') docKind = 'directive'
  else if (rawSuffix === 'order') docKind = 'order'

  let title = finding.label || ''
  let text = finding.value || ''
  const values: Record<string, string> = {}

  if (finding.prefill && typeof finding.prefill === 'object') {
    for (const [k, v] of Object.entries(finding.prefill)) {
      if (typeof v === 'string') values[k] = v
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [nk, nv] of Object.entries(v as Record<string, unknown>)) {
          if (typeof nv === 'string') values[nk] = nv
        }
      }
    }
  }

  if (text.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const k = String(parsed.kind || parsed.doc_kind || '').toLowerCase()
      if (k === 'assignment' || k === 'protocol') docKind = 'assignment'
      else if (k === 'directive') docKind = 'directive'
      else if (k === 'order') docKind = 'order'
      else if (k === 'memo') docKind = 'memo'
      if (typeof parsed.title === 'string' && parsed.title.trim()) title = parsed.title.trim()
      if (typeof parsed.text === 'string' && parsed.text.trim()) text = parsed.text.trim()
      else if (typeof parsed.content === 'string' && parsed.content.trim()) text = parsed.content.trim()
      else if (typeof parsed.body === 'string' && parsed.body.trim()) text = parsed.body.trim()
      if (parsed.prefill && typeof parsed.prefill === 'object') {
        for (const [pk, pv] of Object.entries(parsed.prefill as Record<string, unknown>)) {
          if (typeof pv === 'string') values[pk] = pv
        }
      }
      if (parsed.values && typeof parsed.values === 'object') {
        for (const [vk, vv] of Object.entries(parsed.values as Record<string, unknown>)) {
          if (typeof vv === 'string') values[vk] = vv
        }
      }
    } catch {
      /* keep raw text */
    }
  }

  return {
    kind: docKind,
    title: title || humanFindingLabel(finding),
    text,
    values
  }
}

export function formatFindingValue(finding: ExternalOrderFinding): string {
  const raw = (finding.value || '').trim()
  if (!raw.startsWith('{')) return raw
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const parts: string[] = []
    if (parsed.title) parts.push(`Тема: ${String(parsed.title)}`)
    if (parsed.text || parsed.content || parsed.body) {
      parts.push(String(parsed.text || parsed.content || parsed.body))
    }
    if (parsed.composition) parts.push(`Состав: ${String(parsed.composition)}`)
    if (parsed.cost) parts.push(`Себестоимость: ${String(parsed.cost)}`)
    if (parsed.mcr) parts.push(`МЦР: ${String(parsed.mcr)}`)
    if (parsed.margin) parts.push(`Маржа: ${String(parsed.margin)}`)
    if (parsed.impact) parts.push(`Влияние: ${String(parsed.impact)}`)
    if (parsed.measure) parts.push(`Мера: ${String(parsed.measure)}`)
    if (parts.length) return parts.join(' · ')
  } catch {
    /* ignore */
  }
  return raw
}

export type BasisAdvice = {
  what: string
  draft: string
  source: string
  template: boolean
}

function sectionValue(order: ExternalOrder, section: string, key: string): string {
  return String(order.sections?.[section]?.[key] || '').trim()
}

function namedDoc(order: ExternalOrder, kinds: string[]): string {
  const doc = (order.documents || []).find((item) => kinds.includes(item.kind) && (item.title || item.file_name))
  if (!doc) return ''
  const name = doc.file_name || doc.title
  return doc.version ? `${name}, ${doc.version}` : name
}

function ready(what: string, draft: string, source: string): BasisAdvice {
  return { what, draft, source, template: false }
}

function hint(what: string, draft = ''): BasisAdvice {
  return { what, draft, source: '', template: true }
}

export function basisAdvice(order: ExternalOrder, check: ExternalOrderCheck): BasisAdvice {
  const finding = (order.findings || []).find(
    (item) => item.field === `check:${check.id}` && item.status !== 'rejected' && String(item.value || '').trim()
  )
  if (finding) {
    return ready(
      'По этому пункту помощник уже собрал основание из дела. Вставьте его в поле и подтвердите. Отдельный файл не нужен, если в тексте назван источник.',
      formatFindingValue(finding),
      finding.source_ref || 'Черновик помощника'
    )
  }

  const cycle = sectionValue(order, 'execution', 'cycle')
  const capacity = sectionValue(order, 'execution', 'capacity')
  const acceptance = sectionValue(order, 'execution', 'acceptance')
  const quality = sectionValue(order, 'technical', 'quality')
  const psi = sectionValue(order, 'technical', 'psi')
  const smr = sectionValue(order, 'execution', 'smr')
  const text = check.text

  if (text === 'Производство подтвердило цикл и мощности') {
    if (cycle && capacity) {
      return ready(
        'Основание — не вложение, а ваши цифры из блока «Производство и сервис»: цикл и мощности.',
        `Цикл: ${cycle}. Мощности: ${capacity}.`,
        'Раздел «Производство и сервис»'
      )
    }
    return hint(
      'Сначала заполните поля «Цикл» и «Мощности» выше. В основание попадёт эта пара, например срок изготовления и подтверждение, что цех тянет объём. Скан сюда прикладывать не нужно.',
      'Цикл: … рабочих дней. Мощности: цех подтвердил объём, кооперация не требуется.'
    )
  }
  if (text === 'Ресурсы и мощности подтверждены') {
    if (capacity) {
      return ready('Берите формулировку из поля «Мощности».', capacity, 'Поле «Мощности»')
    }
    return hint(
      'Напишите, кто и чем подтвердил ресурсы: цех, люди, оснастка. Если мощности уже введены выше, помощник подставит их сам.',
      'Мощности подтверждены: … (цех / смена / кооперация).'
    )
  }
  if (text === 'Маршрут и контроль качества определены') {
    if (quality) {
      return ready('В основание идут нормативы из поля «Нормативы».', `Контроль качества: ${quality}.`, 'Поле «Нормативы»')
    }
    return hint(
      'Укажите маршрут изготовления и чем принимаете качество: ГОСТ, ТУ или программа ПСИ. Это же значение введите в поле «Нормативы».',
      'Маршрут: …. Контроль: ГОСТ / ТУ …, программа ПСИ ….'
    )
  }
  if (text === 'Программа и методика утверждены') {
    const doc = namedDoc(order, ['acceptance', 'protocol', 'condition'])
    if (psi) return ready('В основание — текст поля «ПСИ».', psi, 'Поле «ПСИ»')
    if (doc) return ready('В деле уже есть документ, на который можно сослаться номером и названием.', `ПМИ: ${doc}.`, doc)
    return hint(
      'Нужно название утверждённой программы и методики, кем и когда утверждена. Файл прикрепите во вкладке «Сделка и дело», в основание — его имя, а не слово «утверждено».',
      'ПМИ «…» утверждена …, дата ….'
    )
  }
  if (text === 'Готовность изделия подтверждена') {
    const doc = namedDoc(order, ['acceptance', 'protocol'])
    if (doc) return ready('Сошлитесь на документ приёмки, который уже лежит в деле.', `Готовность: ${doc}.`, doc)
    return hint('Номер и дата акта готовности или записи ОТК. Пересказ без номера не считается основанием.', 'Акт готовности № … от ….')
  }
  if (text === 'Средства измерений действительны') {
    return hint(
      'Номер свидетельства о поверке и до какой даты оно действует. Скан можно прикрепить в дело, в основание — номер и срок.',
      'СИ поверены, свидетельство № …, действительно до ….'
    )
  }
  if (text === 'Замечания предыдущих проверок закрыты') {
    return hint(
      'Номера закрытых замечаний или явная фраза, что замечаний не было, со ссылкой на протокол ПСИ.',
      'Замечания ПСИ … закрыты / замечаний нет, протокол ….'
    )
  }
  if (text === 'Приёмка завершена') {
    if (acceptance) return ready('В основание идёт поле «Приёмка».', acceptance, 'Поле «Приёмка»')
    const doc = namedDoc(order, ['acceptance'])
    if (doc) return ready('В деле есть документ приёмки.', `Приёмка: ${doc}.`, doc)
    return hint('Дата и документ: акт, УПД или запись. То же кратко впишите в поле «Приёмка» выше.', 'Приёмка завершена актом № … от ….')
  }
  if (text === 'Гарантийная передача выполнена') {
    return hint('Номер и дата акта гарантийной передачи. Без номера пункт не закрывается.', 'Акт гарантийной передачи № … от ….')
  }
  if (text === 'Запрос и ТЗ зарегистрированы') {
    const doc = namedDoc(order, ['tz'])
    if (doc) return ready('В деле есть файл ТЗ — его имя и есть основание.', `Запрос ${order.code}, ТЗ «${doc}».`, doc)
    return hint(`Карточка ${order.code} уже есть. Если ТЗ прикреплено, укажите имя файла. Если нет — так и напишите, что зарегистрирован только запрос.`, `Запрос ${order.code} зарегистрирован, файл ТЗ: ….`)
  }
  if (text === 'Есть разрешающий протокол и базовая версия') {
    const doc = namedDoc(order, ['protocol'])
    const base = order.baselines?.[order.baselines.length - 1]
    if (doc || base) {
      return ready(
        'Сошлитесь на протокол Комитета и код базовой версии.',
        `Протокол ${doc || '…'}, базовая версия ${base?.code || '…'}.`,
        doc || base?.code || ''
      )
    }
    return hint('Нужны номер протокола Комитета и код базовой версии. Пока их нет в деле, пункт подтвердить нечем.', 'Протокол № …, базовая версия ….')
  }
  if (smr && /смр|пнр|монтаж/i.test(text)) {
    return ready('Для этого пункта подходит поле «СМР и ПНР».', smr, 'Поле «СМР и ПНР»')
  }

  const gate = GATES[check.gate] || check.gate
  return hint(
    `В основание нужна короткая ссылка, по которой пункт можно проверить: документ, номер и дата. Гейт «${gate}». Одной фразы «подтверждено» недостаточно.`
  )
}

export function formAdvice(
  title: string,
  fields: { key: string; label: string }[],
  bucket: Record<string, string>
): string {
  const empty = fields.filter((field) => !String(bucket[field.key] || '').trim()).map((field) => field.label)
  const pending = empty.length ? ` Сейчас пусто: ${empty.join(', ')}.` : ' Все поля уже заполнены — их можно подставить в основание пунктов ниже.'
  if (title === 'Качество') {
    return `«Нормативы» — ГОСТ, ТУ или стандарт приёмки. «ПСИ» — название утверждённой программы и методики. Эти строки и есть основание пунктов про качество и ПСИ, отдельный файл не обязателен.${pending}`
  }
  if (title === 'Производство и сервис') {
    return `«Цикл» и «Мощности» закрывают пункт «Производство подтвердило цикл и мощности». «Приёмка» — документ и дата. «СМР и ПНР» — входят ли монтаж и пуск в объём.${pending}`
  }
  return `Значения этих полей помощник подставляет в основание чек-листа.${pending}`
}

/**
 * Детерминированный клиентский расчёт паспортов 8 этапов (использует серверный `order.stage_passports` при наличии).
 */
export function buildStagePassports(order: ExternalOrder): StagePassport[] {
  if (Array.isArray(order.stage_passports) && order.stage_passports.length === LINE.length) {
    return order.stage_passports
  }
  const currentIdx = Math.max(0, LINE.findIndex((step) => step.statuses.includes(order.status)))
  const isClosed = order.status === 'closed'
  const byServerId = new Map((order.stage_passports || []).map((item) => [item.id, item]))

  return LINE.map((step, index) => {
    const existing = byServerId.get(step.id)
    if (existing) return existing

    const stageChecks = (order.checks || []).filter(
      (check) => step.gates.includes(check.gate) && check.status !== 'not_applicable'
    )
    const checksDone = stageChecks.filter((check) => check.status === 'done').length
    const checksTotal = stageChecks.length
    const openChecks = stageChecks
      .filter((check) => check.status !== 'done')
      .map((check) => ({
        id: check.id,
        gate: check.gate,
        text: check.text,
        owner_role: check.owner_role,
        owner_label: check.owner_label || ROLE_NAME[check.owner_role] || check.owner_role,
        blocking: check.blocking ?? true
      }))

    const requiredDocs = step.required_docs.map((kind) => {
      const docs = (order.documents || []).filter((doc) => doc.kind === kind)
      const best = docs.find((doc) => doc.approved) || docs[docs.length - 1]
      return {
        kind,
        label: FILE_KIND_LABELS[kind] || kind,
        present: docs.length > 0,
        approved: Boolean(best?.approved),
        version: best?.version || ''
      }
    })

    const missingDocs = requiredDocs.filter((doc) => !doc.present)
    let state: StagePassport['state'] = 'upcoming'
    let blocker = ''
    let completedBy = ''

    if (isClosed || index < currentIdx) {
      state = 'done'
      const auditHit = [...(order.audit || [])]
        .reverse()
        .find((item) => item.action.includes('transition') || item.action.includes('этап') || item.action.includes('статус'))
      completedBy = auditHit
        ? `${auditHit.actor_fio} (${ROLE_NAME[auditHit.actor_role] || auditHit.actor_role})`
        : 'Этап пройден'
    } else if (index === currentIdx) {
      const orderBlock = (order.blocks || [])[0] || ''
      const checkBlock = openChecks.find((c) => c.blocking)?.text || ''
      const docBlock = missingDocs.length ? `Не прикреплён документ: ${missingDocs.map((d) => d.label).join(', ')}` : ''
      blocker = orderBlock || checkBlock || docBlock
      state = blocker ? 'blocked' : 'current'
    } else {
      state = 'upcoming'
      if (openChecks.length) {
        blocker = `Открыто пунктов чек-листа: ${openChecks.length}`
      }
    }

    return {
      id: step.id,
      label: step.label,
      hint: step.hint,
      statuses: step.statuses,
      state,
      owner_roles: step.owner_roles,
      owner_labels: step.owner_roles.map((r) => ROLE_NAME[r] || r),
      gates: step.gates,
      checks_done: checksDone,
      checks_total: checksTotal,
      open_checks: openChecks,
      required_docs: requiredDocs,
      blocker,
      completed_by: completedBy
    }
  })
}

/**
 * Детерминированный список вопросов по недостающим полям, открытым чек-листам и пробелам для выбранной роли.
 */
export function buildRoleQuestions(order: ExternalOrder, role: string): CopilotQuestion[] {
  const fromRoleMap = order.role_questions?.[role]
  if (Array.isArray(fromRoleMap) && fromRoleMap.length > 0) return fromRoleMap
  if (Array.isArray(order.questions) && order.questions.length > 0) {
    const filtered = order.questions.filter((q) => !q.owner_role || q.owner_role === role)
    if (filtered.length > 0) return filtered
  }

  const questions: CopilotQuestion[] = []
  const roleLabel = ROLE_NAME[role] || role

  for (const form of ROLE_FIELDS[role] || []) {
    const bucket = order.sections?.[form.section] || {}
    for (const field of form.fields) {
      const val = String(bucket[field.key] || '').trim()
      if (!val) {
        questions.push({
          id: `section:${form.section}.${field.key}`,
          field: `${form.section}.${field.key}`,
          section: form.section,
          key: field.key,
          prompt: `Укажите «${field.label}» в разделе «${form.title}»`,
          placeholder: `Введите ${field.label.toLowerCase()}…`,
          current_value: '',
          owner_role: role,
          owner_label: roleLabel
        })
      }
    }
  }

  const openGaps = (order.gaps || []).filter(
    (gap) => gap.status === 'open' && (gap.owner_role === role || role === 'ks' || role === 'it')
  )
  for (const gap of openGaps) {
    questions.push({
      id: `gap:${gap.id}`,
      field: gap.field,
      gap_id: gap.id,
      prompt: `Закройте пробел «${gap.field}»: ${gap.detail}`,
      placeholder: 'Значение и ссылка на источник (пункт договора / ТЗ / 1С)…',
      current_value: '',
      owner_role: gap.owner_role,
      owner_label: gap.owner_label || ROLE_NAME[gap.owner_role] || gap.owner_role
    })
  }

  const openChecks = (order.checks || []).filter(
    (check) =>
      check.owner_role === role &&
      check.status !== 'done' &&
      check.status !== 'not_applicable'
  )
  for (const check of openChecks.slice(0, 6)) {
    questions.push({
      id: `check:${check.id}`,
      field: check.text,
      check_id: check.id,
      prompt: `Подтвердите пункт «${check.text}» (${GATES[check.gate] || check.gate})`,
      placeholder: 'Основание / ссылка на расчёт, документ или номер в 1С…',
      current_value: check.evidence || '',
      owner_role: check.owner_role,
      owner_label: check.owner_label || roleLabel
    })
  }

  return questions
}

const BUSY_STEPS = [
  'Обновляю цепочку 1С и черновики авто-проверки',
  'ИИ читает документы дела и 1С',
  'ИИ заполняет пустые поля с источниками',
  'ИИ готовит вопросы и проверяет ответы'
]
const BUSY_STEP_MS = [2500, 15000, 30000]

function useBusySteps(busy: boolean): number {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!busy) {
      setStep(0)
      return
    }
    const timers: number[] = []
    let at = 0
    BUSY_STEP_MS.forEach((ms, index) => {
      at += ms
      timers.push(window.setTimeout(() => setStep(index + 1), at))
    })
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [busy])
  return step
}

function aiConfidenceLabel(confidence?: string): string {
  if (confidence === 'ai:high') return ' · уверенно'
  if (confidence === 'ai:low') return ' · проверьте'
  return ''
}

function questionLabel(order: ExternalOrder | null | undefined, field: string): string {
  if (field.startsWith('section:')) {
    const [section, key] = field.slice(8).split('.')
    for (const forms of Object.values(ROLE_FIELDS)) {
      for (const form of forms) {
        if (form.section !== section) continue
        const hit = form.fields.find((item) => item.key === key)
        if (hit) return `${form.title} · ${hit.label}`
      }
    }
  }
  if (field.startsWith('check:') && order) {
    return order.checks.find((item) => `check:${item.id}` === field)?.text || field
  }
  return field
}

export type HelperPanelProps = {
  order?: ExternalOrder | null
  role?: string
  roleLabel?: string
  stagePassport?: StagePassport | null
  review?: ExternalOrderReview | null
  log?: string[]
  summary?: string
  questions?: CopilotQuestion[]
  ai?: CopilotAiResult | null
  busy?: boolean
  onRunCopilot?: (opts?: {
    step_id?: string
    message?: string
    answers?: Record<string, string>
    auto_prepare?: boolean
    use_ai?: boolean
  }) => void
  onAcceptFinding?: (findingId: string) => void | Promise<unknown>
  onRejectFinding?: (findingId: string) => void | Promise<unknown>
  onAcceptAllFindings?: () => void | Promise<unknown>
  onOpenDocflow?: (
    kind: 'memo' | 'assignment' | 'directive' | 'order',
    prefill?: { title?: string; text?: string; values?: Record<string, string> }
  ) => void
  onOpenFullAgent?: (customPrompt?: string) => void
}

export function HelperPanel({
  order,
  role = '',
  roleLabel = '',
  stagePassport,
  review,
  log = [],
  summary = '',
  questions: propQuestions,
  ai = null,
  busy = false,
  onRunCopilot,
  onAcceptFinding,
  onRejectFinding,
  onAcceptAllFindings,
  onOpenDocflow,
  onOpenFullAgent
}: HelperPanelProps): React.JSX.Element {
  const [findingFilter, setFindingFilter] = useState<'role' | 'all' | 'accepted'>('role')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [sentAnswers, setSentAnswers] = useState<Record<string, string>>({})
  const [acceptError, setAcceptError] = useState<{ id: string; text: string } | null>(null)
  const progress = useBusySteps(busy)

  function runAccept(id: string, action: () => void | Promise<unknown>): void {
    const result = action()
    if (!result || typeof (result as Promise<unknown>).then !== 'function') return
    void (result as Promise<unknown>).then(
      () => setAcceptError((prev) => (prev?.id === id ? null : prev)),
      (err: unknown) =>
        setAcceptError({
          id,
          text: err instanceof Error ? err.message : 'Не удалось принять'
        })
    )
  }

  useEffect(() => {
    setAnswers({})
    setSentAnswers({})
    setMessage('')
  }, [order?.id, role])

  const allFindings = (order?.findings || []).filter((f) => f.status !== 'rejected')
  const pendingFindings = allFindings.filter((f) => f.status !== 'accepted')
  const rolePendingFindings = pendingFindings.filter(
    (f) => !role || f.owner_role === role || role === 'ks' || role === 'it'
  )
  const acceptedFindings = allFindings.filter((f) => f.status === 'accepted')

  const displayedFindings =
    findingFilter === 'accepted'
      ? acceptedFindings
      : findingFilter === 'role' && rolePendingFindings.length > 0
        ? rolePendingFindings
        : pendingFindings

  const activeQuestions = propQuestions?.length
    ? propQuestions
    : order
      ? buildRoleQuestions(order, role || 'ks')
      : []

  const checks = (review?.checks || []).filter((item) => item.verdict !== 'done' && item.verdict !== 'skip')
  const diffs = (review?.diffs || []).filter((item) => item.verdict !== 'done' && item.verdict !== 'skip')

  const effectiveSummary =
    summary ||
    order?.copilot_summary ||
    review?.summary ||
    (order
      ? `Заказ ${order.code} (${order.customer}): статус «${order.status_label}». Открытых черновиков ИИ: ${pendingFindings.length}, вопросов к службе: ${activeQuestions.length}.`
      : '')

  const openDiffsCount = (order?.diffs || []).filter((d) => d.status !== 'closed').length
  const approvedDocsCount = (order?.documents || []).filter((d) => d.approved).length

  const handleAnswerSubmit = (): void => {
    if (!onRunCopilot) return
    const nonEmpty: Record<string, string> = {}
    for (const [k, v] of Object.entries(answers)) {
      if (v.trim()) nonEmpty[k] = v.trim()
    }
    onRunCopilot({
      answers: Object.keys(nonEmpty).length ? nonEmpty : undefined,
      message: message.trim() || undefined,
      auto_prepare: true,
      use_ai: true
    })
    setSentAnswers(nonEmpty)
    setAnswers({})
    setMessage('')
  }

  const answerChecks = Object.entries(ai?.answer_checks || {}).filter(([field]) => field in sentAnswers || !Object.keys(sentAnswers).length)

  return (
    <section className="eo-window eo-window-work eo-copilot" aria-label="ИИ-помощник и авто-проверка">
      <div className="eo-copilot-head">
        <div>
          <span className="eo-now-kicker">
            Встроенный ИИ-помощник (Smart Copilot){roleLabel || ROLE_NAME[role] ? ` · ${roleLabel || ROLE_NAME[role]}` : ''}
          </span>
          <h3>Авто-диагностика, черновики (HITL) и интерактивный опрос</h3>
        </div>
        <div className="eo-actions">
          {onRunCopilot ? (
            <button
              type="button"
              className="eo-btn is-primary"
              disabled={busy}
              onClick={() => onRunCopilot({ auto_prepare: true, use_ai: true })}
            >
              {busy ? 'ИИ готовит карточку…' : 'Авто-подготовка с ИИ'}
            </button>
          ) : null}
          {onAcceptAllFindings && rolePendingFindings.length > 0 ? (
            <button
              type="button"
              className="eo-btn is-accent"
              disabled={busy}
              onClick={() => runAccept('', () => onAcceptAllFindings?.())}
            >
              Принять всё по моей службе ({rolePendingFindings.length})
            </button>
          ) : null}
          {onOpenFullAgent ? (
            <button
              type="button"
              className="eo-btn"
              disabled={busy}
              onClick={() => onOpenFullAgent(message.trim() || undefined)}
            >
              Полный диалог с ИИ-агентом
            </button>
          ) : null}
        </div>
      </div>
      {acceptError?.id === '' ? <p className="eo-error">{acceptError.text}</p> : null}

      {busy ? (
        <ol className="eo-ai-steps" aria-live="polite">
          {BUSY_STEPS.map((step, index) => (
            <li key={step} className={index < progress ? 'is-done' : index === progress ? 'is-active' : ''}>
              {step}
            </li>
          ))}
        </ol>
      ) : ai?.used ? (
        <p className={ai.ok ? 'eo-ai-note' : 'eo-error'}>
          {ai.ok
            ? ai.filled.length
              ? `ИИ заполнил черновиками ${ai.filled.length} полей. Они отмечены цветом ИИ во вкладке «Поля моей службы» и ниже в предложениях.`
              : 'ИИ прочитал дело, но значений для пустых полей не нашёл. Вопросы по ним — в опросе ниже.'
            : `ИИ не ответил: ${ai.error}. Показаны черновики авто-проверки без ИИ.`}
        </p>
      ) : null}

      {/* Блок 1: Авто-диагностика этапа */}
      <div className="eo-copilot-block">
        <div className="eo-copilot-block-head">
          <strong>1. Авто-диагностика этапа</strong>
          {stagePassport ? (
            <span className={`eo-tag ${stagePassport.blocker ? 'is-stop' : 'is-ok'}`}>
              Чек-лист этапа: {stagePassport.checks_done}/{stagePassport.checks_total}
            </span>
          ) : null}
        </div>
        {effectiveSummary ? <p className="eo-copilot-summary">{effectiveSummary}</p> : null}
        {log.length > 0 ? (
          <div className="eo-copilot-log">
            {log.map((line, index) => (
              <span key={index} className="eo-tag">{line}</span>
            ))}
          </div>
        ) : null}
        {order ? (
          <div className="eo-copilot-metrics">
            <div className="eo-copilot-metric">
              <small>Цепочка 1С</small>
              <b>{order.path_label || order.onec_number || (order.onec_tkp_key ? 'ТКП привязано' : 'Не привязана')}</b>
            </div>
            <div className="eo-copilot-metric">
              <small>Файлы дела</small>
              <b>{order.documents.length} док. (утв. {approvedDocsCount})</b>
            </div>
            <div className="eo-copilot-metric">
              <small>Сверка B01–B35</small>
              <b>{openDiffsCount ? `${openDiffsCount} расхождений` : 'Без расхождений'}</b>
            </div>
            <div className="eo-copilot-metric">
              <small>Блокер перехода</small>
              <b className={stagePassport?.blocker || order.blocks?.[0] ? 'is-danger' : ''}>
                {stagePassport?.blocker || order.blocks?.[0] || 'Переход открыт'}
              </b>
            </div>
          </div>
        ) : null}
      </div>

      {/* Блок 2: Предложения ИИ и авто-проверки (HITL) */}
      <div className="eo-copilot-block">
        <div className="eo-copilot-block-head">
          <strong>2. Предложения ИИ и авто-проверки ({pendingFindings.length})</strong>
          <div className="eo-kind-tabs">
            <button
              type="button"
              className={findingFilter === 'role' ? 'is-active' : ''}
              onClick={() => setFindingFilter('role')}
            >
              Моей службы ({rolePendingFindings.length})
            </button>
            <button
              type="button"
              className={findingFilter === 'all' ? 'is-active' : ''}
              onClick={() => setFindingFilter('all')}
            >
              Все черновики ({pendingFindings.length})
            </button>
            <button
              type="button"
              className={findingFilter === 'accepted' ? 'is-active' : ''}
              onClick={() => setFindingFilter('accepted')}
            >
              Принятые ({acceptedFindings.length})
            </button>
          </div>
        </div>

        {displayedFindings.length === 0 ? (
          <p className="eo-muted">
            {findingFilter === 'accepted'
              ? 'Принятых предложений пока нет.'
              : 'Нет ожидающих черновиков. Нажмите «Авто-подготовка и проверка», чтобы извлечь данные из файлов дела и 1С.'}
          </p>
        ) : (
          <div className="eo-hitl-grid">
            {displayedFindings.map((finding) => {
              const draft1c = parseDraft1cFinding(finding)
              const byAi = finding.filled_by === 'ai'
              const canAct =
                finding.status !== 'accepted' &&
                (byAi
                  ? finding.owner_role === role
                  : !role ||
                    finding.owner_role === role ||
                    role === 'ks' ||
                    role === 'rp' ||
                    role === 'committee' ||
                    role === 'it')
              return (
                <article
                  key={finding.id}
                  className={`eo-hitl-card${finding.status === 'accepted' ? ' is-accepted' : ''}${byAi ? ' is-ai' : ''}`}
                >
                  <div className="eo-hitl-card-top">
                    <span className="eo-tag">{findingCategoryLabel(finding)}</span>
                    <span className="eo-muted">
                      {finding.owner_label || ROLE_NAME[finding.owner_role] || finding.owner_role}
                    </span>
                    {byAi ? <span className="eo-ai-badge">ИИ{aiConfidenceLabel(finding.confidence)}</span> : null}
                    <span className={`eo-status ${finding.status === 'accepted' ? 'is-ok' : ''}`}>
                      {finding.status === 'accepted' ? 'принято' : byAi ? 'черновик ИИ' : 'черновик авто-проверки'}
                    </span>
                  </div>
                  <strong className="eo-hitl-title">{humanFindingLabel(finding)}</strong>
                  <div className="eo-hitl-value">{formatFindingValue(finding)}</div>
                  <small className="eo-muted">
                    Источник: {finding.source_ref || 'авто-проверка'}
                    {finding.location ? (byAi ? ` · «${finding.location}»` : ` (${finding.location})`) : ''}
                    {finding.proposed_by ? ` · ${finding.proposed_by}` : ''}
                  </small>
                  {byAi && finding.status !== 'accepted' && !canAct ? (
                    <small className="eo-muted">Принимает {finding.owner_label || ROLE_NAME[finding.owner_role] || 'владелец раздела'}</small>
                  ) : null}
                  {acceptError?.id === finding.id ? <p className="eo-error">{acceptError.text}</p> : null}
                  <div className="eo-actions eo-hitl-actions">
                    {finding.status !== 'accepted' && onAcceptFinding && canAct ? (
                      <button
                        type="button"
                        className="eo-btn is-primary"
                        disabled={busy}
                        onClick={() => runAccept(finding.id, () => onAcceptFinding?.(finding.id))}
                      >
                        Принять
                      </button>
                    ) : null}
                    {finding.status !== 'accepted' && onRejectFinding && canAct ? (
                      <button
                        type="button"
                        className="eo-btn"
                        disabled={busy}
                        onClick={() => onRejectFinding(finding.id)}
                      >
                        Отклонить
                      </button>
                    ) : null}
                    {draft1c && onOpenDocflow ? (
                      <button
                        type="button"
                        className="eo-btn is-accent"
                        onClick={() =>
                          onOpenDocflow(draft1c.kind, {
                            title: draft1c.title,
                            text: draft1c.text,
                            values: draft1c.values
                          })
                        }
                      >
                        Открыть создание в 1С ДО
                      </button>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        )}

        {onOpenDocflow && order ? (
          <div className="eo-actions eo-docflow-bar">
            <span className="eo-muted">Быстрое создание в 1С ДО по заказу {order.code}:</span>
            <button
              type="button"
              className="eo-btn"
              onClick={() =>
                onOpenDocflow('memo', {
                  title: `СЗ по внешнему заказу ${order.code} (${order.customer})`,
                  text: `По заказу ${order.code} «${order.product}» для ${order.customer} (этап: ${order.stage_label}, статус: ${order.status_label}).`
                })
              }
            >
              Создать СЗ в 1С ДО
            </button>
            <button
              type="button"
              className="eo-btn"
              onClick={() =>
                onOpenDocflow('assignment', {
                  title: `Поручение по заказу ${order.code} (${order.customer})`,
                  text: `Прошу выполнить работы этапа «${order.stage_label}» по заказу ${order.code} (${order.product}).`
                })
              }
            >
              Создать поручение в 1С ДО
            </button>
            <button
              type="button"
              className="eo-btn"
              onClick={() =>
                onOpenDocflow('directive', {
                  title: `Распоряжение о запуске по заказу ${order.code}`,
                  text: `Основание: заказ ${order.code}, заказчик ${order.customer}, продукция ${order.product}.`
                })
              }
            >
              Создать распоряжение в 1С ДО
            </button>
          </div>
        ) : null}
      </div>

      {/* Блок 3: Интерактивный опрос по недостающим данным */}
      <div className="eo-copilot-block">
        <div className="eo-copilot-block-head">
          <strong>3. Интерактивный опрос по недостающим данным ({activeQuestions.length})</strong>
          <span className="eo-muted">Ответы сразу записываются в поля раздела, чек-листы или закрывают пробелы</span>
        </div>
        {answerChecks.length ? (
          <div className="eo-answer-checks">
            <span className="eo-now-kicker">ИИ проверил ответы</span>
            {answerChecks.map(([field, check]) => (
              <div key={field} className={`eo-answer-check${check.ok ? ' is-ok' : ' is-warn'}`}>
                <b>{questionLabel(order, field)}</b>
                <span>{check.ok ? 'Сходится с делом' : 'Нужно уточнить'}{check.note ? ` · ${check.note}` : ''}</span>
                {check.followup ? <span className="eo-answer-followup">Уточнение: {check.followup}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        {activeQuestions.length > 0 ? (
          <div className="eo-qa-list">
            {activeQuestions.map((q) => (
              <div key={q.id} className={`eo-qa-item${q.ai_question || q.ai_suggestion ? ' has-ai' : ''}`}>
                <div className="eo-qa-label">
                  <span>{q.ai_question || q.prompt}</span>
                  {q.ai_why ? <small className="eo-qa-why">Зачем: {q.ai_why}</small> : null}
                  <small className="eo-muted">{q.owner_label}</small>
                </div>
                <div className="eo-qa-answer">
                  <input
                    value={answers[q.id] ?? ''}
                    placeholder={q.placeholder || 'Введите значение…'}
                    onChange={(event) => setAnswers((prev) => ({ ...prev, [q.id]: event.target.value }))}
                  />
                  {q.ai_suggestion ? (
                    <button
                      type="button"
                      className="eo-ai-suggest"
                      title={q.ai_suggestion_source ? `Источник: ${q.ai_suggestion_source}` : undefined}
                      onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: q.ai_suggestion || '' }))}
                    >
                      <span className="eo-ai-badge">ИИ</span> {q.ai_suggestion}
                      {q.ai_suggestion_source ? <small> · {q.ai_suggestion_source}</small> : null}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="eo-muted">Все обязательные поля и пункты текущей службы заполнены.</p>
        )}
        {onRunCopilot ? (
          <div className="eo-qa-submit">
            <input
              value={message}
              placeholder="Уточнение, комментарий или вопрос ИИ-помощнику по этапу…"
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleAnswerSubmit()
                }
              }}
            />
            <button
              type="button"
              className="eo-btn is-primary"
              disabled={busy}
              onClick={handleAnswerSubmit}
            >
              {busy ? 'Сохранение…' : 'Записать ответы и обновить'}
            </button>
          </div>
        ) : null}
      </div>

      {/* Дополнительная сводка из review при наличии */}
      {checks.length > 0 || diffs.length > 0 ? (
        <div className="eo-copilot-block">
          <strong>Сводка замечаний проверки</strong>
          {checks.length ? (
            <div className="eo-form">
              {checks.slice(0, 6).map((item) => (
                <article key={item.id} className="eo-check">
                  <span>
                    {item.text}
                    <br />
                    <small className="eo-muted">
                      {item.owner_label}. {item.note}
                    </small>
                  </span>
                  <span className="eo-tag is-stop">{VERDICT[item.verdict] || item.verdict}</span>
                </article>
              ))}
            </div>
          ) : null}
          {diffs.length ? (
            <table className="eo-table">
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Сверка</th>
                  <th>Владелец</th>
                  <th>Вердикт</th>
                </tr>
              </thead>
              <tbody>
                {diffs.slice(0, 6).map((item) => (
                  <tr key={item.code}>
                    <td>{item.code}</td>
                    <td>{item.title}</td>
                    <td>{item.owner_label}</td>
                    <td>
                      <span className="eo-tag is-stop">{VERDICT[item.verdict] || item.verdict}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
