import { BarChart3, Calculator, Calendar, FileText, ShoppingCart, type LucideIcon } from 'lucide-react'

const ICONS: Record<string, { Icon: LucideIcon; tone: string }> = {
  meet: { Icon: Calendar, tone: 'blue' },
  kp: { Icon: FileText, tone: 'purple' },
  proc: { Icon: ShoppingCart, tone: 'green' },
  analytics: { Icon: BarChart3, tone: 'teal' },
  fin: { Icon: Calculator, tone: 'orange' }
}

interface KpiAgentCardIconProps {
  agentId: string
}

export function KpiAgentCardIcon({ agentId }: KpiAgentCardIconProps): React.JSX.Element {
  const config = ICONS[agentId] ?? ICONS.meet
  const { Icon, tone } = config
  return (
    <span className={`admin-kpi-agent-card__icon admin-kpi-agent-card__icon--${tone}`} aria-hidden>
      <Icon size={18} strokeWidth={2} />
    </span>
  )
}
