import { Palette } from 'lucide-react'
import { ADMIN_THEMES } from '../theme/adminThemes'
import { useAdminTheme } from '../hooks/useAdminTheme'
import { AdminPageHeader } from '../components/shared/AdminPageHeader'
import { AdminPageShell } from '../components/shared/AdminPageShell'
import { fetchAdminSettings } from '../adminApi'
import { useAdminTabLoad } from '../hooks/useAdminTabLoad'

const SETTINGS_FALLBACK = {
  breadcrumb: 'Настройки — Параметры интерфейса',
  title: 'Настройки',
  subtitle: 'Персонализация интерфейса администратора'
}

export function SettingsPage(): React.JSX.Element {
  const { themeId, setThemeId } = useAdminTheme()
  const { data, loading, error } = useAdminTabLoad(SETTINGS_FALLBACK, fetchAdminSettings)

  return (
    <AdminPageShell breadcrumb={data.breadcrumb} className="admin-page--fill">
      <AdminPageHeader title={data.title} subtitle={data.subtitle} />
      {loading ? <p className="admin-kb-sub">Загрузка…</p> : null}
      {error ? (
        <p className="admin-kb-sub" role="alert">
          {error}
        </p>
      ) : null}
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
