import { parseWorkplaceKpiDashboard, type WorkplaceKpiDashboard } from './workplaceKpiTypes'

const MONTHS_RU = [
  'янв.',
  'февр.',
  'марта',
  'апр.',
  'мая',
  'июня',
  'июля',
  'авг.',
  'сент.',
  'окт.',
  'ноб.',
  'дек.'
]

function parseDay(iso: string, fallback: string): Date {
  const raw = (iso || '').trim() || fallback
  const d = new Date(`${raw}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return new Date(`${fallback}T12:00:00Z`)
  return d
}

function periodLabel(from: Date, to: Date): string {
  const lo = from <= to ? from : to
  const hi = from <= to ? to : from
  const fmt = (d: Date) => `${d.getUTCDate()} ${MONTHS_RU[d.getUTCMonth()]} ${d.getUTCFullYear()}`
  if (lo.getTime() === hi.getTime()) return fmt(lo)
  if (lo.getUTCFullYear() === hi.getUTCFullYear() && lo.getUTCMonth() === hi.getUTCMonth()) {
    return `${lo.getUTCDate()}–${hi.getUTCDate()} ${MONTHS_RU[lo.getUTCMonth()]} ${lo.getUTCFullYear()}`
  }
  return `${fmt(lo)} – ${fmt(hi)}`
}

function xLabelsForRange(from: Date, to: Date): string[] {
  const lo = from <= to ? from : to
  const hi = from <= to ? to : from
  const labels: string[] = []
  const cursor = new Date(lo)
  while (cursor <= hi) {
    labels.push(
      `${String(cursor.getUTCDate()).padStart(2, '0')}.${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`
    )
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return labels
}

/** Embedded reference dashboard (mirrors backend `_reference_dashboard`) for offline dev. */
export function buildReferenceWorkplaceKpiDashboard(
  periodFrom = '2024-08-12',
  periodTo = '2024-08-18'
): WorkplaceKpiDashboard {
  const dayFrom = parseDay(periodFrom, '2024-08-12')
  const dayTo = parseDay(periodTo, '2024-08-18')
  const fromIso = dayFrom.toISOString().slice(0, 10)
  const toIso = dayTo.toISOString().slice(0, 10)
  const xLabels = xLabelsForRange(dayFrom, dayTo)
  const raw = {
    periodFrom: fromIso,
    periodTo: toIso,
    periodLabel: periodLabel(dayFrom, dayTo),
    cards: [
      {
        id: 'tasks',
        label: 'Выполнение задач',
        displayValue: '78%',
        trend: '(+12%)',
        progress: 78,
        tone: 'orange',
        source: 'reference'
      },
      {
        id: 'sla',
        label: 'SLA',
        displayValue: '92%',
        progress: 92,
        tone: 'blue',
        source: 'reference'
      },
      {
        id: 'load',
        label: 'Загрузка',
        displayValue: '76%',
        progress: 76,
        tone: 'purple',
        source: 'reference'
      },
      {
        id: 'ai',
        label: 'Эффективность ИИ',
        displayValue: '94%',
        progress: 94,
        tone: 'green',
        source: 'reference'
      },
      {
        id: 'auto',
        label: 'Доля автоматизации',
        displayValue: '62%',
        progress: 62,
        tone: 'yellow',
        source: 'reference'
      },
      {
        id: 'quality',
        label: 'Качество',
        displayValue: '4.7',
        trend: 'из 5',
        ring: false,
        tone: 'lilac',
        source: 'reference'
      }
    ],
    agents: [
      {
        id: 'rig-01',
        code: 'RIG-01',
        name: 'Контроль регламентов',
        process: 'Регламентные работы',
        completionPct: 91,
        slaPct: 96,
        loadPct: 82,
        automationPct: 68,
        status: 'В норме',
        statusTone: 'green',
        source: 'reference'
      },
      {
        id: 'rep-03',
        code: 'REP-03',
        name: 'Отчётность KPI',
        process: 'Еженедельный отчёт',
        completionPct: 85,
        slaPct: 94,
        loadPct: 74,
        automationPct: 58,
        status: 'В норме',
        statusTone: 'green',
        source: 'reference'
      },
      {
        id: 'ml-06',
        code: 'ML-06',
        name: 'Обработка почты',
        process: 'Входящие письма',
        completionPct: 79,
        slaPct: 88,
        loadPct: 71,
        automationPct: 55,
        status: 'Внимание',
        statusTone: 'orange',
        source: 'reference'
      },
      {
        id: 'reg-02',
        code: 'REG-02',
        name: 'Согласование договоров',
        process: 'Закупки',
        completionPct: 72,
        slaPct: 90,
        loadPct: 65,
        automationPct: 48,
        status: 'Внимание',
        statusTone: 'orange',
        source: 'reference'
      }
    ],
    problemZones: [
      {
        id: 'pz1',
        zone: 'Согласование договоров',
        metric: 'SLA',
        value: '88%',
        severity: 'orange',
        recommendation: 'Сократить время ответа сотрудника на запросы агента',
        source: 'reference'
      },
      {
        id: 'pz2',
        zone: 'Отчётность KPI',
        metric: 'Загрузка',
        value: '74%',
        severity: 'orange',
        recommendation: 'Пик нагрузки ср–чт — перенести часть запусков',
        source: 'reference'
      },
      {
        id: 'pz3',
        zone: 'Обработка почты',
        metric: 'Автоматизация',
        value: '55%',
        severity: 'red',
        recommendation: 'Добавить шаблоны ответов и правила маршрутизации',
        source: 'reference'
      }
    ],
    workloadCompare: [
      { id: 'c1', label: 'Регламенты', employee: 12, ai: 28, source: 'reference' },
      { id: 'c2', label: 'Отчётность', employee: 18, ai: 22, source: 'reference' },
      { id: 'c3', label: 'Почта', employee: 24, ai: 16, source: 'reference' },
      { id: 'c4', label: 'Задачи 1С', employee: 32, ai: 14, source: 'reference' }
    ],
    dynamics: {
      title: 'Динамика показателей',
      xLabels: xLabels.length ? xLabels : ['12.08', '13.08', '14.08', '15.08', '16.08', '17.08', '18.08'],
      yMax: 100,
      series: [
        {
          id: 'tasks',
          label: 'Выполнение задач',
          color: '#e8943a',
          points: [66, 68, 70, 72, 74, 76, 78]
        },
        {
          id: 'ai',
          label: 'Эффективность ИИ',
          color: '#08745f',
          points: [88, 89, 90, 91, 92, 93, 94]
        }
      ],
      source: 'reference'
    },
    generatedAt: new Date().toISOString()
  }
  return parseWorkplaceKpiDashboard(raw)
}
