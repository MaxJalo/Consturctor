import type {
  AdminAiAgentsMock,
  AdminHistoryMock,
  AdminKnowledgeBaseMock,
  AdminKpiMock,
  AdminLaunchCalendarMock,
  AdminOverviewMock,
  AdminUsersMock
} from '../mocks/adminMocks'

const EMPTY_DYNAMICS = {
  title: 'Динамика запусков агентов',
  yMax: 10,
  yTicks: [0, 5, 10],
  xLabels: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  series: [
    { id: 'success', label: 'Успешные', color: '#2f9e44', points: [0, 0, 0, 0, 0, 0, 0] },
    { id: 'processing', label: 'В обработке', color: '#1a73e8', points: [0, 0, 0, 0, 0, 0, 0] },
    { id: 'errors', label: 'С ошибками', color: '#e55353', points: [0, 0, 0, 0, 0, 0, 0] }
  ],
  legend: [
    { id: 'success', label: 'Успешные', color: '#2f9e44' },
    { id: 'processing', label: 'В обработке', color: '#1a73e8' },
    { id: 'errors', label: 'С ошибками', color: '#e55353' }
  ]
}

export const emptyAdminOverview: AdminOverviewMock = {
  breadcrumb: 'Обзор — Сводная панель администратора',
  dashboardTitle: 'Сводная панель',
  dashboardSubtitle: 'Ключевые показатели системы ИИ-агентов',
  periodLabel: 'Период: Неделя',
  dateRange: '',
  refreshLabel: 'Обновить',
  metrics: [],
  launchDynamics: EMPTY_DYNAMICS,
  agentStatuses: { title: 'Статусы агентов', total: 0, slices: [] },
  integrations: []
}

export const emptyAdminHistory: AdminHistoryMock = {
  breadcrumb: 'История',
  title: 'История',
  subtitle: 'Просмотр запусков по всем аккаунтам',
  periodLabel: 'Период: Неделя',
  dateRange: '',
  tabs: [
    { id: 'processes', label: 'Процессы' },
    { id: 'tasks', label: 'Задачи' },
    { id: 'letters', label: 'Письма' },
    { id: 'project_tasks', label: 'Задачи по проектам' }
  ],
  activeTab: 'processes',
  filters: [],
  rows: [],
  pagination: { pageSize: 10, total: 0 }
}

export const emptyAdminCalendar: AdminLaunchCalendarMock = {
  breadcrumb: 'Календарь запуска',
  title: 'Календарь запуска',
  subtitle: 'Расписания агентов по всем аккаунтам',
  periodLabel: 'Период: Неделя',
  dateRange: '',
  createLabel: 'Создать',
  viewModes: ['Неделя', 'Месяц'],
  activeView: 'Неделя',
  weekRange: '',
  days: [],
  hours: [],
  events: [],
  agentFilters: [{ id: 'all', label: 'Все агенты', color: '#1a73e8', checked: true }],
  miniMonth: '',
  miniDays: [],
  unscheduled: [],
  scheduleAllLabel: 'Запланировать все'
}

export const emptyAdminKpi: AdminKpiMock = {
  breadcrumb: 'KPI',
  title: 'KPI',
  subtitle: 'Показатели запусков по всем аккаунтам',
  periodLabel: 'Период: Месяц',
  dateRange: '',
  tabs: [
    { id: 'general', label: 'Общие' },
    { id: 'agents', label: 'Агенты' }
  ],
  activeTab: 'general',
  summaries: [],
  agentCards: [],
  dynamics: EMPTY_DYNAMICS,
  topAgents: [],
  gauges: []
}

export const emptyAdminUsers: AdminUsersMock = {
  breadcrumb: 'Пользователи',
  title: 'Пользователи',
  subtitle: 'Учётные записи приложения',
  addLabel: 'Добавить',
  filters: [],
  rows: [],
  pagination: { pageSize: 5, total: 0 }
}

export const emptyAdminAiAgents: AdminAiAgentsMock = {
  breadcrumb: 'ИИ-агенты',
  title: 'ИИ-агенты',
  subtitle: 'Агенты всех аккаунтов',
  createLabel: 'Создать',
  importLabel: 'Импорт',
  filters: [],
  rows: [],
  pagination: { pageSize: 5, total: 0 },
  detail: {
    name: '',
    status: '',
    statusTone: 'neutral',
    description: '',
    tabs: [],
    activeTab: '',
    info: [],
    metrics: [],
    processes: []
  }
}

export const emptyAdminKnowledge: AdminKnowledgeBaseMock = {
  breadcrumb: 'База знаний',
  title: 'База знаний',
  subtitle: 'Файлы и регламенты',
  addLabel: 'Добавить',
  filters: [],
  rows: [],
  pagination: { pageSize: 5, total: 0 },
  document: {
    title: '',
    status: '',
    statusTone: 'neutral',
    meta: '',
    text: '',
    format: '',
    author: '',
    category: '',
    tags: [],
    usageTotal: '',
    usageTrend: '',
    usageBars: [],
    agentsShare: [],
    related: [],
    relatedCount: 0
  }
}
