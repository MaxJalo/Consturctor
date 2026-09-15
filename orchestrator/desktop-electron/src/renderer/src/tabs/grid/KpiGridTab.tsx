import { KpiPage } from '../../pages/KpiPage'
import { HeavyTabEmbed } from './HeavyTabEmbed'

export function KpiGridTab({
  onOpenProcesses,
  onOpenDecisions
}: {
  onOpenProcesses: () => void
  onOpenDecisions: () => void
}): React.JSX.Element {
  return (
    <HeavyTabEmbed>
      <KpiPage onOpenProcesses={onOpenProcesses} onOpenDecisions={onOpenDecisions} />
    </HeavyTabEmbed>
  )
}
