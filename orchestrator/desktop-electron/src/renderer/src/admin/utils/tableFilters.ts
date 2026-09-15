export function isAllFilter(value: string): boolean {
  return !value || value.startsWith('Все ')
}

export function matchesFilter(field: string, filterValue: string): boolean {
  if (isAllFilter(filterValue)) return true
  return field.trim() === filterValue.trim()
}

export function matchesSearch(values: string[], query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return values.some((value) => value.toLowerCase().includes(normalized))
}

export function paginateRows<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return rows.slice(start, start + pageSize)
}
