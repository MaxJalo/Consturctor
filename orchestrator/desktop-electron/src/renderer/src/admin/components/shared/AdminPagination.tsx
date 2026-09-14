interface AdminPaginationProps {
  from: number
  to: number
  total: number
  pages?: Array<number | 'ellipsis'>
  activePage?: number
}

export function AdminPagination({
  from,
  to,
  total,
  pages = [1, 2, 3, 'ellipsis', 50],
  activePage = 1
}: AdminPaginationProps): React.JSX.Element {
  return (
    <div className="admin-pagination">
      <div className="admin-pagination__pages">
        <button type="button" className="admin-pagination__nav" aria-label="Назад">
          ‹
        </button>
        {pages.map((page, index) =>
          page === 'ellipsis' ? (
            <span key={`e-${index}`} className="admin-pagination__ellipsis">
              …
            </span>
          ) : (
            <button
              key={page}
              type="button"
              className={page === activePage ? 'admin-pagination__page active' : 'admin-pagination__page'}
            >
              {page}
            </button>
          )
        )}
        <button type="button" className="admin-pagination__nav" aria-label="Вперёд">
          ›
        </button>
      </div>
      <div className="admin-pagination__summary">
        {from}–{to} из {total}
      </div>
    </div>
  )
}
