import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { WorkplaceKpiDashboard } from './workplaceKpiTypes'

const DEFAULT_FROM = '2024-08-12'
const DEFAULT_TO = '2024-08-18'

export function useWorkplaceKpiDashboard(periodFrom = DEFAULT_FROM, periodTo = DEFAULT_TO): {
  data: WorkplaceKpiDashboard | null
  loading: boolean
  error: string
  reload: () => void
} {
  const [data, setData] = useState<WorkplaceKpiDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    setLoading(true)
    setError('')
    void api
      .getWorkplaceKpi({ from: periodFrom, to: periodTo })
      .then((next) => setData(next))
      .catch((err: unknown) => {
        setData(null)
        setError(err instanceof Error ? err.message : 'Не удалось загрузить KPI')
      })
      .finally(() => setLoading(false))
  }, [periodFrom, periodTo])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, error, reload }
}
