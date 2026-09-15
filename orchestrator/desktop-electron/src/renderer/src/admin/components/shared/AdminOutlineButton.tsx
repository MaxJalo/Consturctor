import { Calendar, ChevronDown, Download, Pencil, Upload } from 'lucide-react'

interface AdminOutlineButtonProps {
  label: string
  icon?: 'import' | 'calendar' | 'chevron' | 'download' | 'pencil'
  onClick?: () => void
}

export function AdminOutlineButton({ label, icon, onClick }: AdminOutlineButtonProps): React.JSX.Element {
  return (
    <button type="button" className="admin-outline-btn" onClick={onClick}>
      {icon === 'import' ? <Upload size={14} strokeWidth={2} aria-hidden /> : null}
      {icon === 'calendar' ? <Calendar size={14} strokeWidth={2} aria-hidden /> : null}
      {icon === 'download' ? <Download size={14} strokeWidth={2} aria-hidden /> : null}
      {icon === 'pencil' ? <Pencil size={14} strokeWidth={2} aria-hidden /> : null}
      {label}
      {icon === 'chevron' ? <ChevronDown size={14} strokeWidth={2} aria-hidden /> : null}
    </button>
  )
}
