import { useCallback, useState } from 'react'
import {
  isMeetingProcessRowDone,
  isMeetingRowId,
  parseMeetProcessRowId,
  writeMeetingDone
} from './meetingCompletion'

export function useMeetingCompletion(): {
  revision: number
  isDone: (rowId: string) => boolean
  setDone: (rowId: string, done: boolean) => void
  toggle: (rowId: string) => void
} {
  const [revision, setRevision] = useState(0)

  const isDone = useCallback(
    (rowId: string): boolean => {
      void revision
      return isMeetingProcessRowDone(rowId)
    },
    [revision]
  )

  const setDone = useCallback((rowId: string, done: boolean): void => {
    const parsed = parseMeetProcessRowId(rowId)
    if (!parsed) return
    writeMeetingDone(parsed.entryId, parsed.start, done)
    setRevision((n) => n + 1)
  }, [])

  const toggle = useCallback(
    (rowId: string): void => {
      if (!isMeetingRowId(rowId)) return
      setDone(rowId, !isMeetingProcessRowDone(rowId))
    },
    [setDone]
  )

  return { revision, isDone, setDone, toggle }
}
