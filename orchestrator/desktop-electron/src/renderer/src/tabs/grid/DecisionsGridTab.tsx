import { DecisionsTab } from '../../workplace/DecisionsWorkplace'
import { HeavyTabEmbed } from './HeavyTabEmbed'

export function DecisionsGridTab({
  onOpenRun
}: {
  onOpenRun: (workflowId: string, title: string, runId?: string) => void
}): React.JSX.Element {
  return (
    <HeavyTabEmbed>
      <DecisionsTab onOpenRun={onOpenRun} />
    </HeavyTabEmbed>
  )
}
