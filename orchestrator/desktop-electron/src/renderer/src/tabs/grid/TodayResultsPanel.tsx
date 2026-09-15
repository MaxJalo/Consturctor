import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { SpecPanel, SpecPill } from '../../workplace/specV04Components'
import {
  type TodayAgentResultItem,
  useTodayAgentResults
} from '../../workplace/useTodayAgentResults'

function ResultIcon({ kind }: { kind: TodayAgentResultItem['kind'] }): React.JSX.Element {
  return (
    <span className={`today-file-ico kind-${kind}`}>
      {kind === 'doc' ? 'W' : kind === 'pdf' ? 'PDF' : 'XL'}
    </span>
  )
}

export function TodayResultsPanel({
  periodDay,
  userId,
  onOpenRun
}: {
  periodDay: Date
  userId?: string
  onOpenRun?: (workflowId: string, title: string, runId?: string) => void
}): React.JSX.Element {
  const { loading, error, items } = useTodayAgentResults(periodDay, userId)
  const [menuId, setMenuId] = useState('')
  const [downloadingId, setDownloadingId] = useState('')

  useEffect(() => {
    function onDoc(event: MouseEvent): void {
      const target = event.target as Node | null
      if (!target || !(target instanceof Element)) return
      if (!target.closest('.today-results-actions')) setMenuId('')
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  async function downloadFile(file: TodayAgentResultItem): Promise<void> {
    if (!file.downloadUrl || downloadingId) return
    setDownloadingId(file.id)
    try {
      await api.download(file.downloadUrl, file.name)
    } finally {
      setDownloadingId('')
    }
  }

  const body = ((): React.ReactNode => {
    if (loading) {
      return <p className="today-table-status">Загружаем…</p>
    }
    if (error) {
      return <p className="today-table-status today-table-error">{error}</p>
    }
    if (!items.length) {
      return <p className="today-table-status">Нет файлов от агентов за выбранный день</p>
    }
    return (
      <ul className="today-results-list">
        {items.map((file) => (
          <li key={file.id} className="today-results-item">
            <ResultIcon kind={file.kind} />
            <div className="today-results-meta">
              <strong title={file.name}>{file.name}</strong>
              <SpecPill tone={file.tagTone}>{file.tag}</SpecPill>
            </div>
            <div className="today-results-actions">
              <button
                type="button"
                className="today-link-btn"
                disabled={!file.downloadUrl || downloadingId === file.id}
                onClick={() => void downloadFile(file)}
              >
                {downloadingId === file.id ? '…' : 'Скачать'}
              </button>
              <button
                type="button"
                className="today-menu-btn"
                aria-label="Действия"
                aria-expanded={menuId === file.id}
                onClick={() => setMenuId((current) => (current === file.id ? '' : file.id))}
              >
                ⋯
              </button>
              {menuId === file.id ? (
                <div className="files-menu today-results-menu">
                  <button
                    type="button"
                    disabled={!file.downloadUrl}
                    onClick={() => {
                      setMenuId('')
                      void downloadFile(file)
                    }}
                  >
                    Скачать
                  </button>
                  {file.workflowId && file.runId && onOpenRun ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuId('')
                        onOpenRun(file.workflowId!, '', file.runId)
                      }}
                    >
                      Открыть запуск
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    )
  })()

  return (
    <SpecPanel title="Результаты дня">
      {body}
    </SpecPanel>
  )
}
