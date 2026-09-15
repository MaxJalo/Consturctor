import { Bot } from 'lucide-react'
import type { MetricIconVariant } from '../../mocks/adminMocks'

interface MetricIconProps {
  variant: MetricIconVariant
}

export function MetricIcon({ variant }: MetricIconProps): React.JSX.Element {
  const stroke = 'currentColor'
  const sw = 1.8

  if (variant === 'agents_total') {
    return <Bot size={22} strokeWidth={2} aria-hidden />
  }
  if (variant === 'agents_used' || variant === 'success_rate' || variant === 'system_load') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden fill="none">
        <circle cx="12" cy="12" r="7" stroke={stroke} strokeWidth={sw} />
        <circle cx="12" cy="12" r="3.5" stroke={stroke} strokeWidth={sw} />
        <circle cx="12" cy="12" r="1.2" fill={stroke} stroke="none" />
      </svg>
    )
  }
  if (variant === 'active_runs') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden fill="none">
        <circle cx="6" cy="8" r="2" stroke={stroke} strokeWidth={sw} />
        <circle cx="18" cy="6" r="2" stroke={stroke} strokeWidth={sw} />
        <circle cx="12" cy="18" r="2" stroke={stroke} strokeWidth={sw} />
        <path d="M7.8 9.2l3.2 6M16.2 7.8l-3.2 8.2M8 8l8-1.5" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
  }
  if (variant === 'users') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden fill="none">
        <circle cx="9" cy="9" r="2.4" stroke={stroke} strokeWidth={sw} />
        <path d="M4.5 17.5c.8-2 2.4-3 4.5-3s3.7 1 4.5 3" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        <circle cx="16.5" cy="10" r="2" stroke={stroke} strokeWidth={sw} />
        <path d="M14.5 17.5c.4-1.3 1.5-2 2.8-2" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      </svg>
    )
  }
  if (variant === 'errors') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden fill="none">
        <circle cx="12" cy="12" r="7" stroke={stroke} strokeWidth={sw} />
        <path d="M12 8.5v4.5" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        <circle cx="12" cy="16.5" r="0.9" fill={stroke} stroke="none" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="none">
      <circle cx="12" cy="12" r="7" stroke={stroke} strokeWidth={sw} />
      <path d="M12 8v4.2l2.8 1.6" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
