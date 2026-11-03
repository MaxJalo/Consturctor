import type { FeedItem } from '../components/agentfeed/types'

export interface OrderCaseBrief {
  code: string
  customer: string
  product: string
  summary: string
  facts: string[]
  questions: string[]
  proposalCount: number
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
    checks,
    blocker: input.blocker.trim(),
    error: ''
  }
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
    const done = stage?.checks_done
    const total = stage?.checks_total
    const checks = done != null && total != null ? `Чек-лист ${done} из ${total}` : ''
    const proposals = payload.proposals
    const proposalCount = Array.isArray(proposals)
      ? proposals.length
      : Number(payload.proposals_count || 0) || 0
    const brief: OrderCaseBrief = {
      code: text(payload.code, 40),
      customer: text(payload.customer, 120),
      product: text(payload.product, 160),
      summary: text(payload.summary, 700),
      facts: factLines(payload.facts || payload.known),
      questions: questionLines(payload.questions),
      proposalCount,
      checks,
      blocker: text(stage?.blocker || payload.blocker, 180),
      error: ''
    }
    if (brief.summary || brief.facts.length || brief.questions.length) return brief
  }
  return failure
}

const NOISE = /unboundlocalerror|traceback|work_result|tests:\s*pass|сначала\s*(сниму|открою|посмотрю)|дочитыва|сводка\s+короткая|подготовка\s+оборвал|беру\s+карточку|вызываю\s+подготовк|инструменты\s+constructor|инструменты\s+подключены|если ответа нет ни в деле|ход мыслей в чат|первый ход:/i
const SDK_DEAD = /cursor sdk не отвечает/i

/** Внутренняя подсказка агенту, а не реплика сотрудника. */
export function isOrderPrompt(text: string): boolean {
  return /первый ход:|external_order\.case|если ответа нет ни в деле|ход мыслей в чат не писать|шаблоны, один ход/i.test(text || '')
}

/** Что показать в чате вместо сырого отказа SDK и текста инструкции. */
export function employeeDialogText(text: string, code: string): string {
  const value = (text || '').trim()
  if (SDK_DEAD.test(value)) {
    return 'Модель Cursor сейчас недоступна. Сводка выше собрана по карточке, без модели.'
  }
  if (isOrderPrompt(value)) return code ? `Разбор заказа ${code}` : 'Разбор заказа'
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
