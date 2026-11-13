import type { FeedItem } from '../components/agentfeed/types'

export interface CaseLine {
  label: string
  value: string
}

export interface CaseDraft extends CaseLine {
  id: string
}

export interface OrderCaseBrief {
  code: string
  customer: string
  product: string
  summary: string
  facts: string[]
  questions: string[]
  proposalCount: number
  filled: CaseLine[]
  drafts: CaseDraft[]
  otherDrafts: number
  checks: string
  blocker: string
  error: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function text(value: unknown, limit = 500): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  return raw.length > limit ? `${raw.slice(0, limit - 1)}…` : raw
}

function documentCode(payload: Record<string, unknown>): string {
  const tkp = text(payload.onec_tkp_number, 64)
  const sale = text(payload.onec_order_number || payload.onec_number, 64)
  if (tkp && sale && tkp !== sale) return text(`${tkp} · ${sale}`, 80)
  return sale || tkp || text(payload.code, 40)
}

function isBlankOnecDate(value: string): boolean {
  return /0001-01-01|01\.01\.0001/.test(value)
}

function factLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => text(item, 220)).filter((item) => item && !isBlankOnecDate(item)).slice(0, 8)
  }
  const raw = text(value, 2500)
  if (!raw || /^пусто:/i.test(raw)) return []
  return raw
    .split(/\s*;\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8)
}

function namedLines(value: unknown): CaseLine[] {
  if (!Array.isArray(value)) return []
  const rows: CaseLine[] = []
  for (const item of value) {
    const row = asRecord(item)
    if (!row) continue
    const label = text(row.label, 120)
    const fieldValue = text(row.value, 200)
    if (!label && !fieldValue) continue
    rows.push({ label: label || 'Поле', value: fieldValue })
    if (rows.length >= 12) break
  }
  return rows
}

function draftLines(value: unknown): CaseDraft[] {
  if (!Array.isArray(value)) return []
  const rows: CaseDraft[] = []
  for (const item of value) {
    const row = asRecord(item)
    if (!row) continue
    if (row.status && text(row.status, 20) !== 'draft') continue
    const label = text(row.label, 120)
    const fieldValue = text(row.value, 200)
    if (!label && !fieldValue) continue
    rows.push({ id: text(row.id, 80), label: label || 'Поле', value: fieldValue })
    if (rows.length >= 12) break
  }
  return rows
}

function questionLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const lines: string[] = []
  for (const item of value) {
    if (lines.length >= 3) break
    if (typeof item === 'string' && item.trim()) lines.push(text(item, 180))
    else {
      const row = asRecord(item)
      const prompt = text(row?.prompt || row?.question, 180)
      if (prompt) lines.push(prompt)
    }
  }
  return lines
}

function casePayload(result: Record<string, unknown>): Record<string, unknown> {
  const nested = asRecord(result.summary)
  if (nested && (nested.summary || nested.facts || nested.known || nested.code)) {
    return { ...result, ...nested }
  }
  return result
}

function humanToolError(summary: string): string {
  const raw = (summary || '').trim()
  if (/unboundlocalerror|cannot access local variable/i.test(raw)) {
    return 'Сервер оборвал чтение карточки. Запустите разбор ещё раз.'
  }
  const line = raw.split('\n').find((part) => part.trim()) || 'Карточка не открылась.'
  return line.length > 180 ? `${line.slice(0, 179)}…` : line
}

/** Сводка из карточки, которая уже открыта. Не ждёт агента, Cursor и 1С. */
export function briefFromLoadedOrder(input: {
  code: string
  customer: string
  product: string
  stageLabel: string
  checksDone: number
  checksTotal: number
  blocker: string
  draftCount: number
  pathLabel: string
  paymentNote: string
  openChecks: string[]
  filled?: CaseLine[]
  drafts?: CaseDraft[]
  otherDrafts?: number
}): OrderCaseBrief {
  const checks = input.checksTotal > 0 ? `Чек-лист ${input.checksDone} из ${input.checksTotal}` : ''
  const path = input.pathLabel.trim()
  const payment = input.paymentNote.trim()
  const summary = [
    `Заказ ${input.code} (${input.customer} — ${input.product}), этап «${input.stageLabel}».`,
    checks,
    input.draftCount > 0 ? `Черновиков к принятию: ${input.draftCount}.` : '',
    path ? `Путь 1С: ${path}.` : 'Путь 1С в карточке ещё не записан.',
    payment,
    input.blocker.trim()
  ]
    .filter(Boolean)
    .join(' ')
  return {
    code: input.code,
    customer: input.customer,
    product: input.product,
    summary,
    facts: [path, payment].filter(Boolean).slice(0, 8),
    questions: input.openChecks.map((item) => item.trim()).filter(Boolean).slice(0, 3),
    proposalCount: input.draftCount,
    filled: input.filled || [],
    drafts: input.drafts || [],
    otherDrafts: input.otherDrafts || 0,
    checks,
    blocker: input.blocker.trim(),
    error: ''
  }
}

/** Старая сводка: каталог счётчиков и нумерованный список чужих вопросов. */
export function isCatalogDump(value: string): boolean {
  return /вопросов на уточнение|вопросы:\s*\d+\./i.test(value || '')
}

export function readableOrderSummary(input: {
  raw: string
  facts: string[]
  stageLabel: string
  checksDone: number | null
  checksTotal: number | null
  blocker: string
  proposalCount: number
  roleDrafts: number | null
}): string {
  const raw = input.raw || ''
  const service = /Служба:\s*([^.\n]+)/i.exec(raw)?.[1]?.trim() || ''
  const draftMatch = /Черновиков к принятию:\s*(\d+)/i.exec(raw)
  const roleMatch = /по вашей службе:\s*(\d+)/i.exec(raw)
  const stageMatch = /этап «([^»]+)»/i.exec(raw)
  const checksMatch = /чек-лист этапа\s*(\d+)\s*\/\s*(\d+)/i.exec(raw)
  const drafts = draftMatch ? Number(draftMatch[1]) : input.proposalCount
  const roleDrafts = roleMatch ? Number(roleMatch[1]) : input.roleDrafts
  const stageLabel = input.stageLabel || stageMatch?.[1] || ''
  const done = input.checksDone ?? (checksMatch ? Number(checksMatch[1]) : null)
  const total = input.checksTotal ?? (checksMatch ? Number(checksMatch[2]) : null)
  const bits = input.facts
    .filter((line) => !/^путь 1с/i.test(line))
    .slice(0, 8)
    .map((line) => {
      const split = line.indexOf(':')
      if (split < 0) return line.replace(/\.$/, '')
      const label = line.slice(0, split).trim()
      const value = line.slice(split + 1).trim().replace(/\.$/, '')
      if (!label || !value) return line
      return `${label.charAt(0).toLowerCase()}${label.slice(1)} ${value}`
    })
  const paragraphs: string[] = []
  if (bits.length) {
    paragraphs.push(`${service ? `По службе ${service} ` : ''}уже есть ${bits.join(', ')}.`)
  }
  if (stageLabel && done != null && total != null) {
    const blocker = input.blocker.trim()
    paragraphs.push(
      `Этап «${stageLabel}»: чек-лист ${done} из ${total}. ${blocker || 'Блокировок этапа нет.'}`
    )
  }
  if (drafts > 0) {
    paragraphs.push(
      `К принятию ${drafts} черновиков${roleDrafts != null ? `, по вашей службе ${roleDrafts}` : ''}.`
    )
  }
  if (isCatalogDump(raw)) {
    paragraphs.push('По вашей службе пустых полей нет. Открытые пункты ведут другие службы.')
  }
  return paragraphs.join('\n\n') || raw
}

export function latestOrderCase(items: FeedItem[]): OrderCaseBrief | null {
  let failure: OrderCaseBrief | null = null
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind !== 'tool' || !/external_order\.case/i.test(item.tool)) continue
    if (!item.done) continue
    if (item.error) {
      if (!failure) {
        failure = {
          code: '',
          customer: '',
          product: '',
          summary: '',
          facts: [],
          questions: [],
          proposalCount: 0,
          filled: [],
          drafts: [],
          otherDrafts: 0,
          checks: '',
          blocker: '',
          error: humanToolError(item.summary)
        }
      }
      continue
    }
    const payload = item.result ? casePayload(item.result) : null
    if (!payload) continue
    const stage = asRecord(payload.stage)
    const done = typeof stage?.checks_done === 'number' ? stage.checks_done : null
    const total = typeof stage?.checks_total === 'number' ? stage.checks_total : null
    const checks = done != null && total != null ? `Чек-лист ${done} из ${total}` : ''
    const proposals = payload.proposals
    const rawSummary = typeof payload.summary === 'string' ? payload.summary : ''
    const countedDrafts = Number(/Черновиков к принятию:\s*(\d+)/i.exec(rawSummary)?.[1] || 0)
    const proposalCount = Math.max(
      Number(payload.proposals_count || 0),
      countedDrafts,
      Array.isArray(proposals) ? proposals.length : 0
    )
    const facts = factLines(payload.facts || payload.known)
    const blocker = text(stage?.blocker || payload.blocker, 180)
    const summary = readableOrderSummary({
      raw: rawSummary,
      facts,
      stageLabel: text(stage?.label, 80),
      checksDone: done,
      checksTotal: total,
      blocker,
      proposalCount,
      roleDrafts:
        payload.role_proposals_count == null ? null : Number(payload.role_proposals_count)
    })
    const brief: OrderCaseBrief = {
      code: documentCode(payload),
      customer: text(payload.customer, 120),
      product: text(payload.product, 160),
      summary,
      facts,
      questions: isCatalogDump(rawSummary) ? [] : questionLines(payload.questions),
      proposalCount,
      filled: namedLines(payload.filled),
      drafts: draftLines(payload.drafts),
      otherDrafts: Number(payload.other_drafts || 0),
      checks,
      blocker,
      error: ''
    }
    if (brief.summary || brief.facts.length || brief.questions.length || brief.filled.length || brief.drafts.length) {
      return brief
    }
  }
  return failure
}

const NOISE = /unboundlocalerror|traceback|work_result|tests:\s*pass|сначала\s*(сниму|открою|посмотрю)|дочитыва|сводка\s+короткая|подготовка\s+оборвал|беру\s+карточку|вызываю\s+подготовк|инструменты\s+constructor|инструменты\s+подключены|если ответа нет ни в деле|ход мыслей в чат|первый ход:/i
const SDK_DEAD = /cursor sdk не отвечает/i

/** Уже открытый разговор не перезапускаем. Новый сценарий по файлам — отдельный ход. */
export function orderTurnAlreadyOpen(message: string, historyCount: number): boolean {
  if (historyCount <= 0) return false
  return !/сценарий дела:/i.test(message || '')
}

/** Внутренняя подсказка агенту, а не реплика сотрудника. */
export function isOrderPrompt(text: string): boolean {
  return /первый ход:|первый вызов:|external_order\.case|если ответа нет ни в деле|ход мыслей в чат не писать|шаблоны, один ход|сценарий дела:|order_id=|один read_full|итог скрипта уже получен/i.test(
    text || ''
  )
}

/** Разбор, который модель расписала как ход работы, а не как итог. */
export function isWorkLog(value: string): boolean {
  return /сводка по пункту дела|граница факта|document_excerpts|один read_full/i.test(value || '')
}

export function workLogOutcome(value: string): string {
  const letter = /письм/i.test(value)
  const noFiles = /файлов в деле нет|документов в деле 0/i.test(value)
  if (letter && noFiles) {
    return 'Письмо заказчику. Проект по файлам дела не из чего собрать: файлов нет и связей нет. Положите в дело файл основания и запросите проект снова. В карточку ничего не записано и никому не отправлено.'
  }
  if (noFiles) {
    return 'По файлам дела считать нечего: файлов и связей нет. Положите файл основания и запустите сценарий снова.'
  }
  return value
}

export function factAlreadySaid(summary: string, fact: string): boolean {
  const folded = summary.toLowerCase().replace(/\s+/g, ' ')
  const raw = fact.trim()
  if (!raw) return true
  if (folded.includes(raw.toLowerCase())) return true
  const value = (raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw).trim().replace(/\.$/, '')
  return value.length > 3 && folded.includes(value.toLowerCase())
}

/** Убирает пустую дату 1С и вторую фразу про тот же факт. */
const PROCESS_LINE =
  /^(?:вызов вернул|ищу сводк|ищу снимок|карточка(?: в этом ходе)? уже открыта|смотрю,?\s+какие факты|следующий шаг|сейчас передам|дело уже открыто|данные получены)\b/i
const GAP_LINE =
  /пусты[ейяю]|зафиксированных ответов|подтвержд[её]нных ответов|открыты\s+\S+\s+пункт|четыре пустых пункта|нет ни цены|пока эти пункты пустые|ответов на проверки|^(?:нужно подтвердить|сотруднику нужно подтвердить|подтвердите эти)\b/i

/** Ход работы и пересказ «пропуски есть» в чат не попадают: пропуски уже на вкладке «Вопросы». */
export function dropOrderGapTalk(value: string): string {
  const kept = (value || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const folded = line.toLowerCase().replace(/ё/g, 'е')
      return !PROCESS_LINE.test(folded) && !GAP_LINE.test(folded)
    })
  return kept.join('\n\n').trim()
}

export function collapseRepeatedOrderAnswer(value: string): string {
  const kept: string[] = []
  let saidNoOrder = false
  let saidDate = false
  for (const raw of value.split('\n')) {
    const line = raw.trim()
    if (!line) {
      if (kept.length && kept[kept.length - 1] !== '') kept.push('')
      continue
    }
    if (isBlankOnecDate(line)) continue
    const folded = line.toLowerCase().replace(/^[\s•\-*]+/, '')
    if (/заказ\w* клиент/.test(folded) && /нет|отсутств/.test(folded)) {
      if (saidNoOrder) continue
      saidNoOrder = true
    }
    if (/тот же срок/.test(folded)) continue
    if (/дата не заполнена/.test(folded) && saidDate) continue
    if (/\d{2}\.\d{2}\.\d{4}/.test(folded) || /срок/.test(folded)) saidDate = true
    const plain = folded.replace(/[.«»"—–-]/g, '').replace(/\s+/g, ' ')
    if (kept.some((item) => item.toLowerCase().replace(/\s+/g, ' ').includes(plain) && plain.length > 24)) continue
    kept.push(line)
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function plainOrderText(value: string): string {
  return (value || '').replace(/[*_`#]/g, '').replace(/\s+/g, '').toLowerCase()
}

/** Две реплики одного хода говорят одно и то же. */
export function orderTextsRepeat(left: string, right: string): boolean {
  const a = plainOrderText(left)
  const b = plainOrderText(right)
  if (a.length < 40 || b.length < 40) return false
  if (a.includes(b) || b.includes(a)) return true
  const size = Math.min(80, a.length, b.length)
  return a.slice(0, size) === b.slice(0, size)
}

const MODEL_SILENT = 'Модель Cursor не ответила. Разбор заказа можно повторить.'

const CONNECTION_LOST =
  /не удалось связаться с cursor|сеть оборвалась|network request failed|cursor sdk run failed/i

const LOST_ORDER_ANSWER =
  /cursor sdk не отвечает|без итога|модель cursor сейчас недоступна|модель cursor не ответила|ответ не получен/i

const CARD_STUB =
  /^реквизиты уже на карточке\.\s*ниже пункты, которые служба ещ[её] не закрыла\.?$/i

const cardBriefs = new Map<string, OrderCaseBrief>()

/** Сводка карточки на этот разговор: повторное открытие диалога не начинает с пустого поля. */
export function rememberCardBrief(conversationKey: string, brief: OrderCaseBrief | null | undefined): void {
  const key = (conversationKey || '').trim()
  if (!key || !(brief?.summary || '').trim()) return
  cardBriefs.set(key, brief)
}

export function cardBriefFor(conversationKey: string): OrderCaseBrief | null {
  return cardBriefs.get((conversationKey || '').trim()) ?? null
}

/** Короткая сводка из реквизитов заказа, если полная карточка в этот заход не приложена. */
export function briefFromChatOrder(order: {
  code: string
  customer: string
  product: string
  stageLabel: string
  blockers: string[]
}): OrderCaseBrief {
  return briefFromLoadedOrder({
    code: order.code,
    customer: order.customer,
    product: order.product,
    stageLabel: order.stageLabel,
    checksDone: 0,
    checksTotal: 0,
    blocker: order.blockers.find((item) => item.trim()) || '',
    draftCount: 0,
    pathLabel: '',
    paymentNote: '',
    openChecks: order.blockers.map((item) => item.trim()).filter(Boolean).slice(0, 3)
  })
}

/** Обрыв связи оставляем как есть. Пустой ход без текста модели — сводка карточки и строка про модель. */
export function recoverLostOrderAnswer(text: string, brief: OrderCaseBrief | null): string {
  const value = (text || '').trim()
  const spoken = employeeDialogText(value, brief?.code || '')
  const summary = (brief?.summary || '').trim()
  if (CONNECTION_LOST.test(value) || CONNECTION_LOST.test(spoken)) {
    if (!summary || spoken.includes(summary)) return spoken
    return `${spoken}\n\n${summary}`
  }
  const lost = LOST_ORDER_ANSWER.test(value) || LOST_ORDER_ANSWER.test(spoken) || CARD_STUB.test(spoken)
  if (!lost) return spoken
  if (!summary) return MODEL_SILENT
  if (spoken.includes(MODEL_SILENT) && spoken.includes(summary)) return spoken
  return `${MODEL_SILENT}\n\n${summary}`
}

/** Что показать в чате вместо сырого отказа SDK и текста инструкции. */
export function employeeDialogText(text: string, code: string): string {
  const value = (text || '').trim()
  if (SDK_DEAD.test(value)) {
    return 'Модель Cursor сейчас недоступна. Сводка выше собрана по карточке, без модели.'
  }
  if (isOrderPrompt(value)) {
    const scenario = /Сценарий дела:\s*([^\n(]+)/i.exec(value)?.[1]?.trim()
    if (scenario) return scenario
    return code ? `Разбор заказа ${code}` : 'Разбор заказа'
  }
  return text
}

/** Plan, tool catalog and raw server errors are not the employee's summary. */
export function isOrderNoise(text: string): boolean {
  const value = (text || '').trim()
  if (!value) return true
  if (NOISE.test(value)) return true
  if (value.length < 48 && !value.includes('?')) return true
  return false
}
