import {
  openSavedPath,
  saveOutlookAttachment,
  type OutlookMailAttachment
} from './outlookMailActions'

export type MailAttachmentPreview =
  | { kind: 'text'; text: string; mime: string }
  | { kind: 'embed'; dataUrl: string; mime: string }
  | { kind: 'external'; hint: string; mime: string }
  | { kind: 'too_large'; path: string; size?: number }
  | { kind: 'idle' }
  | { kind: 'error'; message: string }

export type SavedAttachment = {
  index: number
  file_name: string
  path?: string
  size?: number
  saveError?: string
  preview?: MailAttachmentPreview
  previewLoading?: boolean
}

export function formatAttachmentSize(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function ensureAttachmentSaved(
  mail: { entryId?: string; id: string },
  att: OutlookMailAttachment
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  return saveOutlookAttachment(mail, att.index)
}

export async function loadAttachmentPreview(path: string): Promise<MailAttachmentPreview> {
  if (typeof window.api?.readLocalFilePreview !== 'function') {
    return { kind: 'error', message: 'Предпросмотр доступен только в Electron' }
  }
  const res = await window.api.readLocalFilePreview(path)
  if (!res.ok) {
    if (res.tooLarge && res.path) {
      return { kind: 'too_large', path: res.path, size: res.size }
    }
    return { kind: 'error', message: res.error || 'Не удалось загрузить предпросмотр' }
  }
  if (res.kind === 'text') return { kind: 'text', text: res.text, mime: res.mime }
  if (res.kind === 'embed') return { kind: 'embed', dataUrl: res.dataUrl, mime: res.mime }
  return { kind: 'external', hint: res.hint, mime: res.mime }
}

export async function downloadAttachmentCopy(
  path: string,
  defaultName: string
): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  if (typeof window.api?.copyLocalFile !== 'function') {
    return { ok: false, error: 'Сохранение доступно только в Electron' }
  }
  const res = await window.api.copyLocalFile({ sourcePath: path, defaultName })
  if (res.canceled) return { ok: false, canceled: true }
  if (!res.ok) return { ok: false, error: res.error || 'Не удалось сохранить' }
  return { ok: true }
}

export async function openAttachmentExternally(path: string): Promise<{ ok: boolean; error?: string }> {
  return openSavedPath(path)
}
