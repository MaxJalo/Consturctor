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

function factLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => text(item, 220)).filter(Boolean).slice(0, 8)
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
      code: text(payload.code, 40),
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
