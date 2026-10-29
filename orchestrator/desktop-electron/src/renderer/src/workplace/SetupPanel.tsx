import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadSession } from '../store/session'

type SetupSnapshot = Awaited<ReturnType<Window['api']['readSetup']>>
type SetupFile = SetupSnapshot['desktop']
type SetupField = SetupFile['fields'][number]
type SetupProbe = Awaited<ReturnType<Window['api']['probeSetup']>>
type SetupToolProbe = NonNullable<Awaited<ReturnType<Window['api']['probeSetupTools']>>['imap']>

type SidecarState = {
  ready: boolean
  starting: boolean
  queuedCommands: number
  error: string
  python: string
  desktopRoot: string
}

function groupsOf(fields: SetupField[]): { name: string; fields: SetupField[] }[] {
  const order: string[] = []
  const map = new Map<string, SetupField[]>()
  for (const field of fields) {
    const bucket = map.get(field.group)
    if (bucket) bucket.push(field)
    else {
      map.set(field.group, [field])
      order.push(field.group)
    }
  }
  return order.map((name) => ({ name, fields: map.get(name) || [] }))
}

function valuesOf(fields: SetupField[], edited: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of fields) out[field.key] = edited[field.key] ?? field.value
  return out
}

function toolLine(probe: SetupToolProbe | null, needsLogin: boolean): string {
  if (needsLogin) return 'нужен вход'
  if (!probe) return 'нет ответа'
  if (probe.error) return probe.error
  if (probe.configured) return `подключен · ${probe.mode || 'real'}`
  return 'не настроен'
}

type StatTone = 'idle' | 'ok' | 'warn' | 'bad'
type Point = { t: number; v: number }
type Metrics = Awaited<ReturnType<Window['api']['setupMetrics']>>
type TabId = 'overview' | 'server' | 'mail' | 'outlook' | 'onec' | 'helper' | 'keys'

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'server', label: 'Сервер' },
  { id: 'mail', label: 'Почта' },
  { id: 'outlook', label: 'Outlook' },
  { id: 'onec', label: '1С' },
  { id: 'helper', label: 'Помощник' },
  { id: 'keys', label: 'Ключи' }
]

const OUTLOOK_CODE: Record<string, { hex: string; level: 'warn' | 'error'; text: string }> = {
  '-2147221233': {
    hex: '8004010F',
    level: 'warn',
    text: 'Outlook не нашёл элемент календаря (8004010F). Чтение идёт другим способом.'
  },
  '-2147221021': {
    hex: '800401E3',
    level: 'warn',
    text: 'Outlook не отдал сессию (800401E3). Второй Outlook не запускаю: он рвёт Exchange.'
  },
  '-2147221227': {
    hex: '80040115',
    level: 'error',
    text: 'Exchange не ответил (80040115). Раньше это было пять минут ожидания. Откройте ящик в Outlook и повторите.'
  },
  '-2147221164': {
    hex: '80040154',
    level: 'error',
    text: 'Классический Outlook не зарегистрирован (80040154). Новый Outlook так не работает.'
  },
  '-2147221005': {
    hex: '800401F3',
    level: 'error',
    text: 'Имя программы Outlook не распознано (800401F3). Нужен классический Outlook.'
  },
  '-2147417846': {
    hex: '8001010A',
    level: 'warn',
    text: 'Outlook занят и просит повторить вызов позже (8001010A).'
  },
  '-2147418111': {
    hex: '80010001',
    level: 'warn',
    text: 'Outlook отклонил вызов, потому что был занят (80010001).'
  },
  '-2147023174': {
    hex: '800706BA',
    level: 'warn',
    text: 'Outlook временно недоступен (800706BA). Повтор обычно проходит.'
  },
  '-2147467260': {
    hex: '80004004',
    level: 'warn',
    text: 'Операция Outlook прервана (80004004).'
  },
  '-2147467263': {
    hex: '8000FFFF',
    level: 'warn',
    text: 'Outlook ответил «не выполнено» (8000FFFF). Обычно это короткий сбой.'
  }
}

const OUTLOOK_STEP: Record<string, string> = {
  load_pywin32: 'Библиотека Outlook',
  co_initialize: 'Подключение к Windows',
  outlook_programmatic_access: 'Программный доступ',
  dispatch_outlook: 'Запуск Outlook',
  dispatch_active: 'Уже открытый Outlook',
  dispatch_new: 'Новое окно Outlook',
  get_namespace: 'Профиль почты',
  resolve_calendar: 'Поиск календаря',
  nav_calendars: 'Календарь в окне Outlook',
  resolve_calendar_done: 'Календарь',
  restrict_window: 'Фильтр встреч по датам',
  restrict_without_recurrences: 'Серии не разворачиваем, читаем встречи как есть',
  restrict_retry_ok: 'Календарь открылся со второй попытки',
  restrict_not_ready: 'Общий календарь ещё не открыт в Outlook, дальше берём занятость',
  restrict_try: 'Фильтр встреч',
  iterate_items: 'Просмотр встреч',
  retry_without_recurrences: 'Повтор без повторяющихся встреч',
  calendar_freebusy: 'Занятость календаря',
  calendar_ok: 'Календарь прочитан',
  dispatch_cached: 'Уже открытый Outlook',
  done: 'Чтение закончено',
  mapi_logon: 'Вход в профиль'
}

function explainOutlook(raw: string): { text: string; level: 'info' | 'warn' | 'error'; code: string } | null {
  if (!raw.includes('COM_DIAG')) return null
  if (raw.includes('fallback_getfirst')) {
    return { level: 'info', code: '', text: 'Фильтр по дате не подошёл, читаем календарь с начала.' }
  }
  const step = /step=([a-z0-9_]+)/i.exec(raw)?.[1] || ''
  const codes = [...raw.matchAll(/-214\d{7}/g)].map((item) => item[0])
  const inner = [...codes].reverse().find((code) => code !== '-2147352567') || ''
  if (step === 'getfirst_not_found' || inner === '-2147221233') {
    return {
      level: 'warn',
      code: '8004010F',
      text: 'Outlook не нашёл элемент календаря (8004010F). Чтение идёт другим способом.'
    }
  }
  const known = inner ? OUTLOOK_CODE[inner] : undefined
  if (known) return { level: known.level, code: known.hex, text: known.text }
  const title = OUTLOOK_STEP[step] || (step ? step.replace(/_/g, ' ') : 'Outlook')
  if (step.endsWith('_ok') || step === 'done') return { level: 'info', code: '', text: title }
  if (/\bok\b/.test(raw)) return { level: 'info', code: '', text: `${title}: готово` }
  if (/fail|error|skipped/i.test(raw)) return { level: 'warn', code: '', text: `${title}: не выполнен` }
  return { level: 'info', code: '', text: title }
}

function lastOf(points: Point[]): number {
  return points.length ? points[points.length - 1].v : 0
}

function TimeChart({
  title,
  unit,
  lines
}: {
  title: string
  unit: string
  lines: { name: string; color: string; points: Point[] }[]
}): React.JSX.Element {
  const width = 640
  const height = 168
  const padL = 44
  const padR = 10
  const padT = 12
  const padB = 22
  const points = lines.flatMap((line) => line.points)
  const max = Math.max(1, ...points.map((point) => point.v))
  const minT = points.length ? Math.min(...points.map((point) => point.t)) : 0
  const maxT = points.length ? Math.max(...points.map((point) => point.t)) : 1
  const span = Math.max(1, maxT - minT)
  const xOf = (t: number): number => padL + ((t - minT) / span) * (width - padL - padR)
  const yOf = (v: number): number => padT + (1 - v / max) * (height - padT - padB)
  const pathOf = (row: Point[]): string =>
    row.map((point, index) => `${index ? 'L' : 'M'}${xOf(point.t).toFixed(1)},${yOf(point.v).toFixed(1)}`).join(' ')
  const areaOf = (row: Point[]): string => {
    if (!row.length) return ''
    const base = yOf(0)
    return `${pathOf(row)} L${xOf(row[row.length - 1].t).toFixed(1)},${base.toFixed(1)} L${xOf(row[0].t).toFixed(1)},${base.toFixed(1)} Z`
  }
  const stamp = (value: number): string => {
    if (!value) return ''
    const date = new Date(value)
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  const ticks = [max, max / 2, 0]
  return (
    <section className="setup-chart">
      <header>
        <span>{title}</span>
        <strong>
          {points.length ? Math.round(lastOf(lines[0]?.points || []) * 10) / 10 : '—'} {unit}
        </strong>
      </header>
      {points.length ? (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={padL} x2={width - padR} y1={yOf(tick)} y2={yOf(tick)} className="setup-grid" />
              <text x={padL - 6} y={yOf(tick) + 3} textAnchor="end" className="setup-axis">
                {Math.round(tick)}
              </text>
            </g>
          ))}
          <text x={padL} y={height - 4} className="setup-axis">
            {stamp(minT)}
          </text>
          <text x={width - padR} y={height - 4} textAnchor="end" className="setup-axis">
            {stamp(maxT)}
          </text>
          {lines.map((line) =>
            line.points.length ? (
              <g key={line.name}>
                <path d={areaOf(line.points)} fill={line.color} opacity="0.18" />
                <path d={pathOf(line.points)} fill="none" stroke={line.color} strokeWidth="2.5" />
              </g>
            ) : null
          )}
        </svg>
      ) : (
        <p className="setup-chart-empty">Пока нет точек</p>
      )}
      <footer>
        {lines.map((line) => {
          const values = line.points.map((point) => point.v)
          const maxValue = values.length ? Math.max(...values) : 0
          const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
          return (
            <i key={line.name} style={{ color: line.color }}>
              {line.name}: сейчас {Math.round(lastOf(line.points) * 10) / 10}, среднее {Math.round(avg * 10) / 10}, макс {Math.round(maxValue * 10) / 10}
            </i>
          )
        })}
      </footer>
    </section>
  )
}

function Stat({
  label,
  value,
  hint,
  tone
}: {
  label: string
  value: string
  hint: string
  tone: StatTone
}): React.JSX.Element {
  return (
    <article className={`setup-stat setup-stat-${tone}`}>
      <header>{label}</header>
      <strong>{value}</strong>
      <p>{hint}</p>
    </article>
  )
}

function EnvFileForm({
  title,
  file,
  edited,
  onChange,
  onSave,
  saving,
  note,
  extra,
  groupNames
}: {
  title: string
  file: SetupFile
  edited: Record<string, string>
  onChange: (key: string, value: string) => void
  onSave: () => void
  saving: boolean
  note: string
  extra?: ReactNode
  groupNames?: string[]
}): React.JSX.Element | null {
  const groups = useMemo(() => {
    const all = groupsOf(file.fields)
    if (!groupNames?.length) return all
    return all.filter((group) => groupNames.includes(group.name))
  }, [file.fields, groupNames])
  if (!groups.length) return null
  return (
    <section className="setup-panel-card">
      <header className="setup-panel-head">
        <h2>{title}</h2>
        <span title={file.path}>{file.path || 'файл не найден'}</span>
      </header>
      <div className="setup-panel-body">
        {groups.map((group) => (
          <div key={group.name} className="setup-group">
            <h3>{group.name}</h3>
            <div className="setup-fields">
              {group.fields.map((field) => (
                <label key={field.key} className="setup-field">
                  <span>{field.label}</span>
                  <input
                    className="setup-input"
                    type={field.secret ? 'password' : 'text'}
                    value={edited[field.key] ?? field.value}
                    placeholder={field.secret ? (field.hasSecret ? 'задан, пустое не меняет' : 'не задан') : ''}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => onChange(field.key, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
        <div className="setup-file-actions">
          <button className="setup-btn setup-btn-primary" type="button" onClick={onSave} disabled={saving || !file.path}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
          {extra}
        </div>
        {note ? <p className="setup-note">{note}</p> : null}
      </div>
    </section>
  )
}

export function SetupPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [desktop, setDesktop] = useState<SetupFile | null>(null)
  const [backend, setBackend] = useState<SetupFile | null>(null)
  const [canRestartBackend, setCanRestartBackend] = useState(false)
  const [edited, setEdited] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState('')
  const [desktopNote, setDesktopNote] = useState('')
  const [backendNote, setBackendNote] = useState('')
  const [saving, setSaving] = useState<'desktop' | 'backend' | ''>('')
  const [restarting, setRestarting] = useState(false)
  const [probe, setProbe] = useState<SetupProbe | null>(null)
  const [checking, setChecking] = useState(false)
  const [sidecar, setSidecar] = useState<SidecarState | null>(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [imap, setImap] = useState<SetupToolProbe | null>(null)
  const [onec, setOnec] = useState<SetupToolProbe | null>(null)
  const [toolsError, setToolsError] = useState('')
  const [tab, setTab] = useState<TabId>('overview')
  const [metrics, setMetrics] = useState<Metrics | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => {
    let alive = true
    void window.api.readSetup().then((snapshot) => {
      if (!alive) return
      setDesktop(snapshot.desktop)
      setBackend(snapshot.backend)
      setCanRestartBackend(snapshot.canRestartBackend)
      const next: Record<string, string> = {}
      for (const field of snapshot.desktop.fields) next[field.key] = field.value
      for (const field of snapshot.backend?.fields || []) next[field.key] = field.value
      setEdited(next)
      setLoadError('')
    }).catch((err: unknown) => {
      if (alive) setLoadError(err instanceof Error ? err.message : 'Не удалось прочитать env')
    })
    return () => {
      alive = false
    }
  }, [])

  const check = async (): Promise<void> => {
    setChecking(true)
    try {
      const [health, status] = await Promise.all([
        window.api.probeSetup(),
        window.agent.sidecarStatus().catch(() => null)
      ])
      setProbe(health)
      if (status) {
        setSidecar({
          ready: Boolean(status.ready),
          starting: Boolean(status.starting),
          queuedCommands: Number(status.queuedCommands || 0),
          error: String(status.error || ''),
          python: String(status.python || ''),
          desktopRoot: String(status.desktopRoot || '')
        })
      }
      const session = loadSession()
      const tools = await window.api.probeSetupTools(session?.accessToken || null)
      setNeedsLogin(tools.needsLogin)
      setImap(tools.imap)
      setOnec(tools.onec)
      setToolsError(tools.error || '')
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    let alive = true
    let ticks = 0
    const pull = async (): Promise<void> => {
      ticks += 1
      if (ticks === 1 || ticks % 3 === 0) void check()
      try {
        const next = await window.api.setupMetrics()
        if (alive) setMetrics(next)
      } catch {
        /* оставляем прошлый снимок */
      }
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 4000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const save = async (target: 'desktop' | 'backend'): Promise<void> => {
    const file = target === 'desktop' ? desktop : backend
    if (!file) return
    setSaving(target)
    try {
      const result = await window.api.writeSetup(target, valuesOf(file.fields, edited))
      const text = result.ok ? result.note || 'Сохранено' : result.error || 'Не удалось записать'
      if (target === 'desktop') setDesktopNote(text)
      else setBackendNote(text)
    } finally {
      setSaving('')
    }
  }

  const restartBackend = async (): Promise<void> => {
    if (!window.confirm('Перезапустить сервер на порту 7812? Текущие сессии на этом компьютере оборвутся.')) return
    setRestarting(true)
    setBackendNote('Перезапускаем сервер…')
    try {
      const result = await window.api.restartSetupBackend()
      setBackendNote(result.ok ? 'Сервер снова отвечает.' : result.error || 'Сервер не перезапустился')
    } finally {
      setRestarting(false)
    }
  }

  const outlookTone: StatTone = !sidecar ? 'idle' : sidecar.error ? 'bad' : sidecar.ready ? 'ok' : 'warn'
  const outlookValue = !sidecar ? '—' : sidecar.error ? 'ошибка' : sidecar.ready ? 'готов' : sidecar.starting ? 'старт' : 'нет'
  const imapTone: StatTone = !probe ? 'idle' : needsLogin ? 'warn' : imap?.configured ? 'ok' : imap?.error ? 'bad' : 'warn'
  const onecTone: StatTone = !probe ? 'idle' : needsLogin ? 'warn' : onec?.configured ? 'ok' : onec?.error ? 'bad' : 'warn'
  const serverTone: StatTone = !probe ? 'idle' : probe.ok ? 'ok' : 'bad'
  const tabTone: Record<TabId, StatTone> = {
    overview: serverTone,
    server: serverTone,
    mail: imapTone,
    outlook: outlookTone,
    onec: onecTone === 'bad' || outlookTone === 'bad' ? 'bad' : onecTone === 'ok' || outlookTone === 'ok' ? 'ok' : onecTone,
    helper: outlookTone,
    keys: outlookTone
  }
  const moduleOf = (id: 'server' | 'mail' | 'onec') => metrics?.modules?.[id]
  const presentedLogs = (metrics?.logs || []).map((line) => {
    const outlook = explainOutlook(line.text)
    if (!outlook) return line
    return { ...line, module: 'outlook', level: outlook.level, text: outlook.text }
  })
  const outlookLogs = presentedLogs.filter((line) => line.module === 'outlook')
  const latestOutlook = [...outlookLogs].reverse().find((line) => /\([0-9A-F]{8}\)/.test(line.text)) || outlookLogs[outlookLogs.length - 1]
  const latestOutlookCode = latestOutlook?.text.match(/\(([0-9A-F]{8})\)/)?.[1] || ''
  const outlookEvents = (() => {
    const size = 15_000
    const buckets = new Map<number, number>()
    for (const line of outlookLogs) {
      const key = Math.floor(line.t / size) * size
      buckets.set(key, (buckets.get(key) || 0) + 1)
    }
    return [...buckets.entries()].sort((left, right) => left[0] - right[0]).map(([t, v]) => ({ t, v }))
  })()
  const visibleLogs = presentedLogs.filter((line) => {
    if (tab === 'overview') return true
    if (tab === 'helper' || tab === 'keys') return line.module === 'helper'
    return line.module === tab
  })
  const collapsedLogs = visibleLogs.reduce<{ t: number; level: string; text: string; count: number }[]>((rows, line) => {
    const prev = rows[rows.length - 1]
    if (prev && prev.text === line.text && prev.level === line.level) {
      prev.count += 1
      prev.t = line.t
      return rows
    }
    rows.push({ t: line.t, level: line.level, text: line.text, count: 1 })
    return rows
  }, [])
  const requestLines = [
    { name: 'Сервер', color: '#5794f2', points: moduleOf('server')?.requests || [] },
    { name: 'Почта', color: '#73bf69', points: moduleOf('mail')?.requests || [] },
    { name: '1С', color: '#ff9830', points: moduleOf('onec')?.requests || [] }
  ]
  const latencyLines = [
    { name: 'Сервер', color: '#5794f2', points: moduleOf('server')?.latencyMs || [] },
    { name: 'Почта', color: '#73bf69', points: moduleOf('mail')?.latencyMs || [] },
    { name: '1С', color: '#ff9830', points: moduleOf('onec')?.latencyMs || [] }
  ]

  return (
    <div className="setup-panel" role="dialog" aria-label="Настройка приложения">
      <header className="setup-topbar">
        <div className="setup-brand">
          <h1>Настройка</h1>
          <span>Ctrl+Alt+J</span>
        </div>
        <div className="setup-topbar-actions">
          <button className="setup-btn setup-btn-primary" type="button" onClick={() => void check()} disabled={checking}>
            {checking ? 'Проверяем…' : 'Проверить'}
          </button>
          <button className="setup-btn" type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </header>
      <nav className="setup-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            <i className={`setup-dot setup-dot-${tabTone[item.id]}`} />
            {item.label}
          </button>
        ))}
      </nav>
      {loadError ? <div className="setup-alert">{loadError}</div> : null}
      {metrics && !metrics.serverMetrics ? (
        <p className="setup-note">Графики запросов появятся после перезапуска сервера. Ресурсы окна и журнал помощника уже пишутся.</p>
      ) : null}
      <div className="setup-split">
      <aside className="setup-settings">
        <h2>Параметры</h2>
      <div className="setup-board">
        {tab === 'outlook' ? (
          <section className="setup-panel-card">
            <div className="setup-panel-head">
              <h2>Outlook на этом компьютере</h2>
              <span>{outlookValue}</span>
            </div>
            <div className="setup-panel-body">
              <p className="setup-note">
                Календарь читается через Outlook на этом компьютере. Коды вроде -2147221233 в журнале справа уже переведены.
                Очередь команд: {sidecar ? sidecar.queuedCommands : '—'}.
              </p>
            </div>
          </section>
        ) : null}
        {(tab === 'overview' || tab === 'server' || tab === 'onec' || tab === 'helper' || tab === 'keys') && desktop ? (
          <EnvFileForm
            title={
              tab === 'overview'
                ? 'Этот компьютер'
                : tab === 'server'
                  ? 'Адрес сервера'
                  : tab === 'onec'
                    ? '1С на этом компьютере'
                    : tab === 'keys'
                      ? 'Обновления и ключ помощника'
                      : 'Модель'
            }
            file={desktop}
            groupNames={
              tab === 'overview'
                ? ['Сервер', '1С на этом компьютере', 'Модель']
                : tab === 'server'
                  ? ['Сервер']
                  : tab === 'onec'
                    ? ['1С на этом компьютере']
                    : tab === 'keys'
                      ? ['Обновления', 'Ключ помощника']
                      : ['Модель']
            }
            edited={edited}
            saving={saving === 'desktop'}
            note={desktopNote}
            onChange={(key, value) => setEdited((prev) => ({ ...prev, [key]: value }))}
            onSave={() => void save('desktop')}
          />
        ) : null}
        {(tab === 'overview' || tab === 'server' || tab === 'mail' || tab === 'onec' || tab === 'keys') && backend ? (
          <EnvFileForm
            title={
              tab === 'overview'
                ? 'Сервер'
                : tab === 'server'
                  ? 'Порт и база'
                  : tab === 'mail'
                    ? 'Почта на сервере'
                    : tab === 'keys'
                      ? 'Ключи моделей'
                      : '1С на сервере'
            }
            file={backend}
            groupNames={
              tab === 'overview'
                ? ['Порт и база', 'Почта на сервере', '1С на сервере']
                : tab === 'server'
                  ? ['Порт и база']
                  : tab === 'mail'
                    ? ['Почта на сервере']
                    : tab === 'keys'
                      ? ['Ключи моделей']
                      : ['1С на сервере']
            }
            edited={edited}
            saving={saving === 'backend'}
            note={backendNote}
            onChange={(key, value) => setEdited((prev) => ({ ...prev, [key]: value }))}
            onSave={() => void save('backend')}
            extra={
              canRestartBackend && (tab === 'overview' || tab === 'server' || tab === 'keys') ? (
                <button className="setup-btn" type="button" onClick={() => void restartBackend()} disabled={restarting}>
                  {restarting ? 'Перезапуск…' : 'Перезапустить сервер'}
                </button>
              ) : null
            }
          />
        ) : null}
      </div>
      </aside>
      <div className="setup-watch">
      {tab === 'overview' ? (
      <div className="setup-stats">
        <Stat
          label="Сервер"
          tone={!probe ? 'idle' : probe.ok ? 'ok' : 'bad'}
          value={!probe ? '—' : probe.ok ? `${probe.ms} мс` : 'нет ответа'}
          hint={probe?.backendUrl || edited.BACKEND_URL || 'адрес не задан'}
        />
        <Stat
          label="ERP"
          tone={!probe ? 'idle' : probe.erpReachable ? 'ok' : 'bad'}
          value={!probe ? '—' : probe.erpReachable ? 'доступен' : 'нет'}
          hint={probe?.erpServer || probe?.llmProvider || 'erp_pm'}
        />
        <Stat
          label="Outlook"
          tone={outlookTone}
          value={outlookValue}
          hint={sidecar ? `очередь ${sidecar.queuedCommands}` : 'почта на этом компьютере'}
        />
        <Stat
          label="IMAP"
          tone={imapTone}
          value={!probe ? '—' : toolLine(imap, needsLogin)}
          hint="ящик на сервере"
        />
        <Stat
          label="1С COM"
          tone={outlookTone}
          value={edited.ONEC_COM_SERVER || '—'}
          hint={edited.ONEC_COM_REF || 'база не задана'}
        />
        <Stat
          label="1С сервер"
          tone={onecTone}
          value={!probe ? '—' : toolLine(onec, needsLogin)}
          hint="OData и SOAP"
        />
      </div>
      ) : null}
      {tab === 'outlook' ? (
        <div className="setup-stats">
          <Stat label="Связь" tone={outlookTone} value={outlookValue} hint={sidecar?.error || 'календарь на этом компьютере'} />
          <Stat
            label="Последний код"
            tone={latestOutlook?.level === 'error' ? 'bad' : latestOutlook?.level === 'warn' ? 'warn' : latestOutlook ? 'ok' : 'idle'}
            value={latestOutlookCode || 'нет'}
            hint={latestOutlook?.text || 'строк Outlook ещё не было'}
          />
        </div>
      ) : null}
      <div className="setup-charts">
          {tab === 'outlook' ? (
            <TimeChart title="Сообщения Outlook" unit="за 15 с" lines={[{ name: 'Outlook', color: '#5794f2', points: outlookEvents }]} />
          ) : tab === 'helper' || tab === 'keys' ? (
            <>
              <TimeChart title="CPU окна" unit="%" lines={[{ name: 'окно', color: '#b877d9', points: metrics?.resources.appCpu || [] }]} />
              <TimeChart title="Память окна" unit="МБ" lines={[{ name: 'окно', color: '#5794f2', points: metrics?.resources.appMemoryMb || [] }]} />
            </>
          ) : (
            <>
              <TimeChart
                title="Запросы"
                unit="за 15 с"
                lines={tab === 'overview' ? requestLines : requestLines.filter((line) => line.name === (tab === 'server' ? 'Сервер' : tab === 'mail' ? 'Почта' : '1С'))}
              />
              <TimeChart
                title="Время ответа"
                unit="мс"
                lines={tab === 'overview' ? latencyLines : latencyLines.filter((line) => line.name === (tab === 'server' ? 'Сервер' : tab === 'mail' ? 'Почта' : '1С'))}
              />
              <TimeChart
                title="CPU"
                unit="%"
                lines={
                  tab === 'mail' || tab === 'onec'
                    ? [{ name: 'сервер', color: '#ff9830', points: metrics?.resources.serverCpu || [] }]
                    : [
                        { name: 'сервер', color: '#ff9830', points: metrics?.resources.serverCpu || [] },
                        { name: 'окно', color: '#b877d9', points: metrics?.resources.appCpu || [] }
                      ]
                }
              />
              <TimeChart
                title="Память"
                unit="МБ"
                lines={
                  tab === 'mail' || tab === 'onec'
                    ? [{ name: 'сервер', color: '#5794f2', points: metrics?.resources.serverMemoryMb || [] }]
                    : [
                        { name: 'сервер', color: '#5794f2', points: metrics?.resources.serverMemoryMb || [] },
                        { name: 'окно', color: '#b877d9', points: metrics?.resources.appMemoryMb || [] }
                      ]
                }
              />
            </>
          )}
        </div>
      <section className="setup-log">
          <header>
            Журнал
            <span>
              ошибок {visibleLogs.filter((line) => line.level === 'error').length}
              {' · '}
              предупреждений {visibleLogs.filter((line) => line.level === 'warn').length}
            </span>
          </header>
          <div>
            {collapsedLogs.length ? (
              collapsedLogs.map((line, index) => (
                <p key={`${line.t}-${index}`} className={`setup-log-${line.level}`}>
                  <span>{new Date(line.t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                  {line.text}
                  {line.count > 1 ? ` × ${line.count}` : ''}
                </p>
              ))
            ) : (
              <p className="setup-chart-empty">Записей пока нет</p>
            )}
          </div>
        </section>
      {toolsError ? <p className="setup-note">{toolsError}</p> : null}
      </div>
      </div>
    </div>
  )
}

export function SetupHotkey(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  useEffect(() => window.api.onToggleSetup(() => setOpen((value) => !value)), [])
  if (!open) return null
  return <SetupPanel onClose={() => setOpen(false)} />
}
