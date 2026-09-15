import { useCallback, useEffect, useState } from 'react'
import { applyAdminTheme, readAdminTheme, type AdminThemeId } from '../theme/adminThemes'

export function useAdminTheme(): { themeId: AdminThemeId; setThemeId: (id: AdminThemeId) => void } {
  const [themeId, setThemeIdState] = useState<AdminThemeId>(() => readAdminTheme())

  useEffect(() => {
    applyAdminTheme(themeId)
  }, [themeId])

  const setThemeId = useCallback((id: AdminThemeId) => {
    setThemeIdState(id)
    applyAdminTheme(id)
  }, [])

  return { themeId, setThemeId }
}
