export function buildPageList(totalPages: number, activePage: number): Array<number | 'ellipsis'> {
  if (totalPages <= 1) return [1]
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }
  const pages: Array<number | 'ellipsis'> = [1]
  const left = Math.max(2, activePage - 1)
  const right = Math.min(totalPages - 1, activePage + 1)
  if (left > 2) pages.push('ellipsis')
  for (let page = left; page <= right; page += 1) pages.push(page)
  if (right < totalPages - 1) pages.push('ellipsis')
  pages.push(totalPages)
  return pages
}

export function paginateRange(page: number, pageSize: number, total: number): { from: number; to: number } {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return { from, to }
}
