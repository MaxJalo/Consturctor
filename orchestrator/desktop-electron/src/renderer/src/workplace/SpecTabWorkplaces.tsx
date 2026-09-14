import { useMemo, useState } from 'react'
import { AgentsPage } from '../pages/AgentsPage'
import { SpecV04Shell, type SpecSummaryTile } from './specV04Shell'

function demoFilters(): React.JSX.Element {
  return (
    <>
      <select className="wp-select" defaultValue="">
        <option value="">Период: текущий месяц</option>
        <option value="week">Неделя</option>
        <option value="day">Сегодня</option>
      </select>
      <select className="wp-select" defaultValue="">
        <option value="">Статус: все</option>
      </select>
      <input className="wp-search" placeholder="Поиск" />
      <button type="button" className="btn-ghost">
        Сбросить фильтры
      </button>
    </>
  )
}

function SpecTablePlaceholder({
  columns,
  empty
}: {
  columns: string[]
  empty: string
}): React.JSX.Element {
  return (
    <div className="spec-v04-table-wrap wp-card">
      <table className="spec-v04-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={columns.length} className="spec-v04-empty">
              {empty}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function TasksTabWorkplace({
  onAskOrchestrator
}: {
  onAskOrchestrator: (message: string, context: string) => void
}): React.JSX.Element {
  const tiles: SpecSummaryTile[] = useMemo(
    () => [
      { id: 'all', label: 'Все задачи', value: '—', tone: 'blue' },
      { id: 'onec', label: 'Из 1С', value: '—', tone: 'blue' },
      { id: 'proj', label: 'Проектные', value: '—', tone: 'purple' },
      { id: 'reg', label: 'Регламентные', value: '—', tone: 'green' },
      { id: 'bad', label: 'Просроченные / ожидающие', value: '—', tone: 'orange' }
    ],
    []
  )
  return (
    <SpecV04Shell
      title="Задачи"
      subtitle="Единый центр управления задачами сотрудника"
      tiles={tiles}
      filters={demoFilters()}
      onAskOrchestrator={(message) => onAskOrchestrator(message, 'Вкладка «Задачи»')}
    >
      <SpecTablePlaceholder
        columns={[
          'Задача',
          'Источник',
          'Процесс',
          'Проект',
          'Срок',
          'Приоритет',
          'Статус',
          'Исполнитель',
          'Кто выполняет',
          'Прогресс',
          'Действия'
        ]}
        empty="Подключите Task Service и 1С — таблица задач появится здесь."
      />
      <section className="wp-card spec-v04-side-block">
        <h3>Мои задачи на сегодня</h3>
        <p className="spec-v04-muted">Упрощённый список актуальных задач текущего дня.</p>
      </section>
    </SpecV04Shell>
  )
}

export function ProjectsTabWorkplace({
  onAskOrchestrator
}: {
  onAskOrchestrator: (message: string, context: string) => void
}): React.JSX.Element {
  const tiles: SpecSummaryTile[] = [
    { id: 'active', label: 'Активные проекты', value: '—', tone: 'purple' },
    { id: 'today', label: 'Задачи на сегодня', value: '—', tone: 'purple' },
    { id: 'risk', label: 'С риском', value: '—', tone: 'orange' },
    { id: 'done', label: 'Завершённые этапы', value: '—', tone: 'green' },
    { id: 'load', label: 'Загрузка', value: '—', tone: 'neutral' }
  ]
  return (
    <SpecV04Shell
      title="Проекты"
      subtitle="Проектная деятельность, роли, риски и задачи на сегодня"
      tiles={tiles}
      filters={demoFilters()}
      onAskOrchestrator={(message) => onAskOrchestrator(message, 'Вкладка «Проекты»')}
    >
      <SpecTablePlaceholder
        columns={['Проект', 'Код', 'Роль', 'Мои задачи', 'Статус', 'Срок', 'Прогресс', 'Риск', 'Действия']}
        empty="Подключите Project Service — реестр проектов по спецификации v0.4."
      />
    </SpecV04Shell>
  )
}

export function MailTabWorkplace({
  onAskOrchestrator
}: {
  onAskOrchestrator: (message: string, context: string) => void
}): React.JSX.Element {
  const tiles: SpecSummaryTile[] = [
    { id: 'new', label: 'Новые', value: '—', tone: 'orange' },
    { id: 'todo', label: 'К обработке', value: '—', tone: 'orange' },
    { id: 'hi', label: 'Высокий приоритет', value: '—', tone: 'orange' },
    { id: 'proj', label: 'По проектам', value: '—', tone: 'purple' },
    { id: 'reg', label: 'По регламентам', value: '—', tone: 'green' }
  ]
  return (
    <SpecV04Shell
      title="Письма"
      subtitle="Единый центр обработки рабочей почты Outlook"
      tiles={tiles}
      filters={demoFilters()}
      onAskOrchestrator={(message) => onAskOrchestrator(message, 'Вкладка «Письма»')}
    >
      <SpecTablePlaceholder
        columns={[
          'Отправитель',
          'Тема',
          'Категория',
          'Процесс / проект',
          'Время',
          'Приоритет',
          'Статус',
          'Исполнитель'
        ]}
        empty="Интеграция Outlook Mail — список писем и карточка с вложениями и извлечёнными задачами."
      />
    </SpecV04Shell>
  )
}

export function MeetingsTabWorkplace({
  onAskOrchestrator,
  onOpenRun,
  onOpenSchedule,
  onOpenHistory
}: {
  onAskOrchestrator: (message: string, context: string) => void
  onOpenRun: (workflowId: string, runId?: string, autoStart?: boolean) => void
  onOpenSchedule: (workflowId: string, title: string) => void
  onOpenHistory: (workflowId: string, title: string) => void
}): React.JSX.Element {
  const tiles: SpecSummaryTile[] = [
    { id: 'period', label: 'За период', value: '—', tone: 'lilac' },
    { id: 'today', label: 'Сегодня', value: '—', tone: 'lilac' },
    { id: 'prep', label: 'Подготовка материалов', value: '—', tone: 'blue' },
    { id: 'dec', label: 'Требуются решения', value: '—', tone: 'orange' },
    { id: 'done', label: 'Завершённые', value: '—', tone: 'green' }
  ]
  return (
    <SpecV04Shell
      title="Совещания"
      subtitle="Календарь, подготовка материалов, повестки и поручения"
      tiles={tiles}
      filters={demoFilters()}
      onAskOrchestrator={(message) => onAskOrchestrator(message, 'Вкладка «Совещания»')}
    >
      <div className="spec-v04-meetings-embed">
        <AgentsPage
          variant="calendar"
          onOpenRun={onOpenRun}
          onOpenSchedule={onOpenSchedule}
          onOpenHistory={onOpenHistory}
        />
      </div>
    </SpecV04Shell>
  )
}

export function KnowledgeTabWorkplace({
  onAskOrchestrator
}: {
  onAskOrchestrator: (message: string, context: string) => void
}): React.JSX.Element {
  const [selected, setSelected] = useState('')
  const tiles: SpecSummaryTile[] = [
    { id: 'all', label: 'Документов всего', value: '—', tone: 'neutral' },
    { id: 'upd', label: 'Обновлено за период', value: '—', tone: 'neutral' },
    { id: 'reg', label: 'Регламенты', value: '—', tone: 'green' },
    { id: 'tpl', label: 'Шаблоны', value: '—', tone: 'blue' },
    { id: 'how', label: 'Статьи и инструкции', value: '—', tone: 'neutral' }
  ]
  return (
    <SpecV04Shell
      title="База знаний"
      subtitle="Регламенты, шаблоны, инструкции и связанные материалы"
      tiles={tiles}
      filters={demoFilters()}
      onAskOrchestrator={(message) => onAskOrchestrator(message, 'Вкладка «База знаний»')}
    >
      <div className="spec-v04-knowledge-layout">
        <SpecTablePlaceholder
          columns={[
            'Название',
            'Тип',
            'Раздел',
            'Процесс',
            'Проект',
            'Версия',
            'Обновлено',
            'Автор',
            'Действия'
          ]}
          empty="Knowledge Base — каталог материалов. Выберите строку для карточки справа."
        />
        <aside className="wp-card spec-v04-doc-card">
          <h3>Карточка документа</h3>
          {selected ? (
            <p>{selected}</p>
          ) : (
            <p className="spec-v04-muted">Выберите материал в каталоге — здесь версия, содержание и шаблоны.</p>
          )}
          <button type="button" className="btn-ghost" onClick={() => setSelected('')}>
            Очистить выбор
          </button>
        </aside>
      </div>
    </SpecV04Shell>
  )
}
