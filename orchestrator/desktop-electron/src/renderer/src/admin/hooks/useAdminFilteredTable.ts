import { useCallback, useEffect, useMemo, useState } from 'react'
import { paginateRows } from '../utils/tableFilters'

interface UseAdminFilteredTableOptions<T> {
  rows: T[]
  pageSize: number
  filterFn: (row: T, filters: Record<string, string>, search: string) => boolean
  resetKey?: string
}

export function useAdminFilteredTable<T>({
  rows,
  pageSize,
  filterFn,
  resetKey
}: UseAdminFilteredTableOptions<T>) {
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    setFilters({})
    setSearch('')
    setPage(1)
  }, [resetKey])

  const handleFiltersChange = useCallback((values: Record<string, string>, nextSearch: string) => {
    setFilters(values)
    setSearch(nextSearch)
    setPage(1)
  }, [])

  const filtered = useMemo(
    () => rows.filter((row) => filterFn(row, filters, search)),
    [rows, filterFn, filters, search]
  )

  const paged = useMemo(() => paginateRows(filtered, page, pageSize), [filtered, page, pageSize])

  return {
    filtered,
    paged,
    page,
    setPage,
    handleFiltersChange,
    total: filtered.length
  }
}
