import { DecisionsTab } from '../../workplace/DecisionsWorkplace'

export function DecisionsGridTab({
  onOpenRun
}: {
  onOpenRun: (workflowId: string, title: string, runId?: string) => void
}): React.JSX.Element {
  return <DecisionsTab onOpenRun={onOpenRun} inGridShell />
}
