import { useState } from 'react'
import type { FeedItem } from '../components/agentfeed/types'
import type { ServiceGap } from './agentChat'

export function offersFromFeed(items: FeedItem[]): Record<string, string[]> {
  const offers: Record<string, string[]> = {}
  for (const item of items) {
    if (item.kind !== 'tool' || !item.result) continue
    const raw = item.result.offers
    if (!Array.isArray(raw)) continue
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue
      const record = row as { id?: unknown; options?: unknown }
      const id = String(record.id || '')
      if (!id || !Array.isArray(record.options)) continue
      offers[id] = record.options.map((option) => String(option || '').trim()).filter(Boolean)
    }
  }
  return offers
}

export function gapsFromFeed(items: FeedItem[]): ServiceGap[] | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item.kind !== 'tool' || !item.result) continue
    const raw = item.result.questions
    if (!Array.isArray(raw) || raw.length === 0) continue
    const gaps: ServiceGap[] = []
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue
      const record = row as { id?: unknown; field?: unknown; prompt?: unknown }
      const id = String(record.id || '')
      const prompt = String(record.prompt || '').trim()
      if (!id || !prompt) continue
      gaps.push({ id, field: String(record.field || id), prompt })
    }
    if (gaps.length) return gaps
  }
  return null
}

function askSentence(text: string): string {
  const clean = text.trim().replace(/\.+$/, '')
  if (!clean) return 'Этот пункт ещё не подтверждён.'
  return clean.endsWith('?') ? clean : `${clean}?`
}

/** Старые формулировки с «пунктом чек-листа» показываем как обычный вопрос. */
export function spokenGap(prompt: string): string {
  const text = prompt.trim()
  const checklist = text.match(/^Подтвердите пункт(?: чек-листа)?(?:\s*\([^)]*\))?:\s*«(.+?)»\.?$/)
  if (checklist) return askSentence(checklist[1])
  const named = text.match(/^Подтвердите пункт «(.+?)»(?:\s*\([^)]*\))?\.?$/)
  if (named) return askSentence(named[1])
  const gap = text.match(/^Закройте пробел(?: по полю)? «[^»]*»:\s*(.+)$/)
  if (gap && gap[1].trim()) return gap[1].trim()
  const field = text.match(/^Укажите «([^»]+)» в разделе «[^»]+»\.?$/)
  if (field) return `Укажите ${field[1].toLowerCase()}.`
  return text
}

export function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result || '')
      const comma = raw.indexOf(',')
      resolve(comma >= 0 ? raw.slice(comma + 1) : raw)
    }
    reader.onerror = () => reject(reader.error || new Error('Файл не прочитан'))
    reader.readAsDataURL(file)
  })
}

interface ServiceGapPanelProps {
  gaps: ServiceGap[]
  offers: Record<string, string[]>
  batchReady: boolean
  accepted: boolean
  busy: boolean
  note: string
  onAnswer: (questionId: string, value: string, file: File | null) => void
  onAccept: () => void
}

export function ServiceGapPanel({
  gaps,
  offers,
  batchReady,
  accepted,
  busy,
  note,
  onAnswer,
  onAccept
}: ServiceGapPanelProps): React.JSX.Element | null {
  if (!gaps.length && !batchReady) return null
  return (
    <section className="oad-gaps" aria-label="Пробелы службы">
      {gaps.map((gap) => (
        <GapRow
          key={gap.id}
          gap={gap}
          options={offers[gap.id] || []}
          busy={busy}
          onAnswer={onAnswer}
        />
      ))}
      {batchReady ? (
        <div className="oad-gap-accept">
          <p>Черновик собран из ответов. Фактом он станет после принятия.</p>
          <button type="button" className="is-primary" disabled={busy || accepted} onClick={onAccept}>
            {accepted ? 'Черновик принят' : 'Принять'}
          </button>
        </div>
      ) : null}
      {note ? <p className="oad-gap-note">{note}</p> : null}
    </section>
  )
}

function GapRow({
  gap,
  options,
  busy,
  onAnswer
}: {
  gap: ServiceGap
  options: string[]
  busy: boolean
  onAnswer: (questionId: string, value: string, file: File | null) => void
}): React.JSX.Element {
  const [custom, setCustom] = useState('')
  const [file, setFile] = useState<File | null>(null)

  return (
    <article className="oad-gap">
      <p className="oad-gap-ask">{spokenGap(gap.prompt)}</p>
      {options.length > 0 ? (
        <>
          <p className="oad-gap-offer">Я предлагаю:</p>
          <div className="oad-gap-options">
            {options.map((option) => (
              <button
                key={option}
                type="button"
                disabled={busy}
                onClick={() => onAnswer(gap.id, option, file)}
              >
                {option}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <div className="oad-gap-own">
        <input
          value={custom}
          placeholder="Напишите сами"
          aria-label={`Свой ответ: ${spokenGap(gap.prompt)}`}
          disabled={busy}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            const text = custom.trim()
            if (!text) return
            onAnswer(gap.id, text, file)
          }}
        />
        <button
          type="button"
          disabled={busy || !custom.trim()}
          onClick={() => onAnswer(gap.id, custom.trim(), file)}
        >
          Ответить
        </button>
      </div>
      <label className="oad-gap-file">
        <span>{file ? file.name : 'Приложить документ'}</span>
        <input
          type="file"
          accept=".docx,.xlsx,.pdf,application/pdf"
          disabled={busy}
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
      </label>
    </article>
  )
}
