import { useState } from 'react'
import { api } from '../../api/client'
import type { AgentChatContext } from '../../pages/agentChat'
import { ServiceGapPanel, readFileBase64 } from '../../pages/ServiceGapPanel'
import { briefFromChatOrder, cardBriefFor, factAlreadySaid } from '../../pages/orderCaseBrief'
import type { SessionEvent } from '../api/types'
import { gapsFromSessionEvents, liveCaseBriefFromEvents, offersFromSessionEvents } from './sessionHelpers'

interface OrderSidePaneProps {
  orderChat: AgentChatContext
  events: SessionEvent[]
}

export function OrderSidePane({ orderChat, events }: OrderSidePaneProps): React.JSX.Element {
  const [gapBatch, setGapBatch] = useState('')
  const [closedGaps, setClosedGaps] = useState<string[]>([])
  const [gapAccepted, setGapAccepted] = useState(false)
  const [gapBusy, setGapBusy] = useState(false)
  const [gapNote, setGapNote] = useState('')
  const [takenDrafts, setTakenDrafts] = useState<Record<string, 'busy' | 'done' | 'error'>>({})

  const stored = orderChat.caseBrief ?? cardBriefFor(orderChat.conversationKey) ?? briefFromChatOrder(orderChat.order)
  const caseBrief = liveCaseBriefFromEvents(events, stored)
  const offers = offersFromSessionEvents(events)
  const liveGaps = gapsFromSessionEvents(events)
  const gaps = (liveGaps ?? orderChat.gaps ?? []).filter((gap) => !closedGaps.includes(gap.id))

  const answerGap = async (questionId: string, value: string, file: File | null): Promise<void> => {
    if (gapBusy) return
    setGapBusy(true)
    setGapNote('')
    try {
      let documentId = ''
      if (file) {
        const content = await readFileBase64(file)
        const uploaded = await api.uploadExternalFile(
          orderChat.order.id,
          { kind: 'other', filename: file.name, content_base64: content },
          orderChat.order.role
        )
        const match = [...(uploaded.documents || [])]
          .reverse()
          .find((item) => item.file_name === file.name || item.title === file.name)
        documentId = match?.id || ''
      }
      const saved = await api.answerExternalGap(
        orderChat.order.id,
        { question_id: questionId, value, batch_id: gapBatch, document_id: documentId },
        orderChat.order.role
      )
      setGapBatch(String(saved.batch_id || gapBatch))
      setClosedGaps((prev) => (prev.includes(questionId) ? prev : [...prev, questionId]))
    } catch (err) {
      setGapNote(err instanceof Error ? err.message : 'Ответ не записан')
    } finally {
      setGapBusy(false)
    }
  }

  const acceptGapBatch = async (): Promise<void> => {
    if (!gapBatch || gapBusy) return
    setGapBusy(true)
    setGapNote('')
    try {
      await api.acceptExternalFindingBatch(orderChat.order.id, gapBatch, orderChat.order.role)
      setGapAccepted(true)
    } catch (err) {
      setGapNote(err instanceof Error ? err.message : 'Черновик не принят')
    } finally {
      setGapBusy(false)
    }
  }

  return (
    <div className="sess-order-pane">
      {caseBrief ? (
        <section className="oad-case" aria-label="Сводка дела">
          <div className="oad-case-title">
            {caseBrief.error ? 'Карточка не открылась' : caseBrief.code || 'Дело заказа'}
            {caseBrief.customer ? <span>{caseBrief.customer}</span> : null}
          </div>
          {caseBrief.error ? <p className="oad-case-error">{caseBrief.error}</p> : null}
          {caseBrief.product ? <p className="oad-case-product">{caseBrief.product}</p> : null}
          {caseBrief.checks || caseBrief.blocker ? (
            <p className="oad-case-meta">{[caseBrief.checks, caseBrief.blocker].filter(Boolean).join(' · ')}</p>
          ) : null}
          {caseBrief.filled.length > 0 ? (
            <>
              <p className="oad-case-meta">Уже заполнено</p>
              <ul className="oad-case-facts">
                {caseBrief.filled.map((item) => (
                  <li key={`${item.label}:${item.value}`}>
                    {item.label} — {item.value}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {caseBrief.drafts.length > 0 ? (
            <>
              <p className="oad-case-meta">Черновики</p>
              <ul className="oad-case-drafts">
                {caseBrief.drafts.map((draft) => {
                  const state = draft.id ? takenDrafts[draft.id] : undefined
                  return (
                    <li key={draft.id || `${draft.label}:${draft.value}`}>
                      <span>
                        {draft.label} — {draft.value}
                      </span>
                      {state === 'done' ? (
                        <em>записано в карточку</em>
                      ) : draft.id ? (
                        <button
                          type="button"
                          disabled={state === 'busy'}
                          onClick={() => {
                            setTakenDrafts((prev) => ({ ...prev, [draft.id]: 'busy' }))
                            void api
                              .acceptExternalFinding(orderChat.order.id, draft.id, orderChat.order.role)
                              .then(() => setTakenDrafts((prev) => ({ ...prev, [draft.id]: 'done' })))
                              .catch(() => setTakenDrafts((prev) => ({ ...prev, [draft.id]: 'error' })))
                          }}
                        >
                          {state === 'busy' ? 'Записываю…' : state === 'error' ? 'Повторить' : 'Принять'}
                        </button>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </>
          ) : caseBrief.proposalCount > 0 && !/принят/i.test(caseBrief.summary) ? (
            <p className="oad-case-meta">Черновиков к принятию: {caseBrief.proposalCount}</p>
          ) : null}
          {caseBrief.otherDrafts > 0 ? (
            <p className="oad-case-meta">
              Черновиков других служб: {caseBrief.otherDrafts}. Их принимает владелец раздела.
            </p>
          ) : null}
          {caseBrief.facts.some((fact) => !factAlreadySaid(caseBrief.summary, fact)) ? (
            <ul className="oad-case-facts">
              {caseBrief.facts
                .filter((fact) => !factAlreadySaid(caseBrief.summary, fact))
                .map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <ServiceGapPanel
        gaps={gaps}
        offers={offers}
        batchReady={Boolean(gapBatch)}
        accepted={gapAccepted}
        busy={gapBusy}
        note={gapNote}
        onAnswer={(questionId, value, file) => void answerGap(questionId, value, file)}
        onAccept={() => void acceptGapBatch()}
      />
      {!caseBrief && !gaps.length && !gapBatch ? (
        <p className="sess-note">Открытых вопросов и черновиков по этапу нет.</p>
      ) : null}
    </div>
  )
}
