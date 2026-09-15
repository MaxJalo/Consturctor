import type { TodayAgentResultItem } from '../../workplace/useTodayAgentResults'
import type { TodayPreparedDecision } from './todayDemoData'

export const AGENT_DECISION_ACTION_FALLBACK = 'Проверить подготовленные агентом документы'

const VERB_FIRST_RE =
  /^(Утвердить|Согласовать|Проверить|Подписать|Ознакомиться|Принять|Отклонить|Уточнить|Обсудить|Выбрать|Направить|Сверить|Закрыть)\b/u

const TITLE_STOP_WORDS = new Set([
  'утвердить',
  'согласовать',
  'подписать',
  'проверить',
  'для',
  'по',
  'из',
  'на',
  'и',
  'в',
  'с',
  'о',
  'об',
  'этап',
  'работ'
])

function normalizeHaystack(value: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/\.(pdf|docx?|xlsx?|csv|pptx|md|txt)$/i, '')
    .replace(/[_\-–—]+/g, ' ')
    .replace(/[«»"'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleTokens(title: string): string[] {
  const norm = normalizeHaystack(title)
  return norm
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length >= 4 && !TITLE_STOP_WORDS.has(w))
}

export function isAgentPreparedDecision(decision: TodayPreparedDecision): boolean {
  const tag = (decision.tag || '').trim().toLowerCase()
  return tag === 'ии' || tag === 'ai' || tag.includes('агент')
}

function ensureVerbFirst(text: string, defaultVerb: string): string {
  const trimmed = (text || '').trim().replace(/\s+/g, ' ')
  if (!trimmed) return AGENT_DECISION_ACTION_FALLBACK
  if (VERB_FIRST_RE.test(trimmed)) return trimmed
  const rest = trimmed.charAt(0).toLowerCase() + trimmed.slice(1)
  return `${defaultVerb} ${rest}`
}

function humanTopicFromFileName(name: string): string {
  const base = normalizeHaystack(name.split(/[/\\]/).pop() || name)
  if (!base) return 'документ'
  if (base.length <= 48) return base
  return `${base.slice(0, 45).trim()}…`
}

function heuristicFromText(haystack: string): string | null {
  const h = haystack.toLowerCase()
  if (/бюджет|budget/.test(h)) {
    return /отч[её]т|report/.test(h) ? 'Согласовать отчёт по бюджету' : 'Проверить расчёт бюджета'
  }
  if (/поставщ|vendor|supplier/.test(h)) return 'Утвердить выбор поставщика'
  if (/договор|контракт|contract/.test(h)) return 'Согласовать договор'
  if (/акт\b|act_/.test(h)) return 'Подписать акт выполненных работ'
  if (/crm/.test(h)) return 'Согласовать изменения по CRM'
  if (/протокол|meeting|совещ/.test(h)) return 'Ознакомиться с протоколом совещания'
  if (/отч[её]т|report|аналит/.test(h)) return 'Проверить отчёт агента'
  if (/соглас|approval/.test(h)) return 'Согласовать подготовленные материалы'
  if (/утверж|approve/.test(h)) return 'Утвердить предложение агента'
  return null
}

function summaryFromAgentFile(file: TodayAgentResultItem): string | null {
  const summary = (file.summary || '').trim()
  if (summary) {
    const fromSummary = heuristicFromText(summary) || summary
    return ensureVerbFirst(fromSummary, 'Проверить')
  }
  const agentTitle = (file.agentTitle || '').trim()
  if (agentTitle) {
    const fromAgent = heuristicFromText(agentTitle)
    if (fromAgent) return fromAgent
    return ensureVerbFirst(agentTitle, 'Проверить')
  }
  const fromName = heuristicFromText(normalizeHaystack(file.name))
  if (fromName) return fromName
  return `Проверить ${humanTopicFromFileName(file.name)}`
}

export function agentActionSummaryFromFiles(files: TodayAgentResultItem[]): string {
  if (!files.length) return AGENT_DECISION_ACTION_FALLBACK
  const primary = files[0]
  return summaryFromAgentFile(primary) || AGENT_DECISION_ACTION_FALLBACK
}

export function matchAgentFilesToDecision(
  files: TodayAgentResultItem[],
  decision: TodayPreparedDecision
): TodayAgentResultItem[] {
  if (!files.length) return []
  const tokens = titleTokens(decision.title)
  if (!tokens.length) return []

  const scored = files
    .map((file) => {
      const hay = normalizeHaystack(`${file.name} ${file.agentTitle || ''} ${file.summary || ''}`)
      let score = 0
      for (const token of tokens) {
        if (hay.includes(token)) score += 1
      }
      return { file, score }
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)

  if (!scored.length) return []
  const top = scored[0].score
  return scored.filter((row) => row.score === top).map((row) => row.file)
}

export function agentActionSummaryForDecision(
  decision: TodayPreparedDecision,
  agentFiles: TodayAgentResultItem[],
  reservedFileIds: Set<string>
): string | null {
  if (!isAgentPreparedDecision(decision)) return null

  const available = agentFiles.filter((f) => !reservedFileIds.has(f.id))
  const matched = matchAgentFilesToDecision(available, decision)
  const pool = matched.length ? matched : available

  if (!pool.length) {
    const fromTitle = heuristicFromText(normalizeHaystack(decision.title))
    if (fromTitle) return fromTitle
    return AGENT_DECISION_ACTION_FALLBACK
  }

  for (const file of pool) reservedFileIds.add(file.id)
  return agentActionSummaryFromFiles(pool)
}

/** Подзаголовок для строки «Решения» из полей инструмента (без demo-эвристик по заголовку). */
export function subtitleFromToolDecision(item: {
  intent: string
  result: string
  title: string
  status: string
}): string {
  const result = (item.result || '').trim()
  if ((item.status === 'confirmed' || item.status === 'done') && result) {
    return ensureVerbFirst(result, 'Выполнено')
  }
  if (item.status === 'rejected') {
    return result || 'Вернуть на доработку'
  }
  const intent = (item.intent || '').trim()
  if (intent) return ensureVerbFirst(intent, 'Подтвердить')
  return ensureVerbFirst(item.title, 'Подтвердить')
}

export function subtitleFromAgentResultFile(file: TodayAgentResultItem): string {
  return summaryFromAgentFile(file) || AGENT_DECISION_ACTION_FALLBACK
}

export function buildTodayDecisionAgentSummaries(
  decisions: TodayPreparedDecision[],
  agentFiles: TodayAgentResultItem[]
): Record<string, string> {
  const reserved = new Set<string>()
  const out: Record<string, string> = {}
  for (const decision of decisions) {
    const line = agentActionSummaryForDecision(decision, agentFiles, reserved)
    if (line) out[decision.id] = line
  }
  return out
}
