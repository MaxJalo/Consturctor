import { useEffect, useMemo, useRef, useState } from 'react'
import type { UserProfile } from '../../api/types'
import { api } from '../../api/client'
import { invokeLocalAcTool } from '../../utils/localAcTool'
import type { ExternalOrder, PlanModel, PlanOutlineTask, PlanOverrides, PlanTask } from './externalOrderTypes'

type Busy = '' | 'mpp' | 'xml' | 'open' | 'download' | 'publish' | 'outline'
type Note = { text: string; tone: 'ok' | 'warn' }

const DAY_MS = 86_400_000
const ROW_H = 32
const HEAD_H = 40
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const SOURCE_CLASS: Record<string, string> = { дело: 'is-case', норматив: 'is-norm', вручную: 'is-manual' }

function dayIndex(value: string, origin: number): number {
  const ms = Date.parse(`${value.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(ms) ? 0 : Math.round((ms - origin) / DAY_MS)
}

function ruDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-')
  if (!y || !m || !d) return '—'
  return Number(y) < 1900 ? `${d}.${m}` : `${d}.${m}.${y}`
}

function showSummary(text: string): string {
  return text.replace(/\b(\d{2}\.\d{2})\.0001\b/g, '$1')
}

function errText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function isConditionRow(task: PlanTask): boolean {
  return task.group === 'conditions'
}

export function PlanBuilder({
  order,
  role,
  asRole,
  user,
  onOrder
}: {
  order: ExternalOrder
  role: string
  asRole: string
  user: UserProfile
  onOrder: (order: ExternalOrder) => void
}): React.JSX.Element {
  const [model, setModel] = useState<PlanModel | null>(null)
  const [overrides, setOverrides] = useState<PlanOverrides>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [start, setStart] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<Busy>('')
  const [error, setError] = useState('')
  const [note, setNote] = useState<Note | null>(null)
  const [focus, setFocus] = useState('')
  const [localPath, setLocalPath] = useState('')
  const rows = useRef<Record<string, HTMLTableRowElement | null>>({})
  const seq = useRef(0)
  const loaded = useRef(false)
  const previewGen = useRef(0)
  const canEdit = role !== 'viewer'
  const services = model?.all_resources?.length ? model.all_resources : model?.resources || []
  const planDoc = useMemo(
    () => [...(order.documents || [])].reverse().find((item) => item.kind === 'plan') || null,
    [order.documents]
  )

  useEffect(() => {
    const id = ++seq.current
    const gen = previewGen.current
    const delay = loaded.current ? 400 : 0
    if (loaded.current) setNote(null)
    const timer = setTimeout(() => {
      if (previewGen.current !== gen) return
      setLoading(true)
      setError('')
      api
        .previewExternalPlan(order.id, { overrides, start: start || undefined }, asRole)
        .then((next) => {
          loaded.current = true
          if (seq.current === id) setModel(next)
        })
        .catch((err) => {
          if (seq.current === id) setError(errText(err, 'План не проверен'))
        })
        .finally(() => {
          if (seq.current === id) setLoading(false)
        })
    }, delay)
    return () => clearTimeout(timer)
  }, [order.id, asRole, overrides, start])

  const scale = useMemo(() => {
    if (!model?.start || !model.finish) return null
    const origin = Date.parse(`${model.start.slice(0, 10)}T00:00:00Z`)
    const count = Math.max(1, dayIndex(model.finish, origin) + 1)
    const width = count > 240 ? 6 : count > 120 ? 10 : count > 60 ? 14 : 20
    const holidays = new Set(model.calendar?.holidays || [])
    const working = new Set(model.calendar?.working_weekends || [])
    const days = Array.from({ length: count }, (_, index) => {
      const date = new Date(origin + index * DAY_MS)
      const iso = date.toISOString().slice(0, 10)
      const weekday = date.getUTCDay()
      const off = holidays.has(iso) || ((weekday === 0 || weekday === 6) && !working.has(iso))
      return { iso, day: date.getUTCDate(), month: date.getUTCMonth(), year: date.getUTCFullYear(), off }
    })
    const months: { label: string; left: number; span: number }[] = []
    days.forEach((item, index) => {
      const last = months[months.length - 1]
      if (index === 0 || item.day === 1) {
        months.push({ label: `${MONTHS[item.month]} ${item.year}`, left: index, span: 1 })
      } else if (last) {
        last.span += 1
      }
    })
    return { origin, count, width, days, months }
  }, [model])

  function patchOverride(key: string, patch: { duration_days?: number; resource?: string }): void {
    setOverrides((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  function editDuration(task: PlanTask, value: string): void {
    setDrafts((prev) => ({ ...prev, [task.key]: value }))
    const days = Number(value.replace(',', '.'))
    if (value.trim() && Number.isFinite(days) && days >= 0) patchOverride(task.key, { duration_days: days })
  }

  function resetEdits(): void {
    setOverrides({})
    setDrafts({})
    setStart('')
    setNote(null)
  }

  function visibleStart(): string {
    if (start) return start
    const fromModel = model?.start?.slice(0, 10) || ''
    return Number(fromModel.slice(0, 4)) >= 1900 ? fromModel : ''
  }

  async function checkPlan(): Promise<void> {
    previewGen.current += 1
    const id = ++seq.current
    const when = visibleStart()
    setLoading(true)
    setError('')
    setNote(null)
    try {
      const next = await api.previewExternalPlan(
        order.id,
        { overrides, start: when || undefined },
        asRole
      )
      if (seq.current !== id) return
      loaded.current = true
      setModel(next)
      const warnings = next.warnings || []
      const stops = warnings.filter((item) => item.level === 'stop').length
      const warns = warnings.length - stops
      const range = `${ruDate(next.start)} – ${ruDate(next.finish)}`
      setNote(
        stops
          ? { text: `План проверен (${range}). Стоп-замечаний: ${stops}${warns ? `, предупреждений: ${warns}` : ''}.`, tone: 'warn' }
          : warns
            ? { text: `План проверен (${range}). Предупреждений: ${warns}, стоп-замечаний нет.`, tone: 'warn' }
            : { text: `План проверен (${range}). Замечаний нет.`, tone: 'ok' }
      )
    } catch (err) {
      if (seq.current === id) setError(errText(err, 'План не проверен'))
    } finally {
      if (seq.current === id) setLoading(false)
    }
  }

  function showRow(key: string): void {
    setFocus(key)
    rows.current[key]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  async function act(kind: Busy, action: () => Promise<void>, fallback: string): Promise<void> {
    setBusy(kind)
    setError('')
    setNote(null)
    try {
      await action()
    } catch (err) {
      setError(errText(err, fallback))
    } finally {
      setBusy('')
    }
  }

  async function saveXml(reason = ''): Promise<void> {
    const res = await api.buildExternalPlanFile(order.id, { overrides, start: start || undefined }, asRole)
    if (res.model) setModel(res.model)
    setLocalPath('')
    onOrder(await api.externalOrder(order.id, asRole))
    const missing = res.missing?.length ? ` В деле нет: ${res.missing.join(', ')}.` : ''
    setNote(
      reason
        ? { text: `.mpp не собран: ${reason}. Сохранён XML для Project.${missing}`, tone: 'warn' }
        : { text: `${res.summary || `Сохранён ${res.file_name || 'XML плана'}.`}${missing}`, tone: missing ? 'warn' : 'ok' }
    )
  }

  async function buildMpp(): Promise<void> {
    if (!model) return
    const fileName = `План работ ${model.code || order.code}.mpp`
    let reason = ''
    try {
      const res = await invokeLocalAcTool(
        'msproject.build_plan',
        { model, template_path: model.template_path, file_name: fileName },
        300_000,
        user
      )
      const out = res.result || {}
      if (!res.ok || out.ok === false || !out.content_base64) {
        throw new Error(res.error || String(out.error || '') || 'MS Project не вернул файл')
      }
      const next = await api.uploadExternalPlanMpp(
        order.id,
        { filename: String(out.file_name || fileName), content_base64: String(out.content_base64) },
        asRole
      )
      setLocalPath(String(out.path || ''))
      onOrder(next)
      setNote(
        out.template_used === false
          ? { text: `.mpp собран без шаблона: ${String(out.note || 'шаблон не найден')}`, tone: 'warn' }
          : { text: '.mpp собран по шаблону и положен в дело', tone: 'ok' }
      )
      return
    } catch (err) {
      reason = errText(err, 'MS Project недоступен')
    }
    await saveXml(reason)
  }

  async function openInProject(): Promise<void> {
    let res = localPath ? await invokeLocalAcTool('msproject.open_file', { path: localPath }, 120_000, user) : null
    if (!res?.ok) {
      if (!planDoc) throw new Error('В деле нет файла плана — сначала соберите .mpp или XML')
      const content = await api.externalFileBase64(order.id, planDoc.id)
      res = await invokeLocalAcTool(
        'msproject.open_file',
        { content_base64: content, file_name: planDoc.file_name || `План работ ${order.code}.xml` },
        120_000,
        user
      )
    }
    const out = res.result || {}
    if (!res.ok || out.ok === false) throw new Error(res.error || String(out.error || '') || 'MS Project не открыл файл')
    if (out.path) setLocalPath(String(out.path))
  }

  async function download(): Promise<void> {
    if (!planDoc) throw new Error('В деле нет файла плана')
    await api.download(
      `/api/v1/external-orders/${encodeURIComponent(order.id)}/files/${encodeURIComponent(planDoc.id)}`,
      planDoc.file_name || `План работ ${order.code}.xml`
    )
  }

  async function publish(): Promise<void> {
    const next = await api.publishExternalPlan(order.id, asRole)
    onOrder(next)
    if (next.project_note) setNote({ text: next.project_note, tone: 'warn' })
    else setNote({ text: 'План отправлен в TurboProject', tone: 'ok' })
  }

  async function refreshOutline(): Promise<void> {
    const res = await invokeLocalAcTool(
      'msproject.template_outline',
      { template_path: model?.template_path || '' },
      180_000,
      user
    )
    const out = res.result || {}
    const tasks = Array.isArray(out.tasks) ? (out.tasks as PlanOutlineTask[]) : []
    if (!res.ok || out.ok === false) throw new Error(res.error || String(out.error || '') || 'Шаблон не прочитан')
    if (!tasks.length) throw new Error('В шаблоне не найдено задач')
    const saved = await api.saveExternalPlanTemplate(tasks, asRole)
    previewGen.current += 1
    const id = ++seq.current
    const next = await api.previewExternalPlan(order.id, { overrides, start: start || undefined }, asRole)
    if (seq.current === id) {
      loaded.current = true
      setModel(next)
    }
    setNote({ text: `Структура обновлена из шаблона: ${saved.count ?? tasks.length} задач`, tone: 'ok' })
  }

  const tasks = model?.tasks || []
  const conditionState = new Map((model?.conditions || []).map((item) => [item.key, item]))
  const editedCount = Object.keys(overrides).length
  const stops = (model?.warnings || []).filter((item) => item.level === 'stop').length

  function renderBar(task: PlanTask): React.JSX.Element | null {
    if (!scale || isConditionRow(task) || !task.start) return null
    const from = dayIndex(task.start, scale.origin)
    const to = Math.max(from, dayIndex(task.finish || task.start, scale.origin))
    const left = from * scale.width
    const title = `${task.name}: ${ruDate(task.start)} – ${ruDate(task.finish)}`
    if (task.milestone) {
      return <span className="eo-plan-milestone" title={title} style={{ left: left + scale.width / 2 - 6 }} />
    }
    return (
      <span
        className={task.summary ? 'eo-plan-bar is-summary' : 'eo-plan-bar'}
        title={title}
        style={{ left, width: Math.max(scale.width, (to - from + 1) * scale.width) }}
      />
    )
  }

  return (
    <section className="eo-plan" aria-label="План работ MS Project">
      <div className="eo-plan-head">
        <div>
          <h3>План работ (MS Project)</h3>
          {model ? (
            <p className="eo-muted">
              {model.outline_source === 'template' ? 'Структура из шаблона' : 'Встроенная структура (шаблон не загружен)'}
              {' · '}
              {ruDate(model.start)} – {ruDate(model.finish)}
              {model.contract_number ? ` · договор ${model.contract_number}` : ''}
            </p>
          ) : (
            <p className="eo-muted">{loading ? 'Считаем план…' : 'План ещё не рассчитан.'}</p>
          )}
          {model?.summary ? <p className="eo-muted">{showSummary(model.summary)}</p> : null}
        </div>
        <div className="eo-actions">
          {canEdit ? (
            <label className="eo-plan-start">
              Старт
              <input
                type="date"
                value={start || (Number((model?.start || '').slice(0, 4)) >= 1900 ? model?.start?.slice(0, 10) : '') || ''}
                onChange={(event) => setStart(event.target.value)}
              />
            </label>
          ) : null}
          <button type="button" disabled={loading || Boolean(busy)} onClick={() => void checkPlan()}>
            {loading ? 'Проверка…' : 'Проверить план'}
          </button>
          {canEdit && (editedCount || start) ? (
            <button type="button" onClick={resetEdits}>Сбросить правки{editedCount ? ` (${editedCount})` : ''}</button>
          ) : null}
        </div>
      </div>

      {error ? <p className="eo-error">{error}</p> : null}
      {note ? <p className={note.tone === 'ok' ? 'eo-plan-note is-ok' : 'eo-plan-note'}>{note.text}</p> : null}

      {model?.warnings?.length ? (
        <ul className="eo-plan-warnings">
          {model.warnings.map((item, index) => (
            <li key={`${item.code}-${item.key || ''}-${index}`} className={item.level === 'stop' ? 'is-stop' : 'is-warn'}>
              {item.key ? (
                <button type="button" onClick={() => showRow(item.key || '')}>{item.text}</button>
              ) : (
                <span>{item.text}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {tasks.length ? (
        <div className="eo-plan-body">
          <div className="eo-plan-grid">
            <table className="eo-plan-table">
              <colgroup>
                <col className="wbs" />
                <col />
                <col className="service" />
                <col className="days" />
                <col className="date" />
                <col className="date" />
                <col className="source" />
              </colgroup>
              <thead>
                <tr style={{ height: HEAD_H }}>
                  <th>WBS</th>
                  <th>Задача</th>
                  <th>Служба</th>
                  <th title="Длительность, дни">Дни</th>
                  <th>Старт</th>
                  <th>Финиш</th>
                  <th>Источник срока</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const condition = isConditionRow(task)
                  const state = conditionState.get(task.key)
                  const resourceValue = overrides[task.key]?.resource ?? task.resource
                  const className = [
                    task.summary ? 'is-summary' : '',
                    condition ? 'is-condition' : '',
                    overrides[task.key] ? 'is-edited' : '',
                    focus === task.key ? 'is-focus' : ''
                  ].filter(Boolean).join(' ')
                  return (
                    <tr
                      key={task.key || task.uid}
                      ref={(node) => {
                        rows.current[task.key] = node
                      }}
                      className={className}
                      style={{ height: ROW_H }}
                    >
                      <td className="eo-plan-wbs">{task.wbs}</td>
                      <td className="eo-plan-name" title={task.notes || task.name}>
                        <span style={{ paddingLeft: Math.max(0, task.level - 1) * 14 }}>{task.name}</span>
                      </td>
                      {condition ? (
                        <td colSpan={5} className="eo-plan-cond" title={state?.value || task.notes}>
                          {state?.missing ? <span className="eo-plan-src is-missing">в деле нет</span> : null}
                          {state?.value || task.notes || '—'}
                        </td>
                      ) : (
                        <>
                          <td>
                            {task.editable && canEdit && services.length ? (
                              <select
                                value={resourceValue}
                                onChange={(event) => patchOverride(task.key, { resource: event.target.value })}
                              >
                                <option value="">—</option>
                                {services.map((item) => (
                                  <option key={item.key} value={item.key}>{item.name}</option>
                                ))}
                              </select>
                            ) : (
                              task.resource_name || '—'
                            )}
                          </td>
                          <td className="eo-plan-num">
                            {task.editable && canEdit && !task.summary ? (
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={drafts[task.key] ?? String(overrides[task.key]?.duration_days ?? task.duration_days)}
                                onChange={(event) => editDuration(task, event.target.value)}
                              />
                            ) : (
                              task.duration_days
                            )}
                          </td>
                          <td>{ruDate(task.start)}</td>
                          <td>{ruDate(task.finish)}</td>
                          <td>
                            {task.source ? (
                              <span className={`eo-plan-src ${SOURCE_CLASS[task.source] || ''}`}>{task.source}</span>
                            ) : null}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {scale ? (
            <div className="eo-plan-gantt">
              <div style={{ width: scale.count * scale.width, position: 'relative' }}>
                <div className="eo-plan-scale" style={{ height: HEAD_H }}>
                  {scale.months.map((item) => (
                    <span
                      key={`${item.label}-${item.left}`}
                      className="eo-plan-month"
                      style={{ left: item.left * scale.width, width: item.span * scale.width }}
                    >
                      {item.span * scale.width >= 40 ? item.label : ''}
                    </span>
                  ))}
                  {scale.width >= 14
                    ? scale.days.map((item, index) => (
                        <span
                          key={item.iso}
                          className={item.off ? 'eo-plan-day is-off' : 'eo-plan-day'}
                          style={{ left: index * scale.width, width: scale.width }}
                        >
                          {item.day}
                        </span>
                      ))
                    : null}
                </div>
                <div className="eo-plan-lanes" style={{ height: tasks.length * ROW_H }}>
                  {scale.days.map((item, index) =>
                    item.off ? (
                      <span key={item.iso} className="eo-plan-off" style={{ left: index * scale.width, width: scale.width }} />
                    ) : null
                  )}
                  {tasks.map((task, index) => (
                    <div
                      key={task.key || task.uid}
                      className={focus === task.key ? 'eo-plan-lane is-focus' : 'eo-plan-lane'}
                      style={{ top: index * ROW_H, height: ROW_H }}
                    >
                      {renderBar(task)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {canEdit ? (
        <div className="eo-plan-actions">
          <div className="eo-actions">
            <button
              type="button"
              className="is-primary"
              disabled={!model || Boolean(busy) || loading}
              title={stops ? 'В плане есть стоп-замечания' : undefined}
              onClick={() => void act('mpp', buildMpp, '.mpp не собран')}
            >
              {busy === 'mpp' ? 'Сборка .mpp…' : 'Собрать .mpp'}
            </button>
            <button type="button" disabled={!model || Boolean(busy)} onClick={() => void act('xml', () => saveXml(), 'XML не сохранён')}>
              {busy === 'xml' ? 'Сохранение…' : 'Сохранить XML'}
            </button>
            <button type="button" disabled={(!planDoc && !localPath) || Boolean(busy)} onClick={() => void act('open', openInProject, 'MS Project не открыл файл')}>
              {busy === 'open' ? 'Открытие…' : 'Открыть в MS Project'}
            </button>
            <button type="button" disabled={!planDoc || Boolean(busy)} onClick={() => void act('download', download, 'Файл не скачан')}>
              Скачать
            </button>
            {role === 'rp' ? (
              <button type="button" disabled={Boolean(busy)} onClick={() => void act('publish', publish, 'План не отправлен')}>
                {busy === 'publish' ? 'Отправка…' : 'Отправить в TurboProject'}
              </button>
            ) : null}
          </div>
          {role === 'rp' || role === 'it' ? (
            <button
              type="button"
              className="eo-plan-link"
              disabled={Boolean(busy)}
              onClick={() => void act('outline', refreshOutline, 'Структура не обновлена')}
            >
              {busy === 'outline' ? 'Читаем шаблон…' : 'Обновить структуру из шаблона'}
            </button>
          ) : null}
          {planDoc ? (
            <p className="eo-muted">
              В деле: {planDoc.file_name || planDoc.title}{planDoc.version ? ` · ${planDoc.version}` : ''}
              {planDoc.approved ? ' · утверждён' : ' · черновик'}
            </p>
          ) : null}
        </div>
      ) : null}
      {order.project_note && !note ? <p className="eo-muted">{order.project_note}</p> : null}
    </section>
  )
}
