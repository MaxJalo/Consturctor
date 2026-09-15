import { Download, Eye, Plus } from 'lucide-react'

interface AdminPrimaryButtonProps {
  label: string
  icon?: 'plus' | 'download' | 'eye'
  onClick?: () => void
}

const ICONS = {
  plus: Plus,
  download: Download,
  eye: Eye
} as const

export function AdminPrimaryButton({ label, icon, onClick }: AdminPrimaryButtonProps): React.JSX.Element {
  const Icon = icon ? ICONS[icon] : null
  return (
    <button type="button" className="admin-primary-btn" onClick={onClick}>
      {Icon ? <Icon size={14} strokeWidth={2} aria-hidden /> : null}
      {label}
    </button>
  )
}
