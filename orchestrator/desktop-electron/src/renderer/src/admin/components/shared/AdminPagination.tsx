import { buildPageList, paginateRange } from '../../utils/pagination'

interface AdminPaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

export function AdminPagination({ page, pageSize, total, onPageChange }: AdminPaginationProps): React.JSX.Element {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(page, 1), totalPages)
  const pages = buildPageList(totalPages, safePage)
  const { from, to } = paginateRange(safePage, pageSize, total)

  return (
    <div className="admin-pagination">
      <div className="admin-pagination__pages">
        <button
          type="button"
          className="admin-pagination__nav"
          aria-label="Назад"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          ‹
        </button>
        {pages.map((item, index) =>
          item === 'ellipsis' ? (
            <span key={`e-${index}`} className="admin-pagination__ellipsis">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              className={item === safePage ? 'admin-pagination__page active' : 'admin-pagination__page'}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          )
        )}
        <button
          type="button"
          className="admin-pagination__nav"
          aria-label="Вперёд"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
        >
          ›
        </button>
      </div>
      <div className="admin-pagination__summary">
        {from}–{to} из {total}
      </div>
    </div>
  )
}
