import { useState } from 'react'
import { api } from '../../api/client'
import type { UserProfile } from '../../api/types'
import { runDocflowAction, type DocflowUiAction } from '../../workplace/taskSourceActions'
import type { TaskActionContext } from '../../workplace/taskSourceKind'
import { defaultReworkDue, type AgentDocflowAction } from './docflowActions'

type RowState = { busy?: string; message?: string; error?: boolean; done?: boolean }

let profile: Promise<UserProfile> | null = null

function currentUser(): Promise<UserProfile> {
  profile ??= api.me(8_000).catch((err) => {
    profile = null
    throw err
  })
  return profile
}

function contextOf(item: AgentDocflowAction): TaskActionContext {
  return {
    kind: 'docflow',
    rowId: item.taskId,
    title: item.title,
    refKey: item.taskId,
    step: item.step,
    taskName: item.title,
    targetId: item.targetId
  }
}

export function DocflowActionRow({
  item,
  bare = false
}: {
  item: AgentDocflowAction
  /** Без шапки «поручение, пункт»: строка уже стоит под мероприятием. */
  bare?: boolean
}): React.JSX.Element {
  const [state, setState] = useState<RowState>({})
  const [rework, setRework] = useState(false)
  const [comment, setComment] = useState(item.comment || (item.action === 'return' ? item.reason : ''))
  const [due, setDue] = useState(defaultReworkDue())

  const run = async (label: string, action: DocflowUiAction, note = '', nextDue = ''): Promise<void> => {
    setState({ busy: label })
    try {
      const user = await currentUser()
      const result = await runDocflowAction(user, contextOf(item), action, note, nextDue)
      const done = action !== 'open_card' && result.ok
      setState({ message: result.message, error: !result.ok, done })
      if (done) setRework(false)
    } catch (err) {
      setState({ message: err instanceof Error ? err.message : 'Действие не выполнено', error: true })
    }
  }

  const busy = Boolean(state.busy)
  const recommendClose = item.action === 'close'
  return (
    <li className={`docflow-action-row${state.done ? ' done' : ''}${bare ? ' bare' : ''}`}>
      <div className="docflow-action-head">
        {bare ? null : (
          <strong>
            {item.assignment}
            {item.line ? `, п.${item.line}` : ''}
          </strong>
        )}
        {item.performer && !bare ? <span className="docflow-action-performer">{item.performer}</span> : null}
        <span className={`docflow-action-advice ${recommendClose ? 'close' : 'return'}`}>
          {recommendClose ? 'Агент предлагает закрыть' : 'Агент предлагает вернуть'}
        </span>
      </div>
      {item.event && !bare ? <div className="docflow-action-event">{item.event}</div> : null}
      {item.reason ? <div className="docflow-action-reason">{item.reason}</div> : null}
      {state.done ? null : rework ? (
        <div className="docflow-action-form">
          <textarea
            rows={2}
            value={comment}
            disabled={busy}
            placeholder="Что доработать исполнителю"
            onChange={(event) => setComment(event.target.value)}
          />
          <label>
            Новый срок
            <input type="date" value={due} disabled={busy} onChange={(event) => setDue(event.target.value)} />
          </label>
          <div className="docflow-action-buttons">
            <button
              type="button"
              className="closure-btn danger"
              disabled={busy || !comment.trim() || !due}
              onClick={() => void run('return', 'return', comment, due)}
            >
              {state.busy === 'return' ? 'Отправляем…' : 'Вернуть на доработку'}
            </button>
            <button type="button" className="closure-btn" disabled={busy} onClick={() => setRework(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="docflow-action-buttons">
          <button
            type="button"
            className={`closure-btn${recommendClose ? ' primary' : ''}`}
            disabled={busy}
            onClick={() => void run('close', 'close')}
          >
            {state.busy === 'close' ? 'Отправляем…' : 'Закрыть'}
          </button>
          <button
            type="button"
            className={`closure-btn${recommendClose ? '' : ' danger'}`}
            disabled={busy}
            onClick={() => setRework(true)}
          >
            Вернуть
          </button>
          <button
            type="button"
            className="closure-btn ghost"
            disabled={busy}
            onClick={() => void run('card', 'open_card')}
          >
            Карточка
          </button>
        </div>
      )}
      {state.message ? (
        <div className={`docflow-action-message${state.error ? ' error' : ''}`}>{state.message}</div>
      ) : null}
    </li>
  )
}

/** Задача ещё у исполнителя: автор может закрыть мероприятие без его отчёта. */
export function DocflowWaitingRow({
  taskId,
  performer = '',
  sharedLines = []
}: {
  taskId: string
  performer?: string
  /** Пункты поручения с той же задачей ДО: закрытие одного закроет все. */
  sharedLines?: Array<string | number>
}): React.JSX.Element {
  const [state, setState] = useState<RowState>({})
  const [confirming, setConfirming] = useState(false)
  const [comment, setComment] = useState('')
  const busy = Boolean(state.busy)
  const ctx: TaskActionContext = { kind: 'docflow', rowId: taskId, title: '', refKey: taskId }

  const run = async (label: string, action: DocflowUiAction, note = ''): Promise<void> => {
    setState({ busy: label })
    try {
      const user = await currentUser()
      const result = await runDocflowAction(user, ctx, action, note)
      const done = action !== 'open_card' && result.ok
      setState(action === 'open_card' && result.ok ? {} : { message: result.message, error: !result.ok, done })
      if (done) setConfirming(false)
    } catch (err) {
      setState({ message: err instanceof Error ? err.message : 'Действие не выполнено', error: true })
    }
  }

  return (
    <li className={`docflow-action-row bare waiting${state.done ? ' done' : ''}`}>
      {state.done ? null : confirming ? (
        <div className="docflow-action-form">
          <div className="docflow-action-reason">
            Задача исполнителя{performer ? ` (${performer})` : ''} будет выполнена от вашего имени, исполнение — принято.
            {sharedLines.length > 1
              ? `В Документообороте это одна задача на пункты ${sharedLines.map((n) => `п.${n}`).join(', ')} — закроются все они.`
              : 'Мероприятие станет закрытым.'}
          </div>
          <textarea
            rows={2}
            value={comment}
            disabled={busy}
            placeholder="Комментарий (необязательно): почему закрываете без отчёта"
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="docflow-action-buttons">
            <button
              type="button"
              className="closure-btn primary"
              disabled={busy}
              onClick={() => void run('close', 'close_without_report', comment)}
            >
              {state.busy === 'close' ? 'Закрываем…' : 'Закрыть мероприятие'}
            </button>
            <button type="button" className="closure-btn" disabled={busy} onClick={() => setConfirming(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="docflow-action-buttons">
          <button
            type="button"
            className="closure-btn"
            disabled={busy || !taskId}
            title={taskId ? 'Закрыть задачу исполнителя и принять исполнение' : 'Нет UID задачи — запустите проверку заново'}
            onClick={() => setConfirming(true)}
          >
            Закрыть без отчёта
          </button>
          {taskId ? (
            <button type="button" className="closure-btn ghost" disabled={busy} onClick={() => void run('card', 'open_card')}>
              {state.busy === 'card' ? 'Открываем…' : 'Карточка'}
            </button>
          ) : null}
          <span className="docflow-action-wait">исполнитель ещё не отчитался в ДО</span>
        </div>
      )}
      {state.message ? (
        <div className={`docflow-action-message${state.error ? ' error' : ''}`}>{state.message}</div>
      ) : null}
    </li>
  )
}

export function DocflowActionsBlock({ actions }: { actions: AgentDocflowAction[] }): React.JSX.Element | null {
  if (!actions.length) return null
  return (
    <section className="docflow-actions">
      <h4>Задачи в 1С:Документооборот — решение за вами</h4>
      <ul>
        {actions.map((item) => (
          <DocflowActionRow key={`${item.taskId}:${item.line}`} item={item} />
        ))}
      </ul>
    </section>
  )
}
