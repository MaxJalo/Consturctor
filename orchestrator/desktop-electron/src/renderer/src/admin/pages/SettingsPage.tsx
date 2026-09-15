import { Palette } from 'lucide-react'
import { ADMIN_THEMES } from '../theme/adminThemes'
import { useAdminTheme } from '../hooks/useAdminTheme'
import { AdminPageHeader } from '../components/shared/AdminPageHeader'
import { AdminPageShell } from '../components/shared/AdminPageShell'

export function SettingsPage(): React.JSX.Element {
  const { themeId, setThemeId } = useAdminTheme()

  return (
    <AdminPageShell breadcrumb="Настройки — Параметры интерфейса" className="admin-page--fill">
      <AdminPageHeader title="Настройки" subtitle="Персонализация интерфейса администратора" />
      <section className="admin-panel admin-settings-panel">
        <div className="admin-panel-title-row">
          <span className="admin-panel-title-row__icon">
            <Palette size={18} strokeWidth={2} />
          </span>
          <div>
            <h3 className="admin-dashboard-panel__title">Тема оформления</h3>
            <p className="admin-kb-sub">Выберите цветовую схему для админ-панели</p>
          </div>
        </div>
        <div className="admin-theme-grid">
          {ADMIN_THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className={`admin-theme-card ${themeId === theme.id ? 'active' : ''}`}
              onClick={() => setThemeId(theme.id)}
            >
              <div className="admin-theme-card__swatches">
                {theme.swatches.map((color) => (
                  <span key={color} style={{ background: color }} />
                ))}
              </div>
              <strong>{theme.name}</strong>
              <span>{theme.description}</span>
            </button>
          ))}
        </div>
      </section>
    </AdminPageShell>
  )
}
