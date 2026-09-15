import { HistoryTab } from '../../workplace/WorkplaceTabs'
import { HeavyTabEmbed } from './HeavyTabEmbed'

export function HistoryGridTab({
  onOpenRun
}: {
  onOpenRun: (workflowId: string, title: string, runId?: string) => void
}): React.JSX.Element {
  return (
    <HeavyTabEmbed>
      <HistoryTab onOpenRun={onOpenRun} />
    </HeavyTabEmbed>
  )
}
