import type { SpecProcessRow } from './specV04DemoData'

const STORAGE_PREFIX = 'orch-meeting-done:'

export function meetingDoneStorageKey(entryId: string, start: string): string {
  return `${STORAGE_PREFIX}${entryId}:${start}`
}

/** Row id: `meet:{entryId}:{start}` (start may contain `:` in ISO timestamps). */
export function parseMeetProcessRowId(rowId: string): { entryId: string; start: string } | null {
  if (!rowId.startsWith('meet:')) return null
  const body = rowId.slice(5)
  const sep = body.indexOf(':')
  if (sep < 0) return { entryId: body, start: '' }
  return { entryId: body.slice(0, sep), start: body.slice(sep + 1) }
}

export function isMeetingRowId(rowId: string): boolean {
  return rowId.startsWith('meet:')
}

export function readMeetingDone(entryId: string, start: string): boolean {
  try {
    return localStorage.getItem(meetingDoneStorageKey(entryId, start)) === '1'
  } catch {
    return false
  }
}

export function writeMeetingDone(entryId: string, start: string, done: boolean): void {
  try {
    const key = meetingDoneStorageKey(entryId, start)
    if (done) localStorage.setItem(key, '1')
    else localStorage.removeItem(key)
  } catch {
    /* ignore quota / private mode */
  }
}

export function isMeetingProcessRowDone(rowId: string): boolean {
  const parsed = parseMeetProcessRowId(rowId)
  if (!parsed) return false
  return readMeetingDone(parsed.entryId, parsed.start)
}

export function applyMeetingDoneToRow(row: SpecProcessRow, done: boolean): SpecProcessRow {
  if (!done) return row
  return {
    ...row,
    progress: 100,
    status: 'Выполнен',
    statusTone: 'green',
    taskToday: '—'
  }
}
