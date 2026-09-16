import type { WorkplaceAgent } from './WorkplaceBoard'
import type { SpecMailRow, SpecPillTone, SpecProcessRow, SpecProjectRow, SpecTaskRow } from './specV04DemoData'

function toneForStatus(text: string): SpecPillTone {
  const key = text.toLowerCase()
  if (key.includes('просроч') || key.includes('ошиб')) return 'red'
  if (key.includes('ожид') || key.includes('провер')) return 'orange'
  if (key.includes('выполн') || key.includes('готов')) return 'green'
  if (key.includes('работ')) return 'blue'
  return 'gray'
}

export function erpTaskToRow(task: Record<string, unknown>, actorFio: string): SpecTaskRow {
  const title = String(task.title || task.number || 'Задача 1С').trim()
  const due = String(task.due_at || '').trim()
  const done = Boolean(task.done)
  const late = Boolean(task.late)
  return {
    id: String(task.number || title),
    title,
    source: '1С',
    sourceTone: 'blue',
    process: String(task.approval || 'Документооборот'),
    project: '—',
    deadline: due || '—',
    urgent: late || (!done && due.includes(String(new Date().getDate()))),
    priority: late ? 'Высокий' : 'Средний',
    priorityTone: late ? 'red' : 'orange',
    status: done ? 'Выполнена' : 'В работе',
    statusTone: done ? 'green' : 'blue',
    executor: actorFio,
    who: 'Я',
    progress: done ? 100 : 40
  }
}

export function erpTaskToProcessRow(task: SpecTaskRow): SpecProcessRow {
  return {
    id: `erp:${task.id}`,
    name: task.title,
    code: task.id,
    type: 'Задача из 1С',
    typeTone: 'blue',
    source: '1С',
    project: task.project,
    taskToday: task.process,
    status: task.status,
    statusTone: task.statusTone,
    deadline: task.deadline,
    deadlineUrgent: task.urgent,
    progress: task.progress
  }
}

export function turboProjectToProcessRow(project: SpecProjectRow): SpecProcessRow {
  return {
    id: `proj:${project.id}`,
    name: project.name,
    code: project.code,
    type: 'Проект',
    typeTone: 'purple',
    source: 'TurboProject',
    project: project.name,
    taskToday: `${project.tasks} открытых задач`,
    status: project.status,
    statusTone: project.statusTone,
    deadline: project.deadline,
    progress: project.progress
  }
}

export function mailRowToProcessRow(mail: SpecMailRow, index: number): SpecProcessRow {
  return {
    id: `mail:${mail.id || index}`,
    name: mail.subject,
    code: `ML-${String(index + 1).padStart(2, '0')}`,
    type: 'Письмо',
    typeTone: 'orange',
    source: 'Outlook',
    project: '—',
    taskToday: 'Ответить / обработать',
    status: mail.status,
    statusTone: mail.stTone,
    deadline: mail.time ? 'Сегодня' : '—',
    progress: 35
  }
}

export function meetingToProcessRow(meeting: {
  id: string
  subject: string
  start: string
}): SpecProcessRow {
  return {
    id: `meet:${meeting.id}:${meeting.start || ''}`,
    name: meeting.subject,
    code: 'MTG',
    type: 'Совещание',
    typeTone: 'purple',
    source: 'Outlook',
    project: '—',
    taskToday: 'Подготовиться',
    status: 'Не начат',
    statusTone: 'gray',
    deadline: meeting.start ? meeting.start.slice(0, 16) : '—',
    progress: 20
  }
}

export function agentToProcessRow(agent: WorkplaceAgent): SpecProcessRow {
  const progress =
    agent.status === 'COMPLETED' ? 100 : agent.status === 'READY' ? 0 : agent.status === 'ACTIVE' ? 55 : 30
  return {
    id: agent.workflowId,
    name: agent.name,
    code: agent.code || agent.workflowId.slice(0, 8),
    type: 'Регламент',
    typeTone: 'green',
    source: 'Оркестратор',
    project: '—',
    taskToday: agent.stage || '—',
    status:
      agent.status === 'ACTIVE'
        ? 'В работе'
        : agent.status === 'WAITING_HUMAN'
          ? 'Ожидает'
          : agent.status === 'COMPLETED'
            ? 'Выполнен'
            : 'В работе',
    statusTone: agent.status === 'WAITING_HUMAN' ? 'orange' : 'blue',
    deadline: agent.due && agent.due !== 'нет слота' ? agent.due : '—',
    progress
  }
}

export function turboProjectToRow(item: Record<string, unknown>): SpecProjectRow {
  const name = String(item.project_name || item.title || item.name || 'Проект').trim()
  const fileId = String(item.file_id || item.fileId || '').trim()
  const code = String(item.project_code || fileId || item.id || '').trim() || '—'
  const progressRaw = Number(item.percent_complete ?? item.progress ?? 0)
  const progress = Number.isFinite(progressRaw) ? Math.round(progressRaw) : 0
  const risk = String(item.risk || item.status_risk || '').toLowerCase()
  let riskLabel = 'Нет'
  let riskTone: SpecPillTone = 'green'
  if (risk.includes('high') || risk.includes('высок')) {
    riskLabel = 'Высокий'
    riskTone = 'red'
  } else if (risk.includes('risk') || risk.includes('риск')) {
    riskLabel = 'Есть риск'
    riskTone = 'orange'
  }
  return {
    id: fileId || code,
    name,
    code,
    role: String(item.role || item.participant_role || 'Участник'),
    tasks: Number(item.open_tasks ?? item.tasks_count ?? 0) || 0,
    status: 'В работе',
    statusTone: 'blue',
    deadline: String(item.finish_date || item.deadline || '—'),
    progress,
    risk: riskLabel,
    riskTone
  }
}

function mailAttachments(msg: Record<string, unknown>): { name: string }[] {
  const raw = msg.attachments
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (typeof item === 'string') return { name: item }
      if (item && typeof item === 'object' && 'name' in item) {
        return { name: String((item as { name?: unknown }).name || '') }
      }
      return { name: '' }
    })
    .filter((item) => item.name)
}

export function outlookMessageToMailRow(msg: Record<string, unknown>, index: number): SpecMailRow {
  const subject = String(msg.subject || 'Без темы')
  const rawTime = String(msg.datetime || msg.received_at || msg.sent_at || '')
  const direction = String(msg.direction || 'inbox')
  const body = String(msg.body_preview || msg.body || '').trim()
  const unread = Boolean(msg.unread)
  return {
    id: String(msg.entry_id ?? msg.uid ?? index),
    sender: String(msg.sender || msg.from || '—'),
    subject,
    category: direction === 'sent' ? 'Отправленные' : 'Входящие',
    catTone: 'blue',
    link: '—',
    time: rawTime,
    priority: 'Средний',
    priTone: 'orange',
    status: unread ? 'Непрочитано' : direction === 'sent' ? 'Отправлено' : 'Прочитано',
    stTone: unread ? 'orange' : direction === 'sent' ? 'green' : 'gray',
    assignee: '—',
    to: String(msg.to || '').trim() || undefined,
    body: body || undefined,
    preview: body ? body.replace(/\s+/g, ' ').slice(0, 140) : undefined,
    receivedLabel: rawTime || undefined,
    unread,
    attachments: mailAttachments(msg)
  }
}

export function imapMessageToMailRow(msg: Record<string, unknown>, index: number): {
  id: string
  sender: string
  subject: string
  category: string
  catTone: SpecPillTone
  link: string
  time: string
  priority: string
  priTone: SpecPillTone
  status: string
  stTone: SpecPillTone
  assignee: string
} {
  const subject = String(msg.subject || 'Без темы')
  return {
    id: String(msg.uid ?? msg.id ?? index),
    sender: String(msg.from || msg.sender || '—'),
    subject,
    category: 'Почта',
    catTone: 'blue',
    link: '—',
    time: String(msg.date || msg.received_at || ''),
    priority: 'Средний',
    priTone: 'orange',
    status: 'К обработке',
    stTone: 'orange',
    assignee: '—'
  }
}

export { toneForStatus }
