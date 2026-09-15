import type { ReactNode } from 'react'
import { OrchSlotMain } from '../../layout/GridSlots'

/** Встраивает существующий workplace без дублирования shell-шапки (скрывается через CSS). */
export function HeavyTabEmbed({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <OrchSlotMain spanAll heavyEmbed>
      <div className="orch-heavy-embed">{children}</div>
    </OrchSlotMain>
  )
}
