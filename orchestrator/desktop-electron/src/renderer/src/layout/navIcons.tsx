import type { PageKey } from '../components/Sidebar'

export function NavIcon({ page }: { page: PageKey }): React.JSX.Element {
  if (page === 'today') {
    return (
      <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="5" width="16" height="15" rx="3" />
        <path d="M8 3v4M16 3v4M4 10h16" strokeLinecap="round" />
      </svg>
    )
  }
  if (page === 'processes') {
    return (
      <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M5.9 5.9l1.5 1.5M16.6 16.6l1.5 1.5M18.1 5.9l-1.5 1.5M7.4 16.6l-1.5 1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (page === 'decisions') {
    return (
      <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7 7h10M7 12h10M7 17h6" strokeLinecap="round" />
        <rect x="4" y="4" width="16" height="16" rx="3" />
      </svg>
    )
  }
  if (page === 'kpi') {
    return (
      <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 19V9M12 19V5M19 19v-7" strokeLinecap="round" />
        <path d="M4 19.5h16" strokeLinecap="round" />
      </svg>
    )
  }
  if (page === 'tasks') {
    return (
      <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M9 11l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="4" y="4" width="16" height="16" rx="3" />
      </svg>
    )
  }
  if (page === 'projects') {
    return (
      <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 7h16M4 12h10M4 17h14" strokeLinecap="round" />
        <rect x="4" y="4" width="16" height="16" rx="3" />
      </svg>
    )
  }
  if (page === 'mail') {
    return (
      <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <path d="M4 8l8 5 8-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (page === 'meetings') {
    return (
      <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="5" width="16" height="15" rx="3" />
        <path d="M8 3v4M16 3v4M4 10h16" strokeLinecap="round" />
        <path d="M8 14h2M12 14h2M16 14h2M8 17h2M12 17h2" strokeLinecap="round" />
      </svg>
    )
  }
  if (page === 'knowledge') {
    return (
      <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6 5h12v14H6z" strokeLinejoin="round" />
        <path d="M9 5v14M6 9h3M6 13h3" strokeLinecap="round" />
      </svg>
    )
  }
  if (page === 'history') {
    return (
      <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 12a8 8 0 1 0 2.3-5.7" strokeLinecap="round" />
        <path d="M4 5v4h4M12 8v4l3 2" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" className="nav-icon-svg" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.6v2.1M12 18.3v2.1M3.6 12h2.1M18.3 12h2.1M5.9 5.9l1.5 1.5M16.6 16.6l1.5 1.5M18.1 5.9l-1.5 1.5M7.4 16.6l-1.5 1.5" strokeLinecap="round" />
    </svg>
  )
}
