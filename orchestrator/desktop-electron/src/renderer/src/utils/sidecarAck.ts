export type SidecarAck = {
  ok?: boolean
  queued?: boolean
  error?: string
  reason?: string
}

/** Map Electron IPC errors (missing main handler vs sidecar failure). */
export function formatIpcInvokeError(detail: string): string {
  const text = detail.trim()
  if (!text) return text
  if (/no handler registered/i.test(text)) {
    return (
      'Main-процесс Electron без IPC-обработчика — полностью закройте окно и терминал dev, ' +
      'затем снова запустите orchestrator\\orchestrator\\desktop-electron\\run_dev.bat'
    )
  }
  return text
}

/** Immediate IPC failure text when main did not accept the sidecar command. */
export function sidecarAckFailureMessage(ack: SidecarAck | void, fallback: string): string | null {
  if (!ack || ack.ok !== false) return null
  const detail = String(ack.error || '').trim()
  if (detail) return detail
  if (ack.reason === 'start_failed') {
    return 'Sidecar не запущен — проверьте Python и pybridge/agent_sidecar.py (run_dev.bat)'
  }
  if (ack.reason === 'write_failed') {
    return 'Sidecar не принял команду (ошибка stdin) — перезапустите Orchestrator'
  }
  return fallback
}
