import type { SpecPillTone } from '../../workplace/specV04DemoData'

export type TodayPlanLane = 'meetings' | 'ai' | 'lunch'

/** Полные поля для модалки «План на день». */
export type TodayPlanBlockDetail = {
  timeRange: string
  typeLabel: string
  location?: string
  format?: string
  organizer?: string
  participants?: string
  workflowId?: string
  runId?: string
  status?: string
  source?: string
  agentName?: string
  note?: string
}

export type TodayPlanBlock = {
  id: string
  startHour: number
  endHour: number
  title: string
  subtitle?: string
  tone: 'pink' | 'sky' | 'mint' | 'orange' | 'purple' | 'teal' | 'blue'
  who: 'employee' | 'ai' | 'both'
  kind: 'meet' | 'onec' | 'reg' | 'mail' | 'proj' | 'doc'
  lane?: TodayPlanLane
  detail?: TodayPlanBlockDetail
}

/** Блоки плана — по макету ТЗ (09:00–18:00). */
export const TODAY_PLAN_BLOCKS: TodayPlanBlock[] = [
  {
    id: 'm1',
    startHour: 9,
    endHour: 10,
    title: 'Утренняя планерка',
    tone: 'pink',
    who: 'employee',
    kind: 'meet'
  },
  {
    id: 't1',
    startHour: 10,
    endHour: 11.5,
    title: 'Задачи из 1С',
    tone: 'sky',
    who: 'ai',
    kind: 'onec'
  },
  {
    id: 'r1',
    startHour: 11.5,
    endHour: 12.5,
    title: 'Подготовка отчёта',
    subtitle: 'Регламентная работа',
    tone: 'mint',
    who: 'both',
    kind: 'reg'
  },
  {
    id: 'e1',
    startHour: 13,
    endHour: 14,
    title: 'Обработка писем',
    tone: 'orange',
    who: 'employee',
    kind: 'mail'
  },
  {
    id: 'm2',
    startHour: 14,
    endHour: 15,
    title: 'Совещание по проекту',
    tone: 'purple',
    who: 'employee',
    kind: 'meet'
  },
  {
    id: 'd1',
    startHour: 15,
    endHour: 16,
    title: 'Проверка документов',
    tone: 'teal',
    who: 'ai',
    kind: 'doc'
  },
  {
    id: 'p1',
    startHour: 16.5,
    endHour: 17.5,
    title: 'Разработка ТЗ',
    tone: 'blue',
    who: 'both',
    kind: 'proj'
  }
]

export type TodayResultFile = {
  id: string
  name: string
  kind: 'doc' | 'pdf' | 'xls'
  tag: string
  tagTone: SpecPillTone
}

export const TODAY_RESULT_FILES: TodayResultFile[] = [
  { id: 'f1', name: 'Повестка совещания.docx', kind: 'doc', tag: 'ИИ', tagTone: 'purple' },
  { id: 'f2', name: 'Сравнение КП.pdf', kind: 'pdf', tag: 'ИИ', tagTone: 'purple' },
  { id: 'f3', name: 'Отчёт по задачам.xlsx', kind: 'xls', tag: 'Сотрудник', tagTone: 'blue' },
  { id: 'f4', name: 'Проект решения.docx', kind: 'doc', tag: 'ИИ', tagTone: 'purple' }
]

export type TodayProjectTaskRow = {
  id: string
  title: string
  deadline: string
  status: string
  statusTone: SpecPillTone
  assignee: string
  assigneeTone: SpecPillTone
}

export const TODAY_PROJECT_TASK_ROWS: TodayProjectTaskRow[] = [
  {
    id: 'pt1',
    title: 'Интеграция API CRM',
    deadline: '14.08',
    status: 'В работе',
    statusTone: 'blue',
    assignee: 'Сотрудник',
    assigneeTone: 'blue'
  },
  {
    id: 'pt2',
    title: 'Тестирование модуля отчётов',
    deadline: '16.08',
    status: 'Запланировано',
    statusTone: 'gray',
    assignee: 'ИИ',
    assigneeTone: 'purple'
  },
  {
    id: 'pt3',
    title: 'Согласование ТЗ с заказчиком',
    deadline: 'Сегодня',
    status: 'Ожидание',
    statusTone: 'orange',
    assignee: 'Сотрудник',
    assigneeTone: 'blue'
  }
]

export type TodayPreparedDecision = {
  id: string
  title: string
  status: string
  statusTone: SpecPillTone
  tag: string
  tagTone: SpecPillTone
}

export const TODAY_PREPARED_DECISIONS: TodayPreparedDecision[] = [
  {
    id: 'pd1',
    title: 'Утвердить поставщика ООО «ТехноСервис»',
    status: 'Готово',
    statusTone: 'green',
    tag: 'ИИ',
    tagTone: 'purple'
  },
  {
    id: 'pd2',
    title: 'Согласовать перенос этапа CRM',
    status: 'На проверке',
    statusTone: 'orange',
    tag: 'Сотрудник',
    tagTone: 'blue'
  },
  {
    id: 'pd3',
    title: 'Подписать акт выполненных работ',
    status: 'Черновик',
    statusTone: 'gray',
    tag: 'ИИ',
    tagTone: 'purple'
  }
]

export const TODAY_TIMELINE_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
