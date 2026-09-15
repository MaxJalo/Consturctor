export type AdminBadgeTone = 'success' | 'warning' | 'error' | 'info' | 'neutral'

interface AdminStatusBadgeProps {
  label: string
  tone?: AdminBadgeTone
}

const TONE_CLASS: Record<AdminBadgeTone, string> = {
  success: 'admin-status-badge--success',
  warning: 'admin-status-badge--warning',
  error: 'admin-status-badge--error',
  info: 'admin-status-badge--info',
  neutral: 'admin-status-badge--neutral'
}

export function AdminStatusBadge({ label, tone = 'neutral' }: AdminStatusBadgeProps): React.JSX.Element {
  return (
    <span className={`admin-status-badge ${TONE_CLASS[tone]}`}>
      <i aria-hidden />
      {label}
    </span>
  )
}
