import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Building2, GraduationCap, HardHat, Monitor, Wrench } from 'lucide-react'
import type { UserProfile } from '../../api/types'
import { formatCorrespondenceDate } from '../../workplace/fetchDocflowCorrespondence'
import {
  loadServiceRequestPage,
  SERVICE_REQUESTS,
  type ServiceRequestId,
  type ServiceRequestOption,
  type ServiceRequestRow
} from '../../workplace/fetchDocflowServiceRequests'
import type { DocflowKindId } from '../../workplace/docflowDocumentCreate'
import { DocflowOpenFormBar } from './DocflowOpenFormBar'
import { DocflowSearch, SortTh, useDocflowTable } from './docflowTableTools'

const ICONS = {
  service_1c: Wrench,
  service_it: Monitor,
  service_exploitation: HardHat,
  service_development: GraduationCap,
  service_aho: Building2
} as const

function cell(value: string): string {
  return value.trim() || '—'
}

function when(value: string): string {
  if (!value.trim()) return '—'
  return formatCorrespondenceDate(value)
}

function mark(value: boolean): string {
  return value ? '✓' : ''
}

function statusTone(code: string): string {
  if (code === 'Исполнен') return 'is-done'
  if (code === 'НаИсполнении' || code === 'НаСогласовании') return 'is-work'
  if (code === 'Отклонено' || code === 'Отменен' || code === 'Аннулирован') return 'is-stop'
  return 'is-draft'
}

function cellClass(key: string): string | undefined {
  if (key === 'confirmed') return 'docflow-check'
  if (key === 'kind' || key === 'resolution' || key === 'organization' || key === 'executor') return 'is-wide'
  if (key === 'status') return 'is-status'
  return undefined
}

type Column = {
  key: string
  label: string
  value: (row: ServiceRequestRow) => string
  title?: (row: ServiceRequestRow) => string
}

const COLUMNS: Record<ServiceRequestId, Column[]> = {
  service_1c: [
    { key: 'number', label: 'Номер', value: (row) => cell(row.number) },
    { key: 'date', label: 'Дата', value: (row) => when(row.date) },
    { key: 'responsible', label: 'Автор', value: (row) => cell(row.responsible) },
    { key: 'department', label: 'Подразделение', value: (row) => cell(row.department) },
    { key: 'kind', label: 'Вид заявки', value: (row) => cell(row.kind), title: (row) => row.kindPath },
    { key: 'status', label: 'Статус', value: (row) => cell(row.status) },
    { key: 'executor', label: 'Фактический исполнитель', value: (row) => cell(row.executor) },
    { key: 'resolution', label: 'Резолюция', value: (row) => cell(row.resolution) },
    { key: 'acceptedAt', label: 'Дата принятия', value: (row) => when(row.acceptedAt) },
    { key: 'due', label: 'Срок исполнения', value: (row) => when(row.due) },
    { key: 'doneAt', label: 'Дата исполнения', value: (row) => when(row.doneAt) },
    { key: 'confirmed', label: 'Испол.', value: (row) => mark(row.confirmed) },
    { key: 'organization', label: 'Организация', value: (row) => cell(row.organization) }
  ],
  service_it: [
    { key: 'number', label: 'Номер', value: (row) => cell(row.number) },
    { key: 'date', label: 'Дата', value: (row) => when(row.date) },
    { key: 'responsible', label: 'Автор', value: (row) => cell(row.responsible) },
    { key: 'department', label: 'Подразделение', value: (row) => cell(row.department) },
    { key: 'kind', label: 'Вид заявки', value: (row) => cell(row.kind), title: (row) => row.kindPath },
    { key: 'status', label: 'Статус', value: (row) => cell(row.status) },
    { key: 'hours', label: 'Время выполнения (в часах)', value: (row) => cell(row.hours) },
    { key: 'executor', label: 'Фактический исполнитель', value: (row) => cell(row.executor) },
    { key: 'resolution', label: 'Резолюция', value: (row) => cell(row.resolution) },
    { key: 'acceptedAt', label: 'Дата принятия', value: (row) => when(row.acceptedAt) },
    { key: 'doneAt', label: 'Дата исполнения', value: (row) => when(row.doneAt) },
    { key: 'confirmed', label: 'Подтверждение об исполнении', value: (row) => mark(row.confirmed) },
    { key: 'organization', label: 'Организация', value: (row) => cell(row.organization) }
  ],
  service_exploitation: [
    { key: 'number', label: 'Номер', value: (row) => cell(row.number) },
    { key: 'date', label: 'Дата', value: (row) => when(row.date) },
    { key: 'responsible', label: 'Автор', value: (row) => cell(row.responsible) },
    { key: 'kind', label: 'Вид заявки', value: (row) => cell(row.kind), title: (row) => row.kindPath },
    { key: 'status', label: 'Статус', value: (row) => cell(row.status) },
    { key: 'executor', label: 'Фактический исполнитель', value: (row) => cell(row.executor) },
    { key: 'plannedAt', label: 'Дата исполнения (план)', value: (row) => when(row.plannedAt) },
    { key: 'doneAt', label: 'Дата исполнения (факт)', value: (row) => when(row.doneAt) },
    { key: 'confirmed', label: 'Исполнение подтверждено', value: (row) => mark(row.confirmed) }
  ],
  service_development: [
    { key: 'number', label: 'Номер', value: (row) => cell(row.number) },
    { key: 'date', label: 'Дата', value: (row) => when(row.date) },
    { key: 'responsible', label: 'Автор', value: (row) => cell(row.responsible) },
    { key: 'department', label: 'Подразделение', value: (row) => cell(row.department) },
    { key: 'kind', label: 'Вид заявки', value: (row) => cell(row.kind), title: (row) => row.kindPath },
    { key: 'status', label: 'Статус', value: (row) => cell(row.status) },
    { key: 'executor', label: 'Фактический исполнитель', value: (row) => cell(row.executor) },
    { key: 'resolution', label: 'Резолюция', value: (row) => cell(row.resolution) },
    { key: 'acceptedAt', label: 'Дата принятия', value: (row) => when(row.acceptedAt) },
    { key: 'plannedAt', label: 'Срок исполнения плановый', value: (row) => when(row.plannedAt) },
    { key: 'doneAt', label: 'Срок исполнения фактический', value: (row) => when(row.doneAt) },
    { key: 'confirmed', label: 'Испол.', value: (row) => mark(row.confirmed) }
  ],
  service_aho: [
    { key: 'date', label: 'Дата', value: (row) => when(row.date) },
    { key: 'number', label: 'Номер', value: (row) => cell(row.number) },
    { key: 'documentType', label: 'Тип документа', value: (row) => cell(row.documentType) },
    { key: 'kind', label: 'Вид заявки', value: (row) => cell(row.kind), title: (row) => row.kindPath },
    { key: 'status', label: 'Статус', value: (row) => cell(row.status) },
    { key: 'responsible', label: 'Автор', value: (row) => cell(row.responsible) },
    { key: 'organization', label: 'Организация', value: (row) => cell(row.organization) },
    { key: 'executorDepartment', label: 'Подразделение исполнитель', value: (row) => cell(row.executorDepartment) },
    { key: 'executor', label: 'Фактический исполнитель', value: (row) => cell(row.executor) },
    { key: 'confirmed', label: 'Подтверждение автора об исполнении', value: (row) => mark(row.confirmed) },
    { key: 'acceptedAt', label: 'Принято в обработку', value: (row) => when(row.acceptedAt) },
    { key: 'doneAt', label: 'Срок исполнения фактический', value: (row) => when(row.doneAt) }
  ]
}

function searchText(row: ServiceRequestRow): string {
  return [
    row.date,
    row.number,
    row.status,
    row.kind,
    row.kindPath,
    row.documentType,
    row.text,
    row.organization,
    row.responsible,
    row.department,
    row.executor,
    row.executorDepartment,
    row.resolution
  ].join(' ')
}

function sortValue(row: ServiceRequestRow, key: string): string {
  const column = Object.values(COLUMNS)
    .flat()
    .find((item) => item.key === key)
  if (key === 'date' || key.endsWith('At')) {
    const raw: Record<string, string> = {
      date: row.date,
      acceptedAt: row.acceptedAt,
      plannedAt: row.plannedAt,
      doneAt: row.doneAt,
      due: row.due
    }
    return raw[key] ?? ''
  }
  return column ? column.value(row) : ''
}

export function DocflowServiceRequestsPanel({
  user,
  from,
  to,
  reload,
  onOpenDocument
}: {
  user: UserProfile
  from: string
  to: string
  reload: number
  onOpenDocument?: (kind: DocflowKindId, refKey: string) => void
}): React.JSX.Element {
  const [service, setService] = useState<ServiceRequestId>('service_exploitation')
  const [rows, setRows] = useState<ServiceRequestRow[]>([])
  const [statuses, setStatuses] = useState<ServiceRequestOption[]>([])
  const [status, setStatus] = useState('')
  const [skip, setSkip] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)
  const generation = useRef(0)
  const active = SERVICE_REQUESTS.find((item) => item.id === service) || SERVICE_REQUESTS[2]

  const fetchPage = useCallback(
    (nextSkip: number, replace: boolean) => {
      if (!replace && loadingRef.current) return
      const ticket = replace ? ++generation.current : generation.current
      loadingRef.current = true
      setLoading(true)
      setError('')
      void loadServiceRequestPage(user, { service, from, to, skip: nextSkip, status })
        .then((page) => {
          if (ticket !== generation.current) return
          setRows((current) => (replace ? page.rows : [...current, ...page.rows]))
          setStatuses(page.statuses)
          setSkip(page.nextSkip)
          setHasMore(page.hasMore)
          if (replace) setSelectedId(page.rows[0]?.id || '')
        })
        .catch((err: unknown) => {
          if (ticket !== generation.current) return
          if (replace) setRows([])
          setHasMore(false)
          setError(err instanceof Error ? err.message : 'Не удалось прочитать заявки')
        })
        .finally(() => {
          if (ticket !== generation.current) return
          loadingRef.current = false
          setLoading(false)
        })
    },
    [user, service, from, to, status]
  )

  useEffect(() => {
    setRows([])
    setSkip(0)
    setHasMore(false)
    setSelectedId('')
    fetchPage(0, true)
  }, [fetchPage, reload])

  const table = useDocflowTable(rows, {
    text: searchText,
    value: sortValue,
    initialSort: { key: 'date', dir: 'desc' }
  })
  const visible = table.rows
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId])

  const onScroll = (): void => {
    const node = scrollRef.current
    if (!node || !hasMore || loadingRef.current) return
    if (node.scrollTop + node.clientHeight >= node.scrollHeight - 80) fetchPage(skip, false)
  }

  return (
    <div className="docflow-requests">
      <div className="docflow-kind" role="tablist" aria-label="Служба">
        {SERVICE_REQUESTS.map((item) => {
          const Icon = ICONS[item.id]
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={service === item.id}
              className={`docflow-kind-btn${service === item.id ? ' is-active' : ''}`}
              onClick={() => setService(item.id)}
            >
              <Icon size={18} aria-hidden />
              <span>
                <strong>{item.hint}</strong>
              </span>
            </button>
          )
        })}
      </div>
      <div className="docflow-table-card wp-card">
          <div className="docflow-request-head">
            <h2>{active.title}</h2>
            {selected ? (
              <DocflowOpenFormBar
                refKey={selected.id}
                hint="двойной щелчок по строке"
                onOpen={onOpenDocument && (() => onOpenDocument(selected.formKind, selected.id))}
              />
            ) : null}
          </div>
          <div className="docflow-order-filters">
            <DocflowSearch
              value={table.query}
              onChange={table.setQuery}
              placeholder="Номер, вид, автор, исполнитель…"
              found={visible.length}
              total={rows.length}
            />
            <label>
              Статус
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">Все</option>
                {statuses.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {loading && !rows.length ? <p className="docflow-status">Загружаем из 1С…</p> : null}
          {error ? <p className="docflow-status docflow-status-error">{error}</p> : null}
          {!loading && !error && !visible.length ? (
            <p className="docflow-status">За выбранные даты заявок нет. Расширьте период сверху.</p>
          ) : null}
          {visible.length ? (
            <div className="docflow-table-scroll" ref={scrollRef} onScroll={onScroll}>
              <table className="docflow-table">
                <thead>
                  <tr>
                    {COLUMNS[service].map((column) => (
                      <SortTh
                        key={column.key}
                        label={column.label}
                        sortKey={column.key}
                        sort={table.sort}
                        onSort={table.toggleSort}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr
                      key={row.id}
                      className={row.id === selectedId ? 'is-selected' : ''}
                      onClick={() => setSelectedId(row.id)}
                      onDoubleClick={() => onOpenDocument?.(row.formKind, row.id)}
                    >
                      {COLUMNS[service].map((column) => (
                        <td key={column.key} className={cellClass(column.key)} title={column.title?.(row) || undefined}>
                          {column.key === 'confirmed' ? (
                            <input type="checkbox" checked={row.confirmed} readOnly aria-label={column.label} />
                          ) : column.key === 'status' ? (
                            <span className={`docflow-req-status ${statusTone(row.statusCode)}`}>{column.value(row)}</span>
                          ) : (
                            column.value(row)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
      </div>
    </div>
  )
}
