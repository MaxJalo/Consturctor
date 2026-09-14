import type { AdminSlaTone } from '../../../mocks/adminMocks'

interface AdminSlaIndicatorProps {
  tone: AdminSlaTone
}

export function AdminSlaIndicator({ tone }: AdminSlaIndicatorProps): React.JSX.Element {
  if (tone === 'ok') {
    return (
      <span className="admin-sla admin-sla--ok" aria-label="SLA выполнен">
        <svg viewBox="0 0 16 16">
          <path d="M4 8.5l2.5 2.5 5.5-6" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </svg>
      </span>
    )
  }
  if (tone === 'fail') {
    return (
      <span className="admin-sla admin-sla--fail" aria-label="SLA не выполнен">
        <svg viewBox="0 0 16 16">
          <path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
    )
  }
  return (
    <span className="admin-sla admin-sla--warn" aria-label="SLA под риском">
      <svg viewBox="0 0 16 16">
        <path d="M4 8h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  )
}
