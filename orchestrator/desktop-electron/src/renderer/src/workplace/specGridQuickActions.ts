import { invokeLocalAcTool } from '../utils/localAcTool'

export type SpecQuickActionTone = 'green' | 'orange' | 'blue' | 'yellow'

export interface SpecQuickActionDef {
  id: string
  label: string
  tone: SpecQuickActionTone
  run: () => void | Promise<void>
}

/** Клик по «Запустить процесс» в шапке сетки (тот же UI, что в tabRegistry). */
export function triggerHeaderQuickLaunch(): void {
  document.querySelector<HTMLButtonElement>('.orch-grid-header-actions .spec-btn-launch')?.click()
}

async function runPowerShell(command: string): Promise<void> {
  await invokeLocalAcTool('workspace.powershell_run', {
    command,
    runtime_context: { agent_id: 'orch-grid' }
  })
}

/** Открыть Outlook на виде календаря (shell) или поднять окно Outlook. */
export async function openOutlookCalendarView(): Promise<void> {
  await runPowerShell(
    '$ol = New-Object -ComObject Outlook.Application -ErrorAction SilentlyContinue; if ($ol) { $ol.ActiveExplorer().ShowFolder($ol.Session.GetDefaultFolder(9)) } else { Start-Process outlook }'
  )
}

/** Подключение к базе 1С через COM (открывает клиент при необходимости). */
export async function launch1cClient(): Promise<void> {
  await invokeLocalAcTool('onec.search_tasks', { mine_only: true, limit: 1 })
}

/** Создание задачи: COM-сессия 1С (форма задачи — в клиенте). */
export async function open1cTaskCreation(): Promise<void> {
  const res = await invokeLocalAcTool('onec.search_tasks', { mine_only: true, limit: 1 })
  if (!res.ok) {
    await launch1cClient()
  }
}

export function buildProcessesQuickActions(_handlers: Record<string, never> = {}): SpecQuickActionDef[] {
  return [
    {
      id: 'launch-process',
      label: 'Запустить новый процесс',
      tone: 'green',
      run: () => {
        triggerHeaderQuickLaunch()
      }
    },
    {
      id: 'create-1c-task',
      label: 'Создать задачу в 1С',
      tone: 'orange',
      run: () => void open1cTaskCreation()
    },
    {
      id: 'open-outlook-cal',
      label: 'Открыть календарь Outlook',
      tone: 'blue',
      run: () => void openOutlookCalendarView()
    },
    {
      id: 'goto-1c',
      label: 'Перейти в 1С',
      tone: 'yellow',
      run: () => void launch1cClient()
    }
  ]
}
