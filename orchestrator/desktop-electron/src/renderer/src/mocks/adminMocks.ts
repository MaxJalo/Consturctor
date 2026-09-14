export type MetricIconVariant =
  | 'agents_total'
  | 'agents_used'
  | 'active_runs'
  | 'users'
  | 'success_rate'
  | 'errors'
  | 'queue'
  | 'system_load'

export type MetricTrendTone = 'positive' | 'negative' | 'neutral'

export interface AdminMetricMock {
  id: string
  label: string
  value: string
  trend?: string
  trendTone?: MetricTrendTone
  icon: MetricIconVariant
}

export interface AdminChartSeriesMock {
  id: string
  label: string
  color: string
  points: number[]
}

export interface AdminLaunchDynamicsMock {
  title: string
  yMax: number
  yTicks: number[]
  xLabels: string[]
  series: AdminChartSeriesMock[]
  legend: Array<{ id: string; label: string; color: string }>
}

export interface AdminAgentStatusSliceMock {
  id: string
  label: string
  value: number
  color: string
}

export interface AdminAgentStatusesMock {
  title: string
  total: number
  slices: AdminAgentStatusSliceMock[]
}

export interface AdminIntegrationMock {
  id: string
  label: string
  online: boolean
}

export interface AdminOverviewMock {
  breadcrumb: string
  dashboardTitle: string
  dashboardSubtitle: string
  periodLabel: string
  dateRange: string
  refreshLabel: string
  metrics: AdminMetricMock[]
  launchDynamics: AdminLaunchDynamicsMock
  agentStatuses: AdminAgentStatusesMock
  integrations: AdminIntegrationMock[]
}

export const adminOverviewMock: AdminOverviewMock = {
  breadcrumb: 'Обзор — Сводная панель администратора',
  dashboardTitle: 'Сводная панель',
  dashboardSubtitle: 'Ключевые показатели системы ИИ-агентов',
  periodLabel: 'Период: Неделя',
  dateRange: '08.09.2026 — 14.09.2026',
  refreshLabel: 'Обновить',
  metrics: [
    {
      id: 'agents_total',
      label: 'Всего агентов',
      value: '37',
      trend: '+2',
      trendTone: 'positive',
      icon: 'agents_total'
    },
    {
      id: 'agents_used',
      label: 'Используются',
      value: '29 (78%)',
      trend: '+12%',
      trendTone: 'positive',
      icon: 'agents_used'
    },
    {
      id: 'active_runs',
      label: 'Активных запусков',
      value: '24',
      icon: 'active_runs'
    },
    {
      id: 'users',
      label: 'Пользователей',
      value: '142',
      trend: '+5%',
      trendTone: 'positive',
      icon: 'users'
    },
    {
      id: 'success_rate',
      label: 'Успешных запусков',
      value: '92%',
      icon: 'success_rate'
    },
    {
      id: 'errors',
      label: 'Ошибок',
      value: '3%',
      icon: 'errors'
    },
    {
      id: 'queue',
      label: 'В очереди',
      value: '12',
      icon: 'queue'
    },
    {
      id: 'system_load',
      label: 'Загрузка системы',
      value: '68%',
      icon: 'system_load'
    }
  ],
  launchDynamics: {
    title: 'Динамика запусков агентов',
    yMax: 200,
    yTicks: [0, 50, 100, 150, 200],
    xLabels: ['08.09', '09.09', '10.09', '11.09', '12.09', '13.09', '14.09'],
    series: [
      {
        id: 'success',
        label: 'Успешные',
        color: '#2f9e44',
        points: [118, 128, 142, 138, 168, 152, 145]
      },
      {
        id: 'processing',
        label: 'В обработке',
        color: '#1a73e8',
        points: [92, 98, 108, 112, 128, 118, 110]
      },
      {
        id: 'errors',
        label: 'С ошибками',
        color: '#e55353',
        points: [48, 52, 58, 55, 62, 54, 50]
      }
    ],
    legend: [
      { id: 'success', label: 'Успешные', color: '#2f9e44' },
      { id: 'processing', label: 'В обработке', color: '#1a73e8' },
      { id: 'errors', label: 'С ошибками', color: '#e55353' }
    ]
  },
  agentStatuses: {
    title: 'Статусы агентов',
    total: 37,
    slices: [
      { id: 'active', label: 'Активные', value: 29, color: '#1a73e8' },
      { id: 'pause', label: 'Пауза', value: 4, color: '#2f9e44' },
      { id: 'setup', label: 'На настройке', value: 2, color: '#f0b429' },
      { id: 'error', label: 'Ошибка', value: 2, color: '#e8943a' }
    ]
  },
  integrations: [
    { id: 'onec', label: '1С', online: true },
    { id: 'outlook', label: 'Outlook', online: true },
    { id: 'sed', label: 'СЭД', online: true },
    { id: 'kb', label: 'База знаний', online: true },
    { id: 'gateway', label: 'Agent Gateway', online: true }
  ]
}

export type AdminBadgeTone = 'success' | 'warning' | 'error' | 'info' | 'neutral'
export type AdminSlaTone = 'ok' | 'warn' | 'fail'

export interface AdminPeriodMock {
  periodLabel: string
  dateRange: string
}

export interface AdminHistoryRowMock {
  id: string
  process: string
  agent: string
  user: string
  status: string
  statusTone: AdminBadgeTone
  launchedAt: string
  duration: string
  sla: AdminSlaTone
}

export interface AdminHistoryMock extends AdminPeriodMock {
  breadcrumb: string
  title: string
  subtitle: string
  tabs: Array<{ id: string; label: string }>
  activeTab: string
  filters: string[]
  rows: AdminHistoryRowMock[]
  pagination: { from: number; to: number; total: number }
}

export interface AdminCalendarEventMock {
  id: string
  dayIndex: number
  startHour: number
  endHour: number
  title: string
  tone: 'green' | 'blue' | 'purple' | 'yellow' | 'red'
}

export interface AdminLaunchCalendarMock extends AdminPeriodMock {
  breadcrumb: string
  title: string
  subtitle: string
  createLabel: string
  viewModes: string[]
  activeView: string
  weekRange: string
  days: string[]
  hours: string[]
  events: AdminCalendarEventMock[]
  agentFilters: Array<{ id: string; label: string; color: string; checked: boolean }>
  miniMonth: string
  miniDays: Array<{ day: number; active?: boolean; muted?: boolean }>
  unscheduled: Array<{ id: string; title: string; subtitle: string; tone: 'purple' | 'green' }>
  scheduleAllLabel: string
}

export interface AdminKpiSummaryMock {
  id: string
  label: string
  value: string
  trend?: string
  trendTone?: MetricTrendTone
  tint?: 'orange' | 'green' | 'red' | 'none'
  icon?: 'target' | 'none'
}

export interface AdminKpiMock extends AdminPeriodMock {
  breadcrumb: string
  title: string
  subtitle: string
  tabs: Array<{ id: string; label: string }>
  activeTab: string
  summaries: AdminKpiSummaryMock[]
  dynamics: AdminLaunchDynamicsMock
  topAgents: Array<{ label: string; value: number }>
  gauges: Array<{ id: string; label: string; value: string; tone: 'green' | 'orange' | 'cyan' }>
}

export interface AdminUserRowMock {
  fio: string
  position: string
  department: string
  role: string
  status: string
  agentsAccess: number
  agentsUsed: number
  lastActivity: string
}

export interface AdminUsersMock {
  breadcrumb: string
  title: string
  subtitle: string
  addLabel: string
  filters: string[]
  rows: AdminUserRowMock[]
  pagination: { from: number; to: number; total: number }
}

export interface AdminAgentRowMock {
  name: string
  process: string
  owner: string
  version: string
  status: string
  statusTone: AdminBadgeTone
  runs: number
  successRate: string
  used: boolean
}

export interface AdminAgentDetailMock {
  name: string
  status: string
  statusTone: AdminBadgeTone
  description: string
  tabs: string[]
  activeTab: string
  info: Array<{ label: string; value: string }>
  metrics: Array<{ label: string; value: string }>
  processes: Array<{ title: string; time: string; status: string; statusTone: AdminBadgeTone; tone: 'green' | 'grey' }>
}

export interface AdminAiAgentsMock {
  breadcrumb: string
  title: string
  subtitle: string
  createLabel: string
  importLabel: string
  filters: string[]
  rows: AdminAgentRowMock[]
  pagination: { from: number; to: number; total: number }
  detail: AdminAgentDetailMock
}

export interface AdminKnowledgeRowMock {
  name: string
  type: string
  agents: string
  version: string
  status: string
  statusTone: AdminBadgeTone
  updatedAt: string
}

export interface AdminKnowledgeBaseMock {
  breadcrumb: string
  title: string
  subtitle: string
  addLabel: string
  filters: string[]
  rows: AdminKnowledgeRowMock[]
  pagination: { from: number; to: number; total: number }
  document: {
    title: string
    status: string
    statusTone: AdminBadgeTone
    meta: string
    text: string
    format: string
    author: string
    category: string
    tags: string[]
    usageTotal: string
    usageTrend: string
    usageBars: number[]
    agentsShare: Array<{ label: string; value: number }>
    related: Array<{ title: string; type: string }>
    relatedCount: number
  }
}

const ADMIN_PERIOD: AdminPeriodMock = {
  periodLabel: 'Период: Неделя',
  dateRange: '08.09.2026 — 14.09.2026'
}

export const adminHistoryMock: AdminHistoryMock = {
  ...ADMIN_PERIOD,
  breadcrumb: 'История — Процессы, задачи, письма, задачи по проектам',
  title: 'История',
  subtitle: 'Просмотр выполненных процессов, задач, писем и проектных задач',
  tabs: [
    { id: 'processes', label: 'Процессы' },
    { id: 'tasks', label: 'Задачи' },
    { id: 'letters', label: 'Письма' },
    { id: 'project_tasks', label: 'Задачи по проектам' }
  ],
  activeTab: 'processes',
  filters: ['Все статусы', 'Все агенты', 'Все процессы', 'Все пользователи'],
  rows: [
    { id: 'P-458', process: 'Подготовка совещания', agent: 'Агент_Совещания', user: 'Петров А.А.', status: 'Завершен', statusTone: 'success', launchedAt: '14.09.2026 10:15', duration: '12 мин', sla: 'ok' },
    { id: 'P-459', process: 'Анализ рынка', agent: 'Агент_Аналитика', user: 'Сидоров В.В.', status: 'В работе', statusTone: 'warning', launchedAt: '14.09.2026 09:30', duration: '25 мин', sla: 'warn' },
    { id: 'P-460', process: 'Обработка корреспонденции', agent: 'Агент_Корреспонденция', user: 'Кузнецова Е.Е.', status: 'Завершен', statusTone: 'success', launchedAt: '14.09.2026 08:45', duration: '8 мин', sla: 'ok' },
    { id: 'P-461', process: 'Формирование КП', agent: 'Агент_КП', user: 'Иванов И.И.', status: 'Завершен', statusTone: 'success', launchedAt: '13.09.2026 16:20', duration: '18 мин', sla: 'ok' },
    { id: 'P-462', process: 'Финансовый анализ', agent: 'Агент_Финансы', user: 'Михайлов Д.Д.', status: 'Ошибка', statusTone: 'error', launchedAt: '13.09.2026 14:10', duration: '5 мин', sla: 'fail' },
    { id: 'P-463', process: 'Отчет по закупкам', agent: 'Агент_Закупки', user: 'Николаев С.С.', status: 'Завершен', statusTone: 'success', launchedAt: '13.09.2026 11:00', duration: '22 мин', sla: 'ok' },
    { id: 'P-464', process: 'Анализ Базы знаний', agent: 'Агент_Аналитика', user: 'Орлова М.М.', status: 'В работе', statusTone: 'warning', launchedAt: '12.09.2026 15:40', duration: '31 мин', sla: 'warn' },
    { id: 'P-465', process: 'Сверка данных', agent: 'Агент_Финансы', user: 'Волков П.П.', status: 'Завершен', statusTone: 'success', launchedAt: '12.09.2026 10:05', duration: '14 мин', sla: 'ok' },
    { id: 'P-466', process: 'Подготовка материалов', agent: 'Агент_Совещания', user: 'Лебедев А.А.', status: 'Завершен', statusTone: 'success', launchedAt: '11.09.2026 09:15', duration: '9 мин', sla: 'ok' },
    { id: 'P-467', process: 'Экспорт отчетов', agent: 'Агент_Финансы', user: 'Смирнова К.К.', status: 'Завершен', statusTone: 'success', launchedAt: '10.09.2026 17:30', duration: '6 мин', sla: 'ok' }
  ],
  pagination: { from: 1, to: 10, total: 248 }
}

export const adminLaunchCalendarMock: AdminLaunchCalendarMock = {
  ...ADMIN_PERIOD,
  breadcrumb: 'Календарь запуска — Планирование и контроль выполнения',
  title: 'Календарь запусков',
  subtitle: 'Планирование, автозапуски и контроль выполнения агентов',
  createLabel: 'Создать запуск',
  viewModes: ['День', 'Неделя', 'Месяц', 'Сегодня'],
  activeView: 'Неделя',
  weekRange: '08.09.2025 — 14.09.2025',
  days: ['Пн 08.09', 'Вт 09.09', 'Ср 10.09', 'Чт 11.09', 'Пт 12.09', 'Сб 13.09', 'Вс 14.09'],
  hours: ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'],
  events: [
    { id: 'e1', dayIndex: 0, startHour: 9, endHour: 10, title: 'Подготовка совещаний', tone: 'green' },
    { id: 'e2', dayIndex: 0, startHour: 11, endHour: 12, title: 'Анализ рынка', tone: 'blue' },
    { id: 'e3', dayIndex: 0, startHour: 15, endHour: 16, title: 'Обработка корреспонденции', tone: 'purple' },
    { id: 'e4', dayIndex: 2, startHour: 11, endHour: 12, title: 'Подготовка КП', tone: 'yellow' },
    { id: 'e5', dayIndex: 2, startHour: 13, endHour: 14, title: 'Финансовый анализ', tone: 'red' },
    { id: 'e6', dayIndex: 4, startHour: 13, endHour: 14, title: 'Отчет по закупкам', tone: 'blue' },
    { id: 'e7', dayIndex: 4, startHour: 15, endHour: 16, title: 'Анализ Базы знаний', tone: 'green' },
    { id: 'e8', dayIndex: 4, startHour: 16, endHour: 17, title: 'Сверка данных', tone: 'yellow' }
  ],
  agentFilters: [
    { id: 'all', label: 'Все агенты', color: '#1a73e8', checked: true },
    { id: 'meet', label: 'Агент. Совещания', color: '#1a73e8', checked: true },
    { id: 'mail', label: 'Агент. Корреспонденция', color: '#1a73e8', checked: true },
    { id: 'analytics', label: 'Агент. Аналитика', color: '#8a9a5b', checked: true },
    { id: 'sales', label: 'Агент. Коммерческий', color: '#e8943a', checked: true },
    { id: 'proc', label: 'Агент. Закупки', color: '#2f9e44', checked: true },
    { id: 'hr', label: 'Агент. HR', color: '#f0b429', checked: true },
    { id: 'fin', label: 'Агент. Финансы', color: '#e55353', checked: true }
  ],
  miniMonth: 'Сентябрь 2025',
  miniDays: [
    { day: 1, muted: true }, { day: 2, muted: true }, { day: 3, muted: true }, { day: 4, muted: true }, { day: 5, muted: true }, { day: 6, muted: true }, { day: 7, muted: true },
    { day: 8 }, { day: 9 }, { day: 10 }, { day: 11, active: true }, { day: 12 }, { day: 13 }, { day: 14 }
  ],
  unscheduled: [
    { id: 'u1', title: 'Анализ отзывов клиентов', subtitle: 'Агент. Аналитика • Подготовить сводный отчет по отзывам за август', tone: 'purple' },
    { id: 'u2', title: 'Экспорт отчетов', subtitle: 'Агент. Финансы • Выгрузка ежемесячных отчетов', tone: 'green' }
  ],
  scheduleAllLabel: 'Запланировать все'
}

export const adminKpiMock: AdminKpiMock = {
  periodLabel: 'Период: Месяц',
  dateRange: '01.09.2026 — 14.09.2026',
  breadcrumb: 'KPI — Анализ эффективности и загрузки системы',
  title: 'KPI',
  subtitle: 'Анализ эффективности и загрузки системы',
  tabs: [
    { id: 'general', label: 'Общее' },
    { id: 'agents', label: 'Агенты' },
    { id: 'users', label: 'Пользователи' },
    { id: 'processes', label: 'Процессы' },
    { id: 'system', label: 'Система' }
  ],
  activeTab: 'general',
  summaries: [
    { id: 's1', label: 'Успешность задач', value: '92%', trend: '(+3%)', trendTone: 'positive', tint: 'none' },
    { id: 's2', label: 'Среднее время', value: '1,8 мин', trend: '(-12%)', trendTone: 'positive', tint: 'none' },
    { id: 's3', label: 'Загрузка агентов', value: '68%', tint: 'orange' },
    { id: 's4', label: 'Активные пользователи', value: '142', tint: 'none' },
    { id: 's5', label: 'Доступность системы', value: '99,7%', tint: 'green' },
    { id: 's6', label: 'Статус системы', value: '', icon: 'target', tint: 'green' },
    { id: 's7', label: 'Критические ошибки', value: '3', trend: '(-2)', trendTone: 'negative', tint: 'red' }
  ],
  dynamics: {
    title: 'Динамика KPI',
    yMax: 100,
    yTicks: [0, 25, 50, 75, 100],
    xLabels: ['08.09', '09.09', '10.09', '11.09', '12.09', '13.09', '14.09'],
    series: [
      { id: 'success', label: 'Успешность', color: '#2f9e44', points: [28, 32, 35, 33, 38, 36, 34] },
      { id: 'time', label: 'Среднее время', color: '#1a73e8', points: [72, 78, 82, 80, 88, 84, 81] },
      { id: 'load', label: 'Загрузка системы', color: '#e8943a', points: [58, 60, 62, 61, 66, 64, 63] }
    ],
    legend: [
      { id: 'success', label: 'Успешность', color: '#2f9e44' },
      { id: 'time', label: 'Среднее время', color: '#1a73e8' },
      { id: 'load', label: 'Загрузка системы', color: '#e8943a' }
    ]
  },
  topAgents: [
    { label: 'Агент_Совещания', value: 96 },
    { label: 'Агент_КП', value: 92 },
    { label: 'Агент_Закупки', value: 88 },
    { label: 'Агент_Аналитика', value: 85 },
    { label: 'Агент_Финансы', value: 82 }
  ],
  gauges: [
    { id: 'cpu', label: 'CPU', value: '32%', tone: 'green' },
    { id: 'mem', label: 'Память', value: '68%', tone: 'orange' },
    { id: 'queue', label: 'Очередь', value: '12', tone: 'cyan' },
    { id: 'avail', label: 'Доступность', value: '99,7%', tone: 'green' }
  ]
}

export const adminUsersMock: AdminUsersMock = {
  breadcrumb: 'Пользователи — Управление доступом и активностью',
  title: 'Пользователи',
  subtitle: 'Управление учетными записями, ролями и использованием ИИ-агентов',
  addLabel: 'Добавить пользователя',
  filters: ['Все подразделения', 'Все роли', 'Все статусы'],
  rows: [
    { fio: 'Иванов И.И.', position: 'Системный администратор', department: 'IT', role: 'Администратор', status: 'Активен', agentsAccess: 37, agentsUsed: 12, lastActivity: '14.09.2026 12:45' },
    { fio: 'Петров А.А.', position: 'Руководитель отдела', department: 'Продажи', role: 'Пользователь', status: 'Активен', agentsAccess: 8, agentsUsed: 5, lastActivity: '14.09.2026 11:20' },
    { fio: 'Сидоров В.В.', position: 'Аналитик', department: 'Аналитика', role: 'Пользователь', status: 'Активен', agentsAccess: 6, agentsUsed: 4, lastActivity: '14.09.2026 10:05' },
    { fio: 'Кузнецова Е.Е.', position: 'Специалист', department: 'Документооборот', role: 'Пользователь', status: 'Активен', agentsAccess: 5, agentsUsed: 3, lastActivity: '13.09.2026 18:10' },
    { fio: 'Михайлов Д.Д.', position: 'Финансовый контролер', department: 'Финансы', role: 'Пользователь', status: 'Активен', agentsAccess: 7, agentsUsed: 6, lastActivity: '13.09.2026 16:40' }
  ],
  pagination: { from: 1, to: 5, total: 142 }
}

export const adminAiAgentsMock: AdminAiAgentsMock = {
  breadcrumb: 'ИИ-агенты — Создание, настройка, версии и мониторинг',
  title: 'ИИ-агенты',
  subtitle: 'Создание, настройка, версии и мониторинг всех ИИ-агентов',
  createLabel: 'Создать агента',
  importLabel: 'Импорт',
  filters: ['Все статусы', 'Все процессы', 'Все владельцы'],
  rows: [
    { name: 'Агент_Совещания', process: 'Подготовка совещания', owner: 'Иванов И.И.', version: '1.3.2', status: 'Активен', statusTone: 'success', runs: 1245, successRate: '94%', used: true },
    { name: 'Агент_Корреспонденция', process: 'Обработка корреспонденции', owner: 'Кузнецова Е.Е.', version: '1.1.0', status: 'Активен', statusTone: 'success', runs: 892, successRate: '91%', used: true },
    { name: 'Агент_Аналитика', process: 'Анализ рынка', owner: 'Сидоров В.В.', version: '2.0.1', status: 'На настройке', statusTone: 'warning', runs: 456, successRate: '87%', used: false },
    { name: 'Агент_КП', process: 'Формирование КП', owner: 'Петров А.А.', version: '1.0.5', status: 'Активен', statusTone: 'success', runs: 678, successRate: '93%', used: true },
    { name: 'Агент_Финансы', process: 'Финансовый анализ', owner: 'Михайлов Д.Д.', version: '1.2.0', status: 'Активен', statusTone: 'success', runs: 534, successRate: '89%', used: true }
  ],
  pagination: { from: 1, to: 5, total: 37 },
  detail: {
    name: 'Агент_Совещания',
    status: 'Активен',
    statusTone: 'success',
    description: 'Автоматизирует подготовку материалов, формирование повестки и рассылку приглашений для совещаний.',
    tabs: ['Обзор', 'Текущие процессы', 'История запусков', 'Настройки', 'Версии'],
    activeTab: 'Обзор',
    info: [
      { label: 'Владелец', value: 'Иванов И.И.' },
      { label: 'Версия', value: '1.3.2' },
      { label: 'Статус', value: 'Активен' },
      { label: 'Используется', value: 'Да' },
      { label: 'Создан', value: '12.03.2024, 10:24' },
      { label: 'Обновлен', value: '18.04.2024, 14:12' }
    ],
    metrics: [
      { label: 'Всего запусков', value: '1 245' },
      { label: 'Успешных запусков', value: '1 170' },
      { label: 'Успешность', value: '94%' },
      { label: 'Среднее время выполнения', value: '2 мин 14 сек' },
      { label: 'Экономия времени', value: '~ 312 часов' },
      { label: 'Охват пользователей', value: '28' }
    ],
    processes: [
      { title: 'Подготовка материалов', time: 'Запущено 14.09.2026 10:15', status: 'Выполняется', statusTone: 'success', tone: 'green' },
      { title: 'Формирование повестки', time: 'Завершено 14.09.2026 09:40', status: 'Успешно', statusTone: 'success', tone: 'grey' },
      { title: 'Рассылка приглашений', time: 'Завершено 14.09.2026 09:55', status: 'Успешно', statusTone: 'success', tone: 'grey' }
    ]
  }
}

export const adminKnowledgeBaseMock: AdminKnowledgeBaseMock = {
  breadcrumb: 'База знаний — Управление источниками знаний',
  title: 'База знаний',
  subtitle: 'Документы, справочники и источники знаний для ИИ-агентов',
  addLabel: 'Добавить документ',
  filters: ['Все типы', 'Все агенты', 'Все статусы'],
  rows: [
    { name: 'Регламент по закупкам', type: 'Регламент', agents: 'Агент_Закупки', version: '2.1', status: 'Актуален', statusTone: 'success', updatedAt: '12.09.2026' },
    { name: 'Шаблоны КП', type: 'Шаблон', agents: 'Агент_КП', version: '1.3', status: 'Актуален', statusTone: 'success', updatedAt: '11.09.2026' },
    { name: 'Реестр поставщиков', type: 'Справочник', agents: 'Агент_Закупки', version: '1.0', status: 'Актуален', statusTone: 'success', updatedAt: '10.09.2026' },
    { name: 'Частые вопросы (FAQ)', type: 'FAQ', agents: 'Агент_Совещания', version: '1.2', status: 'Актуален', statusTone: 'success', updatedAt: '05.09.2026' },
    { name: 'Инструкции по 1С', type: 'Инструкция', agents: 'Агент_Аналитика', version: '1.1', status: 'Требует обновления', statusTone: 'error', updatedAt: '01.09.2026' }
  ],
  pagination: { from: 1, to: 5, total: 257 },
  document: {
    title: 'Регламент по закупкам',
    status: 'Актуален',
    statusTone: 'success',
    meta: 'Регламент • v2.1 • Обновлен 12.09.2026',
    text: 'Документ описывает порядок закупок компании: инициирование заявки, согласование, выбор поставщика, оформление договора и контроль исполнения.',
    format: 'PDF (1.4 MB)',
    author: 'Иванов И.И.',
    category: 'Закупки',
    tags: ['закупки', 'регламент', 'поставщики'],
    usageTotal: '428',
    usageTrend: '+12%',
    usageBars: [12, 18, 15, 22, 19, 24, 28, 26, 30, 27, 32, 35, 31, 29],
    agentsShare: [
      { label: 'Агент_Закупки', value: 65 },
      { label: 'Агент_Аналитика', value: 20 },
      { label: 'Агент_КП', value: 10 },
      { label: 'Агент_Совещания', value: 5 }
    ],
    related: [
      { title: 'Шаблоны КП', type: 'Шаблон' },
      { title: 'Реестр поставщиков', type: 'Справочник' },
      { title: 'Критерии оценки поставщиков', type: 'Регламент' },
      { title: 'Договор поставки (шаблон)', type: 'Шаблон' },
      { title: 'Частые вопросы (FAQ)', type: 'FAQ' }
    ],
    relatedCount: 12
  }
}
