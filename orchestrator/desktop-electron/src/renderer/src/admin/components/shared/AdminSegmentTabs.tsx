export interface AdminTabItem {
  id: string
  label: string
}

interface AdminSegmentTabsProps {
  tabs: AdminTabItem[]
  activeId: string
  onChange?: (id: string) => void
}

export function AdminSegmentTabs({ tabs, activeId, onChange }: AdminSegmentTabsProps): React.JSX.Element {
  return (
    <div className="admin-segment-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === activeId}
          className={tab.id === activeId ? 'admin-segment-tabs__item active' : 'admin-segment-tabs__item'}
          onClick={() => onChange?.(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
